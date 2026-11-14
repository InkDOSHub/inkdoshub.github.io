/* InkSoC proof page. */
'use strict';
const $ = (id) => document.getElementById(id);
const LS = 'inksoc-limits';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (e) {} },
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function statsHtml(s) {
  return [
    ['Instructions', fmt(s.insns) + ' (' + (s.insns / s.ms / 1000).toFixed(1) + ' MIPS, ' + (s.jit ? 'JIT' : 'interpreter') + (s.cores > 1 ? ', ' + s.cores + ' cores' : s.shared ? ', shared memory' : '') + ')'],
    ...(s.jit ? [['JIT', fmt(s.jitBlocks) + ' blocks, ' + fmt(s.jitKb) + ' KB of wasm, ' + fmt(s.jitMs) + ' ms compiling' + (s.jitFailed ? ', ' + s.jitFailed + ' failed' : '')]] : []),
    ['Real RAM in use', fmt(s.resident * 4 / 1024) + ' / ' + fmt(s.frames * 4 / 1024) + ' MB'],
    ['Page faults', fmt(s.faults)],
    ['Swap', fmt(s.swapOut) + ' pages out, ' + fmt(s.swapIn) + ' in, ' + fmt(s.slots * 4 / 1024) + ' MB on ' + (s.opfs ? 'OPFS' : 'RAM (no OPFS)')],
    ['Time in swap I/O', fmt(s.swapMs) + ' ms of ' + fmt(s.ms) + ' ms'],
    ...(s.threads > 1 ? [['Threads', fmt(s.threads) + ' (' + fmt(s.switches) + ' switches)']] : []),
    ...(s.cores > 1 ? [['Engine lock', fmt(s.locks) + ' taken, ' + fmt(s.lockWaits) + ' had to wait, ' + fmt(s.idles) + ' idle waits, ' + fmt(s.lockedIns) + ' locked instructions']] : []),
    ['Modules / native functions', (s.modules || 0) + ' / ' + (s.thunks || 0)],
    ['Bridge calls (wasm "Wine")', fmt(s.bridge)],
  ].map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
}

/* ---------- memory budget: conservative, from the lowest limit seen on this device ---------- */
function budgetMb() {
  const s = store.get();
  const lim = s.minLimit || (s.calib && !s.calib.running && s.calib.mb) || 0;
  if (!lim) return { pool: 256, note: 'no calibration yet: using a safe 256 MB (run "Calibrate memory" below)' };
  const pool = Math.max(128, Math.min(2048, Math.floor(lim * 0.5 / 64) * 64));
  return { pool, note: `lowest tab limit seen on this device ${fmt(lim)} MB → fixed real RAM ${pool} MB (50%)` };
}
function showBudget() { const b = budgetMb(); $('budget').textContent = 'Memory: program sees 8 GB; ' + b.note + '; the rest goes to swap.'; }

/* ---------- windows: the engine's screen on a canvas, mouse and keyboard back ---------- */
let screenWorker = null;
function showFrame(d, w) {
  const c = $('screen');
  if (c.hidden) { c.hidden = false; c.focus(); }
  screenWorker = w;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data), d.w, d.h), 0, 0);
}
(() => {
  const c = $('screen');
  const send = (k, x, y, data) => { if (screenWorker) screenWorker.postMessage({ type: 'win', k, x, y, d: data }); };
  const pos = (e) => { const r = c.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * c.width / r.width), Math.round((e.clientY - r.top) * c.height / r.height)]; };
  c.addEventListener('pointerdown', (e) => { c.focus(); c.setPointerCapture(e.pointerId); const [x, y] = pos(e); send(1, x, y, 0); send(2, x, y, e.button); e.preventDefault(); });
  c.addEventListener('pointerup', (e) => { const [x, y] = pos(e); send(3, x, y, e.button); e.preventDefault(); });
  c.addEventListener('pointermove', (e) => { const [x, y] = pos(e); send(1, x, y, 0); });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  const key = (kind) => (e) => {
    const special = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27 };
    const ch = kind === 4 ? (e.key.length === 1 ? e.key.codePointAt(0) : special[e.key] || 0) : 0;
    send(kind, 0, 0, (e.keyCode & 0xFF) | (ch << 16));
    e.preventDefault();
  };
  c.addEventListener('keydown', key(4));
  c.addEventListener('keyup', key(5));
})();

