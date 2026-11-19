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
  // Dentro do InkOS (iframe): segue o tema do desktop, só cosmético, sem gravar nada
  if (window.parent !== window) {
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.type !== "ink-tema" || (d.theme !== "light" && d.theme !== "dark")) return;
      document.documentElement.dataset.theme = d.theme;
      document.documentElement.style.colorScheme = d.theme;
    });
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
