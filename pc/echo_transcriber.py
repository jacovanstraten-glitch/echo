"""Echo transcriber: turns recordings in OneDrive\\Echo\\Recordings into text, on this PC.

Speech to text: faster-whisper (OpenAI Whisper, open source). Who said what: pyannote (open source).
Both run locally; audio never leaves this computer. For every audio file it writes
"<same name>.transcript.json" next to it. OneDrive syncs that file to the phone, where the Echo app picks it up.

Started by Echo.bat. Settings live in %LOCALAPPDATA%\\Echo\\config.json.
"""
import datetime
import json
import os
import re
import socket
import sys
import threading
import time
import traceback

# Nothing about your recordings is sent anywhere: switch off the libraries' usage statistics.
os.environ.setdefault("PYANNOTE_METRICS_ENABLED", "0")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

VERSION = 1
HOME = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Echo")
CONFIG = os.path.join(HOME, "config.json")
AUDIO_RE = re.compile(r"\.(m4a|mp3|wav|ogg|oga|opus|webm|aac|mp4|flac|amr|3gp|wma)$", re.I)
LOCK_PORT = 47823
ECHO_SUBFOLDER = ("Echo",)  # must match "folder" in config.js of the app
HOST = socket.gethostname()
DEFAULTS = {
    "model": "large-v3-turbo",   # Whisper model; "small" is faster, "large-v3" is slower and a little more accurate
    "hf_token": "",              # Hugging Face token for speaker detection (pyannote)
    "diarization_model": "pyannote/speaker-diarization-community-1",
    "folder": "",                # leave empty to use OneDrive\Echo (the personal OneDrive)
    "threads": 0                 # 0 = use all CPU cores
}


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG, encoding="utf-8") as f:
            cfg.update(json.load(f))
    except FileNotFoundError:
        pass
    except Exception as e:
        log(f"Could not read {CONFIG}: {e}")
    return cfg


def save_config(cfg):
    os.makedirs(HOME, exist_ok=True)
    with open(CONFIG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def echo_folder(cfg):
    if cfg.get("folder"):
        return cfg["folder"]
    for var in ("OneDriveConsumer", "OneDrive"):
        base = os.environ.get(var)
        if base and os.path.isdir(base):
            return os.path.join(base, *ECHO_SUBFOLDER)
    return os.path.join(os.path.expanduser("~"), "OneDrive", *ECHO_SUBFOLDER)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    for _ in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:  # OneDrive briefly locks files it is syncing
            time.sleep(1)
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# ---------------------------------------------------------------- models
def add_cuda_dlls():
    """Make pip-installed NVIDIA libraries (cuBLAS, cuDNN) findable on Windows."""
    if os.name != "nt":
        return
    try:
        import importlib.util
        for pkg in ("nvidia.cublas", "nvidia.cudnn"):
            spec = importlib.util.find_spec(pkg)
            if spec and spec.submodule_search_locations:
                for loc in spec.submodule_search_locations:
                    b = os.path.join(loc, "bin")
                    if os.path.isdir(b):
                        os.add_dll_directory(b)
                        os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")
    except Exception:
        pass


class Models:
    def __init__(self, cfg):
        self.cfg = cfg
        self.whisper = None
        self.device = "cpu"
        self.diarizer = None
        self.diar_error = ""

    def load_whisper(self):
        if self.whisper:
            return self.whisper
        from faster_whisper import WhisperModel
        import ctranslate2
        name = self.cfg.get("model") or DEFAULTS["model"]
        threads = int(self.cfg.get("threads") or 0) or os.cpu_count() or 4
        if ctranslate2.get_cuda_device_count() > 0:
            add_cuda_dlls()
            try:
                log(f"Loading Whisper ({name}) on the graphics card…")
                self.whisper = WhisperModel(name, device="cuda", compute_type="float16")
                self.device = "gpu"
                return self.whisper
            except Exception as e:
                log(f"The graphics card could not be used ({e}); using the processor instead.")
        log(f"Loading Whisper ({name}) on the processor. The first time this downloads the model (about 1.5 GB)…")
        self.whisper = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)
        self.device = "cpu"
        return self.whisper

    def load_diarizer(self):
        if self.diarizer or self.diar_error:
            return self.diarizer
        token = (self.cfg.get("hf_token") or "").strip()
        if not token:
            self.diar_error = "no token"
            return None
        try:
            import torch
            from pyannote.audio import Pipeline
            import pyannote.audio
            name = self.cfg.get("diarization_model") or DEFAULTS["diarization_model"]
            if int(str(getattr(pyannote.audio, "__version__", "4")).split(".")[0]) < 4 and name.endswith("community-1"):
                name = "pyannote/speaker-diarization-3.1"  # older pyannote (fallback install) cannot load community-1
            log(f"Loading speaker detection ({name})…")
            try:
                p = Pipeline.from_pretrained(name, token=token)
            except TypeError:
                p = Pipeline.from_pretrained(name, use_auth_token=token)
            if p is None:
                raise RuntimeError("access denied")
            if torch.cuda.is_available():
                p.to(torch.device("cuda"))
            torch.set_num_threads(int(self.cfg.get("threads") or 0) or os.cpu_count() or 4)
            self.diarizer = p
        except Exception as e:
            self.diar_error = str(e) or e.__class__.__name__
            log("Speaker detection is not available: " + self.diar_error)
            log("  Check that you accepted the conditions on https://huggingface.co/pyannote/speaker-diarization-community-1")
            log("  and that the token in " + CONFIG + " is right. Transcription works without it.")
        return self.diarizer


