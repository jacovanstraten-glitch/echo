/* Echo — capture ideas and record conversations. Everything is stored in your own OneDrive (folder "Echo").
   Recordings are transcribed on your own PC by the Echo transcriber (Whisper + speaker detection), which writes
   "<recording>.transcript.json" next to each audio file. "Copy for Claude" turns a transcript into a ready prompt;
   Claude's answer is pasted back and becomes searchable, with its checklist items collected under Actions. */
(() => {
"use strict";

/* ================= utilities ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 20);
const pad = n => String(n).padStart(2, "0");
function clock(ms, forceHours = false) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h || forceHours ? h + ":" + pad(m) : String(m)) + ":" + pad(s % 60);
}
const tstamp = sec => { const s = Math.floor(sec || 0); return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60); };
function fmtDate(ms, withTime = true) {
  const d = new Date(ms);
  if (isNaN(d)) return "";
  const date = d.toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"});
  return withTime ? `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}
function safeSeg(s, max = 70) {
  return String(s || "").replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, max).trim() || "Recording";
}
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
function b64ToBytes(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
async function sha1(text) {
  try { const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)); return [...new Uint8Array(h)].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join(""); }
  catch { return String(text.length); }
}

const ICON = {
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  idea:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V16h5v-.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/></svg>',
  wave:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12"/></svg>',
  mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  pause:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  flag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  redo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>'
};

const DEFAULT_CATS = ["Work", "Business ideas", "Private", "Other"];
const IDEA_STATUS = [["new", "New"], ["developing", "Developing"], ["action", "Action"], ["parked", "Parked"], ["done", "Done"]];
const IDEA_STATUS_LABEL = Object.fromEntries(IDEA_STATUS);
const LANGS = [["auto", "Detect automatically"], ["nl", "Dutch"], ["en", "English"], ["am", "Amharic"], ["de", "German"], ["fr", "French"], ["es", "Spanish"]];
const OUT_LANGS = ["Dutch", "English"];

/* Conversation types: each gives Claude a different job when you tap "Copy for Claude". */
const TYPES = {
  meeting: {label: "Meeting", task:
`Summarise this meeting. Use these headings:
## Summary (5 to 10 sentences)
## Decisions
## Action items
## Open questions
## Notable numbers and dates (amounts, quantities, prices, deadlines exactly as mentioned)`},
  board: {label: "Board meeting", task:
`Write board-level minutes. Use these headings:
## Attendees
## Per agenda topic: discussion in brief, conclusion
## Decisions (numbered, formal wording)
## Action items
## Risks and points to escalate
## Items for the next meeting`},
  partner: {label: "Partner or supplier call", task:
`Summarise this call with a business partner or supplier. Use these headings:
## Summary
## What was agreed (prices, volumes, quality, delivery dates, terms; exactly as said)
## What they want from us / what we want from them
## Action items
## Points of attention (anything vague, risky or worth checking in writing)
## Suggested follow-up email (short, ready to send, in the same language as this answer)`},
  team: {label: "Team meeting", task:
`Summarise this team meeting. Use these headings:
## Summary
## Per person: what they reported and what they will do
## Problems raised and how they will be solved
## Action items
## Things to follow up on next time`},
  interview: {label: "Interview", task:
`Summarise this interview. Use these headings:
## Summary
## Key points per topic
## Strong points and concerns
## Notable quotes (short, exact)
## Action items or follow-up questions`},
  call: {label: "Phone call", task:
`Summarise this phone call briefly. Use these headings:
## Summary (3 to 6 sentences)
## Agreements
## Action items`},
  talk: {label: "Lecture or talk", task:
`Make study notes of this talk. Use these headings:
## Main message
## Key points (structured, with the reasoning behind them)
## Data, numbers and sources mentioned
## What is useful for me, and why
## Questions to look into`},
  memo: {label: "Voice memo", task:
`This is a voice memo I recorded for myself. Turn it into clear notes. Use these headings:
## What it is about
## Thoughts, cleaned up and structured
## Action items`}
};
const IDEA_TASK =
`Help me develop this idea. Use these headings:
## The idea in one sentence
## Why it could work
## Risks and weak spots (be critical)
## What I need to find out first
## Concrete next steps
## Action items`;
const ACTION_RULE = `Write every action item on its own line in exactly this form: "- [ ] Who: what (deadline if mentioned)". Use "Me" for things I have to do. If there are none, write "- none".`;

const ROOT = ((window.ECHO_CONFIG && window.ECHO_CONFIG.folder) || "Echo").replace(/^\/+|\/+$/g, "");
const RECS = "Recordings";
const SCOPES = ["Files.ReadWrite"];
const G = "https://graph.microsoft.com/v1.0";
const REPO = "jacovanstraten-glitch/echo";
const APK_URL = `https://github.com/${REPO}/releases/latest/download/Echo.apk`;
const AUDIO_RE = /\.(m4a|mp3|wav|ogg|oga|opus|webm|aac|mp4|flac|amr|3gp|wma)$/i;

let toastTimer;
function toast(msg, ms = 3400) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
}

/* ================= tiny IndexedDB store ================= */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("echo", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("audio"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => {
    try {
      const db = await open();
      return await new Promise((res, rej) => { const t = db.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
    } catch { return undefined; }
  };
  return {
    get: (store, k) => tx(store, "readonly", s => s.get(k)),
    set: (store, k, v) => tx(store, "readwrite", s => s.put(v, k)),
    del: (store, k) => tx(store, "readwrite", s => s.delete(k)),
    keys: store => tx(store, "readonly", s => s.getAllKeys()),
    clear: store => tx(store, "readwrite", s => s.clear())
  };
})();

/* ================= state ================= */
const state = {
  index: emptyIndex(), etag: null, loaded: false,
  view: "all", cat: null, q: "", dirty: false, syncing: false, syncError: "",
  live: {},          // id -> {status, progress, error} from the PC transcriber, not saved
  uploads: {},       // id -> {done, total, error}
  pc: null           // transcriber.json heartbeat
};
function emptyIndex() { return {app: "echo", version: 1, entries: {}, categories: [...DEFAULT_CATS], catsUpdatedAt: 0, settings: {}, settingsUpdatedAt: 0, updatedAt: 0}; }
const entries = () => Object.values(state.index.entries).filter(e => !e.deleted);
const getEntry = id => { const e = state.index.entries[id]; return e && !e.deleted ? e : null; };
const cats = () => state.index.categories && state.index.categories.length ? state.index.categories : DEFAULT_CATS;
const setting = (k, d) => (state.index.settings && state.index.settings[k] !== undefined) ? state.index.settings[k] : d;
function setSetting(k, v) { state.index.settings = {...(state.index.settings || {}), [k]: v}; state.index.settingsUpdatedAt = Date.now(); scheduleSave(); }

/* ================= auth (MSAL) ================= */
let msalApp = null, account = null;
const clientId = () => (window.ECHO_CONFIG && window.ECHO_CONFIG.clientId) || lsGet("echo.clientId", "");
const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, "");
async function initAuth() {
  msalApp = new msal.PublicClientApplication({
    auth: {clientId: clientId(), authority: "https://login.microsoftonline.com/consumers", redirectUri: redirectUri(), navigateToLoginRequestUrl: false},
    cache: {cacheLocation: "localStorage"},
    system: {iframeHashTimeout: 8000}
  });
  await msalApp.initialize();
  const res = await msalApp.handleRedirectPromise();
  account = (res && res.account) || msalApp.getAllAccounts()[0] || null;
  return account;
}
async function signInAgain() {
  await msalApp.acquireTokenRedirect({scopes: SCOPES, account, loginHint: account && account.username});
  await new Promise(() => {});
}
const isBusy = () => !!recorder || Object.values(state.uploads).some(u => !u.error && !u.finished) || state.dirty;
async function getToken() {
  try { return (await msalApp.acquireTokenSilent({scopes: SCOPES, account})).accessToken; }
  catch (e) {
    console.warn("Silent sign-in failed", e);
    if (!isBusy()) return signInAgain();
    $("#notice").innerHTML = `<div class="notice update"><span>Your Microsoft sign-in needs to be renewed. Your recordings are kept on this device until then.</span><button class="btn primary" id="reauth">Sign in again</button></div>`;
    $("#reauth").onclick = () => signInAgain();
    throw new GraphError(401, "Sign in again to continue.", "reauth");
  }
}

/* ================= Microsoft Graph ================= */
class GraphError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
async function g(method, path, {body, headers = {}, raw = false} = {}) {
  const url = path.startsWith("http") ? path : G + path;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await getToken();
    const h = {Authorization: "Bearer " + token, ...headers};
    let b = body;
    if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && typeof body !== "string") { b = JSON.stringify(body); h["Content-Type"] = "application/json"; }
    let r;
    try { r = await fetch(url, {method, headers: h, body: b}); }
    catch { throw new GraphError(0, "You seem to be offline.", "offline"); }
    if (r.status === 429 || r.status === 503 || r.status === 504) { await sleep((Number(r.headers.get("Retry-After")) || (2 ** attempt)) * 1000); continue; }
    if (raw) return r;
    if (r.status === 204) return null;
    if (!r.ok) {
      let msg = r.statusText, code = "";
      try { const j = await r.json(); msg = j.error?.message || msg; code = j.error?.code || ""; } catch {}
      throw new GraphError(r.status, msg, code);
    }
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? r.json() : r.blob();
  }
  throw new GraphError(429, "OneDrive is busy. Try again in a minute.", "throttled");
}
const full = p => p ? `${ROOT}/${p}` : ROOT;
const itemRef = p => `/me/drive/root:/${encPath(full(p))}:`;

