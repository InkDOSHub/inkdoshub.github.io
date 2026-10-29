# Changelog

Changes to InkDOS-tools, newest first.

## 2026-10-12 · Legacy tools removed

- Squoosh, ArchiveDrop, CyberChef and IT-Tools are no longer built or published. InkDOS stopped listing them
  (its legacy tools group, removed by the owner); unmaintained third-party code on this origin, which receives the
  documents InkDOS hands to ONLYOFFICE and BentoPDF, only widened what a flaw in one tool could reach. Their
  builders, skins and the theme bridge they alone used (viewers/tool-theme.js) are gone. Owner request.

## 2026-10-10 · Fast deploys for small changes

- A push that changes only files the build copies as they are (site-src/viewers, skins, diag) or documentation now
  updates the published site in place, in a minute or two, instead of rebuilding every tool (about ten minutes).
  Any other change, a manual run or a first push still builds everything. Owner request.

## 2026-10-10 · Plain scrollbar

- The Up / Down buttons and the "← InkDOS" button are gone from the toolkit pages InkDOS opens; they show a plain
  scrollbar at the side instead, always visible (XeOS desktop mode is used with a mouse). Owner request.

## 2026-10-10 · BentoPDF start page back to the original

- The one-line grouped tool list (viewers/bento-list.js) is no longer added: BentoPDF shows its original start page
  again, with the search bar and its own tool layout (owner). InkDOS opens it as a page of its own.

## 2026-10-10 · Up / Down side bar

- Toolkit pages opened from InkDOS (framed or as their own page) get a side bar with Up and Down buttons, so the
  page moves with a tap where swiping does not scroll it (XeOS on iPad). Owner request.

## 2026-10-10 · BentoPDF as a separate page (InkDOS in XeOS)

- Inside the XeOS web desktop a framed toolkit does not scroll, so InkDOS opens BentoPDF as a page of its own
  (?inkdos-handoff=<id>&inkdos-return=<InkDOS page>). bento-carry.js fetches the PDF through a hidden InkDOS page
  (handoff.html) and carries it like an embedded hand-over; a "← InkDOS" button leads back on every toolkit page
  of that visit, and bento-list.js keeps the InkDOS list layout. CSP frame-src allows the InkDOS origin.

## 2026-10-09 · BentoPDF list inside InkDOS

- "Edit with BentoPDF" in the InkDOS PDF workspace frames the toolkit (`?embed=1`). There the start page shows no
  "PDF Tools" title, description, search bar or Popular Tools. The tools stay grouped by function, each on one
  line with its symbol on the right, and opening one group closes the others (`site-src/viewers/bento-list.js`).
- Opened on its own, outside the InkDOS frame, the page is unchanged.
- Fix: the search bar was still shown (it sits outside the title block); now hidden too. The button in InkDOS is
  now called "Edit PDF" ("Editar PDF").

