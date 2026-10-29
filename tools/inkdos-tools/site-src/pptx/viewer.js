// PowerPoint viewer: pptx-renderer draws each slide of a .pptx (shapes, text, tables, charts,
// SmartArt, images) as HTML/SVG, read only, one under the other and scaled to the window. The
// renderer (about 1.8 MB) is imported only when a file is opened. Standalone it opens a picked
// file; embedded (?embed=1) an InkDOS workspace hands the file over with the shared viewer
// protocol (../viewers/viewer-embed.js).
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var host = document.getElementById('slides');
  var status = document.getElementById('status');
  var viewer = null;

  function show(file) {
    document.getElementById('fileName').textContent = file.name || '';
    status.textContent = 'Opening ' + (file.name || 'presentation') + '…';
    status.hidden = false;
    host.hidden = true;
    return Promise.all([import('./pptx-renderer.js'), file.arrayBuffer()]).then(function (loaded) {
      var lib = loaded[0];
      if (viewer) { try { viewer.destroy(); } catch (_) {} viewer = null; }
      host.textContent = '';
      // shown before rendering: the renderer measures the container to fit the slides
      host.hidden = false;
      return lib.PptxViewer.open(loaded[1], host, {
        renderMode: 'list', fitMode: 'contain', scrollContainer: stage,
        zipLimits: lib.RECOMMENDED_ZIP_LIMITS, lazySlides: true, lazyMedia: true,
        listOptions: { windowed: true, initialSlides: 3, batchSize: 3 },
        // no PDF.js: EMF previews that embed a PDF are skipped instead of fetching another script
        pdfjs: false
      });
    }).then(function (opened) {
      viewer = opened;
      status.hidden = true;
      stage.scrollTop = 0;
    }, function (error) {
      host.hidden = true;
      status.hidden = false;
      status.textContent = 'This file could not be shown.';
      throw error;
    });
  }

  document.getElementById('picker').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (file) show(file).catch(function () {});
  });
  window.InkDOSViewer = { open: show };
})();
