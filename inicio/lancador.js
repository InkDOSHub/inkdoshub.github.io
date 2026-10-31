/* Lançador de arquivos da tela inicial, como na tela inicial do InkDOS.

   Com o InkDOS Hub instalado (manifest.webmanifest, "file_handlers"), abrir um arquivo no XeOS
   manda o arquivo para esta página (launchQueue). Ela escolhe o app pela extensão e abre o app
   com o arquivo.

   Como o arquivo chega a cada app:
   - apps do InkDOS (inkdos/): IndexedDB "inkdos-launch-handoff" e #inkdos-launch=<id>, o mesmo
     caminho da tela inicial do InkDOS original (runtime/platform/file-launch.js de cada app);
   - Fotos, Vídeo e Música: IndexedDB "inkdoshub-entrada" e #ink-arquivos=<id>; o app recebe pelo
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
  var OFFICE = { documentos: 1, planilhas: 1, apresentacoes: 1 }, K_PREF = "inkdoshub-abrir-office";
  var CRAFT = { documentos: "wordcraft", planilhas: "gridcraft", apresentacoes: "deckcraft" };
  // padrão: InkDOS no iPhone (o ArtCraft não tem layout de celular), ArtCraft no resto
  var PADRAO = /iPhone|iPod|Android.+Mobile/.test(navigator.userAgent) ? "inkdos" : "artcraft";
  function preferencia() { var v; try { v = localStorage.getItem(K_PREF) || PADRAO; } catch (_) { v = PADRAO; } return v === "inkdos" ? v : "artcraft"; }
  // Menu ☰: duas linhas (ArtCraft, o padrão / InkDOS legado), com ✓ na escolhida
  var opcoes = [].slice.call(document.querySelectorAll(".pref-office"));
  function marcar() { var v = preferencia(); opcoes.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.pref === v)); }); }
  opcoes.forEach(function (b) {
    b.addEventListener("click", function () { try { localStorage.setItem(K_PREF, b.dataset.pref); } catch (_) {} marcar(); });
  });
  marcar();

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
  /* limpar: dias depois dos quais as entregas esquecidas saem (0 = não limpa) */
  function gravar(banco, loja, valor, chave, limpar) {
    return new Promise(function (ok, erro) {
      var req = indexedDB.open(banco, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(loja); };
      req.onerror = function () { erro(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction(loja, "readwrite"), st = tx.objectStore(loja);
        if (limpar) {
          // entregas esquecidas há mais de "limpar" dias
          var c = st.openCursor();
          c.onsuccess = function () { var k = c.result; if (!k) return; if (Date.now() - (k.value && (k.value.at || k.value.lastModified) || 0) > limpar * 864e5) k.delete(); k.continue(); };
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

  /* Editor escolhido no ☰; se ele estiver escondido em Customize e o outro não, abre no outro. */
  function usaArtcraft(app) {
    var M = window.InkMeusApps, sim = preferencia() === "artcraft";
    if (M && sim && M.escondido(CRAFT[app]) && !M.escondido(app)) return false;
    if (M && !sim && M.escondido(app) && !M.escondido(CRAFT[app])) return true;
    return sim;
  }

  /* Prepara a entrega e devolve o endereço do app que abre os arquivos. */
  function preparar(rota, files) {
    var id = idNovo();
    // Preferência da tela inicial: Word, Excel e PowerPoint abrem no ArtCraft (completo) em vez do InkDOS (rápido)
    if (OFFICE[rota.app] && usaArtcraft(rota.app)) {
      return bytes(files.slice(0, 1)).then(function (l) {
        var v = l[0];
        // guardado por 7 dias, como nos apps do InkDOS: o editor recarrega o documento dali
        return gravar("inkdos-tool-handoff", "files", { bytes: v.data, type: v.type, name: v.name, at: Date.now() }, id, 7).then(function () {
          var ed = { documentos: "wordcraft", planilhas: "gridcraft", apresentacoes: "deckcraft" }[rota.app];
          return RAIZ + "apps/" + ed + "/?inkdos-handoff=" + encodeURIComponent(id);
        });
      });
    }
    if (INKDOS[rota.app]) {
      return bytes(files.slice(0, 1)).then(function (l) {
        var v = l[0]; v.at = Date.now();
        return gravar("inkdos-launch-handoff", "files", v, id, 1);
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
      return gravar("inkdoshub-entrada", "arquivos", { arquivos: l, at: Date.now() }, id, 1);
    }).then(function () { return RAIZ + P.apps.filter(function (a) { return a.id === rota.app; })[0].url + "#ink-arquivos=" + id; });
  }

  /* Agrupa os arquivos por app. Apps do InkDOS abrem um arquivo por página. */
  function grupos(files) {
    var g = [], semApp = [], bloq = [], M = window.InkMeusApps;
    files.forEach(function (f) {
      var r = rotaDe(f);
      if (!r) { semApp.push(f); return; }
      // app escondido pela pessoa (meus-apps.js): o tipo dele não abre aqui
      // Word/Excel/PowerPoint: só bloqueia se o editor do InkDOS e o do ArtCraft estiverem escondidos
      if (M && M.escondido(r.app) && !(CRAFT[r.app] && !M.escondido(CRAFT[r.app]))) {
        var b = bloq.filter(function (y) { return y.rota === r; })[0];
        if (b) b.files.push(f); else bloq.push({ rota: r, files: [f] });
        return;
      }
      var x = r.varios ? g.filter(function (y) { return y.rota === r; })[0] : null;
      if (x) x.files.push(f); else g.push({ rota: r, files: [f] });
    });
    return { grupos: g, semApp: semApp, bloq: bloq };
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
    Array.prototype.forEach.call(sec.querySelectorAll(".bloqueado"), function (d) { d.remove(); });
    r.bloq.forEach(function (x) {
      var d = document.createElement("div"), p = document.createElement("p"), web = window.InkMeusApps.webapps();
      d.className = "bloqueado";
      p.className = "nota erro";
      p.textContent = t("{app} is hidden, so {files} cannot open here. Open a webapp of yours and choose the file there, or show the app again.",
        { app: nomeApp(x.rota.app), files: x.files.map(function (f) { return f.name; }).join(", ") });
      d.appendChild(p);
      web.forEach(function (w) {
        var a = document.createElement("a");
        a.className = "botao secundario"; a.href = w.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.textContent = t("Open {app}", { app: w.nome });
        a.setAttribute("data-idioma-nao", "");
        d.appendChild(a);
      });
      var m = document.createElement("button");
      m.type = "button"; m.className = "botao";
      m.textContent = t("Show {app} again", { app: nomeApp(x.rota.app) });
      m.addEventListener("click", function () { window.InkMeusApps.mostrar(x.rota.app); d.remove(); abrirArquivos(x.files); });
      d.appendChild(m);
      if (!web.length) { var q = document.createElement("p"); q.className = "nota"; q.textContent = t("To send these files to another site, add it with the Add webapp card."); d.appendChild(q); }
      sec.insertBefore(d, nota);
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
    if (r.grupos.length === 1 && !r.semApp.length && !r.bloq.length) {
      document.documentElement.classList.add("abrindo-arquivo");
      return preparar(r.grupos[0].rota, r.grupos[0].files).then(function (url) { if (P.marcar) P.marcar("home: file saved, opening app"); location.replace(url); },
        function () { document.documentElement.classList.remove("abrindo-arquivo"); mostrar(r); });
    }
    mostrar(r);
  }

  if (window.launchQueue && typeof window.launchQueue.setConsumer === "function") {
    window.launchQueue.setConsumer(function (params) {
      if (P.marcar) { P.marcar("home: page started", true); P.marcar("home: file received from XeOS"); }
      var handles = params && params.files ? [].slice.call(params.files) : [];
      Promise.all(handles.map(function (h) { return h && typeof h.getFile === "function" ? h.getFile().catch(function () { return null; }) : h; }))
        .then(abrirArquivos);
    });
  }

  /* Botão "Abrir arquivo": o seletor do sistema (no iPhone, o app Arquivos) aceita qualquer tipo e o
     arquivo vai para o app certo, como no launchQueue. */
  var botao = document.getElementById("btn-abrir"), entrada = document.getElementById("abrir-arquivo");
  if (botao && entrada) {
    botao.addEventListener("click", function () { entrada.value = ""; entrada.click(); });
    entrada.addEventListener("change", function () { abrirArquivos([].slice.call(entrada.files || [])); });
  }

  window.InkLancador = { rotaDe: rotaDe, abrirArquivos: abrirArquivos };
})();