# ---------------------------------------------------------------- one recording
def assign_speakers(words, turns):
    """Give every word the speaker who talks most during it (or the nearest speaker)."""
    out = []
    j = 0
    for w in words:
        best, best_ov = None, 0.0
        while j < len(turns) and turns[j][1] < w["start"] - 5:
            j += 1
        k = j
        while k < len(turns) and turns[k][0] <= w["end"] + 5:
            s, e, spk = turns[k]
            ov = min(e, w["end"]) - max(s, w["start"])
            if ov > best_ov:
                best, best_ov = spk, ov
            k += 1
        if best is None and turns:
            mid = (w["start"] + w["end"]) / 2
            best = min(turns, key=lambda t: min(abs(t[0] - mid), abs(t[1] - mid)))[2]
        out.append(best or "")
    return out


def build_segments(whisper_segments, turns):
    out = []
    for seg in whisper_segments:
        words = seg["words"]
        if not words:
            text = seg["text"].strip()
            if text:
                spk = assign_speakers([{"start": seg["start"], "end": seg["end"]}], turns)[0] if turns else ""
                out.append({"start": seg["start"], "end": seg["end"], "speaker": spk, "text": text})
            continue
        speakers = assign_speakers(words, turns) if turns else [""] * len(words)
        cur = None
        for w, spk in zip(words, speakers):
            if cur and cur["speaker"] == spk:
                cur["text"] += w["word"]
                cur["end"] = w["end"]
            else:
                if cur:
                    out.append(cur)
                cur = {"start": w["start"], "end": w["end"], "speaker": spk, "text": w["word"]}
        if cur:
            out.append(cur)
    # tidy: trim text, drop empty, merge tiny fragments into their neighbour
    clean = []
    for s in out:
        s["text"] = re.sub(r"\s+", " ", s["text"]).strip()
        if not s["text"]:
            continue
        if clean and clean[-1]["speaker"] == s["speaker"] and s["start"] - clean[-1]["end"] < 1.0 and len(clean[-1]["text"]) < 400 and not re.search(r"[.!?]$", clean[-1]["text"]):
            clean[-1]["text"] += " " + s["text"]
            clean[-1]["end"] = s["end"]
        else:
            clean.append(s)
    for s in clean:
        s["start"] = round(s["start"], 2)
        s["end"] = round(s["end"], 2)
    return clean


class Job:
    def __init__(self, audio_path, out_path, request):
        self.audio_path = audio_path
        self.out_path = out_path
        self.request = request or {}
        self.name = os.path.basename(audio_path)
        self.progress = 0.0
        self.step = ""
        self.last_write = 0

    def status(self, force=False):
        if force or time.time() - self.last_write > 12:
            self.last_write = time.time()
            write_json(self.out_path, {"status": "working", "progress": round(self.progress, 3), "step": self.step,
                                       "host": HOST, "startedAt": self.started, "version": VERSION})


