// InkDOS-tools diagnostics: show on screen what happens when a PDF toolkit page runs in this browser (for browsers
// where no developer tools are at hand, such as an iPad app). The page under test is loaded in a frame of the same
// origin, so its errors, navigations and file picks can be watched from here. Nothing is sent anywhere.
(function () {
  'use strict';
  const env = document.getElementById('env'), log = document.getElementById('log'), frame = document.getElementById('frame');
  const t0 = Date.now(), lines = [];
  function add(list, text, cls) {
    const li = document.createElement('li'); li.textContent = text; if (cls) li.className = cls; list.appendChild(li);
    lines.push((list === env ? '' : '+' + ((Date.now() - t0) / 1000).toFixed(1) + 's ') + text);
  }
  const note = (text, cls) => add(log, text, cls);
  async function check(name, fn) {
    try { const v = await fn(); add(env, name + ': ' + v, v === false || v === 'não' ? 'bad' : ''); }
    catch (e) { add(env, name + ': ERRO ' + (e && e.message || e), 'bad'); }
  }
  (async () => {
    await check('Navegador', () => navigator.userAgent);
    await check('Service worker disponível', () => 'serviceWorker' in navigator ? 'sim' : 'não');
    await check('Service worker do kit ativo', async () => {
      if (!('serviceWorker' in navigator)) return 'não';
      const reg = await navigator.serviceWorker.getRegistration('../bentopdf/');
      return reg && reg.active ? 'sim (' + reg.scope + ')' : 'não';
    });
    await check('localStorage', () => { localStorage.setItem('inkdos-diag', '1'); localStorage.removeItem('inkdos-diag'); return 'sim'; });
    await check('IndexedDB', () => new Promise((ok, bad) => { const r = indexedDB.open('inkdos-diag'); r.onsuccess = () => { r.result.close(); ok('sim'); }; r.onerror = () => bad(r.error); }));
    await check('Cache Storage', async () => { await caches.keys(); return 'sim'; });
    await check('Armazenamento', async () => {
      if (!navigator.storage || !navigator.storage.estimate) return 'sem informação';
      const e = await navigator.storage.estimate(), p = navigator.storage.persisted ? await navigator.storage.persisted() : '?';
      return Math.round((e.usage || 0) / 1048576) + ' MB usados de ' + Math.round((e.quota || 0) / 1048576) + ' MB; permanente: ' + (p ? 'sim' : 'não');
    });
    await check('WebAssembly', () => typeof WebAssembly === 'object' ? 'sim' : 'não');
    await check('Memória do aparelho (aprox.)', () => navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'sem informação');
    await check('Dentro de outra página (frame)', () => window.top !== window ? 'sim' : 'não');
  })();
  addEventListener('error', (e) => note('Erro nesta página: ' + e.message, 'bad'));

  let opened = '';
  function instrument() {
    let win, doc;
    try { win = frame.contentWindow; doc = frame.contentDocument; } catch (e) { note('Frame de outra origem: ' + e.message, 'bad'); return; }
    if (!win || !doc) return;
    const url = String(win.location.href);
    if (url === 'about:blank') return;
    note('Carregou: ' + url.replace(location.origin, ''), url.includes(opened.replace('..', '')) ? 'ok' : '');
    win.addEventListener('error', (e) => note('Erro: ' + e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''), 'bad'));
    // a script, style or other file of the page that failed to load (blocked, missing)
    win.addEventListener('error', (e) => {
      const el = e.target;
      if (el && el !== win && (el.src || el.href)) note('Não carregou: ' + String(el.src || el.href).split('/').pop(), 'bad');
    }, true);
    // a result the tool hands over as a download (the browser must save it)
    win.document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[download]');
      if (a) note('Download pedido: ' + (a.getAttribute('download') || 'arquivo') + ' (' + String(a.href).slice(0, 5) + ')');
    }, true);
    const nativeClick = win.HTMLAnchorElement && win.HTMLAnchorElement.prototype.click;
    if (nativeClick) win.HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) note('Download pedido: ' + (this.getAttribute('download') || 'arquivo') + ' (' + String(this.href).slice(0, 5) + ')');
      return nativeClick.apply(this, arguments);
    };
    win.addEventListener('unhandledrejection', (e) => note('Erro (promessa): ' + (e.reason && (e.reason.message || e.reason)), 'bad'));
    win.addEventListener('beforeunload', () => note('A página vai sair: ' + String(win.location.href).replace(location.origin, '')));
    win.addEventListener('pagehide', () => note('A página foi fechada/trocada'));
    doc.addEventListener('change', (e) => {
      const input = e.target;
      if (input && input.type === 'file') { note('Arquivo escolhido: ' + [...(input.files || [])].map((f) => f.name + ' (' + f.size + ' bytes)').join(', '), 'ok'); follow(doc); }
    }, true);
    // workers (the PDF reader runs in one): their errors do not reach the page, so they are reported here
    const NativeWorker = win.Worker;
    if (NativeWorker) win.Worker = function (url, options) {
      const name = String(url).split('/').pop().split('?')[0];
      let worker;
      try { worker = new NativeWorker(url, options); } catch (err) { note('Worker não abriu (' + name + '): ' + (err && err.message || err), 'bad'); throw err; }
      note('Worker aberto: ' + name);
      worker.addEventListener('error', (ev) => note('Erro no worker ' + name + ': ' + (ev.message || 'sem mensagem'), 'bad'));
      worker.addEventListener('messageerror', () => note('Mensagem inválida do worker ' + name, 'bad'));
      return worker;
    };
    // requests that fail (a blocked or missing file)
    const nativeFetch = win.fetch;
    if (nativeFetch) win.fetch = function (input) {
      const name = String(input && input.url || input).split('/').pop().split('?')[0].slice(0, 80);
      return nativeFetch.apply(this, arguments).then((r) => { if (!r.ok) note('Falha ao baixar ' + name + ': HTTP ' + r.status, 'bad'); return r; },
        (err) => { note('Falha ao baixar ' + name + ': ' + (err && err.message || err), 'bad'); throw err; });
    };
    doc.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a,button');
      if (a) note('Toque em: ' + (a.getAttribute('href') || a.id || a.textContent.trim().slice(0, 40)));
    }, true);
    const origError = win.console.error;
    win.console.error = function () { note('console.error: ' + [...arguments].map(String).join(' ').slice(0, 300), 'bad'); return origError.apply(this, arguments); };
  }
  // after a file is picked: what the tool shows over the next 20 seconds (page count, or the visible text if none)
  function follow(doc) {
    const started = Date.now();
    const tick = () => {
      let text = '';
      try { text = doc.body.innerText; } catch (_) { return; }
      const m = text.match(/\d+ (pages|páginas|page|página)\b/);
      const viewer = doc.querySelector('canvas, embed-pdf, [class*="viewer"] img');
      if (!m && viewer && Date.now() - started > 3000) { note('A ferramenta mostra o arquivo (visualizador aberto)', 'ok'); return; }
      if (m) { note('A ferramenta mostra o arquivo: ' + m[0], 'ok'); return; }
      if (Date.now() - started > 20000) {
        note('Depois de 20 s a ferramenta ainda não mostra o arquivo. Texto visível: ' + text.replace(/\s+/g, ' ').slice(0, 400), 'bad');
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }
  frame.addEventListener('load', instrument);
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
    opened = b.dataset.open; note('Abrindo ' + opened.replace('../', ''));
    frame.src = opened;
  }));
  document.getElementById('copy').addEventListener('click', async () => {
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); note('Relatório copiado', 'ok'); }
    catch (_) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); note('Relatório copiado', 'ok'); } catch (__) { note('Não foi possível copiar; tire um print', 'bad'); } t.remove(); }
  });
})();