function runExec(files, exe, args) {
  $('screen').hidden = true;
  $('exec').disabled = $('exec2').disabled = $('exec4').disabled = $('exec7z').disabled = $('execmine').disabled = $('execmine32').disabled = true;
  $('exec-out').textContent = '';
  const b = budgetMb();
  const w = new Worker('worker.js?v=52');
  w.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'log') $('exec-out').textContent += d.text;
    else if (d.type === 'stats') $('exec-stats').innerHTML = statsHtml(d);
    else if (d.type === 'frame') showFrame(d, w);
    else if (d.type === 'done') {
      $('exec-out').innerHTML += d.ok ? '<b class="ok">\nFinished (exit code 0).</b>' : '<b class="bad">\n' + (d.error ? 'Stopped: ' + d.error : 'Exit code ' + d.exitCode) + '</b>';
      for (const f of d.out || []) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([f.data]));
        a.download = f.name;
        a.textContent = `\nDownload ${f.name} (${fmt(f.data.length)} bytes)`;
        $('exec-out').append(a);
      }
      $('exec').disabled = $('exec2').disabled = $('exec4').disabled = $('exec7z').disabled = $('execmine').disabled = $('execmine32').disabled = false;
      w.terminate();
    }
  };
  w.postMessage({ type: 'exec', files, exe, cmd: args ? exe + ' ' + args : exe, poolMb: b.pool, targetMb: 8192, jit: $('jit').checked, cores: +$('cores').value, strong: new URLSearchParams(location.search).get('strong') !== '0', opt: new URLSearchParams(location.search).get('opt') !== '0' }, files ? files.map((f) => f.data) : []);
}
$('exec').onclick = () => runExec(null, 'stage1.exe');
$('exec2').onclick = () => runExec(null, 'stage2.exe');
$('exec4').onclick = () => runExec(null, 'stage4.exe');
$('exec7z').onclick = async () => {
  const data = await fetch('bin/7za.exe?v=1').then((r) => r.arrayBuffer());
  runExec([{ name: '7za.exe', data }], '7za.exe', $('args').value.trim() || 'b -md18 -mmt' + $('cores').value);
};
// Wine's own Minesweeper: the first program with windows
$('execmine').onclick = async () => {
  const data = await fetch('bin/winemine.exe?v=1').then((r) => r.arrayBuffer());
  runExec([{ name: 'winemine.exe', data }], 'winemine.exe', '');
};
// the same game as a 32-bit program (runs through WoW64)
$('execmine32').onclick = async () => {
  const data = await fetch('bin/wine32/winemine32.exe?v=1').then((r) => r.arrayBuffer());
  runExec([{ name: 'winemine32.exe', data }], 'winemine32.exe', '');
};
// Picked files add up: a DLL or data file picked later joins the .exe picked before
// (some browsers hand over only one file per pick). Names like "7z (1).dll" are fixed.
const picked = new Map();
$('pick').onchange = async (ev) => {
  for (const f of ev.target.files) {
    const name = f.name.replace(/ \(\d+\)(?=\.[^.]+$)/, '');
    picked.set(name.toLowerCase(), { name, data: await f.arrayBuffer() });
  }
  ev.target.value = '';
  const all = [...picked.values()];
  const exes = all.filter((f) => /\.exe$/i.test(f.name));
  if (!exes.length) { $('exec-out').textContent = 'Picked: ' + all.map((f) => f.name).join(', ') + '. Now pick the .exe.'; return; }
  const exe = exes[exes.length - 1];
  const files = all.map((f) => ({ name: f.name, data: f.data.slice(0) }));
  runExec(files, exe.name, $('args').value.trim());
};

/* ---------- 1. engine proof ---------- */
$('run').onclick = () => {
  $('run').disabled = true;
  $('out').textContent = '';
  const w = new Worker('worker.js?v=52');
  w.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'log') $('out').textContent += d.text;
    else if (d.type === 'stats') {
      $('stats').innerHTML = statsHtml(d);
    } else if (d.type === 'done') {
      $('out').innerHTML += d.ok ? '<b class="ok">\nProof passed.</b>' : '<b class="bad">\nFailed: ' + (d.error || 'exit code ' + d.exitCode) + '</b>';
      $('run').disabled = false;
      w.terminate();
    }
  };
  w.postMessage({ type: 'proof', poolMb: +$('pool').value, targetMb: +$('target').value, testMb: +$('testmb').value });
};

