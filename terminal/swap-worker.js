// Disco de swap do modo "Memória limitada": um arquivo no armazenamento privado
// do site (OPFS), lido e gravado por blocos com um acesso síncrono neste worker.
// Nada do disco fica na RAM da página. O arquivo é zerado a cada boot.
let h = null;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.op === "open") {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(m.name, { create: true });
      h = await fh.createSyncAccessHandle();
      h.truncate(0); // swap não precisa sobreviver: começa vazio
      h.flush();
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === "read") {
      const buf = new Uint8Array(m.len); // o que nunca foi gravado volta como zeros
      h.read(buf, { at: m.at });
      self.postMessage({ id: m.id, ok: true, buf }, [buf.buffer]);
    } else if (m.op === "write") {
      h.write(m.buf, { at: m.at });
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === "size") {
      self.postMessage({ id: m.id, ok: true, size: h.getSize() });
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
  }
};
