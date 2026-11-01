# 013 · Presentations: full screen identical to editing (2026-10-30)

Paulo's request: presentation mode must show exactly what appears while editing. In his example (a .ppt,
slide 5), in full screen the title moved up, the texts Pensamento, Emoção and Cpto merged into one line, the arrows
lost their heads and there were two X buttons.

## Cause
`presentation/slideshow-controller.js` had a **second slide renderer**, simpler than the editing one
(`view/slide-surface.js`). It did not draw arrows or vector shapes, ignored the slide model objects,
indents and tabs, and did not apply the .ppt text fitting (`fitLegacyText`). Every fix
made in editing was left out of the presentation.

## Fix
- `app.js`: the presentation asks the editing renderer for the slide (`renderForShow`), applies the same .ppt
  text fitting, copies the result (without selection handles or text editing) and returns the editor to the slide it
  was on. The copy is then only scaled, keeping the file's aspect ratio (4:3, 16:9 etc.).
- `slideshow-controller.js`: uses that copy. The old renderer remains only as a fallback and for printing.
- Duplicate X: on iPad, Safari shows its own X in full screen, so the app's X hides in that case.
- The yellow .ppt bar got a ✕ to close it (commit b7cc1c8).
- Versions: `app.js?v=21`, `slideshow-controller.js?v=8`.

## Test
Created a 4:3 .pptx with a title, three text boxes and arrows and opened it in Playwright. The editing and
full-screen captures matched in positions, fonts and arrows, with black bars on the sides. No JS errors.
