"""Echo local server: runs Echo on this PC straight from your OneDrive folder.

Serves the app from OneDrive\\Echo\\App at http://127.0.0.1:47824/ and gives it direct access to the
OneDrive\\Echo folder on this computer (OneDrive itself syncs it). No sign-in, no website: everything
stays on this PC and in your OneDrive. Only Python's standard library is used.

The app talks to it with the same small set of requests it sends to Microsoft OneDrive on the phone,
so one app works in both places. Only files inside the Echo folder can be read or written, and only
by pages served from this server.
"""
import base64
import email.utils
import json
import mimetypes
import os
import re
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 47824
HERE = os.path.dirname(os.path.abspath(__file__))           # ...\Echo\App\pc
APP_DIR = os.path.dirname(HERE)                             # ...\Echo\App
ECHO_DIR = os.path.dirname(APP_DIR)                         # ...\Echo
DRIVE_ROOT = os.path.dirname(ECHO_DIR)                      # ...\OneDrive
ECHO_NAME = os.path.basename(ECHO_DIR)                      # "Echo"
GRAPH = "/graph/v1.0/me/drive"
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
         ".webmanifest": "application/manifest+json", ".bat": "application/octet-stream", ".txt": "text/plain; charset=utf-8",
         ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg",
         ".opus": "audio/ogg", ".webm": "audio/webm", ".aac": "audio/aac", ".flac": "audio/flac", ".amr": "audio/amr", ".3gp": "audio/3gpp"}
sessions = {}
lock = threading.Lock()


def enc_id(rel):
    return "p" + base64.urlsafe_b64encode(rel.encode("utf-8")).decode().rstrip("=")


def dec_id(item_id):
    if not item_id.startswith("p"):
        raise KeyError(item_id)
    s = item_id[1:]
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode("utf-8")


def safe_path(rel):
    """Absolute path for a drive-relative path, or None when it is outside the Echo folder."""
    rel = rel.strip("/").replace("\\", "/")
    parts = [p for p in rel.split("/") if p]
    if not parts or parts[0] != ECHO_NAME or any(p in (".", "..") or ":" in p for p in parts):
        return None
    full = os.path.normpath(os.path.join(DRIVE_ROOT, *parts))
    if not (full == ECHO_DIR or full.startswith(ECHO_DIR + os.sep)):
        return None
    return full


def rel_of(full):
    return os.path.relpath(full, DRIVE_ROOT).replace(os.sep, "/")


def etag(st):
    return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'