/* ---------- 2. OPFS latency ---------- */
$('opfs').onclick = () => {
  $('opfs').disabled = true;
  $('opfs-out').textContent = 'Writing a 64 MB test file...';
  const w = new Worker('worker.js?v=52');
  w.onmessage = (ev) => {
    const d = ev.data;
    $('opfs-out').textContent = d.type === 'opfs'
      ? `Read 4 KB: ${d.readUs.toFixed(1)} µs (${fmt(1e6 / d.readUs)} pages/s)\nWrite 4 KB: ${d.writeUs.toFixed(1)} µs (${fmt(1e6 / d.writeUs)} pages/s)`
      : 'Error: ' + d.error;
    $('opfs').disabled = false;
    w.terminate();
  };
  w.postMessage({ type: 'opfs' });
};

/* ---------- 3. draw calls ---------- */
async function drawWebGPU(out) {
  const adapter = await navigator.gpu.requestAdapter();
  const dev = await adapter.requestDevice();
  const cv = new OffscreenCanvas(256, 256);
  const ctx = cv.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: dev, format });
  const mod = dev.createShaderModule({ code: `
    struct U { v: vec4f };
    @group(0) @binding(0) var<uniform> u: U;
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = array(vec2f(0, .1), vec2f(-.1, -.1), vec2f(.1, -.1));
      return vec4f(p[i] + u.v.xy, 0, 1);
    }
    @fragment fn fs() -> @location(0) vec4f { return vec4f(1, .5, 0, 1); }` });
  const bgl = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
  const pipe = dev.createRenderPipeline({ layout: dev.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] } });
  const N = 8000, ubuf = dev.createBuffer({ size: N * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(N * 64);
  for (let i = 0; i < N; i++) { data[i * 64] = Math.random() * 1.8 - .9; data[i * 64 + 1] = Math.random() * 1.8 - .9; }
  dev.queue.writeBuffer(ubuf, 0, data);
  const bg = dev.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf, size: 16 } }] });
  const frame = (n) => {
    const enc = dev.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(pipe);
    for (let i = 0; i < n; i++) { pass.setBindGroup(0, bg, [i * 256]); pass.draw(3); }
    pass.end();
    dev.queue.submit([enc.finish()]);
    return dev.queue.onSubmittedWorkDone();
  };
  out.textContent = 'WebGPU:\n';
  for (const n of [500, 1000, 2000, 4000, 8000]) {
    await frame(n);
    const t = performance.now();
    for (let k = 0; k < 20; k++) await frame(n);
    out.textContent += `${n} draws: ${((performance.now() - t) / 20).toFixed(2)} ms/frame\n`;
  }
  dev.destroy();
}

function drawWebGL(out) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const gl = cv.getContext('webgl2');
  if (!gl) { out.textContent = 'No WebGL2'; return; }
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es
    uniform vec2 o; void main(){ vec2 v[3]=vec2[](vec2(0,.1),vec2(-.1,-.1),vec2(.1,-.1)); gl_Position=vec4(v[gl_VertexID]+o,0,1);}`));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; out vec4 c; void main(){ c=vec4(1,.5,0,1);}`));
  gl.linkProgram(p); gl.useProgram(p);
  const loc = gl.getUniformLocation(p, 'o');
  const px = new Uint8Array(4);
  out.textContent = 'WebGL2:\n';
  for (const n of [500, 1000, 2000, 4000, 8000]) {
    const t = performance.now();
    for (let k = 0; k < 20; k++) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (let i = 0; i < n; i++) { gl.uniform2f(loc, Math.random() * 1.8 - .9, Math.random() * 1.8 - .9); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    out.textContent += `${n} draws: ${((performance.now() - t) / 20).toFixed(2)} ms/frame\n`;
  }
}

$('draw').onclick = async () => {
  $('draw').disabled = true;
  const out = $('draw-out');
  try { if (navigator.gpu) await drawWebGPU(out); else drawWebGL(out); }
  catch (e) { out.textContent += 'WebGPU error: ' + e.message + '\n'; try { drawWebGL(out); } catch (e2) { out.textContent += e2.message; } }
  $('draw').disabled = false;
};

