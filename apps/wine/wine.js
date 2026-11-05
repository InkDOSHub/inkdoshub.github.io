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
var MULTI = { id: "multi", nome: "Multi-core (faster; turn off if the page keeps reloading)", padrao: true };
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
  var regBase = [], dllBase = "";
  Object.defineProperty(Config, "registryCommands", { configurable: true,
    get: function () { return regBase.concat(reg); }, set: function (v) { regBase = v || []; } });
  // menu shortcuts that installers ask Wine to create: useless here and slow to make
  Object.defineProperty(Config, "dllOverrides", { configurable: true,
    get: function () { return [dllBase, ligado(ATALHOS) ? "" : "winemenubuilder.exe=d"].filter(Boolean).join(";"); },
    set: function (v) { dllBase = v || ""; } });
  Config.urlParams = "root=wine11&rootBase=" + encodeURIComponent(FS_BASE) + "&overlay=visual&overlayBase=visual%2F&storageKey=default" +
    "&auto=true&resolution=" + TELA + (ligado(SERVICOS[0]) ? NET : "") +
    "&p=explorer&args=" + encodeURIComponent("/desktop=shell," + TELA + " winefile.exe D:\\");
  estado("Loading Wine 11 (about 100 MB the first time)…");
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

// one emulator at a time: the lock is held while this page is open
if (isolar()) {} else if (navigator.locks) {
  navigator.locks.request("inkdoshub-emulador", { ifAvailable: true }, function (lock) {
    if (!lock) { estado("Another emulator is open in another tab or window. Close it first, then reload this page."); return; }
    iniciar();
    return new Promise(function () {});
  });
} else iniciar();

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
$("btn-copiar").onclick = function () {
  var t = $("log-txt").textContent, b = this;
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
    b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy log"; }, 1500);
  }, function () { var r = document.createRange(); r.selectNodeContents($("log-txt")); getSelection().removeAllRanges(); getSelection().addRange(r); });
};

// feedback: download progress, Wine messages in the Log, and a hint while Windows starts
var linhasLog = [];
function registra(t) {
  linhasLog.push(String(t)); if (linhasLog.length > 400) linhasLog.shift();
  $("log-txt").textContent = linhasLog.join("\n");
}
var printOrig = Module.print, errOrig = Module.printErr, statusOrig = Module.setStatus;
Module.print = function (t) { registra(t); printOrig.apply(this, arguments); };
Module.printErr = function (t) { registra(t); errOrig.apply(this, arguments); };
Module.setStatus = function (t) {
  statusOrig.apply(this, arguments);
  if (t) estado(/\((\d+)\/(\d+)\)/.test(t) ? t.replace(/\((\d+)\/(\d+)\)/, function (_, a, b) { return Math.round(a / b * 100) + "%"; }) : t);
};
var inicioWin = 0;
// leaving the page during a start is not a crash
addEventListener("pagehide", function () { try { localStorage.removeItem("wine-mt-tentando"); } catch (e) {} });
var esperaWin = setInterval(function () {
  if (!isRunning) return;
  if (!inicioWin) inicioWin = Date.now();
  var s = Math.round((Date.now() - inicioWin) / 1000);
  estado(s < 20 ? "Windows is starting… " + s + " s" : "");
  if (s >= 20) { clearInterval(esperaWin); try { localStorage.removeItem("wine-mt-tentando"); } catch (e) {} }
}, 1000);
