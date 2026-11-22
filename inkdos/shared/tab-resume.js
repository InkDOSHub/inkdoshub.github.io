/* InkDOS tab resume: a tab reloaded by the browser comes back to its file.
 *
 * iOS Safari drops a background tab and reloads it when the user comes back, which used to send every InkDOS app
 * back to its start screen with nothing to show what was open. The file itself is not kept (no growing cache): each
 * tab keeps only which file it had open, where it was, and (for the PDF reader) a small picture of the page in view.
 * After such a reload the app shows that page and a "Reopen" button; picking the file again opens it at the same
 * place. All of it lives in sessionStorage plus a few small pictures in IndexedDB, so closing the tab or the app
 * starts fresh. Opening a file over an open one offers to keep both, the new one in a new tab.
 *
 * Load it before runtime/platform/file-launch.js (it reads the launch hash before that script clears it). Image
 * inputs (pictures inserted into a document) are left alone. On the script tag, `data-scroll="off"` skips the scroll
 * restore for apps that keep their own reading position (ePub), and `data-mode="store"` only provides the helpers
 * (InkDOSTabResume.store / showReopen) to an app that resumes on its own (PDF).
 */
(function (g) {
  'use strict';
  if (g.InkDOSTabResume || !g.document) return;
  const doc = g.document, script = doc.currentScript;
  const DB = 'inkdos-tab-resume2', MAX_PICTURE = 2 * 1024 * 1024, BUDGET = 16 * 1024 * 1024, KEEP_MS = 864e5, HANDOFF_MS = 6e4;
  const STORE_ONLY = !!(script && script.dataset.mode === 'store'), SCROLL = !(script && script.dataset.scroll === 'off');
  const APP = (g.location.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/') + (g.name ? '#' + g.name : '');
  try { g.indexedDB && g.indexedDB.deleteDatabase('inkdos-tab-resume'); } catch (_) {} // an unreleased version kept whole files
  // A tab the browser reloaded (Safari restoring a dropped tab, or a refresh) or went back to, not one opened anew.
  const reloaded = (() => { try { const n = g.performance.getEntriesByType('navigation')[0]; if (n) return n.type === 'reload' || n.type === 'back_forward'; return g.performance.navigation && g.performance.navigation.type !== 0; } catch (_) { return false; } })();

  // ---- small pictures ("pictures": tab id → {blob, size, at}) and one-minute hand-offs to a new tab ("handoff")
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!g.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const r = g.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('pictures'); r.result.createObjectStore('handoff'); };
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
  // Pictures of tabs not seen for a day go, then the oldest until all fit in the budget; stale hand-offs go too.
  function prune(keep) {
    return tx(['pictures', 'handoff'], 'readwrite', async (pics, hand) => {
      const now = Date.now(), list = (await entries(pics)).map(([k, v]) => ({ k, size: Number(v && v.size) || 0, at: k === keep ? Infinity : Number(v && v.at) || 0 }));
      list.sort((a, b) => b.at - a.at);
      let used = 0;
      for (const p of list) { if (p.at !== Infinity && (now - p.at > KEEP_MS || used + p.size > BUDGET)) pics.delete(p.k); else used += p.size; }
      for (const [k, v] of await entries(hand)) if (now - (Number(v && v.at) || 0) > HANDOFF_MS) hand.delete(k);
    }).catch(() => {});
  }
  async function putPicture(id, blob) {
    if (!id || !blob || blob.size > MAX_PICTURE) return false;
    try { await tx(['pictures'], 'readwrite', async s => { s.put({ blob, size: blob.size, at: Date.now() }, id); }); } catch (_) { return false; }
    prune(id); return true;
  }
  function getPicture(id) { return tx(['pictures'], 'readonly', async s => { const v = await req(s.get(id)); return v && v.blob || null; }).catch(() => null); }
  function dropPicture(id) { return tx(['pictures'], 'readwrite', async s => { s.delete(id); }).catch(() => {}); }
  const uid = () => (g.crypto && g.crypto.randomUUID ? g.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  // A file passed to a new tab is held for at most a minute and deleted as soon as that tab takes it.
  async function handOff(file) { const id = uid(); await tx(['handoff'], 'readwrite', async s => { s.put({ file, at: Date.now() }, id); }); prune(); return id; }
  function takeHandOff(id) { return tx(['handoff'], 'readwrite', async s => { const v = await req(s.get(id)); s.delete(id); return v && v.file || null; }).catch(() => null); }
  const store = Object.freeze({ putPicture, getPicture, dropPicture, handOff, takeHandOff });

  // ---- the "Reopen" card shown after a reload
  function showReopen({ host = doc.body, name = '', picture = null, onReopen, onDismiss } = {}) {
    const card = doc.createElement('div'), inner = doc.createElement('div'), title = doc.createElement('div'), row = doc.createElement('div');
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Reopen file'); card.className = 'inkdos-reopen';
    card.style.cssText = (host === doc.body ? 'position:fixed;' : 'position:absolute;') + 'inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.35);overflow:auto';
    inner.style.cssText = 'background:var(--surface,#fff);color:var(--text,#111);border-radius:14px;padding:14px;max-width:min(560px,100%);display:grid;gap:12px;justify-items:center;font:15px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)';
    let url = null;
    if (picture) {
      const img = doc.createElement('img'); url = URL.createObjectURL(picture); img.src = url; img.alt = '';
      img.style.cssText = 'display:block;max-width:100%;max-height:60vh;border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.1)';
      inner.append(img);
    }
    title.textContent = name; title.style.cssText = 'font-weight:600;text-align:center;word-break:break-word';
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center';
    const close = () => { card.remove(); if (url) URL.revokeObjectURL(url); };
    const button = (label, main, fn) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = 'font:inherit;padding:8px 16px;border-radius:9px;border:1px solid #9aa4b2;' + (main ? 'background:#3c5cdb;color:#fff;border-color:#3c5cdb' : 'background:transparent;color:inherit'); b.onclick = fn; row.append(b); return b; };
    button('Not now', false, () => { close(); onDismiss && onDismiss(); });
    const main = button('Reopen', true, () => { onReopen && onReopen(); });
    inner.append(title, row); card.append(inner); host.append(card); main.focus();
    return close;
  }
  if (STORE_ONLY) { g.InkDOSTabResume = Object.freeze({ store, showReopen, reloaded }); return; }

  // ---- this tab
  const TAB_KEY = 'inkdos-tab:' + APP, STATE_KEY = 'inkdos-tab-state:' + APP;
  const hash = String(g.location.hash || '');
  const launching = /(?:^#|&)inkdos-launch=/.test(hash);
  const handed = (/(?:^#|&)inkdos-tab=([A-Za-z0-9-]+)/.exec(hash) || [])[1] || null;
  let fileOpen = false, bypass = null, restoring = false, closeCard = null;
  const ss = {
    get(k) { try { return JSON.parse(g.sessionStorage.getItem(k) || 'null'); } catch (_) { return null; } },
    set(k, v) { try { g.sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { g.sessionStorage.removeItem(k); } catch (_) {} }
  };
  if (handed) { ss.del(STATE_KEY); try { g.history.replaceState(g.history.state, '', g.location.pathname + g.location.search); } catch (_) {} }

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
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') saveScroll(); });

  // ---- a file was opened in this tab; the same file picked from the "Reopen" card goes back to its place
  function opened(file) {
    if (!file) return;
    fileOpen = true;
    if (closeCard) { closeCard(); closeCard = null; }
    const st = ss.get(STATE_KEY), same = st && st.name === file.name && st.size === file.size;
    ss.set(STATE_KEY, { name: file.name, size: file.size, scroll: same ? st.scroll : null });
    if (same && st.pending) restoreScroll(st.scroll);
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
    if (bypass === t) { bypass = null; opened(file); return; }
    if (!fileOpen) { opened(file); return; }
    e.stopImmediatePropagation();
    ask().then(async choice => {
      if (choice === 'tab' && await toNewTab(file)) { t.value = ''; return; }
      if (choice === 'cancel') { t.value = ''; return; }
      bypass = t; t.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);

  // ---- after a reload: offer to reopen the tab's file; a tab opened for a file takes it from the hand-off
  async function restore() {
    const launch = g.InkDOSFileLaunch;
    if (handed) {
      const file = await takeHandOff(handed);
      const input = file && launch && launch.compatibleInput ? launch.compatibleInput(file) : null;
      if (input && appInput(input)) { try { bypass = input; await launch.injectFile(file, input); } catch (e) { bypass = null; console.warn('InkDOS: could not open the file in this tab', e); } }
      return;
    }
    const st = ss.get(STATE_KEY);
    if (launching || !reloaded || !st || fileOpen) return;
    const input = [...doc.querySelectorAll('input[type="file"]')].find(appInput);
    if (!input) return;
    ss.set(STATE_KEY, { ...st, pending: true });
    closeCard = showReopen({
      name: st.name,
      onReopen: () => { if (launch && launch.requestPicker && launch.requestPicker(input)) return; input.click(); },
      onDismiss: () => { closeCard = null; ss.del(STATE_KEY); }
    });
  }
  // After the app has set up its file input and handlers.
  g.addEventListener('load', () => setTimeout(() => restore().catch(e => console.warn(e)), 0), { once: true });

  g.InkDOSTabResume = Object.freeze({ store, showReopen, reloaded, opened, get fileOpen() { return fileOpen; } });
})(globalThis);