/* ---------- 4. limits ---------- */
function showLimits() {
  const s = store.get(), lines = [];
  if (s.calib && s.calib.mb && (s.calib.running || s.calib.note)) {
    const m = Math.min(s.minLimit || Infinity, s.calib.mb);
    if (m !== s.minLimit) { s.minLimit = m; store.set(s); }
  }
  if (typeof showBudget === 'function') showBudget();
  const desc = (k, label) => {
    const v = s[k];
    if (!v) return;
    if (v.running) lines.push(`${label}: the tab reloaded after ${v.mb} MB, so the limit is about ${v.mb} MB. Suggested fixed real RAM: ${Math.floor(v.mb * 0.7 / 128) * 128} MB.`);
    else lines.push(`${label}: reached ${v.mb} MB without reloading${v.note ? ' (' + v.note + ')' : ''}.`);
  };
  desc('calib', 'Wasm memory');
  desc('tex', 'GPU textures');
  if (s.combo) lines.push(s.combo.running
    ? `Combined budget: the tab reloaded after ${s.combo.sec} s (RAM ${s.combo.ram} MB + GPU ${s.combo.gpu} MB).`
    : `Combined budget: survived ${s.combo.sec} s with RAM ${s.combo.ram} MB + GPU ${s.combo.gpu} MB, ${s.combo.texMb} MB of textures streamed.`);
  $('lim-out').textContent = lines.join('\n') || 'No results yet.';
}

$('calib').onclick = () => {
  $('calib').disabled = true;
  const w = new Worker('worker.js?v=52');
  store.set(Object.assign(store.get(), { calib: { mb: 0, running: true } }));
  w.onmessage = (ev) => {
    const d = ev.data;
    if (d.type !== 'calib') { $('lim-out').textContent = 'Error: ' + d.error; return; }
    const s = store.get();
    s.calib = { mb: d.mb, running: !(d.refused || d.max), note: d.refused ? 'the browser refused to grow further' : d.max ? '4 GB wasm maximum' : '' };
    store.set(s);
    $('lim-out').textContent = 'Wasm memory: ' + d.mb + ' MB...';
    if (d.refused || d.max) { showLimits(); w.terminate(); $('calib').disabled = false; }
    else setTimeout(() => w.postMessage({ type: 'calib-next' }), 50);
  };
  w.postMessage({ type: 'calibrate' });
};

$('tex').onclick = async () => {
  $('tex').disabled = true;
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const gl = cv.getContext('webgl2');
  if (!gl) { $('lim-out').textContent = 'No WebGL2'; return; }
  const size = 2048, data = new Uint8Array(size * size * 4); // 16 MB each
  crypto.getRandomValues(data.subarray(0, 65536)); for (let i = 65536; i < data.length; i += 65536) data.copyWithin(i, 0, 65536);
  const keep = [];
  let mb = 0;
  store.set(Object.assign(store.get(), { tex: { mb: 0, running: true } }));
  while (mb < 6144) {
    for (let k = 0; k < 8; k++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      keep.push(t);
    }
    gl.finish();
    const err = gl.getError();
    if (err || gl.isContextLost()) {
      const s = store.get(); s.tex = { mb, running: false, note: err ? 'WebGL out of memory error' : 'context lost' }; store.set(s);
      break;
    }
    mb += 128;
    const s = store.get(); s.tex = { mb, running: true }; store.set(s);
    $('lim-out').textContent = 'GPU textures: ' + mb + ' MB...';
    await new Promise((r) => setTimeout(r, 50));
  }
  const s = store.get(); if (s.tex.running) { s.tex = { mb, running: false, note: 'test maximum' }; store.set(s); }
  keep.forEach((t) => gl.deleteTexture(t));
  showLimits();
  $('tex').disabled = false;
};

$('clear').onclick = () => { const m = store.get().minLimit; store.set(m ? { minLimit: m } : {}); showLimits(); };

