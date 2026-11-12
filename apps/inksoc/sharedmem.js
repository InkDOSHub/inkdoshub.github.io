/* InkSoC: turns the engine's own memory (and Wine's import of it) into a shared
   memory, the kind several cores need. Used to measure what shared memory costs
   on each browser before the engine is split across workers. */
'use strict';
(function (g) {
  function leb(b, p) { let v = 0, s = 0, x; do { x = b[p++]; v += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return [v, p]; }
  function enc(v) { const o = []; do { let x = v % 128; v = Math.floor(v / 128); if (v) x |= 0x80; o.push(x); } while (v); return o; }
  function sections(b) {
    const out = []; let p = 8;
    while (p < b.length) { const id = b[p]; const [n, q] = leb(b, p + 1); out.push({ id, data: b.subarray(q, q + n) }); p = q + n; }
    return out;
  }
  function build(b, secs) {
    const parts = [b.subarray(0, 8)];
    for (const s of secs) parts.push(Uint8Array.of(s.id, ...enc(s.data.length)), s.data);
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }
  const limits = (min, max) => [0x03, ...enc(min), ...enc(max)];
  /* engine: its defined memory becomes shared (same start size, may grow to maxPages) */
  function engine(bytes, maxPages) {
    const b = new Uint8Array(bytes), secs = sections(b);
    const s = secs.find((x) => x.id === 5);
    let [cnt, p] = leb(s.data, 0);
    const fl = s.data[p++]; let min, max;
    [min, p] = leb(s.data, p);
    if (fl & 1) [max, p] = leb(s.data, p);
    s.data = Uint8Array.from([...enc(cnt), ...limits(min, Math.max(min, maxPages)), ...s.data.subarray(p)]);
    return build(b, secs);
  }
  /* a module that imports env.memory: the import becomes shared, up to 4 GB */
  function importer(bytes) {
    const b = new Uint8Array(bytes), secs = sections(b);
    const s = secs.find((x) => x.id === 2), d = s.data, out = [];
    let [n, p] = leb(d, 0); out.push(...enc(n));
    for (let i = 0; i < n; i++) {
      const st = p; let len;
      [len, p] = leb(d, p); p += len; [len, p] = leb(d, p); const name = new TextDecoder().decode(d.subarray(p, p + len)); p += len;
      const kind = d[p++];
      if (kind === 2) {
        out.push(...d.subarray(st, p - 1), 2);
        const fl = d[p++]; let min, max; [min, p] = leb(d, p); if (fl & 1) [max, p] = leb(d, p);
        out.push(...limits(min, 65536));
        continue;
      }
      if (kind === 0) [, p] = leb(d, p);
      else if (kind === 3) p += 2;
      else if (kind === 1) { p++; const fl = d[p++]; [, p] = leb(d, p); if (fl & 1) [, p] = leb(d, p); }
      out.push(...d.subarray(st, p));
      void name;
    }
    out.push(...d.subarray(p));
    s.data = Uint8Array.from(out);
    return build(b, secs);
  }
  g.inkShared = { engine, importer };
})(typeof self !== 'undefined' ? self : globalThis);
