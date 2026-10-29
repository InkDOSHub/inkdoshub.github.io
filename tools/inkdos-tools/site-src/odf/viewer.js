// OpenDocument viewer: WebODF (odf.OdfCanvas) renders .odt/.ods/.odp read-only. Standalone it
// opens a picked file; embedded (?embed=1) an InkDOS workspace hands the file over with the
// shared viewer protocol (see ../viewers/viewer-embed.js).
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var element = document.getElementById('odf');
  var status = document.getElementById('status');
  var canvas = null, url = null, kind = 'text';

  function fit() {
    if (!canvas || element.hidden) return;
    var width = stage.clientWidth - 48, height = stage.clientHeight - 48;
    try {
      // text: a page-like width, as the InkDOS editors show pages; presentation: the whole slide;
      // spreadsheet: actual size (scaling a sheet to the window makes small tables huge)
      if (kind === 'presentation') canvas.fitToContainingElement(Math.max(320, width), Math.max(240, height));
      else if (kind === 'spreadsheet') canvas.setZoomLevel(1);
      else canvas.fitToWidth(Math.max(320, Math.min(900, width)));
    } catch (_) {}
  }

  function show(file) {
    return new Promise(function (resolve, reject) {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(file);
      kind = /\.f?ods$/i.test(file.name || '') ? 'spreadsheet' : /\.f?odp$/i.test(file.name || '') ? 'presentation' : 'text';
      document.getElementById('fileName').textContent = file.name || '';
      status.textContent = 'Opening ' + (file.name || 'document') + '…';
      status.hidden = false;
      element.hidden = true;
      if (!canvas) canvas = new odf.OdfCanvas(element);
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        status.textContent = 'This file could not be shown.';
        reject(new Error('timeout'));
      }, 30000);
      canvas.addListener('statereadychange', function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        status.hidden = true;
        element.hidden = false;
        fit();
        resolve();
      });
      canvas.load(url);
    });
  }

  document.getElementById('picker').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (file) show(file).catch(function () {});
  });
  window.addEventListener('resize', fit);
  window.InkDOSViewer = { open: show };
})();
