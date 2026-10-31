// Faixa no visual do Office: junta os botões entre os separadores em grupos com o nome embaixo.
// Os separadores ficam onde estão (alguns apps os usam como âncora). Nomes: data-grupos="idDoPrimeiro:Nome;...".
(function () {
  'use strict';
  const eu = document.currentScript;
  const bar = document.getElementById('toolbar');
  if (!bar || !eu) return;
  const nomes = {};
  for (const par of (eu.dataset.grupos || '').split(';')) { const [id, nome] = par.split(':'); if (id && nome) nomes[id] = nome; }
  let corrida = [];
  const fechar = () => {
    if (!corrida.length) return;
    const ids = corrida.flatMap(n => [n.id, ...[...(n.querySelectorAll ? n.querySelectorAll('[id]') : [])].map(x => x.id)]);
    const nome = ids.map(i => nomes[i]).find(Boolean);
    const g = document.createElement('div'), itens = document.createElement('div');
    g.className = 'grupo'; itens.className = 'grupo-itens';
    corrida[0].before(g);
    itens.append(...corrida);
    g.append(itens);
    if (nome) { const r = document.createElement('span'); r.className = 'grupo-nome'; r.setAttribute('data-inkdos-i18n-root', ''); r.textContent = nome; g.append(r); }
    corrida = [];
  };
  for (const n of [...bar.children]) {
    if (n.classList.contains('tool-sep') || n.matches('[aria-hidden="true"]:empty')) fechar();
    else corrida.push(n);
  }
  fechar();
})();
