/* Zip: opens and creates archives with 7-Zip (worker.js). Results are kept in the page's disk
   (OPFS folder "zip/") and handed over as download links, which work on iPad, iPhone and computers. */
(function () {
  "use strict";
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) { return s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  var $ = function (id) { return document.getElementById(id); };
  var ARQUIVO = /\.(zip|rar|7z|tar|gz|tgz|bz2|tbz2?|xz|txz|lz|lzma|zst|z|cab|iso|dmg|arj|lzh|lha|wim|cpio|rpm|deb|jar|apk|xpi|epub|ipa|udf|vhdx?|r\d\d|\d\d\d)$/i;
  var atual = null, itens = [], links = [], seq = 0;

  function tam(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB"; }
  function mostrar(sec) { ["inicio", "arquivo", "criar"].forEach(function (s) { $(s).hidden = s !== sec; }); }
  function msg(s) { $("msg").className = "nota erro"; $("msg").textContent = s || ""; }
  function trabalhando(s, p) { $("trab").hidden = !s; $("trab-texto").textContent = s || ""; $("trab-barra").style.width = Math.round((p || 0) * 100) + "%"; }
  function limparLinks() { links.forEach(URL.revokeObjectURL); links = []; $("pronto").hidden = true; $("pronto").innerHTML = ""; }

  async function pastaZip() { return (await navigator.storage.getDirectory()).getDirectoryHandle("zip", { create: true }); }
  // results of a previous visit
  navigator.storage && navigator.storage.getDirectory && navigator.storage.getDirectory().then(function (r) { return r.removeEntry("zip", { recursive: true }); }).catch(function () {});

  function rodar(dados) {
    return new Promise(function (ok) {
      var w = new Worker("worker.js?v=1");
      w.onmessage = function (e) {
        if (e.data.estado) return trabalhando(e.data.estado, e.data.p);
        if (e.data.fim) { w.terminate(); trabalhando(""); ok(e.data); }
      };
      w.onerror = function (e) { w.terminate(); trabalhando(""); ok({ erro: (e && e.message) || t("The 7-Zip engine stopped.") }); };
      w.postMessage(dados);
    });
  }

  /* ---------- open ---------- */
  async function abrir(arq, senha) {
    limparLinks(); msg("");
    atual = { arq: arq, senha: senha || "", lista: [] };
    mostrar("arquivo");
    $("arq-nome").textContent = arq.name;
    $("arq-info").textContent = t("Reading…");
    $("lista").innerHTML = "";
    trabalhando(t("Reading the archive…"), 0);
    var r = await rodar({ op: "list", arq: arq, senha: senha || "" });
    if (atual.arq !== arq) return;
    $("senha-linha").hidden = !(r.senhaErrada || (r.cripto && !senha));
    if (r.erro && !r.lista) r.lista = [];
    if (r.senhaErrada) { $("arq-info").textContent = senha ? t("Wrong password.") : t("This archive is protected with a password."); return; }
    if (!r.lista.length) { $("arq-info").textContent = ""; msg(r.erro || t("No files found.")); return; }
    var arqs = r.lista.filter(function (f) { return !f.pasta; });
    // .tar.gz, .tgz, .tar.xz...: open the .tar inside
    if (arqs.length === 1 && /\.tar$/i.test(arqs[0].caminho) && !/\.tar$/i.test(arq.name)) {
      var x = await extrair([arqs[0].caminho], true);
      if (x && x.length) return abrir(x[0].file);
    }
    atual.lista = arqs;
    var total = 0; arqs.forEach(function (f) { total += f.tam; });
    $("arq-info").textContent = t("{n} files · {size} unpacked · {packed} archive", { n: arqs.length, size: tam(total), packed: tam(arq.size) }) + (r.cripto ? " · " + t("password protected") : "");
    desenhar();
  }

  function desenhar() {
    var q = $("busca").value.trim().toLowerCase(), l = $("lista"), n = 0;
    l.innerHTML = "";
    atual.lista.forEach(function (f) {
      if (q && f.caminho.toLowerCase().indexOf(q) < 0) return;
      if (++n > 2000) return;
      var d = document.createElement("label"), c = document.createElement("input"), s = document.createElement("span"), m = document.createElement("span"), i = f.caminho.lastIndexOf("/");
      d.className = "it"; c.type = "checkbox"; c.value = f.caminho; c.checked = !!f.sel;
      c.addEventListener("change", function () { f.sel = c.checked; contarSel(); });
      s.className = "n"; s.setAttribute("data-idioma-nao", "");
      s.textContent = f.caminho.slice(i + 1);
      if (i > 0) { var p = document.createElement("small"); p.textContent = f.caminho.slice(0, i); s.appendChild(p); }
      m.className = "t"; m.textContent = tam(f.tam);
      var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn"; b.textContent = t("Extract");
      b.addEventListener("click", function (e) { e.preventDefault(); extrairEMostrar([f.caminho]); });
      d.appendChild(c); d.appendChild(s); d.appendChild(m); d.appendChild(b);
      l.appendChild(d);
    });
    if (n > 2000) { var p2 = document.createElement("p"); p2.className = "nota it"; p2.textContent = t("{n} more files: use Search to find them.", { n: n - 2000 }); l.appendChild(p2); }
    contarSel();
  }
  function selecionados() { return atual.lista.filter(function (f) { return f.sel; }).map(function (f) { return f.caminho; }); }
  function contarSel() { var n = selecionados().length; $("extrair-sel").hidden = !n; $("extrair-sel").textContent = t("Extract selected ({n})", { n: n }); }

  /* Extracts to zip/<dest>/ and returns [{caminho, file}] */
  async function extrair(sel, quieto) {
    var dest = "x" + (++seq) + "-" + Date.now().toString(36);
    msg("");
    var r = await rodar({ op: "extract", arq: atual.arq, senha: atual.senha, sel: sel, dest: dest });
    if (r.senhaErrada) { $("senha-linha").hidden = false; msg(t("Type the archive's password and try again.")); return null; }
    if (r.erro) msg(r.erro);
    var base = await (await pastaZip()).getDirectoryHandle(dest), out = [];
    for (var k = 0; k < (r.lista || []).length; k++) {
      var c = r.lista[k].caminho, partes = c.split("/"), d = base;
      try {
        for (var j = 0; j < partes.length - 1; j++) d = await d.getDirectoryHandle(partes[j]);
        out.push({ caminho: c, file: await (await d.getFileHandle(partes[partes.length - 1])).getFile() });
      } catch (x) {}
    }
    if (!out.length && !quieto && !r.erro) msg(t("Nothing was extracted."));
    return out;
  }

  function link(file, nome) {
    var a = document.createElement("a"), u = URL.createObjectURL(file);
    links.push(u);
    a.href = u; a.download = nome || file.name; a.textContent = nome || file.name; a.setAttribute("data-idioma-nao", "");
    return a;
  }
  function pronto(titulo, arquivos) {
    var p = $("pronto"); p.innerHTML = "";
    var h = document.createElement("p"); h.className = "ok"; h.textContent = titulo; p.appendChild(h);
    var l = document.createElement("div"); l.className = "lista";
    arquivos.slice(0, 500).forEach(function (f) {
      var d = document.createElement("div"), m = document.createElement("span"), s = document.createElement("span");
      d.className = "it"; s.className = "n"; s.appendChild(link(f.file, f.caminho.split("/").pop()));
      if (f.caminho.indexOf("/") > 0) { var sm = document.createElement("small"); sm.textContent = f.caminho.slice(0, f.caminho.lastIndexOf("/")); s.appendChild(sm); }
      m.className = "t"; m.textContent = tam(f.file.size);
      d.appendChild(s); d.appendChild(m); l.appendChild(d);
    });
    var pastas = document.createElement("div"); pastas.id = "pastas"; pastas.className = "linha"; pastas.hidden = true; p.appendChild(pastas);
    p.appendChild(l);
    // "Save all to a folder": computers write the folder tree; iPad/iPhone use the share sheet
    // ("Save to Files" asks for the folder), which saves the files without their subfolders
    var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn acao";
    b.textContent = arquivos.length > 1 ? t("Save all to a folder") : t("Save to a folder");
    b.addEventListener("click", function () { salvarEmPasta(arquivos); });
    var lb = document.createElement("div"); lb.className = "linha"; lb.style.margin = "10px 0"; lb.appendChild(b); p.insertBefore(lb, l);
    if (arquivos.length > 1) {
      var n = document.createElement("p"); n.className = "nota";
      n.textContent = t("Tap a name to save only that file.");
      p.appendChild(n);
    }
    p.hidden = false;
    p.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function gravarPasta(destino, out) {
    for (var k = 0; k < out.length; k++) {
      trabalhando(t("Saving {n} of {total}", { n: k + 1, total: out.length }), k / out.length);
      var partes = out[k].caminho.split("/"), d = destino;
      for (var j = 0; j < partes.length - 1; j++) d = await d.getDirectoryHandle(partes[j], { create: true });
      var w = await (await d.getFileHandle(partes[partes.length - 1], { create: true })).createWritable();
      await w.write(out[k].file); await w.close();
    }
    trabalhando("");
  }
  async function salvarEmPasta(out) {
    msg("");
    try {
      if (window.showDirectoryPicker) {
        var destino = await showDirectoryPicker({ mode: "readwrite" });
        await gravarPasta(destino, out);
        msg(""); $("msg").className = "nota ok";
        $("msg").textContent = t("{n} files saved in the folder \"{folder}\".", { n: out.length, folder: destino.name });
        return;
      }
      // XeOS has its own folders and offers them through showSaveFilePicker: one save per file,
      // with the archive path as the suggested name
      if (window.showSaveFilePicker) {
        for (var k = 0; k < out.length; k++) {
          trabalhando(t("Saving {n} of {total}", { n: k + 1, total: out.length }), k / out.length);
          var fh = await showSaveFilePicker({ suggestedName: out.length > 1 ? out[k].caminho : out[k].caminho.split("/").pop() });
          var w = await fh.createWritable(); await w.write(out[k].file); await w.close();
        }
        trabalhando("");
        $("msg").className = "nota ok";
        $("msg").textContent = t("{n} files saved.", { n: out.length });
        return;
      }
      // iPad/iPhone: the share sheet ("Save to Files") saves into the folder the person picks, but
      // cannot make subfolders, so each folder of the archive gets its own button
      if (!(navigator.share && navigator.canShare && navigator.canShare({ files: [out[0].file] }))) {
        msg(t("This browser cannot save to a folder. Tap each name to save it."));
        return;
      }
      var grupos = {};
      out.forEach(function (f) { var i = f.caminho.lastIndexOf("/"), g = i > 0 ? f.caminho.slice(0, i) : ""; (grupos[g] = grupos[g] || []).push(f.file); });
      var nomes = Object.keys(grupos).sort();
      if (nomes.length === 1) return compartilhar(grupos[nomes[0]]);
      var c = $("pastas"); c.innerHTML = "";
      var h = document.createElement("p"); h.className = "nota";
      h.textContent = t("The archive has {n} folders. iPad and iPhone save one folder at a time: tap each one and choose (or create) its folder in Files.", { n: nomes.length });
      c.appendChild(h);
      nomes.forEach(function (g) {
        var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn";
        b.textContent = (g || t("Main folder")) + " · " + t("{n} files", { n: grupos[g].length });
        b.setAttribute("data-idioma-nao", "");
        b.addEventListener("click", function () { compartilhar(grupos[g]).then(function (ok) { if (ok) { b.textContent = "✓ " + b.textContent; } }); });
        c.appendChild(b);
      });
      c.hidden = false;
    } catch (x) {
      trabalhando("");
      if (!x || x.name !== "AbortError") msg((x && x.message) || String(x));
    }
  }

  function compartilhar(files) {
    return navigator.share({ files: files }).then(function () { return true; }, function (x) {
      if (x && x.name !== "AbortError") msg((x && x.message) || String(x));
      return false;
    });
  }

  async function extrairEMostrar(sel) {
    limparLinks();
    // computers: straight into a folder the person chooses
    var destino = null;
    if (window.showDirectoryPicker && (!sel || sel.length > 1)) {
      try { destino = await showDirectoryPicker({ mode: "readwrite" }); } catch (x) { if (x && x.name === "AbortError") return; }
    }
    var out = await extrair(sel);
    if (!out || !out.length) return;
    if (destino) {
      await gravarPasta(destino, out);
      var p = $("pronto"); p.innerHTML = ""; var h = document.createElement("p"); h.className = "ok";
      h.textContent = t("{n} files saved in the folder \"{folder}\".", { n: out.length, folder: destino.name }); p.appendChild(h); p.hidden = false;
      return;
    }
    pronto(out.length === 1 ? t("Ready:") : t("{n} files extracted:", { n: out.length }), out);
  }

  /* ---------- create ---------- */
  function juntar(files, pasta) {
    var vistos = {}; itens.forEach(function (i) { vistos[i.caminho] = 1; });
    [].forEach.call(files, function (f) {
      var c = (pasta && f.webkitRelativePath) || f.name, n = 1, b = c;
      if (/(^|\/)\.DS_Store$/.test(c)) return;
      while (vistos[c]) c = b.replace(/(\.[^./]+)?$/, " (" + (++n) + ")$1");
      vistos[c] = 1; itens.push({ caminho: c, arq: f });
    });
    if (!$("c-nome").value) {
      var top = {}; itens.forEach(function (i) { top[i.caminho.split("/")[0]] = 1; });
      var k = Object.keys(top);
      $("c-nome").value = k.length === 1 ? k[0].replace(/\.[^.]+$/, "") : t("Archive");
    }
    limparLinks(); msg("");
    mostrar("criar");
    var total = 0; itens.forEach(function (i) { total += i.arq.size; });
    $("criar-info").textContent = t("{n} files · {size}", { n: itens.length, size: tam(total) });
    var l = $("c-lista"); l.innerHTML = "";
    itens.slice(0, 500).forEach(function (i, k) {
      var d = document.createElement("div"), s = document.createElement("span"), m = document.createElement("span"), x = document.createElement("button");
      d.className = "it"; s.className = "n"; s.textContent = i.caminho; s.setAttribute("data-idioma-nao", "");
      m.className = "t"; m.textContent = tam(i.arq.size);
      x.type = "button"; x.className = "ink-btn"; x.textContent = "✕"; x.title = t("Remove");
      x.addEventListener("click", function () { itens.splice(k, 1); if (itens.length) juntar([]); else { $("c-nome").value = ""; mostrar("inicio"); } });
      d.appendChild(s); d.appendChild(m); d.appendChild(x); l.appendChild(d);
    });
    senhaVisivel();
  }
  function senhaVisivel() { $("c-senha-campo").hidden = !/^(zip|7z)$/.test($("c-formato").value); }

  async function criar(lista, nome, formato, nivel, senha) {
    msg("");
    var r = await rodar({ op: "create", itens: lista, nome: nome, formato: formato, nivel: nivel, senha: senha });
    if (r.erro) { msg(r.erro); return; }
    var file = await (await (await pastaZip()).getFileHandle(r.nome)).getFile();
    pronto(t("Archive ready ({size}):", { size: tam(file.size) }), [{ caminho: r.nome, file: file }]);
  }

  /* ---------- buttons ---------- */
  $("btn-abrir").addEventListener("click", function () { $("arquivos").value = ""; $("arquivos").click(); });
  $("btn-criar").addEventListener("click", function () { itens = []; $("c-nome").value = ""; $("mais").value = ""; $("mais").click(); });
  $("btn-pasta").addEventListener("click", function () { itens = []; $("c-nome").value = ""; $("pasta").value = ""; $("pasta").click(); });
  $("c-mais").addEventListener("click", function () { $("mais").value = ""; $("mais").click(); });
  $("arquivos").addEventListener("change", function () { var f = this.files && this.files[0]; if (f) abrir(f); });
  $("mais").addEventListener("change", function () { if (this.files.length) juntar(this.files, false); });
  $("pasta").addEventListener("change", function () { if (this.files.length) juntar(this.files, true); });
  $("fechar").addEventListener("click", function () { atual = null; limparLinks(); msg(""); mostrar("inicio"); });
  $("cancelar").addEventListener("click", function () { itens = []; $("c-nome").value = ""; limparLinks(); msg(""); mostrar("inicio"); });
  $("extrair").addEventListener("click", function () { extrairEMostrar(null); });
  $("extrair-sel").addEventListener("click", function () { extrairEMostrar(selecionados()); });
  $("busca").addEventListener("input", desenhar);
  $("usar-senha").addEventListener("click", function () { if (atual) abrir(atual.arq, $("senha").value); });
  $("senha").addEventListener("keydown", function (e) { if (e.key === "Enter") $("usar-senha").click(); });
  $("c-formato").addEventListener("change", senhaVisivel);
  $("c-ir").addEventListener("click", function () {
    if (!itens.length) return;
    var f = $("c-formato").value, nome = ($("c-nome").value.trim() || "archive").replace(/[\/\\:*?"<>|]/g, "_") + "." + f;
    criar(itens, nome, f, $("c-nivel").value, $("c-senha-campo").hidden ? "" : $("c-senha").value);
  });

  // drag and drop (computers): one archive opens, anything else goes to Compress
  document.addEventListener("dragover", function (e) { e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = [].slice.call(e.dataTransfer && e.dataTransfer.files || []);
    if (!f.length) return;
    if (f.length === 1 && ARQUIVO.test(f[0].name)) abrir(f[0]); else juntar(f, false);
  });
  if (!navigator.storage || !navigator.storage.getDirectory) msg(t("This browser has no private disk (OPFS), which Zip needs. Update it to open archives here."));
})();
