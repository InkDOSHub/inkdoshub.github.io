// Ajustes do InkTerminal para o omniclip:
// 1) arrumação inicial: mídia e prévia em cima, linha do tempo embaixo;
// 2) abre direto o vídeo escolhido no player (apps/video), sem precisar importar de novo.
(function () {
  function id() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  var leaf = function (p) { return { id: id(), kind: "leaf", panel: p }; };
  globalThis.inkLayout = function () {
    return {
      id: id(), kind: "cell", vertical: true, size: null,
      children: [
        { id: id(), kind: "cell", vertical: false, size: 58, children: [
          { id: id(), kind: "pane", size: 38, active_leaf_index: 0,
            children: [leaf("MediaPanel"), leaf("TextPanel"), leaf("FiltersPanel"), leaf("TransitionsPanel"), leaf("AnimPanel"), leaf("ExportPanel")] },
          { id: id(), kind: "pane", size: null, active_leaf_index: 0, children: [leaf("MediaPlayerPanel")] },
        ] },
        { id: id(), kind: "pane", size: null, active_leaf_index: 0, children: [leaf("TimelinePanel")] },
      ],
    };
  };

  /* Dados do vídeo para o editor. O original usa só o MediaInfo; se ele falhar ou demorar (vídeos do
     iPhone, WebKit do XeOS), os dados vêm de um <video>, com 30 quadros por segundo. */
  globalThis.inkMetadados = function (media, file) {
    var porVideo = function () {
      return new Promise(function (ok, erro) {
        var v = document.createElement("video"), url = URL.createObjectURL(file), feito = false;
        v.muted = true; v.playsInline = true; v.preload = "metadata";
        var fim = function (r, e) { if (feito) return; feito = true; URL.revokeObjectURL(url); e ? erro(e) : ok(r); };
        v.onloadedmetadata = function () {
          var d = v.duration;
          if (!isFinite(d) || !(d > 0)) return fim(null, new Error("não consegui ler a duração do vídeo"));
          fim({ fps: 30, duration: d * 1000, frames: Math.round(d * 30), width: v.videoWidth, height: v.videoHeight });
        };
        v.onerror = function () { fim(null, new Error("este navegador não abre este vídeo")); };
        setTimeout(function () { fim(null, new Error("o vídeo demorou demais para abrir")); }, 20000);
        v.src = url;
      });
    };
    var mediainfo = Promise.race([
      media.getVideoFileMetadata(file),
      new Promise(function (_, erro) { setTimeout(function () { erro(new Error("MediaInfo demorou")); }, 25000); }),
    ]);
    return mediainfo.then(function (m) {
      if (!m || !(m.duration > 0) || !(m.fps > 0) || !(m.frames > 0)) throw new Error("dados incompletos");
      return m;
    }).catch(function (e) {
      console.warn("InkTerminal: MediaInfo falhou, usando o <video>", e);
      return porVideo();
    });
  };
  /* Guarda o arquivo no banco do editor sem derrubar a importação se o navegador recusar
     (o WebKit de alguns apps não guarda arquivos grandes no IndexedDB): o vídeo fica só nesta sessão. */
  globalThis.inkGuardar = function (loja, valor) {
    try { var r = loja.put(valor); r.onerror = function (e) { e.preventDefault(); e.stopPropagation(); console.warn("InkTerminal: não guardei o arquivo no editor", r.error); }; }
    catch (e) { console.warn("InkTerminal: não guardei o arquivo no editor", e); }
  };
  var avisoEl = null;
  globalThis.inkAvisar = function (texto) {
    if (!avisoEl) {
      avisoEl = document.createElement("div");
      avisoEl.setAttribute("role", "alert");
      avisoEl.style.cssText = "position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 16px);transform:translateX(-50%);z-index:99999;max-width:min(520px,calc(100vw - 32px));padding:12px 14px;border-radius:10px;background:#5a1d1d;color:#fff;font:14px/1.4 -apple-system,system-ui,sans-serif";
      avisoEl.onclick = function () { avisoEl.remove(); avisoEl = null; };
      document.body.appendChild(avisoEl);
    }
    avisoEl.textContent = texto + " (toque para fechar)";
  };

  var pendente = null;
  try { pendente = localStorage.getItem("inkterminal-video-editar"); } catch (_) {}
  if (!pendente) return;
  // Na 1ª visita o coi-serviceworker pode recarregar a página. Sem isolamento (XeOS, que não tem
  // service worker) o editor funciona igual, então só espera um pouco essa recarga possível.
  // O pedido só é apagado quando o vídeo entra, para valer também depois da recarga.
  function apagar() { try { localStorage.removeItem("inkterminal-video-editar"); } catch (_) {} }

  function esperar(fn) {
    return new Promise(function (ok) {
      var t = setInterval(function () { var v = fn(); if (v) { clearInterval(t); ok(v); } }, 200);
    });
  }
  new Promise(function (ok) { var sw = navigator.serviceWorker;
    // só espera quando o coi-serviceworker ainda pode recarregar a página (1ª visita com service worker)
    setTimeout(ok, globalThis.crossOriginIsolated || !sw || sw.controller || !window.isSecureContext ? 0 : 2500); }).then(function () {
    return InkBiblioteca("inkterminal-video").listar();
  }).then(function (itens) {
    var item = itens.filter(function (i) { return String(i.id) === pendente; })[0];
    if (!item) { apagar(); return; }
    var arq = new File([item.blob], item.nome, { type: item.tipo || item.blob.type || "video/mp4" });
    esperar(function () { var o = globalThis.inkOmni; return o && o.context && o.context.controllers && o.context; }).then(function (ctx) {
      var media = ctx.controllers.media;
      var feito = false;
      function colocar(f) {
        if (feito || !f) return;
        feito = true;
        pronto();
        globalThis.inkJaImportado = null;
        apagar();
        var mg = ctx.controllers.compositor.managers;
        if (f.kind === "video") media.create_video_elements([f]).then(function (els) { mg.videoManager.create_and_add_video_effect(els[0], ctx.state); });
        else if (f.kind === "audio") mg.audioManager.create_and_add_audio_effect(media.create_audio_elements([f])[0], ctx.state);
        else if (f.kind === "image") mg.imageManager.create_and_add_image_effect(media.create_image_elements([f])[0], ctx.state);
      }
      var pronto = media.on_media_change(function (m) {
        if (m.action === "added" && m.files.length) colocar(m.files[0]);
      });
      // o mesmo vídeo já foi importado antes (a mídia do editor é uma só para todos os projetos)
      globalThis.inkJaImportado = colocar;
      media.import_file(arq);
    });
  });
})();
