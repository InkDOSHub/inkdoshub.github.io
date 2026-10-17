/* Tela inicial do InkTerminal: os cartões abrem as ferramentas em tela cheia dentro desta página.

   Ao voltar para a tela inicial (botão "InkTerminal" da barra do app, ou o gesto de voltar do
   Safari), o app continua carregado e aparece em "Abertos". O gerenciador de memória
   (gerenciador.js) mantém a soma estimada abaixo do limite: quando falta espaço, o app parado há
   mais tempo é guardado e sai da memória. Ele volta quando é tocado.

   Cada app roda num iframe do próprio site. O iframe nunca muda de lugar no DOM (isso recarregaria
   o app); só o display muda. */
(function () {
  "use strict";
  var G = window.InkGerenciador;
  var $ = function (id) { return document.getElementById(id); };
  var telas = $("telas");
  var SESSAO = "inkterminal-inicio";
  var TITULO = document.title;
  var RAIZ = new URL("./", location.href).href;
  // endereços que voltam para esta tela: a raiz e a tela inicial do InkDOS copiado (botão Home dele)
  var INICIOS = [RAIZ, RAIZ + "index.html", RAIZ + "inkdos/", RAIZ + "inkdos/index.html"];
  function ehInicio(u) { return INICIOS.indexOf(u.split("#")[0].split("?")[0]) >= 0; }
  var lista = [];
  var ativo = null;

  G.janelas = function () { return lista; };

  function app(id) { return window.INK_APPS.filter(function (a) { return a.id === id; })[0]; }
  function aberto(id) { return lista.filter(function (j) { return j.app.id === id; })[0]; }
  function icone(id) {
    var s = document.querySelector('[data-app="' + id + '"] .app-icon svg');
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (s ? s.innerHTML : "") + "</svg>";
  }

  function salvarSessao() {
    try {
      localStorage.setItem(SESSAO, JSON.stringify({ abertos: lista.map(function (j) { return j.app.id; }), ativo: ativo ? ativo.app.id : null }));
    } catch (_) {}
  }

  function Aberto(a) {
    this.app = a;
    this.carregada = false;
    this.suportaAviso = false;
    this.rascunhosInkdos = null;
    this.guardando = false;
    this.usadoEm = Date.now();
    this.el = document.createElement("div");
    this.el.className = "tela";
    this.el.hidden = true;
    telas.appendChild(this.el);
  }

  Aberto.prototype.carregar = function () {
    var j = this;
    if (j.carregada) return;
    var f = document.createElement("iframe");
    f.title = j.app.nome;
    f.allow = "clipboard-read; clipboard-write; fullscreen; autoplay";
    f.addEventListener("load", function () { ajustar(j, f); });
    f.src = j.app.url;
    j.iframe = f;
    j.suportaAviso = false;
    j.el.appendChild(f);
    j.carregada = true;
  };

  Aberto.prototype.descarregar = function () {
    var j = this;
    if (!j.carregada) return;
    // about:blank antes de remover ajuda o WebKit a soltar a memória do documento
    try { j.iframe.src = "about:blank"; } catch (_) {}
    j.iframe.remove();
    j.iframe = null;
    j.carregada = false;
    j.suportaAviso = false;
    j.rascunhosInkdos = null;
    // um app guardado enquanto aparece na tela volta para a tela inicial
    if (ativo === j) esconder();
  };

  function remover(j) {
    j.descarregar();
    j.el.remove();
    lista.splice(lista.indexOf(j), 1);
    if (ativo === j) esconder();
    salvarSessao();
    G.aoMudar();
  }

  function mostrar(j, semHistorico) {
    ativo = j;
    j.usadoEm = Date.now();
    lista.forEach(function (x) { x.el.hidden = x !== j; });
    telas.hidden = false;
    document.body.classList.add("com-app");
    document.title = j.app.nome + " · InkTerminal";
    fecharPaineis();
    if (!semHistorico && location.hash !== "#" + j.app.id) history.pushState({ app: j.app.id }, "", "#" + j.app.id);
    if (!j.carregada) {
      G.abrirEspaco(j).then(function () {
        if (lista.indexOf(j) >= 0 && !j.carregada) j.carregar();
        G.aoMudar();
      });
    }
    salvarSessao();
    G.aoMudar();
  }

  function esconder() {
    ativo = null;
    lista.forEach(function (x) { x.el.hidden = true; });
    telas.hidden = true;
    document.body.classList.remove("com-app");
    document.title = TITULO;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    salvarSessao();
    G.aoMudar();
  }

  /* Volta para a tela inicial pelo histórico quando dá, para o gesto de voltar do Safari continuar certo. */
  function voltarInicio() {
    if (history.state && history.state.app) history.back();
    else esconder();
  }

  function abrir(id, semHistorico) {
    var a = app(id);
    if (!a) return;
    var j = aberto(id);
    if (!j) { j = new Aberto(a); lista.push(j); }
    mostrar(j, semHistorico);
  }

  function fechar(j) {
    if (!j.carregada) { remover(j); return; }
    function confirmar(texto) {
      return G.perguntar("Fechar " + j.app.nome + "?", texto,
        [{ id: "sim", texto: "Fechar" }, { id: "nao", texto: "Cancelar", secundario: true }]);
    }
    if (j.suportaAviso) {
      // o app guarda o que puder; se ele pedir para ficar aberto, a pessoa decide
      j.guardando = true; G.aoMudar();
      G.avisar(j).then(function (resp) {
        j.guardando = false; G.aoMudar();
        if (resp !== "manter") { remover(j); return; }
        confirmar((j.motivoManter ? j.motivoManter + " " : "") + "Fechar agora pode perder o que está aberto nele.")
          .then(function (r) { if (r === "sim") remover(j); });
      });
    } else if (!j.app.salvaSozinho) {
      confirmar("Se houver algo não salvo nele, salve antes de fechar.").then(function (r) { if (r === "sim") remover(j); });
    } else remover(j);
  }

  /* Depois de cada carregamento do app: o botão "InkTerminal" da barra dele volta para esta tela
     (sem descarregar o app), e um app que navegou para a própria tela inicial é fechado. */
  function ajustar(j, f) {
    var doc, win;
    j.rascunhosInkdos = null;
    try { doc = f.contentDocument; win = f.contentWindow; } catch (_) { return; }
    if (!doc || !doc.documentElement || !win) return;
    var url = "";
    try { url = win.location.href; } catch (_) {}
    if (ehInicio(url)) {
      remover(j);
      return;
    }
    doc.addEventListener("click", function (e) {
      var a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      if (!ehInicio(a.href)) return;
      // o app continua aberto: o clique não chega aos handlers dele (alguns navegariam para fora)
      e.preventDefault();
      e.stopPropagation();
      voltarInicio();
    }, true);
    try { win.addEventListener("pointerdown", function () { j.usadoEm = Date.now(); }, true); } catch (_) {}
    // Os apps do InkDOS guardam rascunhos de recuperação (inkdos/shared/work-safety.js). Com eles
    // ligados, o app pode sair da memória sem perguntar: antes, a tela inicial grava o rascunho, e o
    // InkDOS oferece "Recuperar" quando o app abre de novo.
    setTimeout(function () {
      try {
        var ws = win.InkDOSWorkSafety;
        if (ws && ws.draftsEnabled && ws.draftsMode !== "password" && ws._test && ws._test.handles) { j.rascunhosInkdos = ws; j.suportaAviso = true; G.aoMudar(); }
      } catch (_) {}
    }, 1500);
  }

  var avisarOriginal = G.avisar;
  G.avisar = function (j) {
    if (!j.rascunhosInkdos) return avisarOriginal(j);
    var ws = j.rascunhosInkdos;
    return Promise.all(ws._test.handles.map(function (h) { return Promise.resolve(h.snapshotNow()).catch(function () {}); }))
      .then(function () { return "pronto"; }, function () { return "sem-resposta"; });
  };

  addEventListener("popstate", function () {
    var id = location.hash.slice(1);
    if (aberto(id)) mostrar(aberto(id), true);
    else if (app(id)) abrir(id, true);
    else esconder();
  });

  // Cartões
  Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (c) {
    c.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      abrir(c.dataset.app);
    });
  });

  // Apps abertos
  function desenharAbertos() {
    var sec = $("abertos"), el = $("abertos-lista");
    sec.hidden = !lista.length;
    el.innerHTML = "";
    lista.forEach(function (j) {
      var d = document.createElement("div");
      d.className = "aberto " + j.app.id + (j.carregada ? "" : " guardado");
      d.innerHTML = '<button type="button" class="abrir">' + icone(j.app.id) + '<span class="nome"></span><span class="estado"></span></button>' +
        '<button type="button" class="fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
      d.querySelector(".nome").textContent = j.app.nome;
      d.querySelector(".estado").textContent = j.guardando ? "guardando…" : j.carregada ? "" : "guardado";
      d.querySelector(".fechar").title = "Fechar " + j.app.nome;
      d.querySelector(".abrir").addEventListener("click", function () { mostrar(j); });
      d.querySelector(".fechar").addEventListener("click", function () { fechar(j); });
      el.appendChild(d);
    });
  }

  // Painéis do topo
  var paineis = { "btn-memoria": $("painel-memoria"), "btn-offline": $("painel-offline") };
  function fecharPaineis(exceto) {
    Object.keys(paineis).forEach(function (b) {
      if (paineis[b] !== exceto) { paineis[b].hidden = true; $(b).setAttribute("aria-expanded", "false"); }
    });
  }
  Object.keys(paineis).forEach(function (b) {
    $(b).addEventListener("click", function (e) {
      e.stopPropagation();
      var p = paineis[b], abrirP = p.hidden;
      fecharPaineis(p);
      p.hidden = !abrirP;
      $(b).setAttribute("aria-expanded", String(abrirP));
      if (abrirP && b === "btn-offline" && window.InkOffline) InkOffline.atualizar();
    });
    paineis[b].addEventListener("click", function (e) { e.stopPropagation(); });
  });
  document.addEventListener("click", function () { fecharPaineis(); });

  // Tema: troca aqui e nos apps abertos sem recarregar, para não perder o que está aberto neles
  $("tema").addEventListener("click", function () {
    var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("inkterminal-tema", n); } catch (_) {}
    [document].concat(lista.map(function (j) { try { return j.iframe && j.iframe.contentDocument; } catch (_) { return null; } }))
      .forEach(function (d) { if (d && d.documentElement) { d.documentElement.dataset.theme = n; d.documentElement.style.colorScheme = n; } });
  });

  // Diálogo próprio (os alertas do Safari travam a página e não combinam com o visual)
  G.perguntar = function (titulo, texto, opcoes) {
    return new Promise(function (ok) {
      var fundo = $("dialogo"), acoes = $("dialogo-acoes");
      $("dialogo-titulo").textContent = titulo;
      $("dialogo-texto").textContent = texto;
      acoes.innerHTML = "";
      opcoes.forEach(function (o) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "botao" + (o.secundario ? " secundario" : "");
        b.textContent = o.texto;
        b.addEventListener("click", function () { fundo.hidden = true; ok(o.id); });
        acoes.appendChild(b);
      });
      fundo.hidden = false;
      acoes.firstChild.focus();
    });
  };

  // Memória (botões em vez de <select>, que o XeOS redesenha)
  Array.prototype.forEach.call(document.querySelectorAll(".opcoes"), function (grupo) {
    grupo.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      G.definir(grupo.dataset.nome, b.value);
    });
  });

  function textoMb(v) { return v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",").replace(",0", "") + " GB" : v + " MB"; }

  G.aoMudar = function () {
    var uso = G.emUso(), lim = G.cfg.limite;
    $("memoria-texto").textContent = uso + " MB / " + textoMb(lim);
    var barra = $("medidor-barra");
    barra.style.width = Math.min(100, Math.round(uso / lim * 100)) + "%";
    barra.className = uso > lim ? "cheio" : uso > lim * 0.8 ? "quase" : "";
    Array.prototype.forEach.call(document.querySelectorAll(".opcoes"), function (grupo) {
      Array.prototype.forEach.call(grupo.children, function (b) {
        b.setAttribute("aria-pressed", String(Number(b.value) === Number(G.cfg[grupo.dataset.nome])));
      });
    });
    var ul = $("lista-memoria");
    ul.innerHTML = "";
    if (!lista.length) ul.innerHTML = "<li><span>Nenhum app aberto.</span></li>";
    lista.slice().sort(function (a, b) { return b.usadoEm - a.usadoEm; }).forEach(function (j) {
      var li = document.createElement("li");
      li.innerHTML = "<span></span><small></small>";
      li.firstChild.textContent = j.app.nome;
      li.lastChild.textContent = j.guardando ? "guardando…" : j.carregada ? "carregado, ~" + G.peso(j.app) + " MB" + (G.podeSairSemPerguntar(j) ? ", salva sozinho" : "") : "guardado, 0 MB";
      if (j.carregada) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "botao secundario pequeno";
        b.textContent = "Guardar";
        b.addEventListener("click", function () { G.suspender(j, true); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
    desenharAbertos();
  };

  // Antes de sair do site com um app que não salva sozinho carregado, o navegador pergunta
  addEventListener("beforeunload", function (e) {
    if (lista.some(function (j) { return j.carregada && !j.app.salvaSozinho; })) { e.preventDefault(); e.returnValue = ""; }
  });

  // Sessão: depois de uma queda da aba, os apps voltam guardados; só o que estava na tela carrega
  var dados = {};
  try { dados = JSON.parse(localStorage.getItem(SESSAO) || "{}") || {}; } catch (_) {}
  (dados.abertos || []).forEach(function (id) { var a = app(id); if (a && !aberto(id)) lista.push(new Aberto(a)); });
  var pedido = location.hash.slice(1);
  if (app(pedido)) {
    // a entrada da tela inicial fica antes no histórico, para o gesto de voltar levar até ela
    history.replaceState(null, "", location.pathname + location.search);
    abrir(pedido);
  } else {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    G.aoMudar();
  }
})();
