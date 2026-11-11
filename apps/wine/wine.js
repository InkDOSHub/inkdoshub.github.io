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
  ? "fs/" : "https://hub.inkdos.workers.dev/apps/wine/fs/";
// Boxedwine offers the browser screen size as a display mode only above 1600 px wide:
// a 1680x945 (16:9) screen gives a widescreen Windows desktop
// The screen size is picked on the start panel (smaller = lighter): 1280x720 by default
var TELAS = ["960x540", "1280x720", "1680x945"], TELA = "1280x720";
try { if (TELAS.indexOf(localStorage.getItem("wine-tela")) >= 0) TELA = localStorage.getItem("wine-tela"); } catch (e) {}
var LARG = +TELA.split("x")[0], ALT = +TELA.split("x")[1];
// internet: the Hub's tunnel on Cloudflare (worker.js), DNS answered with DNS-over-HTTPS
var NET = "&network=true&networkGateway=" + encodeURIComponent("wss://hub.inkdos.workers.dev/net/boxedwine");
Module.locateFile = function (url) { return MOTOR + url + (/\.wasm$/.test(url) ? "?v=3" : ""); };

var $ = function (id) { return document.getElementById(id); };
var estado = function (t) { $("estado").textContent = t; };

// --- startup switches, saved in this browser ---
var SERVICOS = [
  { id: "net", nome: "Internet (Hub tunnel)", nomes: ["NDIS", "nsiproxy"], liga: 2, padrao: true },
  { id: "disp", nome: "Game controllers, USB and Bluetooth", nomes: ["winebus", "winehid", "winebth"], liga: 3, padrao: false },
  { id: "log", nome: "Event log", nomes: ["Eventlog"], liga: 2, padrao: false }
];
// Code cache (Boxedwine's own WASM JIT cache): while it is on, the engine records the code it translates;
// "Save cache" keeps it in this browser and the next starts load it instead of translating again.
var CACHE = { id: "cache", nome: "Code cache (experimental): reuse translated code on the next starts", padrao: false };
var ATALHOS = { id: "menu", nome: "Start menu shortcuts made by installers", padrao: false };
function ligado(o) {
  try { var v = localStorage.getItem("wine-inicio-" + o.id); if (v !== null) return v === "1"; } catch (e) {}
  return o.padrao;
}
(function () {
  var caixa = $("inicio-opcoes");
  [MULTI, CACHE].concat(SERVICOS, [ATALHOS]).forEach(function (o) {
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
    "&auto=true&resolution=" + TELA + (ligado(SERVICOS[0]) ? NET : "") +
    (ligado(CACHE) ? "&jit-record=true" : "") +
    "&p=explorer&args=" + encodeURIComponent("/desktop=shell," + TELA + " winefile.exe D:\\");
  estado("Loading Wine 11 (about 100 MB the first time)…");
  var s = document.createElement("script");
  if (MOTOR === "mtjit/") try { localStorage.setItem("wine-mt-tentando", "1"); } catch (e) {}
  s.src = MOTOR + "boxedwine.js?v=3";
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
var RAPIDO = "https://hub.inkdos.workers.dev/apps/wine/";

// The engine only starts when the person taps Start (or right after "Restart Windows").
function ligar() {
  try { localStorage.setItem("wine-tela", $("tela").value); } catch (e) {}
  TELA = $("tela").value; LARG = +TELA.split("x")[0]; ALT = +TELA.split("x")[1];
  $("comecar").hidden = true; $("dropzone").hidden = false;
  ["btn-abrir", "btn-teste", "btn-cheia", "btn-desktop"].forEach(function (id) { $(id).hidden = false; });
  $("btn-cache").hidden = !ligado(CACHE);
  // one emulator at a time: the lock is held while this page is open
  if (navigator.locks) {
    navigator.locks.request("inkdoshub-emulador", { ifAvailable: true }, function (lock) {
      if (!lock) { estado("Another emulator is open in another tab or window. Close it first, then reload this page."); return; }
      iniciar();
      return new Promise(function () {});
    });
  } else iniciar();
}
(function () {
  var sel = $("tela");
  TELAS.forEach(function (t) { var o = document.createElement("option"); o.value = t; o.textContent = t.replace("x", " × ") + (t === "1280x720" ? " (recommended)" : ""); sel.appendChild(o); });
  sel.value = TELA;
  var maq = "x32";
  try { maq = localStorage.getItem("wine-maquina") === "x64" ? "x64" : "x32"; $("nucleos").value = localStorage.getItem("wine-x64-nucleos") || "1"; } catch (e) {}
  function escolher() {
    maq = document.querySelector('input[name=maquina]:checked').value;
    $("campo-tela").hidden = maq !== "x32"; $("campo-nucleos").hidden = maq !== "x64";
    try { localStorage.setItem("wine-maquina", maq); } catch (e) {}
  }
  document.querySelector('input[name=maquina][value=' + maq + ']').checked = true; escolher();
  [].forEach.call(document.querySelectorAll("input[name=maquina]"), function (r) { r.onchange = escolher; });
  $("btn-ligar").onclick = function () {
    if (maq === "x32") return ligar();
    try { localStorage.setItem("wine-x64-nucleos", $("nucleos").value); } catch (e) {}
    location.href = "x64/?nucleos=" + $("nucleos").value;
  };
  var direto = false;
  try { direto = sessionStorage.getItem("wine-reiniciar") === "1"; sessionStorage.removeItem("wine-reiniciar"); } catch (e) {}
  if (!isolar() && direto) ligar();
})();

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
$("btn-desktop").onclick = function () { try { sessionStorage.setItem("wine-reiniciar", "1"); } catch (e) {} location.reload(); };
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
var linhasLog = [];
function registra(t) {
  linhasLog.push(String(t)); if (linhasLog.length > 400) linhasLog.shift();
  $("log-txt").textContent = linhasLog.join("\n");
}
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
addEventListener("pagehide", function () { try { localStorage.removeItem("wine-mt-tentando"); } catch (e) {} });
var esperaWin = setInterval(function () {
  if (!isRunning) return;
  if (!inicioWin) inicioWin = Date.now();
  var s = Math.round((Date.now() - inicioWin) / 1000);
  estado(s < 20 ? "Windows is starting… " + s + " s" : "");
  if (s >= 20) { clearInterval(esperaWin); try { localStorage.removeItem("wine-mt-tentando"); localStorage.setItem("wine-reg", REG_CHAVE); } catch (e) {} }
}, 1000);

// --- code cache: kept per engine (jit/ or mtjit/) in IndexedDB; .boxedwine = the same zip as a file ---
function cacheDb(modo, fn) {
  return new Promise(function (ok, erro) {
    var r = indexedDB.open("inkdoshub-wine-cache", 1);
    r.onupgradeneeded = function () { r.result.createObjectStore("zips"); };
    r.onerror = function () { erro(r.error); };
    r.onsuccess = function () {
      var tx = r.result.transaction("zips", modo), q = fn(tx.objectStore("zips"));
      tx.oncomplete = function () { ok(q && q.result); };
      tx.onerror = function () { erro(tx.error); };
    };
  });
}
function lerCache() { return cacheDb("readonly", function (s) { return s.get(MOTOR); }); }
function gravarCache(b) { return cacheDb("readwrite", function (s) { s.put(b, MOTOR); }); }
var mb = function (b) { return (b.size / 1048576).toFixed(1) + " MB"; };
// the engine asks the server for "wasm-jit-modules.zip": answer with the saved cache (or "none" without going online)
var fetchOrig = window.fetch.bind(window);
window.fetch = function (u) {
  if (typeof u === "string" && /wasm-jit-modules\.zip$/.test(u)) {
    var nada = function () { return new Response(null, { status: 404 }); };
    if (!ligado(CACHE)) return Promise.resolve(nada());
    return lerCache().then(function (b) {
      if (!b) return nada();
      registra("[Hub] code cache loaded: " + mb(b));
      return new Response(b);
    }, nada);
  }
  return fetchOrig.apply(window, arguments);
};
// "Save cache" uses the engine's export; its download goes to IndexedDB instead
var baixarOrig = window.downloadBlob;
window.downloadBlob = function (blob, nome) {
  if (!/jit-modules\.zip$/.test(nome)) return baixarOrig(blob, nome);
  gravarCache(blob).then(function () { estado("Code cache saved (" + mb(blob) + "). The next start of Windows uses it."); },
    function (e) { estado("Could not save the code cache: " + e.message); });
};
$("btn-cache").onclick = function () {
  if (!isRunning) { estado("Wait for Windows to start."); return; }
  estado("Saving the code cache…");
  saveJitModules();
};
$("cache-exportar").onclick = function () {
  lerCache().then(function (b) {
    if (b) baixarOrig(b, "wine-cache-" + MOTOR.replace("/", "") + ".boxedwine");
    else estado("No code cache saved yet: turn it on in ⚙, use Windows, then tap Save cache.");
  });
};
$("cache-importar").onclick = function () { $("cache-arquivo").click(); };
$("cache-arquivo").onchange = function () {
  var f = this.files[0]; if (!f) return;
  this.value = "";
  gravarCache(f).then(function () { estado("Code cache imported (" + mb(f) + "). It is used from the next start."); },
    function (e) { estado("Could not import: " + e.message); });
};

// --- Diagnostics (Log): every 5 s, the engine's own multi-core JIT counters, to see where the time goes ---
var diagTimer = 0, diagErros = 0;
var errAntes = Module.printErr;
Module.printErr = function (t) { if (/error|fail|exception/i.test(String(t))) diagErros++; errAntes.apply(this, arguments); };
function diagnostico() {
  var t0 = performance.now(), linha = ["[Diag] " + new Date().toLocaleTimeString() + " engine=" + MOTOR.replace("/", "") +
    " cores=" + (navigator.hardwareConcurrency || "?") + " isolated=" + self.crossOriginIsolated + " errors=" + diagErros];
  try {
    if (typeof PThread !== "undefined") linha.push("workers running=" + Object.keys(PThread.pthreads || {}).length +
      " idle=" + ((PThread.unusedWorkers || []).length));
  } catch (e) {}
  if (performance.memory) linha.push("jsHeap=" + Math.round(performance.memory.usedJSHeapSize / 1048576) + "MB");
  try { if (typeof wasmMemory !== "undefined") linha.push("wasmMemory=" + Math.round(wasmMemory.buffer.byteLength / 1048576) + "MB"); } catch (e) {}
  if (typeof wasmMemory === "undefined") { registra(linha.join(" ") + " (Windows not started yet: tap Start)"); return; }
  if (!Module.getWasmJitMtRuntimeBatchStats) { registra(linha.join(" ") + " (one-core engine: no multi-core counters)"); return; }
  try {
    var b = Module.getWasmJitMtRuntimeBatchStats();
    linha.push("batch: translated=" + (b.translatedFileBacked + b.translatedAnonymous) + " pending=" + b.pendingEntries +
      " groups=" + b.groupedModules + " fn/group=" + b.averageFunctionsPerGroup.toFixed(1) + " build ok/try=" + b.constructionSuccesses + "/" + b.constructionAttempts +
      " failures=" + b.permanentFailures + " oom=" + b.groupedOomBlocks + " cancelled=" + b.cancelledEntries +
      " urgent=" + b.urgentFlushes + " instances new/reused=" + b.groupInstanceCreations + "/" + b.groupInstanceReuses);
  } catch (e) { linha.push("batch: " + e.message); }
  registra(linha.join(" "));
  if (!Module.getWasmJitModuleBrokerStats) return;
  Module.getWasmJitModuleBrokerStats().then(function (s) {
    registra("[Diag] broker: localCompiles=" + s.localCompiles + " brokerHits=" + s.brokerHits + " published=" + s.firstPublications +
      " duplicates=" + s.duplicatePublications + " received=" + s.receivedCacheEntries + " deliveryFailures=" + s.deliveryFailures +
      " ownershipErrors=" + s.ownershipErrors + " liveWorkerCopies=" + s.liveWorkerCacheModules + " liveMain=" + s.liveMainRegistryModules +
      " preload sent/fail=" + s.preloadSent + "/" + s.preloadFailures + " workers replied=" + s.workerStatsReplied + "/" + s.workerStatsExpected +
      " (" + Math.round(performance.now() - t0) + " ms)");
  }, function (e) { registra("[Diag] broker: " + e.message); });
}
$("btn-diag").onclick = function () {
  if (diagTimer) { clearInterval(diagTimer); diagTimer = 0; this.textContent = "Diagnostics"; return; }
  $("log").open = true; diagnostico(); diagTimer = setInterval(diagnostico, 5000); this.textContent = "Stop diagnostics";
};
