# InkDOS advanced tools

Open-source tools for [InkDOS](https://github.com/vfydr2m9wk-ops/InkDOS), served at
<https://inkdos-tools.github.io/InkDOS-tools/> and opened from InkDOS's **Advanced tools** menu.
The site is deliberately a separate origin from InkDOS (`vfydr2m9wk-ops.github.io`), so the tools'
third-party code cannot reach InkDOS's storage or pages.

Every tool is an existing open-source project that runs entirely in the browser: files are processed
on the device and never uploaded. Nothing here is written from scratch. `build.py` fetches each project
at the commit pinned in `tools.json`, builds it with its own tooling and places it under `/<id>/`
together with its licence (`UPSTREAM-LICENSE.txt`) and source reference (`UPSTREAM-SOURCE.txt`).

| Tool | Upstream | Licence |
|---|---|---|
| Apple Pages, Numbers and Keynote viewer | [pnk](https://github.com/peterheb/pnk) | MIT or Apache-2.0 |
| PDF toolkit, Office/LibreOffice to PDF | [BentoPDF](https://github.com/alam00000/bentopdf) | AGPL-3.0 |
| Python terminal (numpy, pandas, matplotlib…) | [Pyodide](https://github.com/pyodide/pyodide) console | MPL-2.0 |
| OpenDocument viewer (.odt/.ods/.odp) | [WebODF](https://github.com/kogmbh/WebODF) | AGPL-3.0 |
| Word document viewer (.docx, layout of the file) | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) with [JSZip](https://github.com/Stuk/jszip) | Apache-2.0 / MIT |
| PowerPoint viewer (.pptx, layout of the file) | [pptx-renderer](https://github.com/aiden0z/pptx-renderer) | Apache-2.0 |

Changes to upstream are limited to what `build.py` states next to each builder: pnk's optional
Google Fonts substitutes are off by default (the setting stays in the viewer), so no tool makes a
network request unless the user turns one on.

- **BentoPDF** is built as the project's self-hosted ("simple mode") build with every runtime asset
  (PyMuPDF, Ghostscript and CoherentPDF WASM, Tesseract OCR with English and Portuguese, fonts) served
  from this site, following the project's own air-gap recipe. GitHub Pages cannot send the COOP/COEP
  headers that LibreOffice WASM (Office/ODF to PDF) needs, so a short prelude in BentoPDF's own service
  worker adds them to worker scripts and to the pages whose tool loads LibreOffice (found at build time);
  such a page reloads once the first time to become cross-origin isolated. The start page does not reload when its service worker takes
  control (that reload cancelled a tool being opened). Every other tool page stays a
  plain page (on iOS Safari, isolated tool pages opened from the start page went straight back to it).
  Opened from InkDOS, a tool page gets the PDF (`site-src/viewers/bento-carry.js`) and shows a plain scrollbar.
  While a tool works, the loader shows a percentage, the current step and the elapsed time, and a failure says so.
  On WebKit (iPhone, iPad, Safari, XeOS), where iOS closes a page that uses too much memory, the tools draw smaller
  JPEG thumbnails, compress long documents more lightly, and a PDF likely
  to need more than about 800 MB asks first (Try anyway / Cancel); Chromium keeps the tools as they are. Everywhere,
  PyMuPDF loads its heavy add-ons (OpenCV, numpy, Word converters) only when a tool needs them.
- **Viewers for InkDOS workspaces**: `odf/` (WebODF's `OdfCanvas` with a small page in `site-src/odf/`)
  and `pnk/` accept a file handed over by an InkDOS workspace (`?embed=1`, same origin, protocol in
  `site-src/viewers/viewer-embed.js`) and follow the InkDOS light/dark appearance. WebODF is built
  with its own cmake build; its 2016 scripts run on Node 6 from the npm registry.
- **Pyodide**'s console loads jQuery, jQuery Terminal and idb-keyval from CDNs; they are served from
  `python/vendor/` instead, each with its licence. numpy, pandas, matplotlib, scipy, statsmodels, sympy,
  networkx, pillow, openpyxl, python-docx and a few more (`PYTHON_PACKAGES`, `PYPI_WHEELS` in `build.py`,
  each checked by sha256) are served from `python/` and load on import, offline. An InkDOS bar opens files
  from the device into Python and saves files back. `python/online.html` is the same terminal allowed to
  reach PyPI, so `micropip.install()` works there (the user is asked first); see `SECURITY.md`.
  A service worker (`site-src/python/sw.js`) stores the terminal and every bundled package on the device the
  first time the terminal opens, so it starts and imports with no network afterwards.
- **Faithful views for InkDOS Documents and Presentations**: `docx/` (docx-preview) and `pptx/`
  (pptx-renderer's standalone browser build, without PDF.js) show a file with its own page or slide layout,
  read only, standalone or embedded by an InkDOS workspace with the same viewer protocol as `odf/` and `pnk/`.

## Build

```
python build.py --out _site              # all tools
python build.py --out _site --only pnk
```

Requirements: git, Python 3.11+, Node.js 24 with npm (pnk needs Rust with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.127).
The site is built by `.github/workflows/pages.yml` and published to the `gh-pages` branch (Settings → Pages → Source: **Deploy from a branch**, `gh-pages`, `/`).

## Licences

The glue code in this repository (build script, landing page, workflow) is MIT. Each tool keeps its
upstream licence; tools under copyleft licences (for example GPL or AGPL) are distributed as separate
programs with their licence and a link to their source.
