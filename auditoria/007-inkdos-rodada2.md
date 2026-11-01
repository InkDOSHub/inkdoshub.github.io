# 007 · InkDOS, round 2 (2026-10-29)

Second half of part 6: the Documents, Spreadsheets and Presentations engines (and the EPUB reader), about
7 thousand dense lines. Focus on security (content comes from third-party files) and unused code.

**Read:** the CSP of the 6 apps, `documents/engine/docx-parser.js` (HTML assembly, links and styles), `epub/view/renderer.js` and
`epub/io/package-reader.js`, the `innerHTML`/`src`/`href` points of the three engines, the list of files loaded by each
`index.html` and `visualizadores/viewers/viewer-embed.js`.

## Changes made

1. **CSP of 5 apps:** removed `https://inkdos-tools.github.io` from `frame-src`. That site was deleted and the GitHub organization
   name became free: whoever registered it could publish pages the apps would accept in a frame. Nothing opens that address any more.
2. **`visualizadores/viewers/viewer-embed.js`:** the viewers accepted files from `https://vfydr2m9wk-ops.github.io`
   (the old InkDOS, deleted). Now they only accept the site itself, where the InkDOS apps live.

## Security checked (no change)

- **Strong CSP in the 6 apps:** scripts only from the site (and inline ones, by hash), `connect-src 'self'` (the app cannot send
  data out), images only local, `data:` or `blob:` (a document cannot load a remote image to track who
  opened it), `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. Even if some text from a file became HTML, no script would run.
- **DOCX:** all text goes through `esc()`; links only accept `http:`, `https:` and `mailto:` (`safeHref`); colors only accept 6 hex
  digits; font names lose quotes, `<>`, `;` and braces (`safeFont`). XML is read with `DOMParser` as XML, never as HTML.
- **EPUB:** the book is not inserted as HTML. The reader builds elements one by one (`createElement` + text), and images become `blob:`.
  The ZIP reader refuses empty paths, control characters or out-of-range entries.
- No `console.log`, `debugger`, `TODO`, `eval` or `new Function` in the engines' own code.
- Files that look orphaned (`xlsx-color-fidelity.js`, `ppt-p1-*-writer.js`, `ppt-p2-package.js`) are loaded on demand by other scripts and are still needed.

## Findings without change

- `runtime/frame/frame-menu.js`, `app-frame.css`, `tokens/base.css` and `content-viewport-adapter.js` exist in 4 to 5 apps, each
  in a different version. Unifying them would need testing each app by hand; the gain is small (about 140 lines).
- A very large ZIP (DOCX, XLSX, PPTX, EPUB) is opened fully in memory. The worst case is the tab closing; there is no risk to data.
- The repeated vendors (jszip, pako, pdf-lib) remain as in round 1.

## Commit

See `git log -- auditoria/007-inkdos-rodada2.md`.
