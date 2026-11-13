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

/* One page to or from the swap worker (swapio.js), waiting for it. */
function swapCall(ctl, op, slot, p) {
  while (Atomics.compareExchange(ctl, 4, 0, 1) !== 0) Atomics.wait(ctl, 4, 1, 1);
  ctl[1] = op; ctl[2] = slot; ctl[3] = p;
  Atomics.store(ctl, 0, 1);
  Atomics.notify(ctl, 0);
  while (Atomics.load(ctl, 0) !== 2) Atomics.wait(ctl, 0, 1);
  Atomics.store(ctl, 0, 0);
  Atomics.store(ctl, 4, 0);
  Atomics.notify(ctl, 4);
}

/* Runs a program on the engine. files: [{ name, data }], exe: file name to start. */
async function runEngine({ files, exe, cmd, poolMb, targetMb, poke, jit, shared, cores, strong }) {
  // several cores need a shared memory, which needs an isolated page (hub.inkdos.workers.dev)
  if (cores > 1 && !self.crossOriginIsolated) { post('log', { text: '[engine] several cores need an isolated page (open it on hub.inkdos.workers.dev); using 1 core\n' }); cores = 1; }
  const mt = cores > 1;
  // one core: this worker holds the swap file; several: a swap worker does, for every core
  const swap = mt ? null : await openSwap('inksoc-swap.bin');
  let swapCtl = null, swapW = null, swapOpfs = false;
  const ram = new Map();
  let mem, swapMs = 0, outBytes = 0, tooMuch = false;
  const view = (p) => new Uint8Array(mem.buffer, p, PAGE);
  const env = {
    host_console: (p, n) => {
      // a program stuck printing (e.g. asking a question nobody can answer) would fill the page and crash the tab
      outBytes += n;
      if (outBytes > 1 << 20) { tooMuch = true; return; }
      post('log', { text: new TextDecoder().decode(new Uint8Array(mem.buffer, p, n).slice()) });
    },
    host_now_ms: () => performance.now(),
    host_console_text: (t) => {
      outBytes += t.length;
      if (outBytes > 1 << 20) { tooMuch = true; return; }
      post('log', { text: t });
    },
    host_epoch_ms: () => Date.now(),
    host_swap_write: (slot, p) => {
      const t = performance.now();
      if (swapCtl) swapCall(swapCtl, 1, slot, p);
      else if (swap) swap.write(shared ? view(p).slice() : view(p), { at: slot * PAGE }); else ram.set(slot, view(p).slice());
      swapMs += performance.now() - t;
    },
    host_swap_read: (slot, p) => {
      const t = performance.now();
      if (swapCtl) swapCall(swapCtl, 2, slot, p);
      else if (swap) { if (shared) { const b = new Uint8Array(PAGE); swap.read(b, { at: slot * PAGE }); view(p).set(b); } else swap.read(view(p), { at: slot * PAGE }); } else view(p).set(ram.get(slot));
      swapMs += performance.now() - t;
    },
    // msvcrt calls into Wine's code (wine.wasm), instantiated below
    wine_call: (id, a, b, c, d) => wine.ink_call(id, a, b, c, d),
    // JIT: compiles one translated block and adds it to the engine's function table
    host_jit: (p, n) => {
      try {
        const m = new WebAssembly.Module(new Uint8Array(mem.buffer, p, n).slice());
        const i = new WebAssembly.Instance(m, { env: { memory: mem, rd: x.jit_rd, wr: x.jit_wr, step: x.jit_step, cond: x.jit_cond } });
        const t = x.__indirect_function_table, k = t.grow(1);
        t.set(k, i.exports.f);
        return k;
      } catch (e) {
        if (!jitErr++) post('log', { text: '[jit] block not compiled (' + e.message + '), the interpreter runs it\n' });
        return -1;
      }
    },
  };
  let jitErr = 0;
  let wine;
  let [wasm, wineWasm] = await Promise.all([mt ? 'inksoc-mt.wasm?v=22' : 'inksoc.wasm?v=35', 'wine.wasm?v=2'].map((u) => fetch(u).then((r) => r.arrayBuffer())));
  // test: the same engine on a shared memory (what several cores need), to compare speed
  if (mt) {
    importScripts('sharedmem.js?v=1');
    wineWasm = inkShared.importer(wineWasm);
    shared = true;
    env.memory = new WebAssembly.Memory({ initial: 80, maximum: (poolMb + 256) * 16, shared: true });
  } else if (shared) {
    if (!self.crossOriginIsolated) post('log', { text: '[engine] shared memory needs an isolated page (open it on hub.inkdos.workers.dev); using normal memory\n' });
    else {
      importScripts('sharedmem.js?v=1');
      wasm = inkShared.engine(wasm, (poolMb + 192) * 16);
      wineWasm = inkShared.importer(wineWasm);
    }
  }
  shared = mt || (shared && self.crossOriginIsolated);
  const { instance } = await WebAssembly.instantiate(wasm, { env });
  const x = instance.exports;
  mem = mt ? env.memory : x.memory;
  if (mt) x.__wasm_init_tls(x.core_alloc(x.__tls_size.value + x.__tls_align.value));
  const put = (bytes) => { const p = x.buffer(bytes.length); new Uint8Array(mem.buffer, p, bytes.length).set(bytes); };
  const enc = (t) => new TextEncoder().encode(t);
  const msg = () => new TextDecoder().decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice());
  x.init(poolMb, targetMb);
  if (shared && !mt) x.set_shared_mem(1);
  if (jit === false) x.set_jit(0);
  if (mt) x.set_cores(cores);
  // ?strong=0: plain loads/stores between cores (faster, without x86 store order) to measure its cost
  if (mt && strong === false && x.set_strong_order) { x.set_strong_order(0); post('log', { text: '[engine] strict x86 memory order OFF (strong=0)\n' }); }
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
  // extra cores: each gets a stack and TLS block here, and is ready before the program starts
  const coreWorkers = [];
  if (mt) {
    const sab = new SharedArrayBuffer(32);
    swapW = new Worker('swapio.js?v=1');
    await new Promise((res) => { swapW.onmessage = (ev) => { swapOpfs = ev.data.opfs; res(); }; swapW.postMessage({ memory: mem, ctl: sab, name: 'inksoc-swap.bin' }); });
    swapCtl = new Int32Array(sab);
    if (!swapOpfs) post('log', { text: '[swap] OPFS sync access unavailable, using RAM instead\n' });
    const ready = [];
    for (let id = 1; id < cores; id++) {
      const stack = 1 << 20, base = x.core_alloc(stack), tls = x.core_alloc(x.__tls_size.value + x.__tls_align.value);
      const w = new Worker('core.js?v=2');
      ready.push(new Promise((res, rej) => {
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.ready) res();
          else if (m.failed) rej(new Error('core ' + id + ': ' + m.failed));
          else if (m.out) env.host_console_text(m.out);
        };
        w.onerror = (e) => rej(new Error('core ' + id + ': ' + (e.message || 'worker failed')));
      }));
      w.postMessage({ wasm, wineWasm, memory: mem, id, stackTop: base + stack - 16, tls, swapCtl: swapCtl.buffer });
      coreWorkers.push(w);
    }
    await Promise.all(ready);
  }
  put(enc(exe + '\0' + (cmd || exe)));
  post('log', { text: `[engine] real RAM ${poolMb} MB (fixed), memory target ${targetMb} MB, wasm memory ${(mem.buffer.byteLength >> 20)} MB${mt ? `, ${cores} cores` : ''}\n` });
  if (x.start() !== 0) { coreWorkers.forEach((w) => w.terminate()); post('done', { ok: false, error: msg() }); return; }
  for (const w of coreWorkers) w.postMessage('go');
  if (poke) x.poke32(poke[0], poke[1]);
  const t0 = performance.now();
  let st;
  const stats = () => ({
    insns: x.stat(0), faults: x.stat(1), swapIn: x.stat(2), swapOut: x.stat(3),
    resident: x.stat(4), frames: x.stat(5), bridge: x.stat(7), slots: x.stat(8),
    modules: x.stat(9), thunks: x.stat(10),
    shared: !!shared, cores: cores || 1, jit: jit !== false, jitBlocks: x.stat(13), jitMs: x.stat(14), jitKb: x.stat(15) / 1024, jitFailed: x.stat(16), threads: x.stat(18), switches: x.stat(19), locks: x.stat(20), lockWaits: x.stat(21), idles: x.stat(22), lockedIns: x.stat(23),
    ms: performance.now() - t0, swapMs, opfs: !!swap || swapOpfs,
  });
  // 3 = every program thread is waiting (Sleep, a timeout): wait that long without spinning
  winX = x;
  let lastFrame = 0;
  // windows: send the screen when it changed (at most ~30 times a second)
  const frame = () => {
    const t = performance.now();
    if (t - lastFrame < 33) return;
    lastFrame = t;
    const p = x.win_frame();
    if (!p) return;
    const b = new Uint8ClampedArray(new Uint8Array(mem.buffer, p, 1024 * 768 * 4));
    postMessage({ type: 'frame', w: 1024, h: 768, data: b.buffer }, [b.buffer]);
  };
  while (!tooMuch) {
    st = x.run(2000000);
    frame();
    if (st === 3) { await new Promise((r) => setTimeout(r, Math.min(30, Math.max(0, x.stat(17))))); continue; }
    if (st !== 0) break;
    post('stats', stats());
    // a program with windows: let mouse and keyboard messages in
    if (!mt && x.win_count()) await yieldNow();
    // let the other cores' output in (a message channel does not wait 4 ms like setTimeout)
    if (mt) await yieldNow();
  }
  // the other cores' last output may still be on its way: let it arrive before stopping them
  if (coreWorkers.length) await new Promise((r) => setTimeout(r, 300));
  coreWorkers.forEach((w) => w.terminate());
  post('stats', stats());
  if (swap) { swap.flush(); swap.truncate(0); swap.close(); }
  if (swapW) {
    Atomics.store(swapCtl, 0, 3); Atomics.notify(swapCtl, 0);
    await new Promise((r) => { swapW.onmessage = r; setTimeout(r, 1000); });
    swapW.terminate();
  }
  // files the program created or changed, offered for download
  const out = [];
  for (let i = 0, n; (n = x.out_file(i)); i++) {
    const b = new Uint8Array(mem.buffer, x.out_ptr(), n).slice();
    const nl = b.indexOf(0);
    out.push({ name: new TextDecoder().decode(b.subarray(0, nl)), data: b.subarray(nl + 1) });
  }
  const error = tooMuch ? 'the program printed more than 1 MB (stuck in a loop? if it asks a question, answer it with a switch such as -y)' : st === 2 ? msg() : '';
  post('done', { ok: !tooMuch && st === 1 && x.stat(6) === 0, error, exitCode: x.stat(6), out });
}

