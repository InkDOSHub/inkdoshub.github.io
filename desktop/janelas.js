/* Janelas da área de trabalho: cada app roda num iframe do próprio InkTerminal.
   O iframe nunca muda de lugar no DOM (mudar recarregaria a página); a ordem é feita com z-index. */
(function () {
  "use strict";
  var G = window.InkGerenciador;
  var mesa = document.getElementById("mesa");
  var tarefas = document.getElementById("tarefas");
  var SESSAO = "inkterminal-desktop";
  var lista = [];
  var topoZ = 10;
  var seq = 0;
  var estreito = function () { return innerWidth < 760; };

  G.janelas = function () { return lista; };

  function app(id) { return window.INK_APPS.filter(function (a) { return a.id === id; })[0]; }

  function salvarSessao() {
    var dados = lista.map(function (j) {
      return { app: j.app.id, x: j.x, y: j.y, w: j.w, h: j.h, max: j.maximizada, min: j.minimizada, foco: j === focada() };
    });
    try { localStorage.setItem(SESSAO, JSON.stringify(dados)); } catch (_) {}
  }

  function focada() {
    var vis = lista.filter(function (j) { return !j.minimizada; });
    vis.sort(function (a, b) { return b.z - a.z; });
    return vis[0] || null;
  }

  function Janela(a, geo) {
    var j = this;
    j.id = "j" + (++seq);
    j.app = a;
    j.carregada = false;
    j.suportaAviso = false;
    j.usadoEm = Date.now();
    var n = lista.length;
    var W = mesa.clientWidth, H = mesa.clientHeight;
    j.w = geo && geo.w || Math.min(980, Math.max(420, W * 0.7));
    j.h = geo && geo.h || Math.min(720, Math.max(320, H * 0.78));
    j.x = geo && geo.x != null ? geo.x : Math.max(0, Math.min(W - j.w, 40 + n * 28));
    j.y = geo && geo.y != null ? geo.y : Math.max(0, Math.min(H - j.h, 16 + n * 28));
    j.maximizada = geo ? !!geo.max : estreito();
    j.minimizada = geo ? !!geo.min : false;
    j.z = ++topoZ;

    var el = document.createElement("section");
    el.className = "janela";
    el.setAttribute("aria-label", a.nome);
    el.innerHTML =
      '<header class="janela-barra">' +
        '<span class="janela-icone">' + inkSvg(a.icone) + "</span>" +
        '<span class="janela-titulo"></span>' +
        '<span class="janela-estado"></span>' +
        '<button type="button" class="jb" data-acao="min" title="Minimizar" aria-label="Minimizar">' + inkSvg('<path d="M5 12h14"/>') + "</button>" +
        '<button type="button" class="jb" data-acao="max" title="Maximizar" aria-label="Maximizar">' + inkSvg('<rect x="5" y="5" width="14" height="14" rx="1.5"/>') + "</button>" +
        '<button type="button" class="jb fechar" data-acao="fechar" title="Fechar" aria-label="Fechar">' + inkSvg('<path d="M18 6 6 18M6 6l12 12"/>') + "</button>" +
      "</header>" +
      '<div class="janela-corpo"><div class="suspensa" hidden>' +
        '<p><strong>Janela guardada para liberar memória.</strong><br>Toque para abrir de novo.</p>' +
        '<button type="button" class="botao" data-acao="carregar">Abrir de novo</button></div></div>' +
      '<div class="alca" aria-hidden="true"></div>';
    el.querySelector(".janela-titulo").textContent = a.nome;
    j.el = el;
    j.corpo = el.querySelector(".janela-corpo");
    j.aviso = el.querySelector(".suspensa");
    mesa.appendChild(el);

    var tb = document.createElement("button");
    tb.type = "button";
    tb.className = "tarefa";
    tb.innerHTML = inkSvg(a.icone) + "<span></span>";
    tb.querySelector("span").textContent = a.nome;
    tb.addEventListener("click", function () {
      if (focada() === j && !j.minimizada) j.minimizar(); else j.focar();
    });
    j.tb = tb;
    tarefas.appendChild(tb);

    el.addEventListener("pointerdown", function () { if (focada() !== j) j.focar(); }, true);
    el.querySelector(".janela-barra").addEventListener("click", function (e) {
      var b = e.target.closest("[data-acao]"); if (!b) return;
      var acao = b.dataset.acao;
      if (acao === "min") j.minimizar();
      else if (acao === "max") { j.maximizada = !j.maximizada; j.desenhar(); salvarSessao(); }
      else if (acao === "fechar") j.fechar();
    });
    el.querySelector(".janela-barra").addEventListener("dblclick", function (e) {
      if (e.target.closest("[data-acao]")) return;
      j.maximizada = !j.maximizada; j.desenhar(); salvarSessao();
    });
    j.aviso.querySelector("[data-acao=carregar]").addEventListener("click", function () { j.focar(); });
    arrastar(j, el.querySelector(".janela-barra"), "mover");
    arrastar(j, el.querySelector(".alca"), "tamanho");
    j.desenhar();
  }

  Janela.prototype.desenhar = function () {
    var j = this, s = j.el.style;
    var max = j.maximizada || estreito();
    j.el.classList.toggle("maximizada", max);
    j.el.classList.toggle("minimizada", j.minimizada);
    j.el.classList.toggle("em-foco", focada() === j);
    if (!max) { s.left = j.x + "px"; s.top = j.y + "px"; s.width = j.w + "px"; s.height = j.h + "px"; }
    else { s.left = s.top = "0"; s.width = s.height = ""; }
    s.zIndex = j.z;
    j.aviso.hidden = j.carregada;
    j.el.querySelector(".janela-estado").textContent = j.carregada ? "" : "guardada";
    j.tb.classList.toggle("ativa", focada() === j && !j.minimizada);
    j.tb.classList.toggle("guardada", !j.carregada);
  };

  Janela.prototype.carregar = function () {
    var j = this;
    if (j.carregada) return;
    var f = document.createElement("iframe");
    f.title = j.app.nome;
    f.allow = "clipboard-read; clipboard-write; fullscreen; autoplay";
    f.addEventListener("load", function () { ajustarDentro(j, f); });
    f.src = j.app.url;
    j.iframe = f;
    j.suportaAviso = false;
    j.corpo.appendChild(f);
    j.carregada = true;
    j.desenhar();
  };

  Janela.prototype.descarregar = function () {
    var j = this;
    if (!j.carregada) return;
    // about:blank antes de remover ajuda o WebKit a soltar a memória do documento.
    try { j.iframe.src = "about:blank"; } catch (_) {}
    j.iframe.remove();
    j.iframe = null;
    j.carregada = false;
    j.suportaAviso = false;
    j.desenhar();
  };

  Janela.prototype.focar = function () {
    var j = this;
    j.minimizada = false;
    j.z = ++topoZ;
    j.usadoEm = Date.now();
    redesenharTudo();
    if (!j.carregada) {
      G.abrirEspaco(j).then(function () { j.carregar(); G.aoMudar(); salvarSessao(); });
    } else salvarSessao();
    G.aoMudar();
  };

  Janela.prototype.minimizar = function () {
    this.minimizada = true;
    redesenharTudo();
    salvarSessao();
  };

  Janela.prototype.fechar = function () {
    var j = this;
    function remover() {
      j.descarregar();
      j.el.remove();
      j.tb.remove();
      lista.splice(lista.indexOf(j), 1);
      var f = focada(); if (f) f.focar();
      redesenharTudo();
      salvarSessao();
      G.aoMudar();
    }
    if (!j.carregada) { remover(); return; }
    function confirmar(texto) {
      if (!G.perguntar) return Promise.resolve("sim");
      return G.perguntar("Fechar " + j.app.nome + "?", texto,
        [{ id: "sim", texto: "Fechar" }, { id: "nao", texto: "Cancelar", secundario: true }]);
    }
    if (j.suportaAviso) {
      // o app guarda o que puder; se ele pedir para ficar aberto, a pessoa decide
      G.avisar(j).then(function (resp) {
        if (resp !== "manter") { remover(); return; }
        confirmar((j.motivoManter ? j.motivoManter + " " : "") + "Fechar agora pode perder o que está aberto nele.")
          .then(function (r) { if (r === "sim") remover(); });
      });
    } else if (!j.app.salvaSozinho) {
      confirmar("Se houver algo não salvo nesta janela, salve antes de fechar.").then(function (r) { if (r === "sim") remover(); });
    } else remover();
  };

  /* Dentro da área de trabalho, o botão "InkTerminal" das barras dos apps volta para a mesa
     em vez de abrir a tela inicial dentro da janela. */
  function ajustarDentro(j, f) {
    var doc;
    try { doc = f.contentDocument; } catch (_) { return; }
    if (!doc || !doc.documentElement) return;
    var caminho = "";
    try { caminho = f.contentWindow.location.pathname; } catch (_) {}
    if (/\/(index\.html)?$/.test(caminho) && !/\/(apps|terminal|desktop)\//.test(caminho)) {
      // o app navegou para a tela inicial: fecha a janela sem perguntar, não há nada a perder ali
      j.descarregar(); j.el.remove(); j.tb.remove(); lista.splice(lista.indexOf(j), 1);
      redesenharTudo(); salvarSessao(); G.aoMudar();
      return;
    }
    doc.documentElement.classList.add("ink-na-mesa");
    if (!doc.getElementById("ink-na-mesa")) {
      var st = doc.createElement("style");
      st.id = "ink-na-mesa";
      st.textContent = ".ink-bar a.ink-home{display:none!important}";
      (doc.head || doc.documentElement).appendChild(st);
    }
    try { f.contentWindow.addEventListener("pointerdown", function () { if (focada() !== j) j.focar(); }, true); } catch (_) {}
  }

  function arrastar(j, alvo, modo) {
    var ini = null;
    alvo.addEventListener("pointerdown", function (e) {
      if (e.target.closest("[data-acao]")) return;
      if (j.maximizada || estreito()) return;
      ini = { px: e.clientX, py: e.clientY, x: j.x, y: j.y, w: j.w, h: j.h };
      alvo.setPointerCapture(e.pointerId);
      document.body.classList.add("arrastando");
      e.preventDefault();
    });
    alvo.addEventListener("pointermove", function (e) {
      if (!ini) return;
      var dx = e.clientX - ini.px, dy = e.clientY - ini.py;
      var W = mesa.clientWidth, H = mesa.clientHeight;
      if (modo === "mover") {
        j.x = Math.min(Math.max(ini.x + dx, -j.w + 80), W - 80);
        j.y = Math.min(Math.max(ini.y + dy, 0), H - 40);
      } else {
        j.w = Math.max(320, Math.min(ini.w + dx, W - j.x));
        j.h = Math.max(220, Math.min(ini.h + dy, H - j.y));
      }
      j.desenhar();
    });
    function fim() {
      if (!ini) return;
      ini = null;
      document.body.classList.remove("arrastando");
      salvarSessao();
    }
    alvo.addEventListener("pointerup", fim);
    alvo.addEventListener("pointercancel", fim);
  }

  function redesenharTudo() { lista.forEach(function (j) { j.desenhar(); }); }
  addEventListener("resize", redesenharTudo);

  window.InkJanelas = {
    abrir: function (id) {
      var a = app(id);
      if (!a) return;
      if (a.externo) { open(a.url, "_blank", "noopener"); return; }
      var ja = lista.filter(function (j) { return j.app.id === id; })[0];
      if (ja) { ja.focar(); return; }
      var j = new Janela(a);
      lista.push(j);
      j.focar();
    },
    restaurar: function () {
      var dados = [];
      try { dados = JSON.parse(localStorage.getItem(SESSAO) || "[]"); } catch (_) {}
      var foco = null;
      dados.forEach(function (d) {
        var a = app(d.app);
        if (!a || a.externo) return;
        var j = new Janela(a, d);
        lista.push(j);
        if (d.foco) foco = j;
      });
      // Depois de uma queda da aba, só a janela em foco carrega; as outras esperam um toque.
      if (foco) foco.focar();
      redesenharTudo();
      G.aoMudar();
    },
    focada: focada,
  };
})();
