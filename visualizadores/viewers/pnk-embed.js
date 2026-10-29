// InkDOS embed adapter for the pnk viewer (Apple Pages / Numbers / Keynote). pnk itself is not
// changed: a handed-over file goes through pnk's own file input, and in embedded use the
// surrounding InkDOS workspace provides the chrome, so pnk's top bar and footer are hidden.
(function () {
  'use strict';
  // embedded styling lives in pnk-embed.css (pnk's own CSP allows no inline styles)
  function shown(id) { var el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); }
  function text(id) { return ((document.getElementById(id) || {}).textContent || '').trim(); }
  window.InkDOSViewer = {
    open: function (file) {
      return new Promise(function (resolve, reject) {
        var input = document.getElementById('file-input');
        if (!input || typeof DataTransfer !== 'function') { reject(new Error('This browser cannot hand the file to the viewer.')); return; }
        var transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        // pnk wires its input after its WASM module initialises: hand the file over again until
        // pnk shows it is working on it (status line) or done
        var started = Date.now(), sent = 0;
        (function wait() {
          var current = text('doc-filename') === file.name;
          var busy = shown('parse-status') || current;
          if (!busy && Date.now() - sent > 1000) { sent = Date.now(); input.dispatchEvent(new Event('change', { bubbles: true })); }
          // pnk marks a file it cannot read with a "rejected" badge (main.ts showError)
          if (current && text('app-badge') === 'rejected') { reject(new Error('This file could not be shown.')); return; }
          if (current && shown('view')) { resolve(); return; }
          if (Date.now() - started > 30000) { reject(new Error('timeout')); return; }
          setTimeout(wait, 100);
        })();
      });
    }
  };
})();
