/* Emulator › Windows: Boxedwine (Wine 11 + x86 emulator with a JIT that translates x86 code to WebAssembly).
   Engine builds in jit/ (one thread) and mtjit/ (several threads, needs the isolated address), made by
   .github/workflows/boxedwine.yml. Boxedwine's own page script (jit/boxedwine-shell.js) does the work;
   this file sets its parameters and starts it. Memory: up to 3 GB (the engine's WebAssembly limit).
   Windows stays open: a desktop with a taskbar and the Wine file manager. "Open file" copies the file
   (a .zip is unpacked into a folder) to drive D:, which is saved in this browser; the program is then
   opened from the file manager, without restarting. Only one emulator runs at a time (Web Locks).
   XeOS blocks confirm()/alert(), so they answer by themselves. */
"use strict";
window.confirm = function () { return true; };
window.alert = function (m) { console.warn(m); };

// Multi-core (switch in ⚙). If a multi-core start did not reach the desktop (the tab crashed and
// reloaded, as iOS does when memory runs out), the switch turns off by itself and the one-core build is used.
var MULTI = { id: "multi", nome: "Multi-core (experimental: on the iPad it ran the CPU test 60x slower)", padrao: false };
try {
  if (localStorage.getItem("wine-mt-tentando")) { localStorage.removeItem("wine-mt-tentando"); localStorage.setItem("wine-inicio-multi", "0"); }
} catch (e) {}
var MOTOR = self.crossOriginIsolated && ligado(MULTI) ? "mtjit/" : "jit/";
// Wine 11 (about 100 MB) is not in the repository: the Cloudflare copy serves it from boxedwine.org
var FS_BASE = /workers\.dev$/.test(location.hostname) || /^(localhost|127\.)/.test(location.hostname)
  ? "fs/" : "https://inkdoshub-github-io.vfydr2m9wk.workers.dev/apps/wine/fs/";
// Boxedwine offers the browser screen size as a display mode only above 1600 px wide:
// a 1680x945 (16:9) screen gives a widescreen Windows desktop
var LARG = 1680, ALT = 945, TELA = LARG + "x" + ALT;
// internet: the Hub's tunnel on Cloudflare (worker.js), DNS answered with DNS-over-HTTPS
var NET = "&network=true&networkGateway=" + encodeURIComponent("wss://inkdoshub-github-io.vfydr2m9wk.workers.dev/net/boxedwine");
Module.locateFile = function (url) { return MOTOR + url; };

var $ = function (id) { return document.getElementById(id); };
var estado = function (t) { $("estado").textContent = t; };

// --- startup switches, saved in this browser ---
var SERVICOS = [
  { id: "net", nome: "Internet (Hub tunnel)", nomes: ["NDIS", "nsiproxy"], liga: 2, padrao: true },
  { id: "disp", nome: "Game controllers, USB and Bluetooth", nomes: ["winebus", "winehid", "winebth"], liga: 3, padrao: false },
  { id: "log", nome: "Event log", nomes: ["Eventlog"], liga: 2, padrao: false }
];
var ATALHOS = { id: "menu", nome: "Start menu shortcuts made by installers", padrao: false };
function ligado(o) {
  try { var v = localStorage.getItem("wine-inicio-" + o.id); if (v !== null) return v === "1"; } catch (e) {}
  return o.padrao;
}
(function () {
  var caixa = $("inicio-opcoes");
  [MULTI].concat(SERVICOS, [ATALHOS]).forEach(function (o) {
    var l = document.createElement("label"), c = document.createElement("input");
    c.type = "checkbox"; c.checked = ligado(o);
    c.onchange = function () {
      try { localStorage.setItem("wine-inicio-" + o.id, c.checked ? "1" : "0"); } catch (e) {}
      $("inicio-aviso").hidden = false;
    };
    l.appendChild(c); l.appendChild(document.createTextNode(" " + o.nome)); caixa.appendChild(l);
  });
})();

