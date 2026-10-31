// Régua como a do Word: acompanha a página na tela (posição, zoom e rolagem lateral),
// área de texto em branco e margens em cinza, marcas a cada meio centímetro.
(function () {
  'use strict';
  const regua = document.getElementById('ruler');
  const trilho = regua && regua.querySelector('.ruler-track');
  const tela = document.getElementById('viewport');
  const host = document.getElementById('pagesHost');
  if (!regua || !trilho || !tela || !host) return;
  const NS = globalThis.InkDOS2Documents || {};
  let pedido = 0, ultimo = '';

  function paginaAtual() {
    const pags = host.querySelectorAll('.doc-page');
    if (!pags.length) return null;
    const meio = tela.getBoundingClientRect().top + tela.clientHeight / 2;
    for (const p of pags) { const r = p.getBoundingClientRect(); if (r.bottom >= meio) return p; }
    return pags[pags.length - 1];
  }

  function ajustar() {
    pedido = 0;
    const p = host.hidden ? null : paginaAtual();
    if (!p) { regua.classList.remove('regua-word'); trilho.removeAttribute('style'); ultimo = ''; return; }
    const spec = NS.PageSpec ? NS.PageSpec.normalize(p._pageSpec) : { widthPx: 816, marginLeftPx: 86, marginRightPx: 86, contentWidthPx: 644 };
    const r = p.getBoundingClientRect(), base = regua.getBoundingClientRect();
    const esc = r.width / spec.widthPx;
    const ml = spec.marginLeftPx * esc, mr = spec.marginRightPx * esc;
    const chave = [r.left - base.left, r.width, ml, mr].map(Math.round).join();
    if (chave === ultimo) return;
    ultimo = chave;
    regua.classList.add('regua-word');
    const s = trilho.style;
    s.left = (r.left - base.left + ml) + 'px';
    s.width = Math.max(1, spec.contentWidthPx * esc) + 'px';
    s.setProperty('--ml', ml + 'px');
    s.setProperty('--mr', mr + 'px');
    s.setProperty('--cm', (96 / 2.54) * esc + 'px');
    window.dispatchEvent(new Event('inkdos-regua'));
  }
  const pedir = () => { if (!pedido) pedido = requestAnimationFrame(ajustar); };

  tela.addEventListener('scroll', pedir, { passive: true });
  window.addEventListener('resize', pedir);
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(pedir); ro.observe(host); ro.observe(tela); }
  new MutationObserver(pedir).observe(host, { childList: true, attributes: true, attributeFilter: ['hidden', 'style'] });
  pedir();
})();