def transcribe(job, models, heartbeat):
    from faster_whisper import decode_audio
    job.started = now_iso()
    t0 = time.time()
    job.step = "Reading the audio"
    job.status(force=True)
    heartbeat.working = job
    audio = decode_audio(job.audio_path, sampling_rate=16000)
    duration = len(audio) / 16000.0
    log(f"{job.name}: {duration / 60:.1f} minutes of audio")

    want_lang = (job.request.get("language") or "auto").lower()
    language = None if want_lang in ("", "auto") else want_lang
    n_spk = int(job.request.get("speakers") or 0)
    is_memo = job.request.get("kind") == "idea"
    diarize = not is_memo and n_spk != 1
    span = 0.75 if diarize else 0.98

    model = models.load_whisper()
    job.step = "Transcribing on the " + ("graphics card" if models.device == "gpu" else "processor")
    job.status(force=True)
    segments, info = model.transcribe(audio, language=language, beam_size=5, vad_filter=True,
                                      vad_parameters={"min_silence_duration_ms": 700},
                                      word_timestamps=True, condition_on_previous_text=False)
    wsegs = []
    for s in segments:
        words = [{"start": w.start, "end": w.end, "word": w.word} for w in (s.words or []) if w.start is not None]
        wsegs.append({"start": s.start, "end": s.end, "text": s.text, "words": words})
        job.progress = span * min(1.0, s.end / max(duration, 1))
        job.status()
    log(f"{job.name}: text ready ({info.language}, {time.time() - t0:.0f} s)")

    turns, diarized = [], False
    if diarize:
        pipe = models.load_diarizer()
        if pipe is not None:
            import torch
            job.step = "Telling the speakers apart"
            job.progress = span
            job.status(force=True)
            t1 = time.time()
            kw = {}
            if 2 <= n_spk <= 5:
                kw["num_speakers"] = n_spk
            elif n_spk >= 6:
                kw["min_speakers"] = 6

            def hook(step_name, step_artefact, file=None, total=None, completed=None):
                if total and completed is not None:
                    job.progress = span + (0.98 - span) * min(1.0, completed / total) * (0.5 if step_name == "segmentation" else 1.0)
                    job.status()
            data = {"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": 16000}
            try:
                out = pipe(data, hook=hook, **kw)
            except TypeError:
                out = pipe(data, **kw)
            ann = getattr(out, "exclusive_speaker_diarization", None) or getattr(out, "speaker_diarization", None) or out
            turns = sorted((t.start, t.end, spk) for t, _, spk in ann.itertracks(yield_label=True))
            diarized = bool(turns)
            log(f"{job.name}: {len(set(t[2] for t in turns))} speakers found ({time.time() - t1:.0f} s)")
    elif not is_memo:
        turns = [(0.0, duration + 1, "SPEAKER_00")]

    result = {
        "status": "done", "version": VERSION, "id": job.request.get("id", ""),
        "language": info.language, "languageProbability": round(info.language_probability or 0, 3),
        "duration": round(duration, 2), "model": models.cfg.get("model"), "device": models.device,
        "diarized": diarized, "segments": build_segments(wsegs, turns),
        "host": HOST, "startedAt": job.started, "finishedAt": now_iso(), "secondsTaken": round(time.time() - t0)
    }
    write_json(job.out_path, result)
    heartbeat.working = None
    log(f"{job.name}: done in {(time.time() - t0) / 60:.1f} minutes")


# ---------------------------------------------------------------- watching the folder
class Heartbeat(threading.Thread):
    def __init__(self, root, models):
        super().__init__(daemon=True)
        self.root, self.models, self.working = root, models, None

    def write(self):
        w = self.working
        data = {"host": HOST, "lastSeen": now_iso(), "version": VERSION, "model": self.models.cfg.get("model"),
                "device": self.models.device, "diarization": bool((self.models.cfg.get("hf_token") or "").strip()) and not self.models.diar_error,
                "working": {"name": w.name, "progress": round(w.progress, 3)} if w else None}
        try:
            write_json(os.path.join(self.root, "transcriber.json"), data)
        except Exception as e:
            log(f"Could not write the status file: {e}")

    def run(self):
        while True:
            self.write()
            time.sleep(60)


def find_work(rec_dir, retry_mine):
    """Audio files without a finished transcript, oldest first. Skips files that are still being synced."""
    try:
        names = os.listdir(rec_dir)
    except FileNotFoundError:
        return []
    todo = []
    for n in names:
        if not AUDIO_RE.search(n):
            continue
        base = n[:n.rfind(".")]
        p = os.path.join(rec_dir, n)
        out = os.path.join(rec_dir, base + ".transcript.json")
        if os.path.exists(out):
            t = read_json(out)
            if t and t.get("status") in ("done", "error"):
                continue
            if t and t.get("status") == "working":
                stale = time.time() - os.path.getmtime(out) > 30 * 60
                if not (stale or (retry_mine and t.get("host") == HOST)):
                    continue  # another PC is working on it
        try:
            st = os.stat(p)
        except OSError:
            continue
        if time.time() - st.st_mtime < 20 or st.st_size == 0:
            continue
        todo.append((st.st_mtime, p, out, os.path.join(rec_dir, base + ".request.json")))
    return [t[1:] for t in sorted(todo)]


