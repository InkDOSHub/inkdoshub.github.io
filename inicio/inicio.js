/* Tela inicial do InkDOS Hub: cada cartão abre a ferramenta na própria aba, carregada só quando é
   pedida. Tocar de novo num app já aberto volta para a aba dele (assets/gerenciador-app.js).
   Cada app cuida da própria memória. */
(function () {
  "use strict";
  var P = window.InkPaginas;
  var $ = function (id) { return document.getElementById(id); };

  // Cartões
  Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (c) {
    c.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      P.abrir(c.dataset.app);
    });
  });

  // Busca: filtra os apps pelo nome, como no Launchpad
  var busca = $("busca");
  if (busca) busca.addEventListener("input", function () {
    var q = busca.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll(".workspace-card"), function (c) {
      c.classList.toggle("fora-busca", !!q && c.textContent.toLowerCase().indexOf(q) < 0);
    });
  });

  // Menu: fecha ao tocar fora; "Customize" fecha o menu e mostra "Done" ao lado da busca
  var menu = $("menu-inicio"), pronto = $("btn-pronto"), editar = $("btn-editar");
  document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  editar.addEventListener("click", function () {
    menu.open = false;
    setTimeout(function () { pronto.hidden = editar.getAttribute("aria-pressed") !== "true"; }, 0);
  });
  pronto.addEventListener("click", function () { editar.click(); });

  // Tema: troca aqui; as outras abas abertas acompanham pelo evento "storage"
  $("tema").addEventListener("click", function () {
    var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("inkdoshub-tema", n); } catch (_) {}
    document.documentElement.dataset.theme = n;
    document.documentElement.style.colorScheme = n;
  });

  // Idioma: o botão abre o aviso de pacotes (assets/idioma.js) e mostra o idioma atual
  if (window.InkIdioma) {
    $("idioma-texto").textContent = InkIdioma.nome();
    setTimeout(InkIdioma.conferirAtualizacao, 3000);
  }

  // endereços antigos (#terminal), da versão em que os apps abriam dentro desta página
  var pedido = location.hash.slice(1), cartao = pedido && document.querySelector('[data-app="' + pedido.replace(/[^a-z]/g, "") + '"]');
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  try { localStorage.removeItem("inkdoshub-inicio"); localStorage.removeItem("inkdoshub-paginas"); } catch (_) {}
  if (cartao) location.href = cartao.href;
})();