var REG_CHAVE = "";
function iniciar() {
  try {
    ["width", "availWidth"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return LARG; } }); });
    ["height", "availHeight"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return ALT; } }); });
    // SDL multiplies the screen by the pixel ratio (2 on a Mac, 3 on an iPhone): keep it at 1
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: function () { return 1; } });
  } catch (e) {}
  // look: wallpaper "Altai" (Alesya Khoteeva, KDE, CC BY-SA 4.0) from visual/visual.zip, set in the
  // registry before the desktop opens; storageKey=default keeps the same saved C: and D: as before
  var reg = [['reg', 'add', 'HKCU\\Control Panel\\Desktop', '/v', 'Wallpaper', '/t', 'REG_SZ', '/d', 'C:\\windows\\altai.bmp', '/f']];
  // startup switches (menu "Startup"): each Wine service is set to start or not; Wine reads it on the next start
  SERVICOS.forEach(function (sv) {
    sv.nomes.forEach(function (n) {
      reg.push(['reg', 'add', 'HKLM\\System\\CurrentControlSet\\Services\\' + n, '/v', 'Start', '/t', 'REG_DWORD', '/d', String(ligado(sv) ? sv.liga : 4), '/f']);
    });
  });
  // Wine keeps its registry saved in this browser: run the commands (each one is a slow Windows
  // program) only when they changed since the last start that reached the desktop
  REG_CHAVE = JSON.stringify(reg);
  try { if (localStorage.getItem("wine-reg") === REG_CHAVE) reg = []; } catch (e) {}
  var regBase = [], dllBase = "";
  Object.defineProperty(Config, "registryCommands", { configurable: true,
    get: function () { return regBase.concat(reg); }, set: function (v) { regBase = v || []; } });
  // menu shortcuts that installers ask Wine to create: useless here and slow to make
  Object.defineProperty(Config, "dllOverrides", { configurable: true,
    get: function () { return [dllBase, ligado(ATALHOS) ? "" : "winemenubuilder.exe=d"].filter(Boolean).join(";"); },
    set: function (v) { dllBase = v || ""; } });
  Config.urlParams = "root=wine11&rootBase=" + encodeURIComponent(FS_BASE) + "&overlay=visual&overlayBase=visual%2F&storageKey=default" +
    "&auto=true&resolution=" + (JOGO ? (perfil(JOGO).res || "1280x720") : TELA) + (ligado(SERVICOS[0]) ? NET : "") +
    (JOGO ? "&w=" + encodeURIComponent("/home/username/.wine/dosdevices/e:/" + JOGO + jogoPasta(JOGO)) : "") +
    "&p=explorer&args=" + encodeURIComponent(JOGO ? jogoArgs(JOGO) : "/desktop=shell," + TELA + " winefile.exe D:\\");
  estado(JOGO ? "Starting " + JOGO + "…" : "Loading Wine 11 (about 100 MB the first time)…");
  montarJogos();
  if (JOGO) try { localStorage.setItem("jogo-tentando", JOGO); } catch (e) {}
  var s = document.createElement("script");
  if (MOTOR === "mtjit/") try { localStorage.setItem("wine-mt-tentando", "1"); } catch (e) {}
  s.src = MOTOR + "boxedwine.js?v=2";
  document.body.appendChild(s);
}

// Several cores need an isolated page (SharedArrayBuffer). On github.io the Hub service worker
// (sw-portal.js) adds the headers: register it and reload once. Without a service worker (XeOS),
// open the fast address, which sends the headers itself (its C: and D: are saved separately).
function isolar() {
  if (self.crossOriginIsolated || !ligado(MULTI) || !/github\.io$/.test(location.hostname)) return false;
  var tentou = false;
  try { tentou = sessionStorage.getItem("wine-isolar") === "1"; sessionStorage.setItem("wine-isolar", "1"); } catch (e) {}
  try { tentou = tentou || Date.now() - (+localStorage.getItem("wine-isolar") || 0) < 120000; localStorage.setItem("wine-isolar", String(Date.now())); } catch (e) {}
  if (tentou) return false;
  if ("serviceWorker" in navigator) {
    estado("Turning on multi-core mode…");
    navigator.serviceWorker.register("../../sw-portal.js", { scope: "../../" })
      .then(function () { return navigator.serviceWorker.ready; })
      .then(function () { location.reload(); }, function () { location.replace(RAPIDO + location.search); });
  } else location.replace(RAPIDO + location.search);
  return true;
}
var RAPIDO = "https://inkdoshub-github-io.vfydr2m9wk.workers.dev/apps/wine/";