def first_run(cfg):
    if cfg.get("asked_token"):
        return
    print()
    print("=" * 70)
    print(" Speaker detection (who said what) needs a free Hugging Face token.")
    print(" 1. Make a free account on https://huggingface.co")
    print(" 2. Open https://huggingface.co/pyannote/speaker-diarization-community-1")
    print("    and accept the conditions (fill in the short form).")
    print(" 3. Create a token on https://huggingface.co/settings/tokens")
    print("    (type: Read) and paste it below.")
    print(" Press Enter without a token to skip; transcription still works.")
    print("=" * 70)
    try:
        tok = input("Token: ").strip()
    except EOFError:
        tok = ""
    cfg["hf_token"] = tok
    cfg["asked_token"] = True
    save_config(cfg)
    print("Saved. To change it later, edit or delete " + CONFIG)
    print()


# ---------------------------------------------------------------- installing (runs with the system Python)
PACKAGES = ["faster-whisper==1.2.1", "av>=11,<16"]
SPEAKER_PACKAGES = [["pyannote.audio==4.0.7"], ["pyannote.audio==3.3.2", "numpy<2"]]


def install():
    import shutil
    import subprocess
    import venv
    os.makedirs(HOME, exist_ok=True)
    vdir = os.path.join(HOME, "venv")
    py = os.path.join(vdir, "Scripts", "python.exe") if os.name == "nt" else os.path.join(vdir, "bin", "python")
    print("Setting up the Echo transcriber. This is needed only once and takes 5 to 15 minutes.")
    print(f"Everything is installed in {HOME}; nothing else on your PC is changed.")
    print()
    if not os.path.exists(py):
        print("1/4 Creating a private Python environment…")
        venv.EnvBuilder(with_pip=True).create(vdir)

    def pip(*args):
        return subprocess.call([py, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", *args])
    pip("-q", "--upgrade", "pip")
    print("2/4 Installing Whisper (speech to text)…")
    if pip(*PACKAGES) != 0:
        print("Installing Whisper failed. Check your internet connection and start Echo.bat again.")
        return 1
    print("3/4 Installing speaker detection (who said what)…")
    ok = False
    for pkgs in SPEAKER_PACKAGES:
        if pip(*pkgs) == 0:
            ok = True
            break
        print("   That did not work; trying an older version…")
    if not ok:
        print("   Speaker detection could not be installed. Transcription works without it.")
    if shutil.which("nvidia-smi"):
        print("   NVIDIA graphics card found: installing its libraries for faster transcription…")
        pip("nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*")
    print("4/4 Downloading the Whisper model (about 1.5 GB)…")
    cfg = load_config()
    subprocess.call([py, "-c", "from faster_whisper import WhisperModel; WhisperModel(%r, device='cpu', compute_type='int8')" % (cfg.get("model") or DEFAULTS["model"])])
    with open(os.path.join(HOME, "installed.txt"), "w") as f:
        f.write(f"{VERSION} {now_iso()}\n")
    print()
    print("The transcriber is installed.")
    return 0


def main():
    try:
        lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock.bind(("127.0.0.1", LOCK_PORT))
        lock.listen(1)
    except OSError:
        log("The Echo transcriber is already running.")
        return
    cfg = load_config()
    if "--setup" in sys.argv or not cfg.get("asked_token"):
        first_run(cfg)
        if "--setup" in sys.argv:
            return
    root = echo_folder(cfg)
    rec_dir = os.path.join(root, "Recordings")
    os.makedirs(rec_dir, exist_ok=True)
    os.system("title Echo transcriber")
    log(f"Echo transcriber {VERSION} is watching {rec_dir}")
    log("Leave this window open (minimised is fine). Close it to stop transcribing.")
    models = Models(cfg)
    hb = Heartbeat(root, models)
    hb.start()
    first = True
    while True:
        try:
            for audio, out, req_path in find_work(rec_dir, retry_mine=first):
                job = Job(audio, out, read_json(req_path))
                log(f"Starting {job.name}")
                try:
                    transcribe(job, models, hb)
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    traceback.print_exc()
                    msg = str(e) or e.__class__.__name__
                    write_json(out, {"status": "error", "error": msg[:400], "host": HOST, "finishedAt": now_iso(), "version": VERSION})
                    log(f"{job.name}: failed: {msg}")
                finally:
                    hb.working = None
                hb.write()
            first = False
        except KeyboardInterrupt:
            log("Stopped.")
            return
        except Exception as e:
            log(f"Error while checking the folder: {e}")
        time.sleep(15)


if __name__ == "__main__":
    if "--install" in sys.argv:
        sys.exit(install())
    main()
