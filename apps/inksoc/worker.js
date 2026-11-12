/* InkSoC proof worker: runs the engine (inksoc.wasm) with swap in OPFS,
   and the OPFS / memory measurements. Everything heavy stays off the page. */
'use strict';
const PAGE = 4096;
const post = (type, data) => postMessage(Object.assign({ type }, data));

async function openSwap(name) {
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(name, { create: true });
    const h = await fh.createSyncAccessHandle();
    h.truncate(0);
    return h;
  } catch (e) {
    post('log', { text: '[swap] OPFS sync access unavailable (' + e.message + '), using RAM instead\n' });
    return null;
  }
}

/* Runs a program on the engine. files: [{ name, data }], exe: file name to start. */
async function runEngine({ files, exe, cmd, poolMb, targetMb, poke }) {
  const swap = await openSwap('inksoc-swap.bin');
  const ram = new Map();
  let mem, swapMs = 0;
  const view = (p) => new Uint8Array(mem.buffer, p, PAGE);
  const env = {
    host_console: (p, n) => post('log', { text: new TextDecoder().decode(new Uint8Array(mem.buffer, p, n).slice()) }),
    host_now_ms: () => performance.now(),
    host_epoch_ms: () => Date.now(),
    host_swap_write: (slot, p) => {
      const t = performance.now();
      if (swap) swap.write(view(p), { at: slot * PAGE }); else ram.set(slot, view(p).slice());
      swapMs += performance.now() - t;
    },
    host_swap_read: (slot, p) => {
      const t = performance.now();
      if (swap) swap.read(view(p), { at: slot * PAGE }); else view(p).set(ram.get(slot));
      swapMs += performance.now() - t;
    },
    // msvcrt calls into Wine's code (wine.wasm), instantiated below
    wine_call: (id, a, b, c, d) => wine.ink_call(id, a, b, c, d),
  };
  let wine;
  const [wasm, wineWasm] = await Promise.all(['inksoc.wasm?v=3', 'wine.wasm?v=1'].map((u) => fetch(u).then((r) => r.arrayBuffer())));
  const { instance } = await WebAssembly.instantiate(wasm, { env });
  const x = instance.exports;
  mem = x.memory;
  const put = (bytes) => { const p = x.buffer(bytes.length); new Uint8Array(mem.buffer, p, bytes.length).set(bytes); };
  const enc = (t) => new TextEncoder().encode(t);
  const msg = () => new TextDecoder().decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice());
  x.init(poolMb, targetMb);
  // Wine's msvcrt shares the engine's memory; its pointers go through the engine's page table
  wine = (await WebAssembly.instantiate(wineWasm, { env: {
    memory: mem, load_ptr: x.wine_load_ptr, store_ptr: x.wine_store_ptr, malloc: x.wine_malloc,
    free: x.wine_free, sse2_memmove: x.wine_memmove, __inksoc_teb: x.wine_teb, ink_output: x.wine_output,
  } })).instance.exports;
  for (const f of files) {
    const name = enc(f.name), data = new Uint8Array(f.data), b = new Uint8Array(name.length + 1 + data.length);
    b.set(name); b.set(data, name.length + 1);
    put(b); x.add_file();
  }
  put(enc(exe + '\0' + (cmd || exe)));
  post('log', { text: `[engine] real RAM ${poolMb} MB (fixed), memory target ${targetMb} MB, wasm memory ${(mem.buffer.byteLength >> 20)} MB\n` });
  if (x.start() !== 0) { post('done', { ok: false, error: msg() }); return; }
  if (poke) x.poke32(poke[0], poke[1]);
  const t0 = performance.now();
  let st;
  const stats = () => ({
    insns: x.stat(0), faults: x.stat(1), swapIn: x.stat(2), swapOut: x.stat(3),
    resident: x.stat(4), frames: x.stat(5), bridge: x.stat(7), slots: x.stat(8),
    modules: x.stat(9), thunks: x.stat(10),
    ms: performance.now() - t0, swapMs, opfs: !!swap,
  });
  while ((st = x.run(2000000)) === 0) post('stats', stats());
  post('stats', stats());
  if (swap) { swap.flush(); swap.truncate(0); swap.close(); }
  post('done', { ok: st === 1 && x.stat(6) === 0, error: st === 2 ? msg() : '', exitCode: x.stat(6) });
}

async function runProof({ poolMb, targetMb, testMb }) {
  const data = await fetch('test.exe?v=1').then((r) => r.arrayBuffer());
  return runEngine({ files: [{ name: 'test.exe', data }], exe: 'test.exe', poolMb, targetMb, poke: [0x140002000, testMb] });
}

