# InkDOS Hub code audit

Review of the Hub's own code, in parts (third-party code in `visualizadores/`, the old editor folder and
`apps/codigo/vscode/` is out of scope). Each part has a numbered log with what was read, what was
found, what changed and the commit. The git history proves each change.

| Part | Scope | Log |
|---|---|---|
| 1 | Base: home screen, sw-portal.js, inicio/, assets/, terminal/, actions | [001-base.md](001-base.md) |
| 2 | Light apps (photos, video, music, recorder, web transfer, edit PDF, code) | [002-apps-leves.md](002-apps-leves.md) |
| 3 | Webcam (web + Windows) | [003-webcam.md](003-webcam.md) |
| 4 | Transfer for Windows | [004-transferir-windows.md](004-transferir-windows.md) |
| 5 | tools/ and actions | [005-tools.md](005-tools.md) |
| 6 | InkDOS (2 rounds) | [006-inkdos-rodada1.md](006-inkdos-rodada1.md), [007-inkdos-rodada2.md](007-inkdos-rodada2.md) |
| 7 | Whiteboard | [008-quadro.md](008-quadro.md) |
| 8 | Bridge to external apps (Linux, Code, old office editor, PDF) | [009-integracao.md](009-integracao.md) |
| — | Whiteboard: drawing saved in IndexedDB | [010-quadro-indexeddb.md](010-quadro-indexeddb.md) |
| — | Offline mode per app | [011-offline-por-app.md](011-offline-por-app.md) |
| — | Presentations: full screen identical to editing | [013-apresentacao-tela-cheia.md](013-apresentacao-tela-cheia.md) |
| — | Review after the 2026-10-30 changes | [014-revisao-final.md](014-revisao-final.md) |
| — | Native InkDOS Hub for Windows 0.1 | [015-windows-nativo.md](015-windows-nativo.md) |
| — | Windows 0.2 with the Hub look and the green check | [016-windows-visual-do-hub.md](016-windows-visual-do-hub.md) |
| — | Windows without Edge: native apps and Webcam without WebView2 | [017-windows-sem-edge.md](017-windows-sem-edge.md) |
| — | Windows on Electron: the same apps as the web, stored on disk, no telemetry | [018-windows-electron.md](018-windows-electron.md) |
| — | Symbol regression check | [019-symbol-regression.md](019-symbol-regression.md) |
| — | Repository in English and redundancy check | [020-english-and-redundancy.md](020-english-and-redundancy.md) |
| — | Integrity: SHA-256 checks and CSP on every page | [021-integrity.md](021-integrity.md) |
| — | App isolation (sandbox per app) | [022-app-isolation.md](022-app-isolation.md) |
| — | InkDOS toolbars use the ArtCraft icons | [023-artcraft-icons.md](023-artcraft-icons.md) |
| — | Polish review: language packs | [024-polish-translations.md](024-polish-translations.md) |

## Summary (2026-10-29)

All parts were reviewed. Main security fixes: Transfer confirmation without pop-ups and with an unpredictable code,
full escaping in Transfer for Windows, a timeout for stalled HTTP connections, filtering of webapps coming from another tab, package filtering
in the Linux session, removal of deleted origins (`inkdos-tools.github.io`, old InkDOS) from the CSP and the viewers, and a new CSP in the
Whiteboard (which blocks the font CDN). About 2 thousand lines of dead or duplicated code were also removed, and visible bugs were fixed
(the ✕ in the lists, the 404 in every InkDOS app, documents of the old office editor deleted too early).

Suggested follow-ups (more costly, awaiting decision): save the Whiteboard in IndexedDB (done in 010), complete the
translations (243 texts per language), lockfile and `npm ci --ignore-scripts` in `build_apps.sh`, merge the duplicated InkDOS vendors
(about 1 MB less in the offline copy), rebuild Linux so the `inksessao` filter takes effect, and sign the `.exe` files.
