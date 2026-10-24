// InkDOS, inside the ONLYOFFICE editor frames (web-apps/apps/*/main/index*.html, added by build.py):
// 1. Mouse wheel on iPad (Safari, XeOS): the editor engine listens only for the legacy "mousewheel" event, which
//    iPadOS WebKit does not send for a mouse or trackpad (only "wheel"), so scrolling did nothing. On such devices a
//    "wheel" is passed on as the legacy event the editor expects.
// 2. The ONLYOFFICE logo stays in the header (attribution) but no longer leads out of InkDOS to the vendor's site.
(function () {
  'use strict';
  var style = document.createElement('style');
  style.textContent = '#header-logo,#header-logo *{pointer-events:none!important;cursor:default!important}';
  (document.head || document.documentElement).appendChild(style);

  var ipad = navigator.maxTouchPoints > 1 && /Macintosh|iPad|iPhone/.test(navigator.userAgent);
  if (!ipad) return;
  var native = false;
  addEventListener('mousewheel', function (e) { if (e.isTrusted) native = true; }, true);
  addEventListener('wheel', function (e) {
    if (native || !e.isTrusted) return;
    var unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    var dx = e.deltaX * unit, dy = e.deltaY * unit, legacy;
    try {
      legacy = new WheelEvent('mousewheel', {
        bubbles: true, cancelable: true, view: window, detail: Math.round(dy / 40),
        screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        button: e.button, buttons: e.buttons, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode
      });
      Object.defineProperties(legacy, {
        wheelDelta: { value: Math.round(-dy) }, wheelDeltaY: { value: Math.round(-dy) }, wheelDeltaX: { value: Math.round(-dx) },
        detail: { value: Math.round(dy / 40) }
      });
    } catch (_) { return; }
    var cancelled = !e.target.dispatchEvent(legacy);
    // where the browser has no onmousewheel handler attribute, call the handler the editor assigned
    if (!('onmousewheel' in document.documentElement)) {
      for (var node = e.target; node; node = node.parentNode) {
        if (typeof node.onmousewheel === 'function') { if (node.onmousewheel(legacy) === false) cancelled = true; break; }
      }
    }
    if (cancelled || legacy.defaultPrevented) e.preventDefault();
  }, { capture: true, passive: false });
})();
