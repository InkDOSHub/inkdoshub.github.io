# 002 · Light apps (2026-10-29)

**Read:** `apps/foto/` (app, editor), `apps/video/` (app, cortar, cortar-worker), `apps/musica/` (app, gravar),
`apps/gravador/`, `apps/transferir/app.js`, `apps/editar-pdf/`, `apps/codigo/` (index, inkfs extension).

## Changes made

1. **Bug fixed in Video and Music:** tapping the ✕ of a list item opened the item instead of removing it
   when the tap landed on the ✕ drawing (the test only checked the exact element). Now uses `closest(".x")`.
2. **Transfer, security:**
   - the confirmation of who wants to connect used `confirm()`, which XeOS blocks (the connection would always be refused
     or accepted without asking, depending on the browser). Now it is a box on the page with "Decline" and "Accept";
   - the pairing code moved from `Math.random()` to `crypto.getRandomValues()` (hard to predict).
3. **Photos:** the three `alert()` calls (blocked in XeOS) became on-screen messages.
4. **Recorder, dead code:** since 2026-10-28 recordings always go to Downloads, but the folder choice
   (File System Access, `inkdoshub-gravador` IndexedDB, chunked writing) was still in the code, disabled by
   `temPasta = false`. About 70 lines and the hidden button were removed. `"use strict"` was after a statement
   and had no effect; it was moved to the right place.
5. **Duplicate page removed:** `apps/musica/gravar/index.html` was an old copy of the Recorder with no links.
   The scripts the Recorder uses (`gravar.js`, `extrair-m4a.js`) moved to `apps/gravador/`.
6. **Repeated functions merged** in `assets/midia.js`: `inkBaixar` (download a file, copied in 6 places),
   `inkPartilhar` (share or download, in 3 places) and `inkPainel`/`inkFecharPainel` (progress panel, identical
   in Video and the video editor).
7. **Edit PDF:** the tools address was absolute (`/visualizadores/...`) and would break outside the domain root; now relative.
8. New "Accept" and "Decline" texts translated in the 7 languages. `?v=` versions updated in the changed pages.

## Findings without change

- The Video and Music lists are almost identical (drawing, remove, keep the last opened). They could be merged, but the gain is medium and so is the risk of touching the look.
- Edit PDF has the main tool names only in Portuguese and English, outside the language system.
- Transfer uses the public PeerJS server only for pairing; files go directly between devices. The code has about 30 bits and each new connection must be accepted on screen.
- Code editor (`inkfs`): writes to the browser IndexedDB, no network. No issues.
- No upload of files to outside services was found in any of these apps.

## Commit

See `git log -- auditoria/002-apps-leves.md`.
