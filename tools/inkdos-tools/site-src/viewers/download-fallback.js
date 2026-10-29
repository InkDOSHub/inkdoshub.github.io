// InkDOS-tools: tools hand their result over as a download (a link to a file made by the page, blob: or data:).
// For a browser that cannot save such downloads, the result can be offered in a small panel instead: "Save or
// share" (the iOS share sheet, which has "Save to Files") and "Open". Off unless localStorage
// 'inkdos-tools:download-panel' is '1': XeOS on iPad, for which it was written, does save these downloads.
(function () {
  'use strict';
  var forced = false;
  try { forced = localStorage.getItem('inkdos-tools:download-panel') === '1'; } catch (_) {}
  if (!forced) return;

  var pt = /^pt/i.test(navigator.language || '');
  var T = pt ? { ready: 'Arquivo pronto', share: 'Salvar ou compartilhar', open: 'Abrir', close: 'Fechar', failed: 'Não foi possível compartilhar; use Abrir.' }
    : { ready: 'File ready', share: 'Save or share', open: 'Open', close: 'Close', failed: 'Sharing failed; use Open.' };

  // keep the files the page makes, so a result is still at hand after the page releases its link
  var made = new Map();
  var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = function (object) {
    var url = create.apply(URL, arguments);
    if (object instanceof Blob) made.set(url, object);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    setTimeout(function () { made.delete(url); }, 120000);
    return revoke.apply(URL, arguments);
  };

  function blobFor(href) {
    if (made.has(href)) return Promise.resolve(made.get(href));
    return fetch(href).then(function (r) { return r.blob(); });
  }

  var panel = null, last = 0;
  function offer(href, name) {
    var now = Date.now();
    if (now - last < 500) return; // one download handled once (click() and its click event)
    last = now;
    blobFor(href).then(function (blob) {
      var file = new File([blob], name || 'download', { type: blob.type || 'application/octet-stream' });
      var url = create.call(URL, file);
      if (panel) panel.remove();
      panel = document.createElement('div');
      panel.setAttribute('role', 'dialog');
      panel.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:14px 16px;border-radius:14px;'
        + 'background:#192235;color:#fff;font:15px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);'
        + 'display:flex;flex-wrap:wrap;align-items:center;gap:10px';
      var label = document.createElement('div');
      label.style.cssText = 'flex:1 1 220px;min-width:0;overflow-wrap:anywhere';
      label.textContent = T.ready + ': ' + file.name + ' (' + Math.max(1, Math.round(file.size / 1024)) + ' KB)';
      panel.appendChild(label);
      function button(text, primary, action) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = 'height:40px;padding:0 16px;border-radius:10px;border:0;font:600 15px/1 inherit;cursor:pointer;'
          + (primary ? 'background:#2f6fed;color:#fff' : 'background:#2c3647;color:#fff');
        b.addEventListener('click', action);
        panel.appendChild(b);
        return b;
      }
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        button(T.share, true, function () {
          navigator.share({ files: [file], title: file.name }).catch(function (error) {
            if (error && error.name !== 'AbortError') label.textContent = T.failed;
          });
        });
      }
      button(T.open, !navigator.canShare, function () { location.href = url; });
      button(T.close, false, function () { panel.remove(); panel = null; });
      document.body.appendChild(panel);
    }).catch(function () {});
  }

  function isDownload(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    var href = String(a.href || '');
    return href.indexOf('blob:') === 0 || href.indexOf('data:') === 0;
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownload(this)) { offer(this.href, this.getAttribute('download')); return; }
    return click.apply(this, arguments);
  };
  document.addEventListener('click', function (event) {
    var a = event.target && event.target.closest && event.target.closest('a[download]');
    if (isDownload(a)) { event.preventDefault(); offer(a.href, a.getAttribute('download')); }
  }, true);
})();
