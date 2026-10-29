# 007 · InkDOS, rodada 2 (2026-10-29)

Segunda metade da parte 6: as engines de Documentos, Planilhas e Apresentações (e o leitor de EPUB), num total de
cerca de 7 mil linhas densas. Foco em segurança (o conteúdo vem de arquivos de terceiros) e em código sem uso.

**Lido:** CSP dos 6 apps, `documents/engine/docx-parser.js` (montagem do HTML, links e estilos), `epub/view/renderer.js` e
`epub/io/package-reader.js`, os pontos de `innerHTML`/`src`/`href` das três engines, a lista de arquivos carregados por cada
`index.html` e o `visualizadores/viewers/viewer-embed.js`.

## Mudanças feitas

1. **CSP dos 5 apps:** saiu `https://inkdos-tools.github.io` do `frame-src`. Esse site foi apagado e o nome da organização
   no GitHub ficou livre: quem o registrasse poderia publicar páginas que os apps aceitariam em quadro. Nada mais abre esse endereço.
2. **`visualizadores/viewers/viewer-embed.js`:** os visualizadores aceitavam receber arquivos de `https://vfydr2m9wk-ops.github.io`
   (o InkDOS antigo, já apagado). Agora aceitam só o próprio site, onde os apps do InkDOS estão.

## Segurança conferida (sem mudança)

- **CSP forte nos 6 apps:** scripts só do próprio site (e os embutidos, por hash), `connect-src 'self'` (o app não consegue mandar
  dados para fora), imagens só locais, `data:` ou `blob:` (um documento não consegue carregar imagem remota para rastrear quem
  abriu), `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. Mesmo se algum texto do arquivo virasse HTML, um script não rodaria.
- **DOCX:** todo texto passa por `esc()`; os links só aceitam `http:`, `https:` e `mailto:` (`safeHref`); a cor só aceita 6 dígitos
  hexadecimais; o nome da fonte perde aspas, `<>`, `;` e chaves (`safeFont`). O XML é lido com `DOMParser` como XML, nunca como HTML.
- **EPUB:** o livro não é inserido como HTML. O leitor monta os elementos um a um (`createElement` + texto), e as imagens viram `blob:`.
  O leitor do ZIP recusa caminhos vazios, com caracteres de controle ou fora do intervalo.
- Não há `console.log`, `debugger`, `TODO`, `eval` nem `new Function` no código próprio das engines.
- Os arquivos que parecem soltos (`xlsx-color-fidelity.js`, `ppt-p1-*-writer.js`, `ppt-p2-package.js`) são carregados sob demanda por outros scripts e continuam necessários.

## Achados sem mudança

- `runtime/frame/frame-menu.js`, `app-frame.css`, `tokens/base.css` e `content-viewport-adapter.js` existem em 4 a 5 apps, cada
  um numa versão diferente. Unificar exigiria testar cada app à mão; o ganho é pequeno (cerca de 140 linhas).
- Um ZIP muito grande (DOCX, XLSX, PPTX, EPUB) é aberto inteiro na memória. O pior caso é a aba fechar; não há risco aos dados.
- Os vendors repetidos (jszip, pako, pdf-lib) seguem como na rodada 1.

## Commit

Ver `git log -- auditoria/007-inkdos-rodada2.md`.
