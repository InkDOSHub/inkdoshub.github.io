# Home screen (index.html and inicio/)

The InkDOS Hub home screen is the only entry point. Each card opens the tool, or an InkDOS app
(copy in `inkdos/`, see `inkdos/UPSTREAM-SOURCE.txt`), in its own page (tab or window).
Nothing loads before it is requested.

The old desktop (`desktop/`) was merged here on 2026-10-17: `desktop/` only redirects
to the root.

## Open pages

- Tapping a card opens the app in a new page named `inkdoshub-<app>`. Tapping again returns to
  that page instead of opening another (`window.open("", name)`). If the browser blocks the new page,
  the app opens in the same one.
- The "InkDOS Hub" button in the app bar and the Home button of the InkDOS apps go to the home screen page
  (`inkdoshub-inicio`) without closing the app.

## File launcher (`lancador.js`, `../manifest.webmanifest`)

Like the original InkDOS home screen: with InkDOS Hub installed, the manifest registers the home
screen for the apps' file types (`file_handlers`, action `./`). Opening a file in XeOS sends
it there (`launchQueue`), and it picks the app by extension:

| App | Extensions |
|---|---|
| Documents | docx, rtf, doc, odt, pages |
| Spreadsheets | xlsx, xls, csv, tsv, ods, numbers |
| Presentations | pptx, ppt, odp, key |
| PDF | pdf |
| EPUB reader | epub |
| Plain text | txt, md, log, ini, json, xml, yaml and similar |
| Photos | jpg, png, gif, webp, heic, avif, svg and other images |
| Video | mp4, mov, m4v, webm, mkv |
| Music | mp3, m4a, aac, wav, ogg, flac, opus |
| Code | js, ts, py, html, css, c, cpp, java, rs, go, sh, sql and other languages |

One file (or several for the same media app or Code) opens the app in this same page. Files
for different apps appear in "Received files", with one button per app. The extension list is in
`ROTAS` (lancador.js); the manifest must have the same ones.

## Tabs and memory (`../assets/gerenciador-app.js`)

Each tool opens in its own tab, only when requested. Tapping the card of an app that is already
open returns to its tab (window name `inkdoshub-<app>`). Tabs do not coordinate: each
app manages its own memory (the terminal, for example, has its own memory button).

The site sets no memory limit: the system (iOS, XeOS, browser) decides which tabs to close.
The weights in the `APPS` list are only informative estimates.

## Offline copy (`offline.js`, `../sw-portal.js`, `manifesto.json`)

- **Offline** in the ☰ menu shows a green check per app and downloads the chosen apps (the base always comes along) to the site cache. Updates download only new or changed files.
- The `sw-portal.js` service worker (scope `/`, registered by the home screen) serves the stored copy and only replaces a file when its hash in the manifest changes, so a new version of the site never mixes with old files.
- The video editor has its own service worker (`coi-serviceworker`), which wins over the portal's in that folder.
- `manifesto.json` is the file list with size and SHA-256. It is rebuilt by `python3 tools/portal_manifesto.py`, and the `.github/workflows/manifesto-offline.yml` workflow does it on every push to `main`.

## Session file (`../assets/sessao.js`)

The Linux **Session** button saves the work in an `.inksessao` file on the device (Files,
iCloud Drive), to recover it even if the site data is erased. Always password-protected: AES-GCM with a
PBKDF2-SHA256 key (310 thousand rounds); without the password the file does not open. Delivery uses the iOS share
sheet ("Save to Files") or a download.

- **Linux** (`../terminal/app.js`): saves the recipe, not the memory. The Linux `inksessao`
  (`../tools/linux/alpine-overlay/usr/local/sbin/inksessao`, started by `init`) builds a .tar.gz with
  `etc/apk/world`, the repositories, `/root` (without `~/files` and `~/.cache`), `/home` and `/usr/local`. To open it,
  it installs the missing packages from the internet (`apk add`) and puts the files back. The exchange goes through the
  `/mnt/ipad/.inkdoshub` folder (`pedido`, `estado`). On a Linux restored from an old Save, without
  `inksessao`, the page sends the program through the folder and types the command that starts it (asking first).

## ArtCraft editors (`../artcraft/`, `../apps/*craft/`)

WordCraft, GridCraft and DeckCraft (ArtCraft, MIT/Apache-2.0) come prebuilt from the web releases via
the `.github/workflows/artcraft.yml` action (every Monday and manually). "Edit with ArtCraft" in the InkDOS
apps and the "ArtCraft" preference in the ☰ menu store the document in the `inkdos-tool-handoff` IndexedDB
and open `apps/<editor>/?inkdos-handoff=<id>`; `assets/artcraft-host.js` hands
the file to the editor (postMessage bridge `?host=parent` in WordCraft and GridCraft; simulated
drag-and-drop in DeckCraft). Save downloads the file.

## "Open file" button (`lancador.js`)

- **Open file** (top of the home screen): opens the system picker (on iPhone, the Files app), any
  type, and sends the file to the right app using the same table above. No size limit.
