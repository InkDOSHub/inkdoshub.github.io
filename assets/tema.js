// Tema do InkTerminal (claro/escuro), igual em todas as páginas.
// Fica em localStorage "inkterminal-tema"; sem escolha, segue o aparelho.
(function () {
  var t;
  try { t = localStorage.getItem("inkterminal-tema"); } catch (_) {}
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  window.inkTema = {
    atual: function () { return document.documentElement.dataset.theme; },
    trocar: function () {
      var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem("inkterminal-tema", n); } catch (_) {}
      location.reload();
    },
  };
})();
