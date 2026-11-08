// Browser benchmark (Geekbench-style): CPU single/multi core, memory, disk, JIT/WebAssembly,
// network, graphics/GPU and media. Results become a PDF with charts; the raw data is embedded
// in the PDF (a "%INKBENCH" comment line), so a PDF from another platform can be loaded back
// to build a comparison PDF. Everything that happens goes to a log the user can copy or save.
(function () {
  "use strict";
  var BENCH_VERSION = 2;
  var $ = function (id) { return document.getElementById(id); };
  var t00 = performance.now(), LOG = [];
  function log(m) {
    var line = "[" + ((performance.now() - t00) / 1000).toFixed(2).padStart(7) + "s] " + m;
    LOG.push(line); var el = $("b-log"); if (el) { el.textContent = LOG.slice(-6).join("\n"); }
  }
  function err(e) { return (e && (e.name + ": " + e.message + (e.stack ? " | " + String(e.stack).split("\n").slice(0, 3).join(" / ") : ""))) || String(e); }
  window.addEventListener("error", function (e) { log("PAGE ERROR " + e.message + " @ " + (e.filename || "") + ":" + e.lineno); });
  window.addEventListener("unhandledrejection", function (e) { log("UNHANDLED " + err(e.reason)); });
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function timeout(p, ms, what) {
    return Promise.race([p, new Promise(function (_, r) { setTimeout(function () { r(new Error("timeout " + ms + " ms in " + what)); }, ms); })]);
  }

  // ---------- metric definitions (ref = value that scores 1000; lower = smaller is better) ----------
  var CATS = [
    ["cpu1", "CPU single-core"], ["cpuN", "CPU multi-core"], ["mem", "Memory"], ["disk", "Storage (disk)"],
    ["jit", "JIT + WebAssembly"], ["net", "Network"], ["gfx", "Graphics + GPU"], ["media", "Media"]
  ];
  var KERNELS = [
    ["int", "Integer (JS)", "Mops/s", 500], ["float", "Floating point (JS)", "Mops/s", 200],
    ["sort", "Sorting (JS)", "M items/s", 8], ["json", "JSON parse + stringify", "MB/s", 80],
    ["regex", "Text / regex", "MB/s", 150], ["hash", "Hashing (JS)", "MB/s", 400],
    ["wint", "Integer (WebAssembly)", "Mops/s", 600], ["wfloat", "Floating point (WebAssembly)", "Mops/s", 250]
  ];
  var DEF = {};
  KERNELS.forEach(function (k) {
    DEF["cpu1." + k[0]] = { cat: "cpu1", name: k[1], unit: k[2], ref: k[3] };
    DEF["cpuN." + k[0]] = { cat: "cpuN", name: k[1], unit: k[2], ref: k[3] };
  });
  function def(id, cat, name, unit, ref, lower) { DEF[id] = { cat: cat, name: name, unit: unit, ref: ref, lower: !!lower }; }
  def("cpuN.speedup", "cpuN", "Multi-core speed-up", "x", 0);
  def("mem.copy", "mem", "Copy bandwidth", "GB/s", 10);
  def("mem.fill", "mem", "Write bandwidth", "GB/s", 10);
  def("mem.read", "mem", "Read bandwidth (JS loop)", "GB/s", 4);
  def("mem.latency", "mem", "Random access latency", "ns", 100, true);
  def("disk.opfsWrite", "disk", "OPFS write (64 MB)", "MB/s", 500);
  def("disk.opfsRead", "disk", "OPFS read (64 MB)", "MB/s", 1000);
  def("disk.idbWrite", "disk", "IndexedDB write (32 MB)", "MB/s", 100);
  def("disk.idbRead", "disk", "IndexedDB read (32 MB)", "MB/s", 200);
  def("jit.warm", "jit", "JIT speed (hot loop)", "Mops/s", 500);
  def("jit.ratio", "jit", "Warm-up gain (cold / hot)", "x", 0);
  def("jit.wasmCompile", "jit", "WebAssembly compile (30 MB)", "MB/s", 50);
  def("net.download", "net", "Download", "Mbit/s", 100);
  def("net.peak", "net", "Download peak (1 s window)", "Mbit/s", 0);
  def("net.latency", "net", "Latency (round trip)", "ms", 50, true);
  def("net.ttfb", "net", "Streaming: time to first byte", "ms", 0);
  def("net.stall", "net", "Streaming: longest stall", "ms", 0);
  def("gfx.refresh", "gfx", "Display refresh", "Hz", 0);
  def("gfx.fps", "gfx", "Animation under load", "fps", 60);
  def("gfx.canvas", "gfx", "Canvas 2D drawing", "k shapes/s", 500);
  def("gfx.webgl", "gfx", "WebGL 2 shader compute", "GFLOPS", 200);
  def("gfx.webgpu", "gfx", "WebGPU compute", "GFLOPS", 300);
  def("media.encode", "media", "Video encode 1080p (WebCodecs)", "fps", 60);

  // ---------- worker with the CPU and memory kernels ----------
  var WSRC = "(" + function () {
    var sink = 0, wi = null;
    var mbuf = null, text = "", obj = null;
    var K = {
      int: function () { var x = 123456789 | 0; for (var i = 0; i < 1e6; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; } sink += x; return 1e6; },
      float: function () {
        var it = 0;
        for (var py = 0; py < 64; py++) { var ci = py / 32 - 1; for (var px = 0; px < 64; px++) { var cr = px / 24 - 2, x = 0, y = 0, k = 0; while (k < 64 && x * x + y * y < 4) { var t = x * x - y * y + cr; y = 2 * x * y + ci; x = t; k++; } it += k; } }
        sink += it; return it;
      },
      sort: function () { var a = new Array(20000), s = 12345; for (var i = 0; i < 20000; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = s; } a.sort(function (x, y) { return x - y; }); sink += a[0]; return 20000; },
      json: function () {
        if (!obj) { obj = []; for (var i = 0; i < 500; i++) obj.push({ id: i, name: "item " + i, tags: ["a", "b", "c" + i], v: i * 1.5, ok: i % 2 === 0, sub: { x: i, y: "z" } }); }
        var s = JSON.stringify(obj), o = JSON.parse(s); sink += o.length; return s.length * 2;
      },
      regex: function () {
        if (!text) text = new Array(2001).join("lorem ipsum user42@mail.com dolor 2026-11-08 sit amet ");
        var m = text.match(/\b[\w.]+@\w+\.com\b|\d{4}-\d{2}-\d{2}/g); sink += m.length; return text.length;
      },
      hash: function () {
        if (!mbuf) { mbuf = new Uint8Array(1 << 20); for (var i = 0; i < mbuf.length; i++) mbuf[i] = (i * 31) & 255; }
        var h = 0x811c9dc5; for (var j = 0; j < mbuf.length; j++) { h ^= mbuf[j]; h = Math.imul(h, 16777619); } sink += h; return mbuf.length;
      },
      wint: function () { sink += wi.exports.i(1e6); return 1e6; },
      wfloat: function () { sink += wi.exports.f(1e6); return 1e6; }
    };
    function mem() {
      var N = 4 << 20, a = new Float64Array(N), b = new Float64Array(N), t0, n, el, out = {};
      a.fill(1); b.set(a);
      t0 = performance.now(); n = 0; do { b.set(a); n++; el = performance.now() - t0; } while (el < 600); out.copy = n * N * 8 * 2 / el / 1e6;
      t0 = performance.now(); n = 0; do { a.fill(n); n++; el = performance.now() - t0; } while (el < 600); out.fill = n * N * 8 / el / 1e6;
      t0 = performance.now(); n = 0; var s = 0; do { for (var i = 0; i < N; i++) s += a[i]; n++; el = performance.now() - t0; } while (el < 600); out.read = n * N * 8 / el / 1e6; sink += s;
      a = b = null;
      var M = 8 << 20, p = new Int32Array(M);
      for (var q = 0; q < M; q++) p[q] = q;
      for (var r = M - 1; r > 0; r--) { var j = Math.floor(Math.random() * r), tmp = p[r]; p[r] = p[j]; p[j] = tmp; }
      var k = 0, steps = 4e6; t0 = performance.now();
      for (var z = 0; z < steps; z++) k = p[k];
      out.latency = (performance.now() - t0) * 1e6 / steps; sink += k;
      return out;
    }
    onmessage = function (e) {
      var d = e.data;
      try {
        if (d.init) { if (d.wasm) wi = new WebAssembly.Instance(new WebAssembly.Module(d.wasm)); postMessage({ ready: true, wasm: !!wi }); return; }
        if (d.mem) { postMessage({ mem: mem() }); return; }
        var f = K[d.k]; if (!f || (d.k[0] === "w" && !wi)) { postMessage({ k: d.k, error: "not available" }); return; }
        var end = performance.now() + d.warm; while (performance.now() < end) f();
        var u = 0, t0 = performance.now(), now; do { u += f(); now = performance.now(); } while (now - t0 < d.ms);
        postMessage({ k: d.k, rate: u / (now - t0) / 1000, sink: sink & 1 });
      } catch (x) { postMessage({ k: d.k, error: String(x && x.message || x) }); }
    };
  }.toString() + ")()";

  // Tiny hand-written WebAssembly module: i(n) = xorshift loop, f(n) = f64 multiply-add loop
  function wasmBytes() {
    function f64(v) { return Array.from(new Uint8Array(new Float64Array([v]).buffer)); }
    function sec(id, b) { return [id, b.length].concat(b); }
    var bodyI = [1, 1, 0x7f, 0x20, 0, 0x21, 1, 0x03, 0x40,
      0x20, 1, 0x20, 1, 0x41, 13, 0x74, 0x73, 0x21, 1,
      0x20, 1, 0x20, 1, 0x41, 17, 0x76, 0x73, 0x21, 1,
      0x20, 1, 0x20, 1, 0x41, 5, 0x74, 0x73, 0x21, 1,
      0x20, 0, 0x41, 1, 0x6b, 0x22, 0, 0x0d, 0, 0x0b, 0x20, 1, 0x0b];
    var bodyF = [1, 2, 0x7c, 0x44].concat(f64(0.5), [0x21, 1, 0x03, 0x40, 0x20, 1, 0x44], f64(1.000001), [0xa2, 0x44], f64(1e-6), [0xa0, 0x21, 1,
      0x20, 2, 0x20, 1, 0x20, 1, 0xa2, 0xa0, 0x21, 2,
      0x20, 0, 0x41, 1, 0x6b, 0x22, 0, 0x0d, 0, 0x0b, 0x20, 2, 0x0b]);
    var code = [2, bodyI.length].concat(bodyI, [bodyF.length], bodyF);
    return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0].concat(
      sec(1, [2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 1, 0x7c]),
      sec(3, [2, 0, 1]),
      sec(7, [2, 1, 0x69, 0, 0, 1, 0x66, 0, 1]),
      sec(10, code)));
  }

  function mkWorker() {
    return new Promise(function (ok, no) {
      var w = new Worker(URL.createObjectURL(new Blob([WSRC], { type: "text/javascript" })));
      w.onerror = function (e) { no(new Error("worker: " + (e.message || "failed"))); };
      w.onmessage = function (e) { if (e.data.ready) { w.wasm = e.data.wasm; ok(w); } };
      var wb = null; try { wb = wasmBytes(); } catch (e) { log("wasm bytes: " + err(e)); }
      w.postMessage({ init: true, wasm: wb });
    });
  }
  function ask(w, msg) { return new Promise(function (ok) { w.onmessage = function (e) { ok(e.data); }; w.postMessage(msg); }); }

  // ---------- result state ----------
  var R = null, parar = false;
  function M(id, v, note) {
    if (v == null || !isFinite(v)) { R.metrics[id] = { v: null, note: note || "n/a" }; log("  " + id + " = n/a " + (note || "")); }
    else { R.metrics[id] = { v: +(+v).toPrecision(4), note: note || "" }; log("  " + id + " = " + R.metrics[id].v + " " + (DEF[id] ? DEF[id].unit : "") + (note ? " (" + note + ")" : "")); }
    guardar(); desenhar();
  }
  function score(id, m) {
    var d = DEF[id]; if (!d || !d.ref || !m || m.v == null || m.v <= 0) return null;
    return Math.round(1000 * (d.lower ? d.ref / m.v : m.v / d.ref));
  }
  function geo(a) { a = a.filter(function (x) { return x > 0; }); if (!a.length) return null; return Math.round(Math.exp(a.reduce(function (s, x) { return s + Math.log(x); }, 0) / a.length)); }
  function scores(r) {
    var out = {};
    CATS.forEach(function (c) { out[c[0]] = geo(Object.keys(r.metrics).filter(function (id) { return DEF[id] && DEF[id].cat === c[0]; }).map(function (id) { return score(id, r.metrics[id]) || 0; })); });
    out.overall = geo([out.cpu1, out.cpuN, out.mem, out.gfx].map(function (x) { return x || 0; }));
    return out;
  }
  function guardar() { try { R.scores = scores(R); localStorage.setItem("inkbench-last", JSON.stringify(R)); } catch (e) {} }

  // ---------- identification ----------
  async function identify() {
    var n = navigator, ua = n.userAgent, i = {};
    var ipad = /Macintosh/.test(ua) && n.maxTouchPoints > 1;
    var xeos = Object.keys(window).filter(function (k) { return /^__edb/.test(k); }).length > 0;
    i.browser = xeos ? "XeOS" : n.brave ? "Brave" : /EdgA?\/|EdgiOS/.test(ua) ? "Edge" : /OPR\/|OPiOS/.test(ua) ? "Opera" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Unknown";
    if (n.brave && !xeos) { try { if (!(await n.brave.isBrave())) i.browser = "Chrome"; } catch (e) {} }
    var mv = ua.match(/(?:CriOS|Chrome|FxiOS|Firefox|EdgiOS|Edg|OPR)\/([\d.]+)/) || ua.match(/Version\/([\d.]+)/);
    i.browserVersion = mv ? mv[1] : "?";
    i.engine = /AppleWebKit/.test(ua) && !/Chrome\//.test(ua) ? "WebKit" : /Chrome\//.test(ua) ? "Blink" : /Gecko\//.test(ua) ? "Gecko" : "?";
    var ios = ua.match(/(?:iPhone|CPU) OS (\d+)_(\d+)/);
    if (/iPhone/.test(ua)) { i.os = "iOS"; i.device = "iPhone"; }
    else if (/iPad/.test(ua) || ipad) { i.os = "iPadOS"; i.device = "iPad"; }
    else if (/Android/.test(ua)) { i.os = "Android"; i.device = "Android"; }
    else if (/Windows/.test(ua)) { i.os = "Windows"; i.device = "PC"; }
    else if (/Mac OS X/.test(ua)) { i.os = "macOS"; i.device = "Mac"; }
    else if (/CrOS/.test(ua)) { i.os = "ChromeOS"; i.device = "Chromebook"; }
    else if (/Linux/.test(ua)) { i.os = "Linux"; i.device = "PC"; }
    else { i.os = "?"; i.device = "?"; }
    i.osVersion = ios ? ios[1] + "." + ios[2] : ((ua.match(/Android ([\d.]+)|Windows NT ([\d.]+)|Mac OS X ([\d_]+)/) || []).slice(1).filter(Boolean)[0] || "?").replace(/_/g, ".");
    // iPad asks for the desktop site, so its UA says "Mac OS X 10_15_7"; the Safari version follows the iPadOS version
    if (ipad && /Version\/([\d.]+)/.test(ua)) i.osVersion = ua.match(/Version\/([\d.]+)/)[1] + " (from Safari version)";
    try {
      if (n.userAgentData && n.userAgentData.getHighEntropyValues) {
        var h = await n.userAgentData.getHighEntropyValues(["architecture", "bitness", "model", "platformVersion"]);
        i.arch = (h.architecture || "?") + " " + (h.bitness || "") + "-bit"; if (h.model) i.model = h.model; if (h.platformVersion) i.osVersion = h.platformVersion;
      }
    } catch (e) { log("UA-CH: " + err(e)); }
    i.cpuThreads = n.hardwareConcurrency || "?";
    i.memory = n.deviceMemory ? n.deviceMemory + " GB (browser rounds it)" : "hidden by the browser";
    try { var est = await n.storage.estimate(); i.storageQuota = (est.quota / 1073741824).toFixed(1) + " GB available to the site"; } catch (e) { i.storageQuota = "?"; }
    try {
      var c = document.createElement("canvas"), gl = c.getContext("webgl2") || c.getContext("webgl");
      var ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      i.gpu = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) + " · " + gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.RENDERER)) : "no WebGL";
    } catch (e) { i.gpu = "?"; }
    try {
      if (n.gpu) { var a = await n.gpu.requestAdapter(); var ai = a && (a.info || (a.requestAdapterInfo && await a.requestAdapterInfo())); i.webgpu = ai ? [ai.vendor, ai.architecture, ai.device, ai.description].filter(Boolean).join(" · ") || "yes" : "no adapter"; }
      else i.webgpu = "not supported";
    } catch (e) { i.webgpu = "error " + err(e); }
    var g = i.gpu + " " + i.webgpu;
    var am = g.match(/Apple (M\d[^,)·]*)/);
    i.chip = am ? "Apple " + am[1].trim() : /apple/i.test(g) || /iPhone|iPad|Mac/.test(i.device) ? "Apple silicon (" + (i.device === "iPhone" || i.device === "iPad" ? "A/M series" : "M series or Intel") + ", exact model hidden by the browser)" :
      /nvidia|geforce|rtx/i.test(g) ? "PC with NVIDIA GPU" : /radeon|amd/i.test(g) ? "PC with AMD GPU" : /intel/i.test(g) ? "Intel" : /adreno|qualcomm/i.test(g) ? "Qualcomm Snapdragon" : /mali/i.test(g) ? "ARM (Mali GPU)" : "unknown";
    i.screen = screen.width + "x" + screen.height + " @" + devicePixelRatio + "x · window " + innerWidth + "x" + innerHeight;
    var cn = n.connection; i.connection = cn ? [cn.effectiveType, cn.type, cn.downlink != null ? cn.downlink + " Mbit/s (browser estimate)" : "", cn.rtt != null ? "rtt " + cn.rtt + " ms" : ""].filter(Boolean).join(" · ") : "not exposed";
    i.crossOriginIsolated = !!window.crossOriginIsolated;
    i.userAgent = ua;
    return i;
  }
  function autoLabel(i) { return i.browser + " · " + i.device + " · " + i.os + " " + String(i.osVersion).split(" ")[0]; }

  // ---------- tests ----------
  async function cpu(nW, prefix) {
    var ws = [];
    for (var k = 0; k < nW; k++) ws.push(await mkWorker());
    log(prefix + ": " + nW + " worker(s), wasm " + (ws[0].wasm ? "ok" : "unavailable"));
    try {
      for (var j = 0; j < KERNELS.length && !parar; j++) {
        var kk = KERNELS[j][0];
        var rs = await Promise.all(ws.map(function (w) { return ask(w, { k: kk, warm: 150, ms: 700 }); }));
        var bad = rs.filter(function (r) { return r.error; });
        if (bad.length === rs.length) M(prefix + "." + kk, null, bad[0].error);
        else M(prefix + "." + kk, rs.reduce(function (s, r) { return s + (r.rate || 0); }, 0), bad.length ? bad.length + " worker errors" : "");
      }
    } finally { ws.forEach(function (w) { w.terminate(); }); }
  }
  async function memoria() {
    var w = await mkWorker();
    try { var r = await ask(w, { mem: true }); if (r.error) throw new Error(r.error); M("mem.copy", r.mem.copy); M("mem.fill", r.mem.fill); M("mem.read", r.mem.read); M("mem.latency", r.mem.latency); }
    finally { w.terminate(); }
  }
  function hot(n) { var s = 0; for (var i = 0; i < n; i++) { s = (s + (i ^ (s << 1))) | 0; } return s; }
  async function jit() {
    var N = 2e5, t0 = performance.now(); hot(N); var cold = performance.now() - t0;
    for (var k = 0; k < 60; k++) hot(N);
    var best = 1e9; for (var q = 0; q < 15; q++) { t0 = performance.now(); hot(N); best = Math.min(best, performance.now() - t0); }
    best = Math.max(best, 0.01);
    var mops = N / best / 1000;
    M("jit.warm", mops, mops > 150 ? "JIT on" : mops < 40 ? "JIT looks OFF (interpreter only)" : "");
    M("jit.ratio", cold / best, "first run " + cold.toFixed(2) + " ms, best " + best.toFixed(3) + " ms");
  }
  async function disco() {
    try {
      var d = await navigator.storage.getDirectory(), fh = await d.getFileHandle("inkbench.bin", { create: true });
      var chunk = new Uint8Array(8 << 20); for (var i = 0; i < chunk.length; i += 4096) chunk[i] = i & 255;
      var t0 = performance.now(), wr = await fh.createWritable();
      for (var k = 0; k < 8; k++) await wr.write(chunk);
      await wr.close(); var ms = performance.now() - t0; M("disk.opfsWrite", 64 / (ms / 1000));
      t0 = performance.now(); var buf = await (await fh.getFile()).arrayBuffer(); ms = performance.now() - t0;
      M("disk.opfsRead", buf.byteLength / 1048576 / (ms / 1000)); buf = null;
      await d.removeEntry("inkbench.bin");
    } catch (e) { M("disk.opfsWrite", null, err(e)); M("disk.opfsRead", null, "skipped"); }
    try {
      var db = await new Promise(function (ok, no) { var r = indexedDB.open("inkbench", 1); r.onupgradeneeded = function () { r.result.createObjectStore("s"); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; });
      function tx(mode, fn) { return new Promise(function (ok, no) { var t = db.transaction("s", mode), s = t.objectStore("s"), out = fn(s); t.oncomplete = function () { ok(out.result); }; t.onerror = function () { no(t.error); }; }); }
      var data = new Uint8Array(32 << 20); for (var j = 0; j < data.length; j += 4096) data[j] = j & 255;
      var t1 = performance.now(); await tx("readwrite", function (s) { return s.put(data.buffer, "a"); }); M("disk.idbWrite", 32 / ((performance.now() - t1) / 1000));
      t1 = performance.now(); var got = await tx("readonly", function (s) { return s.get("a"); }); M("disk.idbRead", (got ? got.byteLength : 0) / 1048576 / ((performance.now() - t1) / 1000));
      db.close(); indexedDB.deleteDatabase("inkbench");
    } catch (e) { M("disk.idbWrite", null, err(e)); M("disk.idbRead", null, "skipped"); }
  }
  async function rede() {
    var lat = [];
    for (var k = 0; k < 7; k++) { var t0 = performance.now(); try { await fetch("../../favicon.ico?r=" + Math.random(), { method: "HEAD", cache: "no-store" }); lat.push(performance.now() - t0); } catch (e) { log("latency fetch: " + err(e)); } }
    lat.shift(); lat.sort(function (a, b) { return a - b; });
    M("net.latency", lat.length ? lat[lat.length >> 1] : null, lat.length ? "median of " + lat.length : "failed");
    var url = "../../apps/video/cortar/ffmpeg-core/ffmpeg-core.wasm?nocache=" + Date.now();
    var t1 = performance.now(), r = await fetch(url, { cache: "no-store" }), ttfb = performance.now() - t1;
    if (!r.ok) throw new Error("HTTP " + r.status);
    var rd = r.body.getReader(), parts = [], total = 0, last = performance.now(), gap = 0, win = last, wbytes = 0, peak = 0;
    for (;;) {
      var x = await rd.read(); var now = performance.now();
      if (x.done) break;
      gap = Math.max(gap, now - last); last = now; parts.push(x.value); total += x.value.length; wbytes += x.value.length;
      if (now - win >= 1000) { peak = Math.max(peak, wbytes * 8 / ((now - win) / 1000) / 1e6); win = now; wbytes = 0; }
    }
    var secs = (performance.now() - t1) / 1000;
    M("net.ttfb", ttfb); M("net.stall", gap);
    M("net.download", total * 8 / secs / 1e6, (total / 1048576).toFixed(1) + " MB in " + secs.toFixed(1) + " s");
    M("net.peak", peak || total * 8 / secs / 1e6);
    var buf = new Uint8Array(total), o = 0; parts.forEach(function (p) { buf.set(p, o); o += p.length; }); parts = null;
    try { var t2 = performance.now(); await WebAssembly.compile(buf); M("jit.wasmCompile", total / 1048576 / ((performance.now() - t2) / 1000)); }
    catch (e) { M("jit.wasmCompile", null, err(e)); }
  }
  function frames(ms, draw) {
    return new Promise(function (ok) { var n = 0, t0 = performance.now(); function f(now) { if (draw) draw(); n++; if (now - t0 < ms) requestAnimationFrame(f); else ok(n / ((now - t0) / 1000)); } requestAnimationFrame(f); });
  }
  async function graficos() {
    M("gfx.refresh", await frames(1000));
    var c = document.createElement("canvas"); c.width = c.height = 1024; var g = c.getContext("2d");
    var cols = []; for (var i = 0; i < 64; i++) cols.push("hsla(" + (i * 37 % 360) + ",70%,50%,0.5)");
    function shapes(n) { for (var k = 0; k < n; k++) { g.fillStyle = cols[k & 63]; var x = (k * 97) % 1000, y = (k * 61) % 1000; if (k & 1) g.fillRect(x, y, 40, 30); else { g.beginPath(); g.arc(x, y, 18, 0, 6.283); g.fill(); } } }
    var t0 = performance.now(), cnt = 0; while (performance.now() - t0 < 800) { shapes(500); g.getImageData(0, 0, 1, 1); cnt += 500; }
    M("gfx.canvas", cnt / (performance.now() - t0));
    M("gfx.fps", await frames(2000, function () { shapes(3000); }), "3000 shapes per frame");
    try {
      var c2 = document.createElement("canvas"); c2.width = c2.height = 1024;
      var gl = c2.getContext("webgl2", { antialias: false }); if (!gl) throw new Error("no WebGL 2");
      var IT = 512;
      function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}"));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;uniform float u;out vec4 o;void main(){float x=gl_FragCoord.x*0.001+u;float y=1.0001+gl_FragCoord.y*1e-7;for(int i=0;i<" + IT + ";i++){x=x*y+0.5;y=y*0.9999+0.0001;x=x*y-0.5;y=y*1.0001-0.0001;}o=vec4(x,y,0.0,1.0);}"));
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p);
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(p, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      var uu = gl.getUniformLocation(p, "u"), px = new Uint8Array(4);
      gl.viewport(0, 0, 1024, 1024);
      function draw(v) { gl.uniform1f(uu, v); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      draw(0.1); var t1 = performance.now(), reps = 6; for (var r = 0; r < reps; r++) draw(r * 0.01);
      var ms = performance.now() - t1;
      M("gfx.webgl", 1024 * 1024 * IT * 8 * reps / ms / 1e6, (ms / reps).toFixed(1) + " ms per pass");
      var lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
    } catch (e) { M("gfx.webgl", null, err(e)); }
    try {
      if (!navigator.gpu) throw new Error("WebGPU not supported");
      var a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }), dv = await a.requestDevice();
      var COUNT = 1 << 20, ITER = 2048;
      var code = "@group(0) @binding(0) var<storage, read_write> b: array<f32>;@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3<u32>){var x=f32(g.x)*0.0001;var y=1.0001;for(var i=0u;i<" + ITER + "u;i++){x=fma(x,y,0.5);y=fma(y,0.9999,0.0001);x=fma(x,y,-0.5);y=fma(y,1.0001,-0.0001);}b[g.x]=x+y;}";
      var buf = dv.createBuffer({ size: COUNT * 4, usage: GPUBufferUsage.STORAGE });
      var pl = dv.createComputePipeline({ layout: "auto", compute: { module: dv.createShaderModule({ code: code }), entryPoint: "main" } });
      var bg = dv.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
      function run() { var e = dv.createCommandEncoder(), cp = e.beginComputePass(); cp.setPipeline(pl); cp.setBindGroup(0, bg); cp.dispatchWorkgroups(COUNT / 256); cp.end(); dv.queue.submit([e.finish()]); return dv.queue.onSubmittedWorkDone(); }
      await run(); var t2 = performance.now(); for (var q = 0; q < 5; q++) await run(); var ms2 = (performance.now() - t2) / 5;
      dv.destroy(); M("gfx.webgpu", COUNT * ITER * 4 * 2 / ms2 / 1e6, ms2.toFixed(1) + " ms per pass");
    } catch (e) { M("gfx.webgpu", null, err(e)); }
  }
  async function media() {
    if (!window.VideoEncoder) { M("media.encode", null, "WebCodecs not supported"); return; }
    var W = 1920, H = 1080, cfg = null;
    var tries = [{ codec: "avc1.640028", width: W, height: H, bitrate: 8e6, framerate: 30, avc: { format: "annexb" } }, { codec: "vp8", width: W, height: H, bitrate: 8e6, framerate: 30 }];
    for (var i = 0; i < tries.length && !cfg; i++) { try { var s = await VideoEncoder.isConfigSupported(tries[i]); if (s.supported) cfg = tries[i]; } catch (e) { log("encoder config: " + err(e)); } }
    if (!cfg) { M("media.encode", null, "no supported codec"); return; }
    var c = document.createElement("canvas"); c.width = W; c.height = H; var g = c.getContext("2d"), outN = 0, fail = null;
    var enc = new VideoEncoder({ output: function () { outN++; }, error: function (e) { fail = e; } });
    enc.configure(cfg);
    var N = 90, t0 = performance.now();
    for (var f = 0; f < N && !fail; f++) {
      g.fillStyle = "hsl(" + (f * 4) + ",60%,50%)"; g.fillRect(0, 0, W, H); g.fillStyle = "#fff"; g.fillRect((f * 20) % W, 300, 200, 200);
      var vf = new VideoFrame(c, { timestamp: f * 33333 }); enc.encode(vf, { keyFrame: f % 30 === 0 }); vf.close();
      while (enc.encodeQueueSize > 4) await sleep(1);
    }
    await enc.flush(); var secs = (performance.now() - t0) / 1000; enc.close();
    if (fail) throw fail;
    M("media.encode", N / secs, cfg.codec + " · " + outN + " chunks");
  }

  var PASSOS = [
    ["Identify device", async function () { R.info = await identify(); R.label = R.label || autoLabel(R.info); $("b-label").value = R.label; Object.keys(R.info).forEach(function (k) { log("  " + k + ": " + R.info[k]); }); }],
    ["CPU single-core", function () { return cpu(1, "cpu1"); }],
    ["CPU multi-core", async function () {
      var n = Math.min(Math.max(navigator.hardwareConcurrency || 4, 2), 16);
      await cpu(n, "cpuN");
      var a = KERNELS.map(function (k) { var s = R.metrics["cpu1." + k[0]], m = R.metrics["cpuN." + k[0]]; return s && m && s.v && m.v ? m.v / s.v : 0; });
      M("cpuN.speedup", geo(a.map(function (x) { return x * 1000; })) / 1000, n + " threads");
    }],
    ["Memory", memoria], ["JIT", jit], ["Storage", disco], ["Network + WebAssembly compile", rede],
    ["Graphics + GPU", graficos], ["Media", media]
  ];
  async function rodar() {
    parar = false;
    R = { kind: "inkbench", version: BENCH_VERSION, date: new Date().toISOString(), label: $("b-label").value.trim(), info: {}, metrics: {}, log: [] };
    LOG.length = 0; t00 = performance.now();
    log("Benchmark v" + BENCH_VERSION + " started " + R.date + " · " + location.href);
    $("b-rodar").disabled = true; $("b-parar").hidden = false;
    for (var i = 0; i < PASSOS.length; i++) {
      if (parar) { log("Stopped by the user"); break; }
      $("b-estado").textContent = "⏳ " + PASSOS[i][0] + " (" + (i + 1) + "/" + PASSOS.length + ")";
      log("== " + PASSOS[i][0]); var t0 = performance.now();
      try { await timeout(Promise.resolve().then(PASSOS[i][1]), 120000, PASSOS[i][0]); }
      catch (e) { log("ERROR in " + PASSOS[i][0] + ": " + err(e)); }
      log("   done in " + ((performance.now() - t0) / 1000).toFixed(1) + " s");
      await sleep(300);
    }
    R.scores = scores(R); R.log = LOG.slice(); guardar();
    log("Scores " + JSON.stringify(R.scores));
    $("b-estado").textContent = parar ? "Stopped. Partial results below." : "✓ Done. Overall score " + (R.scores.overall || "?") + ".";
    $("b-rodar").disabled = false; $("b-parar").hidden = true; desenhar();
  }

  // ---------- screen ----------
  var OUTROS = [], CORES = ["#2563eb", "#f59e0b", "#16a34a", "#dc2626"];
  function fmt(v) { return v == null ? "n/a" : v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }
  function sets() { return (R && Object.keys(R.metrics).length ? [R] : []).concat(OUTROS).slice(0, 4); }
  function desenhar() {
    var S = sets(), box = $("b-cards"), tb = $("b-tabela");
    box.textContent = ""; tb.textContent = "";
    $("b-saida").hidden = !R; $("b-comp").hidden = S.length < 2;
    $("b-lista").textContent = OUTROS.length ? "Loaded for comparison: " + OUTROS.map(function (o) { return o.label; }).join(" · ") : "";
    if (!S.length) return;
    S.forEach(function (s) { s.scores = s.scores || scores(s); });
    var linhas = [["overall", "Overall"]].concat(CATS);
    var max = 1; S.forEach(function (s) { linhas.forEach(function (c) { max = Math.max(max, s.scores[c[0]] || 0); }); });
    linhas.forEach(function (c) {
      var d = document.createElement("div"); d.className = "card" + (c[0] === "overall" ? " big" : "");
      var h = document.createElement("div"); h.className = "card-t"; h.textContent = c[1]; d.appendChild(h);
      S.forEach(function (s, k) {
        var v = s.scores[c[0]], row = document.createElement("div"); row.className = "barra";
        var bar = document.createElement("span"); bar.style.width = Math.max(2, (v || 0) / max * 100) + "%"; bar.style.background = CORES[k];
        var num = document.createElement("b"); num.textContent = v == null ? "–" : v;
        row.title = s.label; row.appendChild(bar); row.appendChild(num); d.appendChild(row);
      });
      box.appendChild(d);
    });
    if (S.length > 1) {
      var lg = document.createElement("div"); lg.className = "legenda";
      S.forEach(function (s, k) { var sp = document.createElement("span"); sp.innerHTML = "<i></i>"; sp.firstChild.style.background = CORES[k]; sp.appendChild(document.createTextNode(s.label)); lg.appendChild(sp); });
      box.insertBefore(lg, box.firstChild);
    }
    var ids = idsDe(S), tr = document.createElement("tr");
    ["Test"].concat(S.map(function (s) { return s.label; })).forEach(function (t) { var th = document.createElement("th"); th.textContent = t; tr.appendChild(th); });
    tb.appendChild(tr);
    var cat = "";
    ids.forEach(function (id) {
      var dd = DEF[id] || { name: id, unit: "", cat: "" };
      if (dd.cat !== cat) { cat = dd.cat; var trc = document.createElement("tr"), tdc = document.createElement("td"); tdc.colSpan = S.length + 1; tdc.className = "cat"; tdc.textContent = (CATS.find(function (c) { return c[0] === cat; }) || [0, cat])[1]; trc.appendChild(tdc); tb.appendChild(trc); }
      var r = document.createElement("tr"), t0 = document.createElement("td"); t0.textContent = dd.name + (dd.unit ? " (" + dd.unit + ")" : ""); r.appendChild(t0);
      S.forEach(function (s) { var m = s.metrics[id], td = document.createElement("td"); td.textContent = m ? fmt(m.v) : "–"; if (m && m.note) td.title = m.note; if (m && m.v == null) td.className = "na"; r.appendChild(td); });
      tb.appendChild(r);
    });
  }
  function idsDe(S) {
    var ids = Object.keys(DEF).filter(function (id) { return S.some(function (s) { return s.metrics[id]; }); });
    S.forEach(function (s) { Object.keys(s.metrics).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); }); });
    return ids;
  }

  // ---------- minimal PDF writer (vector text, bars, lines; Helvetica) ----------
  function Pdf() { this.pages = []; this.novaPagina(); }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (x) { return (x / 255).toFixed(3); }).join(" "); }
  function esc(s) { return String(s).replace(/[^\x20-\x7e\xa0-\xff]/g, function (c) { return { "–": "-", "—": "-", "·": "\xb7", "✓": "ok", "×": "x" }[c] || "?"; }).replace(/[\\()]/g, "\\$&"); }
  Pdf.prototype.novaPagina = function () { this.c = []; this.pages.push(this.c); this.y = 50; };
  Pdf.prototype.txt = function (x, y, s, sz, bold, cor) { this.c.push(rgb(cor || "#111111") + " rg BT /" + (bold ? "F2" : "F1") + " " + sz + " Tf " + x.toFixed(1) + " " + (842 - y).toFixed(1) + " Td (" + esc(s) + ") Tj ET"); };
  Pdf.prototype.rect = function (x, y, w, h, cor) { this.c.push(rgb(cor) + " rg " + x.toFixed(1) + " " + (842 - y - h).toFixed(1) + " " + w.toFixed(1) + " " + h.toFixed(1) + " re f"); };
  Pdf.prototype.linha = function (x1, y1, x2, y2, cor) { this.c.push(rgb(cor || "#dddddd") + " RG 0.5 w " + x1 + " " + (842 - y1) + " m " + x2 + " " + (842 - y2) + " l S"); };
  Pdf.prototype.espaco = function (h) { if (this.y + h > 800) this.novaPagina(); };
  Pdf.prototype.bytes = function (dados) {
    var objs = [null, "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
    var kids = [], self = this;
    this.pages.forEach(function (c, i) {
      var pn = 5 + i * 2; kids.push(pn + " 0 R");
      c.push("0.6 0.6 0.6 rg BT /F1 8 Tf 40 25 Td (InkDOS Hub browser benchmark \xb7 page " + (i + 1) + " of " + self.pages.length + ") Tj ET");
      var s = c.join("\n");
      objs[pn] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + (pn + 1) + " 0 R >>";
      objs[pn + 1] = "<< /Length " + s.length + " >>\nstream\n" + s + "\nendstream";
    });
    objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length + " >>";
    var out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", off = [];
    for (var i = 1; i < objs.length; i++) { off[i] = out.length; out += i + " 0 obj\n" + objs[i] + "\nendobj\n"; }
    out += "%INKBENCH " + btoa(unescape(encodeURIComponent(JSON.stringify(dados)))) + "\n";
    var xr = out.length;
    out += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
    for (var j = 1; j < objs.length; j++) out += String(off[j]).padStart(10, "0") + " 00000 n \n";
    out += "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + xr + "\n%%EOF\n";
    var u = new Uint8Array(out.length); for (var k = 0; k < out.length; k++) u[k] = out.charCodeAt(k) & 255;
    return u;
  }
  function corta(s, w, sz) { s = String(s); var n = Math.floor(w / (sz * 0.5)); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "." : s; }

  function pdfDe(S) {
    var p = new Pdf(), comp = S.length > 1;
    S.forEach(function (s) { s.scores = s.scores || scores(s); });
    p.txt(40, p.y, comp ? "Browser benchmark comparison" : "Browser benchmark", 20, true); p.y += 18;
    p.txt(40, p.y, "InkDOS Hub \xb7 benchmark v" + BENCH_VERSION + " \xb7 " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", 9, false, "#666666"); p.y += 22;
    S.forEach(function (s, k) { p.rect(40, p.y - 8, 9, 9, CORES[k]); p.txt(54, p.y, corta(s.label + "  (" + String(s.date).slice(0, 10) + ")", 480, 11), 11, true); p.y += 15; });
    p.y += 8;
    p.txt(40, p.y, "Scores", 13, true); p.y += 6; p.linha(40, p.y, 555, p.y); p.y += 14;
    var linhas = [["overall", "Overall"]].concat(CATS), max = 1;
    S.forEach(function (s) { linhas.forEach(function (c) { max = Math.max(max, s.scores[c[0]] || 0); }); });
    linhas.forEach(function (c) {
      p.espaco(12 * S.length + 8);
      p.txt(40, p.y + 7, c[1], 10, c[0] === "overall");
      S.forEach(function (s, k) {
        var v = s.scores[c[0]], w = Math.max(1, (v || 0) / max * 300);
        p.rect(170, p.y, w, 9, CORES[k]); p.txt(175 + w, p.y + 8, v == null ? "-" : String(v), 9, false, "#333333");
        if (comp && k > 0 && v && S[0].scores[c[0]]) { var dlt = Math.round((v / S[0].scores[c[0]] - 1) * 100); p.txt(520, p.y + 8, (dlt > 0 ? "+" : "") + dlt + "%", 9, true, dlt >= 0 ? "#16a34a" : "#dc2626"); }
        p.y += 12;
      });
      p.y += 6;
    });
    p.txt(40, p.y + 4, "1000 = reference device. Higher is better. Overall = geometric mean of CPU single, CPU multi, memory and graphics.", 8, false, "#666666"); p.y += 24;
    // device info
    p.espaco(60); p.txt(40, p.y, "Device and browser", 13, true); p.y += 6; p.linha(40, p.y, 555, p.y); p.y += 14;
    var chaves = ["browser", "browserVersion", "engine", "os", "osVersion", "device", "model", "chip", "arch", "cpuThreads", "memory", "gpu", "webgpu", "storageQuota", "screen", "connection", "crossOriginIsolated", "userAgent"];
    var colW = (515 - 110) / S.length;
    chaves.forEach(function (k) {
      if (!S.some(function (s) { return s.info && s.info[k] != null; })) return;
      p.espaco(14); p.txt(40, p.y, k, 8, true, "#444444");
      S.forEach(function (s, j) { p.txt(150 + j * colW, p.y, corta(s.info && s.info[k] != null ? s.info[k] : "-", colW - 6, 8), 8, false); });
      p.y += 12;
    });
    // details
    p.novaPagina(); p.txt(40, p.y, "Details", 13, true); p.y += 6; p.linha(40, p.y, 555, p.y); p.y += 14;
    var ids = idsDe(S), cat = "", vx = 260, vw = (comp ? 240 : 120) / S.length;
    ids.forEach(function (id) {
      var d = DEF[id] || { name: id, unit: "", cat: "" };
      if (d.cat !== cat) { cat = d.cat; p.espaco(30); p.y += 6; p.txt(40, p.y, (CATS.find(function (c) { return c[0] === cat; }) || [0, cat])[1], 10, true, "#2563eb"); p.y += 13; }
      p.espaco(14);
      p.txt(40, p.y, corta(d.name + (d.unit ? " (" + d.unit + ")" : ""), 215, 9), 9);
      S.forEach(function (s, j) {
        var m = s.metrics[id]; p.txt(vx + j * vw, p.y, m ? fmt(m.v) : "-", 9, j === 0 && !comp, comp ? CORES[j] : "#111111");
      });
      if (comp) { var a = S[0].metrics[id], b = S[S.length - 1].metrics[id]; if (a && b && a.v && b.v) { var r = Math.round((b.v / a.v - 1) * 100), good = d.lower ? r <= 0 : r >= 0; p.txt(515, p.y, (r > 0 ? "+" : "") + r + "%", 9, true, good ? "#16a34a" : "#dc2626"); } }
      else { var m0 = S[0].metrics[id]; if (m0 && m0.note) p.txt(390, p.y, corta(m0.note, 165, 7), 7, false, "#777777"); var sc = score(id, m0); if (sc) { p.rect(vx + 60, p.y - 7, Math.min(60, sc / 2000 * 60), 7, "#93c5fd"); } }
      p.linha(40, p.y + 4, 555, p.y + 4, "#eeeeee"); p.y += 13;
    });
    if (comp) { p.y += 8; p.espaco(14); p.txt(40, p.y, "Last column: difference of the last platform vs the first (green = better).", 8, false, "#666666"); }
    // embedded data: every set without the long logs
    var dados = { kind: "inkbench-pdf", version: BENCH_VERSION, sets: S.map(function (s) { return { kind: "inkbench", version: s.version, date: s.date, label: s.label, info: s.info, metrics: s.metrics, scores: s.scores }; }) };
    return p.bytes(dados);
  }

  function baixar(bytes, nome, tipo) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: tipo })); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    log("Saved " + nome + " (" + (bytes.length || bytes.size || 0) + " bytes)");
    $("b-estado").textContent = "Saved " + nome;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
  function textoLog() {
    return "InkDOS Hub browser benchmark log\nPage: " + location.href + "\nUser agent: " + navigator.userAgent + "\nSaved: " + new Date().toISOString() + "\n\n" +
      LOG.join("\n") + "\n\n--- RESULT JSON ---\n" + JSON.stringify(R, function (k, v) { return k === "log" ? undefined : v; }, 2) +
      (OUTROS.length ? "\n\n--- LOADED FOR COMPARISON ---\n" + OUTROS.map(function (o) { return o.label; }).join("\n") : "");
  }

  async function carregar(f) {
    log("Loading " + f.name + " (" + f.size + " bytes)");
    try {
      var buf = new Uint8Array(await f.arrayBuffer()), s = "";
      for (var i = 0; i < buf.length; i += 65536) s += String.fromCharCode.apply(null, buf.subarray(i, i + 65536));
      var dados;
      var m = s.match(/%INKBENCH ([A-Za-z0-9+\/=]+)/);
      if (m) dados = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      else if (/^\s*\{/.test(s)) dados = JSON.parse(decodeURIComponent(escape(s)));
      else throw new Error("this file has no benchmark data (use a PDF saved by this page)");
      var lista = dados.sets || [dados];
      lista.forEach(function (x) { if (x && x.metrics) { x.label = x.label || f.name; OUTROS.push(x); log("  loaded set: " + x.label + " · " + x.date); } });
      while (sets().length > 4) OUTROS.shift();
      desenhar(); $("b-estado").textContent = "Loaded " + lista.length + " result(s) from " + f.name;
    } catch (e) { log("Load failed: " + err(e)); $("b-estado").textContent = "Could not read " + f.name + ": " + e.message; }
  }

  // ---------- wiring ----------
  $("b-rodar").addEventListener("click", function () { rodar().catch(function (e) { log("FATAL " + err(e)); $("b-rodar").disabled = false; }); });
  $("b-parar").addEventListener("click", function () { parar = true; $("b-estado").textContent = "Stopping after the current test..."; });
  $("b-label").addEventListener("change", function () { if (R) { R.label = this.value.trim() || autoLabel(R.info); guardar(); desenhar(); } });
  $("b-pdf").addEventListener("click", function () {
    try { if (!R) return; R.label = $("b-label").value.trim() || R.label; baixar(pdfDe([R]), "benchmark-" + slug(R.label) + "-" + R.date.slice(0, 10) + ".pdf", "application/pdf"); }
    catch (e) { log("PDF failed: " + err(e)); $("b-estado").textContent = "PDF failed: " + e.message; }
  });
  $("b-comp").addEventListener("click", function () {
    try { var S = sets(); baixar(pdfDe(S), "benchmark-comparison-" + S.map(function (s) { return slug(s.label).slice(0, 14); }).join("-vs-") + ".pdf", "application/pdf"); }
    catch (e) { log("Comparison PDF failed: " + err(e)); $("b-estado").textContent = "PDF failed: " + e.message; }
  });
  $("b-arquivo").addEventListener("change", async function () { for (var i = 0; i < this.files.length; i++) await carregar(this.files[i]); this.value = ""; });
  $("b-limpar").addEventListener("click", function () { OUTROS.length = 0; desenhar(); });
  $("b-logcopiar").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText(textoLog()); $("b-estado").textContent = "Log copied."; } catch (e) { $("b-estado").textContent = "Copy failed: " + e.message; }
  });
  $("b-logbaixar").addEventListener("click", function () { baixar(new Blob([textoLog()]), "benchmark-log-" + new Date().toISOString().slice(0, 19).replace(/:/g, "") + ".txt", "text/plain"); });
  try {
    var ult = localStorage.getItem("inkbench-last");
    if (ult) { R = JSON.parse(ult); LOG.push.apply(LOG, R.log || []); $("b-label").value = R.label || ""; $("b-estado").textContent = "Last result restored (" + String(R.date).slice(0, 16).replace("T", " ") + ")."; }
  } catch (e) {}
  desenhar();
  log("Benchmark page ready · v" + BENCH_VERSION);
})();
