/* Tela inicial: webapps da pessoa e apps escondidos. Tudo fica só neste aparelho (localStorage).

   - Último cartão "Add webapp" (contorno pontilhado): a pessoa cola o link de qualquer site; o cartão
     usa o ícone do site (apple-touch-icon.png, depois favicon.ico) ou a letra inicial do nome.
     Os sites são de terceiros: o Hub só guarda o link, sem garantia nenhuma.
   - "Customize": esconde ou mostra os apps do Hub e remove webapps. Um app escondido também deixa de
     abrir os tipos de arquivo dele (inicio/lancador.js pergunta em InkMeusApps.escondido). */
(function () {
  "use strict";
  var K_APPS = "inkdoshub-meus-apps", K_ESC = "inkdoshub-escondidos";
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) { return s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  var $ = function (id) { return document.getElementById(id); };
  function ler(k) { try { var v = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function salvar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  var grade = document.querySelector(".workspace-grid");
  var escondidos = ler(K_ESC), meus = ler(K_APPS).filter(function (a) { return a && /^https?:\/\//.test(a.url); });

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /* Ícone: tenta os arquivos comuns do próprio site; se nenhum carregar, a letra inicial. */
  function icone(app) {
    var caixa = el("span", "app-icon"), origem = new URL(app.url).origin;
    var tentativas = [origem + "/apple-touch-icon.png", origem + "/favicon.ico"], img = new Image();
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = function () {
      if (tentativas.length) { img.src = tentativas.shift(); return; }
      img.remove();
      caixa.appendChild(el("b", "letra", (app.nome || "?").trim().charAt(0).toUpperCase() || "?"));
    };
    img.src = tentativas.shift();
    caixa.appendChild(img);
    return caixa;
  }

  function cartaoMeu(app) {
    var a = el("a", "workspace-card meu");
    // link direto: se a pessoa tiver o app do site, o iOS pode abrir o app
    a.href = app.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.dataset.meu = app.url;
    a.appendChild(el("span", "accent"));
    a.appendChild(icone(app));
    var c = el("span", "workspace-copy");
    c.setAttribute("data-idioma-nao", "");
    c.appendChild(el("strong", "", app.nome));
    c.appendChild(el("small", "", new URL(app.url).host));
    a.appendChild(c);
    a.appendChild(el("span", "chevron", "↗"));
    return a;
  }

  var novo = el("button", "workspace-card novo");
  novo.type = "button";
  novo.innerHTML = '<span class="app-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>';
  var nc = el("span", "workspace-copy");
  nc.appendChild(el("strong", "", t("Add webapp")));
  nc.appendChild(el("small", "", t("A shortcut to any site you use. At your own risk.")));
  novo.appendChild(nc);

  function desenhar() {
    Array.prototype.forEach.call(grade.querySelectorAll("[data-meu]"), function (c) { c.remove(); });
    meus.forEach(function (app) { grade.appendChild(cartaoMeu(app)); });
    grade.appendChild(novo);
    Array.prototype.forEach.call(grade.querySelectorAll("[data-app]"), function (c) {
      c.classList.toggle("escondido", escondidos.indexOf(c.dataset.app) >= 0);
    });
    ordenar();
    if (editando) marcas();
  }

  /* ---------- Ordem dos apps: no Personalizar, arrastar (mouse, touchpad ou dedo) ---------- */
  var K_ORDEM = "inkdoshub-ordem";
  function chave(c) { return c.dataset.app || c.dataset.meu; }
  function ordenar() {
    var ordem = ler(K_ORDEM);
    if (!ordem.length) return;
    var cards = [].slice.call(grade.querySelectorAll("[data-app],[data-meu]"));
    cards.sort(function (a, b) {
      var ia = ordem.indexOf(chave(a)), ib = ordem.indexOf(chave(b));
      return (ia < 0 ? 1e4 + cards.indexOf(a) : ia) - (ib < 0 ? 1e4 + cards.indexOf(b) : ib);
    });
    cards.forEach(function (c) { grade.insertBefore(c, novo); });
  }
  var arrasto = null, arrastou = false;
  grade.addEventListener("pointerdown", function (e) {
    if (!editando || e.button > 0) return;
    var c = e.target.closest("[data-app],[data-meu]");
    if (c) arrasto = { c: c, x: e.clientX, y: e.clientY, ativo: false, id: e.pointerId };
  });
  grade.addEventListener("pointermove", function (e) {
    if (!arrasto || e.pointerId !== arrasto.id) return;
    if (!arrasto.ativo) {
      if (Math.abs(e.clientX - arrasto.x) + Math.abs(e.clientY - arrasto.y) < 8) return;
      arrasto.ativo = true;
      arrasto.c.classList.add("arrastando");
      try { grade.setPointerCapture(e.pointerId); } catch (_) {}
    }
    e.preventDefault();
    arrasto.c.style.pointerEvents = "none";
    var alvo = document.elementFromPoint(e.clientX, e.clientY);
    arrasto.c.style.pointerEvents = "";
    alvo = alvo && alvo.closest("[data-app],[data-meu]");
    if (!alvo || alvo === arrasto.c || !grade.contains(alvo)) return;
    var r = alvo.getBoundingClientRect(), depois = e.clientX > r.left + r.width / 2;
    grade.insertBefore(arrasto.c, depois ? alvo.nextSibling : alvo);
  });
  function soltar() {
    if (!arrasto) return;
    if (arrasto.ativo) {
      arrastou = true;
      arrasto.c.classList.remove("arrastando");
      salvar(K_ORDEM, [].map.call(grade.querySelectorAll("[data-app],[data-meu]"), chave));
      setTimeout(function () { arrastou = false; }, 0);
    }
    arrasto = null;
  }
  grade.addEventListener("pointerup", soltar);
  grade.addEventListener("pointercancel", soltar);

  /* ---------- Adicionar webapp ---------- */
  var dlg = $("dlg-webapp"), campoUrl = $("webapp-url"), campoNome = $("webapp-nome"), erro = $("webapp-erro");
  novo.addEventListener("click", function () {
    if (editando) return;
    campoUrl.value = ""; campoNome.value = ""; erro.textContent = "";
    dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "");
    campoUrl.focus();
  });
  campoUrl.addEventListener("change", function () {
    if (campoNome.value) return;
    try { campoNome.value = new URL(endereco(campoUrl.value)).hostname.replace(/^www\./, "").split(".")[0].replace(/^./, function (l) { return l.toUpperCase(); }); } catch (_) {}
  });
  function endereco(s) { s = String(s || "").trim(); return /^[a-z][\w+.-]*:/i.test(s) ? s : "https://" + s; }
  $("webapp-cancelar").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("submit", function (e) {
    e.preventDefault();
    var u;
    try { u = new URL(endereco(campoUrl.value)); } catch (_) { u = null; }
    if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) { erro.textContent = t("Type a site address, like example.com."); return; }
    var nome = campoNome.value.trim().slice(0, 40) || u.hostname.replace(/^www\./, "");
    meus = meus.filter(function (a) { return a.url !== u.href; });
    var item = { url: u.href, nome: nome };
    meus.push(item);
    salvar(K_APPS, meus);
    dlg.close();
    desenhar();
  });

  /* ---------- Customizar: esconder apps e remover webapps ---------- */
  var editando = false, botaoEditar = $("btn-editar");
  function marcas() {
    Array.prototype.forEach.call(grade.querySelectorAll(".marca"), function (m) { m.remove(); });
    Array.prototype.forEach.call(grade.querySelectorAll("[data-app],[data-meu]"), function (c) {
      var txt = c.dataset.meu ? t("Remove") : c.classList.contains("escondido") ? t("Show") : t("Hide");
      c.appendChild(el("span", "marca", txt));
    });
  }
  botaoEditar.addEventListener("click", function () {
    editando = !editando;
    grade.classList.toggle("editando", editando);
    botaoEditar.setAttribute("aria-pressed", String(editando));
    botaoEditar.textContent = editando ? t("Done") : t("Customize");
    if (editando) marcas(); else Array.prototype.forEach.call(grade.querySelectorAll(".marca"), function (m) { m.remove(); });
  });
  // fase de captura: no modo de edição o toque esconde/remove em vez de abrir (inicio.js abre os cartões)
  grade.addEventListener("click", function (e) {
    if (!editando) return;
    var c = e.target.closest("[data-app],[data-meu]");
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    if (arrastou) return; // fim de um arrasto, não um toque
    if (c.dataset.meu) {
      meus = meus.filter(function (a) { return a.url !== c.dataset.meu; });
      salvar(K_APPS, meus);
    } else {
      var i = escondidos.indexOf(c.dataset.app);
      if (i >= 0) escondidos.splice(i, 1); else escondidos.push(c.dataset.app);
      salvar(K_ESC, escondidos);
    }
    desenhar();
  }, true);

  window.addEventListener("storage", function (e) {
    if (e.key !== K_APPS && e.key !== K_ESC && e.key !== K_ORDEM) return;
    escondidos = ler(K_ESC); meus = ler(K_APPS);
    desenhar();
  });

  desenhar();

  window.InkMeusApps = {
    escondido: function (app) { return escondidos.indexOf(app) >= 0; },
    mostrar: function (app) { escondidos = escondidos.filter(function (a) { return a !== app; }); salvar(K_ESC, escondidos); desenhar(); },
    webapps: function () { return meus.map(function (a) { return { nome: a.nome, url: a.url }; }); },
  };
})();
