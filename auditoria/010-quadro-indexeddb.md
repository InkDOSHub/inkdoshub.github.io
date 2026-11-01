# 010 · Whiteboard: drawing saved in IndexedDB (2026-10-30)

## Problem (found in part 7, log 008)
The Whiteboard saved the drawing in `localStorage`. That space holds about 5 MB, and the error was swallowed silently:
a drawing with images could stop being saved without any warning.

## Change
- `apps/quadro/src/main.jsx`: the drawing goes to IndexedDB (database `inkdoshub-quadro`, store `desenho`, key
  `atual`). This space is much larger and the browser reports when it runs out.
- Migration: on first open, an old drawing in `localStorage` is copied to IndexedDB and deleted from there.
- If saving fails, a red notice appears in the corner ("The drawing could not be saved in this
  browser."), translated in the 7 `idiomas/*.json`.
- Only the Whiteboard was rebuilt, with the same versions as `tools/build_apps.sh` (Excalidraw 0.18.1, React 18.3.1,
  esbuild 0.25), installed with `--ignore-scripts`. `index.html` and the CSP did not change (the inline script is the
  same, so the hash still holds).

## Test (Playwright)
- An old drawing in `localStorage` was migrated and `localStorage` was left empty.
- Drew a rectangle, reloaded, and the 2 elements came back from IndexedDB.
- No JS errors. The fonts Excalidraw tries to fetch from the esm.sh CDN are still blocked by the CSP, as expected
  (finding of log 008). The drawing uses the local fonts.
