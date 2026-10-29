// InkDOS-tools: a file handed over by the InkDOS Office Home (same origin). The Home stores the picked file in
// IndexedDB 'inkdos-tools-handoff' and opens this page with #inkdos-file=<id>; the file is taken out (and deleted)
// and given to the tool the way its own Open button would: data-mode="pdfjs" (PDF.js viewer) or the file input named
// by data-input (dispatching its change event). Framed with ?embed=1 by an InkDOS workspace (a file opened from the
// system in the Full version), the same opening serves the viewer protocol: window.InkDOSViewer.open(file), with
// viewers/viewer-embed.js loaded after this script.
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me) return;
  var mode = me.dataset.mode, selector = me.dataset.input;
  if (/[?&]embed=1\b/.test(location.search) && window.parent !== window) {
    window.InkDOSViewer = { open: function (file) { give(file); return Promise.resolve(); } };
  }
  var match = /[#&]inkdos-file=([\w-]+)/.exec(location.hash);
  if (!match) return;
  var id = match[1];
  history.replaceState(history.state, '', location.pathname + location.search);
  function take() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('inkdos-tools-handoff', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files'), get = store.get(id);
        get.onsuccess = function () { store.delete(id); };
        tx.oncomplete = function () { db.close(); get.result ? resolve(get.result) : reject(new Error('no file')); };
        tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
      };
    });
  }
  function when(test, done) {
    var tries = 0;
    (function poll() { var v = test(); if (v) return done(v); if (++tries < 200) setTimeout(poll, 100); })();
  }
  take().then(function (item) {
    give(new File([item.data], item.name, { type: item.type || '', lastModified: item.lastModified || Date.now() }));
  }).catch(function (error) { console.warn('InkDOS: the handed-over file could not be opened', error); });
  function give(file) {
    if (mode === 'pdfjs') {
      when(function () { return window.PDFViewerApplication; }, function (app) {
        app.initializedPromise.then(function () { app.open({ url: URL.createObjectURL(file), originalUrl: file.name }); });
      });
      return;
    }
    // after the page's own scripts (module scripts run late) have started listening to the input
    var ready = document.readyState === 'complete' ? Promise.resolve()
      : new Promise(function (resolve) { addEventListener('load', resolve, { once: true }); });
    ready.then(function () { when(function () { return document.querySelector(selector); }, function (input) {
      var transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }); });
  }
})();
