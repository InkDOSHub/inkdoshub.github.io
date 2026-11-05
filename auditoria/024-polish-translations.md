# 024 · Polish review: language packs (2026-11-05)

## Request
Lean polish pass on what already exists (no new features): loading, errors on iPad/iPhone/XeOS, uniform look,
translations, offline. Fix the highest-impact problems automatically.

## Review
Playwright opened the home screen and the 19 apps as iPad mini and iPhone SE, in English and Portuguese:
no page errors, no missing files, no sideways scroll. Only noise: the Whiteboard lists a CDN copy of its fonts
after the local one, which the CSP blocks (the local fonts load; nothing to fix).

## Problem found
In every `idiomas/*.json` pack, part of the texts sat at the top level instead of inside `"textos"`, so
`assets/idioma.js` never used them (54 in each pack, 187 in Portuguese). Portuguese pages showed the home cards,
Recorder, Music, Photos, Video, Webcam and Transfer partly in English.

## What changed
| Part | Change |
|---|---|
| `idiomas/*.json` | Loose texts moved into `"textos"` (on a clash the value already in `"textos"` was kept). Files written in the format of `tools/idiomas_textos.py`. |
| `idiomas/pt-BR.json` | The 48 texts still missing were added (Recorder, Webcam, ArtCraft notes…). Portuguese is now complete (0 missing). |
| `tools/idiomas_textos.py` | Skips `apps/xeos-tests/` (internal test ids, not interface text). |

Open: es, de, fr, zh-CN, ja and ru still miss 240 texts each (`python3 tools/idiomas_textos.py` lists them).