def meta(full, host):
    st = os.stat(full)
    rel = rel_of(full)
    m = {"id": enc_id(rel), "name": os.path.basename(full), "size": st.st_size if os.path.isfile(full) else 0,
         "eTag": etag(st), "lastModifiedDateTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime))}
    if os.path.isdir(full):
        m["folder"] = {"childCount": len(os.listdir(full))}
    else:
        m["file"] = {"mimeType": TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")}
        m["@microsoft.graph.downloadUrl"] = f"http://{host}/dl/{m['id']}?v={st.st_mtime_ns:x}"
    return m


def unique(full):
    if not os.path.exists(full):
        return full
    base, ext = os.path.splitext(full)
    n = 1
    while os.path.exists(f"{base} {n}{ext}"):
        n += 1
    return f"{base} {n}{ext}"


def write_file(full, data):
    os.makedirs(os.path.dirname(full), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(full), prefix=".echo-", suffix=".tmp")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    for _ in range(10):
        try:
            os.replace(tmp, full)
            return
        except PermissionError:  # OneDrive can hold a file for a moment while syncing it
            time.sleep(0.5)
    os.replace(tmp, full)


class Handler(BaseHTTPRequestHandler):
    server_version = "EchoLocal/1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # ---------- helpers
    def send(self, status, body=b"", ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        if body or status not in (204, 304):
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def error(self, status, code, msg):
        self.send(status, {"error": {"code": code, "message": msg}})

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def allowed(self):
        if self.headers.get("Host", "") not in ALLOWED_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if self.command not in ("GET", "HEAD") and origin not in ALLOWED_ORIGINS:
            return False
        site = self.headers.get("Sec-Fetch-Site")
        if self.command not in ("GET", "HEAD") and site not in (None, "same-origin"):
            return False
        return True

    def send_file(self, full, ctype):
        size = os.path.getsize(full)
        rng = self.headers.get("Range")
        start, end, status = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)$", rng or "")
        if m and size:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2) or 0))
            end = min(end, size - 1)
            if start > end:
                self.send(416, b"", headers={"Content-Range": f"bytes */{size}"})
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(full, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    # ---------- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.route()

    def do_PUT(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def route(self):
        if not self.allowed():
            return self.error(403, "forbidden", "Not allowed.")
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if path.startswith(GRAPH):
                return self.graph(path[len(GRAPH):], q)
            if path.startswith("/dl/"):
                full = safe_path(dec_id(path[4:]))
                if not full or not os.path.isfile(full):
                    return self.error(404, "itemNotFound", "Not found.")
                return self.send_file(full, TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
            if path.startswith("/upload/"):
                return self.upload_chunk(path[8:])
            if path == "/health":
                return self.send(200, {"ok": True, "folder": ECHO_DIR})
            if self.command not in ("GET", "HEAD"):
                return self.error(405, "notAllowed", "Not allowed.")
            return self.static(path)
        except KeyError:
            return self.error(404, "itemNotFound", "Not found.")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            return self.error(500, "generalException", str(e))

    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(APP_DIR, *[p for p in path.split("/") if p]))
        if not full.startswith(APP_DIR + os.sep) or not os.path.isfile(full):
            return self.error(404, "notFound", "Not found.")
        ext = os.path.splitext(full)[1].lower()
        self.send_file(full, TYPES.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream")

    # ---------- the OneDrive-style API used by the app
    def graph(self, p, q):
        host = self.headers.get("Host")
        m = re.match(r"^/root:/(.*?):(/content|/createUploadSession)?$", p)
        if m:
            rel, op = m.group(1), m.group(2) or ""
            full = safe_path(rel)
            if not full:
                return self.error(403, "accessDenied", "Only the Echo folder can be used.")
            if op == "/content" and self.command == "PUT":
                return self.put_content(full, self.body(), q.get("@microsoft.graph.conflictBehavior", ["replace"])[0])
            if op == "/createUploadSession" and self.command == "POST":
                b = json.loads(self.body() or b"{}")
                if_match = self.headers.get("If-Match")
                if if_match and (not os.path.exists(full) or etag(os.stat(full)) != if_match):
                    return self.error(412, "preconditionFailed", "The file has changed.")
                sid = uuid.uuid4().hex
                with lock:
                    sessions[sid] = {"full": full, "chunks": [], "conflict": (b.get("item") or {}).get("@microsoft.graph.conflictBehavior", "replace")}
                return self.send(200, {"uploadUrl": f"http://{host}/upload/{sid}"})
            if self.command == "GET":
                return self.send(200, meta(full, host)) if os.path.exists(full) else self.error(404, "itemNotFound", "Not found.")
            if self.command == "DELETE":
                return self.delete(full)
            return self.error(405, "notAllowed", "Not allowed.")
        if p == "/root/children" and self.command == "POST":
            return self.make_folder(DRIVE_ROOT, json.loads(self.body() or b"{}"))
        m = re.match(r"^/items/([^/]+)(/children)?$", p)
        if m:
            full = safe_path(dec_id(m.group(1)))
            if not full or not os.path.exists(full):
                return self.error(404, "itemNotFound", "Not found.")
            if m.group(2) and self.command == "POST":
                return self.make_folder(full, json.loads(self.body() or b"{}"))
            if m.group(2):
                items = [meta(os.path.join(full, n), host) for n in sorted(os.listdir(full)) if not n.startswith(".echo-")]
                return self.send(200, {"value": items})
            if self.command == "GET":
                return self.send(200, meta(full, host))
            if self.command == "DELETE":
                return self.delete(full)
            if self.command == "PUT":
                return self.put_content(full, self.body(), "replace")
        return self.error(400, "invalidRequest", "Unknown request.")

    def put_content(self, full, data, conflict):
        if_match = self.headers.get("If-Match")
        with lock:
            exists = os.path.exists(full)
            if if_match and (not exists or etag(os.stat(full)) != if_match):
                return self.error(412, "preconditionFailed", "The file has changed.")
            if exists and conflict == "fail":
                return self.error(409, "nameAlreadyExists", "Already exists.")
            target = unique(full) if exists and conflict == "rename" else full
            write_file(target, data)
        return self.send(200 if exists else 201, meta(target, self.headers.get("Host")))

    def upload_chunk(self, sid):
        with lock:
            s = sessions.get(sid)
        if not s or self.command != "PUT":
            return self.error(404, "itemNotFound", "Upload session not found.")
        m = re.match(r"bytes (\d+)-(\d+)/(\d+)", self.headers.get("Content-Range", ""))
        if not m:
            return self.error(400, "invalidRange", "Missing Content-Range.")
        s["chunks"].append((int(m.group(1)), self.body()))
        if int(m.group(2)) + 1 < int(m.group(3)):
            return self.send(202, {"nextExpectedRanges": [f"{int(m.group(2)) + 1}-"]})
        with lock:
            sessions.pop(sid, None)
        data = b"".join(c for _, c in sorted(s["chunks"]))
        full = s["full"]
        with lock:
            exists = os.path.exists(full)
            target = unique(full) if exists and s["conflict"] == "rename" else full
            write_file(target, data)
        return self.send(200 if exists else 201, meta(target, self.headers.get("Host")))

    def make_folder(self, parent, b):
        name = str(b.get("name") or "")
        full = safe_path(rel_of(os.path.join(parent, name))) if name and "/" not in name and "\\" not in name else None
        if not full:
            return self.error(403, "accessDenied", "Only the Echo folder can be used.")
        if os.path.exists(full):
            return self.error(409, "nameAlreadyExists", "Already exists.")
        os.makedirs(full)
        return self.send(201, meta(full, self.headers.get("Host")))

    def delete(self, full):
        if full == ECHO_DIR or os.path.isdir(full):
            return self.error(403, "accessDenied", "Folders are not deleted.")
        if not os.path.exists(full):
            return self.error(404, "itemNotFound", "Not found.")
        os.remove(full)  # OneDrive keeps it in its recycle bin
        return self.send(204)


def main():
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print("Echo is already running.")
        return
    srv.daemon_threads = True
    print(f"Echo is running at http://127.0.0.1:{PORT}/ using {ECHO_DIR}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
