// Gravador de som do computador: getDisplayMedia (aba ou tela inteira com o som do sistema) e
// MediaRecorder só com o áudio, em Opus (.webm, ~22 MB por hora). Funciona no Chrome e no Edge do
// Windows; o Safari não oferece captura de outras janelas. Com uma pasta escolhida (File System
// Access), o arquivo é gravado em partes enquanto grava, sem guardar a aula inteira na memória.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var t = InkIdioma.t;
  var KBPS = 48000;
  var pasta = null, gravador = null, fluxo = null, gravavel = null, fila = Promise.resolve();
  var partes = [], bytes = 0, inicio = 0, relogio = null, nomeArquivo = "", erroEscrita = null;
  var ctx = null, analisador = null;

  var suporta = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
  var temMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  // modos: som do computador (Chrome/Edge), microfone, ou gravação de tela do iPad (o sistema grava; aqui só tira o som)
  var modo = suporta ? "sistema" : "tela";
  function escolherModo(m) {
    modo = m;
    [].forEach.call(document.querySelectorAll("#modos [data-modo]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.modo === m)); });
    $("cartao-sistema").classList.toggle("md-hide", m !== "sistema");
    $("sem-suporte").hidden = !(m === "sistema" && !suporta);
    $("cartao-tela").classList.toggle("md-hide", m !== "tela");
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
  escolherModo(modo);
  var temPasta = !!window.showDirectoryPicker;
  if (!temPasta) { $("linha-pasta").classList.add("md-hide"); $("nota-pasta").textContent = t("The file goes to Downloads and to the Music list."); }

  function estado(txt, aviso) { $("estado").textContent = txt || ""; $("estado").classList.toggle("aviso", !!aviso); }
  function hms(s) { s = Math.floor(s); return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function doisDig(n) { return String(n).padStart(2, "0"); }

  /* ---------- Pasta (guardada no IndexedDB para a próxima vez) ---------- */
  function banco() {
    return new Promise(function (ok, erro) {
      var r = indexedDB.open("inkdoshub-gravador", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("cfg"); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
    });
  }
  function cfg(chave, valor) {
    return banco().then(function (db) {
      return new Promise(function (ok, erro) {
        var tx = db.transaction("cfg", valor === undefined ? "readonly" : "readwrite"), s = tx.objectStore("cfg");
        var r = valor === undefined ? s.get(chave) : s.put(valor, chave);
        tx.oncomplete = function () { ok(r.result); }; tx.onerror = function () { erro(tx.error); };
      });
    }).catch(function () { return undefined; });
  }
  function mostrarPasta() { $("pasta").textContent = pasta ? pasta.name : t("Downloads (no folder chosen)"); }
  if (temPasta) cfg("pasta").then(function (p) { pasta = p || null; mostrarPasta(); });
  $("escolher").onclick = function () {
    window.showDirectoryPicker({ id: "inkdoshub-gravador", mode: "readwrite", startIn: "music" }).then(function (p) {
      pasta = p; cfg("pasta", p); mostrarPasta();
    }).catch(function () {});
  };
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
  async function permissaoPasta() {
    if (!pasta) return false;
    try {
      var o = { mode: "readwrite" };
      if ((await pasta.queryPermission(o)) === "granted") return true;
      return (await pasta.requestPermission(o)) === "granted";
    } catch (_) { return false; }
  }

  $("gravar").onclick = async function () {
    estado("");
    var usarPasta = await permissaoPasta();
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
    // Use a extensão real antes de criar o arquivo na pasta escolhida.
    if (/mp4/.test(tipo || "")) nomeArquivo = nomeArquivo.replace(/\.webm$/, ".m4a");
    partes = []; bytes = 0; erroEscrita = null; fila = Promise.resolve(); gravavel = null;
    if (usarPasta) {
      try { gravavel = await (await pasta.getFileHandle(nomeArquivo, { create: true })).createWritable(); }
      catch (e) { gravavel = null; estado(t("Could not write to the folder; the file will go to Downloads."), true); }
    }
    var opcoes = { audioBitsPerSecond: KBPS };
    if (tipo) opcoes.mimeType = tipo;
    try { gravador = new MediaRecorder(audio, opcoes); }
    catch (e) {
      fluxo.getTracks().forEach(function (f) { f.stop(); }); fluxo = null; gravador = null;
      if (gravavel) { try { await gravavel.abort(); } catch (_) {} gravavel = null; }
      $("nome").disabled = false; $("escolher").disabled = false;
      estado(t("Could not start recording: {error}", { error: e && (e.name || e.message) || "MediaRecorder error" }), true);
      return;
    }
    gravador.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      bytes += e.data.size;
      if (gravavel) fila = fila.then(function () { return gravavel.write(e.data); }).catch(function (err) { erroEscrita = err; });
      else partes.push(e.data);
    };
    gravador.onstop = terminar;
    gravador.onerror = function () {
      estado(t("Recording error; attempting to save the captured audio."), true);
      if (gravador && gravador.state !== "inactive") parar();
    };
    fluxo.getTracks().forEach(function (f) { f.onended = parar; });
    try { gravador.start(5000); }
    catch (e) {
      var falhou = gravador; gravador = null;
      fluxo.getTracks().forEach(function (f) { f.stop(); }); fluxo = null;
      if (gravavel) { try { await gravavel.abort(); } catch (_) {} gravavel = null; }
      $("nome").disabled = false; $("escolher").disabled = false;
      estado(t("Could not start recording: {error}", { error: e && (e.name || e.message) || "MediaRecorder error" }), true);
      return;
    }
    inicio = Date.now();
    medir(audio);
    $("gravar").classList.add("md-hide"); $("parar").classList.remove("md-hide");
    $("nome").disabled = true; $("escolher").disabled = true;
    relogio = setInterval(function () {
      $("tempo").textContent = hms((Date.now() - inicio) / 1000);
      estado(t("Recording {name} · {size}", { name: nomeArquivo, size: inkTamanho(bytes) }) + (erroEscrita ? " · " + t("error writing to the folder") : ""), !!erroEscrita);
    }, 1000);
  };

  function parar() {
    if (gravador && gravador.state !== "inactive") gravador.stop();
    if (fluxo) fluxo.getTracks().forEach(function (f) { f.stop(); });
  }
  $("parar").onclick = parar;

  async function terminar() {
    clearInterval(relogio);
    if (ctx) { ctx.close().catch(function () {}); ctx = null; }
    $("nivel").style.width = "0";
    $("parar").classList.add("md-hide"); $("gravar").classList.remove("md-hide");
    $("nome").disabled = false; $("escolher").disabled = false;
    var tipo = (gravador && gravador.mimeType) || "audio/webm";
    gravador = null;
    if (fluxo) fluxo.getTracks().forEach(function (f) { f.stop(); });
    fluxo = null; analisador = null;
    if (gravavel) {
      await fila;
      try { await gravavel.close(); } catch (e) { erroEscrita = erroEscrita || e; }
      gravavel = null;
      if (!erroEscrita) { estado(t("Saved {name} ({size}) in the folder {folder}.", { name: nomeArquivo, size: inkTamanho(bytes), folder: pasta.name })); return; }
      estado(t("Writing failed. Check the partial file in the selected folder; a complete save could not be guaranteed."), true);
      return;
    }
    var arq = new File(partes, tipo.indexOf("mp4") >= 0 ? nomeArquivo.replace(/\.webm$/, ".m4a") : nomeArquivo, { type: tipo.split(";")[0] });
    partes = [];
    var a = document.createElement("a"), u = URL.createObjectURL(arq);
    a.href = u; a.download = arq.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
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
    var v = document.createElement("video"), u = URL.createObjectURL(arquivo), feito = false;
    function comecar(dur) {
      if (feito) return; feito = true;
      URL.revokeObjectURL(u);
      var w = new Worker("../../video/cortar/cortar-worker.js?v=3", { type: "module" });
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
          w.terminate(); $("escolher-tela").disabled = false; $("nivel-tela").style.width = "0";
          var arq = new File([d.blob], arquivo.name.replace(/\.[^.]+$/, "") + d.ext, { type: d.blob.type });
          InkBiblioteca("inkdoshub-musica").adicionar([arq]).then(function (novos) {
            try { localStorage.setItem("inkdoshub-musica-atual", String(novos[0].id)); } catch (_) {}
          });
          est.textContent = t("{name} ({size}) is in the Music list. The video was not stored here: if you no longer need it, delete it from Photos or Files.", { name: arq.name, size: inkTamanho(arq.size) });
          if (navigator.canShare && navigator.canShare({ files: [arq] })) navigator.share({ files: [arq] }).catch(function () {});
        }
      };
      w.postMessage({ arquivo: arquivo, ini: 0, fim: dur || 360000, som: true, soSom: true, altura: 0 });
    }
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = function () { comecar(isFinite(v.duration) ? v.duration : 0); };
    v.onerror = function () { comecar(0); };
    setTimeout(function () { comecar(0); }, 8000);
    v.src = u;
  };

  addEventListener("beforeunload", function (e) { if (gravador) { e.preventDefault(); e.returnValue = ""; } });
  if (temPasta) mostrarPasta();
})();
