# 025 · Polish review: offline worker and Recorder (2026-11-05)

## Request
Continue the polish pass (log 024): offline mode, updates, Recorder, Edit PDF, Webcam.

## Found and fixed
| Part | Problem | Change |
|---|---|---|
| `sw-portal.js` | The worker added the isolation headers (COOP/COEP `require-corp`) to the home screen too. With them, the icons of the person's own webapps (images from other sites) are blocked, so they fall back to the letter. The home screen needs no isolation. | The home screen is served without the isolation headers; the apps keep them. |
| `inicio/offline.js` | On the first visit the home screen reloaded itself once to become isolated. | Reload removed (no longer needed). |
| `apps/gravador/gravar.js` | On iPad and iPhone the auto-lock pauses the page, which stops a microphone recording. | Screen wake lock while recording, taken again when the page comes back; released on stop. |

## Checked, no change
- Webcam already keeps the screen on.
- Edit PDF is BentoPDF (left as is, see log 018/artcraft notes).

## Test
Playwright with the worker active: home `crossOriginIsolated = false`, Video app `true`, no page errors;
`node --check` on the Recorder script.
