/* InkDOS recents: each app's start screen lists the files opened recently, and a tab the browser reloaded comes
 * back to its file.
 *
 * iOS Safari drops a background tab and reloads it when the user comes back, which used to send every InkDOS app
 * back to its start screen and lose the work. Each app keeps, on this device and only for itself, its last 10 files:
 * where each was left, for the PDF reader a small picture of that page, and what is needed to open it again
 * directly: a copy of the file, whatever its size (plus, where the browser gives one, a link to the original so
 * Save can still overwrite it). Unsaved changes are kept too: while a file has unsaved
 * changes, its entry holds the edited version (refreshed every 45 s and when the tab goes to the background), so a
 * dropped tab loses nothing. The list shows on the app's start screen with the space it uses, a × per entry and
 * "Clear recents"; clearing warns that unsaved work goes with it and offers to save it first. After a reload the
 * file the tab had open is first and marked "Continue". Opening a file over an open one offers a new tab.
 *
 * Apps report unsaved work through InkDOSSaveProvider.isDirty() and InkDOSSaveProvider.snapshot() (→ Blob).
 * Entries unused for 60 days are dropped; pictures stay within 16 MB in all.
 *
 * Load it before runtime/platform/file-launch.js (it reads the launch hash before that script clears it); that
 * script reports launched files through InkDOSTabResume.opened. Image inputs (pictures inserted into a document) and
 * inputs marked data-inkdos-no-resume are left alone. `data-recent-host="<selector>"` puts the Recent row in that
 * element instead of the start screen's .start-card. On the script tag, `data-scroll="off"` skips the scroll place (apps that keep their own reading
 * position) and `data-ask="off"` skips the new-tab question (apps that ask on their own).
 */
