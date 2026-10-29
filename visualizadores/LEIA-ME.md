# Visualizadores (somente leitura)

Copiados do site publicado do InkDOS-tools (branch gh-pages, 2026-10-29) para o Hub não depender de outro repositório. O caminho /InkDOS-tools/ foi trocado por /visualizadores/.
- `odf/`: arquivos OpenDocument (.odt, .ods, .odp) via WebODF.
- `pnk/`: arquivos Apple (.pages, .numbers, .key) via pnk.
- `bentopdf/`: ferramentas de PDF do botão "Editar PDF" (~300 MB).
- `skins/`: temas usados pelo BentoPDF.
- `viewers/`: ponte entre o app e o visualizador (postMessage).

Licenças de cada um nos arquivos UPSTREAM-* da pasta.
Os apps em `inkdos/apps/*/io/external-viewer.js` abrem `/visualizadores/`.
