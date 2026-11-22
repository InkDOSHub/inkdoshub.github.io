/* InkDOS tab resume: the open file survives a browser reload of its tab.
 *
 * iOS Safari drops a background tab and reloads it when the user comes back, which used to send every InkDOS app
 * back to its start screen. The browser no longer gives access to the file after that reload, so each tab keeps a
 * copy of the file it opened (IndexedDB) and where it was scrolled, under a tab id held in sessionStorage.
 * sessionStorage survives that reload but not closing the tab or the app: a reloaded tab reopens its file, a newly
 * opened app starts empty. Opening a file over an open one offers to keep both, the new one in a new tab.
 *
 * The copies never grow without bound: one copy per distinct file (tabs with the same file share it), files over
 * 100 MB are not copied, all copies together stay within 150 MB (least recently used dropped first), and the copy
 * of a tab not seen for a day is dropped.
 *
 * Load it before runtime/platform/file-launch.js (it reads the launch hash before that script clears it). Files are
 * reopened through the app's own file input, so each app opens them exactly as if the user picked them. Image inputs
 * (pictures inserted into a document) are left alone. On the script tag, `data-scroll="off"` skips the scroll
 * restore for apps that keep their own reading position (ePub), and `data-mode="store"` only provides the copy
 * store (InkDOSTabResume.store) to an app that resumes on its own (PDF).
 */
