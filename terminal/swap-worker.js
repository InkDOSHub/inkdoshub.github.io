// Swap disk for "Limited memory" mode: a file in the site's private storage
// (OPFS), read and written in blocks with synchronous access in this worker.
// Nothing of the disk stays in page RAM. The file is zeroed on every boot.
let h = null;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.op === "open") {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(m.name, { create: true });
      h = await fh.createSyncAccessHandle();
      h.truncate(0); // swap does not need to survive: starts empty
      h.flush();
      self.postMessage({ id: m.id, ok: true });
    } else if (m.op === "read") {
      const buf = new Uint8Array(m.len); // what was never written comes back as zeros
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
