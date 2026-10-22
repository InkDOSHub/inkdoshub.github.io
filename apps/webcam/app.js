/* Webcam do InkTerminal (versão de teste).

   O iPhone (Host) manda a câmera para o PC (Guest) por WebRTC, direto de um aparelho para o outro.
   O pareamento usa o servidor público do PeerJS (lib/peerjs.min.js): o Guest se registra como
   "inkterminal-webcam-<código>" e mostra um QR code com ?host=<código>; o Host liga para ele.
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
  var PREFIXO = "inkterminal-webcam-";
  var CHAVE_CODIGO = "inkterminal-webcam-codigo";
  var CHAVE_HOST = "inkterminal-webcam-host";
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

  function ler(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function limpo(c) { return String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6); }
  function novoCodigo() {
    var s = "", a = new Uint32Array(6);
    crypto.getRandomValues(a);
    for (var i = 0; i < 6; i++) s += LETRAS[a[i] % LETRAS.length];
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
    codigo = limpo(codigo) || limpo(ler(CHAVE_CODIGO)) || novoCodigo();
    gravar(CHAVE_CODIGO, codigo);
    if (q.get("guest") !== codigo) history.replaceState(null, "", "?guest=" + codigo + (obs ? "&obs=1" : ""));
    var video = $("vguest"), peer = null, chamada = null, ant = null, timer = 0, statsVisivel = obs ? false : false;
    var linkHost = BASE + "?host=" + codigo;
    $("gcodigo").textContent = codigo;
    $("linkobs").value = BASE + "?guest=" + codigo + "&obs=1";
    var qr = qrcode(0, "M");
    qr.addData(linkHost);
    qr.make();
    $("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    function estado(s) { $("gestado").textContent = s; }
    var bomba = app ? bombaApp(video, function () { return formato; }) : null;
    if (app) $("linkobs").closest("details").hidden = true;

    function conectar() {
      peer = new Peer(PREFIXO + codigo, { debug: 0 });
      peer.on("open", function () { estado(t("Ready. Waiting for the iPhone…")); });
      peer.on("disconnected", function () {
        estado(t("Connecting to the pairing server…"));
        setTimeout(function () { if (peer && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000);
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

    function receber(c) {
      if (chamada) chamada.close();
      chamada = c;
      var meta = c.metadata || {};
      c.answer(undefined, { sdpTransform: function (sdp) { return ajustarSdp(sdp, meta.codec, meta.bps); } });
      estado(t("Connecting to the iPhone…"));
      formato = meta.view || "preencher";
      aplicarFormato();
      c.on("stream", function (s) {
        if (chamada !== c) return;
        video.srcObject = s;
        video.play().catch(function () {});
        $("parear").hidden = true;
        // menos atraso: o Chrome toca o quadro assim que chega
        try { c.peerConnection.getReceivers().forEach(function (r) { if ("jitterBufferTarget" in r) r.jitterBufferTarget = 0; else r.playoutDelayHint = 0; }); } catch (_) {}
        clearInterval(timer);
        ant = null;
        timer = setInterval(stats, 1000);
      });
      function fim() {
        if (chamada !== c) return;
        chamada = null;
        clearInterval(timer);
        video.srcObject = null;
        $("parear").hidden = false;
        $("gstats").hidden = true;
        estado(t("The iPhone disconnected. Waiting for it again…"));
        if (bomba) bomba.espera();
      }
      c.on("close", fim);
      c.on("error", fim);
      var pc = c.peerConnection;
      if (pc) pc.addEventListener("connectionstatechange", function () {
        if (pc.connectionState === "failed") { c.close(); fim(); }
      });
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
      lerStats(chamada.peerConnection, "inbound-rtp", ant, function (s) {
        if (!s) return;
        ant = s;
        var r = s.rtp, atraso = r.jitterBufferEmittedCount ? Math.round(r.jitterBufferDelay / r.jitterBufferEmittedCount * 1000) : 0;
        $("gstats").textContent = (r.frameWidth || "?") + "×" + (r.frameHeight || "?") + " · " + Math.round(r.framesPerSecond || 0) + " fps\n" +
          s.codec + (r.decoderImplementation ? " (" + r.decoderImplementation + ")" : "") + " · " + mbps(s.taxa) + "\n" +
          t("Buffer") + ": " + atraso + " ms · " + t("lost") + ": " + (r.packetsLost || 0) + "\n" + s.rede;
        $("gstats").hidden = !statsVisivel;
      });
    }

    $("bstats").onclick = function () { statsVisivel = !statsVisivel; $("gstats").hidden = !statsVisivel || !chamada; };
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
      location.href = BASE + "?guest=" + ler(CHAVE_CODIGO);
    };
    addEventListener("pagehide", function () { if (peer) peer.destroy(); });
    conectar();
  }

  /* ---------- App de Windows: manda os quadros para a câmera virtual ----------
     O app (windows/webcam/Program.cs) entrega um buffer compartilhado do tamanho da câmera (RGBA).
     A cada quadro: desenha o vídeo no canvas (no formato escolhido no iPhone), copia os pixels para
     o buffer e avisa com "frame"; o app responde "ok" quando já mandou para a câmera. */
  function bombaApp(video, formatoAtual) {
    var buf = null, W = 0, H = 0, fps = 60, pronto = true, timer = 0;
    var canvas = document.createElement("canvas"), ctx = null;
    chrome.webview.addEventListener("sharedbufferreceived", function (e) {
      var d = e.additionalData || {};
      buf = new Uint8ClampedArray(e.getBuffer());
      W = d.w; H = d.h; fps = d.fps || 60;
      canvas.width = W; canvas.height = H;
      ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
      pronto = true;
      clearInterval(timer);
      timer = setInterval(passo, Math.floor(1000 / fps));
      espera();
    });
    chrome.webview.addEventListener("message", function (e) { if (e.data === "ok") pronto = true; });
    function enviar() {
      if (!buf || !ctx || !pronto) return;
      pronto = false;
      buf.set(ctx.getImageData(0, 0, W, H).data);
      chrome.webview.postMessage("frame");
    }
    function passo() {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!ctx || !pronto || !vw || !video.srcObject) return;
      var f = formatoAtual(), gira = f === "gira90" || f === "gira270";
      var sw = gira ? vh : vw, sh = gira ? vw : vh;
      var esc = f === "ajustar" ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      if (gira) ctx.rotate((f === "gira90" ? 90 : -90) * Math.PI / 180);
      ctx.drawImage(video, -vw * esc / 2, -vh * esc / 2, vw * esc, vh * esc);
      ctx.restore();
      enviar();
    }
    // sem iPhone: a câmera mostra um aviso em vez de congelar no último quadro
    function espera() {
      if (!ctx || video.srcObject) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = Math.round(H / 22) + "px -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t("Waiting for the iPhone…"), W / 2, H / 2);
      pronto = true;
      enviar();
    }
    return { espera: espera };
  }

  /* ---------- Host (iPhone) ---------- */
  function host(codigo) {
    mostrar("host");
    var cfg = {};
    try { cfg = JSON.parse(ler(CHAVE_HOST) || "{}") || {}; } catch (_) {}
    $("hcodigo").value = limpo(codigo) || cfg.codigo || "";
    if (cfg.qualidade && QUALIDADES[cfg.qualidade]) $("qualidade").value = cfg.qualidade;
    if (cfg.codec) $("codec").value = cfg.codec;
    if (cfg.formato) $("formato").value = cfg.formato;
    var video = $("vhost"), stream = null, peer = null, chamada = null, ligado = false, tentativa = 0, ant = null, timer = 0, trava = null;
    var cameraSalva = cfg.camera || "environment";
    $("camera").value = cameraSalva;

    function estado(s) { $("hestado").textContent = s; }
    function salvar() {
      gravar(CHAVE_HOST, JSON.stringify({ codigo: limpo($("hcodigo").value), qualidade: $("qualidade").value, camera: $("camera").value, codec: $("codec").value, formato: $("formato").value }));
    }
    function qual() { return QUALIDADES[$("qualidade").value] || QUALIDADES["1080p60"]; }

    function abrirCamera() {
      var Q = qual(), cam = $("camera").value;
      var v = { width: { ideal: Q.w }, height: { ideal: Q.h }, frameRate: { ideal: Q.fps } };
      if (cam === "environment" || cam === "user") v.facingMode = { ideal: cam };
      else v.deviceId = { exact: cam };
      return navigator.mediaDevices.getUserMedia({ audio: false, video: v }).then(function (s) {
        var tr = s.getVideoTracks()[0];
        try { tr.contentHint = "motion"; } catch (_) {}
        tr.addEventListener("ended", function () { if (ligado) trocarCamera(); });
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
        snd.setParameters(p).catch(function () {});
      });
    }

    function ligar() {
      if (!ligado) return;
      var destino = PREFIXO + limpo($("hcodigo").value), Q = qual();
      if (!peer || peer.destroyed) {
        peer = new Peer({ debug: 0 });
        peer.on("open", ligar);
        peer.on("disconnected", function () { setTimeout(function () { if (peer && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000); });
        peer.on("error", function (e) {
          if (e.type === "peer-unavailable") estado(t("The PC was not found. Check that the Guest page is open with code {code}. Trying again…", { code: limpo($("hcodigo").value) }));
          else if (e.type === "network" || e.type === "server-error" || e.type === "socket-error" || e.type === "socket-closed") estado(t("No connection to the pairing server. Trying again…"));
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
      c.on("close", function () { if (chamada === c) { estado(t("The PC closed the connection. Trying again…")); denovo(); } });
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
        var r = s.rtp, cfgs = stream && stream.getVideoTracks()[0] ? stream.getVideoTracks()[0].getSettings() : {};
        $("hstats").textContent = t("Camera") + ": " + (cfgs.width || "?") + "×" + (cfgs.height || "?") + " · " + Math.round(cfgs.frameRate || 0) + " fps\n" +
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
        ligado = false;
        clearTimeout(tentativa);
        clearInterval(timer);
        if (chamada) try { chamada.close(); } catch (_) {}
        chamada = null;
        if (peer) peer.destroy();
        peer = null;
        pararStream();
        video.srcObject = null;
        if (trava) trava.release().catch(function () {});
        trava = null;
        $("hstats").hidden = true;
        $("iniciar").textContent = t("Start");
        $("iniciar").classList.remove("parar");
        estado(t("Stopped."));
        return;
      }
      if (limpo($("hcodigo").value).length !== 6) { estado(t("Type the 6-character code shown on the PC.")); $("hcodigo").focus(); return; }
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
    addEventListener("pagehide", function () { if (peer) peer.destroy(); });
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
