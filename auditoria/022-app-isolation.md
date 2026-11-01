# 022 · App isolation: how far each app is its own sandbox (2026-11-01)

## What isolates the apps today

| Layer | Web / Home Screen / XeOS | Windows app |
|---|---|---|
| Process | Each app opens in its own tab (`assets/gerenciador-app.js`); the browser gives each tab its own renderer and memory. | Each app opens in its own window and process (`windows/hub/main.js`). |
| Code | Each app loads only its own folder plus the shared `assets/`. Nothing is fetched from CDNs. | Same files, checked by SHA-256 before they run. |
| Network | **CSP per page** (log 021): an app can only talk to this site, plus the one server it needs (PeerJS for Webcam/Transfer, Wisp/relay for Linux). A compromised app cannot send your files elsewhere. | Same, plus a global allow-list: only the site and `0.peerjs.com`; everything else is blocked in `main.js`. |
| Third-party editors | **New:** the ArtCraft editors (WordCraft, GridCraft, DeckCraft) run in an iframe that now has its own CSP (`tools/artcraft_csp.py`, applied by `artcraft.yml` after each update): no network outside the site, no frames, no plugins. The InkDOS apps, Whiteboard and the viewers already had one. | Same. |
| Node / system access | None (browser). | Pages run with `contextIsolation`, `sandbox` and no `nodeIntegration`; the only bridge is `preload.js` (`window.inkHubNativo`, a few fixed calls). |
| Storage names | Each app uses its own keys and databases (`inkdoshub-musica-*`, `inkdoshub-video-*`, `inkdoshub-quadro`, `inkdoshub-codigo`, `inkdos2:*` …). Hand-offs between apps go through `inkdos-tool-handoff` / `inkdoshub-entrada` and are deleted after reading. | Same. |

**Test:** Playwright with the new ArtCraft CSP: the three editors start their WebAssembly (`window.wasmBindings`) with no CSP violations.

## The limit: one origin
All apps live on the same origin (`https://inkdoshub.github.io`). Browsers isolate storage **by origin**, so any page of the site can,
in principle, read another app's `localStorage` and IndexedDB. Full per-app sandboxes would need one origin per app, for example:

| Option | Cost | Effect |
|---|---|---|
| One subdomain per app on a custom domain (`photos.inkdos…`) | Domain + DNS + a Pages site per app; breaks existing offline copies and stored data | Real storage isolation |
| `sandbox` iframes without `allow-same-origin` | Apps lose IndexedDB/localStorage (they keep files there), so most would stop working | Strong, but breaks the apps |
| Keep one origin + CSP + no third-party code outside iframes (current) | Done | Protects against data leaving the device; not against a malicious app already in this repository |

Recommendation: keep the current model. Every app's code is in this public repository and reviewed (logs 001–022); the CSP already
blocks the realistic attack (sending data out). Revisit only if apps from outside authors are ever added.

## Not done
- `apps/codigo/editor.html` (VS Code web) has no CSP: it needs `*.vscode-cdn.net` frames and `open-vsx.org`, and VS Code's own
  workbench relies on features a strict CSP would block. Testing that is costly; it stays as documented in log 009.
- BentoPDF (`visualizadores/bentopdf/`) is left untouched on purpose; its pages already ship their own CSP.
