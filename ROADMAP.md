# inkdoshub.github.io roadmap

The InkDOS Hub: home screen of browser apps for iPad, iPhone and PC, served by a Cloudflare Worker.

Written on 2026-11-20 during the InkOS autopilot run. Ordered by priority; nothing here is started unless marked.

## Now

- Adopt the InkOS postMessage protocol v1 (`docs/PROTOCOL.md`): theme via `ink-tema`, files via `inkos-vfs-file` (`inkos:file` event from the Hub's `assets/tema.js`).
- Validate parent origin against the InkOS allowlist before acting on any message.
- Protocol v1 in `assets/tema.js` (this PR).
- Hub/Desktop toggle will later replace the separate InkOS entry (ADR in InkOS); the `/InkOS/` prototype stays for now.
- Theme gaps found by the InkOS apps matrix: InkDOS suite apps (`inkdos/apps/*`) do not follow `ink-tema`.

## Next

- Test on iPhone 17 Pro Max and iPad 11" (A16), iOS 27 Safari, and record results.
- Keep third-party components listed in `THIRD_PARTY_LICENSES.md` up to date.

## Not planned in this round

- Large new features. This file only records direction; see the README for the current state.
