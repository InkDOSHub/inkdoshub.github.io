// Writes a Blob into the page's private storage (OPFS) in 8 MB chunks, so a big ZIP part
// becomes a real file on disk before it is downloaded. Messages: {nome, blob} -> {p} progress, {ok} or {erro}.
onmessage = async function (ev) {
  var nome = ev.data.nome, blob = ev.data.blob, h;
  try {
    var dir = await navigator.storage.getDirectory();
    h = await (await dir.getFileHandle(nome, { create: true })).createSyncAccessHandle();
    h.truncate(0);
    for (var o = 0, C = 8 << 20; o < blob.size; o += C) {
      var u = new Uint8Array(await blob.slice(o, o + C).arrayBuffer());
      h.write(u, { at: o });
      postMessage({ p: Math.min(1, (o + u.length) / blob.size) });
    }
    h.flush(); h.close();
    postMessage({ ok: 1 });
  } catch (e) { try { h && h.close(); } catch (_) {} postMessage({ erro: String(e && e.message || e) }); }
};