const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

/* Linux terminal: busybox (or another static x86-64 program) on the engine.
   The worker keeps the terminal's line discipline: in line mode it echoes and
   edits the line, in raw mode (the shell's own line editor) keys go straight in. */
let lxs = null;
async function runLinux({ files, cmd, poolMb, jit, rows, cols }) {
  const dec = new TextDecoder();
  let mem, x;
  const out = (t) => post('out', { text: t });
  const env = {
    host_console: (p, n) => out(dec.decode(new Uint8Array(mem.buffer, p, n).slice(), { stream: true })),
    host_now_ms: () => performance.now(),
    host_epoch_ms: () => Date.now(),
    host_swap_write: () => { throw new Error('swap'); },
    host_swap_read: () => { throw new Error('swap'); },
    wine_call: () => 0,
    host_jit: (p, n) => {
      try {
        const m = new WebAssembly.Module(new Uint8Array(mem.buffer, p, n).slice());
        const i = new WebAssembly.Instance(m, { env: { memory: mem, rd: x.jit_rd, wr: x.jit_wr, step: x.jit_step, cond: x.jit_cond } });
        const t = x.__indirect_function_table, k = t.grow(1);
        t.set(k, i.exports.f);
        return k;
      } catch (e) { return -1; }
    },
  };
  const wasm = await fetch('inksoc.wasm?v=35').then((r) => r.arrayBuffer());
  x = (await WebAssembly.instantiate(wasm, { env })).instance.exports;
  mem = x.memory;
  const enc = new TextEncoder();
  const put = (bytes) => { const p = x.buffer(bytes.length); new Uint8Array(mem.buffer, p, bytes.length).set(bytes); };
  const putFile = (name, data, boot) => {
    const nm = enc.encode(name), d = new Uint8Array(data), b = new Uint8Array(nm.length + 1 + d.length);
    b.set(nm); b.set(d, nm.length + 1); put(b);
    if (boot) x.add_file(); else x.linux_put_file();
  };
  x.init(poolMb, 4096);
  if (jit === false) x.set_jit(0);
  for (const f of files) putFile(f.name, f.data, true);
  put(enc.encode(files[0].name + '\0' + cmd));
  if (x.start() !== 0) { post('done', { ok: false, error: new TextDecoder().decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice()) }); return; }
  x.linux_winsize(rows || 30, cols || 100);
  let line = '';
  const keys = [];
  const send = (t) => { const b = enc.encode(t); put(b); x.linux_stdin(b.length); };
  lxs = {
    key(t) { keys.push(t); },
    resize(r, c) { x.linux_winsize(r, c); },
    put(name, data) { putFile(name, data, false); },
    get(path) {
      put(enc.encode(path));
      const n = x.linux_get_file();
      return n < 0 ? null : new Uint8Array(mem.buffer, x.out_ptr(), n).slice();
    },
  };
  const feed = () => {
    while (keys.length) {
      const s = keys.shift();
      const lf = x.linux_lflag(), canon = lf & 2, echo = lf & 8;
      if (!canon) { send(s); continue; }
      for (const ch of s) {
        if (ch === '\x03') { x.linux_interrupt(); line = ''; out('^C\r\n'); }
        else if (ch === '\r' || ch === '\n') { if (echo) out('\r\n'); send(line + '\n'); line = ''; }
        else if (ch === '\x7f' || ch === '\b') { if (line) { line = [...line].slice(0, -1).join(''); if (echo) out('\b \b'); } }
        else if (ch === '\x04') { if (line) { send(line); line = ''; } else x.linux_eof(); }
        else if (ch === '\x15') { if (echo) out('\b \b'.repeat([...line].length)); line = ''; }
        else if (ch >= ' ' || ch === '\t') { line += ch; if (echo) out(ch); }
      }
    }
  };
  let st, last = 0;
  while (true) {
    feed();
    st = x.run(2000000);
    if (st === 1 || st === 2) break;
    if (st === 3) await new Promise((r) => setTimeout(r, Math.min(30, Math.max(0, x.stat(17)))));
    else await yieldNow();
    const t = performance.now();
    if (t - last > 1000) { last = t; post('stats', { insns: x.stat(0), ms: t, jitBlocks: x.stat(13) }); }
  }
  lxs = null;
  const error = st === 2 ? new TextDecoder().decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice()) : '';
  post('done', { ok: st === 1, error, exitCode: x.stat(6) });
}

