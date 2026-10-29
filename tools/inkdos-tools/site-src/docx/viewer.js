// Word document viewer: docx-preview renders a .docx with its own page size, margins, headers,
// footers, footnotes, tables and images (read only). Standalone it opens a picked file; embedded
// (?embed=1) an InkDOS workspace hands the file over with the shared viewer protocol
// (../viewers/viewer-embed.js).
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var host = document.getElementById('doc');
  var status = document.getElementById('status');
  var urls = [];

  // narrow screens: scale the pages down to the window width instead of scrolling sideways
  function fit() {
    if (host.hidden) return;
    host.style.zoom = '';
    var page = host.querySelector('section.docx');
    if (!page) return;
    var room = stage.clientWidth - (stage.clientWidth <= 700 ? 16 : 48);
    var scale = Math.min(1, room / page.offsetWidth);
    host.style.zoom = scale < 1 ? String(Math.max(0.2, scale)) : '';
  }

  function show(file) {
    document.getElementById('fileName').textContent = file.name || '';
    status.textContent = 'Opening ' + (file.name || 'document') + '…';
    status.hidden = false;
    host.hidden = true;
    var created = URL.createObjectURL;
    // docx-preview makes object URLs for images and fonts; release the previous document's ones
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
    URL.createObjectURL = function (blob) { var u = created.call(URL, blob); urls.push(u); return u; };
    return file.arrayBuffer().then(function (data) {
      host.textContent = '';
      return docx.renderAsync(data, host, null, {
        className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
        experimental: true, useBase64URL: false
      });
    }).then(function () {
      URL.createObjectURL = created;
      status.hidden = true;
      host.hidden = false;
      stage.scrollTop = 0;
      fit();
    }, function (error) {
      URL.createObjectURL = created;
      status.textContent = 'This file could not be shown.';
      throw error;
    });
  }

  document.getElementById('picker').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (file) show(file).catch(function () {});
  });
  window.addEventListener('resize', fit);
  window.InkDOSViewer = { open: show };
})();
