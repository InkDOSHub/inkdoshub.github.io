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

// show "running" once the emulator draws
Module.postRun.push(function () { estado(""); });
