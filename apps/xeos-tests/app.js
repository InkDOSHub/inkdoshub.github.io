// XeOS capability tests: runs browser checks and builds a numbered JSON report.
// SUITE_VERSION goes up whenever tests are added or changed, so reports stay comparable.
(function () {
  "use strict";
  var SUITE_VERSION = 7;
  var lancados = [];
  if (window.launchQueue) launchQueue.setConsumer(function (p) { lancados.push((p.files || []).map(function (f) { return f.name; }).join(",") || "no files"); });
  var res = {}, $ = function (id) { return document.getElementById(id); };
  var tabela = $("tabela");

  function put(id, ok, value) {
    res[id] = { ok: ok, value: value === undefined ? null : value };
    var tr = document.getElementById("t-" + id);
    if (!tr) { tr = document.createElement("tr"); tr.id = "t-" + id; tabela.appendChild(tr); }
    var cls = ok === true ? "ok" : ok === false ? "no" : "na";
    var txt = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    tr.innerHTML = "<td></td><td></td>";
    tr.cells[0].textContent = id; tr.cells[0].className = cls;
    tr.cells[1].textContent = (ok === true ? "yes " : ok === false ? "no " : "") + txt;
  }
  function has(id, v) { put(id, !!v); }
  function err(e) { return (e && (e.name + ": " + e.message)) || String(e); }
  function timeout(p, ms) {
    return Promise.race([p, new Promise(function (_, r) { setTimeout(function () { r(new Error("timeout " + ms + " ms")); }, ms); })]);
  }
  var ativos = 0;
  async function t(id, fn, ms) {
    var t0 = performance.now(), est = $("estado");
    ativos++; est.textContent = "⏳ Running " + id + "...";
    put(id, null, "running...");
    try { var v = await timeout(Promise.resolve().then(fn), ms || 5000); put(id, v === false ? false : true, v === true || v === false ? null : v); }
    catch (e) { put(id, false, err(e)); }
    var r = res[id]; if (r) r.ms = Math.round(performance.now() - t0);
    ativos--; est.textContent = ativos ? est.textContent : "✓ " + id + " done (" + r.ms + " ms)";
    var tr = document.getElementById("t-" + id); if (tr && tr.scrollIntoView && !$("rodar").disabled) tr.scrollIntoView({ block: "nearest" });
  }

  async function rodar() {
    var n = navigator, w = window;
    // environment
    put("env.userAgent", null, n.userAgent);
    put("env.platform", null, n.platform + " · touch " + n.maxTouchPoints);
    put("env.language", null, n.languages ? n.languages.join(",") : n.language);
    put("env.timezone", null, Intl.DateTimeFormat().resolvedOptions().timeZone);
    put("env.screen", null, screen.width + "x" + screen.height + " @" + devicePixelRatio + " · window " + innerWidth + "x" + innerHeight);
    put("env.cpu", null, (n.hardwareConcurrency || "?") + " threads · " + (n.deviceMemory || "?") + " GB");
    put("env.displayMode", null, ["standalone", "fullscreen", "minimal-ui", "browser"].filter(function (m) { return matchMedia("(display-mode: " + m + ")").matches; }).join(",") || "?");
    put("env.navigatorStandalone", null, String(n.standalone));
    put("env.online", n.onLine);
    put("env.secureContext", w.isSecureContext);
    put("env.crossOriginIsolated", !!w.crossOriginIsolated);
    put("env.colorScheme", null, matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    put("env.inIframe", w.top !== w.self);
    // storage
    await t("storage.localStorage", function () { localStorage.setItem("xt", "1"); var ok = localStorage.getItem("xt") === "1"; localStorage.removeItem("xt"); return ok; });
    await t("storage.sessionStorage", function () { sessionStorage.setItem("xt", "1"); return sessionStorage.getItem("xt") === "1"; });
    await t("storage.cookies", function () { document.cookie = "xt=1; path=/; SameSite=Lax"; var ok = /xt=1/.test(document.cookie); document.cookie = "xt=; max-age=0; path=/"; return ok; });
    await t("storage.indexedDB", function () {
      return new Promise(function (ok, no) {
        var r = indexedDB.open("xeos-tests", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("s"); };
        r.onerror = function () { no(r.error); };
        r.onsuccess = function () {
          var db = r.result, tx = db.transaction("s", "readwrite");
          tx.objectStore("s").put(new Blob(["x".repeat(1e6)]), "b");
          tx.oncomplete = function () { db.close(); ok("1 MB blob saved"); };
          tx.onerror = function () { no(tx.error); };
        };
      });
    });
    await t("storage.cacheAPI", async function () { var c = await caches.open("xeos-tests"); await c.put("/xt", new Response("1")); var r = await c.match("/xt"); await caches.delete("xeos-tests"); return !!r; });
    await t("storage.estimate", async function () { var e = await n.storage.estimate(); return Math.round(e.usage / 1048576) + " MB used of " + Math.round(e.quota / 1048576) + " MB"; });
    await t("storage.persisted", async function () { return "persisted=" + await n.storage.persisted(); });
    await t("storage.OPFS", async function () {
      var d = await n.storage.getDirectory(), f = await d.getFileHandle("xt.txt", { create: true });
      var wr = await f.createWritable(); await wr.write("hello"); await wr.close();
      var txt = await (await f.getFile()).text(); await d.removeEntry("xt.txt"); return txt === "hello";
    });
    // offline / install
    has("sw.serviceWorker", "serviceWorker" in n);
    await t("sw.registrations", async function () { var r = await n.serviceWorker.getRegistrations(); return r.length + " registered"; }, 3000);
    has("pwa.launchQueue", "launchQueue" in w);
    has("pwa.beforeinstallprompt", "onbeforeinstallprompt" in w);
    has("pwa.badging", "setAppBadge" in n);
    // files
    has("files.showOpenFilePicker", "showOpenFilePicker" in w);
    has("files.showSaveFilePicker", "showSaveFilePicker" in w);
    has("files.showDirectoryPicker", "showDirectoryPicker" in w);
    has("files.inputDirectory", "webkitdirectory" in document.createElement("input"));
    has("files.dragDrop", "ondrop" in document.body);
    has("files.downloadAttr", "download" in document.createElement("a"));
    has("share.share", "share" in n);
    await t("share.canShareFile", function () { return !!(n.canShare && n.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] })); });
    // dialogs and windows (not called: XeOS may block them)
    has("ui.alert", typeof w.alert === "function");
    has("ui.confirm", typeof w.confirm === "function");
    has("ui.dialogElement", typeof w.HTMLDialogElement === "function");
    has("ui.fullscreen", !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen));
    has("ui.wakeLock", "wakeLock" in n);
    has("ui.vibrate", "vibrate" in n);
    has("ui.notification", "Notification" in w);
    put("ui.notificationPermission", null, w.Notification ? Notification.permission : "n/a");
    has("ui.pointerPressure", "PointerEvent" in w && "pressure" in PointerEvent.prototype);
    has("ui.gamepad", "getGamepads" in n);
    // media
    has("media.getUserMedia", !!(n.mediaDevices && n.mediaDevices.getUserMedia));
    has("media.getDisplayMedia", !!(n.mediaDevices && n.mediaDevices.getDisplayMedia));
    await t("media.devices", async function () { var d = await n.mediaDevices.enumerateDevices(); return d.map(function (x) { return x.kind; }).join(","); });
    has("media.MediaRecorder", "MediaRecorder" in w);
    put("media.recorderTypes", null, w.MediaRecorder ? ["video/mp4", "video/webm", "video/webm;codecs=vp9", "audio/mp4", "audio/webm", "audio/wav"].filter(function (m) { return MediaRecorder.isTypeSupported(m); }).join(",") : "n/a");
    var v = document.createElement("video");
    put("media.canPlay", null, ["video/mp4; codecs=avc1.42E01E", "video/mp4; codecs=hvc1", "video/webm; codecs=vp9", "video/mp4; codecs=av01.0.05M.08", "audio/mpeg", "audio/flac", "audio/ogg; codecs=opus"].map(function (m) { return m + "=" + (v.canPlayType(m) || "no"); }).join(" | "));
    has("media.AudioContext", w.AudioContext || w.webkitAudioContext);
    has("media.pictureInPicture", "requestPictureInPicture" in v || "webkitSetPresentationMode" in v);
    has("media.WebCodecs", "VideoEncoder" in w);
    has("media.speechSynthesis", "speechSynthesis" in w);
    has("media.speechRecognition", w.SpeechRecognition || w.webkitSpeechRecognition);
    has("media.mediaSession", "mediaSession" in n);
    // network
    has("net.WebRTC", "RTCPeerConnection" in w);
    has("net.WebSocket", "WebSocket" in w);
    has("net.WebTransport", "WebTransport" in w);
    has("net.BroadcastChannel", "BroadcastChannel" in w);
    await t("net.fetchSameOrigin", async function () { var t0 = performance.now(); var r = await fetch("../../manifest.webmanifest", { cache: "no-store" }); return r.status + " in " + Math.round(performance.now() - t0) + " ms"; });
    // compute
    has("cpu.WebAssembly", "WebAssembly" in w);
    has("cpu.SharedArrayBuffer", "SharedArrayBuffer" in w);
    has("cpu.Worker", "Worker" in w);
    has("cpu.OffscreenCanvas", "OffscreenCanvas" in w);
    has("cpu.WebGPU", "gpu" in n);
    await t("cpu.WebGL", function () {
      var gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
      if (!gl) return false; var d = gl.getExtension("WEBGL_debug_renderer_info");
      return (gl instanceof WebGLRenderingContext ? "webgl1 " : "webgl2 ") + (d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
    await t("cpu.workerRuns", function () {
      return new Promise(function (ok, no) {
        var u = URL.createObjectURL(new Blob(["postMessage(6*7)"], { type: "text/javascript" })), wk = new Worker(u);
        wk.onmessage = function (e) { wk.terminate(); ok(e.data === 42); }; wk.onerror = function (e) { no(new Error(e.message || "worker error")); };
      });
    });
    await t("cpu.benchmark", function () { var t0 = performance.now(), s = 0; for (var i = 0; i < 2e7; i++) s += i % 7; return Math.round(performance.now() - t0) + " ms (2e7 loop)"; });
    has("crypto.subtle", w.crypto && crypto.subtle);
    has("misc.CompressionStream", "CompressionStream" in w);
    has("misc.clipboardAPI", n.clipboard && n.clipboard.writeText);
    has("misc.geolocation", "geolocation" in n);
    has("misc.WebAuthn", "PublicKeyCredential" in w);
    has("misc.PaymentRequest", "PaymentRequest" in w);
    has("misc.BarcodeDetector", "BarcodeDetector" in w);
    has("misc.USB/Bluetooth/Serial/HID", ["usb", "bluetooth", "serial", "hid"].filter(function (k) { return k in n; }).join(",") || false);
    has("css.dvh", CSS.supports("height", "100dvh"));
    has("css.backdropFilter", CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"));
    has("css.containerQueries", CSS.supports("container-type", "inline-size"));
    put("pwa.launchedWithFiles", null, lancados.join(" | ") || "none (open a file in XeOS with this app to test)");
    await t("storage.idbSpeed50MB", function () {
      return new Promise(function (ok, no) {
        var r = indexedDB.open("xeos-tests", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("s"); };
        r.onsuccess = function () {
          var db = r.result, t0 = performance.now(), tx = db.transaction("s", "readwrite");
          tx.objectStore("s").put(new Blob([new Uint8Array(50 * 1048576)]), "big");
          tx.oncomplete = function () { var ms = performance.now() - t0; var d = db.transaction("s", "readwrite"); d.objectStore("s").delete("big"); d.oncomplete = function () { db.close(); }; ok(Math.round(ms) + " ms"); };
          tx.onerror = function () { no(tx.error); };
        };
        r.onerror = function () { no(r.error); };
      });
    }, 30000);
    // how XeOS works inside: native APIs vs injected JavaScript
    put("xeos.nativeOrInjected", null, ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker", "open", "alert", "confirm", "fetch"].filter(function (k) { return typeof w[k] === "function"; }).map(function (k) { return k + "=" + (/\[native code\]/.test(Function.prototype.toString.call(w[k])) ? "native" : "injected"); }).concat(["share", "clipboard.writeText", "mediaDevices.getDisplayMedia", "mediaDevices.getUserMedia", "storage.getDirectory"].map(function (k) { var o = n, ps = k.split("."); for (var i = 0; i < ps.length - 1; i++) o = o && o[ps[i]]; var f = o && o[ps[ps.length - 1]]; return k + "=" + (typeof f !== "function" ? "none" : /\[native code\]/.test(Function.prototype.toString.call(f)) ? "native" : "injected"); })).join(" | "));
    await t("xeos.injectedSource", function () { var f = w.showSaveFilePicker; var src = f ? Function.prototype.toString.call(f) : ""; return /native code/.test(src) ? "native" : src.slice(0, 600); });
    await t("xeos.extraGlobals", function () {
      var fr = document.createElement("iframe"); fr.style.display = "none"; document.body.appendChild(fr);
      var base = new Set(Object.getOwnPropertyNames(fr.contentWindow)); fr.remove();
      return Object.getOwnPropertyNames(w).filter(function (k) { return !base.has(k); }).join(",") || "none";
    });
    put("xeos.webkitBridge", null, w.webkit ? "webkit=" + Object.getOwnPropertyNames(w.webkit).join(",") + " · handlers: " + (w.webkit.messageHandlers ? ["xeos", "XeOS", "bridge", "native", "files", "fileSystem", "download", "share", "recorder", "window", "app", "log", "console"].filter(function (h) { try { return !!w.webkit.messageHandlers[h]; } catch (e) { return false; } }).join(",") || "none of the common names" : "none") : "no window.webkit");
    await t("xeos.internals", function () {
      return Object.getOwnPropertyNames(w).filter(function (k) { return /^__edb|^__air|^__active/.test(k); }).map(function (k) {
        var v = w[k], d = typeof v;
        if (d === "function") d += " " + Function.prototype.toString.call(v).slice(0, 200);
        else if (v && d === "object") { try { d += " {" + Object.keys(v).slice(0, 30).join(",") + "}"; } catch (e) { d += " (locked)"; } }
        else d += " " + String(v).slice(0, 80);
        return k + ": " + d;
      }).join(" || ");
    });
    await t("xeos.getUserMediaSource", function () { return Function.prototype.toString.call(n.mediaDevices.getUserMedia).slice(0, 400); });
    await t("xeos.openPickerSource", function () { return Function.prototype.toString.call(w.showOpenFilePicker).slice(0, 400); });
    await t("cpu.wasmSIMD", function () { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); });
    await t("gpu.adapter", async function () { var a = await n.gpu.requestAdapter({ powerPreference: "high-performance" }); if (!a) return false; var i = a.info || {}; return (i.vendor || "?") + " " + (i.architecture || "") + " · maxBuffer " + Math.round(a.limits.maxBufferSize / 1048576) + " MB · maxStorageBinding " + Math.round(a.limits.maxStorageBufferBindingSize / 1048576) + " MB · features " + Array.from(a.features).join(","); });
    // indirect estimates
    await t("est.refreshRate", function () { return new Promise(function (ok) { var f = 0, t0 = 0; function step(ts) { if (!t0) t0 = ts; f++; if (ts - t0 < 1000) requestAnimationFrame(step); else ok(Math.round(f * 1000 / (ts - t0)) + " Hz (frames per second the page gets)"); } requestAnimationFrame(step); }); });
    await t("est.timerResolution", function () { var min = 1e9, a = performance.now(); for (var i = 0; i < 1e5; i++) { var b = performance.now(); if (b > a && b - a < min) min = b - a; a = b; } return (min * 1000).toFixed(1) + " µs"; });
    await t("est.realResolution", function () { var dpr = 1; for (var d = 1; d <= 4; d += 0.25) if (matchMedia("(min-resolution: " + d + "dppx)").matches) dpr = d; return "media query dppx ≥ " + dpr + " · reported devicePixelRatio " + devicePixelRatio + " · probable panel " + Math.round(screen.width * dpr) + "x" + Math.round(screen.height * dpr); });
    await t("est.jit", function () { var t0 = performance.now(), s = 0; for (var i = 0; i < 5e6; i++) s += (i * 31) % 17; var ms = performance.now() - t0; return (ms < 60 ? "JIT on" : "JIT probably off") + " (" + ms.toFixed(1) + " ms for 5e6)"; });
    var memPrev = null; try { memPrev = sessionStorage.getItem("xeos-tests-mem"); } catch (e) {}
    if (memPrev) put("mem.lastRun", null, memPrev);
    has("css.has", CSS.supports("selector(:has(a))"));
  }

  // tests that need a tap
  var extras = {
    camera: function () { return t("tap.cameraMic", async function () { var s = await n().mediaDevices.getUserMedia({ video: true, audio: true }); var r = s.getTracks().map(function (k) { var st = k.getSettings(); return k.kind + " " + (st.width ? st.width + "x" + st.height + "@" + Math.round(st.frameRate || 0) : k.label); }).join(" | "); s.getTracks().forEach(function (k) { k.stop(); }); return r; }, 20000); },
    tela: function () { return t("tap.screenCapture", async function () { var s = await n().mediaDevices.getDisplayMedia({ video: true, audio: true }); var r = s.getTracks().map(function (k) { return k.kind; }).join(","); s.getTracks().forEach(function (k) { k.stop(); }); return "tracks: " + r; }, 30000); },
    popup: function () { return t("tap.windowOpen", function () { var p = window.open("about:blank", "_blank", "width=300,height=200"); if (!p) return false; try { p.close(); } catch (e) {} return "opened"; }); },
    clipboard: function () { return t("tap.clipboard", async function () { await n().clipboard.writeText("xeos-test"); var r = "write ok"; try { r += ", read: " + JSON.stringify(await n().clipboard.readText()); } catch (e) { r += ", read: " + err(e); } return r; }, 10000); },
    arquivo: function () {
      return t("tap.filePicker", function () {
        return new Promise(function (ok) {
          var i = document.createElement("input"); i.type = "file"; i.multiple = true;
          i.onchange = function () { ok(Array.prototype.map.call(i.files, function (f) { return f.name + " " + (f.type || "?") + " " + f.size + " B"; }).join(" | ") || "none"); };
          i.click();
        });
      }, 60000);
    },
    download: function () { return t("tap.download", function () { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["XeOS download test"], { type: "text/plain" })); a.download = "xeos-download-test.txt"; a.click(); return "triggered (check if the file arrived and note it below)"; }); }
  };
  extras.salvar = function () { return t("tap.saveFilePicker", async function () { var h = await window.showSaveFilePicker({ suggestedName: "xeos-save-test.txt" }); var w = await h.createWritable(); await w.write("XeOS save test " + new Date().toISOString()); await w.close(); var f = await h.getFile(); return "wrote " + f.name + " " + f.size + " B"; }, 60000); };
  extras.dialogos = function () { return t("tap.confirmAlert", function () { var t0 = Date.now(), c = window.confirm("XeOS test: tap OK"), ms1 = Date.now() - t0; t0 = Date.now(); window.alert("XeOS test: close this"); var ms2 = Date.now() - t0; return "confirm=" + c + " after " + ms1 + " ms, alert closed after " + ms2 + " ms (under ~50 ms means blocked)"; }, 60000); };
  extras.camera4k = async function () {
    for (var sz of [[1920, 1080], [3840, 2160]]) {
      await t("tap.camera" + sz[1] + "p", async function () { var s = await n().mediaDevices.getUserMedia({ video: { width: { ideal: sz[0] }, height: { ideal: sz[1] }, frameRate: { ideal: 60 } } }); var k = s.getVideoTracks()[0], st = k.getSettings(), c = k.getCapabilities ? k.getCapabilities() : {}; s.getTracks().forEach(function (x) { x.stop(); }); return st.width + "x" + st.height + "@" + Math.round(st.frameRate || 0) + (c.width ? " · max " + c.width.max + "x" + c.height.max + "@" + (c.frameRate ? Math.round(c.frameRate.max) : "?") : "") + " · " + (k.label || ""); }, 20000);
    }
  };
  extras.persistir = function () { return t("tap.storagePersist", async function () { return "granted=" + await n().storage.persist(); }); };
  extras.tela2 = async function () {
    await t("tap.fullscreen", async function () { var el = document.documentElement; await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen()); var on = !!(document.fullscreenElement || document.webkitFullscreenElement); if (document.exitFullscreen) document.exitFullscreen().catch(function () {}); return on; });
    await t("tap.wakeLock", async function () { var l = await n().wakeLock.request("screen"); await l.release(); return "acquired"; });
  };
  function worker(code) { return new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" }))); }
  var LOOP = "onmessage=function(e){var t0=performance.now(),s=0;for(var i=0;i<e.data;i++)s+=Math.sqrt(i)%7;postMessage([performance.now()-t0,s])}";
  function carga(k, N) {
    var ws = []; for (var i = 0; i < k; i++) ws.push(worker(LOOP));
    var t0 = performance.now();
    return Promise.all(ws.map(function (wk) { return new Promise(function (ok) { wk.onmessage = function () { wk.terminate(); ok(); }; wk.postMessage(N); }); })).then(function () { return performance.now() - t0; });
  }
  extras.bench = async function () {
    var N = 1e8;
    await t("bench.threads", async function () {
      var one = await carga(1, N), out = ["1 thread " + Math.round(one) + " ms"];
      var best = 1, bestRate = 1;
      for (var k of [2, 4, 6, 8, 10, 12, 16]) { var ms = await carga(k, N), sp = k * one / ms; out.push(k + "t " + Math.round(ms) + " ms (" + sp.toFixed(2) + "x)"); if (sp > bestRate * 1.08) { best = k; bestRate = sp; } }
      res["est.cores"] = { ok: null, value: "about " + bestRate.toFixed(1) + " cores of real work (peak at " + best + " threads; hardwareConcurrency says " + navigator.hardwareConcurrency + ")" };
      put("est.cores", null, res["est.cores"].value);
      return out.join(" · ");
    }, 60000);
    await t("bench.sustained20s", async function () {
      var ts = [], end = performance.now() + 20000;
      while (performance.now() < end) ts.push(await carga(4, 3e7));
      return ts.length + " rounds · first " + Math.round(ts[0]) + " ms · last " + Math.round(ts[ts.length - 1]) + " ms · slowdown " + (ts[ts.length - 1] / ts[0]).toFixed(2) + "x";
    }, 40000);
    await t("bench.webgpuCompute", async function () {
      var a = await n().gpu.requestAdapter({ powerPreference: "high-performance" }), d = await a.requestDevice();
      var COUNT = 1 << 20, ITER = 2048;
      var code = "@group(0) @binding(0) var<storage, read_write> b: array<f32>;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3<u32>){var x=f32(g.x)*0.0001;var y=1.0001;for(var i=0u;i<" + ITER + "u;i++){x=fma(x,y,0.5);y=fma(y,0.9999,0.0001);x=fma(x,y,-0.5);y=fma(y,1.0001,-0.0001);}b[g.x]=x+y;}";
      var buf = d.createBuffer({ size: COUNT * 4, usage: GPUBufferUsage.STORAGE });
      var p = d.createComputePipeline({ layout: "auto", compute: { module: d.createShaderModule({ code: code }), entryPoint: "main" } });
      var bg = d.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
      function run() { var e = d.createCommandEncoder(), c = e.beginComputePass(); c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(COUNT / 256); c.end(); d.queue.submit([e.finish()]); return d.queue.onSubmittedWorkDone(); }
      await run(); var t0 = performance.now(); for (var r = 0; r < 5; r++) await run(); var ms = (performance.now() - t0) / 5;
      d.destroy(); return (COUNT * ITER * 4 * 2 / ms / 1e6).toFixed(0) + " GFLOPS (" + ms.toFixed(1) + " ms per pass)";
    }, 30000);
    await t("bench.download30MB", async function () { var t0 = performance.now(), r = await fetch("../../apps/video/cortar/ffmpeg-core/ffmpeg-core.wasm?nocache=" + Date.now(), { cache: "no-store" }), b = await r.arrayBuffer(), s = (performance.now() - t0) / 1000; return (b.byteLength / 1048576).toFixed(1) + " MB in " + s.toFixed(1) + " s = " + (b.byteLength * 8 / s / 1e6).toFixed(0) + " Mbit/s"; }, 60000);
    await t("bench.opfsWrite200MB", async function () {
      var dir = await n().storage.getDirectory(), f = await dir.getFileHandle("xt-big.bin", { create: true }), wr = await f.createWritable(), chunk = new Uint8Array(8 * 1048576), t0 = performance.now();
      for (var i = 0; i < 25; i++) await wr.write(chunk); await wr.close(); var wms = performance.now() - t0;
      t0 = performance.now(); await (await f.getFile()).arrayBuffer(); var rms = performance.now() - t0; await dir.removeEntry("xt-big.bin");
      return "write " + Math.round(200000 / wms) + " MB/s · read " + Math.round(200000 / rms) + " MB/s";
    }, 60000);
  };
  // real tasks
  var BLUR = "onmessage=function(e){var d=new Uint8ClampedArray(e.data.buf),W=e.data.w,H=d.length/4/W,o=new Uint8ClampedArray(d.length),R=6;for(var p=0;p<3;p++){for(var y=0;y<H;y++)for(var x=0;x<W;x++){var r=0,g=0,b=0,n=0;for(var k=-R;k<=R;k++){var xx=x+k;if(xx<0||xx>=W)continue;var i=(y*W+xx)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++}var j=(y*W+x)*4;o[j]=r/n;o[j+1]=g/n;o[j+2]=b/n;o[j+3]=255}var t=d;d=o;o=t}postMessage(d.buffer,[d.buffer])}";
  async function blur(k) {
    var W = 3840, H = 2160, strip = Math.ceil(H / k), jobs = [], t0 = performance.now();
    for (var i = 0; i < k; i++) {
      var h = Math.min(strip, H - i * strip), buf = new Uint8ClampedArray(W * h * 4); for (var q = 0; q < buf.length; q += 7) buf[q] = q & 255;
      jobs.push(new Promise(function (ok) { var wk = worker(BLUR); wk.onmessage = function () { wk.terminate(); ok(); }; wk.postMessage({ buf: buf.buffer, w: W }, [buf.buffer]); }));
    }
    await Promise.all(jobs); return performance.now() - t0;
  }
  async function encode(codec, w, h, frames) {
    var cfg = { codec: codec, width: w, height: h, bitrate: w * h * 4, framerate: 30, hardwareAcceleration: "prefer-hardware" };
    var sup = await VideoEncoder.isConfigSupported(cfg); if (!sup.supported) return "not supported";
    var out = 0, bytes = 0, enc = new VideoEncoder({ output: function (c) { out++; bytes += c.byteLength; }, error: function () {} });
    enc.configure(cfg);
    var cv = new OffscreenCanvas(w, h), cx = cv.getContext("2d"), t0 = performance.now();
    for (var i = 0; i < frames; i++) {
      cx.fillStyle = "hsl(" + (i * 7 % 360) + ",70%,50%)"; cx.fillRect(0, 0, w, h); cx.fillStyle = "#fff"; cx.fillRect((i * 37) % w, (i * 23) % h, w / 4, h / 4);
      var f = new VideoFrame(cv, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i % 60 === 0 }); f.close();
      while (enc.encodeQueueSize > 8) await new Promise(function (r) { setTimeout(r, 1); });
    }
    await enc.flush(); var s = (performance.now() - t0) / 1000; enc.close();
    return Math.round(frames / s) + " fps (" + out + " frames, " + (bytes / 1048576).toFixed(1) + " MB)";
  }
  async function gpuPeak(f16) {
    var a = await n().gpu.requestAdapter({ powerPreference: "high-performance" });
    if (f16 && !a.features.has("shader-f16")) return "no shader-f16";
    var d = await a.requestDevice(f16 ? { requiredFeatures: ["shader-f16"] } : {}), T = f16 ? "f16" : "f32", COUNT = 1 << 20, ITER = 1024;
    var code = (f16 ? "enable f16;" : "") + "@group(0) @binding(0) var<storage, read_write> b: array<f32>;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3<u32>){var a=vec4<" + T + ">(" + T + "(g.x%7u));var c=vec4<" + T + ">(1.0);var e=vec4<" + T + ">(0.5);var h=vec4<" + T + ">(0.25);let m=vec4<" + T + ">(0.999);let k=vec4<" + T + ">(0.001);for(var i=0u;i<" + ITER + "u;i++){a=fma(a,m,k);c=fma(c,m,k);e=fma(e,m,k);h=fma(h,m,k);a=fma(a,m,k);c=fma(c,m,k);e=fma(e,m,k);h=fma(h,m,k);}let s=a+c+e+h;b[g.x]=f32(s.x+s.y+s.z+s.w);}";
    var buf = d.createBuffer({ size: COUNT * 4, usage: GPUBufferUsage.STORAGE });
    var p = d.createComputePipeline({ layout: "auto", compute: { module: d.createShaderModule({ code: code }), entryPoint: "main" } });
    var bg = d.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    function run() { var e = d.createCommandEncoder(), c = e.beginComputePass(); c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(COUNT / 256); c.end(); d.queue.submit([e.finish()]); return d.queue.onSubmittedWorkDone(); }
    await run(); var t0 = performance.now(); for (var r = 0; r < 5; r++) await run(); var ms = (performance.now() - t0) / 5; d.destroy();
    return (COUNT * ITER * 8 * 4 * 2 / ms / 1e6).toFixed(0) + " GFLOPS " + T + " (" + ms.toFixed(1) + " ms per pass)";
  }
  extras.reais = async function () {
    await t("real.gpuPeakF32", function () { return gpuPeak(false); }, 30000);
    await t("real.gpuPeakF16", function () { return gpuPeak(true); }, 30000);
    await t("real.photoBlur4K", async function () {
      var one = await blur(1), out = ["1 worker " + Math.round(one) + " ms"];
      for (var k of [2, 4, 6]) { var ms = await blur(k); out.push(k + " workers " + Math.round(ms) + " ms (" + (one / ms).toFixed(2) + "x)"); }
      return out.join(" · ");
    }, 120000);
    for (var c of [["avc1.640033", "H.264"], ["hvc1.1.6.L153.B0", "HEVC"]]) {
      for (var sz of [[1920, 1080, 120], [3840, 2160, 60]]) {
        await t("real.encode" + c[1] + "_" + sz[1] + "p", function () { return encode(c[0], sz[0], sz[1], sz[2]); }, 60000);
      }
    }
  };
  var SWAP = "onmessage=async function(){try{var d=await navigator.storage.getDirectory(),f=await d.getFileHandle('xt-swap.bin',{create:true}),h=await f.createSyncAccessHandle(),MB=1048576,SIZE=1024*MB,c=new Uint8Array(8*MB),t0=performance.now();for(var o=0;o<SIZE;o+=c.length)h.write(c,{at:o});h.flush();var w=performance.now()-t0;function rnd(bs,n){var b=new Uint8Array(bs),t=performance.now();for(var i=0;i<n;i++)h.read(b,{at:Math.floor(Math.random()*(SIZE/bs))*bs});return performance.now()-t}var r4=rnd(4096,20000),r64=rnd(65536,5000),r1m=rnd(MB,500);var b=new Uint8Array(4096),t=performance.now();for(var i=0;i<20000;i++)h.write(b,{at:Math.floor(Math.random()*(SIZE/4096))*4096});h.flush();var w4=performance.now()-t;h.close();await d.removeEntry('xt-swap.bin');postMessage('1 GB file · sequential write '+Math.round(1024000/w)+' MB/s · random read 4 KB '+Math.round(20000000/r4)+' IOPS ('+(20000*4/1024/(r4/1000)).toFixed(0)+' MB/s) · 64 KB '+(5000*64/1024/(r64/1000)).toFixed(0)+' MB/s · 1 MB '+(500/(r1m/1000)).toFixed(0)+' MB/s · random write 4 KB '+Math.round(20000000/w4)+' IOPS')}catch(e){postMessage('ERR '+e.name+': '+e.message)}}";
  extras.swap = function () {
    return t("swap.opfsSyncHandle", function () {
      return new Promise(function (ok, no) { var wk = worker(SWAP); wk.onmessage = function (e) { wk.terminate(); /^ERR/.test(e.data) ? no(new Error(e.data)) : ok(e.data); }; wk.postMessage(1); });
    }, 120000);
  };
  // suite 7
  extras.gpumem = function () {
    return t("gpu.memoryLimit", async function () {
      var a = await n().gpu.requestAdapter({ powerPreference: "high-performance" }), d = await a.requestDevice({ requiredLimits: { maxBufferSize: a.limits.maxBufferSize } }), bufs = [], mb = 0, lost = false, chunk = new Uint8Array(256 * 1048576).fill(1);
      d.lost.then(function () { lost = true; });
      try {
        while (mb < 16384 && !lost) {
          d.pushErrorScope("out-of-memory");
          var b = d.createBuffer({ size: chunk.length, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
          d.queue.writeBuffer(b, 0, chunk); await d.queue.onSubmittedWorkDone();
          var e = await d.popErrorScope(); if (e) { b.destroy(); break; }
          bufs.push(b); mb += 256;
          try { sessionStorage.setItem("xeos-tests-gpumem", "GPU reached " + mb + " MB before the page reloaded"); } catch (x) {}
        }
      } finally { bufs.forEach(function (b) { b.destroy(); }); d.destroy(); try { sessionStorage.removeItem("xeos-tests-gpumem"); } catch (x) {} }
      return mb + " MB of GPU buffers" + (lost ? " (device lost)" : "");
    }, 120000);
  };
  extras.termico = function () {
    return t("bench.thermal5min", async function () {
      var end = performance.now() + 300000, marks = [], start = performance.now(), last = start, rounds = 0, base = 0;
      while (performance.now() < end) {
        var ms = await carga(6, 3e7); rounds++; if (!base) base = ms;
        if (performance.now() - last >= 30000) { last = performance.now(); marks.push(Math.round((last - start) / 1000) + "s " + (base / ms * 100).toFixed(0) + "%"); $("estado").textContent = "⏳ Thermal test: " + marks[marks.length - 1]; }
      }
      return rounds + " rounds · speed vs start: " + marks.join(" · ");
    }, 330000);
  };
  var canal = window.BroadcastChannel ? new BroadcastChannel("xeos-tests") : null;
  if (canal) canal.onmessage = function (e) { if (e.data && e.data.ping) canal.postMessage({ pong: e.data.ping, size: e.data.buf ? e.data.buf.byteLength : 0 }); };
  extras.janelas = function () {
    return t("win.channel", function () {
      return new Promise(function (ok, no) {
        if (!canal) return no(new Error("no BroadcastChannel"));
        var times = [], i = 0, t0, big = false;
        var c2 = new BroadcastChannel("xeos-tests");
        c2.onmessage = function (e) {
          if (!e.data || !e.data.pong) return;
          if (big) { var ms = performance.now() - t0; c2.close(); return ok("ping avg " + (times.reduce(function (a, b) { return a + b; }, 0) / times.length).toFixed(2) + " ms · 50 MB round trip " + Math.round(ms) + " ms (" + Math.round(100 / (ms / 1000)) + " MB/s)"); }
          times.push(performance.now() - t0);
          if (++i < 20) { t0 = performance.now(); c2.postMessage({ ping: i + 1 }); }
          else { big = true; t0 = performance.now(); c2.postMessage({ ping: 99, buf: new Uint8Array(50 * 1048576).buffer }); }
        };
        setTimeout(function () { no(new Error("no answer: open this page in a second window first")); }, 15000);
        t0 = performance.now(); c2.postMessage({ ping: 1 });
      });
    }, 20000);
  };
  var segurando = [];
  extras.segurar = function () { return t("mem.hold2GB", function () { for (var i = 0; i < 8; i++) { var b = new Uint8Array(256 * 1048576); for (var j = 0; j < b.length; j += 4096) b[j] = 1; segurando.push(b); } return "holding 2048 MB in this window (keep it open)"; }, 60000); };
  extras.memoria = function () {
    return t("mem.limit", async function () {
      var keep = [], mb = 0;
      try {
        while (mb < 8192) {
          var b = new Uint8Array(256 * 1048576); for (var i = 0; i < b.length; i += 4096) b[i] = 1; keep.push(b); mb += 256;
          try { sessionStorage.setItem("xeos-tests-mem", "reached " + mb + " MB before the page reloaded"); } catch (e) {}
          await new Promise(function (r) { setTimeout(r, 30); });
        }
      } catch (e) { keep = null; try { sessionStorage.removeItem("xeos-tests-mem"); } catch (x) {} return "stopped at " + mb + " MB: " + err(e); }
      keep = null; try { sessionStorage.removeItem("xeos-tests-mem"); } catch (x) {} return "8192 MB ok";
    }, 120000);
  };
  extras.fundo = function () {
    $("estado").textContent = "Background test running for 60 s: minimize XeOS or this window now.";
    return t("bg.timers60s", function () {
      return new Promise(function (ok) {
        var last = Date.now(), gaps = 0, maxGap = 0, ticks = 0, vis = [], t0 = Date.now();
        var wk = worker("setInterval(function(){postMessage(Date.now())},1000)"), wticks = 0; wk.onmessage = function () { wticks++; };
        function ev() { vis.push(Math.round((Date.now() - t0) / 1000) + "s " + document.visibilityState); }
        document.addEventListener("visibilitychange", ev);
        var iv = setInterval(function () { var now = Date.now(), g = now - last; last = now; ticks++; if (g > 1500) gaps++; if (g > maxGap) maxGap = g;
          if (now - t0 >= 60000) { clearInterval(iv); wk.terminate(); document.removeEventListener("visibilitychange", ev); ok("page ticks " + ticks + "/60 · worker ticks " + wticks + "/60 · gaps " + gaps + " · longest " + Math.round(maxGap / 1000) + " s · visibility: " + (vis.join(", ") || "never hidden")); } }, 1000);
      });
    }, 90000);
  };
  function n() { return navigator; }

  function relatorio() {
    var num = 1; try { num = +(localStorage.getItem("xeos-tests-run") || 0) + 1; } catch (e) {}
    return {
      report: num, suite: SUITE_VERSION, date: new Date().toISOString(),
      page: location.href, notes: $("notas").value.trim(),
      summary: Object.keys(res).reduce(function (s, k) { var o = res[k].ok; s[o === true ? "yes" : o === false ? "no" : "info"]++; return s; }, { yes: 0, no: 0, info: 0 }),
      results: res
    };
  }
  function nome(r) { return "xeos-" + String(r.report).padStart(3, "0") + "-" + r.date.slice(0, 10) + ".json"; }

  // ?perf shows only the memory and performance tests
  if (/[?&]perf\b/.test(location.search)) {
    $("rodar").hidden = true; $("extras").hidden = $("notas").hidden = $("saida").hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll("[data-t]"), function (b) { if (!/^(bench|reais|memoria|swap|segurar|gpumem|termico|janelas)$/.test(b.dataset.t)) b.hidden = true; });
    put("env.userAgent", null, navigator.userAgent);
    put("env.screen", null, screen.width + "x" + screen.height + " @" + devicePixelRatio);
    put("env.crossOriginIsolated", !!window.crossOriginIsolated);
    try { var mp = sessionStorage.getItem("xeos-tests-mem"); if (mp) put("mem.lastRun", null, mp); var gp = sessionStorage.getItem("xeos-tests-gpumem"); if (gp) put("gpu.lastRun", null, gp); } catch (e) {}
    $("estado").textContent = "Performance mode: tap a test below.";
  }
  $("rodar").addEventListener("click", async function () {
    this.disabled = true; $("estado").textContent = "Running...";
    tabela.textContent = ""; res = {};
    await rodar();
    $("estado").textContent = Object.keys(res).length + " checks done. Now try the buttons below.";
    $("extras").hidden = $("notas").hidden = $("saida").hidden = false; this.disabled = false;
  });
  $("extras").addEventListener("click", async function (e) {
    var b = e.target.closest("[data-t]"); if (!b || b.disabled) return;
    var txt = b.textContent; b.disabled = true; b.textContent = "⏳ " + txt;
    try { await extras[b.dataset.t](); } finally { b.disabled = false; b.textContent = "✓ " + txt.replace(/^✓ /, ""); }
  });
  $("baixar").addEventListener("click", function () {
    var r = relatorio(), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
    a.download = nome(r); a.click();
    try { localStorage.setItem("xeos-tests-run", r.report); } catch (e) {}
    $("estado").textContent = "Saved " + a.download + ". Next: Upload to GitHub.";
  });
  $("copiar").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText(JSON.stringify(relatorio(), null, 2)); $("estado").textContent = "JSON copied."; }
    catch (e) { $("estado").textContent = "Copy failed: " + err(e); }
  });
})();