(function (g) {
  'use strict';
  if (g.InkDOSTabResume || !g.document) return;
  const doc = g.document, script = doc.currentScript;
  const DB = 'inkdos-tab-resume', MAX_BYTES = 100 * 1024 * 1024, BUDGET = 150 * 1024 * 1024, KEEP_MS = 864e5;
  const STORE_ONLY = !!(script && script.dataset.mode === 'store'), SCROLL = !(script && script.dataset.scroll === 'off');
  const APP = (g.location.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/') + (g.name ? '#' + g.name : '');

  // ---- the copies: "files" content key → {blob, size, type, at}; "tabs" tab id → {app, file, name, lastModified, at}
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!g.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const r = g.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('tabs'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  const req = r => new Promise(resolve => { r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); });
  const entries = st => new Promise(resolve => { const out = [], c = st.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return resolve(out); out.push([cur.key, cur.value]); cur.continue(); }; c.onerror = () => resolve(out); });
  // Runs fn(files, tabs) in one transaction (fn may only await requests of that transaction).
  async function tx(mode, fn) {
    const d = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const t = d.transaction(['files', 'tabs'], mode); let out;
        fn(t.objectStore('files'), t.objectStore('tabs')).then(v => { out = v; }, e => { try { t.abort(); } catch (_) {} reject(e); });
        t.oncomplete = () => resolve(out); t.onerror = t.onabort = () => reject(t.error);
      });
    } finally { d.close(); }
  }
  const contentKey = f => [f.name, f.size, f.lastModified || 0].join('|');
  // Tabs not seen for a day are dropped, then files no tab uses, then the least recently used files until the
  // copies fit the budget. The file of tab `keepTab` is never dropped.
  function prune(keepTab) {
    return tx('readwrite', async (files, tabs) => {
      const now = Date.now(), live = new Map();
      for (const [id, t] of await entries(tabs)) {
        if (id !== keepTab && now - (Number(t && t.at) || 0) > KEEP_MS) { tabs.delete(id); continue; }
        live.set(t.file, Math.max(live.get(t.file) || 0, id === keepTab ? Infinity : Number(t.at) || 0));
      }
      const list = (await entries(files)).map(([k, f]) => ({ k, size: Number(f && f.size) || 0, at: live.has(k) ? live.get(k) : -1 }));
      list.sort((a, b) => b.at - a.at);
      let used = 0;
      for (const f of list) { if (f.at < 0 || (f.at !== Infinity && used + f.size > BUDGET)) files.delete(f.k); else used += f.size; }
    }).catch(() => {});
  }
  // Keeps `file` as the file of tab `id`; false when it is too big to keep.
  async function put(id, file, app = APP) {
    if (!id || !file || file.size > MAX_BYTES) return false;
    const k = contentKey(file), now = Date.now();
    try {
      await tx('readwrite', async (files, tabs) => {
        files.put({ blob: file, size: file.size, type: file.type || '', at: now }, k);
        tabs.put({ app, file: k, name: file.name, lastModified: file.lastModified || 0, at: now }, id);
      });
    } catch (e) { console.warn('InkDOS: tab copy not kept', e); return false; }
    await prune(id);
    return true;
  }
  // Marks tab `id` as still in use; returns its record.
  function touch(id) {
    return tx('readwrite', async (files, tabs) => {
      const t = await req(tabs.get(id)); if (!t) return null;
      t.at = Date.now(); tabs.put(t, id);
      const f = await req(files.get(t.file)); if (f) { f.at = t.at; files.put(f, t.file); }
      return f ? { tab: t, file: f } : null;
    }).catch(() => null);
  }
  // The file kept for tab `id`, or null.
  async function get(id, app = APP) {
    const v = await touch(id);
    if (!v || v.tab.app !== app || !v.file.blob) return null;
    return new File([v.file.blob], v.tab.name || 'document', { type: v.file.type || '', lastModified: v.tab.lastModified || Date.now() });
  }
  const store = Object.freeze({ put, get, touch, prune });
  if (STORE_ONLY) { g.InkDOSTabResume = Object.freeze({ store }); return; }

  // ---- this tab
  const TAB_KEY = 'inkdos-tab:' + APP, STATE_KEY = 'inkdos-tab-state:' + APP;
  const hash = String(g.location.hash || '');
  const launching = /(?:^#|&)inkdos-launch=/.test(hash);
  const adopted = (/(?:^#|&)inkdos-tab=([A-Za-z0-9-]+)/.exec(hash) || [])[1] || null;
  let fileOpen = false, bypass = null, restoring = false, reopened = null;
  const uid = () => (g.crypto && g.crypto.randomUUID ? g.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const ss = {
    get(k) { try { return JSON.parse(g.sessionStorage.getItem(k) || 'null'); } catch (_) { return null; } },
    set(k, v) { try { g.sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { g.sessionStorage.removeItem(k); } catch (_) {} }
  };
  function tabId() { let id = ss.get(TAB_KEY); if (!id) { id = uid(); ss.set(TAB_KEY, id); } return id; }
  if (adopted) {
    ss.set(TAB_KEY, adopted); ss.del(STATE_KEY);
    try { g.history.replaceState(g.history.state, '', g.location.pathname + g.location.search); } catch (_) {}
  }

  // ---- scroll place of the open file
  function scrollers() { return [doc.scrollingElement, ...doc.querySelectorAll('[id]')].filter(el => el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)); }
  let saveTimer = 0;
  function saveScroll() {
    if (!SCROLL || !fileOpen || restoring) return;
    const st = ss.get(STATE_KEY); if (!st) return;
    const pos = {};
    for (const el of scrollers()) if (el.scrollTop || el.scrollLeft) pos[el === doc.scrollingElement ? ':root' : el.id] = [el.scrollTop, el.scrollLeft];
    st.scroll = pos; ss.set(STATE_KEY, st);
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
  doc.addEventListener('scroll', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveScroll, 400); }, { capture: true, passive: true });
  g.addEventListener('pagehide', saveScroll);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') saveScroll(); else if (fileOpen) touch(tabId()); });

  // ---- a file was opened in this tab
  function opened(file) {
    if (!file) return;
    fileOpen = true;
    const again = reopened === file.name + '|' + file.size; reopened = null;
    if (again) return; // the tab's own copy, just reopened
    ss.set(STATE_KEY, { name: file.name, size: file.size, scroll: null });
    put(tabId(), file);
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
    const id = uid();
    if (!(await put(id, file))) { try { w.close(); } catch (_) {} return false; }
    w.location.href = g.location.pathname + g.location.search + '#inkdos-tab=' + id;
    return true;
  }
  const appInput = t => t && t.type === 'file' && !/^image\//.test(String(t.accept || '').trim()) && !t.hasAttribute('data-inkdos-no-resume');
  doc.addEventListener('change', e => {
    const t = e.target;
    if (!appInput(t) || !t.files || !t.files[0]) return;
    const file = t.files[0];
    if (bypass === t) { bypass = null; opened(file); return; }
    if (!fileOpen) { opened(file); return; }
    e.stopImmediatePropagation();
    ask().then(async choice => {
      if (choice === 'tab' && await toNewTab(file)) { t.value = ''; return; }
      if (choice === 'cancel') { t.value = ''; return; }
      bypass = t; t.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);

  // ---- reopen this tab's file after a reload
  async function restore() {
    const st = ss.get(STATE_KEY);
    if (launching || (!adopted && !st)) return;
    const file = await get(tabId());
    if (!file || (st && (st.name !== file.name || st.size !== file.size))) return;
    const launch = g.InkDOSFileLaunch, input = launch && launch.compatibleInput ? launch.compatibleInput(file) : null;
    if (!input || !appInput(input)) return;
    try { bypass = input; reopened = file.name + '|' + file.size; await launch.injectFile(file, input); } catch (e) { bypass = null; reopened = null; console.warn('InkDOS: could not reopen the tab file', e); return; }
    if (st) { ss.set(STATE_KEY, { ...ss.get(STATE_KEY), scroll: st.scroll }); restoreScroll(st.scroll); }
  }
  // After the app has set up its file input and handlers.
  g.addEventListener('load', () => setTimeout(() => restore().catch(e => console.warn(e)), 0), { once: true });

  g.InkDOSTabResume = Object.freeze({ store, opened, get fileOpen() { return fileOpen; } });
})(globalThis);
