# ArtCraft icons for the InkDOS toolbars

The InkDOS apps (Documents, Spreadsheets, Presentations, PDF, Text, EPUB) show, on every toolbar
control, the icon of the ArtCraft equivalent: WordCraft for Documents, PDF, Text and EPUB, GridCraft
for Spreadsheets, DeckCraft for Presentations. ArtCraft draws its icons in Rust (egui painter); the
exporter runs that code and writes the shapes as SVG.

Result: `inkdos/shared/artcraft-icons.js` (icons + map, loaded by each app), the icons inside the
apps' `index.html`, and the dropdown icons (CSS data URIs) of the pickers.

Rebuild (after an ArtCraft icon change or a map change):

```sh
cd tools/artcraft-icons/export && ./fetch.sh && mkdir -p out && \
  cargo build --release --bins && for b in wc gc dc; do ./target/release/$b; done
cd .. && python3 generate.py export/out ../..
python3 ../portal_manifesto.py
```

- `maps.py`: InkDOS control (CSS selector) → ArtCraft icon name. `name:bar` marks a colour control:
  the ArtCraft colour bar under the icon follows the chosen colour.
- Ink lines use `currentColor`; ArtCraft's accent colours stay as drawn.
- Brush and ☰ in the top bar are InkDOS Hub chrome and keep their icons.
