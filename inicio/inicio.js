/* Tela inicial do InkTerminal: cada cartão abre a ferramenta na própria aba, carregada só quando é
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

  // Painel "Uso sem internet"
  var painel = $("painel-offline"), botao = $("btn-offline");
  function fechar() { painel.hidden = true; botao.setAttribute("aria-expanded", "false"); }
  botao.addEventListener("click", function (e) {
    e.stopPropagation();
    var abrir = painel.hidden;
    painel.hidden = !abrir;
    botao.setAttribute("aria-expanded", String(abrir));
    if (abrir && window.InkOffline) InkOffline.atualizar();
  });
  painel.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", fechar);

  // Tema: troca aqui; as outras abas abertas acompanham pelo evento "storage"
  $("tema").addEventListener("click", function () {
    var n = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("inkterminal-tema", n); } catch (_) {}
    document.documentElement.dataset.theme = n;
    document.documentElement.style.colorScheme = n;
  });

  // endereços antigos (#terminal), da versão em que os apps abriam dentro desta página
  var pedido = location.hash.slice(1), cartao = pedido && document.querySelector('[data-app="' + pedido.replace(/[^a-z]/g, "") + '"]');
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  try { localStorage.removeItem("inkterminal-inicio"); localStorage.removeItem("inkterminal-paginas"); } catch (_) {}
  if (cartao) location.href = cartao.href;
})();