async function uploadFile(folder, name, blob, {replace = false, ifMatch = null, onProgress = null} = {}) {
  const p = folder ? `${folder}/${name}` : name;
  const cb = replace || ifMatch ? "replace" : "rename";
  if (blob.size <= 3.5 * 1024 * 1024) {
    const headers = {"Content-Type": blob.type || "application/octet-stream"};
    if (ifMatch) headers["If-Match"] = ifMatch;
    const r = await g("PUT", `${itemRef(p)}/content?@microsoft.graph.conflictBehavior=${cb}`, {body: blob, headers});
    if (onProgress) onProgress(blob.size, blob.size);
    return r;
  }
  const s = await g("POST", `${itemRef(p)}/createUploadSession`, {body: {item: {"@microsoft.graph.conflictBehavior": cb}}, headers: ifMatch ? {"If-Match": ifMatch} : {}});
  const CH = 320 * 1024 * 10; // 3.2 MB, a multiple of 320 KiB
  let res = null;
  for (let start = 0; start < blob.size; start += CH) {
    const end = Math.min(blob.size, start + CH);
    let r = null;
    for (let tryNo = 0; tryNo < 4; tryNo++) {
      try { r = await fetch(s.uploadUrl, {method: "PUT", headers: {"Content-Range": `bytes ${start}-${end - 1}/${blob.size}`}, body: blob.slice(start, end)}); }
      catch { r = null; }
      if (r && (r.ok || r.status === 202)) break;
      await sleep(1500 * (tryNo + 1));
    }
    if (!r || (!r.ok && r.status !== 202)) throw new GraphError(r ? r.status : 0, "Upload failed.", "upload");
    if (r.status === 200 || r.status === 201) res = await r.json();
    if (onProgress) onProgress(end, blob.size);
  }
  return res;
}
const folderCache = new Map();
async function ensureFolder(path) {
  if (folderCache.has(path)) return folderCache.get(path);
  try { const it = await g("GET", itemRef(path)); folderCache.set(path, it.id); return it.id; }
  catch (e) { if (e.status !== 404) throw e; }
  if (!path) { // the Echo folder itself, which may sit inside other folders ("Jaco - Persoonlijk/Echo")
    const parts = ROOT.split("/");
    let parentId = null;
    for (let i = 0; i < parts.length; i++) {
      const sub = encPath(parts.slice(0, i + 1).join("/"));
      try { parentId = (await g("GET", `/me/drive/root:/${sub}:`)).id; continue; } catch (e) { if (e.status !== 404) throw e; }
      try { parentId = (await g("POST", parentId ? `/me/drive/items/${parentId}/children` : "/me/drive/root/children", {body: {name: parts[i], folder: {}, "@microsoft.graph.conflictBehavior": "fail"}})).id; }
      catch (e) { if (e.status !== 409) throw e; parentId = (await g("GET", `/me/drive/root:/${sub}:`)).id; }
    }
    folderCache.set("", parentId); return parentId;
  }
  const parts = path.split("/"), name = parts.pop(), parent = parts.join("/");
  try {
    const it = await g("POST", `/me/drive/items/${await ensureFolder(parent)}/children`, {body: {name, folder: {}, "@microsoft.graph.conflictBehavior": "fail"}});
    folderCache.set(path, it.id); return it.id;
  } catch (e) {
    if (e.status !== 409) throw e;
    const it = await g("GET", itemRef(path)); folderCache.set(path, it.id); return it.id;
  }
}
async function readJson(path) {
  let meta;
  try { meta = await g("GET", itemRef(path)); } catch (e) { if (e.status === 404) return null; throw e; }
  const r = await fetch(meta["@microsoft.graph.downloadUrl"], {cache: "no-store"});
  if (!r.ok) throw new GraphError(r.status, "Could not read " + path, "read");
  try { return {json: await r.json(), meta}; } catch { return {json: null, meta}; }
}
async function deletePath(path) { try { await g("DELETE", itemRef(path)); } catch (e) { if (e.status !== 404) throw e; } }

/* ================= index sync ================= */
const INDEX = "index.json";
function mergeIndex(a, b) {
  const out = emptyIndex();
  out.entries = {...a.entries};
  for (const [id, e] of Object.entries(b.entries || {})) {
    const x = out.entries[id];
    if (!x || (e.updatedAt || 0) > (x.updatedAt || 0)) out.entries[id] = e;
  }
  const ca = a.catsUpdatedAt || 0, cb = b.catsUpdatedAt || 0;
  out.categories = cb > ca ? b.categories : a.categories;
  out.catsUpdatedAt = Math.max(ca, cb);
  const sa = a.settingsUpdatedAt || 0, sb = b.settingsUpdatedAt || 0;
  out.settings = sb > sa ? (b.settings || {}) : (a.settings || {});
  out.settingsUpdatedAt = Math.max(sa, sb);
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  if (!out.categories || !out.categories.length) out.categories = [...DEFAULT_CATS];
  return out;
}
async function fetchRemoteIndex() {
  const r = await readJson(INDEX);
  if (!r) return {index: null, etag: null};
  return {index: r.json && r.json.entries ? r.json : emptyIndex(), etag: r.meta.eTag};
}
async function cacheLocal() { await idb.set("kv", "index", {index: state.index, etag: state.etag, dirty: state.dirty}); }
async function loadIndex() {
  const cached = await idb.get("kv", "index");
  if (cached && cached.index) { state.index = mergeIndex(emptyIndex(), cached.index); state.etag = cached.etag; state.dirty = !!cached.dirty; state.loaded = true; render(); }
  await refreshIndex();
}
async function refreshIndex() {
  if (state.syncing) return;
  try {
    setSync("Syncing…");
    const {index, etag} = await fetchRemoteIndex();
    if (index && etag !== state.etag) state.index = mergeIndex(state.index, index);
    if (index) state.etag = etag;
    state.loaded = true; state.syncError = "";
    await cacheLocal(); render();
    if (state.dirty || !index) scheduleSave(0); else setSync("Synced");
  } catch (e) { state.loaded = true; render(); syncFailed(e); }
}
let saveTimer = null, saving = null;
function scheduleSave(ms = 800) {
  state.dirty = true; cacheLocal(); setSync("Saving…");
  clearTimeout(saveTimer); saveTimer = setTimeout(() => { saving = (saving || Promise.resolve()).then(saveIndex); }, ms);
}
async function saveIndex() {
  if (!state.dirty) return;
  state.syncing = true;
  try {
    await ensureFolder("");
    for (let attempt = 0; attempt < 4; attempt++) {
      state.index.updatedAt = Date.now();
      const blob = new Blob([JSON.stringify(state.index)], {type: "application/json"});
      try {
        const it = await uploadFile("", INDEX, blob, {ifMatch: state.etag});
        if (!state.etag && it && it.name !== INDEX) {
          await g("DELETE", `/me/drive/items/${it.id}`).catch(() => {});
          throw new GraphError(409, "conflict", "conflict");
        }
        state.etag = it.eTag; state.dirty = false; state.syncError = "";
        await cacheLocal(); setSync("Synced");
        return;
      } catch (e) {
        if (e.status === 412 || e.status === 409) {
          const {index, etag} = await fetchRemoteIndex();
          if (index) { state.index = mergeIndex(state.index, index); state.etag = etag; render(); }
          continue;
        }
        throw e;
      }
    }
    throw new GraphError(409, "Could not save after several tries.", "conflict");
  } catch (e) { syncFailed(e); }
  finally { state.syncing = false; }
}
function syncFailed(e) {
  console.error(e);
  state.syncError = e && e.code === "offline" ? "offline" : e && e.code === "reauth" ? "reauth" : "error";
  setSync({offline: "Offline", reauth: "Sign in again"}[state.syncError] || "Sync error", true);
}
function setSync(t, err = false) { const s = $("#sync"); if (s) { s.textContent = t; s.classList.toggle("err", err); } }
function putEntry(e, {quiet = false} = {}) { e.updatedAt = Date.now(); state.index.entries[e.id] = e; textCache.delete(e.id); if (!quiet) render(); scheduleSave(); }

