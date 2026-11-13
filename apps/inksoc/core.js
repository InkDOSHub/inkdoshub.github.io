/* InkSoC extra core: one more engine instance on the same shared memory.
   It runs program threads at the same time as core 0 (worker.js). */
'use strict';
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
/* A piece of a drive C: file from the swap worker (swapio.js), which holds the open files. */
function driveCall(ctl, id, off, p, n) {
  while (Atomics.compareExchange(ctl, 4, 0, 1) !== 0) Atomics.wait(ctl, 4, 1, 1);
  ctl[1] = 3; ctl[2] = id; ctl[3] = p; ctl[5] = n; ctl[6] = off % 4294967296 | 0; ctl[7] = Math.floor(off / 4294967296);
  Atomics.store(ctl, 0, 1);
  Atomics.notify(ctl, 0);
  while (Atomics.load(ctl, 0) !== 2) Atomics.wait(ctl, 0, 1);
  const got = ctl[5];
  Atomics.store(ctl, 0, 0);
  Atomics.store(ctl, 4, 0);
  Atomics.notify(ctl, 4);
  return got;
}
onmessage = (ev) => {
  const { wasm, wineWasm, memory, id, stackTop, tls } = ev.data;
  const swapCtl = new Int32Array(ev.data.swapCtl);
  const shift = ev.data.origin ? performance.timeOrigin - ev.data.origin : 0;
  const dec = new TextDecoder();
  let x, wine, jitErr = 0;
  const env = {
    memory,
    host_console: (p, n) => postMessage({ out: dec.decode(new Uint8Array(memory.buffer, p, n).slice()) }),
    // the same clock as core 0: a time taken on one core and compared on another must agree
    host_now_ms: () => performance.now() + shift,
    host_epoch_ms: () => Date.now(),
    // swap pages go through the swap worker (swapio.js), like core 0's
    host_swap_write: (slot, p) => swapCall(swapCtl, 1, slot, p),
    host_swap_read: (slot, p) => swapCall(swapCtl, 2, slot, p),
    host_drive_read: (id, off, p, n) => driveCall(swapCtl, id, off, p, n),
    wine_call: (i, a, b, c, d) => wine.ink_call(i, a, b, c, d),
    host_jit: (p, n) => {
      try {
        const m = new WebAssembly.Module(new Uint8Array(memory.buffer, p, n).slice());
        const i = new WebAssembly.Instance(m, { env: { memory, rd: x.jit_rd, wr: x.jit_wr, step: x.jit_step, cond: x.jit_cond } });
        const t = x.__indirect_function_table, k = t.grow(1);
        t.set(k, i.exports.f);
        return k;
      } catch (e) {
        if (!jitErr++) postMessage({ out: '[jit] core ' + id + ': block not compiled (' + e.message + ')\n' });
        return -1;
      }
    },
  };
  try {
    x = new WebAssembly.Instance(new WebAssembly.Module(wasm), { env }).exports;
    x.__stack_pointer.value = stackTop;
    x.__wasm_init_tls(tls);
    x.core_init(id);
    wine = new WebAssembly.Instance(new WebAssembly.Module(wineWasm), { env: {
      memory, load_ptr: x.wine_load_ptr, store_ptr: x.wine_store_ptr, malloc: x.wine_malloc,
      free: x.wine_free, sse2_memmove: x.wine_memmove, __inksoc_teb: x.wine_teb, ink_output: x.wine_output,
    } }).exports;
  } catch (e) { postMessage({ failed: String(e && e.message || e) }); return; }
  postMessage({ ready: id });
  onmessage = () => {
    let st;
    // run blocks this worker: when no program thread is ready it sleeps inside (Atomics wait)
    while ((st = x.run(2000000)) === 0);
    postMessage({ done: st });
  };
};