async function runExec(d) {
  let files = d.files;
  if (!files) {
    const names = d.exe === 'stage2.exe' ? ['stage2.exe'] : ['stage1.exe', 'testdll.dll'];
    files = await Promise.all(names.map(async (name) => ({ name, data: await fetch(name + '?v=2').then((r) => r.arrayBuffer()) })));
  }
  return runEngine({ files, exe: d.exe || 'stage1.exe', cmd: d.cmd, poolMb: d.poolMb, targetMb: d.targetMb });
}

/* Random 4 KB reads/writes on a 64 MB OPFS file: the real cost of one swap page. */
async function opfsLatency() {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle('inksoc-bench.bin', { create: true });
  const h = await fh.createSyncAccessHandle();
  const size = 64 << 20, chunk = new Uint8Array(1 << 20);
  for (let i = 0; i < chunk.length; i += 4096) chunk[i] = i & 255;
  h.truncate(0);
  for (let o = 0; o < size; o += chunk.length) h.write(chunk, { at: o });
  h.flush();
  const buf = new Uint8Array(PAGE), pages = size / PAGE;
  const time = (n, fn) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) * 1000 / n; };
  const rd = time(5000, () => h.read(buf, { at: ((Math.random() * pages) | 0) * PAGE }));
  const wr = time(2000, () => h.write(buf, { at: ((Math.random() * pages) | 0) * PAGE }));
  h.close();
  await root.removeEntry('inksoc-bench.bin');
  post('opfs', { readUs: rd, writeUs: wr });
}

/* Memory calibration: grow a wasm memory in 128 MB steps and touch every page.
   The page records each step before the next one, so if the tab is killed
   the last recorded step is the device limit. */
async function calibrate({ startMb }) {
  const step = 128, pagesPerStep = step * 16; // 64 KB wasm pages
  const m = new WebAssembly.Memory({ initial: 16, maximum: 65536 });
  let mb = 1;
  // Fill with random data: iOS compresses mostly-empty pages, which would hide the real limit.
  let seed = 2463534242;
  const touch = (fromMb, toMb) => {
    const u32 = new Uint32Array(m.buffer, fromMb * 1048576, (toMb - fromMb) * 262144);
    for (let i = 0; i < u32.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; u32[i] = seed; }
  };
  while (mb + step <= 4096) {
    try { m.grow(pagesPerStep); } catch (e) { post('calib', { mb, refused: true }); return; }
    touch(mb, mb + step);
    mb += step;
    post('calib', { mb });
    await new Promise((r) => { self.onmessage = (ev) => { if (ev.data.type === 'calib-next') r(); }; });
  }
  post('calib', { mb, max: true });
}

/* Test 5: hold a fixed block of real RAM (random data, so iOS cannot compress it). */
let held = null;
async function hold({ mb }) {
  held = new WebAssembly.Memory({ initial: mb * 16, maximum: mb * 16 });
  const u32 = new Uint32Array(held.buffer);
  let seed = 88675123;
  for (let i = 0; i < u32.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; u32[i] = seed; }
  post('held', { mb });
}

/* Test 5: texture store in OPFS. The page keeps only a fixed pool of textures
   on the GPU and asks this worker for the others when they are needed. */
let tex = null;
async function texInit({ count, size }) {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle('inksoc-tex.bin', { create: true });
  if (tex) tex.h.close();
  const h = await fh.createSyncAccessHandle();
  h.truncate(0);
  const buf = new Uint8Array(size);
  const t = performance.now();
  for (let id = 0; id < count; id++) {
    const c = [(id * 97) & 255, (id * 57) & 255, (id * 23) & 255, 255];
    for (let i = 0; i < 65536; i += 4) { buf[i] = c[0] ^ (i >> 8); buf[i + 1] = c[1]; buf[i + 2] = c[2] ^ (i >> 10); buf[i + 3] = 255; }
    for (let o = 65536; o < size; o += 65536) buf.copyWithin(o, 0, 65536);
    h.write(buf, { at: id * size });
  }
  h.flush();
  tex = { h, size };
  post('tex-ready', { ms: performance.now() - t });
}
async function texGet({ id }) {
  const b = new Uint8Array(tex.size);
  const t = performance.now();
  tex.h.read(b, { at: id * tex.size });
  postMessage({ type: 'tex', id, ms: performance.now() - t, data: b.buffer }, [b.buffer]);
}
async function texDone() {
  if (tex) { tex.h.truncate(0); tex.h.close(); tex = null; }
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('inksoc-tex.bin'); } catch (e) {}
}

onmessage = (ev) => {
  const d = ev.data;
  const go = { proof: runProof, exec: runExec, opfs: opfsLatency, calibrate, hold, 'tex-init': texInit, 'tex-get': texGet, 'tex-done': texDone }[d.type];
  if (go) go(d).catch((e) => post('done', { ok: false, error: String(e && e.message || e) }));
};
