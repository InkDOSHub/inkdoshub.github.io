# 014 · Revisão depois das mudanças de 2026-10-30

Revisei o código mudado hoje (logs 010, 011 e 013) e as pendências baratas da auditoria antes de começar o app
do Windows, como o Paulo pediu.

## Conferido, sem mudança
- `inicio/offline.js` e `sw-portal.js`:
  - Os downloads só vêm da mesma origem (`?inkoff=`).
  - Nada é enviado para fora.
  - A anotação `__uso__` fica só no cache deste navegador e é apagada quando a tela inicial a lê.
  - A limpeza do cache preserva a marca e o `__uso__`.
- `apps/quadro`: as fontes vêm da pasta local (`fonts/`, status "loaded"). A tentativa extra do Excalidraw no CDN
  esm.sh é a lista de reserva da própria biblioteca e continua bloqueada pela CSP, sem efeito no desenho.
- Apresentações: o desenhador antigo do `slideshow-controller.js` ficou só para a impressão e como reserva. Ele não
  é código morto, mas é um caminho a menos para manter na tela cheia.

## Corrigido
- `tools/build_apps.sh`: o `npm i` principal agora usa `--ignore-scripts`. Antes só o ffmpeg usava. Os pacotes de
  fora não rodam scripts na compilação, e o Quadro foi compilado assim hoje (log 010) sem problema.
- `idiomas/*.json`: saiu o texto antigo do "i" do Offline ("Saves the whole InkDOS Hub…"), que não é mais usado.

## Ainda pendente (custa mais; espera decisão)
- Traduções que faltam (`tools/idiomas_textos.py` lista quais).
- Juntar jszip, pako e pdf-lib repetidos no InkDOS (cerca de 1 MB).
- Recompilar a imagem do Linux para valer o filtro do `inksessao` (log 005).
