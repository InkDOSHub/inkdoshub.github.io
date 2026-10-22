/* Abertura dos apps do InkTerminal.

   Cada ferramenta abre na própria aba e só carrega quando é pedida. O site não aplica limite de
   memória: as abas não se coordenam e o sistema (iOS, XeOS, navegador) decide o que fecha.

   Compatibilidade: inkGerenciador.aoGuardar(fn) continua existindo, mas não faz nada. */
(function () {
  "use strict";
  var script = document.currentScript;
  var RAIZ = new URL("../", script ? script.src : location.href).href;

  /* peso: memória estimada da aba em MB (só informativo; o Safari não informa o valor real). */
  var APPS = [
    { id: "terminal", nome: "Linux terminal", url: "terminal/",
      // o modo "limitada" do terminal (640 MB + swap) deixa a aba perto de 1 GB
      peso: function () { var m; try { m = localStorage.getItem("inkterminal-memoria"); } catch (_) {} return m === "limitada" ? 900 : 350; } },
    { id: "foto", nome: "Photos", url: "apps/foto/", peso: 120 },
    { id: "videoeditor", nome: "Edit video", url: "apps/video/cortar/", peso: 300 },
    { id: "video", nome: "Video", url: "apps/video/", peso: 150 },
    { id: "codigo", nome: "Code", url: "apps/codigo/", peso: 250 },
    { id: "quadro", nome: "Whiteboard", url: "apps/quadro/", peso: 120 },
    { id: "musica", nome: "Music", url: "apps/musica/", peso: 60 },
    { id: "webcam", nome: "Webcam", url: "apps/webcam/", peso: 80 },
    // cópia dos apps do InkDOS (inkdos/); suite=1 mostra o botão Home, que volta para a tela inicial
    { id: "documentos", nome: "Documents", url: "inkdos/apps/documents/index.html?suite=1", peso: 120 },
    { id: "planilhas", nome: "Spreadsheets", url: "inkdos/apps/spreadsheets/index.html?suite=1", peso: 120 },
    { id: "apresentacoes", nome: "Presentations", url: "inkdos/apps/presentations/index.html?suite=1", peso: 120 },
    { id: "pdf", nome: "PDF", url: "inkdos/apps/pdf/index.html?suite=1", peso: 150 },
    { id: "texto", nome: "Plain text", url: "inkdos/apps/txt/index.html?suite=1", peso: 50 },
    { id: "epub", nome: "EPUB reader", url: "inkdos/apps/epub/index.html?suite=1", peso: 80 },
    // editores ONLYOFFICE (onlyoffice/), abertos pelo "Editar com ONLYOFFICE" dos apps do InkDOS
    { id: "office", nome: "ONLYOFFICE", url: "onlyoffice/editor.html", peso: 400, oculto: true },
  ];
  function pesoDe(a) { return typeof a.peso === "function" ? a.peso() : a.peso || 0; }
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

  var api = function () {};
  api.aoGuardar = function () {};
  window.inkGerenciador = api;
  window.INK_APPS = APPS;

  var noInicio = ehInicio(location.href);
  var app = noInicio ? null : appDaUrl(location.href);
  var topo = window.top === window;

  // o nome da janela é como a tela inicial acha a aba de cada app (window.open("", nome))
  if (topo && (!window.name || /^inkterminal-/.test(window.name))) {
    if (noInicio) window.name = "inkterminal-inicio";
    else if (app && app.id !== "office") window.name = "inkterminal-" + app.id;
  }

  function aplicarTema(t) {
    if (t !== "light" && t !== "dark") return;
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  }
  addEventListener("storage", function (e) { if (e.key === "inkterminal-tema") aplicarTema(e.newValue); });

  /* Abre um app na aba dele, se já estiver aberta (mesmo nome de janela), ou numa nova. */
  function abrirUrl(url, janela) {
    var w = null;
    try { w = window.open("", janela); } catch (_) {}
    if (!w) { location.href = url; return; } // o navegador bloqueou a aba nova: abre nesta
    var atual = "";
    try { atual = w.location.href; } catch (_) {}
    if (!atual || atual === "about:blank" || /\/inicio\/guardada\.html/.test(atual)) w.location.replace(url);
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
    var depois = function (fn, ms) {
      if (document.readyState === "complete") setTimeout(fn, ms);
      else addEventListener("load", function () { setTimeout(fn, ms); });
    };
    depois(receber, 400);
  }

  /* Arquivos mandados pela tela inicial (inicio/lancador.js): ficam no IndexedDB
     "inkterminal-entrada" e chegam ao app pelo botão de abrir dele (o input #arquivos). */
  function receber() {
    var m = /(?:^#|&)ink-arquivos=([A-Za-z0-9-]+)/.exec(location.hash);
    if (!m || !window.indexedDB) return;
    var id = m[1];
    try { history.replaceState(history.state, "", location.pathname + location.search); } catch (_) {}
    var req = indexedDB.open("inkterminal-entrada", 1);
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

  /* O editor abre sempre no idioma do pacote escolhido (assets/idioma.js), ou em inglês. Sem o
     locale na URL, o ONLYOFFICE seguiria o idioma do aparelho e baixaria um idioma não escolhido. */
  function idiomaEditor(info) {
    if (window.InkIdioma) return InkIdioma.onlyoffice();
    return info.locale || "en";
  }

  /* Usado pela tela inicial (inicio/) e pelos apps do InkDOS (editor ONLYOFFICE). */
  window.InkPaginas = {
    raiz: RAIZ,
    apps: APPS,
    peso: pesoDe,
    abrir: function (id) { var a = appDe(id); if (a) abrirUrl(new URL(a.url, RAIZ).href, "inkterminal-" + id); },
    /* O app do InkDOS guardou o documento no IndexedDB "inkdos-tool-handoff" (veja
       tools/adaptar_inkdos.py). win: a aba aberta no toque, antes de ler o documento. */
    abrirEditor: function (info, win) {
      var url = new URL("onlyoffice/editor.html?embed=1&embedOrigin=" + encodeURIComponent(location.origin) +
        "&inkdos-handoff=" + encodeURIComponent(info.id) + "&locale=" + encodeURIComponent(idiomaEditor(info)) +
        "&ink-nome=" + encodeURIComponent(String(info.nome || "document").slice(0, 80)), RAIZ).href;
      if (win && !win.closed) {
        win.location.replace(url);
        try { win.focus(); } catch (_) {}
        return;
      }
      var w = null;
      try { w = window.open(url, "_blank"); } catch (_) {}
      if (!w) location.href = url;
    },
  };
})();
