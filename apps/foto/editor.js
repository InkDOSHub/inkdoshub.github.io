// Editor de fotos do InkDOS Hub: o básico de um editor de celular, feito aqui.
// Recortar (com proporções), girar 90°, espelhar, endireitar e ajustes de luz e cor.
// Não tem camadas: a foto original fica como está e "Save copy" grava uma cópia nova.
//
// Prévia: uma cópia reduzida da foto (até 1600 px) é desenhada a cada mudança.
// Cópia final: a foto inteira é desenhada de novo (até 16 megapixels, o limite de canvas do Safari).
// Cor: exposição, brilho, contraste, calor e tom viram uma tabela por canal (LUT); a saturação
// mistura cada pixel com o cinza dele.
(function () {
  "use strict";
  var t = window.InkIdioma ? InkIdioma.t : function (s) { return s; };
  var $ = function (id) { return document.getElementById(id); };
  var LADO_PREVIA = 1600, MAX_PIXELS = 16e6;

  var AJUSTES = [
    { id: "exposicao", nome: function () { return t("Exposure"); }, min: -100, max: 100 },
    { id: "brilho", nome: function () { return t("Brightness"); }, min: -100, max: 100 },
    { id: "contraste", nome: function () { return t("Contrast"); }, min: -100, max: 100 },
    { id: "saturacao", nome: function () { return t("Saturation"); }, min: -100, max: 100 },
    { id: "calor", nome: function () { return t("Warmth"); }, min: -100, max: 100 },
    { id: "tom", nome: function () { return t("Tint"); }, min: -100, max: 100 },
  ];
  var PROPORCOES = [
    { id: "livre", nome: function () { return t("Free"); } },
    { id: "original", nome: function () { return t("Original"); } },
    { id: "1:1", nome: function () { return t("Square"); }, r: 1 },
    { id: "4:3", nome: function () { return "4:3"; }, r: 4 / 3 },
    { id: "3:2", nome: function () { return "3:2"; }, r: 3 / 2 },
    { id: "16:9", nome: function () { return "16:9"; }, r: 16 / 9 },
  ];

  var img = null, previa = null, estado = null, aba = "ajustar", fim = null, desenhoPendente = false;

  function novoEstado() {
    var e = { giro: 0, espelho: false, endireitar: 0, recorte: { x: 0, y: 0, w: 1, h: 1 }, proporcao: "livre" };
    AJUSTES.forEach(function (a) { e[a.id] = 0; });
    return e;
  }

  /* ---------- geometria ---------- */

  // tamanho da foto depois dos giros de 90°
  function orientado(w, h) { return estado.giro % 180 ? { w: h, h: w } : { w: w, h: h }; }
  // quanto ampliar ao endireitar para não aparecer canto vazio
  function ampliacao(w, h) {
    var a = Math.abs(estado.endireitar) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
  }
  /* Desenha a foto (fonte de tamanho fw×fh) no canvas, com recorte opcional, na escala k. */
  function desenhar(fonte, fw, fh, k, comRecorte) {
    var o = orientado(fw, fh), r = comRecorte ? estado.recorte : { x: 0, y: 0, w: 1, h: 1 };
    var cw = Math.max(1, Math.round(r.w * o.w * k)), ch = Math.max(1, Math.round(r.h * o.h * k));
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.scale(k, k);
    g.translate(-r.x * o.w, -r.y * o.h);
    g.translate(o.w / 2, o.h / 2);
    g.rotate(estado.endireitar * Math.PI / 180);
    var s = ampliacao(o.w, o.h);
    g.scale(s, s);
    g.rotate(estado.giro * Math.PI / 180);
    if (estado.espelho) g.scale(-1, 1);
    g.drawImage(fonte, -fw / 2, -fh / 2, fw, fh);
    return c;
  }

  /* ---------- cor ---------- */

  function temCor() { return AJUSTES.some(function (a) { return estado[a.id] !== 0; }); }
  function tabelas() {
    var ex = Math.pow(2, estado.exposicao / 50);         // ±2 pontos de luz
    var br = estado.brilho / 100 * 0.35;                 // soma até ±35%
    var ct = 1 + estado.contraste / 100 * (estado.contraste > 0 ? 1 : 0.7);
    // calor: mais vermelho e menos azul; tom: positivo puxa para o magenta, negativo para o verde
    var q = estado.calor / 100 * 0.12, tm = estado.tom / 100 * 0.1;
    var mult = [(1 + q) * (1 + tm / 2), 1 - tm, (1 - q) * (1 + tm / 2)];
    var L = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
    for (var ch = 0; ch < 3; ch++) {
      for (var i = 0; i < 256; i++) {
        var v = i / 255 * ex + br;
        v = (v - 0.5) * ct + 0.5;
        L[ch][i] = Math.round(v * mult[ch] * 255);
      }
    }
    return L;
  }
  function aplicarCor(c) {
    if (!temCor()) return c;
    var g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    var L = tabelas(), R = L[0], G = L[1], B = L[2], sat = 1 + estado.saturacao / 100, n = p.length;
    for (var i = 0; i < n; i += 4) {
      var r = R[p[i]], gg = G[p[i + 1]], b = B[p[i + 2]];
      if (sat !== 1) {
        var l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
      }
      p[i] = r; p[i + 1] = gg; p[i + 2] = b;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  /* ---------- tela ---------- */

  function montar() {
    var caixa = $("edicao");
    caixa.innerHTML =
      '<header class="ink-bar">' +
      '<button class="ink-btn" id="fe-cancelar" type="button"></button>' +
      '<span class="ink-title" id="fe-titulo"></span>' +
      '<span class="ink-spacer"></span>' +
      '<button class="ink-btn" id="fe-desfazer" type="button"></button>' +
      '<button class="ink-btn on" id="fe-salvar" type="button"></button>' +
      "</header>" +
      '<div class="fe-palco" id="fe-palco" data-idioma-nao><div class="fe-moldura" id="fe-moldura"><canvas id="fe-tela"></canvas>' +
      '<div class="fe-recorte md-hide" id="fe-recorte"><i data-c="nw"></i><i data-c="ne"></i><i data-c="sw"></i><i data-c="se"></i></div></div></div>' +
      '<div class="fe-painel">' +
      '<div class="fe-abas"><button class="ink-btn" id="fe-aba-ajustar" type="button"></button><button class="ink-btn" id="fe-aba-recortar" type="button"></button></div>' +
      '<div id="fe-ajustar"></div>' +
      '<div id="fe-recortar" class="md-hide"><div class="fe-linha" id="fe-props"></div>' +
      '<div class="fe-linha"><button class="ink-btn" id="fe-girar" type="button" data-icone="girar-esq"></button>' +
      '<button class="ink-btn" id="fe-espelhar" type="button" data-icone="espelhar"></button></div>' +
      '<div class="md-row"><label for="fe-endireitar" id="fe-endireitar-nome"></label><input type="range" id="fe-endireitar" min="-45" max="45" step="0.5"><output id="fe-endireitar-v"></output></div>' +
      "</div></div>";
    $("fe-cancelar").textContent = t("Cancel");
    $("fe-titulo").textContent = t("Edit photo");
    $("fe-desfazer").textContent = t("Reset");
    $("fe-salvar").textContent = t("Save copy");
    $("fe-aba-ajustar").textContent = t("Adjust");
    $("fe-aba-recortar").textContent = t("Crop and rotate");
    $("fe-girar").title = t("Rotate left"); $("fe-girar").setAttribute("aria-label", t("Rotate left"));
    $("fe-espelhar").title = t("Flip"); $("fe-espelhar").setAttribute("aria-label", t("Flip"));
    $("fe-endireitar-nome").textContent = t("Straighten");

    var aj = $("fe-ajustar");
    AJUSTES.forEach(function (a) {
      var linha = document.createElement("div");
      linha.className = "md-row";
      linha.innerHTML = '<label></label><input type="range" step="1"><output></output>';
      var rot = linha.children[0], ent = linha.children[1], out = linha.children[2];
      rot.textContent = a.nome(); rot.htmlFor = ent.id = "fe-" + a.id;
      ent.min = a.min; ent.max = a.max; ent.value = estado[a.id];
      out.id = "fe-" + a.id + "-v";
      ent.addEventListener("input", function () { estado[a.id] = +ent.value; valores(); pedirDesenho(); });
      // toque duplo no nome volta a zero
      rot.addEventListener("dblclick", function () { estado[a.id] = 0; ent.value = 0; valores(); pedirDesenho(); });
      aj.appendChild(linha);
    });
    var pr = $("fe-props");
    PROPORCOES.forEach(function (p) {
      var b = document.createElement("button");
      b.className = "ink-btn"; b.type = "button"; b.dataset.prop = p.id; b.textContent = p.nome();
      b.addEventListener("click", function () { escolherProporcao(p.id); });
      pr.appendChild(b);
    });
    if (window.inkIcones) inkIcones(caixa);

    $("fe-cancelar").onclick = function () { fechar(false); };
    $("fe-salvar").onclick = salvar;
    $("fe-desfazer").onclick = function () { estado = novoEstado(); controles(); pedirDesenho(); };
    $("fe-aba-ajustar").onclick = function () { aba = "ajustar"; controles(); pedirDesenho(); };
    $("fe-aba-recortar").onclick = function () { aba = "recortar"; controles(); pedirDesenho(); };
    $("fe-girar").onclick = function () {
      // gira a foto e o recorte juntos, 90° para a esquerda
      var r = estado.recorte;
      estado.recorte = { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
      estado.giro = (estado.giro + 270) % 360;
      if (estado.proporcao !== "livre") ajustarRecorte();
      pedirDesenho();
    };
    $("fe-espelhar").onclick = function () {
      var r = estado.recorte;
      estado.espelho = !estado.espelho;
      estado.recorte = { x: 1 - r.x - r.w, y: r.y, w: r.w, h: r.h };
      pedirDesenho();
    };
    $("fe-endireitar").addEventListener("input", function () { estado.endireitar = +this.value; valores(); pedirDesenho(); });
    $("fe-endireitar-nome").addEventListener("dblclick", function () { estado.endireitar = 0; controles(); pedirDesenho(); });
    arrastarRecorte();
    addEventListener("resize", pedirDesenho);
  }

  function valores() {
    var f = function (v) { return (v > 0 ? "+" : "") + Math.round(v).toLocaleString(window.InkIdioma ? InkIdioma.atual : "en"); };
    AJUSTES.forEach(function (a) { $("fe-" + a.id + "-v").textContent = f(estado[a.id]); });
    $("fe-endireitar-v").textContent = (estado.endireitar > 0 ? "+" : "") + estado.endireitar.toLocaleString(window.InkIdioma ? InkIdioma.atual : "en") + "°";
  }
  function controles() {
    AJUSTES.forEach(function (a) { $("fe-" + a.id).value = estado[a.id]; });
    $("fe-endireitar").value = estado.endireitar;
    $("fe-ajustar").classList.toggle("md-hide", aba !== "ajustar");
    $("fe-recortar").classList.toggle("md-hide", aba !== "recortar");
    $("fe-aba-ajustar").classList.toggle("on", aba === "ajustar");
    $("fe-aba-recortar").classList.toggle("on", aba === "recortar");
    Array.prototype.forEach.call(document.querySelectorAll("[data-prop]"), function (b) { b.classList.toggle("on", b.dataset.prop === estado.proporcao); });
    valores();
  }

  /* ---------- recorte ---------- */

  function razaoAlvo() {
    var p = PROPORCOES.filter(function (x) { return x.id === estado.proporcao; })[0];
    if (!p || p.id === "livre") return 0;
    var o = orientado(img.naturalWidth, img.naturalHeight);
    if (p.id === "original") return o.w / o.h;
    // segue a orientação da foto (deitada ou em pé)
    return o.w >= o.h ? p.r : 1 / p.r;
  }
  function escolherProporcao(id) {
    estado.proporcao = id;
    ajustarRecorte();
    controles();
    pedirDesenho();
  }
  // encaixa o recorte na proporção escolhida, centrado no recorte atual
  function ajustarRecorte() {
    var alvo = razaoAlvo();
    if (!alvo) return;
    var o = orientado(img.naturalWidth, img.naturalHeight), r = estado.recorte;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var w = r.w * o.w, h = r.h * o.h;
    if (w / h > alvo) w = h * alvo; else h = w / alvo;
    var nw = w / o.w, nh = h / o.h;
    if (nw > 1) { nh /= nw; nw = 1; }
    if (nh > 1) { nw /= nh; nh = 1; }
    estado.recorte = { x: Math.min(Math.max(0, cx - nw / 2), 1 - nw), y: Math.min(Math.max(0, cy - nh / 2), 1 - nh), w: nw, h: nh };
  }
  function mostrarRecorte() {
    var el = $("fe-recorte"), r = estado.recorte;
    el.classList.toggle("md-hide", aba !== "recortar");
    el.style.left = r.x * 100 + "%"; el.style.top = r.y * 100 + "%";
    el.style.width = r.w * 100 + "%"; el.style.height = r.h * 100 + "%";
  }
  function arrastarRecorte() {
    var el = $("fe-recorte"), inicio = null;
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      var m = $("fe-moldura").getBoundingClientRect();
      inicio = { x: e.clientX, y: e.clientY, r: Object.assign({}, estado.recorte), canto: e.target.dataset.c || "", mw: m.width, mh: m.height };
    });
    el.addEventListener("pointermove", function (e) {
      if (!inicio) return;
      var dx = (e.clientX - inicio.x) / inicio.mw, dy = (e.clientY - inicio.y) / inicio.mh, r = Object.assign({}, inicio.r), c = inicio.canto;
      var MIN = 0.05;
      if (!c) {
        r.x = Math.min(Math.max(0, r.x + dx), 1 - r.w);
        r.y = Math.min(Math.max(0, r.y + dy), 1 - r.h);
      } else {
        var x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
        if (c.indexOf("w") >= 0) x1 = Math.min(Math.max(0, x1 + dx), x2 - MIN);
        if (c.indexOf("e") >= 0) x2 = Math.max(Math.min(1, x2 + dx), x1 + MIN);
        if (c.indexOf("n") >= 0) y1 = Math.min(Math.max(0, y1 + dy), y2 - MIN);
        if (c.indexOf("s") >= 0) y2 = Math.max(Math.min(1, y2 + dy), y1 + MIN);
        var alvo = razaoAlvo();
        if (alvo) {
          // mantém a proporção: a altura segue a largura, presa pelo canto oposto
          var o = orientado(img.naturalWidth, img.naturalHeight);
          var w = (x2 - x1) * o.w, h = w / alvo, hn = h / o.h;
          if (c.indexOf("n") >= 0) { y1 = y2 - hn; if (y1 < 0) { y1 = 0; hn = y2; x1 = c.indexOf("w") >= 0 ? x2 - hn * o.h * alvo / o.w : x1; x2 = c.indexOf("e") >= 0 ? x1 + hn * o.h * alvo / o.w : x2; } }
          else { y2 = y1 + hn; if (y2 > 1) { y2 = 1; hn = 1 - y1; x1 = c.indexOf("w") >= 0 ? x2 - hn * o.h * alvo / o.w : x1; x2 = c.indexOf("e") >= 0 ? x1 + hn * o.h * alvo / o.w : x2; } }
        }
        r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      estado.recorte = r;
      mostrarRecorte();
    });
    var soltar = function () { if (inicio) { inicio = null; pedirDesenho(); } };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
  }

  /* ---------- desenho ---------- */

  function pedirDesenho() {
    if (desenhoPendente) return;
    desenhoPendente = true;
    requestAnimationFrame(function () { desenhoPendente = false; desenharPrevia(); });
  }
  function desenharPrevia() {
    if (!img) return;
    controles();
    var recortar = aba !== "recortar"; // no modo recorte a foto inteira aparece, com a moldura por cima
    var c = aplicarCor(desenhar(previa, previa.width, previa.height, 1, recortar));
    var tela = $("fe-tela"), palco = $("fe-palco");
    tela.width = c.width; tela.height = c.height;
    tela.getContext("2d").drawImage(c, 0, 0);
    // cabe no palco, sem passar do tamanho da prévia
    var k = Math.min((palco.clientWidth - 24) / c.width, (palco.clientHeight - 24) / c.height);
    var m = $("fe-moldura");
    m.style.width = Math.max(1, Math.floor(c.width * k)) + "px";
    m.style.height = Math.max(1, Math.floor(c.height * k)) + "px";
    mostrarRecorte();
  }

  /* ---------- abrir, salvar, fechar ---------- */

  function abrir(url, aoTerminar) {
    fim = aoTerminar;
    estado = novoEstado(); aba = "ajustar";
    var caixa = $("edicao");
    if (!caixa.firstChild || !$("fe-tela")) montar();
    caixa.classList.remove("md-hide");
    var i = new Image();
    i.decoding = "async";
    i.onload = function () {
      img = i;
      var k = Math.min(1, LADO_PREVIA / Math.max(i.naturalWidth, i.naturalHeight));
      previa = document.createElement("canvas");
      previa.width = Math.max(1, Math.round(i.naturalWidth * k));
      previa.height = Math.max(1, Math.round(i.naturalHeight * k));
      previa.getContext("2d").drawImage(i, 0, 0, previa.width, previa.height);
      controles();
      pedirDesenho();
    };
    i.onerror = function () { alert(t("This photo could not be opened in the editor.")); fechar(false); };
    i.src = url;
  }
  function salvar() {
    if (!img) return;
    var b = $("fe-salvar");
    b.disabled = true;
    setTimeout(function () {
      var o = orientado(img.naturalWidth, img.naturalHeight), r = estado.recorte;
      var area = r.w * o.w * r.h * o.h, k = Math.min(1, Math.sqrt(MAX_PIXELS / area));
      var c;
      try { c = aplicarCor(desenhar(img, img.naturalWidth, img.naturalHeight, k, true)); }
      catch (e) { b.disabled = false; alert(t("The photo is too large to save on this device.")); return; }
      b.disabled = false;
      fechar(c);
    }, 30);
  }
  function fechar(canvas) {
    $("edicao").classList.add("md-hide");
    var f = fim;
    img = null; previa = null; fim = null;
    var tela = $("fe-tela");
    if (tela) { tela.width = tela.height = 1; }
    if (f) f(canvas || null);
  }

  window.InkEditorFoto = { abrir: abrir };
})();
