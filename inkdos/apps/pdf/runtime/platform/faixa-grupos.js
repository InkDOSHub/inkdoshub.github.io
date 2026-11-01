// Ribbon with the same look as Documents, Spreadsheets and Presentations: each group with its name below.
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
