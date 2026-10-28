/* Barra comum: "‹ InkDOS Hub" à esquerda, símbolo + nome do app no centro, botões à direita.
   No celular os botões vão para um menu ☰. */
(function () {
  function montar() {
    var bar = document.querySelector(".ink-bar");
    if (!bar || bar.dataset.montada) return;
    bar.dataset.montada = "1";
    var home = bar.querySelector(".ink-home"), titulo = bar.querySelector(".ink-title");
    var esq = document.createElement("div"), meio = document.createElement("div"), dir = document.createElement("div");
    esq.className = "ink-esq"; meio.className = "ink-meio"; dir.className = "ink-dir";
    var itens = document.createElement("div"); itens.className = "ink-itens";
    Array.prototype.slice.call(bar.childNodes).forEach(function (n) {
      if (n === home || n === titulo) return;
      if (n.nodeType === 1 && (n.classList.contains("ink-spacer") || n.classList.contains("ink-status"))) { if (n.classList.contains("ink-status")) n.hidden = true, document.body.appendChild(n); else n.remove(); return; }
      if (n.nodeType === 1) itens.appendChild(n);
    });
    if (home) esq.appendChild(home);
    var m = location.pathname.match(/\/apps\/([^/]+)\//), app = m ? m[1] : (/\/terminal\//.test(location.pathname) ? "terminal" : "");
    var raiz = home ? home.getAttribute("href") : "../../";
    if (app) { var img = document.createElement("img"); img.className = "ink-simbolo"; img.alt = ""; img.src = raiz + "assets/icones-inkdos/" + app + ".svg"; meio.appendChild(img); }
    if (titulo) meio.appendChild(titulo);
    dir.appendChild(itens);
    var menu = null;
    if (itens.children.length) {
      menu = document.createElement("button");
      menu.className = "ink-btn ink-menu"; menu.type = "button"; menu.title = "Menu"; menu.setAttribute("aria-label", "Menu");
      menu.innerHTML = '<svg class="ink-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      menu.addEventListener("click", function (e) { e.stopPropagation(); bar.classList.toggle("menu-aberto"); });
      document.addEventListener("click", function (e) { if (!itens.contains(e.target) || e.target.closest("button,a")) bar.classList.remove("menu-aberto"); });
      dir.appendChild(menu);
    }
    bar.textContent = ""; bar.append(esq, meio, dir);
    function ajustar() {
      bar.classList.remove("compacta");
      var visiveis = Array.prototype.some.call(itens.querySelectorAll(".ink-btn,details,a"), function (e) { return e.offsetWidth > 0; });
      if (!visiveis) { if (menu) menu.hidden = true; return; }
      if (menu) menu.hidden = false;
      if (itens.scrollWidth > (bar.clientWidth - meio.offsetWidth) / 2 - 24) bar.classList.add("compacta");
    }
    ajustar(); addEventListener("resize", ajustar); addEventListener("load", ajustar);
    if (window.MutationObserver) new MutationObserver(function () { if (!bar.classList.contains("menu-aberto")) ajustar(); }).observe(itens, { attributes: true, subtree: true, attributeFilter: ["hidden", "class", "disabled"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar); else montar();
})();
