// Shared InkDOS viewer protocol, used when an InkDOS workspace embeds a viewer (?embed=1). In the InkDOS Hub the
// InkDOS apps and these viewers live on the same site, so messages are exchanged only with this origin, never '*'
// (the old InkDOS origin, vfydr2m9wk-ops.github.io, was removed from the list in 2026-10-29: auditoria/007).
//   viewer -> parent  {type:'inkdos-viewer-ready'}
//   parent -> viewer  {type:'inkdos-viewer-open', file: File}
//   viewer -> parent  {type:'inkdos-viewer-loaded', ok: true|false, error?: string}
// Each viewer page defines window.InkDOSViewer.open(file) -> Promise before this script runs.
(function () {
  'use strict';
  if (!/[?&]embed=1\b/.test(location.search) || window.parent === window) return;
  var ALLOWED = [location.origin];
  var parent = window.parent;
  window.addEventListener('message', function (event) {
    if (ALLOWED.indexOf(event.origin) < 0 || event.source !== parent) return;
    var data = event.data || {}, origin = event.origin;
    if (data.type !== 'inkdos-viewer-open' || !(data.file instanceof Blob)) return;
    function reply(message) { try { parent.postMessage(message, origin); } catch (_) {} }
    Promise.resolve()
      .then(function () { return window.InkDOSViewer.open(data.file); })
      .then(function () { reply({ type: 'inkdos-viewer-loaded', ok: true }); },
            function (error) { reply({ type: 'inkdos-viewer-loaded', ok: false, error: String(error && error.message || error) }); });
  });
  // the browser delivers this only to a parent of an allowed origin (the target origin must match)
  ALLOWED.forEach(function (origin) { try { parent.postMessage({ type: 'inkdos-viewer-ready' }, origin); } catch (_) {} });
})();
