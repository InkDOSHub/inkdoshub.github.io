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

var MOTOR = self.crossOriginIsolated ? "mtjit/" : "jit/";
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

function iniciar() {
  try {
    ["width", "availWidth"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return LARG; } }); });
    ["height", "availHeight"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return ALT; } }); });
    // SDL multiplies the screen by the pixel ratio (2 on a Mac, 3 on an iPhone): keep it at 1
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: function () { return 1; } });
  } catch (e) {}
  Config.urlParams = "root=wine11&rootBase=" + encodeURIComponent(FS_BASE) + "&auto=true&resolution=" + TELA + NET +
    "&p=explorer&args=" + encodeURIComponent("/desktop=shell," + TELA + " winefile.exe D:\\");
  estado("Loading Wine 11 (about 100 MB the first time)…");
  var s = document.createElement("script");
  s.src = MOTOR + "boxedwine.js?v=2";
  document.body.appendChild(s);
}

// one emulator at a time: the lock is held while this page is open
if (navigator.locks) {
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
var esperaWin = setInterval(function () {
  if (!isRunning) return;
  if (!inicioWin) inicioWin = Date.now();
  var s = Math.round((Date.now() - inicioWin) / 1000);
  estado(s < 20 ? "Windows is starting… " + s + " s" : "");
  if (s >= 20) clearInterval(esperaWin);
}, 1000);

// folder shared with the Linux environment (../emulador/compartilhada.js): D:\Shared
var COMP = "Shared";
function listarComp(dir, rel, out) {
  FS.readdir(dir).forEach(function (n) {
    if (n === "." || n === "..") return;
    var c = dir + "/" + n, r = rel ? rel + "/" + n : n, st = FS.stat(c);
    if (FS.isDir(st.mode)) listarComp(c, r, out);
    else out.push({ path: r, mtime: +st.mtime + ":" + st.size, ler: function () { return Promise.resolve(FS.readFile(c)); } });
  });
  return out;
}
var compPronta = setInterval(function () {
  if (!isRunning || !Config.d_drive) return;
  clearInterval(compPronta);
  var base = Config.d_drive + "/" + COMP;
  Compartilhada.carregar().then(function (lista) {
    FS.mkdirTree(base);
    lista.forEach(function (f) { try { escreverD(COMP + "/" + f.path, f.data); } catch (e) {} });
  }).catch(function (e) { console.warn("shared folder:", e); }).then(function () {
    var salvar = function () { try { Compartilhada.salvar(listarComp(base, "", [])); } catch (e) {} };
    salvar(); setInterval(salvar, 5000); addEventListener("pagehide", salvar);
  });
}, 1000);
