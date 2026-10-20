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
  if (!suporta) { $("sem-suporte").hidden = false; $("gravar").disabled = true; }
  var temPasta = !!window.showDirectoryPicker;
  if (!temPasta) { $("linha-pasta").classList.add("md-hide"); $("nota-pasta").textContent = t("The file goes to Downloads and to the Music list."); }

  function estado(txt, aviso) { $("estado").textContent = txt || ""; $("estado").classList.toggle("aviso", !!aviso); }
  function hms(s) { s = Math.floor(s); return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function doisDig(n) { return String(n).padStart(2, "0"); }

  /* ---------- Pasta (guardada no IndexedDB para a próxima vez) ---------- */
  function banco() {
    return new Promise(function (ok, erro) {
      var r = indexedDB.open("inkterminal-gravador", 1);
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
    window.showDirectoryPicker({ id: "inkterminal-gravador", mode: "readwrite", startIn: "music" }).then(function (p) {
      pasta = p; cfg("pasta", p); mostrarPasta();
    }).catch(function () {});
  };
  try { var n = localStorage.getItem("inkterminal-gravador-nome"); if (n) $("nome").value = n; } catch (_) {}

  /* ---------- Gravar ---------- */
  function nomeNovo() {
    var d = new Date(), base = ($("nome").value || "").replace(/[\\/:*?"<>|]/g, "").trim() || t("Recording");
    try { localStorage.setItem("inkterminal-gravador-nome", base); } catch (_) {}
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
      fluxo = await navigator.mediaDevices.getDisplayMedia({
        video: true, // o Chrome exige vídeo para mostrar a escolha; ele não é gravado
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        systemAudio: "include", selfBrowserSurface: "exclude", surfaceSwitching: "include",
      });
    } catch (e) {
      if (e && e.name !== "NotAllowedError" && e.name !== "AbortError") estado(String(e.message || e), true);
      return;
    }
    var faixas = fluxo.getAudioTracks();
    if (!faixas.length) {
      fluxo.getTracks().forEach(function (f) { f.stop(); });
      estado(t("No sound was shared. Try again and turn on “Also share tab audio” or “Also share system audio”."), true);
      return;
    }
    var audio = new MediaStream(faixas);
    nomeArquivo = nomeNovo(); partes = []; bytes = 0; erroEscrita = null; fila = Promise.resolve(); gravavel = null;
    if (usarPasta) {
      try { gravavel = await (await pasta.getFileHandle(nomeArquivo, { create: true })).createWritable(); }
      catch (e) { gravavel = null; estado(t("Could not write to the folder; the file will go to Downloads."), true); }
    }
    var tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0];
    gravador = new MediaRecorder(audio, { mimeType: tipo, audioBitsPerSecond: KBPS });
    gravador.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      bytes += e.data.size;
      if (gravavel) fila = fila.then(function () { return gravavel.write(e.data); }).catch(function (err) { erroEscrita = err; });
      else partes.push(e.data);
    };
    gravador.onstop = terminar;
    fluxo.getTracks().forEach(function (f) { f.onended = parar; });
    gravador.start(5000);
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
    gravador = null; fluxo = null;
    if (gravavel) {
      await fila;
      try { await gravavel.close(); } catch (e) { erroEscrita = erroEscrita || e; }
      gravavel = null;
      if (!erroEscrita) { estado(t("Saved {name} ({size}) in the folder {folder}.", { name: nomeArquivo, size: inkTamanho(bytes), folder: pasta.name })); return; }
      estado(t("The folder could not be written. Nothing was lost only if the file in the folder is complete; check it."), true);
      return;
    }
    var arq = new File(partes, tipo.indexOf("mp4") >= 0 ? nomeArquivo.replace(/\.webm$/, ".m4a") : nomeArquivo, { type: tipo.split(";")[0] });
    partes = [];
    var a = document.createElement("a"), u = URL.createObjectURL(arq);
    a.href = u; a.download = arq.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    InkBiblioteca("inkterminal-musica").adicionar([arq]).catch(function () {});
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

  addEventListener("beforeunload", function (e) { if (gravador) { e.preventDefault(); e.returnValue = ""; } });
  if (temPasta) mostrarPasta();
})();
