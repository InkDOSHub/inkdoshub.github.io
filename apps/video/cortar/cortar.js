// Editor de vídeo simples, como o da Fotos do iPhone: escolher o trecho, tirar ou deixar o som e
// exportar no original (só corta, rápido) ou em 1080p, 720p ou 480p. O resultado vira um vídeo novo
// na lista do Vídeo. O vídeo chega pelo ?id= (o "Editar" do player).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var video = $("video"), faixa = $("faixa"), bib = InkBiblioteca("inkterminal-video");
  var item = null, dur = 0, ini = 0, fim = 0, som = true, altura = 0, url = null;
  var MIN = 0.5; // trecho mínimo, em segundos

  function hms(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
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
    $("tempos").innerHTML = "<b>" + hms(ini) + "</b> até <b>" + hms(fim) + "</b> · " + hms(fim - ini);
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
  video.addEventListener("play", function () { $("tocar").textContent = "❚❚"; $("tocar").setAttribute("aria-label", "Pausar"); });
  video.addEventListener("pause", function () { $("tocar").textContent = "▶"; $("tocar").setAttribute("aria-label", "Tocar"); });
  video.addEventListener("timeupdate", function () {
    if (!video.paused && video.currentTime >= fim) { video.pause(); video.currentTime = fim; }
    desenhar();
  });

  $("som").onclick = function () {
    som = !som;
    video.muted = !som;
    $("som").textContent = som ? "Com som" : "Sem som";
    $("som").setAttribute("aria-pressed", String(som));
  };
  $("qualidade").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    altura = +b.dataset.h;
    [].forEach.call($("qualidade").children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
  });

  /* ---------- Exportar ---------- */
  function painel(titulo, texto, parte, botoes) {
    $("progresso").classList.add("on");
    $("p-titulo").textContent = titulo;
    $("p-texto").textContent = texto || "";
    $("p-barra").style.display = parte == null ? "none" : "";
    $("p-barra").firstChild.style.width = Math.round((parte || 0) * 100) + "%";
    var b = $("p-botoes"); b.innerHTML = "";
    (botoes || []).forEach(function (x) {
      var e = document.createElement("button");
      e.className = "ink-btn" + (x.principal ? " principal" : "");
      e.textContent = x.texto; e.onclick = x.acao;
      b.appendChild(e);
    });
  }
  function fecharPainel() { $("progresso").classList.remove("on"); }

  var worker = null;
  $("exportar").onclick = function () {
    if (!item) return;
    video.pause();
    var t0 = Date.now(), arquivo = item.blob instanceof File ? item.blob : new File([item.blob], item.nome, { type: item.tipo || item.blob.type });
    var qual = altura ? altura + "p" : "qualidade original";
    painel("Exportando", "Preparando (" + qual + ")…", 0, [{ texto: "Cancelar", acao: cancelar }]);
    worker = new Worker("cortar-worker.js?v=1", { type: "module" });
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.tipo === "progresso") {
        var s = Math.round((Date.now() - t0) / 1000);
        painel("Exportando", (altura ? "Convertendo para " + qual : "Cortando") + " · " + Math.round(d.parte * 100) + "% · " + s + " s", d.parte, [{ texto: "Cancelar", acao: cancelar }]);
      }
      if (d.tipo === "erro") { worker.terminate(); worker = null; painel("Não foi possível exportar", d.texto, null, [{ texto: "OK", acao: fecharPainel }]); }
      if (d.tipo === "pronto") { worker.terminate(); worker = null; guardar(d.blob, d.ext); }
    };
    worker.onerror = function (e) { painel("Não foi possível exportar", e.message || "erro no ffmpeg", null, [{ texto: "OK", acao: fecharPainel }]); };
    worker.postMessage({ arquivo: arquivo, ini: ini, fim: fim, som: som, altura: altura });
  };
  function cancelar() { if (worker) { worker.terminate(); worker = null; } fecharPainel(); }

  function guardar(blob, ext) {
    var base = item.nome.replace(/\.[^.]+$/, "");
    var arq = new File([blob], base + " (editado)" + ext, { type: blob.type });
    bib.adicionar([arq]).then(function (novos) {
      var novo = novos[0];
      try { localStorage.setItem("inkterminal-video-atual", String(novo.id)); } catch (_) {}
      painel("Pronto", arq.name + " (" + inkTamanho(arq.size) + ") está na lista do Vídeo.", null, [
        { texto: "Guardar no aparelho", acao: function () { partilhar(arq); } },
        { texto: "Ver no Vídeo", principal: true, acao: function () { location.href = "../"; } },
      ]);
    });
  }
  function partilhar(arq) {
    if (navigator.canShare && navigator.canShare({ files: [arq] })) {
      navigator.share({ files: [arq] }).catch(function () {});
      return;
    }
    var a = document.createElement("a"), u = URL.createObjectURL(arq);
    a.href = u; a.download = arq.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  }

  /* ---------- Abrir o vídeo ---------- */
  var id = +new URLSearchParams(location.search).get("id");
  bib.listar().then(function (lst) {
    item = lst.filter(function (v) { return v.id === id; })[0] || null;
    if (!item) {
      painel("Nenhum vídeo", "Abra um vídeo no Vídeo e toque em Editar.", null, [{ texto: "Ir para o Vídeo", principal: true, acao: function () { location.href = "../"; } }]);
      return;
    }
    $("nome").textContent = item.nome;
    document.title = item.nome + " · Editar vídeo";
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
      painel("Não consegui abrir o vídeo", "O navegador não toca este formato.", null, [{ texto: "Voltar", acao: function () { location.href = "../"; } }]);
    });
  });
  addEventListener("resize", function () { if (dur) { desenhar(); miniaturas(); } });
})();
