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
  // keep the end of the log in this browser, so it survives a crash or reload of the tab
  if (!registra.salvar) registra.salvar = setTimeout(function () {
    registra.salvar = 0;
    try { localStorage.setItem("wine-log-anterior", new Date().toLocaleTimeString() + "\n" + linhasLog.slice(-150).join("\n")); } catch (e) {}
  }, 2000);
}
// log of the previous session (shown when the tab crashed or was reloaded)
(function () {
  var ant = null;
  try { ant = localStorage.getItem("wine-log-anterior"); localStorage.removeItem("wine-log-anterior"); } catch (e) {}
  if (ant) { linhasLog.push("----- previous session (until " + ant.replace("\n", ") -----\n")); linhasLog.push("----- this session -----"); $("log-txt").textContent = linhasLog.join("\n"); }
})();
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
  linha.push("wineZip=" + (wineDisco ? "disk(read " + Math.round(wineLidos / 1048576) + "MB)" : "RAM"));
  try { if (typeof wasmTable !== "undefined") linha.push("jitFunctions=" + wasmTable.length); } catch (e) {}
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

// --- Wine on disk (OPFS) instead of RAM ---
// The engine normally downloads wine11.zip (about 100 MB) and keeps all of it in memory. Here it is saved once
// in the browser's private disk (OPFS) and the engine reads only the 1 MB pieces it needs, with a small cache.
var WINE_ZIP = "wine11.zip", WINE_VER = "wine11-v1", wineDisco = null, wineLidos = 0;
var PEDACO = 1 << 20, PEDACOS_MAX = 24;
async function wineNoDisco(url) {
  var raiz = await navigator.storage.getDirectory(), h = await raiz.getFileHandle(WINE_ZIP, { create: true });
  var f = await h.getFile();
  try { if (f.size > 0 && localStorage.getItem("wine-opfs") === WINE_VER + ":" + f.size) return f; } catch (e) {}
  var r = await fetchOrig(url);
  if (!r.ok || !r.body) throw new Error("download " + r.status);
  var total = +r.headers.get("content-length") || 0, feito = 0, leitor = r.body.getReader();
  var mostra = function () { estado("Saving Wine to this device's storage (once): " + (total ? Math.round(feito / total * 100) + "%" : Math.round(feito / 1048576) + " MB")); };
  if (h.createWritable) {
    var w = await h.createWritable();
    for (;;) { var p = await leitor.read(); if (p.done) break; await w.write(p.value); feito += p.value.length; mostra(); }
    await w.close();
  } else {
    // Safari without createWritable: a small worker writes with the synchronous access handle
    var cod = "onmessage=async function(e){var d=e.data;if(d.abrir){var r=await navigator.storage.getDirectory();var h=await r.getFileHandle(d.abrir,{create:true});self.a=await h.createSyncAccessHandle();self.a.truncate(0);self.p=0;postMessage(1);return}" +
      "if(d.fim){self.a.flush();self.a.close();postMessage(1);return}self.p+=self.a.write(d.b,{at:self.p});postMessage(1)}";
    var wk = new Worker(URL.createObjectURL(new Blob([cod], { type: "text/javascript" })));
    var manda = function (m, tr) { return new Promise(function (ok) { wk.onmessage = ok; wk.postMessage(m, tr || []); }); };
    await manda({ abrir: WINE_ZIP });
    for (;;) { var q = await leitor.read(); if (q.done) break; feito += q.value.length; await manda({ b: q.value }, [q.value.buffer]); mostra(); }
    await manda({ fim: 1 }); wk.terminate();
  }
  f = await h.getFile();
  if (total && f.size !== total) throw new Error("incomplete download");
  try { localStorage.setItem("wine-opfs", WINE_VER + ":" + f.size); } catch (e) {}
  return f;
}
// a file in the emulator's file system whose bytes come from the OPFS file, 1 MB at a time
function wineArquivoPreguicoso(dir, nome, file) {
  var guardados = new Map();
  function pedaco(n) {
    var d = guardados.get(n);
    if (d) { guardados.delete(n); guardados.set(n, d); return d; }
    var u = URL.createObjectURL(file.slice(n * PEDACO, Math.min(file.size, (n + 1) * PEDACO)));
    var x = new XMLHttpRequest();
    x.open("GET", u, false); x.overrideMimeType("text/plain; charset=x-user-defined"); x.send(null);
    URL.revokeObjectURL(u);
    var s = x.responseText; d = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) d[i] = s.charCodeAt(i) & 255;
    wineLidos += d.length;
    guardados.set(n, d);
    if (guardados.size > PEDACOS_MAX) guardados.delete(guardados.keys().next().value);
    return d;
  }
  var conteudo = { length: file.size, get: function (i) { var n = i / PEDACO | 0; return pedaco(n)[i - n * PEDACO]; } };
  var node = FS.createFile(dir, nome, { isDevice: false, contents: conteudo }, true, false);
  node.contents = conteudo;
  Object.defineProperty(node, "usedBytes", { get: function () { return file.size; } });
  function copia(destino, ofs, tam, pos) {
    if (pos >= file.size) return 0;
    var n = Math.min(file.size - pos, tam), feito = 0;
    while (feito < n) {
      var p = (pos + feito) / PEDACO | 0, ini = pos + feito - p * PEDACO, d = pedaco(p), k = Math.min(d.length - ini, n - feito);
      destino.set(d.subarray(ini, ini + k), ofs + feito); feito += k;
    }
    return n;
  }
  var ops = {};
  for (var k in node.stream_ops) ops[k] = node.stream_ops[k];
  ops.read = function (stream, buffer, offset, length, position) { return copia(buffer, offset, length, position); };
  ops.mmap = function (stream, length, position) {
    var ptr = mmapAlloc(length); if (!ptr) throw new FS.ErrnoError(48);
    copia(HEAP8, ptr, length, position); return { ptr: ptr, allocated: true };
  };
  node.stream_ops = ops;
  return node;
}
var criarOrig = window.createFile;
window.createFile = function (dir, nome, buf) {
  if (nome === WINE_ZIP && wineDisco) { registra("[Hub] " + WINE_ZIP + " read from disk (OPFS), " + Math.round(wineDisco.size / 1048576) + " MB, not kept in memory"); return wineArquivoPreguicoso(dir, nome, wineDisco); }
  return criarOrig(dir, nome, buf);
};
(function () {
  var antes = window.fetch;
  window.fetch = function (u) {
    if (typeof u === "string" && u.split("?")[0].slice(-WINE_ZIP.length - 1) === "/" + WINE_ZIP && navigator.storage && navigator.storage.getDirectory) {
      return wineNoDisco(u).then(function (f) {
        // the engine gets a 1-byte placeholder; createFile above uses the disk file instead
        wineDisco = f; return new Response(new Uint8Array(1));
      }, function (e) { registra("[Hub] OPFS not used (" + e.message + "): Wine stays in memory"); return antes.apply(window, [u]); });
    }
    return antes.apply(window, arguments);
  };
})();
