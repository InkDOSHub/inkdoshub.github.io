/* Windows apps: Boxedwine (Wine 11 + x86 emulator with a JIT that translates x86 code to WebAssembly).
   Engine builds in jit/ (one thread) and mtjit/ (several threads, needs the isolated address), made by
   .github/workflows/boxedwine.yml. Boxedwine's own page script (jit/boxedwine-shell.js) does the work;
   this file sets its parameters and starts it. The user's program is packed as prog.zip (folder prog/)
   and handed to the engine as its "app" file, so it shows up on drive D: and starts by itself.
   XeOS blocks confirm()/alert(), so they answer by themselves. */
"use strict";
window.confirm = function () { return true; };
window.alert = function (m) { console.warn(m); };

var MOTOR = self.crossOriginIsolated ? "mtjit/" : "jit/";
// Wine 11 (about 100 MB) is not in the repository: the Cloudflare copy serves it from boxedwine.org
var FS_BASE = /workers\.dev$/.test(location.hostname) || /^(localhost|127\.)/.test(location.hostname)
  ? "fs/" : "https://inkdoshub-github-io.vfydr2m9wk.workers.dev/apps/wine/fs/";
var BASE = "root=wine11&rootBase=" + encodeURIComponent(FS_BASE) + "&auto=true";
Module.locateFile = function (url) { return MOTOR + url; };

var $ = function (id) { return document.getElementById(id); };
var estado = function (t) { $("estado").textContent = t; };

// the user's program, served to the engine as __user/prog.zip
var progZip = null;
var fetchOrig = window.fetch;
window.fetch = function (url) {
  if (progZip && /__user\/prog\.zip$/.test(String(url))) return Promise.resolve(new Response(progZip));
  return fetchOrig.apply(this, arguments);
};

function iniciarMotor(params) {
  $("inicio").hidden = true; $("lista").hidden = true;
  $("ir-desktop").hidden = !params;
  // Boxedwine opens its window at the screen size: report a 1024x768 screen so the picture keeps its shape
  try {
    ["width", "availWidth"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return 1024; } }); });
    ["height", "availHeight"].forEach(function (k) { Object.defineProperty(screen, k, { configurable: true, get: function () { return 768; } }); });
  } catch (e) {}
  // the Wine desktop is 800x600: same screen size so it fills the picture; programs get 1024x768
  Config.urlParams = BASE + (params ? "&resolution=1024x768&" + params : "&resolution=800x600");
  estado("Loading Wine 11 (about 100 MB the first time)…");
  var s = document.createElement("script");
  s.src = MOTOR + "boxedwine.js?v=2";
  document.body.appendChild(s);
}

$("btn-desktop").onclick = function () { iniciarMotor(""); };
// installed programs stay saved in the browser: the desktop (Start menu) shows them.
// "Go to desktop" restarts the page straight into the Windows desktop.
$("btn-ir-desktop").onclick = function () { location.href = "./?desktop=1"; };
if (/[?&]desktop=1/.test(location.search)) iniciarMotor("");
$("btn-exemplo").onclick = function () { iniciarMotor("app=abiword&appBase=apps/&p=ABIWORD.EXE"); };
$("btn-teste").onclick = function () { iniciarMotor("app=cputest&appBase=apps/&p=cputest.exe"); };
$("btn-abrir").onclick = function () { $("arquivo").click(); };

$("arquivo").onchange = async function () {
  var f = this.files[0]; if (!f) return;
  this.value = "";
  abrir(new Uint8Array(await f.arrayBuffer()), f.name);
};

// true for a 64-bit Windows program (PE machine 0x8664)
function e64(b) {
  if (!b || b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return false;
  var pe = b[0x3c] | b[0x3d] << 8 | b[0x3e] << 16 | b[0x3f] << 24;
  return pe + 6 < b.length && (b[pe + 4] | b[pe + 5] << 8) === 0x8664;
}

function abrir(dados, nomeOriginal) {
  var nome = nomeOriginal.replace(/[^\w.\- ]/g, "_");
  var novo = new JSZip(), exes = [], x64 = 0;
  if (/\.zip$/i.test(nome)) {
    try {
      var z = new JSZip(dados);
      for (var e in z.files) {
        if (/__MACOSX|\.DS_Store$/.test(e)) continue;
        var f = z.files[e];
        if (f.dir) { novo.folder("prog/" + e); continue; }
        var b = f.asUint8Array();
        novo.file("prog/" + e, b);
        if (/\.(exe|bat)$/i.test(e)) { exes.push(e); if (e64(b)) x64++; }
      }
    } catch (err) { estado("Could not read this .zip: " + err.message); return; }
    if (!exes.length) { estado("No .exe found in this file."); return; }
    if (x64 === exes.length) { estado("The programs in this .zip are 64-bit. This version runs 32-bit (x86) programs only."); return; }
  } else {
    if (e64(dados)) { estado("This is a 64-bit program. This version runs 32-bit (x86) programs only: look for the 32-bit download of this program."); return; }
    novo.file("prog/" + nome, dados); exes.push(nome);
  }
  progZip = novo.generate({ type: "uint8array", compression: "STORE" });
  var correr = function (p) { iniciarMotor("app=prog&appBase=__user/&p=" + encodeURIComponent(p)); };
  if (exes.length === 1) return correr(exes[0]);
  estado("Choose the program to run:");
  var l = $("lista"); l.textContent = ""; l.hidden = false;
  exes.sort(function (a, b) { return a.split("/").length - b.split("/").length; }).slice(0, 30).forEach(function (p) {
    var b = document.createElement("button"); b.className = "ink-btn"; b.type = "button"; b.textContent = p;
    b.onclick = function () { correr(p); }; l.appendChild(b);
  });
}

// feedback: download progress, Wine messages in a Log, and a hint while Windows starts
var linhasLog = [];
function registra(t) {
  linhasLog.push(String(t)); if (linhasLog.length > 300) linhasLog.shift();
  $("log-txt").textContent = linhasLog.join("\n");
  if (/CPU test/.test(t)) { clearInterval(esperaWin); estado(String(t)); }
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
  estado(s < 30 ? "Windows is starting… " + s + " s" : "Running (" + (MOTOR === "mtjit/" ? "several cores" : "one core") + "). If nothing shows up, open Log below.");
  if (s >= 30) clearInterval(esperaWin);
}, 1000);
