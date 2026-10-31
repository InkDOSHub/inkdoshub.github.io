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
const { app, BrowserWindow, protocol, net, session, shell, ipcMain, Menu, dialog } = require('electron');
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
app.on('second-instance', (_e, argv) => {
  if (!app.isReady()) return;
  const arqs = arquivosDe(argv);
  if (arqs.length) return arqs.forEach(abrirArquivo);
  const w = principal();
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else abrirInicio();
});

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

// ---------- Terminal: no Windows usa o Linux do próprio Windows (WSL), com potência quase nativa ----------
// Com o WSL instalado, abre o Linux no Terminal do Windows. Sem ele, explica e instala (wsl --install: pede
// administrador uma vez, baixa o Ubuntu oficial da Microsoft e pode pedir para reiniciar). O terminal do site fica de opção.
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

// janelinha com explicação e dois botões: instalar a versão nativa ou usar a do site
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

// ---------- Código: no Windows usa o VS Code nativo (bem mais leve e rápido que o da página) ----------
// Com o VS Code instalado, abre ele. Sem ele, oferece instalar o oficial da Microsoft (instalador para a pessoa, sem
// administrador; o SHA-256 vem da própria Microsoft e é conferido) já com a telemetria desligada. O Código do site fica de opção.
const ehCodigo = url => { try { const u = new URL(url); return u.hostname === HOST && u.pathname.startsWith('/apps/codigo/'); } catch (_) { return false; } };
function acharVsCode() {
  const l = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft VS Code', 'Code.exe')];
  return l.find(f => { try { return fs.existsSync(f); } catch (_) { return false; } }) || null;
}
function codigoDoSite() {
  const w = new BrowserWindow(opcoes(1200, 820));
  w.versaoDoSite = true; // a pessoa escolheu a do site: não desviar para o nativo dentro desta janela
  cuidar(w);
  w.loadURL(SITE + 'apps/codigo/');
}
// telemetria do VS Code desligada (só se a pessoa ainda não escolheu nada sobre isso)
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
// devolve 'atual' (já é a mais nova), 'pronto' (instalador baixado e conferido) ou 'erro'
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
      if (sha256(b) !== v.sha256) return 'erro'; // não confere: tenta de novo na próxima vez
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
  // Documento com alteração não salva: o app pede para confirmar a saída (beforeunload). O Electron, sozinho,
  // só cancela o fechamento sem avisar, e a janela parecia travada. Aqui o Windows pergunta.
  w.webContents.on('will-prevent-unload', e => {
    const pt = /^pt/i.test(app.getLocale());
    const r = dialog.showMessageBoxSync(w, {
      type: 'question', title: 'InkDOS Hub', noLink: true, defaultId: 1, cancelId: 1,
      buttons: pt ? ['Fechar sem salvar', 'Cancelar'] : ['Close without saving', 'Cancel'],
      message: pt ? 'Há alterações não salvas.' : 'There are unsaved changes.',
      detail: pt ? 'Se fechar agora, as alterações desde o último salvamento se perdem.' : 'If you close now, changes since the last save are lost.'
    });
    if (r === 0) e.preventDefault(); // fecha mesmo assim
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (ehWebcam(url)) { abrirWebcam(); return { action: 'deny' }; }
    if (ehTerminal(url)) { abrirTerminal(); return { action: 'deny' }; }
    if (ehCodigo(url)) { abrirCodigo(); return { action: 'deny' }; }
    if (url === 'about:blank' || doSite(url)) return { action: 'allow', overrideBrowserWindowOptions: opcoes(1200, 820) };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('did-create-window', cuidar);
  w.webContents.on('will-navigate', (e, url) => {
    if (!w.versaoDoSite && (ehWebcam(url) || ehTerminal(url) || ehCodigo(url))) {
      e.preventDefault();
      if (ehWebcam(url)) abrirWebcam(); else if (ehTerminal(url)) abrirTerminal(); else abrirCodigo();
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
  // botão "Atualizar o app do Windows" do Offline: procura, baixa (com %), confere e reinstala na hora
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
  // o "Atualizar" do Offline também procura versão nova do próprio app (o aviso aparece quando o instalador já baixou)
  ipcMain.handle('hub:sincronizar', (e, ids) => { procurarVersaoNova(); return sincronizar(ids, p => { if (!e.sender.isDestroyed()) e.sender.send('hub:progresso', p); }); });

  // aberto por um arquivo (Abrir com / app padrão): só o app daquele arquivo; senão, a tela inicial
  const arqs = arquivosDe(process.argv);
  if (arqs.length) arqs.forEach(abrirArquivo); else abrirInicio();
  setTimeout(procurarVersaoNova, 20000);
  setInterval(procurarVersaoNova, 6 * 3600e3);

  // primeira vez (ou depois de limpar): guarda a tela inicial e os apps leves para abrir sem internet
  if (!estado) sincronizar([]).catch(() => {});
});

function abrirInicio() {
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
}

// ---------- abrir um arquivo do PC no app certo (duplo clique, "Abrir com", app padrão) ----------
// O app abre na janela dele e o arquivo entra pelo mesmo campo "Abrir" do app (DevTools Protocol, só local):
// nada é enviado para fora, é como escolher o arquivo na tela.
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
// Word, Excel e PowerPoint seguem a escolha do ☰ da tela inicial ("InkDOS rápido" ou "ArtCraft completo",
// localStorage inkdoshub-abrir-office). No ArtCraft o arquivo vai pelo IndexedDB "inkdos-tool-handoff",
// como na tela inicial (inicio/lancador.js), e a página apps/<editor>/ o entrega ao editor.
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
  w.loadURL(SITE + 'idiomas/pt-BR.json'); // página leve do mesmo site, só para ler a escolha e guardar o arquivo
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
      // espera o app ficar pronto (na primeira visita a página pode recarregar sozinha)
      for (let i = 0; i < 60 && !feito; i++) {
        const pronto = await w.webContents.executeJavaScript('document.readyState==="complete"&&!!' + achar).catch(() => false);
        if (pronto) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (feito || w.isDestroyed()) return;
      if (!d.isAttached()) d.attach('1.3');
      await d.sendCommand('DOM.getDocument', { depth: 0 });
      const o = await d.sendCommand('Runtime.evaluate', { expression: achar });
      if (!o.result || !o.result.objectId) throw new Error('sem campo de arquivo');
      await d.sendCommand('DOM.setFileInputFiles', { files: [f], objectId: o.result.objectId });
      feito = true;
    } catch (_) {
      // página recarregou no meio: a próxima carga tenta de novo
    } finally { try { if (d.isAttached()) d.detach(); } catch (_) {} }
  };
  w.webContents.on('did-finish-load', () => { setTimeout(tentar, 300); });
}
app.on('window-all-closed', () => app.quit());
// atualização baixada e a pessoa não reiniciou: instala em silêncio ao fechar (abre já na versão nova da próxima vez)
app.on('will-quit', () => { instalarAtualizacao(false); });
