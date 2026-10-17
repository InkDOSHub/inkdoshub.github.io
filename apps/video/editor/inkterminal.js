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
      var pronto = media.on_media_change(function (m) {
        if (m.action !== "added" || !m.files.length) return;
        pronto();
        apagar();
        var f = m.files[0];
        var mg = ctx.controllers.compositor.managers;
        if (f.kind === "video") media.create_video_elements([f]).then(function (els) { mg.videoManager.create_and_add_video_effect(els[0], ctx.state); });
        else if (f.kind === "audio") mg.audioManager.create_and_add_audio_effect(media.create_audio_elements([f])[0], ctx.state);
        else if (f.kind === "image") mg.imageManager.create_and_add_image_effect(media.create_image_elements([f])[0], ctx.state);
      });
      media.import_file(arq);
    });
  });
})();
