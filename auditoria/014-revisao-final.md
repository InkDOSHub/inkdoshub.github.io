# 014 · Review after the 2026-10-30 changes

Reviewed the code changed today (logs 010, 011 and 013) and the cheap audit follow-ups before starting the
Windows app, as Paulo asked.

## Checked, no change
- `inicio/offline.js` and `sw-portal.js`:
  - Downloads only come from the same origin (`?inkoff=`).
  - Nothing is sent out.
  - The `__uso__` record stays only in this browser's cache and is deleted when the home screen reads it.
  - Cache cleanup keeps the marker and `__uso__`.
- `apps/quadro`: fonts come from the local folder (`fonts/`, status "loaded"). Excalidraw's extra attempt on the esm.sh
  CDN is the library's own fallback list and stays blocked by the CSP, with no effect on the drawing.
- Presentations: the old renderer in `slideshow-controller.js` stays only for printing and as a fallback. It is not
  dead code, but it is one less path to maintain in full screen.

## Fixed
- `tools/build_apps.sh`: the main `npm i` now uses `--ignore-scripts`. Before, only ffmpeg did. Outside packages
  do not run scripts during the build, and the Whiteboard was built that way today (log 010) without issues.
- `idiomas/*.json`: removed the old Offline "i" text ("Saves the whole InkDOS Hub…"), no longer used.

## Still pending (more costly; awaiting decision)
- Missing translations (`tools/idiomas_textos.py` lists them).
- Merge the repeated jszip, pako and pdf-lib in InkDOS (about 1 MB).
- Rebuild the Linux image so the `inksessao` filter takes effect (log 005).
