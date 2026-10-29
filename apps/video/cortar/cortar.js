// Editor de vídeo simples, como o da Fotos do iPhone: escolher o trecho, tirar ou deixar o som e
// exportar no original (só corta, rápido) ou em 1080p, 720p ou 480p. O resultado vira um vídeo novo
// na lista do Vídeo. "Só o som" guarda só o áudio (.m4a) na lista da Música (por exemplo, o som de
// uma gravação de tela). O vídeo chega pelo ?id= (o "Editar" do player).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var t = InkIdioma.t;
  var video = $("video"), faixa = $("faixa"), bib = InkBiblioteca("inkdoshub-video");
  var item = null, dur = 0, ini = 0, fim = 0, som = "com", altura = 0, url = null;
  var MIN = 0.5; // trecho mínimo, em segundos

  function hms(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + r.toLocaleString(InkIdioma.atual, { minimumIntegerDigits: 2, minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  function desenhar() {
    var p = function (t) { return (dur ? t / dur * 100 : 0) + "%"; };
    $("fora-ini").style.width = p(ini);
    $("fora-fim").style.width = (dur ? (dur - fim) / dur * 100 : 0) + "%";
    $("janela").style.left = p(ini);
    $("janela").style.width = (dur ? (fim - ini) / dur * 100 : 0) + "%";
    $("alca-ini").style.left = "calc(" + p(ini) + " + 7px)";
    $("alca-fim").style.left = "calc(" + p(fim) + " - 7px)";
    $("cursor").style.left = p(video.currentTime || 0);
    $("tempos").innerHTML = t("{start} to {end} · {length}", { start: "<b>" + hms(ini) + "</b>", end: "<b>" + hms(fim) + "</b>", length: hms(fim - ini) });
  }

  /* ---------- Miniaturas na faixa ---------- */
  function miniaturas() {
    var c = $("miniaturas"), r = faixa.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
    var g = c.getContext("2d"), v = document.createElement("video");
    var w = video.videoWidth && video.videoHeight ? c.height * video.videoWidth / video.videoHeight : c.height;
    var n = Math.max(1, Math.ceil(c.width / w)), i = 0;
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    function proximo() {
      if (i >= n) { v.removeAttribute("src"); v.load(); return; }
      v.currentTime = Math.min(dur - 0.05, (i + 0.5) * dur / n);
    }
    v.addEventListener("seeked", function () {
      try { g.drawImage(v, i * w, 0, w, c.height); } catch (_) {}
      i++; proximo();
    });
    v.addEventListener("loadeddata", proximo, { once: true });
  }

  /* ---------- Arrastar as alças ---------- */
  /* Prévia ao arrastar: mostra o quadro do ponto (fastSeek no Safari, um pulo por vez para não
     acumular pedidos) e, ao soltar, toca dali: do início, ou os últimos segundos até o fim. */
  var alvo = null, buscando = false;
  function pular(t) {
    alvo = t;
    if (buscando) return;
    buscando = true;
    if (video.fastSeek) video.fastSeek(t); else video.currentTime = t;
  }
  video.addEventListener("seeked", function () {
    buscando = false;
    if (alvo != null && Math.abs(video.currentTime - alvo) > 0.15) pular(alvo); else alvo = null;
  });
  function tocarDe(t) {
    alvo = null; buscando = false;
    video.currentTime = Math.max(ini, Math.min(fim - 0.05, t));
    var p = video.play(); if (p && p.catch) p.catch(function () {});
  }
  function arrastar(alca, qual) {
    alca.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      alca.setPointerCapture(e.pointerId);
      video.pause();
      var mover = function (ev) {
        var r = faixa.getBoundingClientRect(), t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur;
        if (qual === "ini") { ini = Math.min(t, fim - MIN); pular(ini); }
        else { fim = Math.max(t, ini + MIN); pular(fim); }
        desenhar();
      };
      var soltar = function () {
        alca.removeEventListener("pointermove", mover); alca.removeEventListener("pointerup", soltar); alca.removeEventListener("pointercancel", soltar);
        tocarDe(qual === "ini" ? ini : fim - 3);
      };
      alca.addEventListener("pointermove", mover);
      alca.addEventListener("pointerup", soltar);
      alca.addEventListener("pointercancel", soltar);
    });
  }
  arrastar($("alca-ini"), "ini");
  arrastar($("alca-fim"), "fim");
  // toque no meio da faixa: vai para aquele ponto do trecho
  faixa.addEventListener("pointerdown", function (e) {
    if (e.target.classList.contains("alca")) return;
    var r = faixa.getBoundingClientRect(), t = (e.clientX - r.left) / r.width * dur;
    tocarDe(t);
    desenhar();
  });

  /* ---------- Tocar só o trecho ---------- */
  $("tocar").onclick = function () {
    if (video.paused) {
      if (video.currentTime < ini || video.currentTime >= fim - 0.05) video.currentTime = ini;
      video.play();
    } else video.pause();
  };
  video.addEventListener("play", function () { $("tocar").textContent = "❚❚"; $("tocar").setAttribute("aria-label", t("Pause")); });
  video.addEventListener("pause", function () { $("tocar").textContent = "▶"; $("tocar").setAttribute("aria-label", t("Play")); });
  video.addEventListener("timeupdate", function () {
    if (!video.paused && video.currentTime >= fim) { video.pause(); video.currentTime = fim; }
    desenhar();
  });

  $("som").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    som = b.dataset.som;
    video.muted = som === "sem";
    [].forEach.call($("som").children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    $("linha-qualidade").style.display = som === "so" ? "none" : "";
  });
  $("qualidade").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    altura = +b.dataset.h;
    [].forEach.call($("qualidade").children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
  });

  /* ---------- Exportar ---------- */
  var painel = inkPainel, fecharPainel = inkFecharPainel;

  var worker = null;
  $("exportar").onclick = function () {
    if (!item) return;
    video.pause();
    var t0 = Date.now(), arquivo = item.blob instanceof File ? item.blob : new File([item.blob], item.nome, { type: item.tipo || item.blob.type });
    var qual = altura + "p", audio = som === "so";
    painel(t("Exporting"), audio ? t("Preparing (sound only)…") : altura ? t("Preparing ({quality})…", { quality: qual }) : t("Preparing (original quality)…"), 0, [{ texto: t("Cancel"), acao: cancelar }]);
    worker = new Worker("cortar-worker.js?v=3", { type: "module" });
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.tipo === "progresso") {
        var s = Math.round((Date.now() - t0) / 1000);
        var pct = Math.round(d.parte * 100).toLocaleString(InkIdioma.atual), seg = s.toLocaleString(InkIdioma.atual);
        painel(t("Exporting"), audio ? t("Extracting the sound · {percent}% · {seconds} s", { percent: pct, seconds: seg }) : altura ? t("Converting to {quality} · {percent}% · {seconds} s", { quality: qual, percent: pct, seconds: seg }) : t("Trimming · {percent}% · {seconds} s", { percent: pct, seconds: seg }), d.parte, [{ texto: t("Cancel"), acao: cancelar }]);
      }
      if (d.tipo === "erro") { worker.terminate(); worker = null; painel(t("Could not export"), d.codigo === "vazio" ? t("ffmpeg did not produce the video.") : d.codigo === "semaudio" ? t("This video has no sound, or its sound could not be read.") : d.texto, null, [{ texto: t("OK"), acao: fecharPainel }]); }
      if (d.tipo === "pronto") { worker.terminate(); worker = null; (audio ? guardarSom : guardar)(d.blob, d.ext); }
    };
    worker.onerror = function (e) { painel(t("Could not export"), e.message || t("ffmpeg error"), null, [{ texto: t("OK"), acao: fecharPainel }]); };
    worker.postMessage({ arquivo: arquivo, ini: ini, fim: fim, som: som !== "sem", soSom: audio, altura: audio ? 0 : altura });
  };
  function cancelar() { if (worker) { worker.terminate(); worker = null; } fecharPainel(); }

  function guardar(blob, ext) {
    var base = item.nome.replace(/\.[^.]+$/, "");
    var arq = new File([blob], t("{name} (edited)", { name: base }) + ext, { type: blob.type });
    bib.adicionar([arq]).then(function (novos) {
      var novo = novos[0];
      try { localStorage.setItem("inkdoshub-video-atual", String(novo.id)); } catch (_) {}
      painel(t("Done"), t("{name} ({size}) is in the Video list.", { name: arq.name, size: inkTamanho(arq.size) }), null, [
        { texto: t("Save to device"), acao: function () { inkPartilhar(arq); } },
        { texto: t("View in Video"), principal: true, acao: function () { location.href = "../"; } },
      ]);
    });
  }
  // só o som: vai para a lista da Música
  function guardarSom(blob, ext) {
    var arq = new File([blob], item.nome.replace(/\.[^.]+$/, "") + ext, { type: blob.type });
    InkBiblioteca("inkdoshub-musica").adicionar([arq]).then(function (novos) {
      try { localStorage.setItem("inkdoshub-musica-atual", String(novos[0].id)); } catch (_) {}
      painel(t("Done"), t("{name} ({size}) is in the Music list.", { name: arq.name, size: inkTamanho(arq.size) }), null, [
        { texto: t("Save to device"), acao: function () { inkPartilhar(arq); } },
        { texto: t("Open in Music"), principal: true, acao: function () { location.href = "../../musica/"; } },
      ]);
    });
  }

  /* ---------- Abrir o vídeo ---------- */
  $("nome").textContent = t("Edit");
  var id = +new URLSearchParams(location.search).get("id");
  bib.listar().then(function (lst) {
    item = lst.filter(function (v) { return v.id === id; })[0] || null;
    if (!item) {
      painel(t("No video"), t("Open a video in Video and tap Edit."), null, [{ texto: t("Go to Video"), principal: true, acao: function () { location.href = "../"; } }]);
      return;
    }
    $("nome").textContent = item.nome;
    document.title = t("{name} · Edit video", { name: item.nome });
    url = URL.createObjectURL(item.blob);
    video.src = url;
    video.addEventListener("loadedmetadata", function () {
      dur = isFinite(video.duration) ? video.duration : (item.duracao || 0);
      ini = 0; fim = dur;
      $("exportar").disabled = !dur;
      desenhar();
      miniaturas();
    }, { once: true });
    video.addEventListener("error", function () {
      painel(t("Could not open the video"), t("The browser cannot play this format."), null, [{ texto: t("Back"), acao: function () { location.href = "../"; } }]);
    });
  });
  addEventListener("resize", function () { if (dur) { desenhar(); miniaturas(); } });
})();
