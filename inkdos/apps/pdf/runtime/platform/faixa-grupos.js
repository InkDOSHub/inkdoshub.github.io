// Faixa no mesmo visual do Documents, Planilhas e Apresentações: cada grupo com o nome embaixo.
(function () {
  'use strict';
  const NOMES = { pdfHistoryGroup: 'Edit', pdfAnnotationTools: 'Annotate', pdfTextProperties: 'Text', pdfPenProperties: 'Pen', pdfNavigationGroup: 'Pages', pdfViewGroup: 'Zoom', pdfUtilityGroup: 'Document' };
  for (const id in NOMES) {
    const g = document.getElementById(id);
    if (!g || g.querySelector(':scope > .grupo-nome')) continue;
    const r = document.createElement('span');
    r.className = 'grupo-nome';
    r.setAttribute('data-inkdos-i18n-root', '');
    r.textContent = NOMES[id];
    g.classList.add('faixa-grupo');
    g.appendChild(r);
  }
})();