/* ---------- browser features ---------- */
(function features() {
  const simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
  const lines = [
    'Isolated (threads/SharedArrayBuffer): ' + (self.crossOriginIsolated ? 'yes' : 'no'),
    'WebGPU: ' + (navigator.gpu ? 'yes' : 'no'),
    'Wasm SIMD: ' + (simd ? 'yes' : 'no'),
    'OPFS: ' + (navigator.storage && navigator.storage.getDirectory ? 'yes' : 'no'),
    'Reported cores: ' + (navigator.hardwareConcurrency || '?'),
  ];
  $('feat').textContent = lines.join('\n');
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => {
    $('feat').textContent += '\nStorage quota: ' + fmt((e.quota || 0) / 1048576) + ' MB, used ' + fmt((e.usage || 0) / 1048576) + ' MB';
  });
  showLimits();
})();

/* ---------- 5. combined budget: fixed RAM + GPU texture pool with OPFS streaming ---------- */
$('combo').onclick = async () => {
  const out = $('combo-out'), btn = $('combo');
  const s0 = store.get();
  if (!s0.calib || !s0.calib.mb) { out.textContent = 'Run "Calibrate memory" first.'; return; }
  if (!navigator.gpu) { out.textContent = 'This test needs WebGPU.'; return; }
  btn.disabled = true;
  const total = Math.floor(s0.calib.mb * 0.7);
  const ramSel = +$('combo-ram').value, ram = ramSel >= 0 ? ramSel : Math.floor(total * 0.65 / 64) * 64, gpu = +$('combo-gpu').value || Math.floor((total - ram) / 4) * 4;
  const texMb = +$('combo-tex').value, SIZE = 1024, BYTES = SIZE * SIZE * 4, count = texMb / 4, SHOW = 48;
  const mark = (extra) => { const s = store.get(); s.combo = Object.assign({ ram, gpu, texMb, sec: 0, running: true }, s.combo && s.combo.running ? s.combo : {}, extra); store.set(s); };
  store.set(Object.assign(store.get(), { combo: { ram, gpu, texMb, sec: 0, running: true } }));
  const log = (t) => { out.textContent += t + '\n'; };
  out.textContent = `Tab limit ${s0.calib.mb} MB → using ${total} MB: RAM ${ram} MB + GPU pool ${gpu} MB (${gpu / 4} textures of 4 MB)\n`;

  const holder = new Worker('worker.js?v=52');
  if (ram > 0) await new Promise((r) => { holder.onmessage = (e) => { if (e.data.type === 'held') r(); else { log('RAM error: ' + e.data.error); r(); } }; holder.postMessage({ type: 'hold', mb: ram }); });
  log(`RAM: ${ram} MB reserved and filled.`);

  const io = new Worker('worker.js?v=52');
  log(`Writing ${texMb} MB of textures to OPFS...`);
  const initMs = await new Promise((r) => { io.onmessage = (e) => r(e.data.ms || 0); io.postMessage({ type: 'tex-init', count, size: BYTES }); });
  log(`Texture file ready in ${fmt(initMs)} ms.`);

  const adapter = await navigator.gpu.requestAdapter();
  const astc = $('combo-astc').checked && adapter.features.has('texture-compression-astc');
  if (!$('combo-astc').checked) log('ASTC check skipped.');
  const dev = await adapter.requestDevice({ requiredFeatures: astc ? ['texture-compression-astc'] : [] });
  let gpuErr = '';
  dev.onuncapturederror = (e) => { gpuErr = e.error.message; log('GPU error: ' + gpuErr); };
  dev.lost.then((i) => log('GPU device lost: ' + (i.reason || '') + ' ' + (i.message || '')));
  const waitGpu = (what) => (dev.queue.submit([dev.createCommandEncoder().finish()]), Promise.race([dev.queue.onSubmittedWorkDone(), new Promise((r) => setTimeout(() => { log('(GPU did not answer in 10 s after: ' + what + ')'); r(); }, 10000))]));
  if (astc) {
    // ASTC 4x4 = 16 bytes per 4x4 block (1 byte/pixel), 8x8 = 16 bytes per 8x8 block (0.25 byte/pixel)
    for (const [fmtName, blk] of [['astc-4x4-unorm', 4], ['astc-8x8-unorm', 8]]) {
      const t = dev.createTexture({ size: [SIZE, SIZE], format: fmtName, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      dev.queue.writeTexture({ texture: t }, new Uint8Array((SIZE / blk) * (SIZE / blk) * 16), { bytesPerRow: (SIZE / blk) * 16 }, [SIZE, SIZE]);
      await waitGpu(fmtName);
      t.destroy();
    }
    log(`ASTC: yes. Same pool holds ${gpu / 4 * 4} textures in ASTC 4x4 or ${gpu / 4 * 16} in ASTC 8x8 (vs ${gpu / 4} RGBA).`);
  } else if ($('combo-astc').checked) log('ASTC: not offered by this GPU/browser.');

  log('Creating the GPU pool...');
  const step = (t) => { $('combo-live').textContent = 'step: ' + t; };
  // Draw target: the page canvas, or an OffscreenCanvas (as in test 3) copied to the page each frame
  const drawMode = $('combo-draw').value;
  step('canvas context (' + drawMode + ')');
  const cv = $('combo-cv');
  // page: WebGPU on the page canvas | copy: OffscreenCanvas -> bitmaprenderer | 2d: OffscreenCanvas -> drawImage
  // read: render into a texture, copy to a buffer, mapAsync, putImageData (no WebGPU canvas at all) | off: no picture
  const W = cv.width, H = cv.height;
  const read = drawMode === 'read';
  const off = (drawMode === 'page' || read) ? null : new OffscreenCanvas(W, H);
  const ctx = read ? null : (off || cv).getContext('webgpu');
  const show = drawMode === 'copy' ? cv.getContext('bitmaprenderer') : null;
  const c2d = (drawMode === '2d' || read) ? cv.getContext('2d') : null;
  const format = read ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  let rt = null, rbuf = null, rbusy = false, rframes = 0;
  if (read) {
    rt = dev.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    rbuf = dev.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }
  const targetView = () => read ? rt.createView() : ctx.getCurrentTexture().createView();
  const present = (enc) => {
    if (read && !rbusy) enc.copyTextureToBuffer({ texture: rt }, { buffer: rbuf, bytesPerRow: W * 4 }, [W, H]);
  };
  const afterSubmit = () => {
    if (show) show.transferFromImageBitmap(off.transferToImageBitmap());
    else if (drawMode === '2d') c2d.drawImage(off, 0, 0);
    else if (read && !rbusy) {
      rbusy = true;
      rbuf.mapAsync(GPUMapMode.READ).then(() => {
        c2d.putImageData(new ImageData(new Uint8ClampedArray(rbuf.getMappedRange().slice(0)), W, H), 0, 0);
        rbuf.unmap(); rbusy = false; rframes++;
      }, (e) => log('Readback error: ' + e.message));
    }
  };
  step('configure');
  if (ctx) ctx.configure({ device: dev, format });
  step('shader');
  const mod = dev.createShaderModule({ code: `
    @group(0) @binding(0) var t: texture_2d<f32>;
    @group(0) @binding(1) var s: sampler;
    struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };
    @vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> O {
      let q = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
      let uv = q[v]; let c = f32(i % 8u); let r = f32(i / 8u);
      var o: O; o.p = vec4f((c + uv.x) / 4.0 - 1.0, 1.0 - (r + uv.y) / 3.0, 0, 1); o.uv = uv; return o;
    }
    @fragment fn fs(o: O) -> @location(0) vec4f { return textureSample(t, s, o.uv); }` });
  step('pipeline');
  const pipe = dev.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] } });
  step('sampler + placeholder');
  const sampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const bgFor = (tx) => dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tx.createView() }, { binding: 1, resource: sampler }] });
  const ph = dev.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  dev.queue.writeTexture({ texture: ph }, new Uint8Array([40, 40, 40, 255]), { bytesPerRow: 4 }, [1, 1]);
  const phBG = bgFor(ph);
  // The limiter: a fixed pool of GPU textures created once. Nothing else is ever allocated.
  const nSlots = gpu / 4;
  const slots = [];
  for (let i = 0; i < nSlots; i++) {
    if (i % 16 === 0) { $('combo-live').textContent = `GPU pool: ${i}/${nSlots}`; await waitGpu('texture ' + i); }
    const tx = dev.createTexture({ size: [SIZE, SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    slots.push({ tx, bg: bgFor(tx), id: -1, used: -1 });
  }
  await waitGpu('pool');
  log(`GPU pool: ${nSlots} textures (${gpu} MB) created.${gpuErr ? ' Error: ' + gpuErr : ''}`);

  const where = new Map(); // texture id -> slot index
  const pending = new Set();
  let frame = 0, loads = 0, readMs = 0, upMs = 0, placeholders = 0, pos = 0;
  io.onmessage = (e) => {
    const d = e.data; if (d.type !== 'tex') return;
    pending.delete(d.id);
    let best = -1;
    for (let i = 0; i < nSlots; i++) {
      const sl = slots[i];
      if (sl.used >= frame) continue;
      if (best < 0 || sl.used < slots[best].used) best = i;
      if (sl.id < 0) { best = i; break; }
    }
    if (best < 0) return;
    const sl = slots[best];
    if (sl.id >= 0) where.delete(sl.id);
    const t = performance.now();
    dev.queue.writeTexture({ texture: sl.tx }, d.data, { bytesPerRow: SIZE * 4 }, [SIZE, SIZE]);
    upMs += performance.now() - t; readMs += d.ms; loads++;
    sl.id = d.id; sl.used = frame; where.set(d.id, best);
  };

  const t0 = performance.now();
  let last = t0, worst = 0, lastMark = 0;
  await new Promise((done) => {
    const tick = (now) => {
      const dt = now - last; last = now; if (frame > 5) worst = Math.max(worst, dt);
      frame++;
      pos += 0.5; // the "camera" moves through the textures: ~30 new textures per second at 60 fps
      const base = Math.floor(pos);
      const enc = dev.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: targetView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipe);
      for (let i = 0; i < SHOW; i++) {
        const id = (base + i) % count;
        const k = where.get(id);
        if (k !== undefined) { slots[k].used = frame; pass.setBindGroup(0, slots[k].bg); }
        else {
          placeholders++; pass.setBindGroup(0, phBG);
          if (!pending.has(id) && pending.size < 6) { pending.add(id); io.postMessage({ type: 'tex-get', id }); }
        }
        pass.draw(6, 1, 0, i);
      }
      // prefetch the next textures the camera is about to need
      for (let i = SHOW; i < SHOW + 8 && pending.size < 6; i++) {
        const id = (base + i) % count;
        if (!where.has(id) && !pending.has(id)) { pending.add(id); io.postMessage({ type: 'tex-get', id }); }
      }
      pass.end();
      present(enc);
      dev.queue.submit([enc.finish()]);
      afterSubmit();
      const sec = (now - t0) / 1000;
      if (sec - lastMark >= 1) {
        lastMark = sec;
        mark({ sec: Math.floor(sec) });
        $('combo-live').textContent = `${Math.floor(sec)} s · ${(frame / sec).toFixed(0)} fps · ${fmt(loads * 4)} MB streamed`;
      }
      if (sec < 30) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  const secs = (performance.now() - t0) / 1000;
  log(`\nSurvived ${secs.toFixed(0)} s.`);
  if (read) log(`Pictures read back from the GPU: ${rframes} (${(rframes / secs).toFixed(0)} per second)`);
  log(`Frames: ${(frame / secs).toFixed(1)} fps average, worst frame ${worst.toFixed(0)} ms`);
  log(`Streamed ${fmt(loads * 4)} MB (${loads} textures, ${(loads * 4 / secs).toFixed(0)} MB/s) through a ${gpu} MB pool`);
  log(`Per 4 MB texture: OPFS read ${(readMs / Math.max(loads, 1)).toFixed(2)} ms, GPU upload ${(upMs / Math.max(loads, 1)).toFixed(2)} ms`);
  log(`Draws that waited for a texture: ${(placeholders / (frame * SHOW) * 100).toFixed(1)}%${gpuErr ? '\nGPU error: ' + gpuErr : ''}`);
  const s = store.get(); s.combo = { ram, gpu, texMb, sec: Math.round(secs), running: false }; store.set(s);
  io.postMessage({ type: 'tex-done' });
  setTimeout(() => { io.terminate(); holder.terminate(); }, 500);
  slots.forEach((sl) => sl.tx.destroy()); dev.destroy();
  showLimits();
  btn.disabled = false;
};

// default: up to 4 cores where the page is isolated (shared memory), 1 elsewhere
$('cores').value = String(self.crossOriginIsolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4)) : 1);
