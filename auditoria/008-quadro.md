# 008 · Quadro (2026-10-29)

**Lido:** `apps/quadro/src/main.jsx`, `index.html` e `freeform.css` (código próprio, 81 linhas), `UPSTREAM-SOURCE.txt` e uma busca de
endereços externos no pacote do Excalidraw 0.18.1 (`assets/`, de terceiros).

## Mudanças feitas

1. **Privacidade: o Quadro contatava um CDN de fora.** Ao abrir, o Excalidraw pedia fontes a `https://esm.sh/...` além das
   cópias locais em `fonts/`. Ele põe o CDN como alternativa em cada fonte, e o Chromium tentava baixar de lá. Isso contrariava o
   comentário "Fontes servidas daqui, nunca de um CDN" e o `SECURITY.md`. Agora o `index.html` tem uma CSP como a dos apps do InkDOS:
   scripts só do site (o script embutido vai por hash), `connect-src` e `font-src` só do site, `data:` e `blob:`, `object-src 'none'`,
   `base-uri 'none'` e `form-action 'none'`. O `frame-src https:` continua aberto porque a pessoa pode incorporar um vídeo (YouTube etc.) no quadro.
   **Teste:** num Chromium sem tela, o Quadro abriu, a fonte local carregou (200), um retângulo desenhado foi salvo e o CDN foi bloqueado.

## Achados sem mudança

- **Risco de perder desenho (recomendo corrigir):** o desenho é salvo no `localStorage`, incluindo as imagens coladas, em base64.
  O `localStorage` tem cerca de 5 MB; passou disso, a gravação falha em silêncio (`catch {}`) e o que foi desenhado depois não é salvo,
  sem aviso. Corrigir pede trocar para IndexedDB em `src/main.jsx` e **recompilar o Quadro** (`tools/build_apps.sh`, que baixa o
  Excalidraw e gera de novo os 184 arquivos de `assets/`). Isso é caro, por isso não foi feito sem o ok do Paulo.
- O menu usa só itens padrão do Excalidraw. O link compartilhável (que enviaria o desenho aos servidores do Excalidraw) e a colaboração
  ao vivo não aparecem, porque o app não passa as funções que os ligam. Os endereços deles existem no pacote, mas não são usados.
- "Procurar bibliotecas" abre `libraries.excalidraw.com` só quando a pessoa toca.

## Commit

Ver `git log -- auditoria/008-quadro.md`.
