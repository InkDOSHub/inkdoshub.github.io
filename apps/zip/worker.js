/* Zip worker: 7-Zip 24.09 compiled to WebAssembly (7z-wasm 1.2.0, LGPL + unRAR license).
   The archive is read in pieces (WORKERFS), and every file 7-Zip writes goes straight to the
   page's disk (OPFS folder "zip/"), so large archives never sit whole in memory.
   Messages:
   - { op: "list", arq, senha }                      -> { fim, lista, cripto, erro }
   - { op: "extract", arq, senha, sel, dest }        -> files in zip/<dest>/, { fim, lista, erro }
   - { op: "create", itens, formato, nivel, senha, nome } -> zip/<nome>, { fim, nome, tam, erro } */
importScripts("7z/7zz.umd.js");
var linhas = [];
function estado(t, p) { postMessage({ estado: t, p: p }); }
async function novo() {
  linhas = [];
  return SevenZip({ locateFile: function (f) { return "7z/" + f; }, print: function (t) { linhas.push(t); }, printErr: function (t) { linhas.push(t); } });
}
function montar(sz, arq) {
  var FS = sz.FS;
  FS.mkdir("/in");
  FS.mount(sz.WORKERFS, { blobs: [{ name: "a" + ((arq.name || "").toLowerCase().match(/\.[a-z0-9]+$/) || [""])[0], data: arq }] }, "/in");
  return "/in/" + FS.readdir("/in").filter(function (n) { return n[0] !== "."; })[0];
}
function erros() {
  return linhas.filter(function (l) { return /ERROR|Wrong password|Can not open|Unsupported|Data Error|CRC Failed/i.test(l); }).slice(0, 3).join(" ");
}
/* Files under /out are read from and written to OPFS handles (alvos: path -> SyncAccessHandle). */
function ligar(sz, alvos, aoEscrever) {
  var FS = sz.FS;
  try { FS.mkdir("/out"); } catch (x) {}
  FS.writeFile("/out/.x", "");
  var ops = FS.lookupPath("/out/.x").node.stream_ops, escreve = ops.write, le = ops.read, escritos = {};
  ops.write = function (stream, buffer, offset, length, position) {
    var h = alvos[stream.path];
    if (!h) return escreve.apply(this, arguments);
    h.write(buffer.subarray(offset, offset + length), { at: position });
    escritos[stream.path] = Math.max(escritos[stream.path] || 0, position + length);
    stream.node.usedBytes = Math.max(stream.node.usedBytes || 0, position + length);
    if (aoEscrever) aoEscrever(length);
    return length;
  };
  ops.read = function (stream, buffer, offset, length, position) {
    var h = alvos[stream.path];
    if (!h) return le.apply(this, arguments);
    var fim = Math.min(length, Math.max(0, (stream.node.usedBytes || 0) - position));
    return fim > 0 ? h.read(buffer.subarray(offset, offset + fim), { at: position }) : 0;
  };
  return escritos;
}
async function raiz() { return (await navigator.storage.getDirectory()).getDirectoryHandle("zip", { create: true }); }
function fechar(alvos) { Object.keys(alvos).forEach(function (p) { try { alvos[p].flush(); alvos[p].close(); } catch (x) {} }); }
function megas(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + " MB"; }

function listar(sz, entrada, senha) {
  linhas = [];
  sz.callMain(["l", "-slt", "-ba", "-bsp0", "-p" + (senha || ""), entrada]);
  var lista = [], atual = null, cripto = /Wrong password|Can not open encrypted/i.test(linhas.join(" "));
  linhas.forEach(function (l) {
    var m = /(\w[\w ]*) = (.*)$/.exec(l.replace(/^.*?(?=Path = )/, "")); if (!m) return;
    if (m[1] === "Path") { atual = { caminho: m[2].replace(/\\/g, "/"), tam: 0, pasta: false }; lista.push(atual); }
    else if (!atual) return;
    else if (m[1] === "Size") atual.tam = +m[2] || 0;
    else if (m[1] === "Packed Size") atual.comp = +m[2] || 0;
    else if (m[1] === "Modified") atual.data = m[2].slice(0, 16);
    else if (m[1] === "Folder") atual.pasta = m[2] === "+";
    else if (m[1] === "Encrypted" && m[2] === "+") { atual.cripto = true; cripto = true; }
    else if (m[1] === "Attributes" && /D/.test(m[2].split(" ")[0])) atual.pasta = true;
  });
  return { lista: lista, cripto: cripto };
}

