/* Zip: opens and creates archives with 7-Zip (worker.js). Results are kept in the page's disk
   (OPFS folder "zip/") and handed over as download links, which work on iPad, iPhone and computers. */
(function () {
  "use strict";
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) { return s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  var $ = function (id) { return document.getElementById(id); };
  var ARQUIVO = /\.(zip|rar|7z|tar|gz|tgz|bz2|tbz2?|xz|txz|lz|lzma|zst|z|cab|iso|dmg|arj|lzh|lha|wim|cpio|rpm|deb|jar|apk|xpi|epub|ipa|udf|vhdx?|r\d\d|\d\d\d)$/i;
  // Apple files that open in the viewer instead of as an archive
  var SO_VER = /\.(plist|mobileprovision|provisionprofile|entitlements|xcent|strings|stringsdict|car)$/i;
  var atual = null, itens = [], links = [], seq = 0, verUrl = null;

  function tam(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB"; }
  function mostrar(sec) { ["inicio", "arquivo", "criar", "ver"].forEach(function (s) { $(s).hidden = s !== sec; }); }
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
    if (SO_VER.test(arq.name) && !senha) { atual = null; return ver(arq, arq.name, "inicio"); }
    atual = { arq: arq, senha: senha || "", lista: [], dir: "" };
    $("ipa").hidden = true; $("ipa").innerHTML = "";
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
    resumoIpa(arq);
  }

  /* ---------- list: folders (tap to enter) or, while searching, every match ---------- */
  function abrirPasta(d) { atual.dir = d; $("busca").value = ""; desenhar(); $("arquivo").scrollIntoView({ block: "start" }); }
  function trilha() {
    var t2 = $("trilha"); t2.innerHTML = "";
    var partes = atual.dir ? atual.dir.split("/") : [], b = document.createElement("button");
    b.type = "button"; b.className = "ink-btn"; b.textContent = "⌂"; b.title = t("Top");
    b.addEventListener("click", function () { abrirPasta(""); });
    t2.appendChild(b);
    partes.forEach(function (p, i) {
      var s = document.createElement("span"); s.textContent = "›"; t2.appendChild(s);
      var x = document.createElement("button"); x.type = "button"; x.className = "ink-btn"; x.textContent = p; x.setAttribute("data-idioma-nao", "");
      x.addEventListener("click", function () { abrirPasta(partes.slice(0, i + 1).join("/")); });
      t2.appendChild(x);
    });
    t2.hidden = !partes.length;
  }
  function linhaPasta(nome, caminho, arqs) {
    var d = document.createElement("div"), c = document.createElement("input"), s = document.createElement("button"), m = document.createElement("span");
    d.className = "it pasta"; c.type = "checkbox";
    c.checked = arqs.every(function (f) { return f.sel; });
    c.addEventListener("change", function () { arqs.forEach(function (f) { f.sel = c.checked; }); contarSel(); });
    s.type = "button"; s.className = "n abre"; s.setAttribute("data-idioma-nao", ""); s.textContent = "📁 " + nome;
    s.addEventListener("click", function () { abrirPasta(caminho); });
    var total = 0; arqs.forEach(function (f) { total += f.tam; });
    m.className = "t"; m.textContent = t("{n} files", { n: arqs.length }) + " · " + tam(total);
    d.appendChild(c); d.appendChild(s); d.appendChild(m);
    return d;
  }

  function desenhar() {
    var q = $("busca").value.trim().toLowerCase(), l = $("lista"), n = 0, pre = atual.dir ? atual.dir + "/" : "", pastas = {}, ordem = [];
    l.innerHTML = "";
    trilha();
    $("trilha").hidden = !!q || !atual.dir;
    if (!q) {
      // the folders of this level first
      atual.lista.forEach(function (f) {
        if (f.caminho.indexOf(pre) !== 0) return;
        var resto = f.caminho.slice(pre.length), i2 = resto.indexOf("/");
        if (i2 < 0) return;
        var nome = resto.slice(0, i2);
        if (!pastas[nome]) { pastas[nome] = []; ordem.push(nome); }
        pastas[nome].push(f);
      });
      ordem.sort(function (a, b) { return a.localeCompare(b); }).forEach(function (nome) { l.appendChild(linhaPasta(nome, pre + nome, pastas[nome])); });
    }
    atual.lista.forEach(function (f) {
      if (q && f.caminho.toLowerCase().indexOf(q) < 0) return;
      if (!q && (f.caminho.indexOf(pre) !== 0 || f.caminho.indexOf("/", pre.length) >= 0)) return;
      if (++n > 2000) return;
      var d = document.createElement("label"), c = document.createElement("input"), s = document.createElement("span"), m = document.createElement("span"), i = f.caminho.lastIndexOf("/");
      d.className = "it"; c.type = "checkbox"; c.value = f.caminho; c.checked = !!f.sel;
      c.addEventListener("change", function () { f.sel = c.checked; contarSel(); });
      s.className = "n"; s.setAttribute("data-idioma-nao", "");
      s.textContent = f.caminho.slice(i + 1);
      if (i > 0 && q) { var p = document.createElement("small"); p.textContent = f.caminho.slice(0, i); s.appendChild(p); }
      m.className = "t"; m.textContent = tam(f.tam);
      var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn"; b.textContent = t("Extract");
      b.addEventListener("click", function (e) { e.preventDefault(); extrairEMostrar([f.caminho]); });
      var v = document.createElement("button"); v.type = "button"; v.className = "ink-btn"; v.textContent = t("View");
      v.addEventListener("click", function (e) { e.preventDefault(); verDoArquivo(f); });
      d.appendChild(c); d.appendChild(s); d.appendChild(m); d.appendChild(v); d.appendChild(b);
      l.appendChild(d);
    });
    if (n > 2000) { var p2 = document.createElement("p"); p2.className = "nota it"; p2.textContent = t("{n} more files: use Search to find them.", { n: n - 2000 }); l.appendChild(p2); }
    contarSel();
  }
  function selecionados() { return atual.lista.filter(function (f) { return f.sel; }).map(function (f) { return f.caminho; }); }
  function contarSel() { var n = selecionados().length; $("extrair-sel").hidden = !n; $("extrair-sel").textContent = t("Extract selected ({n})", { n: n }); }

  /* A folder opened from the device (an .app, an unpacked .ipa...): browsed like an archive */
  function abrirPastaLocal(files) {
    limparLinks(); msg("");
    var mapa = {}, lista = [];
    [].forEach.call(files, function (f) {
      var c = f.webkitRelativePath || f.name;
      if (/(^|\/)\.DS_Store$/.test(c)) return;
      mapa[c] = f; lista.push({ caminho: c, tam: f.size });
    });
    var raiz = lista.length ? lista[0].caminho.split("/")[0] : "";
    atual = { arq: null, local: mapa, senha: "", lista: lista, dir: "" };
    $("ipa").hidden = true; $("ipa").innerHTML = "";
    mostrar("arquivo");
    $("arq-nome").textContent = raiz || t("Folder");
    $("senha-linha").hidden = true;
    var total = 0; lista.forEach(function (f) { total += f.tam; });
    $("arq-info").textContent = t("{n} files · {size}", { n: lista.length, size: tam(total) });
    $("busca").value = "";
    if (raiz && lista.every(function (f) { return f.caminho.indexOf(raiz + "/") === 0; })) atual.dir = raiz;
    desenhar();
    if (/\.app$/i.test(raiz)) resumoIpa(null);
  }

  /* Extracts to zip/<dest>/ and returns [{caminho, file}] */
  async function extrair(sel, quieto) {
    if (atual && atual.local) return (sel || Object.keys(atual.local)).filter(function (c) { return atual.local[c]; }).map(function (c) { return { caminho: c, file: atual.local[c] }; });
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
          // a plain name: a "/" in the name made XeOS fail ("file xeos-save-… does not exist")
          var nome = out[k].caminho.split("/").pop(), ext = (nome.match(/\.[A-Za-z0-9]{1,8}$/) || [""])[0];
          var op = { suggestedName: nome };
          if (ext) op.types = [{ description: ext.slice(1).toUpperCase(), accept: { [out[k].file.type || "application/octet-stream"]: [ext] } }];
          var fh = await showSaveFilePicker(op);
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

  /* ---------- viewer: plist, provisioning profile, images (also Apple PNG), Mach-O, text, hex ---------- */
  var IOS = window.InkIOS, IMAGEM = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|ico|svg)$/i, MAX_LER = 64 << 20;
  var verVolta = "inicio";
  function fecharVer() {
    if (verUrl) { URL.revokeObjectURL(verUrl); verUrl = null; }
    $("ver-corpo").innerHTML = ""; $("ver-acoes").innerHTML = "";
    mostrar(verVolta === "arquivo" && atual ? "arquivo" : "inicio");
  }
  async function verDoArquivo(f) {
    var x = await extrair([f.caminho], true);
    if (!x || !x.length) { msg(t("Could not extract {file}.", { file: f.caminho })); return; }
    ver(x[0].file, f.caminho, "arquivo");
  }
  function botao(texto, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn"; b.textContent = texto; b.addEventListener("click", fn); $("ver-acoes").appendChild(b); return b; }
  function salvarComo(blob, nome, texto) { var a = link(blob, nome); a.className = "ink-btn"; a.textContent = texto; $("ver-acoes").appendChild(a); }
  function pre(texto) { var p = document.createElement("pre"); p.className = "cod"; p.setAttribute("data-idioma-nao", ""); p.textContent = texto; return p; }
  function nota(texto) { var p = document.createElement("p"); p.className = "nota"; p.textContent = texto; return p; }
  function tabela(linhas) {
    var tb = document.createElement("table"); tb.className = "info"; tb.setAttribute("data-idioma-nao", "");
    linhas.forEach(function (l) {
      if (l[1] === undefined || l[1] === null || l[1] === "") return;
      var tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td");
      th.textContent = t(l[0]); td.textContent = l[1]; tr.appendChild(th); tr.appendChild(td); tb.appendChild(tr);
    });
    return tb;
  }

  /* plist as a tree: dict and array open and close, each value shows its type */
  function arvore(no) {
    var conta = 0, raiz = document.createElement("div");
    raiz.className = "arvore"; raiz.setAttribute("data-idioma-nao", "");
    (function vai(n, chave, pai, prof) {
      if (++conta > 20000) { if (conta === 20001) pai.appendChild(nota(t("Too many items: use XML to see the rest."))); return; }
      var rotulo = document.createElement("span"), k = document.createElement("b"), tp = document.createElement("i"), v = document.createElement("span");
      k.textContent = chave; tp.textContent = n.t; v.textContent = IOS.resumo(n); v.className = "v";
      rotulo.appendChild(k); rotulo.appendChild(tp); rotulo.appendChild(v);
      if (n.t === "dict" || n.t === "array") {
        var d = document.createElement("details"), s = document.createElement("summary");
        d.open = prof < 2; s.appendChild(rotulo); d.appendChild(s);
        if (n.t === "dict") n.v.forEach(function (kv) { vai(kv[1], kv[0], d, prof + 1); });
        else n.v.forEach(function (x, i) { vai(x, "[" + i + "]", d, prof + 1); });
        pai.appendChild(d);
      } else { var f = document.createElement("div"); f.className = "folha"; f.appendChild(rotulo); pai.appendChild(f); }
    })(no, "Root", raiz, 0);
    return raiz;
  }
  function mostrarPlist(no, nome, binario, antes) {
    var corpo = $("ver-corpo"), modo = "arvore", xmlTexto = null;
    function xmlDe() { return xmlTexto || (xmlTexto = IOS.xml(no)); }
    function desenha() {
      corpo.innerHTML = "";
      if (antes) corpo.appendChild(antes);
      corpo.appendChild(modo === "arvore" ? arvore(no) : pre(xmlDe()));
      alterna.textContent = modo === "arvore" ? "XML" : t("Tree");
    }
    var alterna = botao("XML", function () { modo = modo === "arvore" ? "xml" : "arvore"; desenha(); });
    botao(t("Copy"), function () { navigator.clipboard && navigator.clipboard.writeText(xmlDe()).catch(function () {}); });
    if (binario) salvarComo(new Blob([xmlDe()], { type: "application/xml" }), nome.replace(/(\.[^.\/]+)?$/, ".xml$1"), t("Save as XML"));
    desenha();
  }

  async function ver(file, caminho, volta) {
    verVolta = volta; msg("");
    if (verUrl) { URL.revokeObjectURL(verUrl); verUrl = null; }
    var nome = caminho.split("/").pop(), corpo = $("ver-corpo");
    corpo.innerHTML = ""; $("ver-acoes").innerHTML = "";
    $("ver-nome").textContent = nome;
    $("ver-info").textContent = (caminho !== nome ? caminho.slice(0, caminho.lastIndexOf("/")) + " · " : "") + tam(file.size);
    mostrar("ver");
    salvarComo(file, nome, t("Save"));
    var hash = botao("SHA-256", async function () {
      if (file.size > 1 << 30) { hash.textContent = t("Too large for SHA-256 here (over 1 GB)"); return; }
      hash.disabled = true; hash.textContent = "SHA-256…";
      try {
        var d = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), h = "";
        for (var i = 0; i < d.length; i++) h += (d[i] < 16 ? "0" : "") + d[i].toString(16);
        hash.remove(); var p = pre("SHA-256  " + h); $("ver-corpo").insertBefore(p, $("ver-corpo").firstChild);
      } catch (x) { hash.disabled = false; hash.textContent = "SHA-256: " + ((x && x.message) || x); }
    });
    try {
      var cab = new Uint8Array(await file.slice(0, 8).arrayBuffer()), m = cab.length >= 4 ? new DataView(cab.buffer).getUint32(0) : 0;
      // programs and libraries (Mach-O)
      if (m === 0xCAFEBABE || m === 0xCAFEBABF || m === 0xCFFAEDFE || m === 0xCEFAEDFE) {
        var arqs = await IOS.macho(file);
        if (arqs) {
          arqs.forEach(function (a) {
            corpo.appendChild(tabela([["Architecture", a.arq + " (" + a.bits + "-bit)"], ["Kind", a.tipo], ["Platform", a.plataforma],
              ["Minimum version", a.minOS], ["SDK", a.sdk],
              ["Encrypted (App Store)", a.cripto === null ? "" : a.cripto ? t("yes: it only runs on the device that bought it") : t("no")],
              ["Code signature", a.assinado ? t("present") : t("missing")]]));
            if (a.libs.length) { var d = document.createElement("details"), s = document.createElement("summary"); s.textContent = t("Libraries ({n})", { n: a.libs.length }); d.appendChild(s); d.appendChild(pre(a.libs.join("\n"))); corpo.appendChild(d); }
          });
          corpo.appendChild(nota(t("An iPhone or iPad program. It cannot run in the browser.")));
          return;
        }
      }
      if (file.size > MAX_LER) { corpo.appendChild(nota(t("Large file: showing the first 4 KB."))); corpo.appendChild(pre(IOS.hex(new Uint8Array(await file.slice(0, 4096).arrayBuffer())))); return; }
      var u8 = new Uint8Array(await file.arrayBuffer());
      if (/\.(mobileprovision|provisionprofile)$/i.test(nome)) {
        var pv = IOS.provisionamento(u8), o = IOS.js(pv), ent = o.Entitlements || {};
        var exp = o.ExpirationDate instanceof Date ? o.ExpirationDate : null;
        var resumo = tabela([["Name", o.Name], ["App ID", o.AppIDName + (ent["application-identifier"] ? " · " + ent["application-identifier"] : "")],
          ["Team", (o.TeamName || "") + (o.TeamIdentifier ? " (" + o.TeamIdentifier.join(", ") + ")" : "")],
          ["Expires", exp ? exp.toLocaleString() + (exp < new Date() ? " · " + t("expired") : "") : ""],
          ["Devices", o.ProvisionsAllDevices ? t("all (Enterprise)") : o.ProvisionedDevices ? String(o.ProvisionedDevices.length) : t("none (App Store)")],
          ["Debugging (get-task-allow)", ent["get-task-allow"] === undefined ? "" : ent["get-task-allow"] ? t("yes (development)") : t("no")],
          ["Certificates", o.DeveloperCertificates ? String(o.DeveloperCertificates.length) : ""]]);
        mostrarPlist(pv, nome, true, resumo);
        return;
      }
      var plistXml = !IOS.ehBinario(u8) && /\.(plist|strings|stringsdict|entitlements|xcent)$/i.test(nome) && IOS.pareceTexto(u8) && /<plist[\s>]/.test(IOS.texto(u8.subarray(0, 2048)));
      if (IOS.ehBinario(u8) || plistXml) { mostrarPlist(IOS.plist(u8), nome, IOS.ehBinario(u8)); return; }
      if (IMAGEM.test(nome)) {
        var blob = file, apple = /\.png$/i.test(nome) && IOS.ehCgbi(u8);
        if (apple) blob = await IOS.cgbiParaPng(u8);
        else if (/\.svg$/i.test(nome)) blob = new Blob([u8], { type: "image/svg+xml" });
        var img = document.createElement("img"); img.className = "img"; img.alt = nome;
        verUrl = URL.createObjectURL(blob); img.src = verUrl;
        img.addEventListener("load", function () { $("ver-info").textContent += " · " + img.naturalWidth + "×" + img.naturalHeight; });
        img.addEventListener("error", function () { corpo.appendChild(nota(t("This browser cannot show this image."))); });
        corpo.appendChild(img);
        if (apple) { corpo.appendChild(nota(t("Apple PNG (CgBI), converted to a normal PNG."))); salvarComo(blob, nome, t("Save as normal PNG")); }
        return;
      }
      if (IOS.pareceTexto(u8)) {
        var tx = IOS.texto(u8);
        botao(t("Copy"), function () { navigator.clipboard && navigator.clipboard.writeText(tx).catch(function () {}); });
        corpo.appendChild(pre(tx.length > 2e6 ? tx.slice(0, 2e6) + "\n…" : tx));
        return;
      }
      if (/\.car$/i.test(nome)) {
        // Assets.car: Apple's compiled image catalog. Most images in it are in Apple's own
        // compression; the ones kept as plain PNG or JPEG are shown here.
        var imgs = IOS.imagensSoltas(u8);
        corpo.appendChild(nota(t("Assets.car (Apple's compiled image catalog): {n} plain images found. The others use Apple's own compression.", { n: imgs.length })));
        var gr = document.createElement("div"); gr.className = "galeria";
        imgs.slice(0, 300).forEach(function (b) { var im = document.createElement("img"), u = URL.createObjectURL(b); links.push(u); im.src = u; im.alt = ""; gr.appendChild(im); });
        corpo.appendChild(gr);
      }
      corpo.appendChild(pre(IOS.hex(u8)));
      if (u8.length > 4096) corpo.appendChild(nota(t("Showing the first 4 KB.")));
    } catch (x) {
      corpo.appendChild(nota(t("Could not read this file: {error}", { error: (x && x.message) || String(x) })));
      corpo.appendChild(pre(IOS.hex(new Uint8Array(await file.slice(0, 4096).arrayBuffer()))));
    }
  }

  /* ---------- .ipa: app summary (name, id, version, signature, profile, icon) ---------- */
  async function resumoIpa(arq) {
    var lista = atual.lista, mapa = {};
    lista.forEach(function (f) { mapa[f.caminho] = f; });
    var info = lista.filter(function (f) { return /^(Payload\/)?[^/]+\.app\/Info\.plist$/.test(f.caminho); })[0];
    if (!info) return;
    var app = info.caminho.slice(0, -"Info.plist".length), prov = mapa[app + "embedded.mobileprovision"];
    var x = await extrair(prov ? [info.caminho, prov.caminho] : [info.caminho], true);
    if (!x || !x.length || !atual || atual.arq !== arq) return;
    var o, p = null;
    try {
      for (var k = 0; k < x.length; k++) {
        var u = new Uint8Array(await x[k].file.arrayBuffer());
        if (/Info\.plist$/.test(x[k].caminho)) o = IOS.js(IOS.plist(u)); else p = IOS.js(IOS.provisionamento(u));
      }
    } catch (e) { return; }
    if (!o) return;
    var fam = (o.UIDeviceFamily || []).map(function (n) { return { 1: "iPhone", 2: "iPad", 3: "Apple TV", 4: "Apple Watch", 6: "Mac", 7: "Vision" }[n] || n; }).join(", ");
    var assinado = !!mapa[app + "_CodeSignature/CodeResources"], exp = p && p.ExpirationDate instanceof Date ? p.ExpirationDate : null;
    var caixa = $("ipa"); caixa.innerHTML = "";
    var topo = document.createElement("div"); topo.className = "ipa-topo";
    var ic = document.createElement("div"); ic.className = "icone"; topo.appendChild(ic);
    var h = document.createElement("div"), nm = document.createElement("strong"), id = document.createElement("small");
    nm.textContent = o.CFBundleDisplayName || o.CFBundleName || app.replace(/\/$/, "").split("/").pop(); id.textContent = o.CFBundleIdentifier || "";
    h.setAttribute("data-idioma-nao", ""); h.appendChild(nm); h.appendChild(id); topo.appendChild(h);
    caixa.appendChild(topo);
    caixa.appendChild(tabela([
      ["Version", (o.CFBundleShortVersionString || "") + (o.CFBundleVersion ? " (" + o.CFBundleVersion + ")" : "")],
      ["Minimum version", o.MinimumOSVersion ? "iOS " + o.MinimumOSVersion : ""], ["Devices", fam],
      ["Program", o.CFBundleExecutable],
      ["Signature", assinado ? t("signed") : t("not signed (needs signing to install)")],
      ["Profile", p ? (p.Name || "") + (p.TeamName ? " · " + p.TeamName : "") : ""],
      ["Expires", exp ? exp.toLocaleString() + (exp < new Date() ? " · " + t("expired") : "") : ""]]));
    var acoes = document.createElement("div"); acoes.className = "linha";
    function acao(texto, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "ink-btn"; b.textContent = texto; b.addEventListener("click", fn); acoes.appendChild(b); }
    acao(t("Open the .app folder"), function () { abrirPasta(app.slice(0, -1)); });
    acao("Info.plist", function () { verDoArquivo(info); });
    if (prov) acao("embedded.mobileprovision", function () { verDoArquivo(prov); });
    if (o.CFBundleExecutable && mapa[app + o.CFBundleExecutable]) acao(t("Program (Mach-O)"), function () { verDoArquivo(mapa[app + o.CFBundleExecutable]); });
    caixa.appendChild(acoes);
    caixa.hidden = false;
    // the icon: the largest PNG named in Info.plist (icons only in Assets.car are not shown)
    var nomes = [];
    [o.CFBundleIcons, o["CFBundleIcons~ipad"]].forEach(function (c) { var pi = c && c.CFBundlePrimaryIcon; if (pi && pi.CFBundleIconFiles) nomes = nomes.concat(pi.CFBundleIconFiles); if (pi && pi.CFBundleIconName) nomes.push(pi.CFBundleIconName); });
    if (o.CFBundleIconFiles) nomes = nomes.concat(o.CFBundleIconFiles);
    if (o.CFBundleIconFile) nomes.push(o.CFBundleIconFile);
    var cands = lista.filter(function (f) {
      if (f.caminho.indexOf(app) !== 0 || f.caminho.indexOf("/", app.length) >= 0 || !/\.png$/i.test(f.caminho)) return false;
      var b = f.caminho.slice(app.length);
      return nomes.some(function (n) { return n && b.indexOf(String(n).replace(/\.png$/i, "")) === 0; });
    }).sort(function (a, b) { return b.tam - a.tam; });
    if (!cands.length) return;
    var xi = await extrair([cands[0].caminho], true);
    if (!xi || !xi.length || !atual || atual.arq !== arq) return;
    try {
      var bi = new Uint8Array(await xi[0].file.arrayBuffer()), blob = IOS.ehCgbi(bi) ? await IOS.cgbiParaPng(bi) : xi[0].file;
      var img = document.createElement("img"), url = URL.createObjectURL(blob);
      img.src = url; img.alt = ""; ic.appendChild(img);
    } catch (e) {}
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
  $("btn-ver-pasta").addEventListener("click", function () { $("ver-pasta").value = ""; $("ver-pasta").click(); });
  $("ver-pasta").addEventListener("change", function () { if (this.files.length) abrirPastaLocal(this.files); });
  $("fechar").addEventListener("click", function () { atual = null; limparLinks(); msg(""); $("ipa").hidden = true; mostrar("inicio"); });
  $("ver-fechar").addEventListener("click", fecharVer);
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
    if (f.length === 1 && (ARQUIVO.test(f[0].name) || SO_VER.test(f[0].name))) abrir(f[0]); else juntar(f, false);
  });
  if (!navigator.storage || !navigator.storage.getDirectory) msg(t("This browser has no private disk (OPFS), which Zip needs. Update it to open archives here."));
})();
