# 008 · Whiteboard (2026-10-29)

**Read:** `apps/quadro/src/main.jsx`, `index.html` and `freeform.css` (own code, 81 lines), `UPSTREAM-SOURCE.txt` and a search for
external addresses in the Excalidraw 0.18.1 bundle (`assets/`, third-party).

## Changes made

1. **Privacy: the Whiteboard contacted an outside CDN.** On open, Excalidraw requested fonts from `https://esm.sh/...` besides the
   local copies in `fonts/`. It sets the CDN as a fallback for each font, and Chromium tried to download from there. This contradicted the
   comment "Fonts served from here, never from a CDN" and `SECURITY.md`. Now `index.html` has a CSP like the InkDOS apps:
   scripts only from the site (the inline script by hash), `connect-src` and `font-src` only from the site, `data:` and `blob:`, `object-src 'none'`,
   `base-uri 'none'` and `form-action 'none'`. `frame-src https:` stays open because people can embed a video (YouTube etc.) in the board.
   **Test:** in a headless Chromium, the Whiteboard opened, the local font loaded (200), a drawn rectangle was saved and the CDN was blocked.

## Findings without change

- **Risk of losing drawings (recommended fix):** the drawing is saved in `localStorage`, including pasted images, as base64.
  `localStorage` holds about 5 MB; past that, saving fails silently (`catch {}`) and what is drawn afterwards is not saved,
  with no warning. Fixing it means switching to IndexedDB in `src/main.jsx` and **rebuilding the Whiteboard** (`tools/build_apps.sh`, which downloads
  Excalidraw and regenerates the 184 files in `assets/`). That is costly, so it was not done without Paulo's ok. (Done later, see 010.)
- The menu only uses standard Excalidraw items. The shareable link (which would send the drawing to Excalidraw's servers) and live collaboration
  do not appear, because the app does not pass the functions that enable them. Their addresses exist in the bundle but are unused.
- "Browse libraries" opens `libraries.excalidraw.com` only when the person taps it.

## Commit

See `git log -- auditoria/008-quadro.md`.