// a game start that crashed the tab (out of memory) does not start again by itself in a loop
var JOGO_CAIU = false;
try { var tj = localStorage.getItem("jogo-tentando"); JOGO_CAIU = !!(tj && tj === new URLSearchParams(location.search).get("jogo")); localStorage.removeItem("jogo-tentando"); } catch (e) {}
// one emulator at a time: the lock is held while this page is open
if (JOGO_CAIU) { listarJogos(); setTimeout(function () { estado("The last start of this game closed the page (probably out of memory). Tap Play to try again, or pick a lower resolution."); }, 0); }
else if (isolar()) {} else if (navigator.locks) {
  navigator.locks.request("inkdoshub-emulador", { ifAvailable: true }, function (lock) {
    if (!lock) { estado("Another emulator is open in another tab or window. Close it first, then reload this page."); return; }
    listarJogos().then(iniciar, iniciar);
    return new Promise(function () {});
  });
} else listarJogos().then(iniciar, iniciar);

// --- files to drive D: (live, no restart) ---
function escreverD(caminho, dados) {
  var p = Config.d_drive + "/" + caminho;
  FS.mkdirTree(p.substring(0, p.lastIndexOf("/")));
  FS.writeFile(p, dados);
}
// true for a 64-bit Windows program (PE machine 0x8664)
function e64(b) {
  if (!b || b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return false;
  var pe = b[0x3c] | b[0x3d] << 8 | b[0x3e] << 16 | b[0x3f] << 24;
  return pe + 6 < b.length && (b[pe + 4] | b[pe + 5] << 8) === 0x8664;
}
function copiarParaD(dados, nomeOriginal) {
  if (!isRunning) { estado("Wait for Windows to start, then open the file again."); return; }
  var nome = nomeOriginal.replace(/[^\w.\- ]/g, "_"), aviso = "";
  try {
    if (/\.zip$/i.test(nome)) {
      var pasta = nome.replace(/\.zip$/i, ""), z = new JSZip(dados), n = 0, x64 = 0, exes = 0;
      for (var e in z.files) {
        if (/__MACOSX|\.DS_Store$/.test(e) || e.split("/").indexOf("..") >= 0 || z.files[e].dir) continue;
        var b = z.files[e].asUint8Array();
        escreverD(pasta + "/" + e, b); n++;
        if (/\.exe$/i.test(e)) { exes++; if (e64(b)) x64++; }
      }
      if (exes && x64 === exes) aviso = " The programs in it are 64-bit and will not run yet.";
      estado("Copied " + n + " files to D:\\" + pasta + ". Open it in the file manager (drive D:, press F5 to refresh)." + aviso);
    } else {
      if (e64(dados)) aviso = " This is a 64-bit program: it will not run yet (look for the 32-bit download).";
      escreverD(nome, dados);
      estado("Copied to D:\\" + nome + ". Open it in the file manager (drive D:, press F5 to refresh)." + aviso);
    }
  } catch (err) { estado("Could not copy this file: " + err.message); }
}

$("btn-abrir").onclick = function () { $("arquivo").click(); };
$("arquivo").onchange = async function () {
  var f = this.files[0]; if (!f) return;
  this.value = "";
  copiarParaD(new Uint8Array(await f.arrayBuffer()), f.name);
};
$("btn-teste").onclick = async function () {
  var r = await fetch("apps/cputest.exe?v=1");
  copiarParaD(new Uint8Array(await r.arrayBuffer()), "cputest.exe");
};
$("btn-desktop").onclick = function () { location.reload(); };
function telaCheia(liga) {
  document.body.classList.toggle("cheia", liga);
  var el = document.documentElement, rf = el.requestFullscreen || el.webkitRequestFullscreen;
  var sai = document.exitFullscreen || document.webkitExitFullscreen;
  try {
    if (liga && rf) { var r = rf.call(el); if (r && r.catch) r.catch(function () {}); }
    else if (!liga && sai && (document.fullscreenElement || document.webkitFullscreenElement)) sai.call(document);
  } catch (e) {}
}
$("btn-cheia").onclick = function () { telaCheia(true); };
$("sair-cheia").onclick = function () { telaCheia(false); };
["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
  document.addEventListener(ev, function () { if (!(document.fullscreenElement || document.webkitFullscreenElement)) document.body.classList.remove("cheia"); });
});
$("btn-copiar").onclick = function () {
  var t = $("log-txt").textContent, b = this;
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
    b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy log"; }, 1500);
  }, function () { var r = document.createRange(); r.selectNodeContents($("log-txt")); getSelection().removeAllRanges(); getSelection().addRange(r); });
};

