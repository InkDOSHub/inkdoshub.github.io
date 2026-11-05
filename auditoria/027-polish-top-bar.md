# 027 · Polish review: top bar look (2026-11-05)

## Review
Playwright, 820 px wide: the top bar of the 19 apps side by side. All follow the pattern
("‹ InkDOS Hub" left, symbol + name centre, ☰/i right). Apps with nothing to put in ☰ (Photos, Whiteboard,
Webcam, Code) show nothing on the right, which is expected.

## Fixed
The six InkDOS apps drew the back link differently: a "‹" text character (thinner, no space before the name),
semi-bold, about 8 px to the right of the other apps. `inkdos/shared/localization/localization.css` now draws
the same chevron as `assets/barra.css` (20 px, stroke 2), bold, at the same place.

Kept: the light grey InkDOS bar (Office look, 2026-10-31).
