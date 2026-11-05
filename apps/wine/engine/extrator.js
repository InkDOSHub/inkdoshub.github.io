/* Unpacks a game archive (.zip, .rar, .7z...) with 7-Zip (7z-wasm 1.2.0, 7-Zip 24.09, LGPL + unRAR license)
   straight into the page's disk (OPFS, folder jogos/<name>). The archive is read in pieces (WORKERFS) and
   every file is written to the disk as 7-Zip produces it, so neither the archive nor the files sit in memory. */
importScripts("7z/7zz.umd.js");
onmessage = async function (e) {
  var arq = e.data.arq, nome = e.data.nome, linhas = [], diag = function (t) { postMessage({ estado: t }); };
  try {
    var sz = await SevenZip({ locateFile: function (f) { return "7z/" + f; }, print: function (t) { linhas.push(t); }, printErr: function (t) { linhas.push(t); } });
    var FS = sz.FS;
    FS.mkdir("/in"); FS.mount(sz.WORKERFS, { blobs: [{ name: "a" + (arq.name.match(/\.[^.]+$/) || [""])[0], data: arq }] }, "/in");
    var entrada = "/in/" + FS.readdir("/in").filter(function (n) { return n[0] !== "."; })[0];
    // 1) list the files
    linhas = []; sz.callMain(["l", "-slt", "-ba", "-bsp0", entrada]);
    var lista = [], atual = null;
    linhas.forEach(function (l) {
      var m = /(\w[\w ]*) = (.*)$/.exec(l.replace(/^.*?(?=Path = )/, "")); if (!m) return;
      if (m[1] === "Path") { atual = { caminho: m[2].replace(/\\/g, "/"), tam: 0, pasta: false }; lista.push(atual); }
      else if (atual && m[1] === "Size") atual.tam = +m[2] || 0;
      else if (atual && m[1] === "Folder") atual.pasta = m[2] === "+";
      else if (atual && m[1] === "Attributes" && /D/.test(m[2].split(" ")[0])) atual.pasta = true;
    });
    var arquivos = lista.filter(function (f) { return !f.pasta; });
    if (!arquivos.length) throw new Error("no files found in the archive");
    // a single top folder inside the archive becomes the game folder itself
    var topos = {}; arquivos.forEach(function (f) { topos[f.caminho.split("/")[0]] = 1; });
    var tira = Object.keys(topos).length === 1 && arquivos.every(function (f) { return f.caminho.indexOf("/") > 0; }) ? Object.keys(topos)[0] + "/" : "";
    // 2) open every destination file on the disk
    var raiz = await (await navigator.storage.getDirectory()).getDirectoryHandle("jogos", { create: true });
    var base = await raiz.getDirectoryHandle(nome, { create: true }), pastas = { "": base }, alvos = {}, total = 0;
    async function pasta(cam) {
      if (pastas[cam]) return pastas[cam];
      var i = cam.lastIndexOf("/"), pai = await pasta(i < 0 ? "" : cam.slice(0, i));
      return (pastas[cam] = await pai.getDirectoryHandle(cam.slice(i + 1), { create: true }));
    }
    for (var k = 0; k < arquivos.length; k++) {
      var c = arquivos[k].caminho, rel = c.slice(tira.length), j = rel.lastIndexOf("/");
      var d = await pasta(j < 0 ? "" : rel.slice(0, j)), fh = await d.getFileHandle(rel.slice(j + 1), { create: true });
      var h = await fh.createSyncAccessHandle(); h.truncate(0);
      alvos["/out/" + c] = h; total += arquivos[k].tam;
      if (k % 50 === 0) diag("Preparing " + (k + 1) + "/" + arquivos.length + " files");
    }
    // 3) files 7-Zip writes under /out go straight to the disk
    FS.mkdir("/out"); FS.writeFile("/out/.x", ""); var ops = FS.lookupPath("/out/.x").node.stream_ops, escreve = ops.write, feito = 0, ultimo = 0;
    ops.write = function (stream, buffer, offset, length, position) {
      var h = alvos[stream.path];
      if (!h) return escreve.apply(this, arguments);
      h.write(buffer.subarray(offset, offset + length), { at: position });
      stream.node.usedBytes = Math.max(stream.node.usedBytes || 0, position + length);
      feito += length;
      var t = Date.now(); if (t - ultimo > 500) { ultimo = t; diag("Unpacking " + nome + ": " + Math.round(feito / 1048576) + " of " + Math.round(total / 1048576) + " MB"); }
      return length;
    };
    linhas = []; var r = sz.callMain(["x", "-y", "-aoa", "-bsp0", "-o/out", entrada]);
    Object.keys(alvos).forEach(function (p) { try { alvos[p].flush(); alvos[p].close(); } catch (x) {} });
    var erro = linhas.filter(function (l) { return /ERROR|Wrong password|Can not open/i.test(l); }).slice(0, 3).join(" ");
    postMessage({ fim: true, erro: erro, lista: arquivos.map(function (f) { return { caminho: f.caminho.slice(tira.length), tam: f.tam }; }), total: total });
  } catch (err) { postMessage({ fim: true, erro: (err && err.message) || String(err) }); }
};
