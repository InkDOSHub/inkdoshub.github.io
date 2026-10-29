# Ferramentas de build

Como recriar cada parte do site. Tudo o que vem de fora tem a origem em `UPSTREAM-SOURCE.txt` na própria pasta.

| Pasta do site | Como recriar |
|---|---|
| `terminal/images/` (Linux) | `tools/linux/build.sh` (kernel 6.6 + Alpine 3.22; arquivos próprios em `tools/linux/alpine-overlay/`) |
| `apps/video/cortar/ffmpeg-core/`, `apps/quadro/`, `apps/codigo/vscode/` | `tools/build_apps.sh` |
| `onlyoffice/` | mantido aqui (o repositório de origem foi apagado em 2026-10-29); mudanças em `onlyoffice/UPSTREAM-SOURCE.txt` |
| `inkdos/` | mantido aqui (o repositório do InkDOS foi apagado em 2026-10-29); mudanças em `inkdos/UPSTREAM-SOURCE.txt` |
| `visualizadores/` (BentoPDF, WebODF, pnk) | receita original em `tools/inkdos-tools/` (`build.py` + `tools.json`, do repositório InkDOS-tools apagado em 2026-10-29); depois do build, `/InkDOS-tools/` foi trocado por `/visualizadores/` |
| `idiomas/*.json` | traduções da interface; `tools/idiomas_textos.py` mostra os textos que faltam em cada pacote |
| `inicio/manifesto.json` | `tools/portal_manifesto.py` (o workflow faz sozinho a cada push no main) |