var ops = {
  list: async function (d) {
    var sz = await novo(), entrada = montar(sz, d.arq), r = listar(sz, entrada, d.senha);
    var erro = r.lista.length ? "" : (erros() || "No files found. The archive may be damaged or of an unknown type.");
    return { lista: r.lista, cripto: r.cripto, erro: erro, senhaErrada: !r.lista.length && /Wrong password|Can not open encrypted/i.test(linhas.join(" ")) };
  },
  extract: async function (d) {
    var sz = await novo(), FS = sz.FS, entrada = montar(sz, d.arq);
    var arquivos = listar(sz, entrada, d.senha).lista.filter(function (f) { return !f.pasta && (!d.sel || d.sel.indexOf(f.caminho) >= 0); });
    var base = await (await raiz()).getDirectoryHandle(d.dest, { create: true }), pastas = { "": base }, alvos = {}, total = 0, feito = 0, ultimo = 0;
    async function pasta(cam) {
      if (pastas[cam]) return pastas[cam];
      var i = cam.lastIndexOf("/"), pai = await pasta(i < 0 ? "" : cam.slice(0, i));
      return (pastas[cam] = await pai.getDirectoryHandle(cam.slice(i + 1), { create: true }));
    }
    for (var k = 0; k < arquivos.length; k++) {
      var c = arquivos[k].caminho, j = c.lastIndexOf("/");
      var dir = await pasta(j < 0 ? "" : c.slice(0, j)), fh = await dir.getFileHandle(c.slice(j + 1), { create: true });
      var h = await fh.createSyncAccessHandle(); h.truncate(0);
      alvos["/out/" + c] = h; total += arquivos[k].tam;
      if (k % 50 === 0) estado("Preparing " + (k + 1) + " of " + arquivos.length + " files", 0);
    }
    var escritos = ligar(sz, alvos, function (n) {
      feito += n; var t = Date.now();
      if (t - ultimo > 300) { ultimo = t; estado("Extracting: " + megas(feito) + " of " + megas(total), total ? feito / total : 0); }
    });
    linhas = [];
    var args = ["x", "-y", "-aoa", "-bsp0", "-p" + (d.senha || ""), "-o/out", entrada];
    if (d.sel) args = args.concat(d.sel);
    sz.callMain(args);
    fechar(alvos);
    var faltam = arquivos.filter(function (f) { return f.tam > 0 && (escritos["/out/" + f.caminho] || 0) < f.tam; });
    var e = erros();
    return { lista: arquivos.map(function (f) { return { caminho: f.caminho, tam: f.tam }; }), total: total,
      senhaErrada: /Wrong password/i.test(linhas.join(" ")),
      erro: faltam.length ? faltam.length + " files came out incomplete. " + e : e };
  },
  create: async function (d) {
    var sz = await novo(), FS = sz.FS, total = 0, feito = 0, ultimo = 0;
    d.itens.forEach(function (i) { total += i.arq.size; });
    FS.mkdir("/in");
    FS.mount(sz.WORKERFS, { blobs: d.itens.map(function (i) { return { name: i.caminho, data: i.arq }; }) }, "/in");
    var topo = FS.readdir("/in").filter(function (n) { return n !== "." && n !== ".."; });
    var pasta = await raiz(), alvos = {}, tar = /^tar\./.test(d.formato), tipo = tar ? d.formato.slice(4) : d.formato;
    var tmp = d.nome.replace(/\.(gz|bz2|xz)$/i, ""), passos = tar ? 2 : 1;
    async function alvo(nome) { var h = await (await pasta.getFileHandle(nome, { create: true })).createSyncAccessHandle(); h.truncate(0); alvos["/out/" + nome] = h; }
    function progresso(n) {
      feito += n; var t = Date.now();
      if (t - ultimo > 300) { ultimo = t; estado("Compressing: " + megas(feito) + " of about " + megas(total * passos), Math.min(1, feito / (total * passos || 1))); }
    }
    await alvo(tar ? tmp : d.nome);
    ligar(sz, alvos, progresso);
    FS.chdir("/in");
    var nivel = "-mx=" + d.nivel, r, tam;
    if (tar) {
      r = sz.callMain(["a", "-ttar", "-bsp0", "/out/" + tmp].concat(topo));
      fechar(alvos); alvos = {};
      if (!r) {
        // second step in a fresh 7-Zip: the .tar (on the disk) is compressed into .gz, .bz2 or .xz
        var arqTar = await (await pasta.getFileHandle(tmp)).getFile();
        sz = await novo(); FS = sz.FS;
        FS.mkdir("/in"); FS.mount(sz.WORKERFS, { blobs: [{ name: tmp, data: arqTar }] }, "/in");
        await alvo(d.nome); ligar(sz, alvos, progresso); FS.chdir("/in");
        r = sz.callMain(["a", "-t" + tipo, nivel, "-bsp0", "/out/" + d.nome, tmp]);
      }
    } else {
      var args = ["a", "-t" + tipo, nivel, "-bsp0"];
      if (d.senha && (tipo === "zip" || tipo === "7z")) args.push("-p" + d.senha, tipo === "zip" ? "-mem=AES256" : "-mhe=on");
      r = sz.callMain(args.concat(["/out/" + d.nome]).concat(topo));
    }
    try { tam = FS.lookupPath("/out/" + d.nome).node.usedBytes || 0; } catch (x) { tam = 0; }
    fechar(alvos);
    if (tar) try { await pasta.removeEntry(tmp); } catch (x) {}
    return { nome: d.nome, tam: tam, erro: r || !tam ? (erros() || linhas.slice(-3).join(" ") || "7-Zip could not create the archive.") : "" };
  }
};
onmessage = async function (e) {
  var r;
  try { r = await ops[e.data.op](e.data); } catch (err) { r = { erro: (err && err.message) || String(err) }; }
  r.fim = true;
  postMessage(r);
};
