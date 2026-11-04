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
  var dados = await f.arrayBuffer();
  var nome = f.name.replace(/[^\w.\- ]/g, "_");
  var exes = [];
  if (/\.zip$/i.test(nome)) {
    try {
      var z = new JSZip(dados), pasta = nome.replace(/\.zip$/i, "");
      for (var e in z.files) if (/\.(exe|bat)$/i.test(e) && !/__MACOSX/.test(e)) exes.push("/" + pasta + "/" + e);
    } catch (err) { estado("Could not read this .zip: " + err.message); return; }
  } else exes.push("/" + nome);
  if (!exes.length) { estado("No .exe found in this file."); return; }
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
};

// feedback: download progress, Wine messages in a Log, and a hint while Windows starts
var linhasLog = [];
function registra(t) {
  linhasLog.push(String(t)); if (linhasLog.length > 300) linhasLog.shift();
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
  if (!inicioWin) { inicioWin = Date.now(); $("log").hidden = false; }
  var s = Math.round((Date.now() - inicioWin) / 1000);
  estado(s < 90 ? "Windows is starting… " + s + " s (the first start can take 1–2 min; the screen may stay black or blue meanwhile)" : "Running. If nothing shows up, open Log below to see what Wine says.");
  if (s >= 90) clearInterval(esperaWin);
}, 1000);
