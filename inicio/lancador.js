/* Lançador de arquivos da tela inicial, como na tela inicial do InkDOS.

   Com o InkDOS Hub instalado (manifest.webmanifest, "file_handlers"), abrir um arquivo no XeOS
   manda o arquivo para esta página (launchQueue). Ela escolhe o app pela extensão e abre o app
   com o arquivo.

   Como o arquivo chega a cada app:
   - apps do InkDOS (inkdos/): IndexedDB "inkdos-launch-handoff" e #inkdos-launch=<id>, o mesmo
     caminho da tela inicial do InkDOS original (runtime/platform/file-launch.js de cada app);
   - Fotos, Vídeo, Música e Wine (.exe, .msi): IndexedDB "inkdoshub-entrada" e #ink-arquivos=<id>; o app recebe pelo
     botão de abrir dele (assets/gerenciador-app.js);
   - Código: o arquivo é gravado na pasta do editor (IndexedDB "inkdoshub-codigo", em /Received)
     e o editor o abre (apps/codigo/ext/inkfs). */
(function () {
  "use strict";
  var P = window.InkPaginas;
  var RAIZ = P.raiz;
  var INKDOS = { documentos: "documents", planilhas: "spreadsheets", apresentacoes: "presentations", pdf: "pdf", texto: "txt", epub: "epub" };
  var ROTAS = [
    { app: "documentos", ext: ["docx", "rtf", "doc", "odt", "pages"] },
    { app: "planilhas", ext: ["xlsx", "xls", "csv", "tsv", "ods", "numbers"] },
    { app: "apresentacoes", ext: ["pptx", "ppt", "odp", "key"] },
    { app: "pdf", ext: ["pdf"] },
    { app: "epub", ext: ["epub"] },
    { app: "texto", ext: ["txt", "md", "markdown", "log", "ini", "cfg", "conf", "toml", "properties", "xml", "json", "jsonl", "ndjson", "yaml", "yml"] },
    { app: "foto", ext: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "svg", "tif", "tiff"], tipo: "image/", varios: true },
    { app: "video", ext: ["mp4", "mov", "m4v", "webm", "mkv"], tipo: "video/", varios: true },
    { app: "musica", ext: ["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"], tipo: "audio/", varios: true },
    { app: "codigo", ext: ["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "html", "htm", "css", "scss", "less", "c", "h", "cpp", "hpp", "cc", "cs", "java",
      "kt", "rs", "go", "rb", "php", "sh", "bash", "zsh", "fish", "lua", "sql", "swift", "r", "pl", "vue", "svelte", "dart", "bat", "ps1", "gradle",
      "dockerfile", "make", "mk", "cmake", "ipynb", "tex", "diff", "patch", "env", "gitignore"], varios: true },
  ];
  window.INK_ROTAS = ROTAS;

  function rotaDe(file) {
    var nome = String(file && file.name || "").toLowerCase(), ponto = nome.lastIndexOf(".");
    var ext = ponto >= 0 ? nome.slice(ponto + 1) : nome; // "Dockerfile", "Makefile"
    if (nome === "makefile") ext = "make";
    var tipo = String(file && file.type || "").toLowerCase();
    return ROTAS.filter(function (r) { return r.ext.indexOf(ext) >= 0; })[0] ||
      ROTAS.filter(function (r) { return r.tipo && tipo.indexOf(r.tipo) === 0; })[0] ||
      (tipo === "text/plain" ? ROTAS.filter(function (r) { return r.app === "texto"; })[0] : null);
  }

  function idNovo() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }
  function gravar(banco, loja, valor, chave, limpar) {
    return new Promise(function (ok, erro) {
      var req = indexedDB.open(banco, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(loja); };
      req.onerror = function () { erro(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction(loja, "readwrite"), st = tx.objectStore(loja);
        if (limpar) {
          // entregas esquecidas há mais de 1 dia
          var c = st.openCursor();
          c.onsuccess = function () { var k = c.result; if (!k) return; if (Date.now() - (k.value && (k.value.at || k.value.lastModified) || 0) > 864e5) k.delete(); k.continue(); };
        }
        st.put(valor, chave);
        tx.oncomplete = function () { db.close(); ok(); };
        tx.onerror = tx.onabort = function () { db.close(); erro(tx.error); };
      };
    });
  }
  function bytes(files) {
    return Promise.all(files.map(function (f) {
      return f.arrayBuffer().then(function (d) { return { name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), data: d }; });
    }));
  }

  /* Prepara a entrega e devolve o endereço do app que abre os arquivos. */
  function preparar(rota, files) {
    var id = idNovo();
    if (INKDOS[rota.app]) {
      return bytes(files.slice(0, 1)).then(function (l) {
        var v = l[0]; v.at = Date.now();
        return gravar("inkdos-launch-handoff", "files", v, id, true);
      }).then(function () { return RAIZ + "inkdos/apps/" + INKDOS[rota.app] + "/index.html?suite=1#inkdos-launch=" + id; });
    }
    if (rota.app === "codigo") {
      var agora = Date.now(), caminhos = [];
      return bytes(files).then(function (l) {
        var p = Promise.resolve();
        // FileType do VS Code: 1 = arquivo, 2 = pasta
        p = p.then(function () { return gravar("inkdoshub-codigo", "files", { type: 2, ctime: agora, mtime: agora }, "/Received"); });
        l.forEach(function (v) {
          var nome = v.name.replace(/[\/\\]/g, "_") || "arquivo", caminho = "/Received/" + nome;
          caminhos.push(caminho);
          p = p.then(function () { return gravar("inkdoshub-codigo", "files", { type: 1, ctime: agora, mtime: agora, data: new Uint8Array(v.data) }, caminho); });
        });
        return p.then(function () { return gravar("inkdoshub-codigo-abrir", "abrir", { caminhos: caminhos, at: agora }, "pedido"); });
      }).then(function () { return RAIZ + "apps/codigo/"; });
    }
    return bytes(files).then(function (l) {
      return gravar("inkdoshub-entrada", "arquivos", { arquivos: l, at: Date.now() }, id, true);
    }).then(function () { return RAIZ + P.apps.filter(function (a) { return a.id === rota.app; })[0].url + "#ink-arquivos=" + id; });
  }

  /* Agrupa os arquivos por app. Apps do InkDOS abrem um arquivo por página. */
  function grupos(files) {
    var g = [], semApp = [];
    files.forEach(function (f) {
      var r = rotaDe(f);
      if (!r) { semApp.push(f); return; }
      var x = r.varios ? g.filter(function (y) { return y.rota === r; })[0] : null;
      if (x) x.files.push(f); else g.push({ rota: r, files: [f] });
    });
    return { grupos: g, semApp: semApp };
  }
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) { return s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  function nomeApp(id) {
    var n = { documentos: t("Documents"), planilhas: t("Spreadsheets"), apresentacoes: t("Presentations"), pdf: t("PDF"), texto: t("Plain text"),
      epub: t("EPUB reader"), foto: t("Photos"), video: t("Video"), musica: t("Music"), codigo: t("Code") }[id];
    return n || id;
  }

  var sec = document.getElementById("recebidos"), lista = document.getElementById("recebidos-lista"), nota = document.getElementById("recebidos-nota");

  function mostrar(r) {
    lista.innerHTML = "";
    r.grupos.forEach(function (x) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "botao";
      b.textContent = x.files.length === 1 ? t("{file} in {app}", { file: x.files[0].name, app: nomeApp(x.rota.app) }) : t("{n} files in {app}", { n: x.files.length, app: nomeApp(x.rota.app) });
      b.addEventListener("click", function () {
        // a página nova abre no toque; o endereço chega depois de o arquivo ser guardado
        var w = null;
        if (!window.InkPaginas || InkPaginas.novaAba) try { w = window.open("", "_blank"); } catch (_) {}
        b.disabled = true;
        preparar(x.rota, x.files).then(function (url) {
          if (w) { w.location.replace(url); b.textContent = t("Opened: {name}", { name: b.textContent }); }
          else location.href = url;
        }, function () { if (w) w.close(); b.disabled = false; nota.textContent = t("Could not keep the file for the app. Try again."); });
      });
      lista.appendChild(b);
    });
    nota.textContent = r.semApp.length ? t("No app here opens: {files}.", { files: r.semApp.map(function (f) { return f.name; }).join(", ") }) : "";
    sec.hidden = false;
    sec.scrollIntoView({ block: "nearest" });
  }

  /* Abre os arquivos: um app só abre nesta página (como no InkDOS); mais de um mostra a lista. */
  function abrirArquivos(files) {
    files = [].filter.call(files || [], Boolean);
    if (!files.length) return;
    var r = grupos(files);
    if (r.grupos.length === 1 && !r.semApp.length) {
      document.documentElement.classList.add("abrindo-arquivo");
      return preparar(r.grupos[0].rota, r.grupos[0].files).then(function (url) { location.replace(url); },
        function () { document.documentElement.classList.remove("abrindo-arquivo"); mostrar(r); });
    }
    mostrar(r);
  }

  if (window.launchQueue && typeof window.launchQueue.setConsumer === "function") {
    window.launchQueue.setConsumer(function (params) {
      var handles = params && params.files ? [].slice.call(params.files) : [];
      Promise.all(handles.map(function (h) { return h && typeof h.getFile === "function" ? h.getFile().catch(function () { return null; }) : h; }))
        .then(abrirArquivos);
    });
  }

  window.InkLancador = { rotaDe: rotaDe, abrirArquivos: abrirArquivos };
})();
