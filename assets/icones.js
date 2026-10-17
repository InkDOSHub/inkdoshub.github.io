/* Ícones de linha do InkTerminal (desenhos do Lucide, licença ISC, https://lucide.dev).
   Uso: <button data-icone="play"></button>, ou inkIcone("play") para gerar o SVG. */
(function () {
  var P = {
    voltar: '<path d="m15 18-6-6 6-6"/>',
    anterior: '<path d="m15 18-6-6 6-6"/>',
    proxima: '<path d="m9 18 6-6-6-6"/>',
    cima: '<path d="m18 15-6-6-6 6"/>',
    baixo: '<path d="m6 9 6 6 6-6"/>',
    play: '<path d="M6 3.8v16.4a1 1 0 0 0 1.5.86l13.6-8.2a1 1 0 0 0 0-1.72L7.5 2.94A1 1 0 0 0 6 3.8z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
    "faixa-anterior": '<path d="M19 20 9 12l10-8z" fill="currentColor"/><path d="M5 19V5"/>',
    "faixa-proxima": '<path d="m5 4 10 8-10 8z" fill="currentColor"/><path d="M19 5v14"/>',
    aleatorio: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.97a4 4 0 0 0 3.3-1.7l5.45-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.97a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45"/>',
    repetir: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    "repetir-uma": '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>',
    "zoom-mais": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35M11 8v6M8 11h6"/>',
    "zoom-menos": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35M8 11h6"/>',
    girar: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
    tocando: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  };
  window.inkIcone = function (n) {
    return '<svg class="ink-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[n] || "") + "</svg>";
  };
  function aplicar(raiz) {
    [].forEach.call((raiz || document).querySelectorAll("[data-icone]"), function (el) {
      if (el.querySelector(".ink-ico")) return;
      el.insertAdjacentHTML("afterbegin", inkIcone(el.dataset.icone));
    });
  }
  window.inkIcones = aplicar;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { aplicar(); });
  else aplicar();
})();
