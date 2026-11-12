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

async function runProof({ poolMb, targetMb, testMb }) {
  const swap = await openSwap('inksoc-swap.bin');
  const ram = new Map();
  let mem, swapMs = 0;
  const view = (p) => new Uint8Array(mem.buffer, p, PAGE);
  const env = {
    host_console: (p, n) => post('log', { text: new TextDecoder().decode(new Uint8Array(mem.buffer, p, n).slice()) }),
    host_now_ms: () => performance.now(),
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
  };
  const [wasm, exe] = await Promise.all([
    fetch('inksoc.wasm?v=1').then((r) => r.arrayBuffer()),
    fetch('test.exe?v=1').then((r) => r.arrayBuffer()),
  ]);
  const { instance } = await WebAssembly.instantiate(wasm, { env });
  const x = instance.exports;
  mem = x.memory;
  const p = x.exe_buffer(exe.byteLength);
  new Uint8Array(mem.buffer, p, exe.byteLength).set(new Uint8Array(exe));
  const msg = () => new TextDecoder().decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice());
  if (x.init(poolMb, targetMb) !== 0) { post('done', { ok: false, error: msg() }); return; }
  x.poke32(0x140002000, testMb); // test_mb inside test.exe
  post('log', { text: `[engine] real RAM ${poolMb} MB (fixed), memory target ${targetMb} MB, wasm memory ${(mem.buffer.byteLength >> 20)} MB\n` });
  const t0 = performance.now();
  let st;
  const stats = () => ({
    insns: x.stat(0), faults: x.stat(1), swapIn: x.stat(2), swapOut: x.stat(3),
    resident: x.stat(4), frames: x.stat(5), bridge: x.stat(7), slots: x.stat(8),
    ms: performance.now() - t0, swapMs, opfs: !!swap,
  });
  while ((st = x.run(2000000)) === 0) post('stats', stats());
  post('stats', stats());
  if (swap) { swap.flush(); swap.truncate(0); swap.close(); }
  post('done', { ok: st === 1 && x.stat(6) === 0, error: st === 2 ? msg() : '', exitCode: x.stat(6) });
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
    const u32 = new Uint32Array(m.buffer, fromMb << 20, (toMb - fromMb) << 18);
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

onmessage = (ev) => {
  const d = ev.data;
  const go = { proof: runProof, opfs: opfsLatency, calibrate }[d.type];
  if (go) go(d).catch((e) => post('done', { ok: false, error: String(e && e.message || e) }));
};
