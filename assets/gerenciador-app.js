/* Opening the InkDOS Hub apps.

   Each tool opens in its own tab and only loads when requested. The site sets no memory
   limit: tabs do not coordinate and the system (iOS, XeOS, browser) decides what closes. */
(function () {
  "use strict";
  var script = document.currentScript;
  var RAIZ = new URL("../", script ? script.src : location.href).href;

  var APPS = [
    { id: "terminal", nome: "Linux terminal", url: "terminal/" },
    { id: "wine", nome: "Wine", url: "apps/wine/" },
    { id: "zip", nome: "Zip", url: "apps/zip/" },
    { id: "jogos", nome: "Games", url: "apps/jogos/" },
    { id: "ia", nome: "AI Chat", url: "InkMind/" },
    { id: "wasm", nome: "Wasm Build", url: "apps/wasm/" },
    { id: "foto", nome: "Photos", url: "apps/foto/" },
    { id: "videoeditor", nome: "Edit video", url: "apps/video/cortar/" },
    { id: "video", nome: "Video", url: "apps/video/" },
    { id: "codigo", nome: "Code", url: "apps/codigo/" },
    { id: "quadro", nome: "Whiteboard", url: "apps/quadro/" },
    { id: "musica", nome: "Music", url: "apps/musica/" },
    { id: "gravador", nome: "Recorder", url: "apps/gravador/" },
    { id: "webcam", nome: "Webcam", url: "InkCam/" },
    { id: "transferir", nome: "Transfer", url: "apps/transferir/" },
    // copy of the InkDOS apps (inkdos/); suite=1 shows the Home button, which goes back to the home screen
    { id: "documentos", nome: "Documents", url: "inkdos/apps/documents/index.html?suite=1" },
    { id: "planilhas", nome: "Spreadsheets", url: "inkdos/apps/spreadsheets/index.html?suite=1" },
    { id: "apresentacoes", nome: "Presentations", url: "inkdos/apps/presentations/index.html?suite=1" },
    { id: "pdf", nome: "PDF", url: "inkdos/apps/pdf/index.html?suite=1" },
    { id: "editar-pdf", nome: "Edit PDF", url: "apps/editar-pdf/" },
    { id: "seguranca", nome: "Security", url: "apps/seguranca/" },
    { id: "texto", nome: "Plain text", url: "inkdos/apps/txt/index.html?suite=1" },
    { id: "epub", nome: "EPUB reader", url: "inkdos/apps/epub/index.html?suite=1" },
    // ArtCraft editors (artcraft/, pages in apps/*craft/), also opened by "Edit with ArtCraft" in the InkDOS apps
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

  /* New tabs only in XeOS (desktop web on iPad, where each document needs its own window); in the
     other browsers apps open in the same tab. XeOS signal: "XeOS" in the user agent or the Hub
     inside another page. ?abas=nova or ?abas=mesma in the address pins the choice on this device. */
  var novaAba = (function () {
    var q = /[?&]abas=(nova|mesma)\b/.exec(location.search), v = q ? q[1] : null;
    try { if (q) localStorage.setItem("inkdoshub-abas", v); else v = localStorage.getItem("inkdoshub-abas"); } catch (_) {}
    if (v === "nova" || v === "mesma") return v === "nova";
    return /XeOS/i.test(navigator.userAgent) || !topo;
  })();

  // the window name is how the home screen finds each app's tab (window.open("", name))
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

  /* Opens an app in its tab, if already open (same window name), or in a new one. */
  function abrirUrl(url, janela) {
    var w = null;
    if (!novaAba) { location.href = url; return; }
    try { w = window.open("", janela); } catch (_) {}
    if (!w) { location.href = url; return; } // the browser blocked the new tab: open in this one
    var atual = "";
    try { atual = w.location.href; } catch (_) {}
    if (!atual || atual === "about:blank") w.location.replace(url);
    try { w.focus(); } catch (_) {}
  }
  /* Goes back to the home screen. If this tab was opened by it, tries to bring its tab to the
     front; if the switch does not happen (XeOS and some browsers do not let one tab focus another),
     opens the home screen in this same tab. Never opens an empty window. */
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
    // the link to the home screen (app bar, InkDOS Home) goes to its tab without closing this one
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

  /* Files sent by the home screen (inicio/lancador.js): stored in the IndexedDB
     "inkdoshub-entrada" and reach the app through its open button (the #arquivos input). */
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

  /* ArtCraft editor by file extension. */
  function editorDe(nome) {
    var e = String(nome || "").toLowerCase().split(".").pop();
    if (/^(xlsx|xlsm|xls|ods|csv|tsv)$/.test(e)) return "gridcraft";
    if (/^(deckcraft|pptx|ppsx|ppt|odp|key)$/.test(e)) return "deckcraft";
    return "wordcraft";
  }

  /* Used by the home screen (inicio/) and the InkDOS apps (ArtCraft editors). */
  window.InkPaginas = {
    raiz: RAIZ,
    apps: APPS,
    novaAba: novaAba,
    abrir: function (id) {
      var a = appDe(id); if (!a) return;
      var u = new URL(a.url, RAIZ).href;
      abrirUrl(u, "inkdoshub-" + id);
    },
    /* The InkDOS app stored the document in the "inkdos-tool-handoff" IndexedDB, read by assets/artcraft-host.js.
       win: the tab opened on tap, before reading the document. */
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
