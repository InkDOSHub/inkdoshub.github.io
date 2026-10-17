/* Controle de memória entre as páginas abertas do InkTerminal.

   Cada ferramenta abre na própria página (aba ou janela) e só carrega quando é pedida. Este
   arquivo vai em todas elas e na tela inicial. As páginas se conhecem por um BroadcastChannel
   e por uma lista no localStorage; cada app tem um peso estimado em MB (o Safari não informa o
   valor real). Quando uma página nova abre e a soma passa do limite (ou do número de páginas),
   a página parada há mais tempo é guardada: ela grava o próprio estado e troca o conteúdo por
   inicio/guardada.html, que quase não usa memória e reabre o app com um toque.

   Páginas que não salvam sozinhas só são guardadas depois de a pessoa confirmar.

   Um app avisa que sabe gravar o próprio estado assim:
     inkGerenciador.aoGuardar(async () => { await salvar(); return "pronto"; });
   A função pode devolver "manter" ou {manter: "motivo"} para pedir para continuar aberta.
   Os apps do InkDOS (inkdos/) usam os rascunhos de recuperação deles. */
(function () {
  "use strict";
  var script = document.currentScript;
  var RAIZ = new URL("../", script ? script.src : location.href).href;

  /* Apps do site. peso: memória estimada em MB com o app carregado.
     salvaSozinho: guarda o estado o tempo todo, então pode sair da memória sem perguntar. */
  var APPS = [
    { id: "terminal", nome: "Linux terminal", url: "terminal/",
      // o modo "limitada" do terminal (640 MB + swap) deixa a página perto de 1 GB
      peso: function () { var m; try { m = localStorage.getItem("inkterminal-memoria"); } catch (_) {} return m === "limitada" ? 900 : 350; } },
    { id: "foto", nome: "Fotos", url: "apps/foto/", peso: 180 },
    { id: "videoeditor", nome: "Editar vídeo", url: "apps/video/editor/", peso: 500 },
    { id: "video", nome: "Vídeo", url: "apps/video/", peso: 350 },
    { id: "codigo", nome: "Código", url: "apps/codigo/", peso: 300 },
    { id: "quadro", nome: "Quadro branco", url: "apps/quadro/", peso: 150, salvaSozinho: true },
    { id: "musica", nome: "Música", url: "apps/musica/", peso: 60, salvaSozinho: true },
    // Boxedwine: começa com 512 MB e cresce, mais o sistema do Wine (~220 MB)
    { id: "wine", nome: "Wine (teste)", url: "apps/wine/", peso: 950 },
    // cópia dos apps do InkDOS (inkdos/); suite=1 mostra o botão Home, que volta para a tela inicial
    { id: "documentos", nome: "Documentos", url: "inkdos/apps/documents/index.html?suite=1", peso: 200 },
    { id: "planilhas", nome: "Planilhas", url: "inkdos/apps/spreadsheets/index.html?suite=1", peso: 220 },
    { id: "apresentacoes", nome: "Apresentações", url: "inkdos/apps/presentations/index.html?suite=1", peso: 220 },
    { id: "pdf", nome: "PDF", url: "inkdos/apps/pdf/index.html?suite=1", peso: 250 },
    { id: "texto", nome: "Texto simples", url: "inkdos/apps/txt/index.html?suite=1", peso: 60 },
    { id: "epub", nome: "Leitor EPUB", url: "inkdos/apps/epub/index.html?suite=1", peso: 120 },
    // editores ONLYOFFICE (onlyoffice/), abertos pelo "Editar com ONLYOFFICE" dos apps do InkDOS
    { id: "office", nome: "ONLYOFFICE", url: "onlyoffice/editor.html", peso: 500, oculto: true },
    { id: "guardada", nome: "Página guardada", url: "inicio/guardada.html", peso: 0, oculto: true },
  ];
  function pesoDe(a) { return typeof a.peso === "function" ? a.peso() : a.peso || 0; }
  function caminho(u) { return new URL(u, RAIZ).pathname; }
  function appDe(id) { return APPS.filter(function (a) { return a.id === id; })[0]; }
  function appDaUrl(u) {
    var p = new URL(u, RAIZ).pathname, melhor = null;
    APPS.forEach(function (a) {
      var c = caminho(a.url).replace(/index\.html$/, "");
      if (p.indexOf(c) === 0 && (!melhor || c.length > caminho(melhor.url).replace(/index\.html$/, "").length)) melhor = a;
    });
    return melhor;
  }
  var INICIOS = [RAIZ, RAIZ + "index.html", RAIZ + "inkdos/", RAIZ + "inkdos/index.html"];
  function ehInicio(u) { return INICIOS.indexOf(String(u).split("#")[0].split("?")[0]) >= 0; }

  var guardarFn = null;
  var api = function (opcoes) { guardarFn = opcoes && opcoes.salvar; };
  api.aoGuardar = function (fn) { guardarFn = fn; anunciar(); };
  api.naMesa = false;
  window.inkGerenciador = api;
  window.INK_APPS = APPS;

  if (window.top !== window) return; // páginas dentro de um iframe do próprio app: o app de fora responde

  var CFG = "inkterminal-paginas-memoria";
  var LISTA = "inkterminal-paginas";
  var cfg = { limite: 2000, maxJanelas: 4 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG) || "{}")); } catch (_) {}

  var noInicio = ehInicio(location.href);
  var app = noInicio ? null : appDaUrl(location.href);
  var params = new URLSearchParams(location.search);
  var guardada = !!app && app.id === "guardada";
  var appReal = guardada ? appDe(params.get("app")) || null : app;
  if (!noInicio && !app) return;

  // um id por carregamento (o sessionStorage é copiado para as abas abertas por window.open)
  var aba = Math.random().toString(36).slice(2, 10);
  // o nome da janela é como a tela inicial acha a página de cada app (window.open("", nome))
  var nomeJanela = noInicio ? "inkterminal-inicio" : "inkterminal-" + (appReal ? appReal.id : "pagina");
  if (!noInicio && (appReal || app).id === "office") nomeJanela = /^inkterminal-office-/.test(window.name) ? window.name : "inkterminal-office-" + aba;
  if (!window.name || /^inkterminal-/.test(window.name)) window.name = nomeJanela;

  var canal = "BroadcastChannel" in window ? new BroadcastChannel("inkterminal-paginas") : null;
  var usadoEm = Date.now();
  var rascunhos = null; // InkDOSWorkSafety quando o app do InkDOS tem rascunhos ligados
  var saindo = false;

  function nomeAqui() {
    if (guardada) return (appReal ? appReal.nome : params.get("nome")) || "Página";
    if (app.id === "office") return "ONLYOFFICE · " + (params.get("ink-nome") || "documento");
    return app.nome;
  }
  function salvaAqui() { return guardada || !!(app.salvaSozinho || guardarFn || rascunhos); }

  function estado() {
    if (noInicio) return { aba: aba, inicio: true, janela: window.name };
    return {
      aba: aba, app: (appReal || app).id, nome: nomeAqui(), peso: guardada ? 0 : pesoDe(app), guardada: guardada,
      url: guardada ? decodeURIComponent(location.hash.slice(1)) : location.href, janela: window.name,
      visivel: document.visibilityState === "visible", usadoEm: usadoEm, salva: salvaAqui(), vistoEm: Date.now(),
    };
  }

  function lerLista() { try { return JSON.parse(localStorage.getItem(LISTA) || "{}") || {}; } catch (_) { return {}; } }
  function gravarLista(fn) {
    var l = lerLista();
    fn(l);
    // páginas sem notícia há mais de 6 h já foram fechadas pelo iPad
    Object.keys(l).forEach(function (k) { if (!l[k] || Date.now() - (l[k].vistoEm || 0) > 6 * 36e5) delete l[k]; });
    try { localStorage.setItem(LISTA, JSON.stringify(l)); } catch (_) {}
  }

  function anunciar() {
    if (noInicio || saindo) return;
    var e = estado();
    gravarLista(function (l) { l[aba] = e; });
    if (canal) canal.postMessage({ tipo: "estado", estado: e });
  }

  /* Pergunta às outras páginas como estão. As que não respondem (o iPad congela as abas em segundo
     plano) aparecem com o último estado conhecido e respondeu=false. */
  function listar(espera) {
    return new Promise(function (ok) {
      var vistos = {};
      function ouvir(ev) { var d = ev.data; if (d && d.tipo === "estado" && d.estado && d.estado.aba !== aba) vistos[d.estado.aba] = d.estado; }
      if (canal) { canal.addEventListener("message", ouvir); canal.postMessage({ tipo: "quem" }); }
      setTimeout(function () {
        if (canal) canal.removeEventListener("message", ouvir);
        var l = lerLista(), r = [];
        Object.keys(l).forEach(function (k) { if (k !== aba && !vistos[k]) r.push(Object.assign({}, l[k], { respondeu: false })); });
        Object.keys(vistos).forEach(function (k) { r.push(Object.assign({}, vistos[k], { respondeu: true })); });
        ok(r);
      }, espera || 600);
    });
  }

  /* Pede uma ação a outra página: "guardar" (sai da memória e pode voltar), "fechar".
     Resposta: "pronto", "manter" (com motivo) ou "sem-resposta". */
  function pedir(acao, alvo, forcar) {
    return new Promise(function (ok) {
      if (!canal) return ok({ r: "sem-resposta" });
      var id = Math.random().toString(36).slice(2), feito = false;
      function fim(v) { if (feito) return; feito = true; canal.removeEventListener("message", ouvir); ok(v); }
      function ouvir(ev) { var d = ev.data; if (d && d.tipo === "resposta" && d.id === id) fim({ r: d.r, motivo: d.motivo }); }
      canal.addEventListener("message", ouvir);
      canal.postMessage({ tipo: acao, alvo: alvo, id: id, forcar: !!forcar });
      // o terminal grava a máquina inteira (20 a 100 MB): até 20 s
      setTimeout(function () { fim({ r: "sem-resposta" }); }, 20000);
    });
  }

  /* Grava o estado desta página. "pronto" ou {manter: motivo}. */
  function gravar() {
    var p;
    if (rascunhos) {
      p = Promise.all(rascunhos._test.handles.map(function (h) { return Promise.resolve(h.snapshotNow()).catch(function () {}); })).then(function () { return "pronto"; });
    } else if (guardarFn) {
      p = Promise.resolve().then(function () { return guardarFn(); });
    } else p = Promise.resolve("pronto");
    return p.catch(function () { return "pronto"; }).then(function (r) {
      var manter = r === "manter" || (r && typeof r === "object" && r.manter);
      return manter ? { manter: typeof r.manter === "string" ? r.manter : (r && r.motivo) || "" } : "pronto";
    });
  }

  function sair(destino) {
    saindo = true;
    gravarLista(function (l) { delete l[aba]; });
    location.replace(destino);
  }

  function guardarAqui(forcar) {
    if (guardada) return Promise.resolve("pronto");
    return (forcar ? Promise.resolve("pronto") : gravar()).then(function (r) {
      if (r !== "pronto") return r;
      sair(RAIZ + "inicio/guardada.html?app=" + encodeURIComponent((appReal || app).id) + "&nome=" + encodeURIComponent(nomeAqui()) + "#" + encodeURIComponent(location.href));
      return "pronto";
    });
  }

  function fecharAqui(forcar) {
    return (forcar || guardada ? Promise.resolve("pronto") : gravar()).then(function (r) {
      if (r !== "pronto") return r;
      saindo = true;
      gravarLista(function (l) { delete l[aba]; });
      try { window.close(); } catch (_) {}
      // o navegador só deixa fechar abas abertas por script; nas outras, a página vira a tela inicial
      setTimeout(function () { if (!window.closed) location.replace(RAIZ); }, 300);
      return "pronto";
    });
  }

  if (canal) canal.addEventListener("message", function (ev) {
    var d = ev.data || {};
    if (d.tipo === "quem") { if (!noInicio && !saindo) canal.postMessage({ tipo: "estado", estado: estado(), resposta: true }); return; }
    // a tela inicial redesenha quando uma página muda sozinha (não nas respostas a um "quem")
    if (d.tipo === "estado" && !d.resposta && noInicio && window.InkPaginas.aoMudar) { window.InkPaginas.aoMudar(); return; }
    if (d.tipo === "tema") { aplicarTema(d.tema); return; }
    if ((d.tipo === "guardar" || d.tipo === "fechar") && d.alvo === aba && !noInicio) {
      (d.tipo === "guardar" ? guardarAqui(d.forcar) : fecharAqui(d.forcar)).then(function (r) {
        canal.postMessage({ tipo: "resposta", id: d.id, r: r === "pronto" ? "pronto" : "manter", motivo: r && r.manter });
      });
    }
  });

  function aplicarTema(t) {
    if (t !== "light" && t !== "dark") return;
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  }
  addEventListener("storage", function (e) {
    if (e.key === "inkterminal-tema") aplicarTema(e.newValue);
    if (e.key === LISTA && noInicio && window.InkPaginas.aoMudar) window.InkPaginas.aoMudar();
  });

  /* Abre um app: na página dele, se já estiver aberta (mesmo nome de janela), ou numa nova. */
  function abrirUrl(url, janela) {
    var w = null;
    try { w = window.open("", janela); } catch (_) {}
    if (!w) { location.href = url; return; } // o navegador bloqueou a página nova: abre nesta
    var atual = "";
    try { atual = w.location.href; } catch (_) {}
    if (!atual || atual === "about:blank" || /\/inicio\/guardada\.html/.test(atual)) w.location.replace(url);
    try { w.focus(); } catch (_) {}
  }
  function irParaInicio() {
    var w = null;
    try { w = window.open("", "inkterminal-inicio"); } catch (_) {}
    if (!w) { location.href = RAIZ; return; }
    var atual = "";
    try { atual = w.location.href; } catch (_) {}
    if (!ehInicio(atual)) w.location.replace(RAIZ);
    try { w.focus(); } catch (_) {}
  }

  /* ---------- Aviso de pouca memória (aparece na página que acabou de abrir) ---------- */
  var aviso = null;
  function mostrarAviso(paginas, falta) {
    if (aviso) aviso.remove();
    aviso = document.createElement("div");
    var raiz = aviso.attachShadow ? aviso.attachShadow({ mode: "open" }) : aviso;
    var escuro = document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    var css = document.createElement("style");
    css.textContent = ":host{all:initial}" +
      ".a{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + 14px);z-index:2147483647;width:min(460px,calc(100vw - 28px));box-sizing:border-box;" +
      "padding:14px;border-radius:14px;border:1px solid " + (escuro ? "#30363d" : "#d0d7de") + ";background:" + (escuro ? "#161b22" : "#fff") + ";color:" + (escuro ? "#e6edf3" : "#1f2328") + ";" +
      "font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      "b{display:block;font-size:15px;margin-bottom:4px}p{margin:0 0 10px;color:" + (escuro ? "#9da7b3" : "#59636e") + "}" +
      ".b{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}" +
      "button{font:inherit;font-size:14px;padding:7px 12px;border-radius:8px;cursor:pointer;border:1px solid " + (escuro ? "#30363d" : "#d0d7de") + ";background:" + (escuro ? "#252d37" : "#f0f2f5") + ";color:inherit}" +
      "button.p{background:#3fb950;border-color:#3fb950;color:#0d1117;font-weight:600}";
    var caixa = document.createElement("div");
    caixa.className = "a";
    caixa.setAttribute("role", "alertdialog");
    var t = document.createElement("b"); t.textContent = "Pouca memória";
    var p = document.createElement("p");
    p.textContent = (paginas.length === 1 ? "\"" + paginas[0].nome + "\" está aberto em outra página e não salva sozinho." :
      paginas.map(function (x) { return "\"" + x.nome + "\""; }).join(", ") + " estão abertos em outras páginas e não salvam sozinhos.") +
      (falta ? " Faltam ~" + falta + " MB para ficar dentro do limite." : " Há mais páginas abertas do que o limite.") + " Se não houver nada a salvar, guarde para liberar memória: o app volta com um toque, mas o que não foi salvo nele se perde.";
    var b = document.createElement("div"); b.className = "b";
    paginas.forEach(function (x) {
      var bt = document.createElement("button"); bt.className = "p"; bt.type = "button"; bt.textContent = "Guardar " + x.nome;
      bt.addEventListener("click", function () {
        bt.disabled = true; bt.textContent = "Guardando…";
        pedir("guardar", x.aba, true).then(function () { bt.remove(); if (!b.querySelector(".p")) fecharAviso(); });
      });
      b.appendChild(bt);
    });
    var nao = document.createElement("button"); nao.type = "button"; nao.textContent = "Agora não";
    nao.addEventListener("click", fecharAviso);
    b.appendChild(nao);
    caixa.appendChild(t); caixa.appendChild(p); caixa.appendChild(b);
    raiz.appendChild(css); raiz.appendChild(caixa);
    document.documentElement.appendChild(aviso);
  }
  function fecharAviso() { if (aviso) aviso.remove(); aviso = null; }

  /* Abre espaço para esta página: guarda as paradas há mais tempo, primeiro as que salvam sozinhas.
     As que não salvam sozinhas ficam no aviso, para a pessoa decidir. */
  function verificar() {
    if (noInicio || guardada) return;
    listar(800).then(function (outras) {
      var vivas = outras.filter(function (x) { return !x.inicio && !x.guardada && x.respondeu; });
      var meu = pesoDe(app);
      function soma() { return vivas.reduce(function (s, x) { return s + (x.peso || 0); }, meu); }
      function excede() { return soma() > cfg.limite || vivas.length + 1 > cfg.maxJanelas; }
      var candidatas = vivas.filter(function (x) { return !x.visivel; })
        .sort(function (a, b) { return (a.salva ? 0 : 1) - (b.salva ? 0 : 1) || a.usadoEm - b.usadoEm; });
      var perguntar = [];
      function passo() {
        if (!excede()) return Promise.resolve();
        var c = candidatas.shift();
        if (!c) return Promise.resolve();
        if (!c.salva) { perguntar.push(c); vivas.splice(vivas.indexOf(c), 1); return passo(); }
        return pedir("guardar", c.aba).then(function (r) {
          if (r.r === "pronto") vivas.splice(vivas.indexOf(c), 1);
          return passo();
        });
      }
      passo().then(function () {
        if (!perguntar.length) return;
        // as que não salvam sozinhas voltam para a conta: só são guardadas se a pessoa quiser
        vivas = vivas.concat(perguntar);
        var s = soma(), n = vivas.length + 1, escolhidas = [];
        perguntar.sort(function (a, b) { return a.usadoEm - b.usadoEm; }).forEach(function (x) {
          if (s > cfg.limite || n > cfg.maxJanelas) { escolhidas.push(x); s -= x.peso || 0; n--; }
        });
        if (!escolhidas.length) return;
        var falta = Math.max(soma() - cfg.limite, 0);
        mostrarAviso(escolhidas, falta);
      });
    });
  }

  if (!noInicio) {
    // o link para a tela inicial (barra do app, Home do InkDOS) vai para a página dela sem fechar esta
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a || !ehInicio(a.href) || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      irParaInicio();
    }, true);
    ["pointerdown", "keydown"].forEach(function (t) { addEventListener(t, function () { usadoEm = Date.now(); }, true); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") usadoEm = Date.now();
      anunciar();
    });
    addEventListener("pagehide", function () { if (!saindo) gravarLista(function (l) { delete l[aba]; }); });
    addEventListener("pageshow", function (e) { if (e.persisted) { saindo = false; anunciar(); } });
    // páginas congeladas não respondem: o "visto em" da lista mostra quais estavam vivas
    setInterval(function () { if (document.visibilityState === "visible") anunciar(); }, 15000);
    function iniciar() {
      // Os apps do InkDOS guardam rascunhos de recuperação (inkdos/shared/work-safety.js). Com eles
      // ligados, a página pode sair da memória sem perguntar: antes, grava o rascunho, e o InkDOS
      // oferece "Recuperar" quando o app abre de novo.
      try {
        var ws = window.InkDOSWorkSafety;
        if (ws && ws.draftsEnabled && ws.draftsMode !== "password" && ws._test && ws._test.handles) rascunhos = ws;
      } catch (_) {}
      anunciar();
      verificar();
    }
    anunciar();
    if (document.readyState === "complete") setTimeout(receber, 400);
    else addEventListener("load", function () { setTimeout(receber, 400); });
    if (document.readyState === "complete") setTimeout(iniciar, 1500);
    else addEventListener("load", function () { setTimeout(iniciar, 1500); });
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

  /* Usado pela tela inicial (inicio/inicio.js) e pelos apps do InkDOS (editor ONLYOFFICE). */
  window.InkPaginas = {
    raiz: RAIZ,
    cfg: cfg,
    apps: APPS,
    peso: pesoDe,
    aba: aba,
    aoMudar: null,
    definir: function (nome, valor) {
      cfg[nome] = Number(valor);
      try { localStorage.setItem(CFG, JSON.stringify(cfg)); } catch (_) {}
      if (this.aoMudar) this.aoMudar();
    },
    listar: listar,
    pedir: pedir,
    abrir: function (id) { var a = appDe(id); if (a) abrirUrl(new URL(a.url, RAIZ).href, "inkterminal-" + id); },
    focar: function (p) { abrirUrl(p.url, p.janela || "inkterminal-" + p.app); },
    esquecer: function (abaId) { gravarLista(function (l) { delete l[abaId]; }); },
    tema: function (t) { if (canal) canal.postMessage({ tipo: "tema", tema: t }); },
    /* O app do InkDOS guardou o documento no IndexedDB "inkdos-tool-handoff" (veja
       tools/adaptar_inkdos.py). win: a página aberta no toque, antes de ler o documento. */
    abrirEditor: function (info, win) {
      var url = new URL("onlyoffice/editor.html?embed=1&embedOrigin=" + encodeURIComponent(location.origin) +
        "&inkdos-handoff=" + encodeURIComponent(info.id) + (info.locale ? "&locale=" + encodeURIComponent(info.locale) : "") +
        "&ink-nome=" + encodeURIComponent(String(info.nome || "documento").slice(0, 80)), RAIZ).href;
      if (win && !win.closed) {
        try { win.name = "inkterminal-office-" + String(info.id).slice(0, 8); } catch (_) {}
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
