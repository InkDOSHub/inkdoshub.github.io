/* Área de trabalho do InkTerminal: ícones, menu, painéis de memória e offline, diálogo. */
(function () {
  "use strict";
  var G = window.InkGerenciador;
  var $ = function (id) { return document.getElementById(id); };

  // Ícones na mesa e no menu
  var icones = $("icones"), menu = $("menu");
  window.INK_APPS.forEach(function (a) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "icone-app " + a.id;
    b.innerHTML = '<span class="icone-desenho">' + inkSvg(a.icone) + "</span><span class=\"icone-nome\"></span>";
    b.querySelector(".icone-nome").textContent = a.nome;
    b.title = a.descricao;
    b.addEventListener("click", function () { InkJanelas.abrir(a.id); });
    icones.appendChild(b);

    var m = document.createElement("button");
    m.type = "button";
    m.setAttribute("role", "menuitem");
    m.innerHTML = inkSvg(a.icone) + "<span><strong></strong><small></small></span>";
    m.querySelector("strong").textContent = a.nome;
    m.querySelector("small").textContent = a.descricao;
    m.addEventListener("click", function () { fecharPaineis(); InkJanelas.abrir(a.id); });
    menu.appendChild(m);
  });
  var voltar = document.createElement("a");
  voltar.href = "../";
  voltar.className = "menu-rodape";
  voltar.textContent = "Tela inicial simples (cartões)";
  menu.appendChild(voltar);

  // Painéis que abrem pelos botões do topo
  var paineis = { "btn-menu": menu, "btn-memoria": $("painel-memoria"), "btn-offline": $("painel-offline") };
  function fecharPaineis(exceto) {
    Object.keys(paineis).forEach(function (b) {
      if (paineis[b] !== exceto) { paineis[b].hidden = true; $(b).setAttribute("aria-expanded", "false"); }
    });
  }
  Object.keys(paineis).forEach(function (b) {
    $(b).addEventListener("click", function (e) {
      e.stopPropagation();
      var p = paineis[b], abrir = p.hidden;
      fecharPaineis(p);
      p.hidden = !abrir;
      $(b).setAttribute("aria-expanded", String(abrir));
      if (abrir && b === "btn-offline") InkOffline.atualizar();
    });
    paineis[b].addEventListener("click", function (e) { e.stopPropagation(); });
  });
  document.addEventListener("click", function () { fecharPaineis(); });
  $("mesa").addEventListener("pointerdown", function () { fecharPaineis(); });

  $("btn-tema").addEventListener("click", function () { inkTema.trocar(); });

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

  // Memória
  $("limite").value = String(G.cfg.limite);
  $("max-janelas").value = String(G.cfg.maxJanelas);
  $("limite").addEventListener("change", function () { G.definir("limite", this.value); });
  $("max-janelas").addEventListener("change", function () { G.definir("maxJanelas", this.value); });

  G.aoMudar = function () {
    var uso = G.emUso(), lim = G.cfg.limite;
    $("memoria-texto").textContent = uso + " / " + (lim >= 1000 ? (lim / 1000).toFixed(1).replace(".", ",").replace(",0", "") + " GB" : lim + " MB");
    var barra = $("medidor-barra");
    barra.style.width = Math.min(100, Math.round(uso / lim * 100)) + "%";
    barra.className = uso > lim ? "cheio" : uso > lim * 0.8 ? "quase" : "";
    var ul = $("lista-memoria");
    ul.innerHTML = "";
    var js = G.janelas();
    if (!js.length) { ul.innerHTML = "<li><span>Nenhuma janela aberta.</span></li>"; return; }
    js.slice().sort(function (a, b) { return b.usadoEm - a.usadoEm; }).forEach(function (j) {
      var li = document.createElement("li");
      li.innerHTML = "<span></span><small></small>";
      li.firstChild.textContent = j.app.nome;
      li.lastChild.textContent = j.carregada ? "carregada, ~" + j.app.peso + " MB" + (G.podeSairSemPerguntar(j) ? ", salva sozinha" : "") : "guardada, 0 MB";
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
  };

  InkJanelas.restaurar();
  G.aoMudar();
})();