(function (g) {
  'use strict';
  if (g.InkDOSTabResume || !g.document) return;
  const doc = g.document, script = doc.currentScript;
  const DB = 'inkdos-recents', WORK_MS = 45000, PER_APP = 10, MAX_PICTURE = 2 * 1024 * 1024, BUDGET = 16 * 1024 * 1024, KEEP_MS = 60 * 864e5, HANDOFF_MS = 6e4;
  const SCROLL = !(script && script.dataset.scroll === 'off'), ASK = !(script && script.dataset.ask === 'off'), HOST = script && script.dataset.recentHost || '';
  const APP = (g.location.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/');
  for (const old of ['inkdos-tab-resume', 'inkdos-tab-resume2']) { try { g.indexedDB && g.indexedDB.deleteDatabase(old); } catch (_) {} } // unreleased versions
  // A tab the browser reloaded (Safari restoring a dropped tab, or a refresh) or went back to, not one opened anew.
  const reloaded = (() => { try { const n = g.performance.getEntriesByType('navigation')[0]; if (n) return n.type === 'reload' || n.type === 'back_forward'; return g.performance.navigation && g.performance.navigation.type !== 0; } catch (_) { return false; } })();

  // ---- storage: "recent" app|name|size → {app, name, size, picture, scroll, at}; "handoff" id → {file, at}
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!g.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const r = g.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('recent'); r.result.createObjectStore('handoff'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  const req = r => new Promise(resolve => { r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); });
  const entries = st => new Promise(resolve => { const out = [], c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return resolve(out); out.push([cur.key, cur.value]); cur.continue(); }; c.onerror = () => resolve(out); });
  async function tx(names, mode, fn) {
    const d = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const t = d.transaction(names, mode); let out;
        fn(...names.map(n => t.objectStore(n))).then(v => { out = v; }, e => { try { t.abort(); } catch (_) {} reject(e); });
        t.oncomplete = () => resolve(out); t.onerror = t.onabort = () => reject(t.error);
      });
    } finally { d.close(); }
  }
  const keyOf = (name, size) => APP + '|' + name + '|' + Number(size || 0);
  function prune() {
    return tx(['recent', 'handoff'], 'readwrite', async (rec, hand) => {
      const now = Date.now(), list = (await entries(rec)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)), perApp = new Map();
      let used = 0;
      for (const [k, v] of list) {
        const n = (perApp.get(v.app) || 0) + 1; perApp.set(v.app, n);
        if (n > PER_APP || now - (v.at || 0) > KEEP_MS) { rec.delete(k); continue; }
        const size = v.picture ? v.picture.size : 0;
        if (size && used + size > BUDGET) { v.picture = null; rec.put(v, k); } else used += size;
      }
      for (const [k, v] of await entries(hand)) if (now - (Number(v && v.at) || 0) > HANDOFF_MS) hand.delete(k);
    }).catch(() => {});
  }
  // Records (or updates) the recent entry of a file; `patch` may hold picture (Blob), scroll, page.
  async function remember(name, size, patch = {}) {
    if (!name) return;
    if (patch.picture && patch.picture.size > MAX_PICTURE) delete patch.picture;
    const k = keyOf(name, size);
    try { await tx(['recent'], 'readwrite', async s => { const v = (await req(s.get(k))) || { app: APP, name, size: Number(size || 0) }; s.put({ ...v, ...patch, at: Date.now() }, k); }); } catch (_) { return; }
    prune(); render();
  }
  function recentOf(name, size) { return tx(['recent'], 'readonly', async s => (await req(s.get(keyOf(name, size)))) || null).catch(() => null); }
  function list() { return tx(['recent'], 'readonly', async s => (await entries(s)).map(e => e[1]).filter(v => v.app === APP).sort((a, b) => (b.at || 0) - (a.at || 0))).catch(() => []); }
  function forget(name, size) { return tx(['recent'], 'readwrite', async s => { s.delete(keyOf(name, size)); }).then(render).catch(() => {}); }
  const uid = () => (g.crypto && g.crypto.randomUUID ? g.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  // A file passed to a new tab is held for at most a minute and deleted as soon as that tab takes it.
  async function handOff(file) { const id = uid(); await tx(['handoff'], 'readwrite', async s => { s.put({ file, at: Date.now() }, id); }); prune(); return id; }
  function takeHandOff(id) { return tx(['handoff'], 'readwrite', async s => { const v = await req(s.get(id)); s.delete(id); return v && v.file || null; }).catch(() => null); }

  // ---- this tab
  const STATE_KEY = 'inkdos-tab-state:' + APP;
  const hash = String(g.location.hash || '');
  const handed = (/(?:^#|&)inkdos-tab=([A-Za-z0-9-]+)/.exec(hash) || [])[1] || null;
  let fileOpen = false, bypass = null, restoring = false, current = null, reopening = null, keeping = false;
  const ss = {
    get(k) { try { return JSON.parse(g.sessionStorage.getItem(k) || 'null'); } catch (_) { return null; } },
    set(k, v) { try { g.sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  };
  if (handed) { try { g.history.replaceState(g.history.state, '', g.location.pathname + g.location.search); } catch (_) {} }
  const continueWith = reloaded && !handed ? ss.get(STATE_KEY) : null;

  // ---- scroll place of the open file
  function scrollers() { return [doc.scrollingElement, ...doc.querySelectorAll('[id]')].filter(el => el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)); }
  let saveTimer = 0;
  function saveScroll(persist) {
    if (!SCROLL || !current || restoring) return;
    const pos = {};
    for (const el of scrollers()) if (el.scrollTop || el.scrollLeft) pos[el === doc.scrollingElement ? ':root' : el.id] = [el.scrollTop, el.scrollLeft];
    current.scroll = pos;
    if (persist) remember(current.name, current.size, { scroll: pos });
  }
  // The file's content appears some time after it opens; the place is put back once each scroller is big enough.
  function restoreScroll(pos) {
    if (!SCROLL || !pos || !Object.keys(pos).length) return;
    const left = new Set(Object.keys(pos)), until = Date.now() + 8000;
    const step = () => {
      for (const id of [...left]) {
        const el = id === ':root' ? doc.scrollingElement : doc.getElementById(id), p = pos[id];
        if (!el || el.scrollHeight - el.clientHeight < p[0] - 1 || el.scrollWidth - el.clientWidth < p[1] - 1) continue;
        el.scrollTop = p[0]; el.scrollLeft = p[1]; left.delete(id);
      }
      if (left.size && Date.now() < until) setTimeout(step, 250); else restoring = false;
    };
    restoring = true; setTimeout(step, 300);
  }
  // ---- unsaved changes: the entry holds the edited version while there are any
  async function keepWork() {
    const P = g.InkDOSSaveProvider;
    if (!current || keeping || !P || typeof P.isDirty !== 'function' || typeof P.snapshot !== 'function') return;
    let dirty = false; try { dirty = !!P.isDirty(); } catch (_) { return; }
    if (!dirty) { if (current.sawDirty && current.edited) { current.edited = false; remember(current.name, current.size, { edited: false }); } return; } // saved
    current.sawDirty = true; keeping = true;
    try {
      const blob = await P.snapshot();
      if (blob && current) { current.edited = true; await remember(current.name, current.size, { file: new File([blob], current.name, { type: blob.type || '' }), edited: true, editedAt: Date.now() }); }
    } catch (e) { console.warn('InkDOS: unsaved changes not kept', e); } finally { keeping = false; }
  }
  setInterval(keepWork, WORK_MS);
  g.addEventListener('pagehide', keepWork);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') keepWork(); });
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (_) {}

  doc.addEventListener('scroll', () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveScroll(false), 400); }, { capture: true, passive: true });
  g.addEventListener('pagehide', () => saveScroll(true));
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') saveScroll(true); });

  // ---- a file was opened in this tab: it becomes this tab's file and goes back to where it was left
  function opened(file) {
    if (!file || !file.name) return;
    fileOpen = true;
    // A file opened from the Recent list keeps its entry even when it is the edited version (another size).
    const from = reopening && reopening.name === file.name ? reopening : null; reopening = null;
    const id = from ? { name: from.name, size: from.size } : { name: file.name, size: file.size };
    current = { ...id, scroll: null, edited: !!(from && from.edited), sawDirty: false };
    ss.set(STATE_KEY, id);
    // What lets the Recent list open it directly: on a computer a link to the file itself, else a copy.
    const handle = g.InkDOSFileHandles && g.InkDOSFileHandles.get([file.name, file.size, file.lastModified].join('|'));
    recentOf(id.name, id.size).then(async v => {
      if (v && v.scroll) restoreScroll(v.scroll);
      if (from) return remember(id.name, id.size, {});
      const keepHandle = handle || (v && v.handle) || null;
      // The copy holds the bytes themselves: a stored File can stay a pointer to the file on disk, and once that
      // file changes the browser refuses to read it, so a reopened PDF showed only the pages already read.
      let copy = null;
      try { copy = new Blob([await file.arrayBuffer()], { type: file.type || '' }); } catch (_) {}
      remember(id.name, id.size, copy ? { file: copy, handle: keepHandle, lastModified: file.lastModified || 0, edited: false } : { handle: keepHandle });
    });
  }

  // ---- the "Recent" list on the start screen
  // Opens an entry directly when its file can be reached (link or copy), else asks for it.
  async function openRecent(it) {
    let file = null;
    try {
      // Read the copy fully first, so a copy that can no longer be read falls back to the link (or the picker).
      let bytes = null;
      if (it.file) try { bytes = await it.file.arrayBuffer(); if (it.size && !it.edited && bytes.byteLength !== it.size) bytes = null; } catch (_) { bytes = null; }
      if (bytes) {
        file = new File([bytes], it.name, { type: it.file.type || '', lastModified: (it.edited ? it.editedAt : it.lastModified) || Date.now() });
        // The copy opens without asking; a link to the original, when there is one, still lets Save overwrite it.
        if (it.handle && !it.edited) try { (g.InkDOSFileHandles || (g.InkDOSFileHandles = new Map())).set([file.name, file.size, file.lastModified].join('|'), it.handle); } catch (_) {}
      } else if (it.handle && it.handle.getFile) {
        let ok = it.handle.queryPermission ? await it.handle.queryPermission({ mode: 'read' }) : 'granted';
        if (ok !== 'granted' && it.handle.requestPermission) ok = await it.handle.requestPermission({ mode: 'read' });
        if (ok === 'granted') { file = await it.handle.getFile(); try { (g.InkDOSFileHandles || (g.InkDOSFileHandles = new Map())).set([file.name, file.size, file.lastModified].join('|'), it.handle); } catch (_) {} } // saving still writes over the original
      }
    } catch (_) { file = null; }
    const input = mainInput();
    if (!file || !input) return pick();
    reopening = it;
    try { await inject(file, input); } catch (_) { reopening = null; pick(); }
  }
  const mainInput = () => [...doc.querySelectorAll('input[type="file"]')].find(appInput);
  function pick() { const input = mainInput(), launch = g.InkDOSFileLaunch; if (!input) return; if (launch && launch.requestPicker && launch.requestPicker(input)) return; input.click(); }
  let renderSeq = 0;
  async function render() {
    const card = doc.querySelector(HOST || '.start-state .start-card'); if (!card) return;
    const seq = ++renderSeq, items = await list(); if (seq !== renderSeq) return;
    let box = card.querySelector('.inkdos-recents');
    if (!items.length) { if (box) box.remove(); return; }
    if (continueWith) items.sort((a, b) => (b.name === continueWith.name && b.size === continueWith.size) - (a.name === continueWith.name && a.size === continueWith.size));
    if (!box) {
      box = doc.createElement('section'); box.className = 'inkdos-recents';
      box.style.cssText = 'margin-top:18px;width:100%;max-width:640px;text-align:left';
      const actions = HOST ? null : card.querySelector('.start-actions'); actions ? actions.after(box) : card.append(box);
    }
    for (const img of box.querySelectorAll('img')) URL.revokeObjectURL(img.src);
    const h = doc.createElement('div'); h.textContent = 'Recent'; h.style.cssText = 'font-weight:600;font-size:13px;opacity:.75;margin:0 0 8px';
    const row = doc.createElement('div'); row.style.cssText = 'display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;-webkit-overflow-scrolling:touch';
    for (const it of items) {
      const isCurrent = continueWith && it.name === continueWith.name && it.size === continueWith.size;
      const b = doc.createElement('button'); b.type = 'button'; b.title = it.name;
      b.style.cssText = 'flex:0 0 auto;width:112px;display:grid;gap:6px;justify-items:center;padding:8px;border-radius:10px;border:1px solid ' + (isCurrent ? '#3c5cdb' : 'rgba(127,127,127,.35)') + ';background:transparent;color:inherit;font:12px/1.3 system-ui,-apple-system,sans-serif;cursor:pointer';
      const thumb = doc.createElement('div'); thumb.style.cssText = 'width:92px;height:120px;display:grid;place-items:center;border-radius:6px;overflow:hidden;background:rgba(127,127,127,.12)';
      if (it.picture) { const img = doc.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(it.picture); img.style.cssText = 'max-width:100%;max-height:100%;display:block'; thumb.append(img); }
      else { const src = (card.querySelector('.start-icon') || {}).src || (doc.querySelector('link[rel~="icon"]') || {}).href; if (src) { const i = doc.createElement('img'); i.alt = ''; i.src = src; i.style.cssText = 'width:44px;height:44px;opacity:.8'; thumb.append(i); } }
      const name = doc.createElement('span'); name.textContent = it.name; name.style.cssText = 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      b.append(thumb, name);
      if (it.edited) { const tag = doc.createElement('span'); tag.textContent = 'Unsaved changes'; tag.style.cssText = 'color:#c4362c;font-size:11px'; b.append(tag); }
      if (isCurrent) { const tag = doc.createElement('span'); tag.textContent = 'Continue'; tag.style.cssText = 'color:#3c5cdb;font-weight:600'; b.append(tag); }
      b.onclick = () => openRecent(it);
      const x = doc.createElement('span'); x.textContent = '×'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Remove from recent');
      x.style.cssText = 'justify-self:end;margin:-4px -2px -6px 0;padding:0 4px;font-size:16px;line-height:1;opacity:.6';
      x.onclick = e => { e.stopPropagation(); clearRecents([it]); };
      b.prepend(x);
      row.append(b);
    }
    const foot = doc.createElement('div'); foot.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap';
    const used = doc.createElement('span'); used.style.cssText = 'font-size:11px;color:#8a8f98'; const ul = doc.createElement('span'), uv = doc.createElement('span'); ul.textContent = 'Space used'; uv.textContent = ': ' + mb(await usage()); uv.setAttribute('data-idioma-nao', ''); used.append(ul, uv);
    const clear = doc.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear recents';
    clear.style.cssText = 'font:12px/1.2 system-ui,-apple-system,sans-serif;padding:5px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;cursor:pointer';
    clear.onclick = () => clearRecents(items);
    foot.append(used, clear);
    box.replaceChildren(h, row, foot);
  }

  // Space the Recent lists of every app take on this device (copies and pictures).
  function usage() { return tx(['recent'], 'readonly', async st => (await entries(st)).reduce((n, [, v]) => n + (v.file ? v.file.size : 0) + (v.picture ? v.picture.size : 0), 0)).catch(() => 0); }
  const mb = n => (n < 1048576 ? Math.max(0.1, n / 1048576).toFixed(1) : (n / 1048576).toFixed(n < 104857600 ? 1 : 0)) + ' MB';

  // Clearing entries also drops unsaved changes kept in them (Safari offers no other place for them): warn first and
  // offer to save them.
  async function clearRecents(items) {
    const unsaved = items.filter(i => i.edited && i.file);
    const choice = await dialog({
      title: items.length > 1 ? 'Clear recents?' : 'Remove from recent?',
      text: unsaved.length ? 'Unsaved changes kept here will be lost, because Safari keeps no other copy of them. Save them first?' : 'Files that are not saved elsewhere cannot be reopened from here afterwards, because of Safari limits.',
      buttons: [...(unsaved.length ? [['Save changes', 'save', 'main']] : []), ['Cancel', 'cancel'], ['Continue', 'go', 'danger']]
    });
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await saveFiles(unsaved.map(i => new File([i.file], i.name, { type: i.file.type || '' }))))) return;
    for (const it of items) await tx(['recent'], 'readwrite', async st => { st.delete(keyOf(it.name, it.size)); }).catch(() => {});
    render();
  }
  // Saves files through the share sheet (Save to Files) where it can take files, else as downloads.
  async function saveFiles(files) {
    try { if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); return true; } } catch (e) { if (e && e.name === 'AbortError') return false; }
    for (const f of files) { const a = doc.createElement('a'), u = URL.createObjectURL(f); a.href = u; a.download = f.name; doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 6e4); }
    return true;
  }
  function dialog({ title, text, buttons }) {
    return new Promise(resolve => {
      const layer = doc.createElement('div'), box = doc.createElement('div'), h = doc.createElement('strong'), p = doc.createElement('p'), row = doc.createElement('div');
      layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true');
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)';
      box.style.cssText = 'background:var(--surface,#fff);color:var(--text,#111);border-radius:12px;padding:18px;width:min(400px,calc(100vw - 32px));display:grid;gap:10px;font:15px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)';
      h.textContent = title; p.textContent = text; p.style.margin = '0';
      row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap';
      const done = v => { layer.remove(); resolve(v); };
      for (const [label, value, kind] of buttons) {
        const b = doc.createElement('button'); b.type = 'button'; b.textContent = label;
        b.style.cssText = 'font:inherit;padding:7px 14px;border-radius:8px;border:1px solid #9aa4b2;' + (kind === 'main' ? 'background:#3c5cdb;color:#fff;border-color:#3c5cdb' : kind === 'danger' ? 'background:#c4362c;color:#fff;border-color:#c4362c' : 'background:transparent;color:inherit');
        b.onclick = () => done(value); row.append(b);
      }
      layer.addEventListener('keydown', e => { if (e.key === 'Escape') done('cancel'); });
      layer.addEventListener('click', e => { if (e.target === layer) done('cancel'); });
      box.append(h, p, row); layer.append(box); doc.body.append(layer);
      row.firstChild.focus();
    });
  }

  // ---- opening a file over an open one
  function ask() {
    return new Promise(resolve => {
      const layer = doc.createElement('div'), box = doc.createElement('div'), h = doc.createElement('strong'), p = doc.createElement('p'), row = doc.createElement('div');
      layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true');
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)';
      box.style.cssText = 'background:var(--surface,#fff);color:var(--text,#111);border-radius:12px;padding:18px;width:min(380px,calc(100vw - 32px));display:grid;gap:10px;font:15px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)';
      h.textContent = 'Open another file'; p.textContent = 'Keep the open file in this tab and open the new one in a new tab?'; p.style.margin = '0';
      row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap';
      const done = v => { layer.remove(); resolve(v); };
      for (const [label, value, main] of [['Cancel', 'cancel'], ['Replace', 'replace'], ['New tab', 'tab', true]]) {
        const b = doc.createElement('button'); b.type = 'button'; b.textContent = label;
        b.style.cssText = 'font:inherit;padding:7px 14px;border-radius:8px;border:1px solid #9aa4b2;' + (main ? 'background:#3c5cdb;color:#fff;border-color:#3c5cdb' : 'background:transparent;color:inherit');
        b.onclick = () => done(value); row.append(b);
      }
      layer.addEventListener('keydown', e => { if (e.key === 'Escape') done('cancel'); });
      layer.addEventListener('click', e => { if (e.target === layer) done('cancel'); });
      box.append(h, p, row); layer.append(box); doc.body.append(layer);
      row.lastChild.focus();
    });
  }
  async function toNewTab(file) {
    let w = null; try { w = g.open('', '_blank'); } catch (_) {}
    if (!w) return false;
    try { const id = await handOff(file); w.location.href = g.location.pathname + g.location.search + '#inkdos-tab=' + id; return true; }
    catch (_) { try { w.close(); } catch (__) {} return false; }
  }
  const appInput = t => t && t.type === 'file' && !/^image\//.test(String(t.accept || '').trim()) && !t.hasAttribute('data-inkdos-no-resume');
  doc.addEventListener('change', e => {
    const t = e.target;
    if (!appInput(t) || !t.files || !t.files[0]) return;
    const file = t.files[0];
    if (bypass === t || !ASK || !fileOpen) { bypass = null; opened(file); return; }
    e.stopImmediatePropagation();
    ask().then(async choice => {
      if (choice === 'tab' && await toNewTab(file)) { t.value = ''; return; }
      if (choice === 'cancel') { t.value = ''; return; }
      bypass = t; t.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);

  // Puts a file into the app's input as if the user picked it.
  async function inject(file, input) {
    const launch = g.InkDOSFileLaunch;
    if (launch && launch.injectFile) return launch.injectFile(file, input);
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---- start: a tab opened for a file takes it from the hand-off; otherwise show the recent list
  g.addEventListener('load', () => setTimeout(async () => {
    if (handed) {
      const file = await takeHandOff(handed), launch = g.InkDOSFileLaunch;
      const input = file ? (launch && launch.compatibleInput ? launch.compatibleInput(file) : mainInput()) : null;
      if (input && appInput(input)) { try { bypass = input; await inject(file, input); } catch (e) { bypass = null; console.warn('InkDOS: could not open the file in this tab', e); } }
    }
    render();
  }, 0), { once: true });

  g.InkDOSTabResume = Object.freeze({ opened, remember, recentOf, render, reloaded, get fileOpen() { return fileOpen; } });
})(globalThis);
