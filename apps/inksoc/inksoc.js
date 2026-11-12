/* InkSoC proof page. */
'use strict';
const $ = (id) => document.getElementById(id);
const LS = 'inksoc-limits';
const store = {
  get() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (e) {} },
};
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/* ---------- 1. engine proof ---------- */
$('run').onclick = () => {
  $('run').disabled = true;
  $('out').textContent = '';
  const w = new Worker('worker.js?v=3');
  w.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'log') $('out').textContent += d.text;
    else if (d.type === 'stats') {
      const s = d;
      $('stats').innerHTML = [
        ['Instructions', fmt(s.insns) + ' (' + (s.insns / s.ms / 1000).toFixed(1) + ' MIPS, interpreter)'],
        ['Real RAM in use', fmt(s.resident * 4 / 1024) + ' / ' + fmt(s.frames * 4 / 1024) + ' MB'],
        ['Page faults', fmt(s.faults)],
        ['Swap', fmt(s.swapOut) + ' pages out, ' + fmt(s.swapIn) + ' in, ' + fmt(s.slots * 4 / 1024) + ' MB on ' + (s.opfs ? 'OPFS' : 'RAM (no OPFS)')],
        ['Time in swap I/O', fmt(s.swapMs) + ' ms of ' + fmt(s.ms) + ' ms'],
        ['Bridge calls (wasm "Wine")', fmt(s.bridge)],
      ].map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
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
  const w = new Worker('worker.js?v=3');
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
  const desc = (k, label) => {
    const v = s[k];
    if (!v) return;
    if (v.running) lines.push(`${label}: the tab reloaded after ${v.mb} MB, so the limit is about ${v.mb} MB. Suggested fixed real RAM: ${Math.floor(v.mb * 0.7 / 128) * 128} MB.`);
    else lines.push(`${label}: reached ${v.mb} MB without reloading${v.note ? ' (' + v.note + ')' : ''}.`);
  };
  desc('calib', 'Wasm memory');
  desc('tex', 'GPU textures');
  $('lim-out').textContent = lines.join('\n') || 'No results yet.';
}

$('calib').onclick = () => {
  $('calib').disabled = true;
  const w = new Worker('worker.js?v=3');
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

$('clear').onclick = () => { store.set({}); showLimits(); };

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
