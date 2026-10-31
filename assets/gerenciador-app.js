/* Abertura dos apps do InkDOS Hub.

   Cada ferramenta abre na própria aba e só carrega quando é pedida. O site não aplica limite de
   memória: as abas não se coordenam e o sistema (iOS, XeOS, navegador) decide o que fecha. */
(function () {
  "use strict";
  var script = document.currentScript;
  var RAIZ = new URL("../", script ? script.src : location.href).href;

  var APPS = [
    { id: "terminal", nome: "Linux terminal", url: "terminal/" },
    { id: "foto", nome: "Photos", url: "apps/foto/" },
    { id: "videoeditor", nome: "Edit video", url: "apps/video/cortar/" },
    { id: "video", nome: "Video", url: "apps/video/" },
    { id: "codigo", nome: "Code", url: "apps/codigo/" },
    { id: "quadro", nome: "Whiteboard", url: "apps/quadro/" },
    { id: "musica", nome: "Music", url: "apps/musica/" },
    { id: "gravador", nome: "Recorder", url: "apps/gravador/" },
    { id: "webcam", nome: "Webcam", url: "apps/webcam/" },
    { id: "transferir", nome: "Transfer", url: "apps/transferir/" },
    // cópia dos apps do InkDOS (inkdos/); suite=1 mostra o botão Home, que volta para a tela inicial
    { id: "documentos", nome: "Documents", url: "inkdos/apps/documents/index.html?suite=1" },
    { id: "planilhas", nome: "Spreadsheets", url: "inkdos/apps/spreadsheets/index.html?suite=1" },
    { id: "apresentacoes", nome: "Presentations", url: "inkdos/apps/presentations/index.html?suite=1" },
    { id: "pdf", nome: "PDF", url: "inkdos/apps/pdf/index.html?suite=1" },
    { id: "editar-pdf", nome: "Edit PDF", url: "apps/editar-pdf/" },
    { id: "texto", nome: "Plain text", url: "inkdos/apps/txt/index.html?suite=1" },
    { id: "epub", nome: "EPUB reader", url: "inkdos/apps/epub/index.html?suite=1" },
    // editores ArtCraft (artcraft/, páginas em apps/*craft/), também abertos pelo "Editar com ArtCraft" dos apps do InkDOS
    { id: "wordcraft", nome: "WordCraft", url: "apps/wordcraft/" },
    { id: "gridcraft", nome: "GridCraft", url: "apps/gridcraft/" },
    { id: "deckcraft", nome: "DeckCraft", url: "apps/deckcraft/" },
  ];
  function caminho(u) { return new URL(u, RAIZ).pathname.replace(/index\.html$/, ""); }
  function appDe(id) { return APPS.filter(function (a) { return a.id === id; })[0]; }
  function appDaUrl(u) {
    var p = new URL(u, RAIZ).pathname, melhor = null;
    APPS.forEach(function (a) {
      var c = caminho(a.url);
      if (p.indexOf(c) === 0 && (!melhor || c.length > caminho(melhor.url).length)) melhor = a;
    });
    return melhor;
  }
  var INICIOS = [RAIZ, RAIZ + "index.html", RAIZ + "inkdos/", RAIZ + "inkdos/index.html"];
  function ehInicio(u) { return INICIOS.indexOf(String(u).split("#")[0].split("?")[0]) >= 0; }

  var noInicio = ehInicio(location.href);
  var app = noInicio ? null : appDaUrl(location.href);
  var topo = window.top === window;

  /* Abas novas só no XeOS (desktop web no iPad, onde cada documento precisa da própria janela); nos
     outros navegadores os apps abrem na mesma aba. Sinal do XeOS: "XeOS" no user agent ou o Hub
     dentro de outra página. ?abas=nova ou ?abas=mesma no endereço fixa a escolha neste aparelho. */
  var novaAba = (function () {
    var q = /[?&]abas=(nova|mesma)\b/.exec(location.search), v = q ? q[1] : null;
    try { if (q) localStorage.setItem("inkdoshub-abas", v); else v = localStorage.getItem("inkdoshub-abas"); } catch (_) {}
    if (v === "nova" || v === "mesma") return v === "nova";
    return /XeOS/i.test(navigator.userAgent) || !topo;
  })();

  // o nome da janela é como a tela inicial acha a aba de cada app (window.open("", nome))
  if (topo && (!window.name || /^inkdoshub-/.test(window.name))) {
    if (noInicio) window.name = "inkdoshub-inicio";
    else if (app && app.id !== "office") window.name = "inkdoshub-" + app.id;
  }

  function aplicarTema(t) {
    if (t !== "light" && t !== "dark") return;
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  }
  addEventListener("storage", function (e) { if (e.key === "inkdoshub-tema") aplicarTema(e.newValue); });

  /* Abre um app na aba dele, se já estiver aberta (mesmo nome de janela), ou numa nova. */
  function abrirUrl(url, janela) {
    var w = null;
    if (!novaAba) { location.href = url; return; }
    try { w = window.open("", janela); } catch (_) {}
    if (!w) { location.href = url; return; } // o navegador bloqueou a aba nova: abre nesta
    var atual = "";
    try { atual = w.location.href; } catch (_) {}
    if (!atual || atual === "about:blank") w.location.replace(url);
    try { w.focus(); } catch (_) {}
  }
  /* Volta para a tela inicial. Se esta aba foi aberta por ela, tenta trazer a aba dela para a
     frente; se a troca não acontece (o XeOS e alguns navegadores não deixam uma aba focar outra),
     abre a tela inicial nesta mesma aba. Nunca abre uma janela vazia. */
  function irParaInicio() {
    var mae = null;
    try { if (window.opener && !window.opener.closed && ehInicio(window.opener.location.href)) mae = window.opener; } catch (_) {}
    if (mae) {
      try { mae.focus(); } catch (_) {}
      setTimeout(function () {
        if (document.visibilityState === "visible" && document.hasFocus()) location.href = RAIZ;
      }, 350);
      return;
    }
    location.href = RAIZ;
  }

  if (topo && !noInicio && app) {
    // o link para a tela inicial (barra do app, Home do InkDOS) vai para a aba dela sem fechar esta
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a || !ehInicio(a.href) || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      irParaInicio();
    }, true);
    // assim que o HTML do app estiver pronto (antes esperava a página toda carregar + 400 ms)
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", receber);
    else receber();
  }

  /* Código: arquivos do XeOS vão direto para a pasta /Received do editor (IndexedDB "inkdoshub-codigo"),
     como faz a tela inicial (inicio/lancador.js); a extensão inkfs abre o pedido quando o editor liga. */
  if (window.launchQueue && typeof window.launchQueue.setConsumer === "function" && app && app.id === "codigo") {
    window.launchQueue.setConsumer(function (params) {
      var hs = params && params.files ? [].slice.call(params.files) : [];
      if (!hs.length) return;
      Promise.all(hs.map(function (h) { return h.getFile().then(function (f) { return f.arrayBuffer().then(function (d) { return { name: f.name, data: d }; }); }); })).then(function (l) {
        var agora = Date.now(), caminhos = [];
        var req = indexedDB.open("inkdoshub-codigo", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
        req.onsuccess = function () {
          var db = req.result, tx = db.transaction("files", "readwrite"), st = tx.objectStore("files");
          st.put({ type: 2, ctime: agora, mtime: agora }, "/Received");
          l.forEach(function (v) {
            var c = "/Received/" + (v.name.replace(/[\/\\]/g, "_") || "arquivo");
            caminhos.push(c);
            st.put({ type: 1, ctime: agora, mtime: agora, data: new Uint8Array(v.data) }, c);
          });
          tx.oncomplete = function () {
            db.close();
            var r2 = indexedDB.open("inkdoshub-codigo-abrir", 1);
            r2.onupgradeneeded = function () { r2.result.createObjectStore("abrir"); };
            r2.onsuccess = function () {
              var d2 = r2.result, t2 = d2.transaction("abrir", "readwrite");
              t2.objectStore("abrir").put({ caminhos: caminhos, at: agora }, "pedido");
              t2.oncomplete = function () { d2.close(); };
            };
          };
        };
      });
    });
  }

  /* Fotos, Vídeo e Música recebem do XeOS direto (manifest.webmanifest, "file_handlers"), sem
     passar pela tela inicial: uma página a menos para carregar. */
  if (window.launchQueue && typeof window.launchQueue.setConsumer === "function" && app && /^(foto|video|musica)$/.test(app.id)) {
    window.launchQueue.setConsumer(function (params) {
      var hs = params && params.files ? [].slice.call(params.files) : [];
      if (!hs.length) return;
      Promise.all(hs.map(function (h) { return h.getFile().catch(function () { return null; }); })).then(function (fs) {
        fs = fs.filter(Boolean);
        var entregar = function () {
          var entrada = document.getElementById("arquivos");
          if (!entrada || !fs.length) return;
          var dt = new DataTransfer();
          fs.forEach(function (f) { dt.items.add(f); });
          entrada.files = dt.files;
          entrada.dispatchEvent(new Event("change", { bubbles: true }));
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", entregar); else entregar();
      });
    });
  }

  /* Arquivos mandados pela tela inicial (inicio/lancador.js): ficam no IndexedDB
     "inkdoshub-entrada" e chegam ao app pelo botão de abrir dele (o input #arquivos). */
  function receber() {
    var m = /(?:^#|&)ink-arquivos=([A-Za-z0-9-]+)/.exec(location.hash);
    if (!m || !window.indexedDB) return;
    var id = m[1];
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch (_) {}
    var req = indexedDB.open("inkdoshub-entrada", 1);
    req.onupgradeneeded = function () { req.result.createObjectStore("arquivos"); };
    req.onsuccess = function () {
      var db = req.result, tx = db.transaction("arquivos", "readwrite"), st = tx.objectStore("arquivos"), get = st.get(id);
      get.onsuccess = function () {
        var v = get.result;
        st.delete(id);
        var entrada = document.getElementById("arquivos");
        if (!v || !v.arquivos || !entrada) return;
        var dt = new DataTransfer();
        v.arquivos.forEach(function (a) { dt.items.add(new File([a.data], a.name, { type: a.type || "", lastModified: a.lastModified || Date.now() })); });
        entrada.files = dt.files;
        entrada.dispatchEvent(new Event("change", { bubbles: true }));
      };
      tx.oncomplete = function () { db.close(); };
    };
  }

  /* Editor ArtCraft pela extensão do arquivo. */
  function editorDe(nome) {
    var e = String(nome || "").toLowerCase().split(".").pop();
    if (/^(xlsx|xlsm|xls|ods|csv|tsv)$/.test(e)) return "gridcraft";
    if (/^(pptx|ppsx|ppt|odp|key)$/.test(e)) return "deckcraft";
    return "wordcraft";
  }

  /* Usado pela tela inicial (inicio/) e pelos apps do InkDOS (editores ArtCraft). */
  window.InkPaginas = {
    raiz: RAIZ,
    apps: APPS,
    novaAba: novaAba,
    abrir: function (id) {
      var a = appDe(id); if (!a) return;
      var u = new URL(a.url, RAIZ).href;
      abrirUrl(u, "inkdoshub-" + id);
    },
    /* O app do InkDOS guardou o documento no IndexedDB "inkdos-tool-handoff", lido por assets/artcraft-host.js.
       win: a aba aberta no toque, antes de ler o documento. */
    abrirEditor: function (info, win) {
      var url = new URL("apps/" + editorDe(info.nome) + "/?inkdos-handoff=" + encodeURIComponent(info.id), RAIZ).href;
      if (win && !win.closed) {
        win.location.replace(url);
        try { win.focus(); } catch (_) {}
        return;
      }
      var w = null;
      if (novaAba) try { w = window.open(url, "_blank"); } catch (_) {}
      if (!w) location.href = url;
    },
  };
})();