async function runProof({ poolMb, targetMb, testMb }) {
  const data = await fetch('test.exe?v=1').then((r) => r.arrayBuffer());
  return runEngine({ files: [{ name: 'test.exe', data }], exe: 'test.exe', poolMb, targetMb, poke: [0x140002000, testMb] });
}

function isPe32(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 0x40 || b[0] !== 0x4D || b[1] !== 0x5A) return false;
  const pe = b[0x3C] | b[0x3D] << 8 | b[0x3E] << 16 | b[0x3F] << 24;
  return b.length > pe + 6 && b[pe] === 0x50 && b[pe + 1] === 0x45 && (b[pe + 4] | b[pe + 5] << 8) === 0x14C;
}

async function runExec(d) {
  let files = d.files;
  if (!files) {
    const names = d.exe === 'stage1.exe' || !d.exe ? ['stage1.exe', 'testdll.dll'] : [d.exe];
    files = await Promise.all(names.map(async (name) => ({ name, data: await fetch(name + '?v=2').then((r) => r.arrayBuffer()) })));
  }
  else {
    // the rest of Windows: Wine 11's DLLs (cached by the browser after the first run)
    post('log', { text: '[engine] loading the Wine DLLs (25 MB the first time)\n' });
    const list = await fetch('bin/wine/list.json?v=4').then((r) => r.json());
    const have = new Set(files.map((f) => f.name.toLowerCase()));
    const wine = await Promise.all(list.filter((n) => !have.has(n)).map(async (name) => ({ name, data: await fetch('bin/wine/' + name + '?v=2').then((r) => r.arrayBuffer()) })));
    files = files.concat(wine);
    // a 32-bit program (PE32, i386) also needs Wine's 32-bit DLLs and the WoW64 layer
    const exe = files.find((f) => f.name.toLowerCase() === (d.exe || '').toLowerCase());
    if (exe && isPe32(exe.data)) {
      post('log', { text: '[engine] 32-bit program: loading the 32-bit Wine DLLs (35 MB the first time)\n' });
      const l32 = await fetch('bin/wine32/list.json?v=1').then((r) => r.json());
      const w32 = await Promise.all(l32.filter((n) => !have.has(n)).map(async (name) => ({ name, data: await fetch((name.startsWith('wine-') ? 'bin/wine/' : 'bin/wine32/') + name + '?v=1').then((r) => r.arrayBuffer()) })));
      files = files.concat(w32);
    }
  }
  return runEngine({ files, exe: d.exe || 'stage1.exe', cmd: d.cmd, poolMb: d.poolMb, targetMb: d.targetMb, jit: d.jit, shared: d.shared, cores: d.cores, strong: d.strong });
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

let winX = null;
onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'win') { if (winX) winX.win_input(d.k, d.x, d.y, d.d); return; }
  if (d.type === 'key') { if (lxs) lxs.key(d.data); return; }
  if (d.type === 'resize') { if (lxs) lxs.resize(d.rows, d.cols); return; }
  if (d.type === 'put') { if (lxs) lxs.put(d.name, d.data); return; }
  if (d.type === 'get') { const b = lxs && lxs.get(d.path); postMessage({ type: 'file', path: d.path, data: b && b.buffer }, b ? [b.buffer] : []); return; }
  const go = { linux: runLinux, proof: runProof, exec: runExec, opfs: opfsLatency, calibrate, hold, 'tex-init': texInit, 'tex-get': texGet, 'tex-done': texDone }[d.type];
  if (go) go(d).catch((e) => post('done', { ok: false, error: String(e && e.message || e) }));
};
