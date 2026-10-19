# Ferramentas de build

Como recriar cada parte do site. Tudo o que vem de fora tem a origem em `UPSTREAM-SOURCE.txt` na própria pasta.

| Pasta do site | Como recriar |
|---|---|
| `terminal/images/` (Linux) | `tools/linux/build.sh` (kernel 6.6 + Alpine 3.22; arquivos próprios em `tools/linux/alpine-overlay/`) |
| `apps/foto/app/`, `apps/video/cortar/ffmpeg-core/`, `apps/quadro/`, `apps/codigo/vscode/` | `tools/build_apps.sh` (usa `minipaint-tema.html`) |
| `apps/wine/area/area.exe` | `tools/wine-area.sh` (mingw-w64) |
| `apps/wine/boxedwine/` | compilado à mão; versão e passos em `apps/wine/UPSTREAM-SOURCE.txt` |
| `onlyoffice/` | copiado de inkdos-tools/inkdos-tools.github.io; mudanças em `onlyoffice/UPSTREAM-SOURCE.txt` |
| `inkdos/` | `tools/copiar_inkdos.sh <clone do InkDOS>` (chama `adaptar_inkdos.py`) |
| `idiomas/*.json` | traduções da interface; `tools/idiomas_textos.py` mostra os textos que faltam em cada pacote |
| `inicio/manifesto.json` | `tools/portal_manifesto.py` (o workflow faz sozinho a cada push no main) |
