// Faixa como a do Excel: os botões ficam em grupos com o nome embaixo.
(function () {
  'use strict';
  const bar = document.getElementById('formatbar');
  if (!bar) return;
  const GRUPOS = [
    ['Edit', ['undoBtn', 'redoBtn', 'printBtn', 'formatPainterBtn']],
    ['Font', ['fontFamily', 'fontSize', 'boldBtn', 'italicBtn', 'underlineBtn', 'strikeBtn', 'textColorInput', 'fillColorInput', 'borderSides', 'borderStyle', 'borderWidth', 'borderColorInput']],
    ['Alignment', ['alignmentSelect', 'verticalAlignmentSelect', 'wrapSelect', 'rotationSelect', 'mergeBtn']],
    ['Number', ['numberFormat', 'currencyBtn', 'percentBtn', 'decreaseDecimalsBtn', 'increaseDecimalsBtn']],
    ['Insert', ['linkBtn', 'commentBtn', 'chartBtn']],
    ['Cells', ['addRowBtn', 'addColBtn', 'deleteRowBtn', 'deleteColBtn']],
    ['Editing', ['operationSelect', 'sortAscBtn', 'sortDescBtn', 'filterBtn', 'clearBtn']],
    ['View', ['zoomGroup', 'gridlinesBtn']]
  ];
  // o elemento que está direto na faixa (as listas podem estar dentro de uma caixa)
  const topo = el => { while (el && el.parentElement && el.parentElement !== bar && !el.parentElement.classList.contains('grupo-itens')) el = el.parentElement; return el; };
  const fim = bar.querySelector('.toolbar-end-spacer');
  for (const [nome, ids] of GRUPOS) {
    const g = document.createElement('div'), itens = document.createElement('div'), r = document.createElement('span');
    g.className = 'grupo'; itens.className = 'grupo-itens'; r.className = 'grupo-nome'; r.textContent = nome;
    g.append(itens, r);
    for (const id of ids) { const el = topo(document.getElementById(id)); if (el && el.parentElement === bar) itens.append(el); }
    if (itens.children.length) bar.insertBefore(g, fim);
  }
  for (const s of bar.querySelectorAll(':scope > .separator')) s.remove();
  window.dispatchEvent(new Event('resize'));
})();