// feedback: download progress, Wine messages in the Log, and a hint while Windows starts
// the log is also kept in this browser, so it survives a crash that reloads the page
var linhasLog = [], logAnterior = "", salvaLog = 0;
try { logAnterior = localStorage.getItem("wine-log") || ""; } catch (e) {}
function registra(t) {
  linhasLog.push(String(t)); if (linhasLog.length > 400) linhasLog.shift();
  $("log-txt").textContent = linhasLog.join("\n") + (logAnterior ? "\n\n--- previous start ---\n" + logAnterior : "");
  clearTimeout(salvaLog); salvaLog = setTimeout(function () {
    try { localStorage.setItem("wine-log", (JOGO ? "game " + JOGO + " · " : "") + new Date().toISOString() + " · memory " + ((typeof HEAP8 !== "undefined" && HEAP8) ? Math.round(HEAP8.length / 1048576) : 0) + " MB\n" + linhasLog.slice(-150).join("\n")); } catch (e) {}
  }, 300);
}
if (logAnterior) setTimeout(function () { $("log-txt").textContent = "--- previous start ---\n" + logAnterior; }, 0);
var printOrig = Module.print, errOrig = Module.printErr, statusOrig = Module.setStatus;
Module.print = function (t) { registra(t); printOrig.apply(this, arguments); };
Module.printErr = function (t) {
  registra(t); errOrig.apply(this, arguments);
  // the multi-core build stops with an exception on some browsers (seen on the iPad): switch to one core and start again
  if (MOTOR === "mtjit/" && /^\[post-exception status\]/.test(String(t)) && !Module.voltouUmNucleo) {
    Module.voltouUmNucleo = true;
    try { localStorage.setItem("wine-inicio-multi", "0"); localStorage.removeItem("wine-mt-tentando"); } catch (e) {}
    // during the start: restart by itself; later (a program was in use): only say so, the person restarts
    if (!inicioWin || Date.now() - inicioWin < 20000) {
      estado("Multi-core mode failed on this browser: starting again with one core…");
      setTimeout(function () { location.reload(); }, 1500);
    } else estado("Windows stopped with an error in multi-core mode. Tap Restart Windows: it will use one core (switch in ⚙).");
  }
};
Module.setStatus = function (t) {
  statusOrig.apply(this, arguments);
  if (t) estado(/\((\d+)\/(\d+)\)/.test(t) ? t.replace(/\((\d+)\/(\d+)\)/, function (_, a, b) { return Math.round(a / b * 100) + "%"; }) : t);
};
var inicioWin = 0;
// leaving the page during a start is not a crash
addEventListener("pagehide", function () { try { localStorage.removeItem("wine-mt-tentando"); localStorage.removeItem("jogo-tentando"); } catch (e) {} });
var esperaWin = setInterval(function () {
  if (!isRunning) return;
  if (!inicioWin) inicioWin = Date.now();
  var s = Math.round((Date.now() - inicioWin) / 1000);
  estado(s < 20 ? "Windows is starting… " + s + " s" : "");
  if (s === 20) try { localStorage.removeItem("wine-mt-tentando"); localStorage.setItem("wine-reg", REG_CHAVE); } catch (e) {}
  if (s >= 60) try { localStorage.removeItem("jogo-tentando"); } catch (e) {}
  if (s >= 60) { clearInterval(esperaWin); try { localStorage.removeItem("wine-mt-tentando"); localStorage.setItem("wine-reg", REG_CHAVE); } catch (e) {} }
}, 1000);

