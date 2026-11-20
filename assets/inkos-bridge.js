// InkOS bridge: postMessage protocol v1 (InkOS docs/PROTOCOL.md) for pages
// that run inside an InkOS window. Does nothing outside an iframe.
// - ink-tema: light/dark (cosmetic only, nothing is stored)
// - inkos-vfs-file: a file from the InkOS Finder. Dispatched as window event
//   "inkos:file" (detail = File). If no handler calls preventDefault(), the
//   file opens the way the Hub home screen opens it: InkDOSFileLaunch
//   (InkDOS suite apps), else the page's first matching <input type="file">.
// - inkos-ready: sent to the InkOS parent once the listener is in place.
(function () {
  if (window.parent === window || window.__inkosBridge) return;
  window.__inkosBridge = true;

  var allowed = function (o) {
    return o === location.origin || o === "https://inkos-5k7.pages.dev" || /^https:\/\/[a-z0-9-]+\.inkos-5k7\.pages\.dev$/.test(o);
  };

  function applyTheme(theme) {
    var de = document.documentElement;
    de.dataset.theme = theme;
    de.style.colorScheme = theme;
    // InkDOS suite apps read these instead of data-theme.
    if (de.dataset.appearance !== undefined || de.dataset.appearanceResolved !== undefined) {
      de.dataset.appearance = theme;
      de.dataset.appearanceResolved = theme;
    }
  }

  function accepts(input, file) {
    var tokens = String(input.accept || "").split(",").map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
    if (!tokens.length) return true;
    var name = file.name.toLowerCase(), mime = String(file.type || "").toLowerCase();
    return tokens.some(function (t) {
      if (t.charAt(0) === ".") return name.slice(-t.length) === t;
      if (t.slice(-2) === "/*") return mime.indexOf(t.slice(0, -1)) === 0;
      return mime === t;
    });
  }

  function injectIntoInput(file) {
    if (typeof DataTransfer !== "function") return false;
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      if (!accepts(inputs[i], file)) continue;
      var dt = new DataTransfer();
      dt.items.add(file);
      inputs[i].files = dt.files;
      inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
      inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  function openFile(file) {
    var ev = new CustomEvent("inkos:file", { detail: file, cancelable: true });
    window.dispatchEvent(ev);
    if (ev.defaultPrevented) return;
    var fl = window.InkDOSFileLaunch;
    if (fl && typeof fl.routeFile === "function") {
      fl.routeFile(file).catch(function (e) { console.warn("[inkos-bridge] routeFile:", e); injectIntoInput(file); });
      return;
    }
    if (!injectIntoInput(file)) console.warn("[inkos-bridge] no handler for", file.name);
  }

  var pending = [];
  function whenReady(fn) {
    if (document.readyState === "complete") setTimeout(fn, 0);
    else window.addEventListener("load", function () { setTimeout(fn, 0); }, { once: true });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !allowed(e.origin)) return;
    var d = e.data;
    if (!d || typeof d !== "object" || (d.v !== undefined && d.v !== 1)) return;
    if (d.type === "ink-tema") {
      if (d.theme === "light" || d.theme === "dark") applyTheme(d.theme);
    } else if (d.type === "inkos-vfs-file" && d.v === 1) {
      if (typeof d.name !== "string" || !d.name || d.name.length > 255 || /[\/\\]/.test(d.name) || !(d.data instanceof ArrayBuffer)) return;
      var f = new File([d.data], d.name, { type: typeof d.mime === "string" ? d.mime : "" });
      // Apps wire their handlers while loading; open once the page is ready.
      pending.push(f);
      whenReady(function () { while (pending.length) openFile(pending.shift()); });
    }
  });

  try {
    var po = location.ancestorOrigins && location.ancestorOrigins[0];
    if (!po && document.referrer) po = new URL(document.referrer).origin;
    if (po && allowed(po)) window.parent.postMessage({ v: 1, type: "inkos-ready" }, po);
  } catch (_) {}
})();
