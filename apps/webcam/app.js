/* Webcam do InkDOS Hub (versão de teste).

   O iPhone (Host) manda a câmera para o PC (Guest) por WebRTC, direto de um aparelho para o outro.
   O pareamento usa o servidor público do PeerJS (lib/peerjs.min.js): o Guest se registra como
   "inkdoshub-webcam-<código>" e mostra um QR code com ?host=<código>; o Host liga para ele.
   No PC, a imagem vira webcam do Windows pelo OBS (fonte de navegador com ?guest=<código>&obs=1 e
   "Iniciar câmera virtual").

   Endereços: ?host=<código> abre o Host; ?guest=<código> abre o Guest com esse código; &obs=1 mostra só
   a imagem. */
(function () {
  "use strict";
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) {
    return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in p ? p[k] : m; }) : s;
  };
  var $ = function (id) { return document.getElementById(id); };
  var PREFIXO = "inkdoshub-webcam-";
  var CHAVE_CODIGO = "inkdoshub-webcam-codigo";
  var CHAVE_HOST = "inkdoshub-webcam-host";
  var LETRAS = "abcdefghjkmnpqrstuvwxyz23456789";
  var BASE = location.origin + location.pathname;
  var QUALIDADES = {
    "2160p60": { w: 3840, h: 2160, fps: 60, bps: 40e6 },
    "2160p30": { w: 3840, h: 2160, fps: 30, bps: 25e6 },
    "1080p60": { w: 1920, h: 1080, fps: 60, bps: 15e6 },
    "1080p30": { w: 1920, h: 1080, fps: 30, bps: 8e6 },
    "720p60": { w: 1280, h: 720, fps: 60, bps: 6e6 },
    "720p30": { w: 1280, h: 720, fps: 30, bps: 4e6 },
  };
  var q = new URLSearchParams(location.search);
  // window.obsstudio existe dentro da fonte de navegador do OBS: lá mostra só a imagem, mesmo sem &obs=1
  // app de Windows (windows/webcam/): a página roda dentro dele, num WebView2
  var app = !!(window.chrome && window.chrome.webview);
  var obs = q.get("obs") === "1" || !!window.obsstudio || app;
  if (obs) document.body.classList.add("obs");
  if (app) document.body.classList.add("app-webcam");
  // app de Windows (sempre no receptor nativo): o próprio app recebe o vídeo (GStreamer); a página só mostra o QR e o estado
  var nativo = app && q.get("nativo") === "1";
  if (nativo) document.body.classList.add("nativo");

  function ler(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function limpo(c) { return String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10); }
  function novoCodigo() {
    var s = "", a = new Uint32Array(10);
    crypto.getRandomValues(a);
    for (var i = 0; i < 10; i++) s += LETRAS[a[i] % LETRAS.length];
    return s;
  }
  function mostrar(id) {
    ["escolha", "guest", "host"].forEach(function (x) { $(x).hidden = x !== id; });
    $("btroca").hidden = id === "escolha" || obs;
  }
  function mbps(b) { return (b / 1e6).toFixed(1) + " Mbps"; }

  /* ---------- SDP: codec preferido e limite de bitrate ---------- */
  function secaoVideo(linhas) {
    var ini = -1, fim = linhas.length;
    for (var i = 0; i < linhas.length; i++) {
      if (linhas[i].indexOf("m=video") === 0) ini = i;
      else if (ini >= 0 && linhas[i].indexOf("m=") === 0) { fim = i; break; }
    }
    return [ini, fim];
  }
  function ajustarSdp(sdp, codec, bps) {
    var linhas = sdp.split("\r\n"), s = secaoVideo(linhas), ini = s[0], fim = s[1];
    if (ini < 0) return sdp;
    var escolhidos = [], rtx = [], fmtp = {};
    for (var i = ini; i < fim; i++) {
      var f = /^a=fmtp:(\d+) (.*)$/.exec(linhas[i]);
      if (f) fmtp[f[1]] = f[2];
    }
    for (i = ini; i < fim; i++) {
      var m = /^a=rtpmap:(\d+) ([\w-]+)\//.exec(linhas[i]);
      if (m && codec && m[2].toUpperCase() === codec) escolhidos.push(m[1]);
    }
    if (codec === "H264") {
      // primeiro o perfil High com packetization-mode=1, que dá mais qualidade por bit
      var nota = function (pt) {
        var p = fmtp[pt] || "";
        return (/packetization-mode=1/.test(p) ? 2 : 0) + (/profile-level-id=64/i.test(p) ? 1 : 0);
      };
      escolhidos.sort(function (a, b) { return nota(b) - nota(a); });
    }
    Object.keys(fmtp).forEach(function (pt) {
      var a = /apt=(\d+)/.exec(fmtp[pt]);
      if (a && escolhidos.indexOf(a[1]) >= 0) rtx.push(pt);
    });
    if (escolhidos.length) {
      var partes = linhas[ini].split(" "), cab = partes.slice(0, 3), lista = partes.slice(3);
      var frente = escolhidos.concat(rtx);
      linhas[ini] = cab.concat(frente, lista.filter(function (p) { return frente.indexOf(p) < 0; })).join(" ");
    }
    if (bps) {
      for (i = fim - 1; i > ini; i--) if (/^b=(AS|TIAS):/.test(linhas[i])) { linhas.splice(i, 1); fim--; }
      // b= vem logo depois de c= (ou da linha m=)
      var pos = ini + 1;
      for (i = ini + 1; i < fim; i++) if (linhas[i].indexOf("c=") === 0) { pos = i + 1; break; }
      linhas.splice(pos, 0, "b=AS:" + Math.round(bps / 1000), "b=TIAS:" + Math.round(bps));
      fim += 2;
      // o WebRTC começa em ~300 kbps e sobe aos poucos; isto faz começar perto da qualidade pedida
      var inicio = "x-google-start-bitrate=" + Math.round(bps / 2000) + ";x-google-max-bitrate=" + Math.round(bps / 1000);
      linhas[ini].split(" ").slice(3).forEach(function (pt) {
        var achou = false;
        for (var j = ini; j < fim; j++) {
          if (linhas[j].indexOf("a=fmtp:" + pt + " ") === 0) {
            achou = true;
            if (!/apt=/.test(linhas[j]) && !/x-google-/.test(linhas[j])) linhas[j] += ";" + inicio;
          }
        }
        if (!achou) for (j = ini; j < fim; j++) if (linhas[j].indexOf("a=rtpmap:" + pt + " ") === 0 && !/(red|ulpfec|flexfec)/i.test(linhas[j])) { linhas.splice(j + 1, 0, "a=fmtp:" + pt + " " + inicio); fim++; break; }
      });
    }
    return linhas.join("\r\n");
  }

  /* ---------- Estatísticas ---------- */
  function lerStats(pc, tipo, ant, cb) {
    pc.getStats().then(function (r) {
      var rtp = null, codec = "", par = null, tipos = {};
      r.forEach(function (s) {
        if (s.type === tipo && s.kind === "video") rtp = s;
        if (s.type === "candidate-pair" && (s.nominated || s.selected) && s.state === "succeeded") par = s;
        tipos[s.id] = s;
      });
      if (!rtp) return cb(null);
      if (rtp.codecId && tipos[rtp.codecId]) codec = tipos[rtp.codecId].mimeType.replace("video/", "");
      var bytes = tipo === "outbound-rtp" ? rtp.bytesSent : rtp.bytesReceived, agora = rtp.timestamp;
      var taxa = ant && ant.t ? (bytes - ant.b) * 8 / ((agora - ant.t) / 1000) : 0;
      var rede = "";
      if (par) {
        var loc = tipos[par.localCandidateId], rem = tipos[par.remoteCandidateId];
        var tp = [loc && loc.candidateType, rem && rem.candidateType];
        rede = tp.indexOf("relay") >= 0 ? "relay" : tp.indexOf("srflx") >= 0 || tp.indexOf("prflx") >= 0 ? "internet (P2P)" : "local network";
        if (par.currentRoundTripTime) rede += " · " + Math.round(par.currentRoundTripTime * 1000) + " ms";
      }
      cb({ rtp: rtp, codec: codec, taxa: taxa, rede: rede, b: bytes, t: agora });
    }).catch(function () { cb(null); });
  }

  /* ---------- Guest (PC) ---------- */
  function guest(codigo) {
    mostrar("guest");
    codigo = limpo(codigo);
    if (!/^[a-z0-9]{10}$/.test(codigo)) codigo = limpo(ler(CHAVE_CODIGO)); // o app de Windows abre sem código: usa o salvo
    if (!/^[a-z0-9]{10}$/.test(codigo)) codigo = novoCodigo();
    gravar(CHAVE_CODIGO, codigo);
    if (q.get("guest") !== codigo) history.replaceState(null, "", "?guest=" + codigo + (obs ? "&obs=1" : "") + (nativo ? "&nativo=1" : ""));
    var video = $("vguest"), peer = null, chamada = null, ant = null, timer = 0, reconectarTimer = 0, encerrando = false, statsVisivel = false, reiniciando = false;
    var linkHost = BASE + "?host=" + codigo;
    $("gcodigo").textContent = codigo;
    $("linkobs").value = BASE + "?guest=" + codigo + "&obs=1";
    var qr = qrcode(0, "M");
    qr.addData(linkHost);
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    function estado(s) { $("gestado").textContent = s; }
    var bomba = app && !nativo ? bombaApp(video, function () { return formato; }, pedirQualidade) : null;
    /* App de Windows: pede ao iPhone a mesma resolução e fps da câmera escolhida no app, para o quadro
       chegar já no tamanho certo e ir pelo caminho rápido (sem redimensionar). */
    function pedirQualidade() {
      var alvo = bomba && bomba.alvo();
      if (alvo) avisarHost({ type: "inkdoshub-quality", w: alvo.w, h: alvo.h, fps: alvo.fps });
    }
    function avisarHost(msg) {
      var c = chamada;
      if (!c || !peer || !c.peer) return;
      try {
        var conn = peer.connect(c.peer, { reliable: true });
        conn.on("open", function () {
          try { conn.send(msg); } catch (_) {}
          setTimeout(function () { try { conn.close(); } catch (_) {} }, 1000);
        });
      } catch (_) {}
    }
    if (app) $("linkobs").closest("details").hidden = true;

    function conectar() {
      if (encerrando) return;
      peer = new Peer(PREFIXO + codigo, { debug: 0 });
      peer.on("open", function () { clearTimeout(reconectarTimer); reconectarTimer = 0; estado(t("Ready. Waiting for the iPhone…")); });
      peer.on("disconnected", function () {
        estado(t("Connecting to the pairing server…"));
        clearTimeout(reconectarTimer);
        function tentarReconectar() {
          var p = peer;
          if (encerrando || !p || p.destroyed) return;
          if (!p.disconnected) { reconectarTimer = 0; return; }
          try { p.reconnect(); } catch (_) {}
          reconectarTimer = setTimeout(tentarReconectar, 3000);
        }
        reconectarTimer = setTimeout(tentarReconectar, 1000);
      });
      peer.on("error", function (e) {
        if (e.type === "unavailable-id") {
          estado(t("This code is open in another window (another tab or OBS). Trying again…"));
          peer.destroy();
          setTimeout(conectar, 5000);
        } else if (e.type === "network" || e.type === "server-error" || e.type === "socket-error" || e.type === "socket-closed") {
          estado(t("No connection to the pairing server. Trying again…"));
          if (!peer.destroyed) { peer.destroy(); setTimeout(conectar, 4000); }
        }
      });
      peer.on("call", receber);
    }

    // Safari/WebKit pode receber e decodificar frames WebRTC sem iniciar o elemento <video>.
    // Reassocia o MediaStream e tenta reproduzir nos eventos de mídia, não só uma vez.
    function ligarVideo(stream, reiniciar) {
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      function tocar() {
        if (!stream || video.srcObject !== stream) return;
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
      video.onloadedmetadata = tocar;
      video.onloadeddata = tocar;
      video.oncanplay = tocar;
      if (reiniciar) {
        try { video.pause(); } catch (_) {}
        video.srcObject = null;
        requestAnimationFrame(function () {
          video.srcObject = stream;
          tocar();
          requestAnimationFrame(tocar);
        });
      } else {
        video.srcObject = stream;
        tocar();
      }
    }

    function receber(c) {
      // Um peer ID público não autentica o chamador: rejeite chamadas concorrentes e
      // trate todos os metadados recebidos como dados não confiáveis.
      if (chamada) {
        var anterior = chamada;
        var estadoAtual = anterior.peerConnection && anterior.peerConnection.connectionState;
        // Uma chamada presa em "disconnected" após modo avião também é obsoleta:
        // aceite a nova chamada do Host para que a reconexão possa se completar.
        // (ou um reinício pedido por esta página para tirar o atraso do buffer)
        if (estadoAtual !== "connected" || reiniciando) {
          reiniciando = false;
          chamada = null;
          try { anterior.close(); } catch (_) {}
        } else { try { c.close(); } catch (_) {} return; }
      }
      var recebido = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
      var codecs = ["H264", "H265", "VP9", "AV1", "VP8"];
      var codec = typeof recebido.codec === "string" ? recebido.codec.toUpperCase() : "VP8";
      var visualizacoes = ["preencher", "ajustar", "gira90", "gira270"];
      var meta = {
        codec: codecs.indexOf(codec) >= 0 ? codec : "VP8",
        bps: typeof recebido.bps === "number" && isFinite(recebido.bps) && recebido.bps >= 1000000 ? Math.min(40000000, Math.floor(recebido.bps)) : 0,
        view: visualizacoes.indexOf(recebido.view) >= 0 ? recebido.view : "preencher"
      };
      chamada = c;
      $("bparartransmissao").hidden = false;
      c.answer(undefined, { sdpTransform: function (sdp) { return ajustarSdp(sdp, meta.codec, meta.bps); } });
      estado(t("Connecting to the iPhone…"));
      formato = meta.view;
      aplicarFormato();
      c.on("stream", function (s) {
        if (chamada !== c) return;
        ligarVideo(s, false);
        pedirQualidade();
        $("parear").hidden = true;
        $("bparartransmissao").hidden = false;
        // menos atraso: o Chrome toca o quadro assim que chega
        try { c.peerConnection.getReceivers().forEach(function (r) { if ("jitterBufferTarget" in r) r.jitterBufferTarget = 0; else r.playoutDelayHint = 0; }); } catch (_) {}
        clearInterval(timer);
        ant = null;
        timer = setInterval(stats, 1000);
      });
      function fim() {
        if (chamada !== c) return;
        semChamada(t("The iPhone disconnected. Waiting for it again…"));
      }
      c.on("close", fim);
      c.on("error", fim);
      var pc = c.peerConnection;
      if (pc) pc.addEventListener("connectionstatechange", function () {
        if (pc.connectionState === "failed") { c.close(); fim(); }
      });
    }

    /* Fim da chamada (o iPhone saiu ou o PC parou): volta a mostrar o QR e a câmera mostra "esperando". */
    function semChamada(msg) {
      chamada = null;
      clearInterval(timer);
      video.srcObject = null;
      $("parear").hidden = false;
      $("bparartransmissao").hidden = true;
      $("gstats").hidden = true;
      estado(msg);
      if (bomba) bomba.espera();
    }

    /* Formato da imagem no PC: preencher 16:9 (corta), inteira, ou girada 90° para um lado. */
    var formato = "preencher";
    function aplicarFormato() {
      video.className = formato;
      var gira = formato === "gira90" || formato === "gira270", caixa = $("guest");
      video.style.width = gira ? caixa.clientHeight + "px" : "";
      video.style.height = gira ? caixa.clientWidth + "px" : "";
      video.style.transform = gira ? "translate(-50%,-50%) rotate(" + (formato === "gira90" ? 90 : -90) + "deg)" : "";
    }
    addEventListener("resize", aplicarFormato);

    function stats() {
      if (!chamada || !chamada.peerConnection) return;
      var c = chamada;
      lerStats(chamada.peerConnection, "inbound-rtp", ant, function (s) {
        if (!s) return;
        var a = ant && ant.rtp;
        ant = s;
        var r = s.rtp, atraso = 0, parado = false;
        // atraso do buffer AGORA (no último segundo), não a média desde o início
        if (a && r.jitterBufferEmittedCount > a.jitterBufferEmittedCount)
          atraso = Math.round((r.jitterBufferDelay - a.jitterBufferDelay) / (r.jitterBufferEmittedCount - a.jitterBufferEmittedCount) * 1000);
        // pacotes chegando sem quadro nenhum sair do buffer: o PC está atrás (conta como atraso)
        else if (a && r.packetsReceived > a.packetsReceived) parado = true;
        vigiarAtraso(c, parado ? Infinity : atraso);
        if (app) try { chrome.webview.postMessage("BUF " + (parado ? -1 : atraso)); } catch (_) {}
        $("gstats").textContent = (r.frameWidth || "?") + "×" + (r.frameHeight || "?") + " · " + Math.round(r.framesPerSecond || 0) + " fps\n" +
          s.codec + (r.decoderImplementation ? " (" + r.decoderImplementation + ")" : "") + " · " + mbps(s.taxa) + "\n" +
          t("Buffer") + ": " + atraso + " ms · " + t("lost") + ": " + (r.packetsLost || 0) + "\n" + s.rede;
        $("gstats").hidden = !statsVisivel;
      });
    }

    /* O buffer do Chrome cresce sem parar quando o PC não decodifica no ritmo (quanto mais pesada a
       qualidade, mais rápido) e o vídeo fica segundos atrás. Se passar de 0,5 s por 3 leituras seguidas,
       refaz a chamada: o iPhone reconecta sozinho e o atraso volta a ~30 ms. No máximo a cada 10 s. */
    var acimaDoLimite = 0, ultimoReinicio = 0;
    function vigiarAtraso(c, ms) {
      if (c !== chamada) return;
      acimaDoLimite = ms > 500 ? acimaDoLimite + 1 : 0; // (Infinity: nenhum quadro saiu do buffer neste segundo)
      if (acimaDoLimite < 3 || Date.now() - ultimoReinicio < 10000) return;
      acimaDoLimite = 0;
      ultimoReinicio = Date.now();
      estado(t("Video fell behind; reconnecting to catch up…"));
      reiniciando = true;
      setTimeout(function () { reiniciando = false; }, 10000);
      avisarHost({ type: "inkdoshub-restart" });
    }

    function diagnosticar() {
      var linhas = [];
      var tracks = video.srcObject && video.srcObject.getVideoTracks ? video.srcObject.getVideoTracks() : [];
      var tr = tracks[0] || null;
      var pc = chamada && chamada.peerConnection;
      function linha(k, v) { linhas.push(k + ": " + (v === undefined || v === null || v === "" ? "—" : v)); }
      linha("Hora", new Date().toLocaleString());
      linha("Navegador", navigator.userAgent);
      linha("Visibilidade da página", document.visibilityState);
      linha("Tela cheia", !!document.fullscreenElement);
      linha("WebRTC chamada", chamada ? "presente" : "ausente");
      linha("PeerConnection", pc ? pc.connectionState : "ausente");
      linha("ICE", pc ? pc.iceConnectionState : "ausente");
      linha("Vídeo ligado ao stream", !!video.srcObject);
      linha("Stream ativo", video.srcObject ? video.srcObject.active : false);
      linha("Tracks de vídeo", tracks.length);
      linha("Track", tr ? tr.readyState + ", muted=" + tr.muted + ", enabled=" + tr.enabled : "ausente");
      linha("Video element", "readyState=" + video.readyState + ", paused=" + video.paused + ", networkState=" + video.networkState);
      linha("Dimensões renderizadas", video.videoWidth + "×" + video.videoHeight);
      linha("Tempo do vídeo", Number(video.currentTime || 0).toFixed(2) + " s");
      linha("Último erro de mídia", video.error ? ("code=" + video.error.code + " " + video.error.message) : "nenhum");
      if (!pc) {
        $("diagnostico").textContent = linhas.join("\n") + "\n\nSem PeerConnection: confirme se o iPhone tocou em Start e se o código corresponde.";
        return;
      }
      pc.getStats().then(function (rel) {
        var inbound = null, codec = "", map = {};
        rel.forEach(function (s) { map[s.id] = s; });
        rel.forEach(function (s) {
          if (s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video")) inbound = s;
        });
        linha("Stats de vídeo recebidas", !!inbound);
        if (inbound) {
          var c = inbound.codecId && map[inbound.codecId];
          codec = c && c.mimeType ? c.mimeType : "desconhecido";
          linha("Codec recebido", codec);
          linha("Pacotes recebidos", inbound.packetsReceived);
          linha("Pacotes perdidos", inbound.packetsLost);
          linha("Bytes recebidos", inbound.bytesReceived);
          linha("Frames recebidos", inbound.framesReceived);
          linha("Frames decodificados", inbound.framesDecoded);
          linha("Frames descartados", inbound.framesDropped);
          linha("Resolução recebida", (inbound.frameWidth || "?") + "×" + (inbound.frameHeight || "?"));
          linha("FPS recebido", inbound.framesPerSecond);
        }
        $("diagnostico").textContent = linhas.join("\n") + "\n\nLeitura rápida:\n- Bytes/frames não aumentam: problema de envio ou rede/WebRTC.\n- Frames recebidos aumentam, mas decodificados ficam em 0: possível incompatibilidade de codec/decodificador do XeOS.\n- Frames decodificados aumentam, mas a imagem continua preta até tela cheia: provável falha de composição/renderização de vídeo do navegador; o botão Refresh video tenta forçar uma atualização.";
      }).catch(function (e) {
        $("diagnostico").textContent = linhas.join("\n") + "\n\nFalha ao ler WebRTC stats: " + (e && (e.message || e.name) || e);
      });
    }
    $("bparartransmissao").onclick = function () {
      var c = chamada, sinal = peer && c && c.peer ? peer.connect(c.peer, { reliable: true }) : null, finalizado = false;
      function finalizar() {
        if (finalizado) return;
        finalizado = true;
        clearTimeout(limiteSinal);
        if (sinal) { try { sinal.close(); } catch (_) {} }
        if (c) { try { c.close(); } catch (_) {} }
        video.pause();
        semChamada(t("Transmission stopped by the PC."));
      }
      var limiteSinal = setTimeout(finalizar, 1500);
      if (sinal) {
        sinal.on("open", function () {
          try { sinal.send({ type: "inkdoshub-stop" }); } catch (_) {}
          setTimeout(finalizar, 150);
        });
        sinal.on("error", finalizar);
      } else finalizar();
    };
    $("bdiagnostico").onclick = function () {
      var painel = $("diagnostico");
      painel.hidden = !painel.hidden;
      if (!painel.hidden) diagnosticar();
    };
    $("brefrescar").onclick = function () {
      // Recupera o elemento de mídia sem encerrar a chamada WebRTC.
      var stream = video.srcObject;
      if (stream) ligarVideo(stream, true);
      video.style.transform = "translateZ(0)";
      video.style.willChange = "transform";
      requestAnimationFrame(function () {
        video.style.opacity = "0.99";
        requestAnimationFrame(function () {
          video.style.opacity = "1";
          video.style.willChange = "";
          if (!$("diagnostico").hidden) diagnosticar();
        });
      });
    };
    $("bstats").onclick = function () { statsVisivel = !statsVisivel; $("gstats").hidden = !statsVisivel || !chamada; };
    /* App de Windows: a prévia na janela custa placa de vídeo e memória (pesa em 4K) e não muda o que
       vai para a câmera virtual. Fica desligada por padrão; o botão liga e a escolha fica salva. */
    if (app) {
      var CHAVE_PREVIA = "inkdoshub-webcam-previa";
      var previa = ler(CHAVE_PREVIA) === "1";
      var mostrarPrevia = function () {
        video.style.visibility = previa ? "" : "hidden";
        $("bprevia").textContent = previa ? t("Hide preview") : t("Show preview");
      };
      $("bprevia").hidden = false;
      $("bprevia").onclick = function () { previa = !previa; gravar(CHAVE_PREVIA, previa ? "1" : "0"); mostrarPrevia(); };
      mostrarPrevia();
    }
    $("btela").onclick = function () {
      var el = $("guest");
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    };
    $("copiar").onclick = function () {
      var i = $("linkobs");
      i.select();
      (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).then(function () {
        $("copiar").textContent = t("Copied");
      }, function () { document.execCommand && document.execCommand("copy"); });
    };
    $("novocodigo").onclick = function () {
      gravar(CHAVE_CODIGO, novoCodigo());
      location.href = BASE + "?guest=" + ler(CHAVE_CODIGO) + (nativo ? "&nativo=1" : "");
    };
    addEventListener("pagehide", function () {
      encerrando = true;
      clearInterval(timer);
      if (chamada) { try { chamada.close(); } catch (_) {} chamada = null; }
      video.srcObject = null;
      if (bomba) bomba.parar();
      if (peer) { peer.destroy(); peer = null; }
    });
    if (!nativo) { conectar(); return; }
    // receptor nativo: o app conecta com este código e manda o estado de volta
    chrome.webview.addEventListener("message", function (e) {
      var m = typeof e.data === "string" ? e.data : "";
      if (m.indexOf("nat:estado:") === 0) estado(t(m.slice(11)));
      else if (m === "nat:on") $("parear").classList.add("ligado");   // conectado: some o QR, fica o estado
      else if (m === "nat:off") $("parear").classList.remove("ligado");
    });
    chrome.webview.postMessage("NATIVO " + codigo);
  }

  /* ---------- App de Windows: manda os quadros para a câmera virtual ----------
     O app (windows/webcam/Program.cs) entrega um buffer compartilhado do tamanho da câmera.

     Caminho rápido (quase sempre): lê os quadros decodificados direto da faixa do WebRTC
     (MediaStreamTrackProcessor), sem passar pelo <video> nem por canvas, e copia cada quadro já em
     BGRX para o buffer (VideoFrame.copyTo). O ritmo é o dos próprios quadros, não de um timer, então a
     aba escondida ou coberta pelo Zoom não desacelera. Enquanto o app ainda está entregando o quadro
     anterior, os novos são descartados: nunca forma fila, então o atraso não cresce.

     Caminho lento (só quando o quadro não tem o tamanho da câmera, está em pé ou girado): desenha o
     quadro num canvas no formato escolhido e copia os pixels (RGBA).

     Mensagens para o app: "frame:bgrx" ou "frame:rgba"; o app responde "ok" quando já mandou para a
     câmera. A cada 5 s vai "PERFJS ..." para o log do app. */
  function bombaApp(video, formatoAtual, aoMudarQualidade) {
    // o buffer pode ter 2 posições (buffer duplo): enquanto o app entrega uma, a página copia na outra
    var mem = null, slots = [], livre = [], W = 0, H = 0, fps = 30, leitor = null, faixaAtual = null, ultimo = 0;
    var canvas = document.createElement("canvas"), ctx = null, bgrxOk = true;
    var perf = { ini: performance.now(), rapido: 0, lento: 0, descartados: 0, copia: 0, ack: 0, envio: 0 };
    var temProcessador = typeof window.MediaStreamTrackProcessor === "function" && typeof window.VideoFrame === "function";

    function reportar() {
      var agora = performance.now(), s = (agora - perf.ini) / 1000;
      if (s < 5) return;
      var n = perf.rapido + perf.lento;
      chrome.webview.postMessage("PERFJS camera=" + W + "x" + H + "@" + fps + " sent_fps=" + (n / s).toFixed(1) +
        " fast=" + perf.rapido + " slow=" + perf.lento + " dropped=" + perf.descartados +
        " copy_avg_ms=" + (n ? perf.copia / n : 0).toFixed(2) + " ack_avg_ms=" + (n ? perf.ack / n : 0).toFixed(2) +
        " processor=" + (temProcessador ? 1 : 0) + " bgrx=" + (bgrxOk ? 1 : 0) + " " + (perf.info || ""));
      perf = { ini: agora, rapido: 0, lento: 0, descartados: 0, copia: 0, ack: 0, envio: 0, info: perf.info };
    }
    function pegarSlot() {
      for (var i = 0; i < livre.length; i++) if (livre[i]) { livre[i] = false; return i; }
      return -1;
    }
    function avisar(tipo, slot, t0) {
      perf.copia += performance.now() - t0;
      perf.envio = performance.now();
      chrome.webview.postMessage("frame:" + (tipo.indexOf(":") > 0 ? tipo : tipo + ":" + slot));
    }

    chrome.webview.addEventListener("sharedbufferreceived", function (e) {
      var d = e.additionalData || {};
      mem = e.getBuffer();
      W = d.w; H = d.h; fps = d.fps || 30;
      var n = Math.max(1, Math.min(2, d.slots || 1));
      slots = []; livre = [];
      for (var i = 0; i < n; i++) { slots.push(new Uint8Array(mem, i * W * H * 4, W * H * 4)); livre.push(true); }
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (!video.srcObject) espera();
      ligar(video.srcObject);
      if (aoMudarQualidade) aoMudarQualidade();
    });
    chrome.webview.addEventListener("message", function (e) {
      var m = typeof e.data === "string" ? /^ok(?::(\d))?$/.exec(e.data) : null;
      if (!m) return;
      if (perf.envio) { perf.ack += performance.now() - perf.envio; perf.envio = 0; }
      if (m[1] === undefined) for (var i = 0; i < livre.length; i++) livre[i] = true;
      else if (+m[1] < livre.length) livre[+m[1]] = true;
      reportar();
    });

    /* Entrega um quadro: um VideoFrame do WebRTC (que esta função fecha) ou, sem o processador, o
       próprio <video>. */
    function entregar(fonte, largura, altura) {
      var quadro = fonte instanceof window.VideoFrame ? fonte : null;
      function fechar() { if (quadro) { try { quadro.close(); } catch (_) {} } }
      if (!slots.length || !ctx) { fechar(); return; }
      // limita ao fps da câmera escolhida (o iPhone pode mandar mais)
      // (relógio com "vaga" por período: aguenta a variação natural entre quadros sem descartar à toa)
      var agora = performance.now(), periodo = 1000 / fps;
      if (agora < ultimo - 2) { perf.descartados++; fechar(); return; }
      var slot = pegarSlot();
      if (slot < 0) { perf.descartados++; fechar(); return; }
      ultimo = Math.max(ultimo + periodo, agora - periodo / 2);
      var buf = slots[slot];
      var f = formatoAtual(), t0 = performance.now();
      var g = f === "gira90" ? 90 : f === "gira270" ? 270 : 0;
      var vr = quadro && quadro.visibleRect, rot = null;
      if (quadro) rot = typeof quadro.rotation === "number" ? quadro.rotation : (vr && vr.width === largura ? 0 : null);
      perf.info = "rot=" + rot + " fmt=" + f + " raw=" + (vr ? vr.width + "x" + vr.height : "-") + " disp=" + largura + "x" + altura;
      function copiar(tipo, layout) {
        quadro.copyTo(buf, { format: "BGRX", layout: layout }).then(function () {
          fechar();
          perf.rapido++;
          avisar(tipo, slot, t0);
        }, function () {
          fechar();
          bgrxOk = false; // este Chrome não converte para BGRX: usa o canvas daqui em diante
          livre[slot] = true;
        });
      }
      if (quadro && bgrxOk && rot === 0 && g === 0 && largura === W && altura === H) {
        // caminho rápido: o Chrome converte para BGRX e copia direto para a memória do app
        copiar("bgrx", [{ offset: 0, stride: W * 4 }]);
        return;
      }
      if (quadro && bgrxOk && vr && rot !== null && !quadro.flip && vr.width * vr.height <= W * H) {
        // quadro cru (em qualquer tamanho e giro): o app gira, corta e escala na conversão para a câmera
        var giro = (rot + g) % 360;
        copiar("raw:" + slot + ":" + vr.width + ":" + vr.height + ":" + giro + ":" + (f === "ajustar" ? 1 : 0), [{ offset: 0, stride: vr.width * 4 }]);
        return;
      }
      try {
        desenhar(fonte, largura, altura, f);
        buf.set(ctx.getImageData(0, 0, W, H).data);
      } finally { fechar(); }
      perf.lento++;
      avisar("rgba", slot, t0);
    }
    function desenhar(fonte, vw, vh, f) {
      var gira = f === "gira90" || f === "gira270";
      var sw = gira ? vh : vw, sh = gira ? vw : vh;
      var esc = f === "ajustar" ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      if (gira) ctx.rotate((f === "gira90" ? 90 : -90) * Math.PI / 180);
      ctx.drawImage(fonte, -vw * esc / 2, -vh * esc / 2, vw * esc, vh * esc);
      ctx.restore();
    }

    /* Lê os quadros da faixa de vídeo assim que o iPhone conecta. */
    function ligar(stream) {
      var faixa = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      if (!faixa || faixa === faixaAtual || !slots.length) return;
      parar();
      faixaAtual = faixa;
      if (!temProcessador) return peloVideo(faixa);
      var r;
      try { r = new MediaStreamTrackProcessor({ track: faixa, maxBufferSize: 1 }).readable.getReader(); }
      catch (_) { temProcessador = false; return peloVideo(faixa); }
      leitor = r;
      (function proximo() {
        r.read().then(function (res) {
          if (res.done || leitor !== r) { if (res.value) res.value.close(); return; }
          var q = res.value;
          try { entregar(q, q.displayWidth, q.displayHeight); } catch (_) { try { q.close(); } catch (e) {} for (var i = 0; i < livre.length; i++) livre[i] = true; }
          proximo();
        }, function () {});
      })();
    }
    // sem MediaStreamTrackProcessor: um quadro por quadro novo do <video>
    function peloVideo(faixa) {
      function quadro() {
        if (faixaAtual !== faixa) return;
        if (video.videoWidth) entregar(video, video.videoWidth, video.videoHeight);
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(quadro);
        else setTimeout(quadro, 1000 / fps);
      }
      quadro();
    }
    function parar() {
      faixaAtual = null;
      if (leitor) { var r = leitor; leitor = null; try { r.cancel(); } catch (_) {} }
    }
    // o <video> ganha a faixa um pouco depois da chamada: confere de tempos em tempos
    setInterval(function () { if (video.srcObject) ligar(video.srcObject); }, 500);

    // sem iPhone: a câmera mostra um aviso em vez de congelar no último quadro
    function espera() {
      if (!ctx || !slots.length) return;
      parar();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = Math.round(H / 22) + "px -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t("Waiting for the iPhone…"), W / 2, H / 2);
      slots[0].set(ctx.getImageData(0, 0, W, H).data);
      livre[0] = false;
      chrome.webview.postMessage("frame:rgba:0");
    }
    return {
      espera: espera,
      alvo: function () { return W ? { w: W, h: H, fps: fps } : null; },
      parar: function () { parar(); slots = []; livre = []; }
    };
  }

  /* ---------- Host (iPhone) ---------- */
  function host(codigo) {
    mostrar("host");
    var cfg = {};
    try { cfg = JSON.parse(ler(CHAVE_HOST) || "{}") || {}; } catch (_) {}
    var codigoInicial = limpo(codigo), codigoSalvo = limpo(cfg.codigo);
    $("hcodigo").value = /^[a-z0-9]{10}$/.test(codigoInicial) ? codigoInicial : (/^[a-z0-9]{10}$/.test(codigoSalvo) ? codigoSalvo : "");
    if (cfg.qualidade && QUALIDADES[cfg.qualidade]) $("qualidade").value = cfg.qualidade;
    // H.264 é codificado pelo hardware do iPhone e decodificado pela placa de vídeo do PC (versão 3 volta todos para ele)
    if (cfg.codecVersion === 3 && cfg.codec) $("codec").value = cfg.codec;
    else $("codec").value = "H264";
    if (cfg.formato) $("formato").value = cfg.formato;
    var video = $("vhost"), stream = null, peer = null, chamada = null, ligado = false, tentativa = 0, reconectarTimer = 0, falhasDestino = 0, ant = null, timer = 0, trava = null;
    var encerrando = false;
    var cameraSalva = cfg.camera || "environment";
    $("camera").value = cameraSalva;

    function estado(s) { $("hestado").textContent = s; }
    function salvar() {
      gravar(CHAVE_HOST, JSON.stringify({ codigo: limpo($("hcodigo").value), qualidade: $("qualidade").value, camera: $("camera").value, codec: $("codec").value, codecVersion: 3, formato: $("formato").value }));
    }
    function qual() { return QUALIDADES[$("qualidade").value] || QUALIDADES["1080p30"]; }

    function abrirCamera() {
      var Q = qual(), cam = $("camera").value;
      var v = { width: { ideal: Q.w }, height: { ideal: Q.h }, frameRate: { ideal: Q.fps } };
      if (cam === "environment" || cam === "user") v.facingMode = { ideal: cam };
      else v.deviceId = { exact: cam };
      return navigator.mediaDevices.getUserMedia({ audio: false, video: v }).then(function (s) {
        var tr = s.getVideoTracks()[0];
        try { tr.contentHint = "motion"; } catch (_) {}
        // só reabre se a câmera que caiu ainda é a atual (o Safari também avisa "ended" quando a
        // própria página para a câmera antiga ao trocar, e isso virava um laço de troca a cada ~2 s)
        tr.addEventListener("ended", function () { if (ligado && stream && stream.getVideoTracks()[0] === tr) trocarCamera(); });
        listarCameras();
        return s;
      });
    }
    function listarCameras() {
      if (!navigator.mediaDevices.enumerateDevices) return;
      navigator.mediaDevices.enumerateDevices().then(function (lista) {
        var cams = lista.filter(function (d) { return d.kind === "videoinput" && d.label; });
        if (!cams.length) return;
        var sel = $("camera"), atual = sel.value;
        sel.innerHTML = "";
        [["environment", t("Back camera")], ["user", t("Front camera")]].concat(cams.map(function (d) { return [d.deviceId, d.label]; })).forEach(function (o) {
          var op = document.createElement("option");
          op.value = o[0];
          op.textContent = o[1];
          sel.appendChild(op);
        });
        sel.value = atual;
        if (sel.value !== atual) sel.value = "environment";
      }).catch(function () {});
    }
    function pararStream() { if (stream) stream.getTracks().forEach(function (x) { x.stop(); }); stream = null; }

    function ajustarEnvio() {
      if (!chamada || !chamada.peerConnection) return;
      var Q = qual();
      chamada.peerConnection.getSenders().forEach(function (snd) {
        if (!snd.track || snd.track.kind !== "video") return;
        var p = snd.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = Q.bps;
        p.encodings[0].maxFramerate = Q.fps;
        p.encodings[0].scaleResolutionDownBy = 1;
        // com pouca banda, baixa o fps e não a resolução: o PC recebe sempre o tamanho da câmera
        try { p.degradationPreference = "maintain-resolution"; } catch (_) {}
        snd.setParameters(p).catch(function () {});
      });
    }

    function pararLocal(mensagem) {
      ligado = false;
      clearTimeout(tentativa);
      clearTimeout(reconectarTimer);
      reconectarTimer = 0;
      clearInterval(timer);
      var c = chamada;
      chamada = null;
      if (c) { try { c.close(); } catch (_) {} }
      if (peer) { peer.destroy(); peer = null; }
      pararStream();
      video.srcObject = null;
      if (trava) { try { trava.release().catch(function () {}); } catch (_) {} }
      trava = null;
      $("hstats").hidden = true;
      $("iniciar").textContent = t("Start");
      $("iniciar").classList.remove("parar");
      estado(mensagem || t("Stopped."));
    }

    function ligar() {
      if (!ligado || encerrando) return;
      var destino = PREFIXO + limpo($("hcodigo").value), Q = qual();
      if (!peer || peer.destroyed) {
        peer = new Peer({ debug: 0 });
        peer.on("open", function () { clearTimeout(reconectarTimer); reconectarTimer = 0; ligar(); });
        peer.on("connection", function (conn) {
          conn.on("data", function (msg) {
            if (conn.peer !== PREFIXO + limpo($("hcodigo").value) || !msg || typeof msg !== "object") return;
            if (msg.type === "inkdoshub-stop") pararLocal(t("Transmission stopped by the PC."));
            else if (msg.type === "inkdoshub-restart" && ligado) { clearTimeout(tentativa); ligar(); } // o PC pediu uma chamada nova (atraso acumulado)
            else if (msg.type === "inkdoshub-quality") {
              // o app de Windows pede a resolução da câmera dele (ex.: 1080p60); só aceita as da lista
              var chave = (msg.h >= 2160 ? "2160p" : msg.h >= 1080 ? "1080p" : "720p") + (msg.fps >= 60 ? "60" : "30");
              if (QUALIDADES[chave] && $("qualidade").value !== chave) {
                $("qualidade").value = chave;
                trocarCamera();
              }
            }
          });
        });
        peer.on("disconnected", function () {
          clearTimeout(reconectarTimer);
          estado(t("Connecting to the pairing server…"));
          function tentarReconectar() {
            var p = peer;
            if (encerrando || !ligado || !p || p.destroyed) return;
            if (!p.disconnected) { reconectarTimer = 0; return; }
            try { p.reconnect(); } catch (_) {}
            reconectarTimer = setTimeout(tentarReconectar, 3000);
          }
          reconectarTimer = setTimeout(tentarReconectar, 1000);
        });
        peer.on("error", function (e) {
          if (e.type === "peer-unavailable") {
            estado(t("The PC was not found. Check that the Guest page is open with code {code}. Trying again…", { code: limpo($("hcodigo").value) }));
          } else if (e.type === "network" || e.type === "server-error" || e.type === "socket-error" || e.type === "socket-closed") estado(t("No connection to the pairing server. Trying again…"));
          else estado(t("Error: {msg}", { msg: e.type || e.message }));
          denovo();
        });
        estado(t("Connecting to the pairing server…"));
        return;
      }
      if (!peer.open) return;
      if (chamada) { try { chamada.close(); } catch (_) {} }
      estado(t("Calling the PC…"));
      var c = peer.call(destino, stream, {
        metadata: { codec: $("codec").value, bps: Q.bps, view: $("formato").value },
        sdpTransform: function (sdp) { return ajustarSdp(sdp, $("codec").value, 0); },
      });
      chamada = c;
      if (!c) return denovo();
      var pc = c.peerConnection;
      pc.addEventListener("connectionstatechange", function () {
        if (chamada !== c) return;
        var st = pc.connectionState;
        if (st === "connected") {
          tentativa = 0;
          falhasDestino = 0;
          estado(t("Sending to the PC. Keep Safari open with the screen on."));
          ajustarEnvio();
          clearInterval(timer);
          ant = null;
          timer = setInterval(stats, 1000);
        } else if (st === "failed") {
          estado(t("The connection failed. If the devices are on different networks, put both on the same Wi-Fi. Trying again…"));
          denovo();
        } else if (st === "disconnected") {
          estado(t("Connection lost. Waiting…"));
          setTimeout(function () { if (chamada === c && pc.connectionState === "disconnected") denovo(); }, 5000);
        }
      });
      c.on("close", function () {
        if (chamada === c && ligado) denovo();
      });
    }
    function denovo() {
      if (!ligado) return;
      if (chamada) { var c = chamada; chamada = null; try { c.close(); } catch (_) {} }
      clearInterval(timer);
      $("hstats").hidden = true;
      clearTimeout(tentativa);
      tentativa = setTimeout(ligar, 3000);
    }

    function stats() {
      if (!chamada || !chamada.peerConnection) return;
      lerStats(chamada.peerConnection, "outbound-rtp", ant, function (s) {
        if (!s) return;
        ant = s;
        var tr0 = stream && stream.getVideoTracks()[0], cfgs = tr0 ? tr0.getSettings() : {}, r = s.rtp;
        var caps = tr0 && tr0.getCapabilities ? tr0.getCapabilities() : {};
        var maxFps = caps.frameRate && caps.frameRate.max ? " (max " + Math.round(caps.frameRate.max) + ")" : "";
        $("hstats").textContent = t("Camera") + ": " + (cfgs.width || "?") + "×" + (cfgs.height || "?") + " · " + Math.round(cfgs.frameRate || 0) + " fps" + maxFps + "\n" +
          t("Sent") + ": " + (r.frameWidth || "?") + "×" + (r.frameHeight || "?") + " · " + Math.round(r.framesPerSecond || 0) + " fps\n" +
          s.codec + (r.encoderImplementation ? " (" + r.encoderImplementation + ")" : "") + " · " + mbps(s.taxa) +
          (r.qualityLimitationReason && r.qualityLimitationReason !== "none" ? "\n" + t("Limited by") + ": " + r.qualityLimitationReason : "") + "\n" + s.rede;
        $("hstats").hidden = false;
      });
    }

    function travarTela() {
      if (!navigator.wakeLock || document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(function (l) { trava = l; }).catch(function () {});
    }

    function trocarCamera() {
      salvar();
      if (!ligado) return;
      var velho = stream;
      stream = null;
      if (velho) velho.getTracks().forEach(function (x) { x.stop(); }); // o iPhone abre uma câmera por vez
      abrirCamera().then(function (s) {
        stream = s;
        video.srcObject = s;
        var tr = s.getVideoTracks()[0];
        if (chamada && chamada.peerConnection) {
          chamada.peerConnection.getSenders().forEach(function (snd) { if (snd.track === null || (snd.track && snd.track.kind === "video")) snd.replaceTrack(tr); });
          ajustarEnvio();
        }
      }).catch(function (e) { estado(t("Could not open the camera: {msg}", { msg: e.name || e.message })); });
    }

    $("iniciar").onclick = function () {
      if (ligado) {
        pararLocal(t("Stopped."));
        return;
      }
      if (!/^[a-z0-9]{10}$/.test(limpo($("hcodigo").value))) { estado(t("Type the 10-character code shown on the PC.")); $("hcodigo").focus(); return; }
      $("hcodigo").value = limpo($("hcodigo").value);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { estado(t("This browser cannot open the camera here.")); return; }
      salvar();
      travarTela();
      estado(t("Opening the camera…"));
      abrirCamera().then(function (s) {
        stream = s;
        video.srcObject = s;
        video.play().catch(function () {});
        ligado = true;
        $("iniciar").textContent = t("Stop");
        $("iniciar").classList.add("parar");
        ligar();
      }).catch(function (e) {
        estado(e && e.name === "NotAllowedError" ? t("Camera access was denied. Allow it in Safari (aA › Website Settings) and try again.") : t("Could not open the camera: {msg}", { msg: e.name || e.message }));
      });
    };
    $("qualidade").onchange = trocarCamera;
    $("camera").onchange = trocarCamera;
    $("codec").onchange = function () { salvar(); if (ligado) denovo(); };
    $("formato").onchange = function () { salvar(); if (ligado) denovo(); };
    $("hcodigo").onchange = function () { salvar(); if (ligado) denovo(); };
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !ligado) return;
      travarTela();
      // o iOS desliga a câmera quando o Safari sai da frente; ao voltar, abre de novo
      var tr = stream && stream.getVideoTracks()[0];
      if (!tr || tr.readyState === "ended" || tr.muted) trocarCamera();
    });
    addEventListener("pagehide", function () { encerrando = true; pararLocal(); });
  }

  /* ---------- Escolha ---------- */
  $("ehost").onclick = function () { history.replaceState(null, "", "?host="); host(""); };
  $("eguest").onclick = function () { guest(""); };
  $("btroca").onclick = function () { location.href = BASE; };
  if (app) guest(q.get("guest"));
  else if (q.has("host")) host(q.get("host"));
  else if (q.has("guest")) guest(q.get("guest"));
  else mostrar("escolha");
})();
