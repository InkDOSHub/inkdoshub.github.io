# 020 · Repository in English and redundancy check (2026-11-01)

## Translation
- **Docs:** README, ASSINATURA, LICENCAS, tools/testes/inicio/webcam READMEs and audit logs 001–018 rewritten in English.
- **Code:** comments, docstrings, workflow step names and `UPSTREAM-SOURCE.txt` files of the Hub's own code (93 files).
  The Windows Transfer app UI (`windows/transferir/web/*.html`, `Program.cs` messages), which was Portuguese only, is now English.
- **Kept on purpose:** pt/en string pairs (Windows Hub dialogs, Webcam app `Tx(...)`, InkDOS "Edit with ArtCraft" notice),
  language names ("Português"), the synthetic Portuguese test content in `tools/gerar_arquivos_teste.py`, and Portuguese
  identifiers and folder names (`apps/foto/`, `pararLocal()` etc.). Renaming them would break bookmarks, offline copies and
  stored data keys for little gain.
- **Check:** `node --check` on every changed JS file, `py_compile` on Python, YAML parse on workflows, and Playwright over 19 pages:
  no JS errors (only the expected 404s of the Windows Transfer page, which is served by the `.exe`).

## Redundancy and dead code
- **Unused functions:** a scan of every named function in the Hub's own JS/HTML found none declared and never referenced.
- **Duplicated files** (same SHA-256), all inside `inkdos/`:

| Files | Extra size | Decision |
|---|---|---|
| `pdf-lib.min.js` ×2, `jszip.min.js` ×4, `pako_inflate.min.js` ×3, InkDOS Sans fonts ×2 | ~1 MB | Not merged: all of `inkdos/` is one offline group, so merging saves ~1 MB of a ~700 MB copy (0.15%) but touches loaders in 6 apps (dynamic `loadScript`, CSS `@font-face`, PDF export font loading). Risk higher than gain. |
| `file-launch.js` ×6 | 37 KB | Already unified in 006; each app keeps its own copy because the apps are self-contained. |
| `apps/webcam/lib/qrcode.js` = `windows/transferir/web/qrcode.js` | 55 KB | Needed: the second one is embedded in the Transfer `.exe`. |

- **Leftovers kept:** `sw-portal.js` `REPARO` (one-time offline repair, 2026-10-29) and the `inkterminal-*` key migration in `assets/tema.js`
  still help devices that have not opened the Hub since. They cost a few lines and can go after 2026-12.
