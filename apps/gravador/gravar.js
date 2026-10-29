// Gravador de som do computador: getDisplayMedia (aba ou tela inteira com o som do sistema) e
// MediaRecorder só com o áudio, em Opus (.webm, ~22 MB por hora). Funciona no Chrome e no Edge do
// Windows; o Safari não oferece captura de outras janelas. O arquivo vai para Downloads e para a
// lista da Música (decisão de 2026-10-28: sem escolher pasta).
(function () {
  "use strict";
  var ESTE = document.currentScript ? document.currentScript.src : location.href;
  var $ = function (id) { return document.getElementById(id); };
  var t = InkIdioma.t;
  var KBPS = 48000;
  var gravador = null, fluxo = null;
  var partes = [], bytes = 0, inicio = 0, relogio = null, nomeArquivo = "";
  var ctx = null, analisador = null;

  // iPad/iPhone: o Safari até tem getDisplayMedia, mas nunca entrega o som; lá o caminho é a gravação de tela
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  var suporta = !ios && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
  var temMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  // modos: som do computador (Chrome/Edge), microfone, ou gravação de tela do iPad (o sistema grava; aqui só tira o som)
  var modo = suporta ? "sistema" : "tela";
  function escolherModo(m) {
    modo = m;
    [].forEach.call(document.querySelectorAll("#modos [data-modo]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.modo === m)); });
    $("cartao-sistema").classList.toggle("md-hide", m !== "sistema");
    $("sem-suporte").hidden = !(m === "sistema" && !suporta);
    $("cartao-tela").classList.toggle("md-hide", m !== "tela");
    if ($("cartao-audios")) $("cartao-audios").classList.toggle("md-hide", m !== "tela");
    $("cartao-gravar").classList.toggle("md-hide", m === "tela");
    $("dica-mic").classList.toggle("md-hide", m !== "mic");
    $("gravar").disabled = (m === "sistema" && !suporta) || (m === "mic" && !temMic);
    // sem isso o botão só fica parado, sem explicar (ex.: um app que não libera o microfone para sites)
    estado(m === "mic" && !temMic ? t("This browser or app does not give websites access to the microphone. Open this page in Safari.") : "", m === "mic" && !temMic);
  }
  $("modos").addEventListener("click", function (e) {
    var b = e.target.closest("[data-modo]");
    if (b && !gravador) escolherModo(b.dataset.modo);
  });
  if (ios) { var bs = document.querySelector('#modos [data-modo="sistema"]'); if (bs) bs.style.display = "none"; }
  escolherModo(modo);
  function estado(txt, aviso) { $("estado").textContent = txt || ""; $("estado").classList.toggle("aviso", !!aviso); }
  function hms(s) { s = Math.floor(s); return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function doisDig(n) { return String(n).padStart(2, "0"); }

  try { var n = localStorage.getItem("inkdoshub-gravador-nome"); if (n) $("nome").value = n; } catch (_) {}

  /* ---------- Gravar ---------- */
  function nomeSeguro(valor) {
    return String(valor || "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim().slice(0, 100) || t("Recording");
  }
  function nomeNovo() {
    var d = new Date(), base = nomeSeguro($("nome").value);
    $("nome").value = base;
    try { localStorage.setItem("inkdoshub-gravador-nome", base); } catch (_) {}
    return base + " " + d.getFullYear() + "-" + doisDig(d.getMonth() + 1) + "-" + doisDig(d.getDate()) + " " + doisDig(d.getHours()) + "-" + doisDig(d.getMinutes()) + ".webm";
  }
  $("gravar").onclick = async function () {
    estado("");
    try {
      if (modo === "mic") fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      else fluxo = await navigator.mediaDevices.getDisplayMedia({
        video: true, // o Chrome exige vídeo para mostrar a escolha; ele não é gravado
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include",
      });
    } catch (e) {
      if (modo === "mic" && e && e.name === "NotAllowedError") estado(t("Microphone access was denied. Allow it for this site (on the iPad: Settings › Apps › Safari › Microphone) and try again."), true);
      else if (e && e.name !== "NotAllowedError" && e.name !== "AbortError") estado(String(e.message || e), true);
      return;
    }
    var faixas = fluxo.getAudioTracks();
    if (!faixas.length) {
      fluxo.getTracks().forEach(function (f) { f.stop(); });
      estado(t("No sound was shared. Try again and turn on “Also share tab audio” or “Also share system audio”."), true);
      return;
    }
    var audio = new MediaStream(faixas);
    var tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0];
    nomeArquivo = nomeNovo();
    if (/mp4/.test(tipo || "")) nomeArquivo = nomeArquivo.replace(/\.webm$/, ".m4a");
    partes = []; bytes = 0;
    var opcoes = { audioBitsPerSecond: KBPS };
    if (tipo) opcoes.mimeType = tipo;
    try { gravador = new MediaRecorder(audio, opcoes); }
    catch (e) {
      fluxo.getTracks().forEach(function (f) { f.stop(); }); fluxo = null; gravador = null;
      $("nome").disabled = false;
      estado(t("Could not start recording: {error}", { error: e && (e.name || e.message) || "MediaRecorder error" }), true);
      return;
    }
    gravador.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      bytes += e.data.size;
      partes.push(e.data);
    };
    gravador.onstop = terminar;
    gravador.onerror = function () {
      estado(t("Recording error; attempting to save the captured audio."), true);
      if (gravador && gravador.state !== "inactive") parar();
    };
    fluxo.getTracks().forEach(function (f) { f.onended = parar; });
    try { gravador.start(5000); }
    catch (e) {
      gravador = null;
      fluxo.getTracks().forEach(function (f) { f.stop(); }); fluxo = null;
      $("nome").disabled = false;
      estado(t("Could not start recording: {error}", { error: e && (e.name || e.message) || "MediaRecorder error" }), true);
      return;
    }
    inicio = Date.now();
    medir(audio);
    $("gravar").classList.add("md-hide"); $("parar").classList.remove("md-hide");
    $("nome").disabled = true;
    relogio = setInterval(function () {
      $("tempo").textContent = hms((Date.now() - inicio) / 1000);
      estado(t("Recording {name} · {size}", { name: nomeArquivo, size: inkTamanho(bytes) }));
    }, 1000);
  };

  function parar() {
    if (gravador && gravador.state !== "inactive") gravador.stop();
    if (fluxo) fluxo.getTracks().forEach(function (f) { f.stop(); });
  }
  $("parar").onclick = parar;

  function terminar() {
    clearInterval(relogio);
    if (ctx) { ctx.close().catch(function () {}); ctx = null; }
    $("nivel").style.width = "0";
    $("parar").classList.add("md-hide"); $("gravar").classList.remove("md-hide");
    $("nome").disabled = false;
    var tipo = (gravador && gravador.mimeType) || "audio/webm";
    gravador = null;
    if (fluxo) fluxo.getTracks().forEach(function (f) { f.stop(); });
    fluxo = null; analisador = null;
    var arq = new File(partes, tipo.indexOf("mp4") >= 0 ? nomeArquivo.replace(/\.webm$/, ".m4a") : nomeArquivo, { type: tipo.split(";")[0] });
    partes = [];
    inkBaixar(arq);
    InkBiblioteca("inkdoshub-musica").adicionar([arq]).catch(function () {});
    estado(t("Saved {name} ({size}) in Downloads and in the Music list.", { name: arq.name, size: inkTamanho(arq.size) }));
  }

  /* ---------- Nível do som (para ver que está captando) ---------- */
  function medir(stream) {
    try {
      ctx = new AudioContext();
      analisador = ctx.createAnalyser(); analisador.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analisador);
      var dados = new Uint8Array(analisador.fftSize);
      (function passo() {
        if (!ctx) return;
        analisador.getByteTimeDomainData(dados);
        var pico = 0;
        for (var i = 0; i < dados.length; i++) pico = Math.max(pico, Math.abs(dados[i] - 128));
        $("nivel").style.width = Math.min(100, pico / 128 * 140) + "%";
        setTimeout(passo, 150);
      })();
    } catch (_) {}
  }

  /* ---------- Gravação de tela do iPad: tirar só o som ---------- */
  $("escolher-tela").onclick = function () { $("arquivo-tela").click(); };
  $("arquivo-tela").onchange = function (e) {
    var arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    var est = $("estado-tela"), t0 = Date.now();
    est.classList.remove("aviso");
    est.textContent = t("Preparing (sound only)…");
    $("escolher-tela").disabled = true;
    function pronto(blob) {
      $("escolher-tela").disabled = false; $("nivel-tela").style.width = "0";
      var arq = new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + ".m4a", { type: "audio/mp4" });
      audios.adicionar([arq]).then(listarAudios);
      inkBaixar(arq);
      est.textContent = t("{name} ({size}) is ready below. The video was not stored here: if you no longer need it, delete it from Photos or Files.", { name: arq.name, size: inkTamanho(arq.size) });
    }
    // caminho rápido: copia só o som do MP4/MOV, sem o conversor
    if (!window.inkExtrairM4a) return lento();
    inkExtrairM4a(arquivo, function (parte) {
      $("nivel-tela").style.width = Math.round(parte * 100) + "%";
      est.textContent = t("Extracting the sound · {percent}% · {seconds} s", { percent: Math.round(parte * 100), seconds: Math.round((Date.now() - t0) / 1000) });
    }).then(pronto, function () {
      est.textContent = t("Loading the converter (slow only the first time)…");
      lento();
    });
    function lento() {
    var v = document.createElement("video"), u = URL.createObjectURL(arquivo), feito = false;
    function comecar(dur) {
      if (feito) return; feito = true;
      URL.revokeObjectURL(u);
      var w = new Worker(new URL("../video/cortar/cortar-worker.js?v=3", ESTE), { type: "module" });
      w.onerror = function () {
        w.terminate(); $("escolher-tela").disabled = false;
        est.classList.add("aviso"); est.textContent = t("This video has no sound, or its sound could not be read.");
      };
      w.onmessage = function (ev) {
        var d = ev.data;
        if (d.tipo === "progresso") {
          if (dur) $("nivel-tela").style.width = Math.round(d.parte * 100) + "%";
          est.textContent = t("Extracting the sound · {percent}% · {seconds} s", { percent: Math.round(d.parte * 100), seconds: Math.round((Date.now() - t0) / 1000) });
        }
        if (d.tipo === "erro") {
          w.terminate(); $("escolher-tela").disabled = false;
          est.classList.add("aviso");
          est.textContent = d.codigo === "semaudio" ? t("This video has no sound, or its sound could not be read.") : d.texto;
        }
        if (d.tipo === "pronto") {
          w.terminate(); pronto(d.blob);
        }
      };
      w.postMessage({ arquivo: arquivo, ini: 0, fim: dur || 360000, som: true, soSom: true, altura: 0 });
    }
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = function () { comecar(isFinite(v.duration) ? v.duration : 0); };
    v.onerror = function () { comecar(0); };
    setTimeout(function () { comecar(0); }, 8000);
    v.src = u;
    }
  };

  /* ---------- Pasta temporária da página: os sons tirados das gravações de tela ---------- */
  var audios = InkBiblioteca("inkdoshub-gravador-audios");
  function botao(texto, fn) {
    var b = document.createElement("button");
    b.className = "ink-btn"; b.type = "button"; b.textContent = t(texto); b.onclick = fn;
    return b;
  }
  function listarAudios() {
    return audios.listar().then(function (itens) {
      var caixa = $("lista-audios");
      if (!caixa) return;
      caixa.textContent = "";
      $("vazio-audios").hidden = itens.length > 0;
      document.documentElement.classList.toggle("md-sem-audios", !itens.length);
      itens.sort(function (a, b) { return b.data - a.data; }).forEach(function (i) {
        var arq = new File([i.blob], i.nome, { type: i.tipo || "audio/mp4" });
        var linha = document.createElement("div"), nome = document.createElement("span"), info = document.createElement("small");
        linha.className = "item"; nome.className = "nome"; nome.setAttribute("data-idioma-nao", "");
        nome.textContent = i.nome;
        info.textContent = inkTamanho(i.tamanho) + " · " + new Date(i.data).toLocaleString(window.InkIdioma ? InkIdioma.atual : undefined);
        nome.appendChild(info); linha.appendChild(nome);
        if (navigator.canShare && navigator.canShare({ files: [arq] })) {
          linha.appendChild(botao("Share", function () { navigator.share({ files: [arq] }).catch(function () {}); }));
        }
        linha.appendChild(botao("Download", function () { inkBaixar(arq); }));
        linha.appendChild(botao("Delete", function () { audios.remover(i.id).then(listarAudios); }));
        caixa.appendChild(linha);
      });
    }).catch(function () {});
  }
  listarAudios();

  addEventListener("beforeunload", function (e) { if (gravador) { e.preventDefault(); e.returnValue = ""; } });
})();
