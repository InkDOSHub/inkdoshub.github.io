/* InkSoC extra core: one more engine instance on the same shared memory.
   It runs program threads at the same time as core 0 (worker.js). */
'use strict';
onmessage = (ev) => {
  const { wasm, wineWasm, memory, id, stackTop, tls } = ev.data;
  const dec = new TextDecoder();
  let x, wine, jitErr = 0;
  const env = {
    memory,
    host_console: (p, n) => postMessage({ out: dec.decode(new Uint8Array(memory.buffer, p, n).slice()) }),
    host_now_ms: () => performance.now(),
    host_epoch_ms: () => Date.now(),
    host_swap_write: () => { throw new Error('swap with several cores'); },
    host_swap_read: () => { throw new Error('swap with several cores'); },
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
