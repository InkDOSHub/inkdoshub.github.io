# 011 · Offline mode per app (2026-10-30)

Paulo's request: storing everything at once (about 700 MB) is scary and heavy. Now people pick app by app.

## Result
- **"Offline" in the ☰ menu** opens an in-page panel, no pop-up, with one item per app, its size and a green check.
  There are only two states. Tapping an unchecked item downloads that app and shows the percentage. Tapping a checked
  item shows, on the page, "Remove … from this device? (size)" with Cancel and Remove.
- **Base always stored:** the home screen and the light apps (under 1 MB each: Photos, Music, Recorder,
  Transfer, Webcam) come along with the first chosen app. 0.7 MB in total.
- **"Update"**, at the top of the panel, downloads only the changed files of the stored items. The home screen
  "Update available · Update" notice does the same.
- **Space:** the panel shows how much the browser uses and how much is still free (`navigator.storage.estimate`).
- **Offer after use:** `sw-portal.js` records the last page opened (`__uso__` in the cache). Back on the
  home screen, if that app is not stored, a card appears: "Keep … on this device? Takes X. Without
  storing it, it is downloaded again whenever the browser clears the cache, and does not open without internet." The options are
  "Not now", remembered for that app, and "Keep".
- Anyone who already had the full copy keeps every item checked, because the marker format is the same.

## Files
`inicio/offline.js` (rewritten, `?v=2`), `sw-portal.js` (records use), `assets/home.css` (`?v=19`), `index.html`
("i" text), 19 new texts in the 7 `idiomas/*.json`, `inicio/manifesto.json` (regenerated).

## Test (Playwright)
1. The panel lists the 7 heavy apps with their sizes.
2. Tapping Whiteboard shows the green check. With the network cut, the Whiteboard opened from the copy (HTTP 200, drawing on screen).
3. Tapping again asks for confirmation on the page. Confirming leaves the cache without the files and the check disappears.
4. "Update" ends with "Up to date".
5. After opening the Whiteboard without storing it, the home screen offered "Keep Whiteboard on this device?".
No JS errors.
