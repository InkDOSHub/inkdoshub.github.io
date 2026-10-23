// Tema do InkDOS Hub (claro/escuro), igual em todas as páginas.
// Fica em localStorage "inkdoshub-tema"; sem escolha, segue o aparelho.
(function () {
  // Migra uma vez as chaves do nome antigo ("inkter" + "minal-*") para "inkdoshub-*".
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
  window.inkTema = {
    atual: function () { return document.documentElement.dataset.theme; },
    trocar: function () {
      var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("inkdoshub-tema", n); } catch (_) {}
      location.reload();
    },
  };
})();
