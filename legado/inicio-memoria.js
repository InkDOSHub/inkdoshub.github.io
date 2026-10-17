/* Tela inicial do InkTerminal: cada cartão abre a ferramenta na própria página (aba ou janela),
   carregada só quando é pedida. Tocar de novo num app já aberto volta para a página dele.

   "Abertos" e o painel de memória mostram as páginas abertas, que se conhecem por
   assets/gerenciador-app.js. Ele mantém a soma estimada abaixo do limite: quando uma página nova
   abre e falta espaço, a página parada há mais tempo é guardada (sai da memória e volta com um
   toque). As que não salvam sozinhas só são guardadas depois de a pessoa confirmar. */
(function () {
  "use strict";
  var P = window.InkPaginas;
  var $ = function (id) { return document.getElementById(id); };
  var paginas = [];

  function icone(id) {
    var s = document.querySelector('[data-app="' + id + '"] .app-icon svg') ||
      (id === "office" ? document.querySelector('[data-app="documentos"] .app-icon svg') : null) ||
      (id === "videoeditor" ? document.querySelector('[data-app="video"] .app-icon svg') : null);
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (s ? s.innerHTML : "") + "</svg>";
  }
  function textoMb(v) { return v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",").replace(",0", "") + " GB" : v + " MB"; }
  function situacao(p) {
    if (p.guardando) return "guardando…";
    if (p.guardada) return "guardado";
    if (!p.respondeu) return "em segundo plano";
    return "";
  }

  // Cartões
  Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (c) {
    c.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      P.abrir(c.dataset.app);
    });
  });

  // Diálogo próprio (os alertas do Safari travam a página e não combinam com o visual)
  function perguntar(titulo, texto, opcoes) {
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
  }

  /* Guardar (sai da memória, volta com um toque) ou fechar a página de um app. */
  function agir(p, acao) {
    if (!p.respondeu && !p.guardada) {
      // a página está congelada pelo iPad: o pedido fica na fila dela; na lista, some agora
      if (acao === "fechar") { P.pedir("fechar", p.aba, false); P.esquecer(p.aba); atualizar(); }
      return;
    }
    var pergunta = Promise.resolve("sim");
    if (!p.salva && !p.guardada) {
      pergunta = perguntar((acao === "fechar" ? "Fechar " : "Guardar ") + p.nome + "?",
        "Este app não salva sozinho. Se houver algo não salvo nele, salve antes." +
        (acao === "guardar" ? " Ele continua na lista e volta ao ser tocado." : ""),
        [{ id: "sim", texto: acao === "fechar" ? "Fechar" : "Guardar" }, { id: "nao", texto: "Cancelar", secundario: true }]);
    }
    pergunta.then(function (r) {
      if (r !== "sim") return;
      p.guardando = true; desenhar();
      P.pedir(acao, p.aba, !p.salva).then(function (resp) {
        p.guardando = false;
        if (resp.r === "manter") {
          perguntar(p.nome + " precisa ficar aberto", (resp.motivo || "O app pediu para não ser fechado agora.") +
            " Abra a página dele para terminar.", [{ id: "ok", texto: "OK" }]);
        }
        if (acao === "fechar" && resp.r === "pronto") P.esquecer(p.aba);
        atualizar();
      });
    });
  }

  function desenhar() {
    var lista = paginas.slice().sort(function (a, b) { return b.usadoEm - a.usadoEm; });
    // Abertos
    var sec = $("abertos"), el = $("abertos-lista");
    sec.hidden = !lista.length;
    el.innerHTML = "";
    lista.forEach(function (p) {
      var d = document.createElement("div");
      d.className = "aberto " + p.app + (p.guardada ? " guardado" : "");
      d.innerHTML = '<button type="button" class="abrir">' + icone(p.app) + '<span class="nome"></span><span class="estado"></span></button>' +
        '<button type="button" class="fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
      d.querySelector(".nome").textContent = p.nome;
      d.querySelector(".estado").textContent = situacao(p);
      d.querySelector(".fechar").title = "Fechar " + p.nome;
      d.querySelector(".abrir").addEventListener("click", function () { P.focar(p); });
      d.querySelector(".fechar").addEventListener("click", function () { agir(p, "fechar"); });
      el.appendChild(d);
    });

    // Memória
    // só contam as páginas que responderam: as em segundo plano o iPad já pausou ou fechou
    var vivas = paginas.filter(function (p) { return !p.guardada && p.respondeu; });
    var uso = vivas.reduce(function (s, p) { return s + (p.peso || 0); }, 0), lim = P.cfg.limite;
    var carregadas = vivas.length;
    $("memoria-texto").textContent = textoMb(uso) + " / " + textoMb(lim);
    var barra = $("medidor-barra");
    barra.style.width = Math.min(100, Math.round(uso / lim * 100)) + "%";
    barra.className = uso > lim || carregadas > P.cfg.maxJanelas ? "cheio" : uso > lim * 0.8 ? "quase" : "";
    Array.prototype.forEach.call(document.querySelectorAll(".opcoes"), function (grupo) {
      Array.prototype.forEach.call(grupo.children, function (b) {
        b.setAttribute("aria-pressed", String(Number(b.value) === Number(P.cfg[grupo.dataset.nome])));
      });
    });
    var ul = $("lista-memoria");
    ul.innerHTML = "";
    if (!lista.length) ul.innerHTML = "<li><span>Nenhuma página aberta.</span></li>";
    lista.forEach(function (p) {
      var li = document.createElement("li");
      li.innerHTML = "<span></span><small></small>";
      li.firstChild.textContent = p.nome;
      li.lastChild.textContent = p.guardando ? "guardando…" : p.guardada ? "guardado, 0 MB" :
        (p.respondeu ? "~" + p.peso + " MB" + (p.salva ? ", salva sozinho" : "") : "em segundo plano, não conta");
      if (!p.guardada && p.respondeu && !p.guardando) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "botao secundario pequeno";
        b.textContent = "Guardar";
        b.addEventListener("click", function () { agir(p, "guardar"); });
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
  }

  var pedindo = false, deNovo = false;
  function atualizar() {
    if (pedindo) { deNovo = true; return; }
    pedindo = true;
    P.listar(500).then(function (l) {
      pedindo = false;
      var guardando = {};
      paginas.forEach(function (p) { if (p.guardando) guardando[p.aba] = true; });
      paginas = l.filter(function (p) { return !p.inicio && p.app; });
      paginas.forEach(function (p) { if (guardando[p.aba]) p.guardando = true; });
      desenhar();
      if (deNovo) { deNovo = false; atualizar(); }
    });
  }
  var espera = null;
  P.aoMudar = function () { clearTimeout(espera); espera = setTimeout(atualizar, 150); };
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") atualizar(); });
  addEventListener("focus", atualizar);

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
      if (abrirP && b === "btn-memoria") atualizar();
    });
    paineis[b].addEventListener("click", function (e) { e.stopPropagation(); });
  });
  document.addEventListener("click", function () { fecharPaineis(); });

  // Tema: troca aqui e nas páginas abertas, sem recarregar
  $("tema").addEventListener("click", function () {
    var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("inkterminal-tema", n); } catch (_) {}
    document.documentElement.dataset.theme = n;
    document.documentElement.style.colorScheme = n;
    P.tema(n);
  });

  // Memória (botões em vez de <select>, que o XeOS redesenha)
  Array.prototype.forEach.call(document.querySelectorAll(".opcoes"), function (grupo) {
    grupo.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      P.definir(grupo.dataset.nome, b.value);
    });
  });

  // endereços antigos (#terminal), da versão em que os apps abriam dentro desta página
  var pedido = location.hash.slice(1), cartao = pedido && document.querySelector('[data-app="' + pedido.replace(/[^a-z]/g, "") + '"]');
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  try { localStorage.removeItem("inkterminal-inicio"); } catch (_) {}
  if (cartao) { location.href = cartao.href; return; }
  desenhar();
  atualizar();
})();
