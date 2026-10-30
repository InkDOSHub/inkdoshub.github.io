# 010 · Quadro: desenho salvo no IndexedDB (2026-10-30)

## Problema (achado na parte 7, log 008)
O Quadro salvava o desenho no `localStorage`. Esse espaço tem cerca de 5 MB, e o erro era engolido em silêncio:
um desenho com imagens podia parar de ser salvo sem nenhum aviso.

## Mudança
- `apps/quadro/src/main.jsx`: o desenho vai para o IndexedDB (banco `inkdoshub-quadro`, loja `desenho`, chave
  `atual`). Esse espaço é bem maior e o navegador avisa quando falta lugar.
- Migração: na primeira abertura, um desenho antigo do `localStorage` é copiado para o IndexedDB e apagado de lá.
- Se a gravação falhar, aparece um aviso vermelho no canto da tela ("The drawing could not be saved in this
  browser."), traduzido nos 7 `idiomas/*.json`.
- Recompilado só o Quadro, com as mesmas versões do `tools/build_apps.sh` (Excalidraw 0.18.1, React 18.3.1,
  esbuild 0.25), instaladas com `--ignore-scripts`. O `index.html` e a CSP não mudaram (o script embutido é o
  mesmo, então o hash continua valendo).

## Teste (Playwright)
- Um desenho antigo no `localStorage` foi migrado e o `localStorage` ficou vazio.
- Desenhei um retângulo, recarreguei, e os 2 elementos voltaram do IndexedDB.
- Nenhum erro de JS. Continuam bloqueadas pela CSP, como esperado, as fontes que o Excalidraw tenta buscar no
  CDN esm.sh (achado do log 008). O desenho usa as fontes locais.
