// InkDOS Hub para Windows: o mesmo site (https://inkdoshub.github.io/), com os mesmos apps, numa janela própria.
//
// - O instalador traz só esta carcaça. A tela inicial e os apps vêm do site e ficam guardados no disco
//   (%LOCALAPPDATA%\InkDOS Hub\site) quando a pessoa marca o check verde no "Offline" do ☰.
//   Cada arquivo baixado é conferido pelo SHA-256 da lista do site (inicio/manifesto.json); se não conferir, não entra.
// - Os pedidos para inkdoshub.github.io passam por aqui: o que está guardado abre do disco (funciona sem internet),
//   o resto vem do site, também conferido. Atualizar = o mesmo "Atualização disponível" da tela inicial.
// - Sem telemetria: o Chromium não fala com o Google nem com a Microsoft (serviços de fundo desligados) e a rede
//   só alcança os endereços de LIVRES; todo o resto é bloqueado.
// - Cada app abre numa janela própria (processo próprio); várias ao mesmo tempo.
'use strict';
const { app, BrowserWindow, protocol, net, session, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

const HOST = 'inkdoshub.github.io';
const SITE = 'https://' + HOST + '/';
// só para testar: buscar os arquivos de outro endereço (ex.: http://127.0.0.1:8765/), mantendo o endereço do site nas janelas
const ORIGEM = process.env.INKHUB_ORIGEM || SITE;
// únicos destinos de rede: o site e o servidor de conexão do Transferir e da Webcam (PeerJS)
const LIVRES = new Set([HOST, '0.peerjs.com']);
const LEVE = 1e6; // grupos menores que isto ficam sempre guardados com a tela inicial (igual ao site)

// ---------- leve e privado: desliga os serviços de fundo do Chromium ----------
for (const s of ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-breakpad',
  'no-pings', 'disable-sync', 'disable-default-apps', 'no-default-browser-check', 'no-first-run']) app.commandLine.appendSwitch(s);
app.commandLine.appendSwitch('disable-features', [
  'Translate', 'MediaRouter', 'OptimizationHints', 'OptimizationGuideModelDownloading', 'AutofillServerCommunication',
  'CertificateTransparencyComponentUpdater', 'InterestFeedContentSuggestions', 'SpareRendererForSitePerProcess',
  'NetworkTimeServiceQuerying', 'SafeBrowsingEnhancedProtection'
].join(','));
app.commandLine.appendSwitch('lang', 'en-US');

