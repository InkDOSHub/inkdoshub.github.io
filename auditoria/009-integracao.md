# 009 · Part 8: bridge to external apps (2026-10-29)

Scope: the Hub code that connects third-party apps to the rest of the site. The code of the projects themselves
(v86/Linux, VS Code web, old office editor, BentoPDF, PDF.js, pnk, WebODF) was not reviewed line by line.

## Read
- Linux: `terminal/app.js` (whole), `terminal/swap-worker.js`.
- Code: `apps/codigo/index.html`, `editor.html`, `ext/inkfs/extension.js`.
- Old office editor: its folder, `inkdos-handoff.js`, `editor-inkdos.js`, `sw.js`, `shared/work-safety.js`.
- PDF and viewers: `visualizadores/viewers/` (bento-carry, download-fallback, file-handoff, pnk-embed, viewer-embed, viewer-theme).

## Found and fixed
1. **Linux accepted any network server from the link.** `terminal/?rede=wss://other-server/` sent all
   Linux traffic to the address in the link. Now only the names `wisp`, `relay` and `off` are valid; anything else falls back to `wisp`.
   The "custom network" button text was removed. `app.js?v=12`.
2. **Old origin in the old office editor CSP.** 23 pages still
   allowed frames from `https://vfydr2m9wk-ops.github.io`, a repository about to be deleted. Removed.

## Checked, no change
- File hand-offs through IndexedDB (Code, old office editor, viewers): deleted on read and have an expiry.
- `bento-carry.js` only accepts messages from its own origin and from the frame that opened it. The `innerHTML` uses are fixed texts.
- The old office editor's `work-safety.js` differs from InkDOS only in dark theme detection (normal).
- The Linux session uses the 9p folder and the package filter already fixed in part 5 (`005-tools.md`).

## Third-party servers (for transparency)
Test: Playwright opening each page for 8 s and listing the servers contacted.

| App | External server | Purpose |
|---|---|---|
| Linux | `wisp.mercurywork.shop` (default) or `relay.widgetry.org` | Linux internet. It is a public third-party server: Linux traffic goes through it. Can be turned off with "Network: none". |
| Code | `*.vscode-cdn.net` (Microsoft) | Panel frames (webviews), standard in VS Code web. Only downloads fixed pages; files are not sent. |
| Code | `open-vsx.org` (only when searching extensions) | Extension catalog. Installed extensions run in the browser with access to the editor files. |
| Old office editor, Edit PDF, viewers | none | — |

Possible improvement (not done): serve the VS Code frames from the site itself. It would remove Microsoft from the list, but
loses the subdomain isolation VS Code uses for panels; so it stays as is.

## Test
`node --check terminal/app.js`; Playwright on `terminal/?rede=wss://evil.example/` (connected to wisp and the button
shows "Network: wisp"), `apps/codigo/`, the old editor folder, `apps/editar-pdf/` and the
`visualizadores/` pages: no JS errors.
