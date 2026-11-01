# Build tools

How to rebuild each part of the site. Everything from outside has its origin in `UPSTREAM-SOURCE.txt` in its own folder.

| Site folder | How to rebuild |
|---|---|
| `terminal/images/` (Linux) | `tools/linux/build.sh` (kernel 6.6 + Alpine 3.22; own files in `tools/linux/alpine-overlay/`) |
| `apps/video/cortar/ffmpeg-core/`, `apps/quadro/`, `apps/codigo/vscode/` | `tools/build_apps.sh` |
| `artcraft/` | `.github/workflows/artcraft.yml` (downloads the WordCraft, GridCraft and DeckCraft web releases) |
| `inkdos/` | maintained here (the InkDOS repository was deleted on 2026-10-29); changes in `inkdos/UPSTREAM-SOURCE.txt` |
| `visualizadores/` (BentoPDF, WebODF, pnk) | original recipe in `tools/inkdos-tools/` (`build.py` + `tools.json`, from the InkDOS-tools repository deleted on 2026-10-29); after the build, `/InkDOS-tools/` was replaced by `/visualizadores/`. `visualizadores/` already has its own changes (e.g. `viewers/bento-carry.js`, `docx/viewer.js`), so it is the source; the recipe is reference only |
| `idiomas/*.json` | interface translations; `tools/idiomas_textos.py` shows the missing texts in each pack |
| `inicio/manifesto.json` | `tools/portal_manifesto.py` (the workflow runs it on every push to main) |
