// Disks of Emulator › Linux in the site's private storage (OPFS), read and written in blocks
// with synchronous access in this worker. "fill" downloads the system disk once (gzip),
// writing only the parts that are not empty.
const h = {};
self.onmessage = async ({ data: m }) => {
  try {
    if (m.op === "open") {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(m.name, { create: true });
      h[m.name] = await fh.createSyncAccessHandle();
      if (m.zero) h[m.name].truncate(0);
      self.postMessage({ id: m.id, ok: true, size: h[m.name].getSize() });
    } else if (m.op === "read") {
      const buf = new Uint8Array(m.len);
      h[m.name].read(buf, { at: m.at });
      self.postMessage({ id: m.id, ok: true, buf }, [buf.buffer]);
    } else if (m.op === "write") {
      h[m.name].write(m.buf, { at: m.at });
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === "fill") {
      const d = h[m.name];
      d.truncate(0);
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
        let vazio = true;
        for (let i = 0; i < value.length; i++) if (value[i]) { vazio = false; break; }
        if (!vazio) d.write(value, { at });
        at += value.length;
      }
      d.truncate(at);
      d.flush();
      self.postMessage({ id: m.id, ok: true, size: at });
    } else if (m.op === "flush") {
      for (const k in h) h[k].flush();
      self.postMessage({ id: m.id, ok: true });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
