// InkDOS Hub for Windows: the same site (https://inkdoshub.github.io/), with the same apps, in its own window.
//
// - The installer ships only this shell. The home screen and the apps come from the site and are stored on disk
//   (%LOCALAPPDATA%\InkDOS Hub\site) when the person ticks the green check in ☰ › "Offline".
//   Each downloaded file is checked against the SHA-256 in the site list (inicio/manifesto.json); if it does not match, it is not used.
// - Requests to inkdoshub.github.io go through here: what is stored opens from disk (works offline),
//   the rest comes from the site, also checked. Update = the same "Update available" as the home screen.
// - No telemetry: Chromium does not talk to Google or Microsoft (background services off) and the network
//   only reaches the LIVRES addresses; everything else is blocked.
// - Each app opens in its own window (own process); several at the same time.
'use strict';
const { app, BrowserWindow, protocol, net, session, shell, ipcMain, Menu, dialog, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

const HOST = 'inkdoshub.github.io';
const SITE = 'https://' + HOST + '/';
// testing only: fetch the files from another address (e.g. http://127.0.0.1:8765/), keeping the site address in the windows
const ORIGEM = process.env.INKHUB_ORIGEM || SITE;
// the only network destinations: the site and the Transfer and Webcam connection server (PeerJS)
const LIVRES = new Set([HOST, '0.peerjs.com']);
const LEVE = 1e6; // groups smaller than this are always stored with the home screen (same as the site)

// ---------- light and private: turns off Chromium background services ----------
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
app.on('second-instance', (_e, argv) => {
  if (!app.isReady()) return;
  const arqs = arquivosDe(argv);
  if (arqs.length) return arqs.forEach(abrirArquivo);
  const w = principal();
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else abrirInicio();
});

// ---------- estado guardado ----------
let estado = null;   // { versao, grupos: [ids], arquivos: { caminho: h16 } }
let lista = null;    // site manifest in memory + map path -> [bytes, h16, sha]
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

// downloads a file from the site and checks the SHA-256 ("?inkoff=" ensures the new version, no stale CDN copy)
async function baixarConferido(a) {
  const r = await net.fetch(ORIGEM + encodeURI(a[0]) + '?inkoff=' + a[2], { bypassCustomProtocolHandlers: true});
  if (!r.ok) throw new Error(a[0] + ': ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  if (a[3] && sha256(b) !== a[3]) throw new Error(a[0] + ': SHA-256 mismatch');
  return b;
}

function seguro(rel) {
  const f = path.resolve(PASTA, rel);
  return f.startsWith(PASTA + path.sep) ? f : null;
}

// ---------- store on disk: the chosen groups (plus the home screen and the light apps) ----------
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
    // deletes what is no longer part of it
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

// ---------- requests to the site ----------
async function responderSite(req) {
  const u = new URL(req.url);
  let rel = decodeURIComponent(u.pathname.slice(1));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const f = seguro(rel);
  if (!f) return new Response('', { status: 400 });

  // the site list always comes fresh (this is how the home screen learns there is a new version)
  if (rel === 'inicio/manifesto.json') {
    try { await manifestoDoSite(); } catch (_) {}
    try { return new Response(await fsp.readFile(MANIFESTO), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
    catch (_) { return new Response('', { status: 503 }); }
  }
  // stored on disk: opens from here, without internet
  if (estado && estado.arquivos[rel] && req.method === 'GET') {
    try { return new Response(await fsp.readFile(f), { headers: { 'Content-Type': tipo(rel) } }); } catch (_) {}
  }
  // not stored: comes from the site, checked by SHA-256 when it is in the list
  const a = lista && lista.mapa.get(rel);
  if (a && req.method === 'GET') {
    try {
      return new Response(await baixarConferido(a), { headers: { 'Content-Type': tipo(rel) } });
    } catch (e) {
      // the list may have changed on the site after the app opened: fetch it again and retry once
      try {
        await manifestoDoSite();
        const b = lista.mapa.get(rel);
        if (b) return new Response(await baixarConferido(b), { headers: { 'Content-Type': tipo(rel) } });
      } catch (_) {}
      if (/SHA-256/.test(e.message)) return new Response('InkDOS Hub: ' + e.message, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return semInternet(rel, e);
    }
  }
  // outside the list (language packs, new files): straight from the site
  try {
    if (ORIGEM !== SITE) return await net.fetch(ORIGEM + rel + u.search, { bypassCustomProtocolHandlers: true });
    return await net.fetch(req, { bypassCustomProtocolHandlers: true });
  } catch (e) { return semInternet(rel, e); }
}
// page without internet and app not stored: explain instead of showing a raw error
function semInternet(rel, e) {
  if (!/\.html?$/.test(rel)) return new Response('', { status: 503 });
  const html = '<!doctype html><meta charset="utf-8"><title>InkDOS Hub</title><body style="font:15px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#3a3a3c;background:#f2f2f7;text-align:center">' +
    '<div><p><b>Sem internet · No internet</b></p><p>Este app ainda não está guardado neste PC. Na tela inicial, abra ☰ › Offline e marque o app para usar sem internet.</p>' +
    '<p>This app is not saved on this PC yet. On the home screen, open ☰ › Offline and check the app to use it without internet.</p></div></body>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ---------- Webcam: on Windows opens the native app (virtual camera), not the iPhone page ----------
// Downloads InkDOSHub-Webcam-Windows.zip from the webcam-windows release, checks the published SHA-256, extracts to
// %LOCALAPPDATA%\InkDOS Hub\webcam and opens it. Next times it only opens (and updates if the release changed).
const WEBCAM = 'https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/webcam-windows/InkDOSHub-Webcam-Windows.zip';
const ehWebcam = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/apps/webcam/'); } catch (_) { return false; } };
let webcamOcupada = false;
// Downloads from GitHub releases: Electron's fetch first; if it fails (proxy, antivirus, redirect), Windows' own curl.exe.
async function baixarBuf(url) {
  try {
    const r = await session.fromPartition('inkhub-baixar').fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
  } catch (_) {}
  const tmp = path.join(app.getPath('temp'), 'inkhub-' + crypto.randomBytes(6).toString('hex'));
  await new Promise((ok, falha) => cp.execFile('curl.exe', ['-fsSL', '--retry', '2', '-o', tmp, url], { windowsHide: true, timeout: 20 * 60000 }, e => (e ? falha(new Error('download: ' + e.message.split('\n')[0])) : ok())));
  try { return await fsp.readFile(tmp); } finally { fsp.rm(tmp, { force: true }).catch(() => {}); }
}
const baixarSha = async url => { try { const t = (await baixarBuf(url + '.sha256')).toString().trim().split(/\s+/)[0].toLowerCase(); return /^[0-9a-f]{64}$/.test(t) ? t : null; } catch (_) { return null; } };
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
    let exe = acharExe(pasta);
    const remoto = await baixarSha(WEBCAM);
    const local = fs.existsSync(marca) ? fs.readFileSync(marca, 'utf8').trim() : '';
    if (remoto && (!exe || remoto !== local)) {
      dizer(pt ? 'Baixando o app da Webcam para Windows…' : 'Downloading the Webcam app for Windows…');
      const zip = await baixarBuf(WEBCAM);
      if (sha256(zip) !== remoto) throw new Error('SHA-256');
      dizer(pt ? 'SHA-256 conferido ✓ Instalando…' : 'SHA-256 verified ✓ Installing…');
      const novo = pasta + '.novo', arq = path.join(app.getPath('userData'), 'webcam.zip');
      await fsp.rm(novo, { recursive: true, force: true });
      await fsp.writeFile(arq, zip);
      await new Promise((ok, falha) => require('child_process').execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:INK_ZIP -DestinationPath $env:INK_DEST -Force'],
        { env: Object.assign({}, process.env, { INK_ZIP: arq, INK_DEST: novo }), windowsHide: true }, e => (e ? falha(e) : ok())));
      await fsp.rm(arq, { force: true });
      if (!acharExe(novo)) throw new Error('package without the app');
      try {
        await fsp.rm(pasta, { recursive: true, force: true });
        await fsp.rename(novo, pasta);
        await fsp.writeFile(marca, remoto);
      } catch (_) { /* app open: keep the previous version this time */ await fsp.rm(novo, { recursive: true, force: true }); }
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

// ---------- Terminal: on Windows uses Windows' own Linux (WSL), with near-native power ----------
// With WSL installed, opens Linux in Windows Terminal. Without it, explains and installs (wsl --install: asks for
// administrator once, downloads the official Ubuntu from Microsoft and may ask to restart). The site terminal remains an option.
const ehTerminal = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/terminal/'); } catch (_) { return false; } };
const cp = require('child_process');
function distrosWsl() {
  return new Promise(ok => {
    cp.execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', windowsHide: true, timeout: 15000 }, (e, saida) => {
      if (e || !saida) return ok([]);
      ok(saida.toString('utf16le').replace(/\0/g, '').split(/\r?\n/).map(x => x.trim()).filter(Boolean));
    });
  });
}
function abrirLinux() {
  const wt = cp.spawn('wt.exe', ['wsl.exe', '--cd', '~'], { detached: true, stdio: 'ignore', windowsHide: false });
  wt.on('error', () => cp.spawn('cmd.exe', ['/c', 'start', '""', 'wsl.exe', '--cd', '~'], { detached: true, stdio: 'ignore' }).unref());
  wt.unref();
}
function terminalDoSite() {
  const w = new BrowserWindow(opcoes(1100, 760));
  w.versaoDoSite = true;
  cuidar(w);
  w.loadURL(SITE + 'terminal/');
}
let janelaTerminal = null;
async function abrirTerminal() {
  if (process.platform !== 'win32') return terminalDoSite();
  if ((await distrosWsl()).length) return abrirLinux();
  if (janelaTerminal && !janelaTerminal.isDestroyed()) return janelaTerminal.focus();
  const pt = /^pt/i.test(app.getLocale());
  const T = pt ? {
    titulo: 'Linux do Windows (WSL)',
    texto: 'O Terminal usa o Linux do próprio Windows, bem mais rápido que o do site. Ele ainda não está instalado neste PC.',
    detalhe: 'A instalação pede administrador uma vez, baixa o Ubuntu oficial da Microsoft (uns 500 MB) e pode pedir para reiniciar o PC.',
    instalar: 'Instalar o Linux do Windows', site: 'Usar o terminal do site',
    instalando: 'Instalando… Siga a janela que abriu. Quando terminar (e reiniciar, se o Windows pedir), toque no Terminal de novo.',
    erro: 'A instalação não começou (o administrador foi recusado?). Tente de novo ou use o terminal do site.'
  } : {
    titulo: 'Windows Linux (WSL)',
    texto: 'The Terminal uses the Linux built into Windows, much faster than the website one. It is not installed on this PC yet.',
    detalhe: 'Installing asks for administrator once, downloads the official Ubuntu from Microsoft (about 500 MB) and may ask you to restart the PC.',
    instalar: 'Install Windows Linux', site: 'Use the website terminal',
    instalando: 'Installing… Follow the window that opened. When it finishes (and after restarting, if Windows asks), tap Terminal again.',
    erro: 'Installation did not start (administrator declined?). Try again or use the website terminal.'
  };
  janelaTerminal = janelaEscolha(T, dizer => {
    dizer(T.instalando);
    cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Start-Process -FilePath wsl.exe -ArgumentList '--install','-d','Ubuntu' -Verb RunAs"],
      { windowsHide: true }, err => { if (err) dizer(T.erro); });
  }, terminalDoSite);
}

// small window with an explanation and two buttons: install the native version or use the site one
function janelaEscolha(T, aoInstalar, aoSite) {
  const bt = 'display:block;width:100%;margin:8px 0;padding:11px;border-radius:10px;font:inherit;font-weight:600;text-decoration:none;text-align:center;box-sizing:border-box';
  const html = '<!doctype html><meta charset="utf-8"><title>' + T.titulo + '</title><body style="font:14px -apple-system,Segoe UI,sans-serif;margin:0;padding:22px;background:#f2f2f7;color:#1c1c1e">' +
    '<h3 style="margin:0 0 10px">' + T.titulo + '</h3><p>' + T.texto + '</p><p style="color:#636366">' + T.detalhe + '</p>' +
    '<a href="https://inkhub.acao/instalar" style="' + bt + ';background:#0a84ff;color:#fff">' + T.instalar + '</a>' +
    '<a href="https://inkhub.acao/site" style="' + bt + ';background:#fff;color:#1c1c1e;border:1px solid #d1d1d6">' + T.site + '</a>' +
    '<p id="t" style="color:#636366;min-height:3em"></p></body>';
  const w = new BrowserWindow({ width: 460, height: 420, resizable: false, maximizable: false, icon: ICONE, autoHideMenuBar: true, title: T.titulo, backgroundColor: '#f2f2f7', webPreferences: { sandbox: true, contextIsolation: true } });
  const dizer = txt => w.isDestroyed() || w.webContents.executeJavaScript('document.getElementById("t").textContent=' + JSON.stringify(txt)).catch(() => {});
  let ocupada = false;
  w.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (url.startsWith('https://inkhub.acao/site')) { w.close(); aoSite(); return; }
    if (url.startsWith('https://inkhub.acao/instalar') && !ocupada) { ocupada = true; Promise.resolve(aoInstalar(dizer, w)).finally(() => { ocupada = false; }); }
  });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return w;
}

// ---------- Code: on Windows uses native VS Code (much lighter and faster than the page) ----------
// With VS Code installed, opens it. Without it, offers to install the official one from Microsoft (per-user installer, no
// administrator; the SHA-256 comes from Microsoft itself and is checked) with telemetry already off. The site Code app remains an option.
const ehCodigo = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/apps/codigo/'); } catch (_) { return false; } };
function acharVsCode() {
  const l = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft VS Code', 'Code.exe')];
  return l.find(f => { try { return fs.existsSync(f); } catch (_) { return false; } }) || null;
}
function codigoDoSite() {
  const w = new BrowserWindow(opcoes(1200, 820));
  w.versaoDoSite = true; // the person chose the site version: do not redirect to native inside this window
  cuidar(w);
  w.loadURL(SITE + 'apps/codigo/');
}
// VS Code telemetry off (only if the person has not chosen anything about it yet)
function vsCodeSemTelemetria() {
  try {
    const f = path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json');
    let txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (/telemetry\.telemetryLevel/.test(txt)) return;
    if (!txt.trim()) txt = '{\n  "telemetry.telemetryLevel": "off"\n}\n';
    else txt = txt.replace(/\{/, '{\n  "telemetry.telemetryLevel": "off",');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, txt);
  } catch (_) {}
}
let janelaCodigo = null;
function abrirCodigo() {
  if (process.platform !== 'win32') return codigoDoSite();
  const exe = acharVsCode();
  if (exe) { vsCodeSemTelemetria(); return void shell.openPath(exe); }
  if (janelaCodigo && !janelaCodigo.isDestroyed()) return janelaCodigo.focus();
  const pt = /^pt/i.test(app.getLocale());
  const T = pt ? {
    titulo: 'VS Code para Windows',
    texto: 'O Código abre no VS Code instalado no Windows: bem mais leve e rápido que o da página, com terminal e extensões. Ele ainda não está instalado neste PC.',
    detalhe: 'Baixa o instalador oficial da Microsoft (uns 100 MB), confere o SHA-256 e instala só para você, sem administrador. A telemetria do VS Code já vem desligada.',
    instalar: 'Instalar o VS Code', site: 'Usar o Código do site',
    baixando: 'Baixando o VS Code… ', instalando: 'SHA-256 conferido ✓ Instalando…', erro: 'Não deu para instalar: '
  } : {
    titulo: 'VS Code for Windows',
    texto: 'Code opens in the VS Code installed on Windows: much lighter and faster than the web page, with terminal and extensions. It is not installed on this PC yet.',
    detalhe: 'Downloads the official installer from Microsoft (about 100 MB), checks its SHA-256 and installs it just for you, without administrator. VS Code telemetry comes turned off.',
    instalar: 'Install VS Code', site: 'Use the website Code',
    baixando: 'Downloading VS Code… ', instalando: 'SHA-256 verified ✓ Installing…', erro: 'Could not install: '
  };
  janelaCodigo = janelaEscolha(T, async (dizer, w) => {
    try {
      const baixar = session.fromPartition('inkhub-baixar');
      const info = await (await baixar.fetch('https://update.code.visualstudio.com/api/update/win32-x64-user/stable/latest')).json();
      if (!info || !/^https:\/\//.test(info.url || '') || !/^[0-9a-f]{64}$/.test(info.sha256hash || '')) throw new Error('Microsoft');
      const r = await baixar.fetch(info.url);
      if (!r.ok) throw new Error('download ' + r.status);
      const total = Number(r.headers.get('content-length')) || 0, partes = [], leitor = r.body.getReader();
      let feito = 0, ultimo = -1;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        partes.push(Buffer.from(value)); feito += value.length;
        const pct = total ? Math.floor(feito * 100 / total) : 0;
        if (pct !== ultimo && pct % 5 === 0) { ultimo = pct; dizer(T.baixando + pct + '%'); }
      }
      const b = Buffer.concat(partes);
      if (sha256(b) !== info.sha256hash) throw new Error('SHA-256');
      dizer(T.instalando);
      const f = path.join(app.getPath('temp'), 'VSCodeUserSetup-' + (info.productVersion || 'x') + '.exe');
      await fsp.writeFile(f, b);
      vsCodeSemTelemetria();
      await new Promise((ok, falha) => cp.execFile(f, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/MERGETASKS=!runcode,addcontextmenufiles,addcontextmenufolders,addtopath'], { windowsHide: true }, e => (e ? falha(e) : ok())));
      fsp.rm(f, { force: true }).catch(() => {});
      const exe2 = acharVsCode();
      if (!exe2) throw new Error('Code.exe');
      if (!w.isDestroyed()) w.close();
      shell.openPath(exe2);
    } catch (e) { dizer(T.erro + e.message); }
  }, codigoDoSite);
}

// ---------- Transfer: on Windows uses the native app (direct Wi-Fi, faster than the page) ----------
// Downloads the single .exe from the transferir-windows release, checks its SHA-256 and opens it. Updates when the release changes.
const TRANSFERIR = 'https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/transferir-windows/InkDOSHub-Transferir.exe';
const ehTransferir = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/apps/transferir/'); } catch (_) { return false; } };
let transferirOcupado = false;
async function abrirTransferir() {
  if (process.platform !== 'win32') { const w = new BrowserWindow(opcoes(1100, 760)); w.versaoDoSite = true; cuidar(w); return void w.loadURL(SITE + 'apps/transferir/'); }
  if (transferirOcupado) return;
  transferirOcupado = true;
  const pasta = path.join(app.getPath('userData'), 'transferir');
  const exe = path.join(pasta, 'InkDOS Hub Transferir.exe'), marca = path.join(pasta, 'versao.sha256');
  try {
    const remoto = await baixarSha(TRANSFERIR);
    const local = fs.existsSync(marca) ? fs.readFileSync(marca, 'utf8').trim() : '';
    if (remoto && (!fs.existsSync(exe) || remoto !== local)) {
      const b = await baixarBuf(TRANSFERIR);
      if (sha256(b) !== remoto) throw new Error('SHA-256');
      await fsp.mkdir(pasta, { recursive: true });
      try { await fsp.writeFile(exe, b); await fsp.writeFile(marca, remoto); } catch (_) { /* app open: keep the previous version */ }
    }
    if (!fs.existsSync(exe)) throw new Error('offline');
    const err = await shell.openPath(exe);
    if (err) throw new Error(err);
  } catch (e) {
    const pt = /^pt/i.test(app.getLocale());
    dialog.showMessageBox({ type: 'warning', title: 'InkDOS Hub', message: pt ? 'Não deu para abrir o Transferir.' : 'Could not open Transfer.',
      detail: e.message === 'SHA-256' ? (pt ? 'O arquivo baixado não confere (SHA-256). Tente de novo.' : 'The download does not match its SHA-256. Try again.') : (pt ? 'Confira a internet e tente de novo.' : 'Check the internet and try again.') });
  } finally { transferirOcupado = false; }
}

// ---------- Emulators: on Windows the Wine app is not needed (Windows runs .exe), so it opens this window instead ----------
// Well-known open source virtual machines and emulators, installed from the official source by winget (Windows' own
// package manager, which checks the publisher's hash). If winget fails, opens the official download page.
// Games, ROMs, BIOS and system images are not included: the person uses their own.
const ehWine = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/apps/wine/'); } catch (_) { return false; } };
const EMULADORES = [
  { g: 'vm', nome: 'VirtualBox', id: 'Oracle.VirtualBox', menu: 'VirtualBox', site: 'https://www.virtualbox.org/wiki/Downloads', pt: 'Máquina virtual fácil: Linux, Windows e outros sistemas, com várias configurações.', en: 'Easy virtual machine: Linux, Windows and other systems, with many settings.' },
  { g: 'vm', nome: 'QEMU', id: 'SoftwareFreedomConservancy.QEMU', menu: 'QEMU', site: 'https://www.qemu.org/download/#windows', pt: 'Emula quase qualquer processador (x86, ARM, RISC-V…). Mais técnico, por linha de comando.', en: 'Emulates almost any processor (x86, ARM, RISC-V…). More technical, command line.' },
  { g: 'vm', nome: 'Linux do Windows (WSL)', nomeEn: 'Windows Linux (WSL)', wsl: true, pt: 'Linux da Microsoft com desempenho quase nativo. É o mesmo do app Terminal.', en: 'Microsoft Linux with near-native performance. Same as the Terminal app.' },
  { g: 'mac', nome: 'QEMU + OpenCore (OSX-KVM)', id: 'SoftwareFreedomConservancy.QEMU', menu: 'QEMU', site: 'https://github.com/kholia/OSX-KVM', pt: 'Projeto open source mais usado para isso. Instala o QEMU e abre o guia. A Apple só permite o macOS em Mac: use por sua conta e risco.', en: 'Most used open source project for this. Installs QEMU and opens the guide. Apple only allows macOS on Macs: use at your own risk.' },
  { g: 'jogo', nome: 'RetroArch', id: 'Libretro.RetroArch', menu: 'RetroArch', site: 'https://www.retroarch.com/?page=platforms', pt: 'Consoles antigos em um app só (NES, SNES, Mega Drive, Game Boy, N64…).', en: 'Classic consoles in one app (NES, SNES, Genesis, Game Boy, N64…).' },
  { g: 'jogo', nome: 'DuckStation', id: 'Stenzek.DuckStation', menu: 'DuckStation', site: 'https://www.duckstation.org/', pt: 'PlayStation 1.', en: 'PlayStation 1.' },
  { g: 'jogo', nome: 'PCSX2', id: 'PCSX2Team.PCSX2', menu: 'PCSX2', site: 'https://pcsx2.net/downloads', pt: 'PlayStation 2.', en: 'PlayStation 2.' },
  { g: 'jogo', nome: 'RPCS3', id: 'RPCS3.RPCS3', menu: 'RPCS3', site: 'https://rpcs3.net/download', pt: 'PlayStation 3 (pede um PC forte).', en: 'PlayStation 3 (needs a strong PC).' },
  { g: 'jogo', nome: 'PPSSPP', id: 'PPSSPPTeam.PPSSPP', menu: 'PPSSPP', site: 'https://www.ppsspp.org/download/', pt: 'PSP.', en: 'PSP.' },
  { g: 'jogo', nome: 'Dolphin', id: 'DolphinEmulator.Dolphin', menu: 'Dolphin', site: 'https://dolphin-emu.org/download/', pt: 'GameCube e Wii.', en: 'GameCube and Wii.' },
  { g: 'jogo', nome: 'Cemu', id: 'Cemu.Cemu', menu: 'Cemu', site: 'https://cemu.info/', pt: 'Wii U.', en: 'Wii U.' },
  { g: 'jogo', nome: 'xemu', id: 'xemu-project.xemu', menu: 'xemu', site: 'https://xemu.app/', pt: 'Xbox original.', en: 'Original Xbox.' }
];
// Start menu apps (name + id), to know what is installed and to open it
function appsDoMenu() {
  return new Promise(ok => cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 30000, maxBuffer: 8 << 20 }, (e, s) => { try { const l = JSON.parse(s); ok(Array.isArray(l) ? l : [l]); } catch (_) { ok([]); } }));
}
const doMenu = (lista, x) => x.menu && lista.find(a => String(a.Name || '').toLowerCase().includes(x.menu.toLowerCase()));
let janelaEmuladores = null;
async function abrirEmuladores() {
  if (process.platform !== 'win32') { const w = new BrowserWindow(opcoes(1200, 820)); w.versaoDoSite = true; cuidar(w); return void w.loadURL(SITE + 'apps/wine/'); }
  if (janelaEmuladores && !janelaEmuladores.isDestroyed()) return janelaEmuladores.focus();
  const pt = /^pt/i.test(app.getLocale());
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const grupos = pt ? { vm: 'Máquinas virtuais (Linux, Windows e outros)', mac: 'macOS (por sua conta e risco)', jogo: 'Consoles' } : { vm: 'Virtual machines (Linux, Windows and others)', mac: 'macOS (at your own risk)', jogo: 'Consoles' };
  const bt = 'padding:7px 14px;border-radius:8px;font-weight:600;text-decoration:none;white-space:nowrap;background:#0a84ff;color:#fff';
  let html = '<!doctype html><meta charset="utf-8"><title>' + (pt ? 'Emuladores' : 'Emulators') + '</title><body style="font:14px -apple-system,Segoe UI,sans-serif;margin:0;padding:20px 22px;background:#f2f2f7;color:#1c1c1e">' +
    '<h2 style="margin:0 0 4px">' + (pt ? 'Emuladores e máquinas virtuais' : 'Emulators and virtual machines') + '</h2>' +
    '<p style="color:#636366;margin:0 0 6px">' + (pt ? 'Instalados da fonte oficial pelo winget do Windows. Jogos, ROMs, BIOS e imagens de sistema não vêm junto: use os seus.' : 'Installed from the official source by Windows winget. Games, ROMs, BIOS and system images are not included: use your own.') + '</p>';
  for (const g of Object.keys(grupos)) {
    html += '<h3 style="margin:18px 0 6px;font-size:13px;color:#636366;text-transform:uppercase">' + grupos[g] + '</h3><div style="background:#fff;border-radius:12px">';
    EMULADORES.forEach((x, i) => {
      if (x.g !== g) return;
      html += '<div style="display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid #e5e5ea"><div style="flex:1"><b>' + esc(pt ? x.nome : (x.nomeEn || x.nome)) + '</b><br><span style="color:#636366;font-size:13px">' + esc(pt ? x.pt : x.en) + '</span></div>' +
        '<a id="b' + i + '" href="https://inkhub.acao/usar?i=' + i + '" style="' + bt + '">…</a></div>';
    });
    html += '</div>';
  }
  html += '<p id="t" style="color:#636366;min-height:2em"></p></body>';
  const w = janelaEmuladores = new BrowserWindow({ width: 620, height: 760, icon: ICONE, autoHideMenuBar: true, title: pt ? 'Emuladores' : 'Emulators', backgroundColor: '#f2f2f7', webPreferences: { sandbox: true, contextIsolation: true } });
  const js = c => (w.isDestroyed() ? Promise.resolve() : w.webContents.executeJavaScript(c).catch(() => {}));
  const dizer = txt => js('document.getElementById("t").textContent=' + JSON.stringify(txt));
  let menu = [];
  const marcar = async () => {
    menu = await appsDoMenu();
    const wsl = (await distrosWsl()).length > 0;
    EMULADORES.forEach((x, i) => {
      const tem = x.wsl ? wsl : !!doMenu(menu, x);
      const rot = x.g === 'mac' ? (pt ? (tem ? 'Ver guia' : 'Instalar') : (tem ? 'Guide' : 'Install')) : (tem ? (pt ? 'Abrir' : 'Open') : (pt ? 'Instalar' : 'Install'));
      js('var b=document.getElementById("b' + i + '");b.textContent=' + JSON.stringify(rot) + ';b.style.background=' + JSON.stringify(tem ? '#34c759' : '#0a84ff'));
    });
  };
  const ocupados = new Set();
  w.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    const i = Number(new URL(url).searchParams.get('i')), x = EMULADORES[i];
    if (!x || ocupados.has(i)) return;
    if (x.wsl) return void abrirTerminal();
    const a = doMenu(menu, x);
    if (a) {
      if (x.g === 'mac') shell.openExternal(x.site);
      else cp.spawn('explorer.exe', ['shell:AppsFolder\\' + a.AppID], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    ocupados.add(i);
    dizer((pt ? 'Instalando ' : 'Installing ') + x.nome + (pt ? ' pelo winget… o Windows pode pedir permissão.' : ' with winget… Windows may ask for permission.'));
    cp.execFile('winget.exe', ['install', '--id', x.id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
      { windowsHide: true, timeout: 30 * 60000 }, async err => {
        ocupados.delete(i);
        if (err) { dizer((pt ? 'O winget não conseguiu instalar. Abrindo a página oficial de ' : 'winget could not install it. Opening the official page of ') + x.nome + '.'); shell.openExternal(x.site); return; }
        dizer(x.nome + (pt ? ' instalado ✓' : ' installed ✓'));
        if (x.g === 'mac') shell.openExternal(x.site);
        await marcar();
      });
  });
  w.on('closed', () => { janelaEmuladores = null; });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  marcar();
}

// ---------- the shell updates itself ----------
// Reads versao.json from the hub-windows release; if newer, downloads the installer in the background, checks the SHA-256
// and shows "New app version · Restart" on the home screen. If the person does not tap, installs when the Hub closes.
const VERSAO_URL = 'https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/hub-windows/versao.json';
let instaladorPronto = null;
const maior = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
// returns 'atual' (already the newest), 'pronto' (installer downloaded and checked) or 'erro'
let procurando = null;
function procurarVersaoNova(progresso) {
  if (instaladorPronto) return Promise.resolve('pronto');
  if (!app.isPackaged || process.platform !== 'win32') return Promise.resolve('atual');
  if (procurando) return procurando;
  procurando = (async () => {
    try {
      const baixar = session.fromPartition('inkhub-baixar');
      const r = await baixar.fetch(VERSAO_URL + '?t=' + Date.now());
      if (!r.ok) return 'erro';
      const v = await r.json();
      if (!v || !/^[0-9a-f]{64}$/.test(v.sha256 || '')) return 'erro';
      if (!maior(v.versao, app.getVersion())) return 'atual';
      const s = await baixar.fetch(VERSAO_URL.replace('versao.json', v.arquivo || 'InkDOSHub-Setup.exe'));
      if (!s.ok) return 'erro';
      const total = Number(s.headers.get('content-length')) || 0, partes = [], leitor = s.body.getReader();
      let feito = 0;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        partes.push(Buffer.from(value)); feito += value.length;
        if (progresso && total) progresso(Math.min(99, Math.floor(feito * 100 / total)));
      }
      const b = Buffer.concat(partes);
      if (sha256(b) !== v.sha256) return 'erro'; // mismatch: try again next time
      const f = path.join(app.getPath('temp'), 'InkDOSHub-Setup-' + v.versao + '.exe');
      await fsp.writeFile(f, b);
      instaladorPronto = f;
      mostrarAvisoApp();
      return 'pronto';
    } catch (_) { return 'erro'; } finally { procurando = null; }
  })();
  return procurando;
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
  // Document with unsaved changes: the app asks to confirm leaving (beforeunload). Electron alone
  // just cancels the close silently, and the window looked frozen. Here Windows asks.
  w.webContents.on('will-prevent-unload', e => {
    const pt = /^pt/i.test(app.getLocale());
    const r = dialog.showMessageBoxSync(w, {
      type: 'question', title: 'InkDOS Hub', noLink: true, defaultId: 1, cancelId: 1,
      buttons: pt ? ['Fechar sem salvar', 'Cancelar'] : ['Close without saving', 'Cancel'],
      message: pt ? 'Há alterações não salvas.' : 'There are unsaved changes.',
      detail: pt ? 'Se fechar agora, as alterações desde o último salvamento se perdem.' : 'If you close now, changes since the last save are lost.'
    });
    if (r === 0) e.preventDefault(); // close anyway
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (ehTerminal(url)) { abrirTerminal(); return { action: 'deny' }; }
    if (ehCodigo(url)) { abrirCodigo(); return { action: 'deny' }; }
    if (ehWine(url)) { abrirEmuladores(); return { action: 'deny' }; }
    if (url === 'about:blank' || doSite(url)) return { action: 'allow', overrideBrowserWindowOptions: opcoes(1200, 820) };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('did-create-window', cuidar);
  w.webContents.on('will-navigate', (e, url) => {
    if (!w.versaoDoSite && (ehTerminal(url) || ehCodigo(url) || ehWine(url))) {
      e.preventDefault();
      if (ehTerminal(url)) abrirTerminal(); else if (ehCodigo(url)) abrirCodigo(); else abrirEmuladores();
      // the home screen opens an empty window and then sends the address: that window closes
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
  // only the site and PeerJS; no telemetry, ads or tracking
  s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    let host = '';
    try { host = new URL(d.url).hostname; } catch (_) {}
    cb({ cancel: !(LIVRES.has(host) || host === 'localhost' || host === '127.0.0.1') });
  });
  // camera, microphone, full screen, clipboard and notifications only for the site; location never
  const PODE = new Set(['media', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fileSystem', 'display-capture', 'pointerLock', 'window-management']);
  s.setPermissionRequestHandler((wc, perm, cb, det) => cb(PODE.has(perm) && doSite(det.requestingUrl || wc.getURL())));
  s.setPermissionCheckHandler((wc, perm, origem) => PODE.has(perm) && doSite(origem || ''));
  // audio recorder: without this Electron's getDisplayMedia answers "Not supported"; provides the main screen + Windows sound (loopback)
  s.setDisplayMediaRequestHandler((req, cb) => {
    if (!doSite(req.securityOrigin || (req.frame && req.frame.url) || '')) return cb({});
    desktopCapturer.getSources({ types: ['screen'] }).then(f => cb(f[0] ? { video: f[0], audio: 'loopback' } : {})).catch(() => cb({}));
  });
  protocol.handle('https', req => {
    const host = new URL(req.url).hostname;
    if (host === HOST) return responderSite(req);
    if (!LIVRES.has(host)) return new Response('', { status: 403 });
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });

  // Recorder: sound from a single program (per-process WASAPI, Windows 10 2004+). PCM 16-bit, 48 kHz, stereo.
  const audioExe = n => path.join(path.dirname(process.execPath), 'audio', n);
  const capturas = new Map();
  ipcMain.handle('hub:audio-apps', e => new Promise(ok => {
    if (!doSite(e.senderFrame.url)) return ok([]);
    let txt = '';
    const p = require('child_process').spawn(audioExe('ProcessList.exe'), [], { windowsHide: true });
    p.stdout.setEncoding('utf8'); p.stdout.on('data', d => { txt += d; });
    p.on('error', () => ok([])); p.on('close', () => {
      const vistos = new Set();
      ok(txt.split('\n').map(l => l.replace('\r', '').split(';')).filter(x => x.length >= 3 && /^\d+$/.test(x[0]) && x[2].trim())
        .map(x => ({ pid: x[0], titulo: x.slice(2).join(';').trim() })).filter(x => !vistos.has(x.pid) && vistos.add(x.pid)));
    });
  }));
  ipcMain.handle('hub:audio-iniciar', (e, pid) => {
    if (!doSite(e.senderFrame.url) || !/^\d+$/.test(String(pid))) return false;
    const wc = e.sender;
    if (capturas.has(wc.id)) capturas.get(wc.id).kill();
    const p = require('child_process').spawn(audioExe('ApplicationLoopback.exe'), [String(pid)], { windowsHide: true });
    capturas.set(wc.id, p);
    p.stdout.on('data', d => { if (!wc.isDestroyed()) wc.send('hub:audio-dado', d); });
    p.on('close', () => { if (capturas.get(wc.id) === p) capturas.delete(wc.id); if (!wc.isDestroyed()) wc.send('hub:audio-fim'); });
    p.on('error', () => {});
    wc.once('destroyed', () => p.kill());
    return true;
  });
  ipcMain.handle('hub:audio-parar', e => { const p = capturas.get(e.sender.id); if (p) p.kill(); return true; });
  ipcMain.handle('hub:versao', () => app.getVersion());
  // Print: Electron has no print preview of its own. The page goes to PDF (with its @page size) and
  // opens in a preview window with the built-in PDF viewer, where it can be printed or saved.
  ipcMain.handle('hub:imprimir', async e => {
    const dados = await e.sender.printToPDF({ printBackground: true, preferCSSPageSize: true });
    const arq = path.join(app.getPath('temp'), 'InkDOS Hub print ' + Date.now() + '.pdf');
    await fs.promises.writeFile(arq, dados);
    const dono = BrowserWindow.fromWebContents(e.sender);
    const w = new BrowserWindow({ width: 900, height: 980, icon: ICONE, autoHideMenuBar: true, title: 'Print preview', parent: dono || undefined, backgroundColor: '#525659', webPreferences: { sandbox: true, contextIsolation: true, plugins: true } });
    w.on('page-title-updated', ev => ev.preventDefault());
    w.on('closed', () => fs.promises.unlink(arq).catch(() => {}));
    await w.loadFile(arq);
    return true;
  });
  ipcMain.handle('hub:reiniciar', () => { if (instalarAtualizacao(true)) app.quit(); });
  // Offline "Update the Windows app" button: checks, downloads (with %), verifies and reinstalls right away
  ipcMain.handle('hub:atualizar-app', async e => {
    const r = await procurarVersaoNova(p => { if (!e.sender.isDestroyed()) e.sender.send('hub:progresso-app', p); });
    if (r === 'pronto') { setTimeout(() => { if (instalarAtualizacao(true)) app.quit(); }, 800); }
    return r;
  });
  ipcMain.handle('hub:estado', () => (estado ? { versao: estado.versao, grupos: estado.grupos.map(id => ({ id })) } : null));
  ipcMain.handle('hub:espaco', async () => {
    let usado = 0;
    for (const rel of Object.keys((estado && estado.arquivos) || {})) { const a = lista && lista.mapa.get(rel); if (a) usado += a[1]; }
    let livre = 0;
    try { const st = await fsp.statfs(PASTA); livre = st.bavail * st.bsize; } catch (_) {}
    return { usado, livre };
  });
  // Offline "Update" also checks for a new version of the app itself (the notice appears once the installer is downloaded)
  ipcMain.handle('hub:sincronizar', (e, ids) => { procurarVersaoNova(); return sincronizar(ids, p => { if (!e.sender.isDestroyed()) e.sender.send('hub:progresso', p); }); });

  // opened by a file (Open with / default app): only that file's app; otherwise, the home screen
  const arqs = arquivosDe(process.argv);
  if (arqs.length) arqs.forEach(abrirArquivo); else abrirInicio();
  // stored apps update by themselves when the site has a new version (before, they stayed old until "Update" was tapped)
  if (estado) manifestoDoSite().then(m => {
    if (!m || m.versao === estado.versao) return;
    return sincronizar(estado.grupos).then(() => { const w = principal(); if (w) w.webContents.reload(); });
  }).catch(() => {});
  setTimeout(procurarVersaoNova, 20000);
  setInterval(procurarVersaoNova, 6 * 3600e3);

  // first time (or after clearing): stores the home screen and the light apps to open without internet
  if (!estado) sincronizar([]).catch(() => {});
});

function abrirInicio() {
  janelaPrincipal = new BrowserWindow(opcoes(1100, 760));
  cuidar(janelaPrincipal);
  // no internet on first run: tells so in the window and retries by itself
  janelaPrincipal.webContents.on('did-fail-load', (_e, codigo, _d, url, principalFrame) => {
    if (!principalFrame || codigo === -3 || !doSite(url)) return;
    janelaPrincipal.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font:15px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#444;background:#f2f2f7"><p>InkDOS Hub: sem internet para a primeira abertura. Tentando de novo… · No internet for the first start. Retrying…</p></body>'));
    setTimeout(() => { if (principal()) janelaPrincipal.loadURL(SITE); }, 5000);
  });
  janelaPrincipal.loadURL(SITE);

  // new shell version: checks 20 s after opening and every 6 hours; the notice comes back if the screen reloads
  janelaPrincipal.webContents.on('did-finish-load', mostrarAvisoApp);
}

// ---------- open a PC file in the right app (double click, "Open with", default app) ----------
// The app opens in its window and the file goes in through the app's own "Open" field (DevTools Protocol, local only):
// nothing is sent out, it is like picking the file on screen.
const APP_DO_TIPO = {};
for (const [url, exts] of [
  ['inkdos/apps/pdf/index.html?suite=1', 'pdf'],
  ['inkdos/apps/documents/index.html?suite=1', 'docx doc odt rtf'],
  ['inkdos/apps/spreadsheets/index.html?suite=1', 'xlsx xls ods csv tsv'],
  ['inkdos/apps/presentations/index.html?suite=1', 'pptx ppt odp'],
  ['inkdos/apps/txt/index.html?suite=1', 'txt xml log md'],
  ['inkdos/apps/epub/index.html?suite=1', 'epub'],
  ['apps/foto/', 'jpg jpeg png gif webp bmp avif heic'],
  ['apps/video/', 'mp4 mov m4v webm mkv'],
  ['apps/musica/', 'mp3 m4a aac wav ogg oga flac opus']
]) for (const x of exts.split(' ')) APP_DO_TIPO[x] = url;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus', pdf: 'application/pdf' };
const extDe = f => path.extname(f).slice(1).toLowerCase();
function arquivosDe(argv) {
  return (argv || []).slice(1).filter(a => a && !a.startsWith('-') && APP_DO_TIPO[extDe(a)] && fs.existsSync(a) && fs.statSync(a).isFile()).map(a => path.resolve(a));
}
// Word, Excel and PowerPoint follow the home screen ☰ choice ("InkDOS fast" or "ArtCraft full",
// localStorage inkdoshub-abrir-office). In ArtCraft the file goes through the "inkdos-tool-handoff" IndexedDB,
// as on the home screen (inicio/lancador.js), and the apps/<editor>/ page hands it to the editor.
const ARTCRAFT = {};
for (const [ed, exts] of [['wordcraft', 'docx doc odt rtf'], ['gridcraft', 'xlsx xls ods csv tsv'], ['deckcraft', 'pptx ppt odp']])
  for (const x of exts.split(' ')) ARTCRAFT[x] = ed;
function abrirArquivo(f) {
  const ed = ARTCRAFT[extDe(f)];
  if (!ed) return abrirNoInkdos(f);
  const w = new BrowserWindow(opcoes(1200, 820));
  cuidar(w);
  w.webContents.once('did-finish-load', async () => {
    try {
      const pref = await w.webContents.executeJavaScript('(function(){try{return localStorage.getItem("inkdoshub-abrir-office")||"artcraft"}catch(_){return "artcraft"}})()');
      if (pref === 'inkdos') { w.destroy(); return abrirNoInkdos(f); }
      const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const dados = fs.readFileSync(f).toString('base64');
      await w.webContents.executeJavaScript('new Promise(function(ok,erro){var b=Uint8Array.from(atob(' + JSON.stringify(dados) + '),function(c){return c.charCodeAt(0)});' +
        'var r=indexedDB.open("inkdos-tool-handoff",1);r.onupgradeneeded=function(){r.result.createObjectStore("files")};r.onerror=function(){erro(r.error)};' +
        'r.onsuccess=function(){var db=r.result,tx=db.transaction("files","readwrite");tx.objectStore("files").put({bytes:b.buffer,type:"",name:' + JSON.stringify(path.basename(f)) + ',at:Date.now()},' + JSON.stringify(id) + ');' +
        'tx.oncomplete=function(){db.close();ok(true)};tx.onerror=function(){db.close();erro(tx.error)}}})');
      w.loadURL(SITE + 'apps/' + ed + '/?inkdos-handoff=' + encodeURIComponent(id));
    } catch (_) { if (!w.isDestroyed()) w.destroy(); abrirNoInkdos(f); }
  });
  w.loadURL(SITE + 'idiomas/pt-BR.json'); // light page from the same site, only to read the choice and store the file
}
function abrirNoInkdos(f) {
  const ext = extDe(f), m = MIME[ext] || '';
  const achar = "(function(x,m){for(const i of document.querySelectorAll('input[type=file]')){const a=(i.accept||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);if(!a.length||a.some(t=>t==='.'+x||t===m||(m&&t.endsWith('/*')&&m.startsWith(t.slice(0,-1)))))return i}return null})(" + JSON.stringify(ext) + ',' + JSON.stringify(m) + ')';
  const w = new BrowserWindow(opcoes(1200, 820));
  cuidar(w);
  w.loadURL(SITE + APP_DO_TIPO[ext]);
  let feito = false;
  const tentar = async () => {
    if (feito || w.isDestroyed()) return;
    const d = w.webContents.debugger;
    try {
      // waits for the app to be ready (on the first visit the page may reload by itself)
      for (let i = 0; i < 60 && !feito; i++) {
        const pronto = await w.webContents.executeJavaScript('document.readyState==="complete"&&!!' + achar).catch(() => false);
        if (pronto) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (feito || w.isDestroyed()) return;
      if (!d.isAttached()) d.attach('1.3');
      await d.sendCommand('DOM.getDocument', { depth: 0 });
      const o = await d.sendCommand('Runtime.evaluate', { expression: achar });
      if (!o.result || !o.result.objectId) throw new Error('no file field');
      await d.sendCommand('DOM.setFileInputFiles', { files: [f], objectId: o.result.objectId });
      feito = true;
    } catch (_) {
      // page reloaded midway: the next load retries
    } finally { try { if (d.isAttached()) d.detach(); } catch (_) {} }
  };
  w.webContents.on('did-finish-load', () => { setTimeout(tentar, 300); });
}
app.on('window-all-closed', () => app.quit());
// update downloaded and the person did not restart: installs silently on close (opens on the new version next time)
app.on('will-quit', () => { instalarAtualizacao(false); });
