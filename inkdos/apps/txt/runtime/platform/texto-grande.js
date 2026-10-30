// Texto grande sem gastar memória à toa.
// O <textarea> do Chromium desenha o texto inteiro: um .txt de 20 MB custava ~650 MB (medido no Edge, WebView2,
// Brave e Electron). Acima de LIMITE caracteres o campo guarda só uma janela do documento (JANELA caracteres, em
// linhas inteiras) e troca a janela sozinho quando a rolagem chega perto das pontas, sem pular a posição.
// value, selectionStart/End, setSelectionRange, setRangeText e select() continuam valendo para o documento
// inteiro, então o resto do app não muda. Abaixo do LIMITE nada disso entra em ação.
(function () {
  'use strict';
  const ta = document.getElementById('editor');
  if (!ta) return;
  const P = HTMLTextAreaElement.prototype;
  const dv = Object.getOwnPropertyDescriptor(P, 'value');
  const ds = Object.getOwnPropertyDescriptor(P, 'selectionStart');
  const de = Object.getOwnPropertyDescriptor(P, 'selectionEnd');
  const nget = () => dv.get.call(ta);
  const nset = v => { trocando = true; dv.set.call(ta, v); trocando = false; };
  const JANELA = 1 << 20, PASSO = JANELA / 4, LIMITE = JANELA * 1.5;
  let pre = '', pos = '', ativo = false, trocando = false, tudo = false;

  const inteiro = () => (ativo ? pre + nget() + pos : nget());
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));
  // início da linha que contém i (se a linha for enorme, corta em i mesmo)
  function corte(t, i) {
    if (i <= 0) return 0;
    if (i >= t.length) return t.length;
    const j = t.lastIndexOf('\n', i - 1);
    return j >= 0 && i - (j + 1) < PASSO / 2 ? j + 1 : i;
  }

  // altura que um trecho ocupa no campo: um textarea escondido com a mesma largura e fonte
  let espelho = null;
  const COPIAR = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing', 'lineHeight', 'tabSize',
    'whiteSpace', 'overflowWrap', 'wordBreak', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'textIndent'];
  function altura(txt) {
    if (!espelho) {
      espelho = document.createElement('textarea');
      espelho.setAttribute('aria-hidden', 'true');
      espelho.tabIndex = -1;
      espelho.spellcheck = false;
      document.body.appendChild(espelho);
    }
    const cs = getComputedStyle(ta);
    espelho.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;overflow-y:scroll;height:0;min-height:0;padding-top:0;padding-bottom:0;border-top:0;border-bottom:0;resize:none';
    for (const k of COPIAR) espelho.style[k] = cs[k];
    espelho.style.width = cs.width;
    espelho.wrap = ta.wrap;
    dv.set.call(espelho, '');
    const vazio = espelho.scrollHeight;
    dv.set.call(espelho, txt);
    const h = espelho.scrollHeight - vazio;
    dv.set.call(espelho, '');
    return h;
  }

  function selecao() { return [ds.get.call(ta) + pre.length, de.get.call(ta) + pre.length]; }
  function selecionar(a, b) {
    const n = nget().length;
    P.setSelectionRange.call(ta, lim(a - pre.length, 0, n), lim(b - pre.length, 0, n));
  }

  // põe na tela a janela [ini, fim) do documento
  function janela(t, ini, fim) {
    if (ini < PASSO / 2) ini = 0;
    if (t.length - fim < PASSO / 2) fim = t.length;
    pre = t.slice(0, ini);
    pos = t.slice(fim);
    nset(t.slice(ini, fim));
  }
  function janelaEm(centro) {
    const t = inteiro();
    const ini = corte(t, Math.max(0, centro - JANELA / 2));
    janela(t, ini, Math.max(ini + 1, corte(t, Math.min(t.length, ini + JANELA))));
  }

  function avancar() {
    const w = nget(), k = corte(w, PASSO);
    if (k <= 0 || !pos) return;
    let add = corte(pos, PASSO);
    if (add <= 0) add = Math.min(PASSO, pos.length);
    if (pos.length - add < PASSO / 2) add = pos.length;
    const sai = w.slice(0, k), h = altura(sai), [a, b] = selecao(), topo = ta.scrollTop;
    pre += sai;
    const novo = w.slice(k) + pos.slice(0, add);
    pos = pos.slice(add);
    nset(novo);
    selecionar(a, b);
    ta.scrollTop = topo - h;
  }
  function recuar() {
    if (!pre) return;
    const w = nget();
    let k = corte(pre, pre.length - PASSO);
    if (k < PASSO / 2) k = 0;
    const entra = pre.slice(k), c = corte(w, Math.max(1, w.length - PASSO));
    const h = altura(entra), [a, b] = selecao(), topo = ta.scrollTop;
    pre = pre.slice(0, k);
    pos = w.slice(c) + pos;
    nset(entra + w.slice(0, c));
    selecionar(a, b);
    ta.scrollTop = topo + h;
  }

  ta.addEventListener('scroll', () => {
    if (!ativo || trocando) return;
    const tela = ta.clientHeight;
    if (pos && ta.scrollTop + tela * 2 > ta.scrollHeight) avancar();
    else if (pre && ta.scrollTop < tela) recuar();
  }, { passive: true });

  Object.defineProperty(ta, 'value', {
    configurable: true,
    get: inteiro,
    set(v) {
      v = String(v);
      tudo = false;
      if (v.length > LIMITE) {
        ativo = true;
        janela(v, 0, corte(v, JANELA));
        ta.scrollTop = 0;
      } else {
        ativo = false; pre = ''; pos = '';
        nset(v);
      }
    }
  });
  Object.defineProperty(ta, 'selectionStart', {
    configurable: true,
    get() { return ds.get.call(ta) + (ativo ? pre.length : 0); },
    set(v) { ta.setSelectionRange(v, Math.max(v, ta.selectionEnd)); }
  });
  Object.defineProperty(ta, 'selectionEnd', {
    configurable: true,
    get() { return de.get.call(ta) + (ativo ? pre.length : 0); },
    set(v) { ta.setSelectionRange(Math.min(v, ta.selectionStart), v); }
  });
  ta.setSelectionRange = function (a, b, dir) {
    tudo = false;
    if (!ativo) return P.setSelectionRange.call(ta, a, b, dir);
    if (a < pre.length || a > pre.length + nget().length) janelaEm(a);
    const n = nget().length;
    return P.setSelectionRange.call(ta, lim(a - pre.length, 0, n), lim(b - pre.length, 0, n), dir);
  };
  ta.setRangeText = function (texto, a, b, modo) {
    tudo = false;
    if (!ativo || arguments.length < 3) return P.setRangeText.apply(ta, arguments);
    if (a < pre.length || b > pre.length + nget().length) janelaEm(a);
    if (a >= pre.length && b <= pre.length + nget().length) return P.setRangeText.call(ta, texto, a - pre.length, b - pre.length, modo);
    // trecho maior que a janela: troca no documento inteiro
    const t = inteiro(), [sa, sb] = selecao();
    ta.value = t.slice(0, a) + texto + t.slice(b);
    const fim = a + texto.length;
    if (modo === 'end') ta.setSelectionRange(fim, fim);
    else if (modo === 'select') ta.setSelectionRange(a, fim);
    else if (modo === 'start') ta.setSelectionRange(a, a);
    else ta.setSelectionRange(sa, sb);
  };
  // "Selecionar tudo" com texto grande: marca a janela e lembra que é o documento inteiro (copiar, recortar, apagar e digitar valem para tudo)
  ta.select = function () {
    P.select.call(ta);
    tudo = ativo && (!!pre || !!pos);
  };
  ta.addEventListener('keydown', e => {
    if (ativo && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); ta.select(); }
  });
  const inteiraMarcada = () => tudo && ativo && ds.get.call(ta) === 0 && de.get.call(ta) === nget().length;
  for (const tipo of ['copy', 'cut']) ta.addEventListener(tipo, e => {
    if (!inteiraMarcada() || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', inteiro());
    if (tipo === 'cut') { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  ta.addEventListener('beforeinput', e => {
    if (!inteiraMarcada()) { tudo = false; return; }
    const t = e.inputType || '';
    let novo = null;
    if (t.startsWith('delete')) novo = '';
    else if (t === 'insertText' || t === 'insertReplacementText') novo = e.data || '';
    else if (t === 'insertLineBreak' || t === 'insertParagraph') novo = '\n';
    else if (t === 'insertFromPaste' || t === 'insertFromDrop') novo = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
    if (novo === null) return;
    e.preventDefault();
    ta.value = novo;
    P.setSelectionRange.call(ta, novo.length, novo.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const tipo of ['mousedown', 'keyup']) ta.addEventListener(tipo, () => { if (tudo && !inteiraMarcada()) tudo = false; });
})();
