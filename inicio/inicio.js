/* InkDOS Hub home screen: each card opens the tool in its own tab, loaded only when
   requested. Tapping an already open app again returns to its tab (assets/gerenciador-app.js).
   Each app manages its own memory. */
(function () {
  "use strict";
  var P = window.InkPaginas;
  var $ = function (id) { return document.getElementById(id); };

  // Cards
  Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (c) {
    c.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      P.abrir(c.dataset.app);
    });
  });

  // Search: filters apps by name, like Launchpad
  var busca = $("busca");
  if (busca) busca.addEventListener("input", function () {
    var q = busca.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll(".workspace-card"), function (c) {
      c.classList.toggle("fora-busca", !!q && c.textContent.toLowerCase().indexOf(q) < 0);
    });
  });

  // Menu: closes when tapping outside; "Customize" closes the menu and shows "Done" next to the search
  var menu = $("menu-inicio"), pronto = $("btn-pronto"), editar = $("btn-editar");
  document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  editar.addEventListener("click", function () {
    menu.open = false;
    setTimeout(function () { pronto.hidden = editar.getAttribute("aria-pressed") !== "true"; }, 0);
  });
  pronto.addEventListener("click", function () { editar.click(); });

  // Theme: switches here; other open tabs follow through the "storage" event
  $("tema").addEventListener("click", function () {
    var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("inkdoshub-tema", n); } catch (_) {}
    document.documentElement.dataset.theme = n;
    document.documentElement.style.colorScheme = n;
  });

  // Language: the button opens the packs notice (assets/idioma.js) and shows the current language
  if (window.InkIdioma) {
    $("idioma-texto").textContent = InkIdioma.nome();
    setTimeout(InkIdioma.conferirAtualizacao, 3000);
  }

  // old addresses (#terminal), from the version where apps opened inside this page
  var pedido = location.hash.slice(1), cartao = pedido && document.querySelector('[data-app="' + pedido.replace(/[^a-z]/g, "") + '"]');
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  try { localStorage.removeItem("inkdoshub-inicio"); localStorage.removeItem("inkdoshub-paginas"); } catch (_) {}
  if (cartao) location.href = cartao.href;
})();
