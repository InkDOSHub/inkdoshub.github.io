// Offline transcription (AI): whisper.cpp compiled to WebAssembly (apps/gravador/whisper/, built by
// .github/workflows/whisper.yml). The model (quantized tiny or base) is downloaded once from Hugging
// Face and kept in the browser cache. Audio is decoded to 16 kHz mono and processed in 10-minute
// parts so memory stays low on the iPad. Needs cross-origin isolation (threads).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var t = InkIdioma.t;
  var BASE = new URL("whisper/", document.currentScript.src).href, V = "?v=2";
  var MODELOS = {
    tiny: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
    base: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin"
  };
  var PARTE = 16000 * 600; // 10 minutes
  var motor = null, instancia = 0, modeloAtual = "", ocupado = false;
  var segmentos = [], deslocamento = 0, fimParte = null, durParte = 1, nomeBase = "transcription";

  function estado(txt, aviso) { $("tr-estado").textContent = txt || ""; $("tr-estado").classList.toggle("aviso", !!aviso); }
  function barra(p) { $("tr-nivel").style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + "%"; }
  try { var g = JSON.parse(localStorage.getItem("inkdoshub-transcricao") || "{}"); if (g.m) $("tr-modelo").value = g.m; if (g.l) $("tr-idioma").value = g.l; } catch (_) {}
  function guardar() { try { localStorage.setItem("inkdoshub-transcricao", JSON.stringify({ m: $("tr-modelo").value, l: $("tr-idioma").value })); } catch (_) {} }
  $("tr-modelo").onchange = guardar; $("tr-idioma").onchange = guardar;

  // whisper prints each segment as "[00:00:01.000 --> 00:00:04.000]  text"; the end of a run as "total time"
  var RX = /^\[(\d+):(\d\d):(\d\d)\.(\d{3}) --> (\d+):(\d\d):(\d\d)\.(\d{3})\]\s*(.*)$/;
  function seg(h, m, s, ms) { return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000; }
  function saida(linha) {
    linha = String(linha);
    var r = RX.exec(linha);
    if (r) {
      var a = seg(r[1], r[2], r[3], r[4]), b = seg(r[5], r[6], r[7], r[8]), txt = r[9].trim();
      if (txt) {
        segmentos.push({ a: a + deslocamento, b: b + deslocamento, txt: txt });
        mostrar();
      }
      if (progresso) progresso(b / durParte);
    } else if (/total time/.test(linha) && fimParte) {
      var f = fimParte; fimParte = null; f();
    }
  }
  var progresso = null;

  function carregarMotor() {
    if (motor) return motor;
    motor = new Promise(function (ok, erro) {
      window.Module = {
        print: saida, printErr: saida,
        locateFile: function (p) { return BASE + p + V; },
        mainScriptUrlOrBlob: BASE + "libmain.js" + V,
        onRuntimeInitialized: function () { ok(window.Module); }
      };
      var s = document.createElement("script");
      s.src = BASE + "libmain.js" + V;
      s.onerror = function () { motor = null; erro(new Error(t("The transcription engine is not installed yet."))); };
      document.head.appendChild(s);
    });
    return motor;
  }

  // model: from the browser cache, or downloaded once with progress
  function baixarModelo(nome) {
    var url = MODELOS[nome], cache = null;
    var abrir = window.caches ? caches.open("inkdoshub-whisper").catch(function () { return null; }) : Promise.resolve(null);
    return abrir.then(function (c) {
      cache = c;
      return c ? c.match(url) : null;
    }).then(function (r) {
      if (r) return r.arrayBuffer();
      estado(t("Downloading the model (only the first time)…"));
      return fetch(url, { mode: "cors" }).then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        var total = +resp.headers.get("content-length") || 0, lidos = 0, partes = [], leitor = resp.body.getReader();
        return (function ler() {
          return leitor.read().then(function (p) {
            if (p.done) {
              var blob = new Blob(partes);
              if (cache) cache.put(url, new Response(blob)).catch(function () {});
              return blob.arrayBuffer();
            }
            partes.push(p.value); lidos += p.value.length;
            if (total) { barra(lidos / total); estado(t("Downloading the model (only the first time)… {percent}%", { percent: Math.round(lidos / total * 100) })); }
            return ler();
          });
        })();
      });
    });
  }

  function prepararModelo(M, nome) {
    if (instancia && modeloAtual === nome) return Promise.resolve();
    return baixarModelo(nome).then(function (buf) {
      if (instancia) { M.free(instancia); instancia = 0; }
      try { M.FS_unlink("/whisper.bin"); } catch (_) {}
      M.FS_createDataFile("/", "whisper.bin", new Uint8Array(buf), true, true);
      instancia = M.init("/whisper.bin");
      try { M.FS_unlink("/whisper.bin"); } catch (_) {}
      if (!instancia) throw new Error(t("Could not load the model."));
      modeloAtual = nome;
    });
  }

  // any audio or video the browser can play, as 16 kHz mono
  function decodificar(arquivo) {
    return arquivo.arrayBuffer().then(function (buf) {
      var C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var ctx = new C(1, 16000, 16000);
      return new Promise(function (ok, erro) {
        var p = ctx.decodeAudioData(buf, ok, erro);
        if (p && p.then) p.then(ok, erro);
      });
    }).then(function (ab) {
      if (ab.numberOfChannels === 1) return ab.getChannelData(0);
      var mono = new Float32Array(ab.length), n = ab.numberOfChannels;
      for (var c = 0; c < n; c++) { var d = ab.getChannelData(c); for (var i = 0; i < d.length; i++) mono[i] += d[i] / n; }
      return mono;
    });
  }

  function rodarParte(M, audio, ini) {
    return new Promise(function (ok, erro) {
      deslocamento = ini / 16000;
      durParte = audio.length / 16000;
      fimParte = ok;
      var threads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2));
      var r = M.full_default(instancia, audio, $("tr-idioma").value, threads, false);
      if (r !== 0) { fimParte = null; erro(new Error(t("Transcription failed ({code}).", { code: r }))); }
    });
  }

  function mostrar() {
    var caixa = $("tr-texto");
    caixa.hidden = false;
    caixa.value = segmentos.map(function (s) { return s.txt; }).join("\n");
    caixa.scrollTop = caixa.scrollHeight;
    $("tr-acoes").hidden = !segmentos.length;
  }

  function transcrever(arquivo) {
    if (ocupado || !arquivo) return;
    if (!window.crossOriginIsolated) { estado(t("Transcription needs multithreading, which this page does not have here. Reload the page and try again."), true); return; }
    ocupado = true; $("tr-escolher").disabled = true;
    nomeBase = arquivo.name.replace(/\.[^.]+$/, "") || "transcription";
    segmentos = []; mostrar(); $("tr-texto").hidden = true; barra(0);
    var t0 = Date.now(), M, audio;
    estado(t("Loading the engine…"));
    carregarMotor().then(function (m) {
      M = m;
      return prepararModelo(M, $("tr-modelo").value);
    }).then(function () {
      barra(0); estado(t("Reading the sound…"));
      return decodificar(arquivo);
    }).then(function (a) {
      audio = a;
      var total = audio.length, ini = 0;
      function proxima() {
        if (ini >= total) return Promise.resolve();
        var fim = Math.min(total, ini + PARTE), inicioParte = ini;
        progresso = function (p) {
          barra((inicioParte + p * (fim - inicioParte)) / total);
          estado(t("Transcribing · {percent}% · {seconds} s", { percent: Math.round((inicioParte + p * (fim - inicioParte)) / total * 100), seconds: Math.round((Date.now() - t0) / 1000) }));
        };
        progresso(0);
        return rodarParte(M, audio.slice(ini, fim), ini).then(function () { ini = fim; return proxima(); });
      }
      return proxima();
    }).then(function () {
      barra(1);
      estado(segmentos.length ? t("Done in {seconds} s.", { seconds: Math.round((Date.now() - t0) / 1000) }) : t("No speech was found."));
    }, function (e) {
      estado(e && e.message ? e.message : String(e), true);
    }).then(function () { ocupado = false; progresso = null; audio = null; $("tr-escolher").disabled = false; });
  }
  window.inkTranscrever = transcrever;

  $("tr-escolher").onclick = function () { $("tr-arquivo").click(); };
  $("tr-arquivo").onchange = function (e) { var f = e.target.files[0]; e.target.value = ""; transcrever(f); };

  function hora(s, sep) {
    var ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, ss = Math.floor(ms / 1000) % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0") + sep + String(ms % 1000).padStart(3, "0");
  }
  $("tr-copiar").onclick = function () {
    var txt = $("tr-texto").value;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { estado(t("Copied.")); }, function () { $("tr-texto").select(); });
  };
  $("tr-txt").onclick = function () {
    inkBaixar(new File([$("tr-texto").value + "\n"], nomeBase + ".txt", { type: "text/plain" }));
  };
  $("tr-srt").onclick = function () {
    var srt = segmentos.map(function (s, i) { return (i + 1) + "\n" + hora(s.a, ",") + " --> " + hora(s.b, ",") + "\n" + s.txt + "\n"; }).join("\n");
    inkBaixar(new File([srt], nomeBase + ".srt", { type: "application/x-subrip" }));
  };
})();
