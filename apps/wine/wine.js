/* Windows apps: Boxedwine (Wine + x86 emulator, compiled to WebAssembly) hosted in the Hub.
   Three ways to start: Windows desktop (Wine explorer), a sample (AbiWord), or the user's own .zip/.exe,
   which is copied to drive D: before Wine starts. Boxedwine's own page script (engine/boxedwine-shell.js)
   does the work; this file only sets its Config and drives it. XeOS blocks confirm()/alert(), so they answer by themselves. */
"use strict";
window.confirm = function () { return true; };
window.alert = function (m) { console.warn(m); };
Module.locateFile = function (url) { return "engine/" + url; };

var RAIZ_FS = "root=fullWine1.7.55-v8";
var $ = function (id) { return document.getElementById(id); };
var estado = function (t) { $("estado").textContent = t; };

function iniciarMotor(params, automatico) {
  $("inicio").hidden = true;
  // fixed Windows screen size; otherwise Boxedwine takes the browser window size and the picture gets stretched
  Module.arguments.push("-resolution", "1024x768");
  // Boxedwine opens its window at the screen size: report a 1024x768 screen so the picture keeps its shape
  try {
    ["width", "availWidth"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return 1024; } }); });
    ["height", "availHeight"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return 768; } }); });
  } catch (e) {}
  Config.locateRootBaseUrl = "fs/";
  Config.locateAppBaseUrl = "apps/";
  Config.locateOverlayBaseUrl = "apps/";
  Config.urlParams = params + "&auto=" + (automatico ? "true" : "false");
  estado("Loading Wine (about 50 MB the first time)…");
  var s = document.createElement("script");
  s.src = "engine/boxedwine.js?v=1";
  document.body.appendChild(s);
}

// waits until Boxedwine has built its file system (it then enables its hidden start button)
function quandoPronto(fn) {
  var t = setInterval(function () { if (!$("startbtn").disabled) { clearInterval(t); fn(); } }, 200);
}

$("btn-desktop").onclick = function () { iniciarMotor(RAIZ_FS, true); estado("Starting the Windows desktop…"); };
$("btn-exemplo").onclick = function () { iniciarMotor(RAIZ_FS + "&app=abiword&p=ABIWORD.EXE", true); };
$("btn-abrir").onclick = function () { $("arquivo").click(); };

$("arquivo").onchange = async function () {
  var f = this.files[0]; if (!f) return;
  this.value = "";
  abrir(await f.arrayBuffer(), f.name);
};
// CPU test: a tiny 32-bit Windows program (tools/bench.c) that measures the emulated CPU and shows the result
$("btn-teste").onclick = async function () {
  estado("Loading the CPU test…");
  var r = await fetch("apps/cputest.exe?v=1"); abrir(await r.arrayBuffer(), "cputest.exe");
};

// true for a 64-bit Windows program (PE machine 0x8664)
function e64(b) {
  if (!b || b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return false;
  var pe = b[0x3c] | b[0x3d] << 8 | b[0x3e] << 16 | b[0x3f] << 24;
  return pe + 6 < b.length && (b[pe + 4] | b[pe + 5] << 8) === 0x8664;
}

function abrir(dados, nomeOriginal) {
  var nome = nomeOriginal.replace(/[^\w.\- ]/g, "_");
  var exes = [];
  if (/\.zip$/i.test(nome)) {
    try {
      var z = new JSZip(dados), pasta = nome.replace(/\.zip$/i, "");
      var x64 = 0;
      for (var e in z.files) if (/\.(exe|bat)$/i.test(e) && !/__MACOSX/.test(e)) { exes.push("/" + pasta + "/" + e); if (e64(z.file(e).asUint8Array())) x64++; }
      if (exes.length && x64 === exes.length) { estado("The programs in this .zip are 64-bit. This version runs 32-bit (x86) programs only."); return; }
    } catch (err) { estado("Could not read this .zip: " + err.message); return; }
  } else exes.push("/" + nome);
  if (!exes.length) { estado("No .exe found in this file."); return; }
  // this engine runs 32-bit programs only: warn right away about a 64-bit .exe (PE machine 0x8664)
  if (!/\.zip$/i.test(nome) && e64(new Uint8Array(dados))) {
    estado("This is a 64-bit program. This version runs 32-bit (x86) programs only: look for the 32-bit download of this program.");
    return;
  }
  iniciarMotor(RAIZ_FS, false);
  quandoPronto(function () {
    readFile(dados, nome, null); // Boxedwine: copies the file (or the unzipped folder) to drive D:
    var correr = function (p) { $("lista").hidden = true; estado("Running " + p.split("/").pop() + "…"); execute(p); };
    if (exes.length === 1) return correr(exes[0]);
    estado("Choose the program to run:");
    var l = $("lista"); l.textContent = ""; l.hidden = false;
    exes.sort(function (a, b) { return a.split("/").length - b.split("/").length; }).slice(0, 30).forEach(function (p) {
      var b = document.createElement("button"); b.className = "ink-btn"; b.type = "button"; b.textContent = p.split("/").slice(2).join("/");
      b.onclick = function () { correr(p); }; l.appendChild(b);
    });
  });
}

// feedback: download progress, Wine messages in a Log, and a hint while Windows starts
var linhasLog = [];
function registra(t) {
  linhasLog.push(String(t)); if (linhasLog.length > 300) linhasLog.shift();
  $("log-txt").textContent = linhasLog.join("\n");
  if (/CPU test/.test(t)) { clearInterval(esperaWin); estado(String(t) + " · browser ceiling on this device: run apps/xeos-tests/emu.html"); }
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
  if (!inicioWin) { inicioWin = Date.now(); $("log").hidden = false; }
  var s = Math.round((Date.now() - inicioWin) / 1000);
  estado(s < 90 ? "Windows is starting… " + s + " s (the first start can take 1–2 min; the screen may stay black or blue meanwhile)" : "Running. If nothing shows up, open Log below to see what Wine says.");
  if (s >= 90) clearInterval(esperaWin);
}, 1000);
