# 019 · Symbol regression check (2026-11-01)

**Scope:** top bar of every app (back link, app icon and name, right-side buttons) and the home screen icons, in a 1024×700 window, plus a static check for missing local images/scripts in the Hub's own HTML/CSS/JS.

**Method:** local server (`python3 -m http.server 8765`) + Playwright screenshots of the top 56 px of each app (InkDOS apps opened with `?suite=1`, as the launcher does).

| Finding | Status |
|---|---|
| WordCraft, GridCraft and DeckCraft showed "InkDOS Hub" without the `‹` chevron: the pages did not load `assets/icones.js`, which draws `data-icone="voltar"` | Fixed (script added to the 3 pages) |
| InkDOS apps hide the back link when opened without `?suite=1` (direct URL). Inside the Hub it shows correctly | By design, no change |
| InkDOS apps draw the chevron as a text glyph (`‹`), other apps use the Lucide SVG; it looks slightly heavier | Noted, visual change needs approval |
| Home screen: all 16 app icons and the logo render; no missing image | OK |
| Missing local files: only `tools/inkdos-tools/site-src/*` (old build sources, not served) and `windows/transferir/web/pc.html` → `/qrcode.js` (served by the Windows app itself) | OK |