// --- Games: a game folder is copied once to this page's disk (OPFS) and shows up as drive E:.
// Wine reads it from the disk in 1 MB pieces only when the game asks (no copy in memory), so a
// game of many GB fits. E: is read-only; saves go to C: (Documents), which is kept.
var JOGO = new URLSearchParams(location.search).get("jogo") || "";
var JOGOS = [], ARQS = [];
function perfil(nome) { try { return JSON.parse(localStorage.getItem("jogo-" + nome)) || {}; } catch (e) { return {}; } }
function salvarPerfil(nome, p) { try { localStorage.setItem("jogo-" + nome, JSON.stringify(p)); } catch (e) {} }
function jogoArgs(nome) {
  var p = perfil(nome), exe = (p.exe || "").replace(/\//g, "\\");
  var res = p.res || "1280x720";
  return "/desktop=jogo," + res + ' "E:\\' + nome + "\\" + exe + '"';
}
function jogoPasta(nome) { var e = (perfil(nome).exe || ""), i = e.lastIndexOf("/"); return i > 0 ? "/" + e.slice(0, i) : ""; }
async function pastaJogos() { return (await navigator.storage.getDirectory()).getDirectoryHandle("jogos", { create: true }); }
async function listar(dir, prefixo, saida) {
  for await (var [nome, h] of dir.entries()) {
    if (h.kind === "directory") await listar(h, prefixo + nome + "/", saida);
    else saida.push({ caminho: prefixo + nome, arquivo: await h.getFile() });
  }
}
async function listarJogos() {
  if (!navigator.storage || !navigator.storage.getDirectory) return;
  var raiz = await pastaJogos();
  JOGOS = []; for await (var [nome, h] of raiz.entries()) if (h.kind === "directory") JOGOS.push(nome);
  JOGOS.sort(); mostrarJogos();
  // only the game being played is mounted (listing every file of every game would be slow)
  if (JOGO && JOGOS.indexOf(JOGO) >= 0) { ARQS = []; await listar(await raiz.getDirectoryHandle(JOGO), JOGO + "/", ARQS); }
}
// piece cache shared by all files: at most 96 MB, the oldest piece goes first
var PEDACO = 1048576, CACHE = new Map(), CACHE_MAX = 64, LIDOS = { pedacos: 0, mb: 0 };
// Reader: a worker keeps the game files open on the disk (OPFS sync handles) and copies the asked piece
// into shared memory; this page waits for it in a short loop. Safari would otherwise load a whole file
// into memory for every piece (blob Range ignored), which crashed the tab on the iPhone.
var LEITOR = null;
var LEITOR_SRC = "var c,d,h={};onmessage=async function(e){c=new Int32Array(e.data.c);d=new Uint8Array(e.data.d);var raiz=await(await navigator.storage.getDirectory()).getDirectoryHandle('jogos');" +
  "async function abre(p){var x=raiz,ps=p.split('/');for(var i=0;i<ps.length-1;i++)x=await x.getDirectoryHandle(ps[i]);return x.getFileHandle(ps[ps.length-1]).then(function(f){return f.createSyncAccessHandle()})}" +
  "for(;;){Atomics.wait(c,0,0);if(Atomics.load(c,0)!==1)continue;var p=e.data.l[c[1]];try{if(!h[p])h[p]=await abre(p);c[3]=h[p].read(d.subarray(0,c[4]),{at:c[2]})}catch(x){c[3]=-1}Atomics.store(c,0,2)}}";
function iniciarLeitor() {
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined" || !ARQS.length) return;
  var c = new SharedArrayBuffer(20), d = new SharedArrayBuffer(PEDACO);
  var w = new Worker(URL.createObjectURL(new Blob([LEITOR_SRC], { type: "text/javascript" })));
  w.postMessage({ c: c, d: d, l: ARQS.map(function (a) { return a.caminho; }) });
  LEITOR = { c: new Int32Array(c), d: new Uint8Array(d) };
}
function lerLeitor(idx, a, n) {
  var c = LEITOR.c; c[1] = idx; c[2] = a; c[4] = n;
  Atomics.store(c, 0, 1); Atomics.notify(c, 0);
  var t = Date.now();
  while (Atomics.load(c, 0) !== 2) if (Date.now() - t > 20000) { Atomics.store(c, 0, 0); throw new Error("disk read timeout"); }
  var r = c[3]; Atomics.store(c, 0, 0);
  if (r < 0) throw new Error("disk read failed");
  return LEITOR.d.slice(0, r);
}
function pedaco(ref, i, tam) {
  var url = ref.url, k = ref.idx + "#" + i, c = CACHE.get(k);
  if (c) { CACHE.delete(k); CACHE.set(k, c); return c; }
  if (LEITOR) {
    var u0 = lerLeitor(ref.idx, i * PEDACO, Math.min(tam, (i + 1) * PEDACO) - i * PEDACO);
    CACHE.set(k, u0); LIDOS.pedacos++; LIDOS.mb += u0.length / 1048576;
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    return u0;
  }
  var a = i * PEDACO, b = Math.min(tam, a + PEDACO) - 1, x = new XMLHttpRequest();
  x.open("GET", url, false); x.setRequestHeader("Range", "bytes=" + a + "-" + b);
  x.overrideMimeType("text/plain; charset=x-user-defined"); x.send();
  var t = x.responseText, u = new Uint8Array(t.length);
  for (var j = 0; j < t.length; j++) u[j] = t.charCodeAt(j);
  // a browser that ignores Range sends the whole file: keep only the piece asked for
  if (u.length > b - a + 1) u = u.slice(a, b + 1);
  CACHE.set(k, u); LIDOS.pedacos++; LIDOS.mb += u.length / 1048576;
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return u;
}
function arquivoPreguicoso(dir, nome, arq, idx) {
  var ref = { idx: idx, url: LEITOR ? "" : URL.createObjectURL(arq) }, tam = arq.size;
  // rwx for everyone: Wine refuses to start a program without the execute bit
  var node = FS.createFile(dir, nome, { isDevice: false }, true, true);
  node.mode = (node.mode & ~511) | 493;
  node.contents = null;
  Object.defineProperty(node, "usedBytes", { get: function () { return tam; } });
  var ops = Object.assign({}, node.stream_ops);
  ops.read = function (stream, buffer, offset, length, position) {
    if (position >= tam) return 0;
    var n = Math.min(length, tam - position), feito = 0;
    while (feito < n) {
      var p = position + feito, i = Math.floor(p / PEDACO), o = p - i * PEDACO, c = pedaco(ref, i, tam), k = Math.min(n - feito, c.length - o);
      buffer.set(c.subarray(o, o + k), offset + feito); feito += k;
    }
    return n;
  };
  ops.write = function () { throw new FS.ErrnoError(2); };
  node.stream_ops = ops;
}
function montarJogos() {
  Module.preRun.push(function () {
    FS.mkdirTree("/games");
    iniciarLeitor();
    ARQS.forEach(function (a, idx) {
      var partes = a.caminho.split("/"), nome = partes.pop(), dir = "/games/" + partes.join("/");
      FS.mkdirTree(dir);
      try { arquivoPreguicoso(dir, nome, a.arquivo, idx); } catch (e) { registra("E: could not add " + a.caminho + ": " + e.message); }
    });
  });
  // drive E: = /games (added just before Wine starts)
  var args = [], push = args.push;
  args.push = function (v) { if (v === "/bin/wine" && args.indexOf("/games") < 0) push.call(args, "-mount_drive", "/games", "e"); return push.apply(args, arguments); };
  Module.arguments = args;
}
// copy a picked folder to the disk; the file itself is streamed, never held whole in memory
var ESCRITOR = "onmessage=async function(e){var d=await navigator.storage.getDirectory();for(var p of e.data.dir)d=await d.getDirectoryHandle(p,{create:true});var h=await(await d.getFileHandle(e.data.nome,{create:true})).createSyncAccessHandle();h.truncate(0);var r=e.data.arq.stream().getReader(),pos=0;for(;;){var x=await r.read();if(x.done)break;h.write(x.value,{at:pos});pos+=x.value.length}h.flush();h.close();postMessage(pos)}";
var escritor = null;
function gravarWorker(dir, nome, arq) {
  escritor = escritor || new Worker(URL.createObjectURL(new Blob([ESCRITOR], { type: "text/javascript" })));
  return new Promise(function (ok, no) { escritor.onmessage = function (e) { ok(e.data); }; escritor.onerror = function (e) { no(new Error(e.message)); }; escritor.postMessage({ dir: dir, nome: nome, arq: arq }); });
}
async function gravar(raiz, partes, arq) {
  var d = raiz, nome = partes[partes.length - 1];
  for (var i = 0; i < partes.length - 1; i++) d = await d.getDirectoryHandle(partes[i], { create: true });
  var fh = await d.getFileHandle(nome, { create: true });
  if (fh.createWritable) { var w = await fh.createWritable(); await arq.stream().pipeTo(w); return; }
  await gravarWorker(["jogos"].concat(partes.slice(0, -1)), nome, arq);
}
function escolherExe(lista) {
  var bons = lista.filter(function (f) { return /\.exe$/i.test(f.caminho) && !/unins|setup|crash|redist|dxsetup|dotnet|vcredist|launcher|updater|install/i.test(f.caminho); });
  bons.sort(function (a, b) { return b.tam - a.tam; });
  return bons.length ? bons[0].caminho : "";
}
$("btn-jogo").onclick = function () { $("pasta-jogo").click(); };
$("btn-jogo-arq").onclick = function () { $("arq-jogo").click(); };
// a game archive (.zip, .rar, .7z) is unpacked by 7-Zip straight into the disk
$("arq-jogo").onchange = function () {
  var f = this.files[0]; this.value = ""; if (!f) return;
  var nome = f.name.replace(/\.[^.]+$/, "").replace(/[^\w.\-]/g, "_") || "game";
  var w = new Worker("engine/extrator.js?v=2");
  estado("Opening " + f.name + "…");
  w.onmessage = function (e) {
    if (e.data.estado) { estado(e.data.estado); return; }
    w.terminate();
    if (!e.data.lista) { estado("Could not unpack: " + e.data.erro); listarJogos(); return; }
    var p = perfil(nome); p.exe = p.exe || escolherExe(e.data.lista); p.exes = e.data.lista.filter(function (x) { return /\.exe$/i.test(x.caminho); }).map(function (x) { return x.caminho; }); salvarPerfil(nome, p);
    estado(nome + " unpacked (" + Math.round(e.data.total / 1048576) + " MB)" + (e.data.erro ? " with errors: " + e.data.erro : "") + ". Tap Play.");
    listarJogos();
  };
  w.onerror = function (e) { estado("Could not unpack: " + e.message); };
  w.postMessage({ arq: f, nome: nome });
};
$("pasta-jogo").onchange = async function () {
  var fs = Array.prototype.slice.call(this.files); this.value = "";
  if (!fs.length) return;
  // the iPad adds its own folders in front (e.g. "File Provider Storage"): the game folder is the
  // deepest folder all the files share
  var caminhos = fs.map(function (f) { return (f.webkitRelativePath || f.name).split("/"); }), comum = 0;
  while (caminhos.every(function (c) { return c.length > comum + 1 && c[comum] === caminhos[0][comum]; })) comum++;
  var nome = ((comum ? caminhos[0][comum - 1] : caminhos[0][0]) || "game").replace(/[^\w.\-]/g, "_");
  if (!comum) comum = caminhos[0].length > 1 ? 1 : 0;
  var raiz = await pastaJogos(), total = fs.reduce(function (s, f) { return s + f.size; }, 0), feito = 0, lista = [];
  try {
    for (var i = 0; i < fs.length; i++) {
      var partes = [nome].concat(caminhos[i].slice(comum));
      estado("Copying " + nome + ": " + Math.round(feito / 1048576) + " of " + Math.round(total / 1048576) + " MB (" + (i + 1) + "/" + fs.length + " files)");
      await gravar(raiz, partes, fs[i]); feito += fs[i].size;
      lista.push({ caminho: partes.slice(1).join("/"), tam: fs[i].size });
    }
  } catch (e) { estado("Copy stopped: " + e.message + " (disk full?)"); return; }
  var p = perfil(nome); p.exe = p.exe || escolherExe(lista); p.exes = lista.filter(function (f) { return /\.exe$/i.test(f.caminho); }).map(function (f) { return f.caminho; }); salvarPerfil(nome, p);
  estado(nome + " copied (" + Math.round(total / 1048576) + " MB). Pick it below and tap Play.");
  listarJogos();
};
function mostrarJogos() {
  var c = $("jogos-lista"); c.textContent = "";
  JOGOS.forEach(function (nome) {
    var p = perfil(nome), linha = document.createElement("div"); linha.className = "linha";
    var t = document.createElement("strong"); t.textContent = nome;
    var sel = document.createElement("select"); sel.title = "Program to start";
    (p.exes && p.exes.length ? p.exes : [p.exe || ""]).forEach(function (x) { var o = document.createElement("option"); o.value = o.textContent = x; o.selected = x === p.exe; sel.appendChild(o); });
    sel.onchange = function () { p.exe = sel.value; salvarPerfil(nome, p); };
    var res = document.createElement("select"); res.title = "Resolution";
    ["640x360", "960x540", "1280x720"].forEach(function (r) { var o = document.createElement("option"); o.value = o.textContent = r; o.selected = r === (p.res || "1280x720"); res.appendChild(o); });
    res.onchange = function () { p.res = res.value; salvarPerfil(nome, p); };
    if (!p.exe) { var aviso = document.createElement("span"); aviso.className = "nota"; aviso.textContent = "no .exe found in this folder"; linha.append(aviso); }
    var jogar = document.createElement("a"); jogar.className = "ink-btn"; jogar.textContent = "Play"; jogar.href = "?jogo=" + encodeURIComponent(nome); if (!p.exe) jogar.hidden = true;
    var tirar = document.createElement("button"); tirar.className = "ink-btn"; tirar.type = "button"; tirar.textContent = "Remove";
    tirar.onclick = async function () { await (await pastaJogos()).removeEntry(nome, { recursive: true }); try { localStorage.removeItem("jogo-" + nome); } catch (e) {} listarJogos(); };
    linha.append(t, sel, res, jogar, tirar); c.appendChild(linha);
  });
  $("jogos").hidden = false;
}
// measurements: frames drawn by the game, memory, disk reads; kept in this browser and copied as JSON
var MED = { quadros: 0 };
(function () {
  var gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    var ctx = gc.apply(this, arguments);
    if (ctx && /webgl/.test(t) && !ctx.__med) { ctx.__med = 1; var cl = ctx.clear; ctx.clear = function () { MED.quadros++; return cl.apply(this, arguments); }; }
    return ctx;
  };
})();
var medidas = [], q0 = 0, t0 = performance.now();
setInterval(function () {
  if (!isRunning) return;
  var t = performance.now(), fps = (MED.quadros - q0) * 1000 / (t - t0); q0 = MED.quadros; t0 = t;
  var mem = (typeof HEAP8 !== "undefined" && HEAP8) ? Math.round(HEAP8.length / 1048576) : 0;
  var m = { s: Math.round((Date.now() - (inicioWin || Date.now())) / 1000), fps: Math.round(fps), wasmMB: mem, diskMB: +LIDOS.mb.toFixed(1), cacheMB: CACHE.size };
  medidas.push(m); if (medidas.length > 600) medidas.shift();
  $("medidas").textContent = m.fps + " fps · memory " + mem + " MB · read from disk " + m.diskMB + " MB";
  try { localStorage.setItem("jogos-medidas", JSON.stringify({ jogo: JOGO, perfil: perfil(JOGO), ua: navigator.userAgent, isolado: self.crossOriginIsolated, motor: MOTOR, medidas: medidas })); } catch (e) {}
}, 2000);
$("btn-medidas").onclick = function () {
  var t = ""; try { t = localStorage.getItem("jogos-medidas") || ""; } catch (e) {}
  navigator.clipboard.writeText(t).then(function () { estado("Measurements copied."); }, function () { estado("Copy failed."); });
};
