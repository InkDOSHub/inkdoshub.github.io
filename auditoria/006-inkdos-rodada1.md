# 006 · InkDOS, round 1 (2026-10-29)

**Read:** `inkdos/shared/` (work-safety, ui-density), `runtime/platform/file-launch.js` of the 6 apps, `apps/pdf/ui/edit-pdf-button.js`,
`handoff.html` + `assets/handoff.js`, the structure of `apps/txt/`. The document, spreadsheet and presentation engines are left for round 2.

## Changes made

1. **`file-launch.js`: from 145 to 46 lines, identical in the 6 apps.** Removed the path to the old office editor of the old site
   (`inkdos-tools.github.io`, deleted), the full-screen layer only it used, the top "Edit with old office editor" button (disabled
   since 2026-10-28), the document preparation for it and the `handOff` used only by the Edit PDF button. What is used stays: opening
   files, the `launchQueue` queue, the home screen hand-off and the "Edit with old office editor" entry of the viewer notice, which uses the local editor.
2. **PDF:** `ui/edit-pdf-button.js` (118 lines) was loaded on every open, but the button was no longer installed (PDF tools live in the Edit PDF app). File and `<script>` removed.
3. **`inkdos/handoff.html` + `assets/handoff.js` removed:** only used by the path above. They also deleted
   documents older than 1 day from the shared `inkdos-tool-handoff` database, which the old office editor keeps for 7 days so it can reload.
4. **Same problem on the home screen (`inicio/lancador.js`):** when handing an Office file to the old office editor, it also deleted
   hand-offs older than 1 day. Now `gravar()` takes the expiry in days: 7 for the old office editor, 1 for the others.
5. **404 on every InkDOS app open:** `shared/ui-density.js` registered `inkdos/service-worker.js`, which was never
   copied (the offline copy is the Hub's). The registration was removed.
6. **Text (`apps/txt/`):** the served page (`index.html`) embeds all the code. The 23 loose copies (JS and CSS,
   about 160 KB) were loaded by nothing and had already drifted from the served version. Removed; `index.html` is now the source.
7. `inkdos/UPSTREAM-SOURCE.txt` records these changes. Comments in `gerenciador-app.js` and `inicio/README.md` point to the right reader.

**Test:** opened the 6 InkDOS apps, the home screen and the light apps in a headless Chromium: no JavaScript errors and no 404. PDF
opened `4-artigo.pdf` normally.

## Security checked (no change)

- `shared/work-safety.js` (recovery drafts): AES-GCM 256 with a non-exportable key generated in the browser, or, in
  password mode, PBKDF2-SHA-256 with 310 thousand rounds and a random salt; new IV on every write. Correct.
- Hand-offs between pages use the site's own IndexedDB, with a random id (`crypto.randomUUID`), and are deleted after being read.

## Findings without change

- `jszip.min.js` is copied in 4 apps, `pako_inflate.min.js` in 3 and `pdf-lib.min.js` (about 500 KB) in 2. Merging them into
  `inkdos/shared/vendor/` would make the offline copy about 1 MB smaller, but touches the 6 apps. Left as a suggestion.
- `apps/*/ui/zoom-menu.css` is identical in 4 apps (small).
- The InkDOS apps have their own language system (`shared/localization/`), separate from the Hub's.

## Commit

See `git log -- auditoria/006-inkdos-rodada1.md`.
