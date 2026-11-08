// AI Chat download worker: streams the model straight into a file in the browser storage (OPFS),
// a piece at a time. Safari turned a ~500 MB Blob built in memory into an empty one.
onmessage = async (e) => {
  const { url, nome } = e.data;
  let h = null;
  try {
    const raiz = await navigator.storage.getDirectory();
    const dir = await raiz.getDirectoryHandle("ia", { create: true });
    const arq = await dir.getFileHandle(nome, { create: true });
    await dir.removeEntry(nome + ".ok").catch(() => {});
    h = await arq.createSyncAccessHandle();
    h.truncate(0);
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const total = +r.headers.get("content-length") || 0, leitor = r.body.getReader();
    let lidos = 0, ultimo = 0;
    for (;;) {
      const p = await leitor.read();
      if (p.done) break;
      h.write(p.value, { at: lidos }); lidos += p.value.length;
      if (Date.now() - ultimo > 300) { ultimo = Date.now(); postMessage({ lidos, total }); }
    }
    h.flush(); h.close(); h = null;
    if (!lidos || (total && lidos !== total)) throw new Error("download incomplete (" + lidos + " of " + total + " bytes)");
    await dir.getFileHandle(nome + ".ok", { create: true }); // marks the file as complete
    postMessage({ fim: true });
  } catch (err) {
    if (h) try { h.close(); } catch (_) {}
    postMessage({ erro: String(err && err.message || err) });
  }
};
