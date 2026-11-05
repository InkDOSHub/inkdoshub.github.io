# 026 · Polish review: loading size and update notice (2026-11-05)

## Loading (measured, no change)
Playwright, bytes each page downloads when it opens (no cache):

| Page | MB |
|---|---|
| Home screen | 0.2 |
| Photos, Music, Video, Recorder, Webcam, Transfer, ArtCraft apps | 0.1–0.2 |
| Edit PDF | 0.5 |
| InkDOS Documents / PDF / Spreadsheets | 0.7–0.9 |
| Whiteboard | 1.5 |
| Linux terminal | 8.5 (system image 5.6 + v86 2.0) |
| Code | 15.3 (VS Code workbench 11.9) |

Only Code and the terminal are heavy, and that is the size of the tools themselves. Nothing to trim.

## Update notice (fixed)
`inicio/offline.js` showed "Update available" whenever the site version changed, that is, after any commit,
even when only apps the person does not keep offline changed. The update then had nothing to download.
Now the notice appears only if a file of a stored group (or of the home screen and light apps) changed,
was added or was removed.
