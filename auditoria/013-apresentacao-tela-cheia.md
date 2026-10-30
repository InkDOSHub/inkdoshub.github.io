# 013 · Apresentações: tela cheia igual à edição (2026-10-30)

Pedido do Paulo: o modo apresentação deve mostrar exatamente o que aparece na edição. No exemplo dele (um .ppt,
slide 5), na tela cheia o título subia, os textos Pensamento, Emoção e Cpto se juntavam numa linha, as setas
perdiam a ponta e havia dois X.

## Causa
`presentation/slideshow-controller.js` tinha um **segundo desenhador de slides**, mais simples que o da edição
(`view/slide-surface.js`). Ele não desenhava setas nem formas vetoriais, ignorava os objetos do modelo do slide,
os recuos e as tabulações e não aplicava o ajuste de texto dos arquivos .ppt (`fitLegacyText`). Cada correção
feita na edição ficava de fora da apresentação.

## Correção
- `app.js`: a apresentação pede o slide ao desenhador da edição (`renderForShow`), aplica o mesmo ajuste de
  texto do .ppt, copia o resultado (sem alças de seleção e sem edição de texto) e devolve o editor ao slide em
  que estava. Depois a cópia é só escalada, mantendo a proporção do arquivo (4:3, 16:9 etc.).
- `slideshow-controller.js`: usa essa cópia. O desenhador antigo ficou só como reserva e para a impressão.
- X duplicado: no iPad, o Safari mostra o próprio X na tela cheia, então o X do app se esconde nesse caso.
- A faixa amarela do .ppt ganhou um ✕ para fechar (commit b7cc1c8).
- Versões: `app.js?v=21`, `slideshow-controller.js?v=8`.

## Teste
Criei um .pptx 4:3 com título, três caixas de texto e setas e o abri no Playwright. As capturas da edição e da
tela cheia ficaram iguais em posições, fontes e setas, com faixas pretas nas laterais. Nenhum erro de JS.