app.setName('InkDOS Hub');
app.setPath('userData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'InkDOS Hub'));
const PASTA = path.join(app.getPath('userData'), 'site');
const ESTADO = path.join(PASTA, '__estado.json');
const MANIFESTO = path.join(PASTA, '__manifesto.json');

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { const w = principal(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

// ---------- estado guardado ----------
let estado = null;   // { versao, grupos: [ids], arquivos: { caminho: h16 } }
let lista = null;    // manifesto do site em memória + mapa caminho -> [bytes, h16, sha]
function lerJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
function mapa(m) {
  const r = new Map();
  for (const g of m.grupos) for (const a of g.arquivos) r.set(a[0], a);
  for (const c of Object.keys(m.idiomas || {})) for (const a of m.idiomas[c].arquivos) r.set(a[0], a);
  m.mapa = r;
  return m;
}
async function gravar(f, dados) {
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = f + '.baixando';
  await fsp.writeFile(tmp, dados);
  await fsp.rename(tmp, f);
}
async function manifestoDoSite() {
  const r = await net.fetch(ORIGEM + 'inicio/manifesto.json?t=' + Date.now(), { bypassCustomProtocolHandlers: true});
  if (!r.ok) throw new Error('manifesto ' + r.status);
  const texto = await r.text();
  const m = mapa(JSON.parse(texto));
  lista = m;
  gravar(MANIFESTO, texto).catch(() => {});
  return m;
}
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

// baixa um arquivo do site e confere o SHA-256 (o "?inkoff=" garante a versão nova, sem cópia velha do CDN)
async function baixarConferido(a) {
  const r = await net.fetch(ORIGEM + encodeURI(a[0]) + '?inkoff=' + a[2], { bypassCustomProtocolHandlers: true});
  if (!r.ok) throw new Error(a[0] + ': ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  if (a[3] && sha256(b) !== a[3]) throw new Error(a[0] + ': SHA-256 não confere');
  return b;
}

function seguro(rel) {
  const f = path.resolve(PASTA, rel);
  return f.startsWith(PASTA + path.sep) ? f : null;
}

// ---------- guardar no disco: os grupos escolhidos (mais a tela inicial e os apps leves) ----------
let ocupado = false;
async function sincronizar(ids, progresso) {
  if (ocupado) throw new Error('ocupado');
  ocupado = true;
  try {
    const m = await manifestoDoSite();
    const quer = new Set(ids || []);
    const grupos = m.grupos.filter(g => quer.has(g.id) || g.id === 'inicio' || g.bytes < LEVE);
    const antes = (estado && estado.arquivos) || {};
    const todos = {}, fila = [];
    let total = 0, feito = 0;
    for (const g of grupos) for (const a of g.arquivos) {
      todos[a[0]] = a[2];
      const f = seguro(a[0]);
      if (f && (antes[a[0]] !== a[2] || !fs.existsSync(f))) { fila.push(a); total += a[1]; }
    }
    let i = 0;
    const proximo = async () => {
      while (i < fila.length) {
        const a = fila[i++];
        await gravar(seguro(a[0]), await baixarConferido(a));
        feito += a[1];
        if (progresso) progresso(Math.min(99, Math.floor(feito * 100 / Math.max(1, total))));
      }
    };
    await Promise.all([proximo(), proximo(), proximo(), proximo(), proximo(), proximo()]);
    // apaga o que não faz mais parte
    for (const rel of Object.keys(antes)) if (!(rel in todos)) { const f = seguro(rel); if (f) await fsp.rm(f, { force: true }); }
    estado = { versao: m.versao, grupos: grupos.map(g => g.id), arquivos: todos };
    await gravar(ESTADO, JSON.stringify(estado));
    return true;
  } finally { ocupado = false; }
}

// ---------- tipos de arquivo ----------
const TIPOS = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json', wasm: 'application/wasm',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', xml: 'application/xml',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', bin: 'application/octet-stream', dat: 'application/octet-stream', zip: 'application/zip'
};
const tipo = rel => TIPOS[(rel.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// ---------- os pedidos para o site ----------
async function responderSite(req) {
  const u = new URL(req.url);
  let rel = decodeURIComponent(u.pathname.slice(1));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const f = seguro(rel);
  if (!f) return new Response('', { status: 400 });

  // a lista do site sempre vem fresca (é como a tela inicial descobre que há versão nova)
  if (rel === 'inicio/manifesto.json') {
    try { await manifestoDoSite(); } catch (_) {}
    try { return new Response(await fsp.readFile(MANIFESTO), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
    catch (_) { return new Response('', { status: 503 }); }
  }
  // guardado no disco: abre daqui, sem internet
  if (estado && estado.arquivos[rel] && req.method === 'GET') {
    try { return new Response(await fsp.readFile(f), { headers: { 'Content-Type': tipo(rel) } }); } catch (_) {}
  }
  // não guardado: vem do site, conferido pelo SHA-256 quando está na lista
  const a = lista && lista.mapa.get(rel);
  if (a && req.method === 'GET') {
    try {
      return new Response(await baixarConferido(a), { headers: { 'Content-Type': tipo(rel) } });
    } catch (e) {
      // a lista pode ter mudado no site depois que o app abriu: busca de novo e tenta mais uma vez
      try {
        await manifestoDoSite();
        const b = lista.mapa.get(rel);
        if (b) return new Response(await baixarConferido(b), { headers: { 'Content-Type': tipo(rel) } });
      } catch (_) {}
      if (/SHA-256/.test(e.message)) return new Response('InkDOS Hub: ' + e.message, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return semInternet(rel, e);
    }
  }
  // fora da lista (pacotes de idioma, arquivos novos): direto do site
  try {
    if (ORIGEM !== SITE) return await net.fetch(ORIGEM + rel + u.search, { bypassCustomProtocolHandlers: true });
    return await net.fetch(req, { bypassCustomProtocolHandlers: true });
  } catch (e) { return semInternet(rel, e); }
}
// página sem internet e app não guardado: explica em vez de mostrar um erro cru
function semInternet(rel, e) {
  if (!/\.html?$/.test(rel)) return new Response('', { status: 503 });
  const html = '<!doctype html><meta charset="utf-8"><title>InkDOS Hub</title><body style="font:15px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#3a3a3c;background:#f2f2f7;text-align:center">' +
    '<div><p><b>Sem internet · No internet</b></p><p>Este app ainda não está guardado neste PC. Na tela inicial, abra ☰ › Offline e marque o app para usar sem internet.</p>' +
    '<p>This app is not saved on this PC yet. On the home screen, open ☰ › Offline and check the app to use it without internet.</p></div></body>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ---------- Webcam: no Windows abre o app nativo (câmera virtual), não a página do iPhone ----------
// Baixa o InkDOSHub-Webcam-Windows.zip da release webcam-windows, confere o SHA-256 publicado, extrai em
// %LOCALAPPDATA%\InkDOS Hub\webcam e abre. Nas vezes seguintes só abre (e atualiza se a release mudou).
const WEBCAM = 'https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/webcam-windows/InkDOSHub-Webcam-Windows.zip';
const ehWebcam = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/apps/webcam/'); } catch (_) { return false; } };
let webcamOcupada = false;
function acharExe(pasta) {
  if (!fs.existsSync(pasta)) return null;
  for (const n of fs.readdirSync(pasta, { withFileTypes: true })) {
    const f = path.join(pasta, n.name);
    if (n.isFile() && n.name.toLowerCase() === 'inkdos hub webcam.exe') return f;
    if (n.isDirectory()) { const r = acharExe(f); if (r) return r; }
  }
  return null;
}
async function abrirWebcam() {
  if (webcamOcupada) return;
  webcamOcupada = true;
  const pt = /^pt/i.test(app.getLocale());
  const pasta = path.join(app.getPath('userData'), 'webcam');
  const marca = path.join(pasta, 'versao.sha256');
  let aviso = null;
  const dizer = txt => {
    if (!aviso || aviso.isDestroyed()) {
      aviso = new BrowserWindow({ width: 440, height: 170, resizable: false, minimizable: false, maximizable: false, icon: ICONE, autoHideMenuBar: true, title: 'InkDOS Hub Webcam', backgroundColor: '#f2f2f7', webPreferences: { sandbox: true, contextIsolation: true, javascript: true } });
      aviso.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:14px -apple-system,Segoe UI,sans-serif;margin:0;display:grid;place-items:center;height:100vh;background:#f2f2f7;color:#1c1c1e;text-align:center"><p id="t" style="padding:0 18px"></p></body>'))
        .then(() => aviso && !aviso.isDestroyed() && aviso.webContents.executeJavaScript('document.getElementById("t").textContent=' + JSON.stringify(txt)));
    } else aviso.webContents.executeJavaScript('document.getElementById("t").textContent=' + JSON.stringify(txt)).catch(() => {});
  };
  try {
    const baixar = session.fromPartition('inkhub-baixar');
    let exe = acharExe(pasta);
    let remoto = null;
    try {
      const r = await baixar.fetch(WEBCAM + '.sha256');
      if (r.ok) remoto = (await r.text()).trim().split(/\s+/)[0].toLowerCase();
    } catch (_) {}
    const local = fs.existsSync(marca) ? fs.readFileSync(marca, 'utf8').trim() : '';
    if (remoto && /^[0-9a-f]{64}$/.test(remoto) && (!exe || remoto !== local)) {
      dizer(pt ? 'Baixando o app da Webcam para Windows…' : 'Downloading the Webcam app for Windows…');
      const r = await baixar.fetch(WEBCAM);
      if (!r.ok) throw new Error('download ' + r.status);
      const total = Number(r.headers.get('content-length')) || 0, partes = [];
      let feito = 0, ultimo = -1;
      const leitor = r.body.getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        partes.push(Buffer.from(value)); feito += value.length;
        const pct = total ? Math.floor(feito * 100 / total) : 0;
        if (pct !== ultimo && pct % 5 === 0) { ultimo = pct; dizer((pt ? 'Baixando o app da Webcam para Windows… ' : 'Downloading the Webcam app for Windows… ') + pct + '%'); }
      }
      const zip = Buffer.concat(partes);
      if (sha256(zip) !== remoto) throw new Error('SHA-256');
      dizer(pt ? 'SHA-256 conferido ✓ Instalando…' : 'SHA-256 verified ✓ Installing…');
      const novo = pasta + '.novo', arq = path.join(app.getPath('userData'), 'webcam.zip');
      await fsp.rm(novo, { recursive: true, force: true });
      await fsp.writeFile(arq, zip);
      await new Promise((ok, falha) => require('child_process').execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:INK_ZIP -DestinationPath $env:INK_DEST -Force'],
        { env: Object.assign({}, process.env, { INK_ZIP: arq, INK_DEST: novo }), windowsHide: true }, e => (e ? falha(e) : ok())));
      await fsp.rm(arq, { force: true });
      if (!acharExe(novo)) throw new Error('pacote sem o app');
      try {
        await fsp.rm(pasta, { recursive: true, force: true });
        await fsp.rename(novo, pasta);
        await fsp.writeFile(marca, remoto);
      } catch (_) { /* app aberto: fica a versão anterior desta vez */ await fsp.rm(novo, { recursive: true, force: true }); }
      exe = acharExe(pasta);
    }
    if (!exe) throw new Error(pt ? 'sem internet para baixar o app da Webcam' : 'no internet to download the Webcam app');
    const err = await shell.openPath(exe);
    if (err) throw new Error(err);
    if (aviso && !aviso.isDestroyed()) aviso.close();
  } catch (e) {
    dizer((pt ? 'Não deu para abrir o app da Webcam: ' : 'Could not open the Webcam app: ') + (e.message === 'SHA-256' ? (pt ? 'o arquivo baixado não confere (SHA-256). Tente de novo.' : 'the download does not match its SHA-256. Try again.') : e.message));
  } finally { webcamOcupada = false; }
}

// ---------- a própria carcaça se atualiza ----------
// Lê versao.json da release hub-windows; se for mais nova, baixa o instalador em segundo plano, confere o SHA-256
// e mostra na tela inicial "Nova versão do app · Reiniciar". Se a pessoa não tocar, instala ao fechar o Hub.
const VERSAO_URL = 'https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/hub-windows/versao.json';
let instaladorPronto = null;
const maior = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
async function procurarVersaoNova() {
  if (instaladorPronto || !app.isPackaged || process.platform !== 'win32') return;
  try {
    const baixar = session.fromPartition('inkhub-baixar');
    const r = await baixar.fetch(VERSAO_URL + '?t=' + Date.now());
    if (!r.ok) return;
    const v = await r.json();
    if (!v || !maior(v.versao, app.getVersion()) || !/^[0-9a-f]{64}$/.test(v.sha256 || '')) return;
    const url = VERSAO_URL.replace('versao.json', v.arquivo || 'InkDOSHub-Setup.exe');
    const s = await baixar.fetch(url);
    if (!s.ok) return;
    const b = Buffer.from(await s.arrayBuffer());
    if (sha256(b) !== v.sha256) return; // não confere: tenta de novo na próxima vez
    const f = path.join(app.getPath('temp'), 'InkDOSHub-Setup-' + v.versao + '.exe');
    await fsp.writeFile(f, b);
    instaladorPronto = f;
    mostrarAvisoApp();
  } catch (_) {}
}
function mostrarAvisoApp() {
  const w = principal();
  if (!w || !instaladorPronto) return;
  const pt = /^pt/i.test(app.getLocale());
  const txt = pt ? 'Nova versão do app · Reiniciar' : 'New app version · Restart';
  w.webContents.executeJavaScript('(function(){if(document.getElementById("hub-app-novo"))return;var b=document.createElement("button");b.id="hub-app-novo";b.type="button";b.className="aviso-atualizar";b.style.bottom="64px";b.textContent=' +
    JSON.stringify(txt) + ';b.onclick=function(){b.disabled=true;b.textContent="…";window.inkHubNativo&&window.inkHubNativo.reiniciarAtualizando()};document.body.appendChild(b)})()').catch(() => {});
}
function instalarAtualizacao(relancar) {
  if (!instaladorPronto) return false;
  const args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'];
  if (relancar) args.push('/relancar=1');
  require('child_process').spawn(instaladorPronto, args, { detached: true, stdio: 'ignore' }).unref();
  instaladorPronto = null;
  return true;
}

// ---------- janelas ----------
const ICONE = path.join(__dirname, 'icone.ico');
const prefs = () => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true, sandbox: true, nodeIntegration: false,
  spellcheck: false, backgroundThrottling: true, autoplayPolicy: 'user-gesture-required'
});
function opcoes(largura, altura) {
  return { width: largura, height: altura, minWidth: 360, minHeight: 400, icon: ICONE, autoHideMenuBar: true, backgroundColor: '#f2f2f7', show: false, webPreferences: prefs() };
}
let janelaPrincipal = null;
const principal = () => (janelaPrincipal && !janelaPrincipal.isDestroyed() ? janelaPrincipal : null);
const doSite = url => { try { return new URL(url).hostname === HOST; } catch (_) { return false; } };

function cuidar(w) {
  w.once('ready-to-show', () => w.show());
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (ehWebcam(url)) { abrirWebcam(); return { action: 'deny' }; }
    if (url === 'about:blank' || doSite(url)) return { action: 'allow', overrideBrowserWindowOptions: opcoes(1200, 820) };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('did-create-window', cuidar);
  w.webContents.on('will-navigate', (e, url) => {
    if (ehWebcam(url)) {
      e.preventDefault();
      abrirWebcam();
      // a tela inicial abre uma janela vazia e depois manda o endereço: essa janela fecha
      const atual = w.webContents.getURL();
      if (w !== principal() && (!atual || atual === 'about:blank')) w.close();
      return;
    } if (!doSite(url) && url !== 'about:blank') { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  w.webContents.on('before-input-event', (e, k) => {
    if (k.type !== 'keyDown') return;
    if (k.key === 'F5' || ((k.control || k.meta) && k.key.toLowerCase() === 'r')) { e.preventDefault(); w.webContents.reload(); }
    else if (k.key === 'F11') { e.preventDefault(); w.setFullScreen(!w.isFullScreen()); }
    else if ((k.control || k.meta) && (k.key === '=' || k.key === '+')) { e.preventDefault(); w.webContents.setZoomLevel(w.webContents.getZoomLevel() + 0.5); }
    else if ((k.control || k.meta) && k.key === '-') { e.preventDefault(); w.webContents.setZoomLevel(w.webContents.getZoomLevel() - 0.5); }
    else if ((k.control || k.meta) && k.key === '0') { e.preventDefault(); w.webContents.setZoomLevel(0); }
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('io.github.inkdoshub');
  fs.mkdirSync(PASTA, { recursive: true });
  estado = lerJson(ESTADO);
  const m = lerJson(MANIFESTO);
  if (m) lista = mapa(m);

  const s = session.defaultSession;
  s.setSpellCheckerEnabled(false);
  // só o site e o PeerJS; nada de telemetria, anúncios ou rastreio
  s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    let host = '';
    try { host = new URL(d.url).hostname; } catch (_) {}
    cb({ cancel: !(LIVRES.has(host) || host === 'localhost' || host === '127.0.0.1') });
  });
  // câmera, microfone, tela cheia, área de transferência e notificações só para o site; localização nunca
  const PODE = new Set(['media', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fileSystem', 'display-capture', 'pointerLock', 'window-management']);
  s.setPermissionRequestHandler((wc, perm, cb, det) => cb(PODE.has(perm) && doSite(det.requestingUrl || wc.getURL())));
  s.setPermissionCheckHandler((wc, perm, origem) => PODE.has(perm) && doSite(origem || ''));
  protocol.handle('https', req => {
    const host = new URL(req.url).hostname;
    if (host === HOST) return responderSite(req);
    if (!LIVRES.has(host)) return new Response('', { status: 403 });
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });

  ipcMain.handle('hub:versao', () => app.getVersion());
  ipcMain.handle('hub:reiniciar', () => { if (instalarAtualizacao(true)) app.quit(); });
  ipcMain.handle('hub:estado', () => (estado ? { versao: estado.versao, grupos: estado.grupos.map(id => ({ id })) } : null));
  ipcMain.handle('hub:espaco', async () => {
    let usado = 0;
    for (const rel of Object.keys((estado && estado.arquivos) || {})) { const a = lista && lista.mapa.get(rel); if (a) usado += a[1]; }
    let livre = 0;
    try { const st = await fsp.statfs(PASTA); livre = st.bavail * st.bsize; } catch (_) {}
    return { usado, livre };
  });
  ipcMain.handle('hub:sincronizar', (e, ids) => sincronizar(ids, p => { if (!e.sender.isDestroyed()) e.sender.send('hub:progresso', p); }));

  janelaPrincipal = new BrowserWindow(opcoes(1100, 760));
  cuidar(janelaPrincipal);
  // sem internet na primeira vez: avisa na própria janela e tenta de novo sozinho
  janelaPrincipal.webContents.on('did-fail-load', (_e, codigo, _d, url, principalFrame) => {
    if (!principalFrame || codigo === -3 || !doSite(url)) return;
    janelaPrincipal.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:15px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#444;background:#f2f2f7"><p>InkDOS Hub: sem internet para a primeira abertura. Tentando de novo… · No internet for the first start. Retrying…</p></body>'));
    setTimeout(() => { if (principal()) janelaPrincipal.loadURL(SITE); }, 5000);
  });
  janelaPrincipal.loadURL(SITE);

  // versão nova da carcaça: procura 20 s depois de abrir e a cada 6 horas; o aviso volta se a tela recarregar
  janelaPrincipal.webContents.on('did-finish-load', mostrarAvisoApp);
  setTimeout(procurarVersaoNova, 20000);
  setInterval(procurarVersaoNova, 6 * 3600e3);

  // primeira vez (ou depois de limpar): guarda a tela inicial e os apps leves para abrir sem internet
  if (!estado) sincronizar([]).catch(() => {});
});
app.on('window-all-closed', () => app.quit());
// atualização baixada e a pessoa não reiniciou: instala em silêncio ao fechar (abre já na versão nova da próxima vez)
app.on('will-quit', () => { instalarAtualizacao(false); });
