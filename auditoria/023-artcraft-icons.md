# 023 · InkDOS toolbars use the ArtCraft icons (2026-11-01)

## Request
The toolbar items of the InkDOS apps must look like their equivalent in the ArtCraft apps: a full
replacement of the icons (not a restyle on top), with no change to what the controls do. ArtCraft is the
visual base for icons from now on. Also reported on iPad: the Presentations paint bucket looked broken, the
colour under it showed as a square overflowing the bar, and the zoom % did not fit its box.

## What changed
| Part | Change |
|---|---|
| Icons | ArtCraft draws its icons in Rust (egui). `tools/artcraft-icons/export` runs that code and writes every shape as SVG: 328 WordCraft, 131 GridCraft, 245 DeckCraft icons. |
| Map | `tools/artcraft-icons/maps.py`: each InkDOS control → its ArtCraft equivalent. Documents, PDF, Text and EPUB use WordCraft; Spreadsheets uses GridCraft; Presentations uses DeckCraft. 130 icons in use, about 200 controls in the 6 apps. |
| Static controls | The old `<svg>` (or the B / I / U letters) inside each control in `index.html` is replaced by the ArtCraft one. Ids, classes, titles and handlers are untouched. |
| Controls built by scripts | `inkdos/shared/artcraft-icons.js` (generated) replaces the icon of controls created later (Presentations tools, PDF reader tools, ☰ menu entries…) as soon as they are added. |
| Dropdown pickers | The icon drawn in the picker boxes (style, alignment, borders, layout, shape, transition…) is the ArtCraft icon, in light and dark. |
| Colour controls | Text colour, fill and border (Spreadsheets, Presentations) use the ArtCraft icon with its colour bar; the bar follows the chosen colour. The separate swatch and the visible native colour square are gone, so nothing overflows the bar. |
| Zoom box | The % field is sized in characters (`calc(5ch + 12px)`), so "100%"–"400%" fit at any font. |

Kept: brush and ☰ in the top bar (InkDOS Hub chrome).

## Test
Playwright, 1000×700 and 1366×700: every toolbar icon in the 6 apps is the ArtCraft one (only brush and ☰ keep
theirs), no page errors, fill colour bar changes with the picker, zoom field content fits (`scrollWidth = clientWidth`).
