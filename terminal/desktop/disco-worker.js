// Disks of Terminal › Desktop in the site's private storage (OPFS), read and written in blocks with
// synchronous access in this worker.
// Each disk has a base file (matches the saved session) and a delta file with the blocks written since.
// "merge" copies the delta into the base when the session is saved; opening a disk starts with an empty
// delta, so a restored session always sees the disk exactly as it was when it was saved.
const B = 4096;
const d = {};
let raiz = null;
const dir = async () => raiz || (raiz = await navigator.storage.getDirectory());
const abrir = async (name, criar = true) => (await (await dir()).getFileHandle(name, { create: criar })).createSyncAccessHandle();

function ler(k, at, len) {
  const x = d[k], out = new Uint8Array(len);
  let p = at;
  while (p < at + len) {
    const b = Math.floor(p / B), fim = Math.min((b + 1) * B, at + len), parte = out.subarray(p - at, fim - at);
    (x.mapa[b] ? x.delta : x.base).read(parte, { at: p });
    p = fim;
  }
  return out;
}
function gravar(k, at, buf) {
  const x = d[k];
  let p = at;
  while (p < at + buf.length) {
    const b = Math.floor(p / B), fim = Math.min((b + 1) * B, at + buf.length);
    if (!x.mapa[b]) {
      if (p !== b * B || fim !== (b + 1) * B) { const bloco = new Uint8Array(B); x.base.read(bloco, { at: b * B }); x.delta.write(bloco, { at: b * B }); }
      x.mapa[b] = 1;
    }
    x.delta.write(buf.subarray(p - at, fim - at), { at: p });
    p = fim;
  }
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.op === "open") {
      if (d[m.name]) { d[m.name].base.close(); d[m.name].delta.close(); }
      const base = await abrir(m.name), delta = await abrir(m.name + ".delta");
      if (m.zero) base.truncate(0);
      delta.truncate(0);
      const size = m.size || base.getSize();
      d[m.name] = { base, delta, mapa: new Uint8Array(Math.ceil(size / B)) };
      self.postMessage({ id: m.id, ok: true, size: base.getSize() });
    } else if (m.op === "read") {
      const buf = ler(m.name, m.at, m.len);
      self.postMessage({ id: m.id, ok: true, buf }, [buf.buffer]);
    } else if (m.op === "write") {
      gravar(m.name, m.at, m.buf);
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === "merge") {
      let n = 0;
      const bloco = new Uint8Array(B);
      for (const k in d) {
        const x = d[k];
        for (let b = 0; b < x.mapa.length; b++) if (x.mapa[b]) { x.delta.read(bloco, { at: b * B }); x.base.write(bloco, { at: b * B }); n++; }
        x.mapa.fill(0); x.delta.truncate(0); x.base.flush(); x.delta.flush();
      }
      self.postMessage({ id: m.id, ok: true, blocks: n });
    } else if (m.op === "fill") {
      // downloads the system disk once (gzip) and extends it to the full disk size
      if (d[m.name]) { d[m.name].base.close(); d[m.name].delta.close(); delete d[m.name]; }
      const h = await abrir(m.name);
      h.truncate(0);
      const r = await fetch(m.url);
      if (!r.ok) throw new Error("download failed: HTTP " + r.status);
      let baixados = 0, ultimo = 0, at = 0;
      const contar = new TransformStream({ transform(c, ctl) {
        baixados += c.length;
        if (baixados - ultimo > 1 << 20) { ultimo = baixados; self.postMessage({ progress: baixados }); }
        ctl.enqueue(c);
      } });
      const leitor = r.body.pipeThrough(contar).pipeThrough(new DecompressionStream("gzip")).getReader();
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        h.write(value, { at });
        at += value.length;
      }
      if (m.size > at) h.truncate(m.size);
      h.flush(); h.close();
      self.postMessage({ id: m.id, ok: true, size: at });
    } else if (m.op === "saveState") {
      // the machine's memory, compressed (mostly empty pages)
      const h = await abrir(m.name);
      h.truncate(0);
      let at = 0;
      const leitor = new Blob([m.buf]).stream().pipeThrough(new CompressionStream("gzip")).getReader();
      for (;;) { const { value, done } = await leitor.read(); if (done) break; h.write(value, { at }); at += value.length; }
      h.flush(); h.close();
      self.postMessage({ id: m.id, ok: true, size: at });
    } else if (m.op === "loadState") {
      let h;
      try { h = await abrir(m.name, false); } catch { self.postMessage({ id: m.id, ok: true, buf: null }); return; }
      const z = new Uint8Array(h.getSize()); h.read(z, { at: 0 }); h.close();
      if (!z.length) { self.postMessage({ id: m.id, ok: true, buf: null }); return; }
      const buf = await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      self.postMessage({ id: m.id, ok: true, buf }, [buf]);
    } else if (m.op === "dropState") {
      try { (await dir()).removeEntry(m.name); } catch {}
      self.postMessage({ id: m.id, ok: true });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