/* ================= Android app bridge ================= */
const native = () => (window.EchoAndroid && typeof window.EchoAndroid.startRecording === "function") ? window.EchoAndroid : null;
const nativeCall = (fn, ...a) => { const n = native(); if (!n) return null; try { const r = n[fn](...a); return typeof r === "string" && /^[[{]/.test(r) ? JSON.parse(r) : r; } catch (e) { console.error(fn, e); return null; } };
const nativeWaiters = {};
window.echoNative = ev => {
  try { if (typeof ev === "string") ev = JSON.parse(ev); } catch { return; }
  if (!ev || !ev.type) return;
  const w = nativeWaiters[ev.type];
  if (w) { delete nativeWaiters[ev.type]; w(ev); }
  if (ev.type === "imported" || ev.type === "stopped") syncNativeFiles();
  if (ev.type === "command" && account) {
    if (ev.cmd === "record" || ev.cmd === "show") { if (!panel.hidden && !recorder) { panelClose = null; closePanel(); } startRecorder("recording"); }
    if (ev.cmd === "idea" || ev.cmd === "dictate") { if (recorder) return startRecorder(); if (!panel.hidden) closePanel(); newIdea({dictate: ev.cmd === "dictate"}); }
  }
};
const waitNative = (type, ms = 120000) => new Promise(res => { nativeWaiters[type] = res; setTimeout(() => { if (nativeWaiters[type] === res) { delete nativeWaiters[type]; res({type, timeout: true}); } }, ms); });

/* ================= text helpers ================= */
const spkKeys = e => { const seen = []; for (const s of (e.transcript && e.transcript.segments) || []) if (s.speaker && !seen.includes(s.speaker)) seen.push(s.speaker); return seen; };
function spkName(e, key) {
  if (!key) return "";
  const n = e.speakers && e.speakers[key];
  if (n) return n;
  const i = spkKeys(e).indexOf(key);
  return "Speaker " + (i >= 0 ? i + 1 : key.replace(/\D+/g, "") || "?");
}
function transcriptText(e, {times = true} = {}) {
  const segs = (e.transcript && e.transcript.segments) || [];
  const out = []; let last = null;
  for (const s of segs) {
    const who = s.speaker ? spkName(e, s.speaker) : "";
    const t = (s.text || "").trim();
    if (!t) continue;
    if (who && who === last && !times) { out[out.length - 1] += " " + t; continue; }
    out.push((times ? `[${tstamp(s.start)}] ` : "") + (who ? who + ": " : "") + t);
    last = who;
  }
  return out.join("\n");
}
const textCache = new Map();
function searchText(e) {
  if (!textCache.has(e.id)) textCache.set(e.id, norm([e.title, e.text, e.notes, e.summary, e.category, (e.tags || []).join(" "), Object.values(e.speakers || {}).join(" "), transcriptText(e, {times: false})].join(" \n ")));
  return textCache.get(e.id);
}
function actionsOf(e) {
  const out = [];
  String(e.summary || "").split("\n").forEach((line, i) => {
    const m = line.match(/^\s*[-*]\s*\[( |x|X)\]\s+(.+)$/);
    if (m) out.push({line: i, done: m[1] !== " ", text: m[2].trim()});
  });
  return out;
}
function toggleAction(e, lineNo, done) {
  const lines = String(e.summary || "").split("\n");
  lines[lineNo] = lines[lineNo].replace(/\[( |x|X)\]/, done ? "[x]" : "[ ]");
  e.summary = lines.join("\n"); putEntry(e, {quiet: true});
}

/* ================= status of a recording ================= */
function recStatus(e) {
  if (!e.audio) return null;
  const up = state.uploads[e.id];
  if (!e.audio.uploaded) {
    if (up && up.error) return {cls: "warn", label: "Upload failed", wait: true};
    if (up) return {cls: "busy", label: `Uploading ${Math.round(100 * (up.done || 0) / (up.total || 1))}%`, wait: true};
    return {cls: "warn", label: "Waiting to upload", wait: true};
  }
  if (e.transcript && e.transcript.segments) return e.summary ? {cls: "ok", label: "Summarised"} : {cls: "ok", label: "Transcribed"};
  const l = state.live[e.id];
  if (l && l.status === "working") return {cls: "busy", label: `Transcribing ${Math.round(100 * (l.progress || 0))}%`, wait: true};
  if (l && l.status === "error") return {cls: "warn", label: "Transcription failed", wait: true};
  return {cls: "", label: "Waiting for PC", wait: true};
}

/* ================= list ================= */
function filtered() {
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  let list = entries();
  if (state.view === "idea" || state.view === "recording") list = list.filter(e => e.kind === state.view);
  if (state.cat && state.cat.startsWith("status:")) list = list.filter(e => e.kind === "idea" && (e.status || "new") === state.cat.slice(7));
  else if (state.cat) list = list.filter(e => e.category === state.cat);
  if (terms.length) list = list.filter(e => { const t = searchText(e); return terms.every(w => t.includes(w)); });
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function highlight(text, terms) {
  let h = esc(text);
  for (const w of terms) {
    if (w.length < 2) continue;
    h = h.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), m => `<mark>${m}</mark>`);
  }
  return h;
}
function snippet(e, terms) {
  const plainSummary = String(e.summary || "").replace(/^\s*#{1,4}\s+/gm, "").replace(/^\s*[-*]\s*\[( |x|X)\]\s+/gm, "• ").replace(/\*\*/g, "").replace(/\n+/g, " ");
  const src = [e.text, plainSummary, transcriptText(e, {times: false}), e.notes].filter(Boolean).join(" · ");
  if (!src) return "";
  if (!terms.length) return src.slice(0, 220);
  const n = norm(src), i = Math.min(...terms.map(w => { const k = n.indexOf(w); return k < 0 ? Infinity : k; }));
  if (!isFinite(i)) return src.slice(0, 220);
  const s = Math.max(0, i - 70);
  return (s ? "…" : "") + src.slice(s, s + 220);
}
function renderChips() {
  const el = $("#chips");
  if (state.view === "actions") { el.innerHTML = ""; return; }
  const base = entries().filter(e => state.view === "all" || e.kind === state.view);
  const chip = (key, label, n) => `<button class="chip" data-cat="${esc(key)}" aria-pressed="${state.cat === key}">${esc(label)}<span class="n">${n}</span></button>`;
  let h = chip("", "All", base.length);
  for (const c of cats()) { const n = base.filter(e => e.category === c).length; if (n || state.cat === c) h += chip(c, c, n); }
  if (state.view === "idea") for (const [k, l] of IDEA_STATUS) { const n = base.filter(e => (e.status || "new") === k).length; if (n) h += chip("status:" + k, l, n); }
  el.innerHTML = h;
  el.onclick = ev => { const b = ev.target.closest(".chip"); if (!b) return; state.cat = b.dataset.cat || null; render(); };
}
function itemHtml(e, terms) {
  const st = e.kind === "recording" || e.audio ? recStatus(e) : null;
  const subs = [fmtDate(e.createdAt)];
  if (e.audio && e.audio.duration) subs.push(clock(e.audio.duration));
  const pills = [];
  if (e.kind === "idea") pills.push(`<span class="st idea-${esc(e.status || "new")}">${esc(IDEA_STATUS_LABEL[e.status || "new"])}</span>`);
  if (st && (e.kind === "recording" || st.wait)) pills.push(`<span class="st ${st.cls}">${esc(st.label)}</span>`);
  if (e.kind === "recording" && e.type && TYPES[e.type]) subs.push(TYPES[e.type].label);
  if (e.category) subs.push(e.category);
  const open = actionsOf(e).filter(a => !a.done).length;
  if (open) pills.push(`<span class="st warn">${open} open action${open > 1 ? "s" : ""}</span>`);
  const sn = snippet(e, terms);
  return `<button class="item" data-id="${esc(e.id)}">
    <span class="kind ${e.kind === "recording" ? "rec" : ""}">${e.kind === "recording" ? ICON.wave : ICON.idea}</span>
    <span class="meta"><span class="t">${highlight(e.title || (e.kind === "idea" ? "Untitled idea" : "Recording"), terms)}</span>
    <span class="sub"><span>${esc(subs.join(" · "))}</span>${pills.join("")}</span>
    ${sn ? `<span class="snip">${highlight(sn, terms)}</span>` : ""}</span></button>`;
}
function render() {
  $$("#viewSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  renderChips(); renderUploads();
  const el = $("#list");
  if (state.view === "actions") return renderActions(el);
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  const list = filtered();
  if (!list.length) {
    if (!state.loaded) { el.innerHTML = `<p class="hint">Loading…</p>`; return; }
    if (entries().length) { el.innerHTML = `<div class="empty"><h2>Nothing found</h2><p>Try other words or another filter.</p></div>`; return; }
    el.innerHTML = `<div class="empty"><h2>Your ideas and conversations, in one place</h2>
      <ol class="steps"><li><span><b>New idea:</b> type it or dictate it. It is saved straight away.</span></li>
      <li><span><b>Record:</b> record a meeting or call. On the phone it keeps recording with the screen locked. Tap <b>Mark</b> at important moments.</span></li>
      <li><span>Your PC turns the recording into text, with who said what. Start <span class="kbd">Echo.bat</span> on the PC for that.</span></li>
      <li><span><b>Copy for Claude</b> gives a ready prompt for a summary with decisions and action items. Paste Claude's answer back and it becomes searchable.</span></li></ol></div>`;
    return;
  }
  let h = "", month = "";
  for (const e of list) {
    const m = new Date(e.createdAt).toLocaleDateString("en-GB", {month: "long", year: "numeric"});
    if (m !== month) { h += `<div class="month">${esc(m)}</div>`; month = m; }
    h += itemHtml(e, terms);
  }
  el.innerHTML = h;
  el.onclick = ev => { const b = ev.target.closest(".item"); if (b) openEntry(b.dataset.id); };
}
function renderActions(el) {
  const groups = entries().map(e => ({e, acts: actionsOf(e)})).filter(x => x.acts.length).sort((a, b) => (b.e.createdAt || 0) - (a.e.createdAt || 0));
  const terms = norm(state.q).split(/\s+/).filter(Boolean);
  const showDone = !!lsGet("echo.showDone", false);
  let h = `<div class="btnrow" style="padding-top:10px"><label class="toggle"><input type="checkbox" id="showDone" ${showDone ? "checked" : ""}> Show completed actions</label></div>`;
  let any = false;
  for (const {e, acts} of groups) {
    const vis = acts.filter(a => (showDone || !a.done) && (!terms.length || terms.every(w => norm(a.text).includes(w))));
    if (!vis.length) continue;
    any = true;
    h += `<div class="card actgroup"><button class="src" data-id="${esc(e.id)}">${esc(e.title || "Untitled")} · ${esc(fmtDate(e.createdAt, false))}</button>
      ${vis.map(a => `<label class="actrow ${a.done ? "done" : ""}"><input type="checkbox" data-id="${esc(e.id)}" data-line="${a.line}" ${a.done ? "checked" : ""}><span>${highlight(a.text, terms)}</span></label>`).join("")}</div>`;
  }
  if (!any) h += `<div class="empty"><h2>No open actions</h2><p>Action items appear here when you paste Claude's answer into a recording or idea. Tick them off when they are done.</p></div>`;
  el.innerHTML = h;
  el.onclick = ev => { const s = ev.target.closest(".src"); if (s) openEntry(s.dataset.id); };
  el.onchange = ev => {
    if (ev.target.id === "showDone") { lsSet("echo.showDone", ev.target.checked); return render(); }
    const cb = ev.target.closest("input[data-line]"); if (!cb) return;
    const e = getEntry(cb.dataset.id); if (!e) return;
    toggleAction(e, Number(cb.dataset.line), cb.checked); setTimeout(render, 250);
  };
}

/* ================= panels ================= */
const panel = $("#panel");
let panelClose = null;
function showPanel(title, bodyHtml, {right = "", onClose = null, raw = false} = {}) {
  panel.innerHTML = raw ? bodyHtml : `<div class="phead"><div class="wrap"><button class="iconbtn" data-act="close" aria-label="Back">${ICON.back}</button><h2>${esc(title)}</h2>${right}</div></div><div class="wrap pbody">${bodyHtml}</div>`;
  delete panel.dataset.id; panel.hidden = false; panel.scrollTop = 0; document.body.style.overflow = "hidden";
  panelClose = onClose;
  return panel;
}
function closePanel() {
  const fn = panelClose; panelClose = null;
  if (fn) fn();
  delete panel.dataset.id;
  panel.hidden = true; panel.innerHTML = ""; panel.onclick = panel.oninput = panel.onchange = null; document.body.style.overflow = "";
  render();
}
window.echoBack = () => {
  if (!panel.hidden) { if (recorder) { toast("Stop the recording first, or use the Home button: recording continues."); return true; } closePanel(); return true; }
  return false;
};
const catSelect = (cur, id = "cat") => `<select id="${id}"><option value="">No category</option>${cats().map(c => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
const typeSelect = (cur, id = "type") => `<select id="${id}">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>`;
function openEntry(id) { const e = getEntry(id); if (!e) return; if (e.kind === "idea") openIdea(e); else openRecording(e); }

/* ================= dictation ================= */
let recog = null;
async function dictateInto(textarea, btn) {
  const lang = setting("dictLang", "nl-NL");
  if (native()) {
    btn.disabled = true;
    const p = waitNative("dictation");
    nativeCall("dictate", lang);
    const r = await p; btn.disabled = false;
    if (r.text) { insertText(textarea, r.text); textarea.dispatchEvent(new Event("input", {bubbles: true})); }
    else if (r.error) toast(r.error);
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Dictation is not available in this browser. Use Chrome, or the Echo app on your phone."); return; }
  if (recog) { recog.stop(); return; }
  recog = new SR(); recog.lang = lang; recog.continuous = true; recog.interimResults = true;
  const before = textarea.value; let finalText = "";
  btn.classList.add("primary"); btn.lastChild.textContent = " Stop dictation";
  recog.onresult = ev => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript + " ";
      else interim += ev.results[i][0].transcript;
    }
    textarea.value = (before ? before.replace(/\s*$/, " ") : "") + finalText + interim;
    textarea.dispatchEvent(new Event("input", {bubbles: true}));
  };
  recog.onerror = ev => { if (ev.error !== "no-speech" && ev.error !== "aborted") toast("Dictation stopped: " + ev.error); };
  recog.onend = () => { recog = null; btn.classList.remove("primary"); btn.lastChild.textContent = " Dictate"; };
  recog.start();
}
function insertText(ta, text) {
  const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? ta.value.length;
  const pre = ta.value.slice(0, s), sep = pre && !/\s$/.test(pre) ? " " : "";
  ta.value = pre + sep + text + ta.value.slice(e);
}

/* ================= ideas ================= */
function newIdea({dictate = false} = {}) {
  const e = {id: uid(), kind: "idea", title: "", text: "", status: "new", category: state.cat && !state.cat.startsWith("status:") ? state.cat : "", tags: [], createdAt: Date.now()};
  openIdea(e, {isNew: true, dictate});
}
function ideaTitle(text) { const first = String(text || "").trim().split(/\n|(?<=[.!?])\s/)[0] || ""; return first.length > 70 ? first.slice(0, 67).trim() + "…" : first; }
function openIdea(e, {isNew = false, dictate = false} = {}) {
  const save = () => {
    if (!$("#itext", panel)) return false; // another screen is open by now
    const text = $("#itext", panel).value, title = $("#ititle", panel).value.trim();
    if (!text.trim() && !title && !e.audio) return false;
    e.text = text; e.title = title || ideaTitle(text); e.autoTitle = !title;
    e.category = $("#cat", panel).value; e.tags = $("#tags", panel).value.split(",").map(s => s.trim()).filter(Boolean);
    putEntry(e, {quiet: true}); return true;
  };
  const autosave = debounce(() => { if (!panel.hidden) save(); }, 700);
  const st = e.audio ? recStatus(e) : null;
  showPanel(isNew ? "New idea" : "Idea", `
    <input class="titlein" id="ititle" placeholder="Title (optional)" value="${esc(e.autoTitle ? "" : e.title)}">
    <div class="field"><textarea id="itext" class="big" placeholder="What's the idea?">${esc(e.text)}</textarea></div>
    <div class="btnrow"><button class="btn" id="dictBtn">${ICON.mic} Dictate</button>${isNew ? `<button class="btn" id="voiceBtn">${ICON.wave} Record voice note</button>` : ""}</div>
    ${e.audio ? `<div class="card"><div class="statusline"><span class="st ${st.cls}" id="rst">${esc(st.label)}</span><span class="hint">Voice note${e.audio.duration ? " · " + clock(e.audio.duration) : ""}. The text is added when your PC has transcribed it.</span></div><div id="player"></div></div>` : ""}
    <div class="field"><span class="lbl">Status</span><div class="seg small" id="istatus">${IDEA_STATUS.map(([k, l]) => `<button data-st="${k}" aria-pressed="${(e.status || "new") === k}">${l}</button>`).join("")}</div></div>
    <div class="two"><div class="field"><label for="cat">Category</label>${catSelect(e.category)}</div>
    <div class="field"><label for="tags">Tags</label><input id="tags" placeholder="comma separated" value="${esc((e.tags || []).join(", "))}"></div></div>
    ${claudeCard(e)}
    ${isNew ? "" : `<p class="hint">Created ${esc(fmtDate(e.createdAt))}.</p><div class="btnrow"><button class="btn danger" id="del">${ICON.trash} Delete idea</button></div>`}`,
    {right: `<button class="btn primary" data-act="done">Done</button>`, onClose: save});
  if (e.audio) { panel.dataset.id = e.id; panel.dataset.hasTranscript = e.transcript && e.transcript.segments ? "1" : ""; }
  const ta = $("#itext", panel);
  if (isNew && !dictate) setTimeout(() => ta.focus(), 50);
  if (dictate) setTimeout(() => $("#dictBtn", panel).click(), 150);
  if (e.audio && e.audio.uploaded) mountPlayer(e, $("#player", panel));
  panel.oninput = ev => { if (ev.target.id === "answer") return; autosave(); };
  panel.onchange = ev => { if (ev.target.id === "cat" || ev.target.id === "tags") autosave(); };
  panel.onclick = async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.act === "close" || b.dataset.act === "done") { if (b.dataset.act === "done" && !ta.value.trim() && !$("#ititle", panel).value.trim() && !e.audio) toast("Nothing to save."); return closePanel(); }
    if (b.id === "dictBtn") return dictateInto(ta, b);
    if (b.id === "voiceBtn") { const pre = {text: ta.value, title: $("#ititle", panel).value.trim(), category: $("#cat", panel).value}; panelClose = null; closePanel(); startRecorder("idea", pre); return; }
    if (b.dataset.st) { e.status = b.dataset.st; $$("#istatus button", panel).forEach(x => x.setAttribute("aria-pressed", String(x === b))); if (save() === false) e.status = b.dataset.st; return; }
    if (b.id === "del") return confirmDelete(e, b);
    if (await claudeClick(e, b, save)) return;
  };
}

/* ================= Claude hand-off ================= */
function claudeCard(e) {
  const has = !!(e.summary && e.summary.trim());
  const canCopy = e.kind === "idea" || (e.transcript && e.transcript.segments);
  return `<div class="card" id="claude"><h3>${ICON.spark.replace("<svg", '<svg style="width:18px;height:18px;vertical-align:-3px"')} Claude</h3>
    ${canCopy ? `<p class="hint">${e.kind === "idea" ? "Copies the idea with a request to develop it." : "Copies the transcript with instructions for this type of conversation."} Paste it in a Claude chat, then paste Claude's answer below.</p>
    <div class="btnrow"><button class="btn primary grow" data-claude="copy">${ICON.copy} Copy for Claude</button>${native() ? `<button class="btn grow" data-claude="share">${ICON.share} Share to Claude app</button>` : ""}</div>`
    : `<p class="hint">Available as soon as the transcript is ready.</p>`}
    ${has ? `<div id="answerView">${renderSummary(e)}</div><div class="btnrow"><button class="btn" data-claude="edit">Edit answer</button></div>` : ""}
    <div class="field" id="answerBox" ${has ? "hidden" : ""}><label for="answer">Claude's answer</label><textarea id="answer" rows="6" placeholder="Paste Claude's answer here">${esc(e.summary || "")}</textarea>
    <div class="btnrow"><button class="btn" data-claude="save">Save answer</button></div></div></div>`;
}
function renderSummary(e) {
  return `<div class="summary">${String(e.summary || "").split("\n").map((line, i) => {
    const m = line.match(/^\s*[-*]\s*\[( |x|X)\]\s+(.+)$/);
    if (m) return `<label class="actrow ${m[1] !== " " ? "done" : ""}"><input type="checkbox" data-line="${i}" ${m[1] !== " " ? "checked" : ""}><span>${esc(m[2])}</span></label>`;
    const h = line.match(/^\s*#{1,4}\s+(.*)$/);
    if (h) return `<span class="h">${esc(h[1])}</span>`;
    return esc(line.replace(/\*\*(.+?)\*\*/g, "$1")) + "\n";
  }).join("")}</div>`;
}
function buildPrompt(e) {
  const lang = setting("outLang", "Dutch");
  const head = [];
  if (e.kind === "idea") {
    head.push(IDEA_TASK, "", ACTION_RULE, `Write your answer in ${lang}.`, "", `Idea${e.category ? " (" + e.category + ")" : ""}: ${e.title || ""}`, "", e.text || transcriptText(e, {times: false}));
    return head.join("\n");
  }
  const t = TYPES[e.type] || TYPES.meeting;
  const names = spkKeys(e).map(k => spkName(e, k));
  head.push(`Below is the automatic transcript of a recorded conversation.`, "");
  head.push(`Type: ${t.label}`);
  head.push(`Title: ${e.title || "Recording"}`);
  head.push(`Date: ${fmtDate(e.createdAt)}${e.audio && e.audio.duration ? " · duration " + clock(e.audio.duration) : ""}`);
  if (names.length) head.push(`Speakers: ${names.join(", ")} (labels come from automatic speaker detection and can be wrong)`);
  if (e.markers && e.markers.length) head.push(`Moments I marked as important during the conversation:\n${e.markers.map(m => `- ${tstamp(m.t / 1000)}${m.note ? " " + m.note : ""}`).join("\n")}`);
  if (e.notes) head.push(`My own notes: ${e.notes}`);
  head.push("", t.task, "", ACTION_RULE,
    `Pay extra attention to the marked moments.`,
    `The transcript is made by speech recognition, so names, numbers and technical terms may be misheard. Where something looks wrong, say so instead of guessing.`,
    `Write your answer in ${lang}.`, "", "Transcript:", transcriptText(e));
  return head.join("\n");
}
async function copyText(text) {
  if (native() && nativeCall("copyText", text) !== null) return true;
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
}
async function claudeClick(e, b, beforeSave) {
  const c = b.dataset.claude; if (!c) return false;
  if (c === "copy") {
    if (beforeSave) beforeSave();
    const text = buildPrompt(e);
    if (await copyText(text)) toast(`Copied (${Math.round(text.length / 1000)}k characters). Paste it in a Claude chat.`, 4500);
    else toast("Could not copy. Try again.");
  } else if (c === "share") {
    if (beforeSave) beforeSave();
    nativeCall("shareText", buildPrompt(e), e.title || "Echo");
  } else if (c === "edit") {
    $("#answerView", panel).hidden = true; b.parentElement.hidden = true; $("#answerBox", panel).hidden = false; $("#answer", panel).focus();
  } else if (c === "save") {
    e.summary = $("#answer", panel).value.trim();
    if (beforeSave) beforeSave(); else putEntry(e, {quiet: true});
    const n = actionsOf(e).length;
    toast(e.summary ? `Answer saved${n ? `, with ${n} action item${n > 1 ? "s" : ""}` : ""}.` : "Answer removed.");
    $("#claude", panel).outerHTML = claudeCard(e);
    wireSummaryChecks(e);
  }
  return true;
}
function wireSummaryChecks(e) {
  const v = $("#answerView", panel); if (!v) return;
  v.onchange = ev => { const cb = ev.target.closest("input[data-line]"); if (!cb) return; toggleAction(e, Number(cb.dataset.line), cb.checked); cb.closest(".actrow").classList.toggle("done", cb.checked); };
}

/* ================= audio playback ================= */
async function mountPlayer(e, el, {onTime} = {}) {
  if (!el) return null;
  el.innerHTML = `<p class="hint">Loading audio…</p>`;
  try {
    let src = null;
    const local = await localAudio(e);
    if (local) src = URL.createObjectURL(local);
    else {
      const it = await g("GET", e.audio.itemId ? `/me/drive/items/${e.audio.itemId}` : itemRef(`${RECS}/${e.audio.name}`));
      src = it["@microsoft.graph.downloadUrl"];
    }
    el.innerHTML = `<audio controls preload="metadata" src="${esc(src)}"></audio>`;
    const a = $("audio", el);
    if (onTime) a.ontimeupdate = () => onTime(a.currentTime);
    return a;
  } catch (err) { el.innerHTML = `<p class="hint">The audio could not be loaded${err && err.code === "offline" ? " (offline)" : ""}.</p>`; return null; }
}
async function localAudio(e) {
  if (e.audio && e.audio.uploaded) return null;
  const b = await idb.get("audio", e.id);
  return b instanceof Blob ? b : null;
}

/* ================= recording detail ================= */
function openRecording(e) {
  const st = recStatus(e);
  const segs = (e.transcript && e.transcript.segments) || [];
  const keys = spkKeys(e);
  const markT = (e.markers || []).map(m => m.t / 1000);
  const tr = segs.length ? segs.map((s, i) => {
    const ki = keys.indexOf(s.speaker);
    const marked = markT.some(t => t >= s.start - 2 && t <= (s.end || s.start) + 2);
    return `<div class="seg-line ${marked ? "marked" : ""}" data-i="${i}"><button class="ts" data-t="${s.start}">${tstamp(s.start)}</button><span>${s.speaker ? `<span class="who spk${ki % 6}">${esc(spkName(e, s.speaker))}</span>` : ""}${esc(s.text)}</span></div>`;
  }).join("") : "";
  const words = segs.reduce((n, s) => n + String(s.text || "").split(/\s+/).filter(Boolean).length, 0);
  showPanel(e.title || "Recording", `
    <input class="titlein" id="rtitle" value="${esc(e.title || "")}" placeholder="Title">
    <div class="statusline"><span class="st ${st.cls}" id="rst">${esc(st.label)}</span><span class="hint">${esc(fmtDate(e.createdAt))}${e.audio.duration ? " · " + clock(e.audio.duration) : ""}${e.transcript && e.transcript.language ? " · " + esc((LANGS.find(l => l[0] === e.transcript.language) || [0, e.transcript.language])[1]) : ""}${words ? ` · ${words.toLocaleString("en-GB")} words` : ""}</span></div>
    <div id="rhelp">${statusHelp(e, st)}</div>
    <div id="player"></div>
    <div class="two"><div class="field"><label for="type">Type of conversation</label>${typeSelect(e.type || "meeting")}</div><div class="field"><label for="cat">Category</label>${catSelect(e.category)}</div></div>
    ${keys.length ? `<div class="card"><h3>Who is who</h3><p class="hint">Give the speakers a name. Two labels for the same person? Give them the same name.</p><div class="speakers">${keys.map((k, i) => `<div class="row"><span class="who spk${i % 6}">Speaker ${i + 1}</span><input data-spk="${esc(k)}" value="${esc((e.speakers || {})[k] || "")}" placeholder="Name"><small>${clock(segs.filter(s => s.speaker === k).reduce((n, s) => n + ((s.end || s.start) - s.start) * 1000, 0))}</small></div>`).join("")}</div></div>` : ""}
    ${claudeCard(e)}
    ${(e.markers || []).length ? `<div class="card"><h3>Marked moments</h3><div class="markers">${e.markers.map(m => `<button data-t="${m.t / 1000}"><span class="mono">${tstamp(m.t / 1000)}</span><span>${esc(m.note || "Marked")}</span></button>`).join("")}</div></div>` : ""}
    <div class="field"><label for="notes">My notes</label><textarea id="notes" rows="3" placeholder="Anything to remember about this conversation">${esc(e.notes || "")}</textarea></div>
    ${segs.length ? `<div class="card"><h3>Transcript</h3><div class="transcript" id="transcript">${tr}</div></div>` : ""}
    <details><summary>More</summary><div class="form" style="margin-top:12px">
      <div class="field"><label for="tags">Tags</label><input id="tags" placeholder="comma separated" value="${esc((e.tags || []).join(", "))}"></div>
      ${e.audio.uploaded ? `<div class="two"><div class="field"><label for="lang">Language</label><select id="lang">${LANGS.map(([k, l]) => `<option value="${k}" ${k === (e.lang || "auto") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="nspk">Number of speakers</label><select id="nspk">${[[0, "Detect automatically"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6 or more"]].map(([k, l]) => `<option value="${k}" ${k === (e.nspk || 0) ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="btnrow"><button class="btn" id="retrans">${ICON.redo} Transcribe again</button>${segs.length ? `<button class="btn" id="dlTxt">${ICON.download} Transcript as text file</button>` : ""}</div>` : ""}
      <p class="hint">Audio file: OneDrive › ${esc(ROOT.replace(/\//g, " › "))} › ${esc(RECS)} › ${esc(e.audio.name || "")}</p>
      <div class="btnrow"><button class="btn danger" id="del">${ICON.trash} Delete recording</button></div></div></details>`,
    {onClose: () => saveMeta()});
  panel.dataset.id = e.id; panel.dataset.hasTranscript = segs.length ? "1" : "";
  const saveMeta = () => {
    if (panel.dataset.id !== e.id || !$("#notes", panel)) return;
    e.title = $("#rtitle", panel).value.trim() || e.title;
    e.type = $("#type", panel).value; e.category = $("#cat", panel).value;
    e.notes = $("#notes", panel).value; e.tags = $("#tags", panel).value.split(",").map(s => s.trim()).filter(Boolean);
    const sp = {...(e.speakers || {})}; $$("input[data-spk]", panel).forEach(i => { if (i.value.trim()) sp[i.dataset.spk] = i.value.trim(); else delete sp[i.dataset.spk]; });
    e.speakers = sp;
    if ($("#lang", panel)) { e.lang = $("#lang", panel).value; e.nspk = Number($("#nspk", panel).value); }
    putEntry(e, {quiet: true});
  };
  const autosave = debounce(() => { if (!panel.hidden) saveMeta(); }, 800);
  let audioEl = null;
  mountPlayer(e, $("#player", panel), {onTime: t => highlightTime(t)}).then(a => audioEl = a);
  let lastI = -1;
  function highlightTime(t) {
    const i = segs.findIndex(s => t >= s.start && t < (s.end || s.start + 1));
    if (i === lastI) return; lastI = i;
    $$(".seg-line.on", panel).forEach(x => x.classList.remove("on"));
    const el = i >= 0 && $(`.seg-line[data-i="${i}"]`, panel); if (el) el.classList.add("on");
  }
  wireSummaryChecks(e);
  panel.oninput = ev => { if (ev.target.id === "answer") return; autosave(); };
  panel.onchange = ev => { if (["type", "cat", "lang", "nspk", "tags"].includes(ev.target.id)) autosave(); };
  panel.onclick = async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.act === "close") return closePanel();
    if (b.dataset.t !== undefined) { if (audioEl) { audioEl.currentTime = Math.max(0, Number(b.dataset.t) - 1); audioEl.play().catch(() => {}); } else toast("The audio is still loading."); return; }
    if (b.id === "del") return confirmDelete(e, b);
    if (b.id === "retrans") { saveMeta(); return retranscribe(e, b); }
    if (b.id === "dlTxt") { saveMeta(); return downloadText(`${safeSeg(e.title)}.txt`, transcriptText(e)); }
    if (b.id === "retry") { b.disabled = true; delete state.uploads[e.id]; runUploads(); return closePanel(); }
    if (await claudeClick(e, b, saveMeta)) return;
  };
}
function statusHelp(e, st) {
  if (!st.wait) return "";
  if (!e.audio.uploaded) {
    const up = state.uploads[e.id];
    if (up && up.error) return `<div class="notice"><span>Upload failed: ${esc(up.error)}. The recording is safe on this device.</span> <button class="btn" id="retry">Try again</button></div>`;
    return `<p class="hint">The recording is safe on this device and is uploaded to OneDrive as soon as there is internet.</p>`;
  }
  const l = state.live[e.id];
  if (l && l.status === "error") return `<div class="notice">The PC could not transcribe this recording: ${esc(l.error || "unknown error")}. Use “Transcribe again” under More to retry.</div>`;
  if (l && l.status === "working") return `<div class="pbar"><span style="width:${Math.round(100 * (l.progress || 0))}%"></span></div><p class="hint">${esc(l.step || "Your PC is transcribing this recording.")}</p>`;
  return `<p class="hint">${pcSeen() ? "Your PC will pick this up shortly." : "Start Echo on your PC to transcribe this recording. It is done there, for free and without sending your audio anywhere."}</p>`;
}
function downloadText(name, text) {
  if (native()) { nativeCall("saveText", text, name); return; }
  const u = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"})), a = document.createElement("a");
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
}
function confirmDelete(e, b) {
  const row = b.parentElement;
  row.innerHTML = `<div class="confirm"><span>Delete “${esc(e.title || "this item")}”${e.audio ? " and its audio" : ""}? It goes to the OneDrive recycle bin.</span><button class="btn" id="no">Keep</button><button class="btn danger" id="yes">Delete</button></div>`;
  $("#no", row).onclick = () => { closePanel(); openEntry(e.id); };
  $("#yes", row).onclick = async () => {
    e.deleted = true; panelClose = null; putEntry(e); closePanel();
    if (e.audio) {
      const base = e.audio.name ? e.audio.name.replace(/\.[^.]+$/, "") : "";
      if (native()) nativeCall("remove", e.id);
      await idb.del("audio", e.id);
      if (e.audio.uploaded && base) {
        try { await Promise.all([e.audio.name, base + ".transcript.json", base + ".request.json"].map(n => deletePath(`${RECS}/${n}`))); }
        catch (err) { toast("Removed from Echo; the audio file could not be removed from OneDrive yet."); }
      }
    }
    toast("Deleted.");
  };
}
async function retranscribe(e, b) {
  b.disabled = true;
  try {
    const base = e.audio.name.replace(/\.[^.]+$/, "");
    await writeRequest(e);
    await deletePath(`${RECS}/${base}.transcript.json`);
    delete e.transcript; delete state.live[e.id]; putEntry(e, {quiet: true});
    toast("Sent back to your PC for transcription.");
    closePanel();
  } catch (err) { b.disabled = false; toast(errText(err)); }
}
function errText(e) {
  if (!e) return "Something went wrong.";
  if (e.code === "offline") return "You are offline. Try again when you have internet.";
  return e.message || String(e);
}

/* ================= recorder ================= */
let recorder = null; // {mode: "native"|"web", id, kind, startedAt, markers, ...}
function startRecorder(kind = "recording", pre = null) {
  if (recorder) return showRecorderPanel();
  const n = native();
  const st = n ? nativeCall("status") : null;
  if (st && st.state && st.state !== "idle") { // a recording is already running in the background
    const same = lsGet("echo.recId", "") === st.id;
    recorder = {mode: "native", id: st.id, kind: same ? lsGet("echo.recKind", "recording") : "recording", markers: same ? lsGet("echo.recMarkers", []) : [], running: true, startedAt: st.startedAt || Date.now(), title: same ? lsGet("echo.recTitle", "") : "", text: "", type: same ? lsGet("echo.recType", "meeting") : "meeting", category: "", nspk: 0};
    return showRecorderPanel();
  }
  recorder = {mode: n ? "native" : "web", id: uid(), kind, markers: [], running: false, title: (pre && pre.title) || "", text: (pre && pre.text) || "", type: kind === "idea" ? "memo" : setting("lastType", "meeting"), category: (pre && pre.category) || (state.cat && !state.cat.startsWith("status:") ? state.cat : ""), nspk: 0};
  showRecorderPanel();
}
function recElapsed() {
  if (!recorder) return 0;
  if (recorder.mode === "native") { const s = nativeCall("status"); recorder.level = s ? s.level : 0; recorder.paused = s && s.state === "paused"; return s ? s.elapsedMs : 0; }
  const r = recorder; if (!r.t0) return 0;
  return (r.pausedAt ? r.pausedAt : performance.now()) - r.t0 - (r.pausedTotal || 0);
}
function showRecorderPanel() {
  const r = recorder;
  const voice = r.kind === "idea";
  showPanel("", `<div class="recorder">
    <div class="phead"><div class="wrap"><button class="iconbtn" data-act="close" aria-label="Back">${ICON.back}</button><h2>${voice ? "Voice note" : "Record a conversation"}</h2></div></div>
    <div class="recbody">
      <div class="recstate" id="rstate"><span class="dot"></span><span id="rstateText">Ready</span></div>
      <div class="clock" id="rclock">0:00</div>
      <div class="meter" id="meter">${"<span></span>".repeat(24)}</div>
      <div class="recform">
        ${voice ? "" : `<div class="field"><label for="rtitle">Title</label><input id="rtitle" value="${esc(r.title || "")}" placeholder="For example: call with supplier"></div>
        <div class="two"><div class="field"><label for="type">Type</label>${typeSelect(r.type)}</div>
        <div class="field"><label for="nspk">Speakers</label><select id="nspk">${[[0, "Detect"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6+"]].map(([k, l]) => `<option value="${k}" ${k === (r.nspk || 0) ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>`}
      </div>
      <div class="reclist" id="marks"></div>
      <p class="hint" id="rhint">${r.mode === "native" ? "Recording continues when the screen locks or you switch apps." : "Keep this window open while recording."}</p>
    </div>
    <div class="reccontrols" id="rctl"></div></div>`, {raw: true});
  drawMarks(); drawControls(); tick();
  panel.oninput = ev => { if (ev.target.id === "rtitle") { r.title = ev.target.value; lsSet("echo.recTitle", r.title); } };
  panel.onchange = ev => {
    if (ev.target.id === "type") { r.type = ev.target.value; lsSet("echo.recType", r.type); }
    if (ev.target.id === "nspk") r.nspk = Number(ev.target.value);
    if (ev.target.dataset.mk !== undefined) { r.markers[Number(ev.target.dataset.mk)].note = ev.target.value; lsSet("echo.recMarkers", r.markers); }
  };
  panel.onclick = async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.act === "close") {
      if (r.running) { closePanelKeep(); toast("Still recording. Tap Record to go back."); return; }
      recorder = null; return closePanel();
    }
    if (b.id === "rStart") return recStart(b);
    if (b.id === "rPause") return recPause();
    if (b.id === "rMark") return recMark();
    if (b.id === "rStop") return recStop(b);
  };
}
function closePanelKeep() { delete panel.dataset.id; panel.hidden = true; panel.innerHTML = ""; panel.onclick = panel.oninput = panel.onchange = null; document.body.style.overflow = ""; render(); }
function drawControls() {
  const r = recorder, el = $("#rctl", panel); if (!el) return;
  if (!r.running) { el.innerHTML = `<button class="rbtn start" id="rStart"><span class="c"><span></span></span>Start</button>`; return; }
  el.innerHTML = `<button class="rbtn" id="rPause"><span class="c">${r.paused ? ICON.play : ICON.pause}</span>${r.paused ? "Resume" : "Pause"}</button>
    <button class="rbtn stop" id="rStop"><span class="c">${ICON.stop}</span>Stop</button>
    <button class="rbtn" id="rMark"><span class="c">${ICON.flag}</span>Mark</button>`;
}
function drawMarks() {
  const el = $("#marks", panel); if (!el) return;
  el.innerHTML = recorder.markers.map((m, i) => `<div class="mk"><span class="mono">${tstamp(m.t / 1000)}</span><input data-mk="${i}" value="${esc(m.note || "")}" placeholder="What was important? (optional)"></div>`).join("");
}
let tickTimer = null;
function tick() {
  clearTimeout(tickTimer);
  if (!recorder) return;
  const ms = recElapsed();
  const c = $("#rclock", panel);
  if (c) {
    c.textContent = clock(ms);
    const wasPaused = recorder.paused;
    const stEl = $("#rstate", panel);
    stEl.classList.toggle("on", recorder.running && !recorder.paused);
    $("#rstateText", panel).textContent = !recorder.running ? "Ready" : recorder.paused ? "Paused" : "Recording";
    const active = recorder.running && !recorder.paused;
    const lvl = active ? (recorder.mode === "web" ? webLevel() : (recorder.level || 0)) : 0;
    const lv = recorder.levels || (recorder.levels = new Array(24).fill(0));
    lv.push(lvl); lv.shift();
    $$("#meter span", panel).forEach((b, i) => b.style.height = (6 + Math.round(Math.min(1, Math.sqrt(lv[i]) * 1.2) * 42)) + "px");
    if (wasPaused !== recorder.pausedDrawn) { recorder.pausedDrawn = wasPaused; drawControls(); }
  }
  tickTimer = setTimeout(tick, 150);
}
async function recStart(b) {
  const r = recorder; b.disabled = true;
  r.title = ($("#rtitle", panel) || {}).value || r.title || "";
  if (r.mode === "native") {
    let res = nativeCall("startRecording", r.id);
    if (res === "need-permission") {
      const p = await waitNative("permission", 60000);
      if (!p.granted) { b.disabled = false; toast("Echo needs microphone access to record. Allow it in Android settings › Apps › Echo › Permissions."); return; }
      res = nativeCall("startRecording", r.id);
    }
    if (res !== "ok") { b.disabled = false; toast("Could not start recording: " + (res || "unknown error")); return; }
  } else {
    try { await webStart(r); }
    catch (err) { b.disabled = false; toast(err && err.name === "NotAllowedError" ? "Allow microphone access to record." : "Could not start recording: " + errText(err)); return; }
  }
  r.running = true; r.startedAt = Date.now();
  lsSet("echo.recId", r.id); lsSet("echo.recKind", r.kind); lsSet("echo.recMarkers", []); lsSet("echo.recTitle", r.title); lsSet("echo.recType", r.type);
  drawControls();
}
function recPause() {
  const r = recorder;
  if (r.mode === "native") { nativeCall(r.paused ? "resumeRecording" : "pauseRecording"); setTimeout(drawControls, 100); return; }
  if (r.paused) { r.pausedTotal = (r.pausedTotal || 0) + performance.now() - r.pausedAt; r.pausedAt = 0; r.mr.resume(); r.paused = false; }
  else { r.pausedAt = performance.now(); r.mr.pause(); r.paused = true; }
  drawControls();
}
function recMark() {
  const r = recorder;
  r.markers.push({t: Math.max(0, recElapsed() - 3000), note: ""});
  lsSet("echo.recMarkers", r.markers);
  drawMarks();
  const last = $("#marks .mk:last-child", panel); if (last) last.classList.add("markflash");
  nativeCall("vibrate");
}
async function recStop(b) {
  const r = recorder; b.disabled = true;
  const title = (($("#rtitle", panel) || {}).value || r.title || "").trim();
  const type = ($("#type", panel) || {}).value || r.type;
  const nspk = Number(($("#nspk", panel) || {}).value || r.nspk || 0);
  let file;
  if (r.mode === "native") {
    file = nativeCall("stopRecording");
    if (!file || !file.id) { b.disabled = false; toast("Could not stop the recording. Try again."); return; }
  } else file = await webStop(r);
  clearTimeout(tickTimer);
  const when = r.startedAt || Date.now();
  const e = {
    id: file.id || r.id, kind: r.kind, createdAt: when, category: r.category || "", tags: [], type: r.kind === "idea" ? "memo" : type,
    title: title || (r.kind === "idea" ? ideaTitle(r.text) : "Recording " + fmtDate(when)), autoTitle: !title,
    markers: r.markers.filter(m => m.t >= 0), nspk, lang: setting("defaultLang", "auto"),
    audio: {name: audioName(when, title || (r.kind === "idea" ? "Voice note" : "Recording"), file.ext || ".m4a"), duration: file.durationMs || 0, size: file.size || 0, mime: file.mime || "audio/mp4", uploaded: false}
  };
  if (r.kind === "idea") { e.status = "new"; e.text = r.text || ""; if (title) { e.title = title; e.autoTitle = false; } }
  if (r.kind !== "idea") setSetting("lastType", e.type);
  recorder = null; lsSet("echo.recId", ""); lsSet("echo.recMarkers", []); lsSet("echo.recTitle", "");
  putEntry(e);
  panelClose = null; closePanel();
  toast(r.kind === "idea" ? "Voice note saved." : "Recording saved. Uploading to OneDrive…");
  runUploads();
  if (r.kind === "idea") openIdea(e); else openRecording(e);
}
function audioName(ms, title, ext) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())} ${safeSeg(title, 60)}${ext}`;
}

/* browser recording (PC) */
let audioCtx = null, analyser = null, levelBuf = null;
async function webStart(r) {
  const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}});
  const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  r.stream = stream; r.chunks = []; r.mime = mime || "audio/webm";
  r.mr = new MediaRecorder(stream, mime ? {mimeType: mime, audioBitsPerSecond: 48000} : undefined);
  r.mr.ondataavailable = ev => { if (ev.data && ev.data.size) { r.chunks.push(ev.data); idb.set("audio", "rec-in-progress", {id: r.id, blob: new Blob(r.chunks, {type: r.mime}), startedAt: r.startedAt || Date.now(), markers: r.markers}); } };
  r.mr.start(10000);
  r.t0 = performance.now(); r.pausedTotal = 0; r.pausedAt = 0;
  try { audioCtx = audioCtx || new AudioContext(); analyser = audioCtx.createAnalyser(); analyser.fftSize = 512; levelBuf = new Uint8Array(analyser.fftSize); audioCtx.createMediaStreamSource(stream).connect(analyser); } catch {}
}
function webLevel() {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(levelBuf);
  let m = 0; for (const v of levelBuf) m = Math.max(m, Math.abs(v - 128));
  return m / 128;
}
function webStop(r) {
  return new Promise(res => {
    const dur = recElapsed();
    r.mr.onstop = async () => {
      r.stream.getTracks().forEach(t => t.stop()); analyser = null;
      const blob = new Blob(r.chunks, {type: r.mime});
      await idb.set("audio", r.id, blob); await idb.del("audio", "rec-in-progress");
      res({id: r.id, durationMs: dur, size: blob.size, mime: r.mime.split(";")[0], ext: r.mime.includes("ogg") ? ".ogg" : r.mime.includes("mp4") ? ".m4a" : ".webm"});
    };
    if (r.mr.state === "paused") r.mr.resume();
    r.mr.stop();
  });
}
async function recoverWebRecording() {
  const left = await idb.get("audio", "rec-in-progress");
  if (!left || !left.blob || !left.blob.size || getEntry(left.id)) { if (left) await idb.del("audio", "rec-in-progress"); return; }
  await idb.set("audio", left.id, left.blob); await idb.del("audio", "rec-in-progress");
  const when = left.startedAt || Date.now();
  putEntry({id: left.id, kind: "recording", createdAt: when, title: "Recording " + fmtDate(when) + " (recovered)", autoTitle: true, type: "meeting", category: "", tags: [], markers: left.markers || [], lang: setting("defaultLang", "auto"),
    audio: {name: audioName(when, "Recording", ".webm"), duration: 0, size: left.blob.size, mime: "audio/webm", uploaded: false}});
  toast("A recording that was interrupted has been recovered.");
}

/* ================= uploads ================= */
let uploadsRunning = false;
async function runUploads() {
  if (uploadsRunning || !account) return;
  uploadsRunning = true;
  try {
    const tried = new Set();
    for (;;) {
      const next = entries().find(e => e.audio && !e.audio.uploaded && !tried.has(e.id) && !(state.uploads[e.id] && state.uploads[e.id].error));
      if (!next) break;
      tried.add(next.id);
      await uploadOne(next);
    }
  } catch (err) { console.warn("uploads paused", err); }
  finally { uploadsRunning = false; renderUploads(); }
}
async function uploadOne(e) {
  const u = state.uploads[e.id] = {done: 0, total: e.audio.size || 1};
  renderUploads(); render();
  try {
    let blob = await idb.get("audio", e.id);
    if (!(blob instanceof Blob)) {
      const nf = native() ? (nativeCall("list") || []).find(f => f.id === e.id) : null;
      if (!nf) {
        // Not on this device: it was recorded on another device and is uploaded from there.
        delete state.uploads[e.id]; u.finished = true; return;
      }
      blob = await readNative(nf, u);
    }
    u.total = blob.size; u.done = 0;
    await ensureFolder(RECS);
    await writeRequest(e);
    const it = await uploadFile(RECS, e.audio.name, blob, {onProgress: (d, t) => { u.done = d; u.total = t; renderUploads(); }});
    e.audio.itemId = it && it.id; e.audio.name = (it && it.name) || e.audio.name; e.audio.size = blob.size; e.audio.uploaded = true;
    putEntry(e);
    await idb.del("audio", e.id);
    if (native()) nativeCall("remove", e.id);
    u.finished = true; delete state.uploads[e.id];
    pollTranscripts();
  } catch (err) {
    console.error(err);
    u.error = errText(err); u.finished = true;
    if (err && (err.code === "offline" || err.code === "reauth")) { delete state.uploads[e.id]; throw err; }
  } finally { renderUploads(); render(); }
}
async function readNative(nf, u) {
  const CH = 512 * 1024, parts = [];
  for (let off = 0; off < nf.size; off += CH) {
    const b64 = window.EchoAndroid.readChunk(nf.id, off, CH);
    if (!b64) throw new Error("Could not read the recording on this phone.");
    parts.push(b64ToBytes(b64));
    if (parts.length % 8 === 0) await sleep(0);
  }
  return new Blob(parts, {type: nf.mime || "audio/mp4"});
}
async function writeRequest(e) {
  const base = e.audio.name.replace(/\.[^.]+$/, "");
  const req = {id: e.id, kind: e.kind, title: e.title, language: e.lang || "auto", speakers: e.nspk || 0, createdAt: new Date(e.createdAt).toISOString(), requestedAt: new Date().toISOString()};
  await ensureFolder(RECS);
  await uploadFile(RECS, base + ".request.json", new Blob([JSON.stringify(req, null, 1)], {type: "application/json"}), {replace: true});
}
/* Keep an open recording up to date while it uploads or the PC transcribes it. */
function refreshOpenEntry() {
  const id = panel.hidden ? null : panel.dataset.id, e = id && getEntry(id);
  if (!e || !e.audio) return;
  if (e.transcript && e.transcript.segments && !panel.dataset.hasTranscript) {
    if (document.activeElement && panel.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const y = panel.scrollTop; panelClose = null; openEntry(id); panel.scrollTop = y; return;
  }
  const st = recStatus(e), a = $("#rst", panel), h = $("#rhelp", panel);
  if (a) { a.className = "st " + st.cls; a.textContent = st.label; }
  if (h) { const html = statusHelp(e, st); if (h.dataset.html !== html) { h.dataset.html = html; h.innerHTML = html; } }
}
function renderUploads() {
  refreshOpenEntry();
  const el = $("#uploads"); if (!el) return;
  const items = entries().filter(e => e.audio && !e.audio.uploaded);
  const live = items.filter(e => state.uploads[e.id] && !state.uploads[e.id].finished);
  const failed = items.filter(e => state.uploads[e.id] && state.uploads[e.id].error);
  const waitingPc = entries().filter(e => e.audio && e.audio.uploaded && !(e.transcript && e.transcript.segments) && !(state.live[e.id] && state.live[e.id].status === "error"));
  let h = "";
  if (live.length) { const u = state.uploads[live[0].id]; h += `<div class="card imp"><div class="imphead"><b>Uploading “${esc(live[0].title || "recording")}”</b><span class="mono">${Math.round(100 * (u.done || 0) / (u.total || 1))}%</span></div><div class="pbar"><span style="width:${Math.round(100 * (u.done || 0) / (u.total || 1))}%"></span></div></div>`; }
  if (failed.length) h += `<div class="notice update"><span>${failed.length} recording${failed.length > 1 ? "s" : ""} could not be uploaded yet. ${esc(state.uploads[failed[0].id].error)}</span><button class="btn" id="retryUp">Try again</button></div>`;
  if (state.pcChecked && waitingPc.length && !pcSeen() && state.loaded) h += `<div class="notice">${waitingPc.length} recording${waitingPc.length > 1 ? "s are" : " is"} waiting to be transcribed. Start <b>Echo</b> on your PC to do that.</div>`;
  el.innerHTML = h;
  const rb = $("#retryUp", el); if (rb) rb.onclick = () => { failed.forEach(e => delete state.uploads[e.id]); runUploads(); };
}

/* ================= files on the phone (recorded in the background, shared from WhatsApp) ================= */
async function syncNativeFiles() {
  if (!native()) return;
  const files = nativeCall("list") || [];
  let added = 0;
  for (const f of files) {
    const e = state.index.entries[f.id];
    if (e && e.audio && e.audio.uploaded) { nativeCall("remove", f.id); continue; }
    if (e) continue;
    const when = f.createdAt || Date.now();
    const title = f.title || (f.imported ? "Imported audio" : "Recording " + fmtDate(when));
    const mine = !f.imported && lsGet("echo.recId", "") === f.id;
    const kind = mine && lsGet("echo.recKind", "recording") === "idea" ? "idea" : "recording";
    const t2 = mine && lsGet("echo.recTitle", "") || title;
    putEntry({id: f.id, kind, status: kind === "idea" ? "new" : undefined, text: kind === "idea" ? "" : undefined, createdAt: when, title: t2, autoTitle: t2 === title && !f.title, type: kind === "idea" ? "memo" : f.imported ? "call" : (mine && lsGet("echo.recType", "")) || setting("lastType", "meeting"), category: "", tags: [], markers: mine ? lsGet("echo.recMarkers", []) : [], lang: setting("defaultLang", "auto"),
      audio: {name: audioName(when, t2, f.ext || ".m4a"), duration: f.durationMs || 0, size: f.size, mime: f.mime || "audio/mp4", uploaded: false}});
    if (mine) { lsSet("echo.recId", ""); lsSet("echo.recMarkers", []); if (recorder && recorder.id === f.id) { recorder = null; if (!panel.hidden) { panelClose = null; closePanel(); } } }
    added++;
  }
  if (added) toast(`${added} recording${added > 1 ? "s" : ""} added.`);
  runUploads();
}

/* ================= import audio files (PC drag-and-drop or file picker) ================= */
async function importFiles(files) {
  const list = [...files].filter(f => AUDIO_RE.test(f.name) || (f.type || "").startsWith("audio/"));
  if (!list.length) { toast("Only audio files can be added (m4a, mp3, wav, ogg, opus, webm)."); return; }
  for (const f of list) {
    const id = uid(), when = f.lastModified || Date.now();
    const base = f.name.replace(/\.[^.]+$/, ""), ext = (f.name.match(/\.[^.]+$/) || [".m4a"])[0].toLowerCase();
    const dur = await audioDuration(f);
    await idb.set("audio", id, f);
    putEntry({id, kind: "recording", createdAt: when, title: base, autoTitle: false, type: setting("lastType", "meeting"), category: "", tags: [], markers: [], lang: setting("defaultLang", "auto"),
      audio: {name: audioName(when, base, ext), duration: dur, size: f.size, mime: f.type || "audio/mp4", uploaded: false}});
  }
  toast(`${list.length} audio file${list.length > 1 ? "s" : ""} added. Uploading…`);
  runUploads();
}
function audioDuration(f) {
  return new Promise(res => {
    const a = new Audio(), u = URL.createObjectURL(f);
    const done = v => { URL.revokeObjectURL(u); res(v); };
    a.preload = "metadata"; a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration * 1000) : 0); a.onerror = () => done(0);
    setTimeout(() => done(0), 5000); a.src = u;
  });
}

/* ================= transcripts from the PC ================= */
const pcSeen = () => state.pc && state.pc.lastSeen && (Date.now() - Date.parse(state.pc.lastSeen) < 3 * 60 * 1000);
let pollBusy = false;
async function pollTranscripts() {
  if (pollBusy || !account || state.syncError === "reauth") return;
  pollBusy = true;
  try {
    try { const r = await readJson("transcriber.json"); state.pc = r ? r.json : null; state.pcChecked = true; } catch { }
    const waiting = entries().filter(e => e.audio && e.audio.uploaded && !(e.transcript && e.transcript.segments));
    if (!waiting.length) return;
    let folderId;
    try { folderId = await ensureFolder(RECS); } catch { return; }
    const files = {};
    let url = `/me/drive/items/${folderId}/children?$select=name,id,size,lastModifiedDateTime&$top=999`;
    while (url) { const r = await g("GET", url); for (const it of r.value || []) files[it.name] = it; url = r["@odata.nextLink"] || null; }
    for (const e of waiting) {
      const base = e.audio.name.replace(/\.[^.]+$/, "");
      const it = files[base + ".transcript.json"];
      if (!it) { delete state.live[e.id]; continue; }
      const prev = state.live[e.id];
      if (prev && prev.mod === it.lastModifiedDateTime) continue;
      const meta = await g("GET", `/me/drive/items/${it.id}`);
      const r = await fetch(meta["@microsoft.graph.downloadUrl"], {cache: "no-store"});
      if (!r.ok) continue;
      let j; try { j = await r.json(); } catch { continue; }
      if (j.status === "done" && Array.isArray(j.segments)) {
        e.transcript = {segments: j.segments.map(s => ({start: +(+s.start).toFixed(2), end: +(+s.end).toFixed(2), speaker: s.speaker || "", text: String(s.text || "").trim()})), language: j.language || "", diarized: !!j.diarized, model: j.model || "", at: j.finishedAt || new Date().toISOString()};
        if (j.duration && !e.audio.duration) e.audio.duration = Math.round(j.duration * 1000);
        if (e.kind === "idea" && !String(e.text || "").trim()) { e.text = transcriptText(e, {times: false}).replace(/^[^:]{1,30}:\s/gm, ""); if (e.autoTitle || !e.title) e.title = ideaTitle(e.text); }
        delete state.live[e.id];
        putEntry(e);
        toast(`“${e.title || "Recording"}” has been transcribed.`);
      } else state.live[e.id] = {status: j.status, progress: j.progress || 0, error: j.error || "", step: j.step || "", mod: it.lastModifiedDateTime};
    }
  } catch (err) { console.warn("transcript poll", err); }
  finally { pollBusy = false; renderUploads(); if (panel.hidden) render(); }
}

/* ================= settings ================= */
function openSettings() {
  const pc = state.pc;
  const pcLine = pc && pc.lastSeen ? (pcSeen() ? `Running on ${esc(pc.host || "your PC")}${pc.diarization ? ", with speaker detection" : ", <b>without</b> speaker detection"}.` : `Last seen ${esc(fmtDate(Date.parse(pc.lastSeen)))} on ${esc(pc.host || "your PC")}.`) : "Not started yet.";
  showPanel("Settings", `
    <div class="card"><h3>Claude</h3>
      <div class="field"><label for="outLang">Claude answers in</label><select id="outLang">${OUT_LANGS.map(l => `<option ${l === setting("outLang", "Dutch") ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <div class="card"><h3>Speech</h3>
      <div class="two"><div class="field"><label for="dictLang">Dictation language</label><select id="dictLang">${[["nl-NL", "Dutch"], ["en-GB", "English"], ["en-US", "English (US)"]].map(([k, l]) => `<option value="${k}" ${k === setting("dictLang", "nl-NL") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label for="defLang">Language of recordings</label><select id="defLang">${LANGS.map(([k, l]) => `<option value="${k}" ${k === setting("defaultLang", "auto") ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <p class="hint">“Detect automatically” works well for Dutch or English. For a conversation that mixes languages, choose the main language.</p></div>
    <div class="card"><h3>Categories</h3><div class="catlist" id="catlist">${cats().map((c, i) => `<span class="catitem">${esc(c)}<button data-rm="${i}" aria-label="Remove ${esc(c)}">${ICON.x}</button></span>`).join("")}</div>
      <div class="addrow"><input id="newCat" placeholder="New category"><button class="btn" id="addCat">Add</button></div></div>
    <div class="card"><h3>Transcriber on your PC</h3><p class="hint">${pcLine}</p>
      <p class="hint">Recordings are turned into text on your own PC with Whisper, and speakers are told apart with pyannote. Both are free and run offline.</p>
      <div class="btnrow"><a class="btn" href="pc/Echo.bat" download="Echo.bat">${ICON.download} Download Echo.bat</a></div>
      <p class="hint">Double-click <span class="kbd">Echo.bat</span> on the PC. It opens Echo in its own window and starts the transcriber next to it. The first start installs everything, which takes a while.</p></div>
    ${native() ? "" : `<div class="card"><h3>Android app</h3><p class="hint">Records with the screen locked, dictates, and takes audio shared from WhatsApp.</p><div class="btnrow"><a class="btn" href="${APK_URL}">${ICON.download} Download Echo for Android</a></div></div>`}
    <div class="card"><h3>Account</h3><p class="hint">Signed in as ${esc(account && account.username)}. Everything is stored in OneDrive › ${esc(ROOT.replace(/\//g, " › "))}.</p>
      <div class="btnrow"><button class="btn" id="signout">Sign out</button></div></div>`);
  panel.onchange = ev => {
    const id = ev.target.id;
    if (id === "outLang") setSetting("outLang", ev.target.value);
    if (id === "dictLang") setSetting("dictLang", ev.target.value);
    if (id === "defLang") setSetting("defaultLang", ev.target.value);
  };
  panel.onclick = async ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.act === "close") return closePanel();
    if (b.dataset.rm !== undefined) { const list = [...cats()]; list.splice(Number(b.dataset.rm), 1); saveCats(list); return openSettings(); }
    if (b.id === "addCat") { const v = $("#newCat", panel).value.trim(); if (!v) return; if (cats().includes(v)) return toast("That category already exists."); saveCats([...cats(), v]); return openSettings(); }
    if (b.id === "signout") { if (isBusy()) return toast("Wait until uploads and saving are finished."); await idb.clear("kv"); return msalApp.logoutRedirect({account, postLogoutRedirectUri: redirectUri()}); }
  };
}
function saveCats(list) { state.index.categories = list.length ? list : [...DEFAULT_CATS]; state.index.catsUpdatedAt = Date.now(); scheduleSave(); }

/* ================= Android app updates ================= */
async function checkAndroidUpdate() {
  const n = native(); if (!n) return;
  let installed = 0, latest = 0;
  try { installed = Number(n.versionCode()) || 0; } catch {}
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {cache: "no-store"});
    if (r.ok) latest = Number(((await r.json()).tag_name || "").replace(/\D+/g, "")) || 0;
  } catch {}
  if (latest && installed < latest) $("#notice").innerHTML = `<div class="notice update"><span>A new version of the Echo app is ready.</span><a class="btn primary" href="${APK_URL}">Install update</a></div>`;
}

/* ================= wiring ================= */
$("#viewSeg").onclick = ev => { const b = ev.target.closest("button"); if (!b) return; state.view = b.dataset.view; state.cat = null; render(); };
$("#q").oninput = debounce(ev => { state.q = ev.target.value; render(); }, 120);
$("#fabIdea").onclick = () => newIdea();
$("#fabRec").onclick = () => startRecorder("recording");
$("#btnSettings").onclick = openSettings;
$("#btnImport").onclick = () => $("#audioIn").click();
$("#audioIn").onchange = ev => { if (ev.target.files.length) importFiles(ev.target.files); ev.target.value = ""; };
let dragDepth = 0;
window.addEventListener("dragenter", ev => { if ([...(ev.dataTransfer?.types || [])].includes("Files")) { dragDepth++; $("#dropOverlay").hidden = false; } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").hidden = true; } });
window.addEventListener("dragover", ev => ev.preventDefault());
window.addEventListener("drop", ev => { ev.preventDefault(); dragDepth = 0; $("#dropOverlay").hidden = true; if (ev.dataTransfer?.files?.length && account) importFiles(ev.dataTransfer.files); });
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && !panel.hidden) { window.echoBack(); return; }
  if (!account || !panel.hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
  if (ev.key === "n") { ev.preventDefault(); newIdea(); }
  if (ev.key === "/") { ev.preventDefault(); $("#q").focus(); }
});
// Long-press "New idea" on the phone starts dictation straight away.
(() => { let t = null; const b = $("#fabIdea");
  b.addEventListener("touchstart", () => { t = setTimeout(() => { t = "fired"; newIdea({dictate: true}); }, 550); }, {passive: true});
  b.addEventListener("touchend", ev => { if (t === "fired") ev.preventDefault(); else clearTimeout(t); t = null; });
})();
let lastRefresh = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !account) return;
  syncNativeFiles();
  if (recorder && recorder.mode === "native" && panel.hidden) { const s = nativeCall("status"); if (s && s.state !== "idle") showRecorderPanel(); }
  if (Date.now() - lastRefresh > 20000) { lastRefresh = Date.now(); refreshIndex().then(() => { runUploads(); pollTranscripts(); }); }
});
setInterval(() => { if (!document.hidden && account && !state.dirty) { lastRefresh = Date.now(); refreshIndex(); } }, 120000);
setInterval(() => { if (!document.hidden && account) pollTranscripts(); }, 20000);
window.addEventListener("online", () => { runUploads(); if (state.dirty) scheduleSave(0); });
window.addEventListener("beforeunload", ev => { if (isBusy()) { ev.preventDefault(); ev.returnValue = ""; } });

/* ================= start ================= */
function gate(html) { const g0 = $("#gate"); g0.innerHTML = `<div class="box">${html}</div>`; g0.hidden = false; $("#app").hidden = true; return g0; }
function showSetup(err = "") {
  const g0 = gate(`<h1>Echo</h1><p>One-time setup: paste the Application (client) ID of your Microsoft app registration.</p>
    ${err ? `<div class="notice">${esc(err)}</div>` : ""}
    <div class="field"><label for="cid">Application (client) ID</label><input id="cid" placeholder="00000000-0000-0000-0000-000000000000" value="${esc(clientId())}"></div>
    <div class="btnrow"><button class="btn primary grow" id="cidSave">Continue</button></div>`);
  $("#cidSave", g0).onclick = () => {
    const v = $("#cid", g0).value.trim();
    if (!/^[0-9a-f-]{36}$/i.test(v)) return showSetup("That does not look like a client ID. It has 36 characters, such as 1a2b3c4d-1234-…");
    lsSet("echo.clientId", v); location.reload();
  };
}
function showSignIn(err = "") {
  const g0 = gate(`<h1>Echo</h1><p>Your ideas and recordings are stored in your own OneDrive. Sign in with your Microsoft account to continue.</p>
    ${err ? `<div class="notice">${esc(err)}</div>` : ""}
    <div class="btnrow"><button class="btn primary grow" id="signIn">Sign in with Microsoft</button></div>
    <p class="hint">Everything is stored in the folder OneDrive › ${esc(ROOT.replace(/\//g, " › "))}.</p>`);
  $("#signIn", g0).onclick = () => msalApp.loginRedirect({scopes: SCOPES, prompt: "select_account"});
}
async function start() {
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!clientId()) return showSetup();
  try { await initAuth(); }
  catch (e) { console.error(e); return showSignIn("Sign-in did not work: " + (e.errorMessage || e.message || "unknown error") + ". If this keeps happening, check that the app registration has this page as redirect URI."); }
  if (!account) return showSignIn();
  $("#gate").hidden = true; $("#app").hidden = false;
  render();
  await loadIndex();
  lastRefresh = Date.now();
  await recoverWebRecording();
  await syncNativeFiles();
  const s = native() ? nativeCall("status") : null;
  if (s && s.state && s.state !== "idle") startRecorder();
  runUploads().catch(() => {});
  pollTranscripts();
  checkAndroidUpdate();
  if (location.hash === "#record") startRecorder("recording");
  if (location.hash === "#idea") newIdea();
}
start();
})();
