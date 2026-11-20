// InkDOS Hub theme (light/dark), the same on every page.
// Stored in localStorage "inkdoshub-tema"; with no choice, follows the device.
(function () {
  // Migrates once the keys of the old name ("inkter" + "minal-*") to "inkdoshub-*".
  try {
    var p = "inkter" + "minal-";
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && k.indexOf(p) === 0) {
        var nk = "inkdoshub-" + k.slice(p.length);
        if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}
  var t;
  try { t = localStorage.getItem("inkdoshub-tema"); } catch (_) {}
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  // Catppuccin: carrega catppuccin.css ao lado deste script
  try {
    var s = document.currentScript && document.currentScript.src;
    if (s) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = s.replace(/tema\.js.*$/, "catppuccin.css"); document.head.appendChild(l); }
  } catch (_) {}
  // Dentro do InkOS (iframe): protocolo postMessage v1 (InkOS docs/PROTOCOL.md).
  // Só aceita mensagens do frame pai e de origens InkOS conhecidas.
  if (window.parent !== window) {
    var inkosOrigem = function (o) {
      return o === location.origin || o === "https://inkos-5k7.pages.dev" || /^https:\/\/[a-z0-9-]+\.inkos-5k7\.pages\.dev$/.test(o);
    };
    window.addEventListener("message", function (e) {
      if (e.source !== window.parent || !inkosOrigem(e.origin)) return;
      var d = e.data;
      if (!d || typeof d !== "object" || (d.v !== undefined && d.v !== 1)) return;
      if (d.type === "ink-tema") {
        // Tema: só cosmético, sem gravar nada
        if (d.theme !== "light" && d.theme !== "dark") return;
        document.documentElement.dataset.theme = d.theme;
        document.documentElement.style.colorScheme = d.theme;
      } else if (d.type === "inkos-vfs-file" && d.v === 1) {
        // Arquivo do VFS do InkOS: o app escuta window "inkos:file" (detail = File)
        if (typeof d.name !== "string" || !d.name || /[\/\\]/.test(d.name) || !(d.data instanceof ArrayBuffer)) return;
        var f = new File([d.data], d.name, { type: typeof d.mime === "string" ? d.mime : "" });
        window.dispatchEvent(new CustomEvent("inkos:file", { detail: f }));
      }
    });
    // Avisa o InkOS que o listener está pronto (origem explícita, nunca "*")
    try {
      var po = location.ancestorOrigins && location.ancestorOrigins[0];
      if (po && inkosOrigem(po)) window.parent.postMessage({ v: 1, type: "inkos-ready" }, po);
    } catch (_) {}
  }
  window.inkTema = {
    atual: function () { return document.documentElement.dataset.theme; },
    trocar: function () {
      var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("inkdoshub-tema", n); } catch (_) {}
      location.reload();
    },
  };
})();
