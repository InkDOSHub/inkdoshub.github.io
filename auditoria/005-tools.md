# 005 · tools/ and actions (2026-10-29)

**Read:** `tools/portal_manifesto.py` (runs in the action with write permission), `tools/idiomas_textos.py`,
`tools/build_apps.sh`, `tools/linux/` (kernel build, `init`, `inksessao`), `tools/README.md`, the 3 actions.
`tools/inkdos-tools/` is the old viewers recipe (repository deleted on 2026-10-29) and was only skimmed.

## Changes made

1. **References to things that no longer exist:** `idiomas_textos.py` looked at deleted folders (`apps/wine/`, `apps/foto/app/`,
   `coi-serviceworker`, `idiomas-extra`); `portal_manifesto.py` had an empty `FORA_PASTAS` with an old comment; the manifest
   action and both Windows actions had a condition for the `vfydr2m9wk-ops/*` mirror, which was archived; texts mentioned the
   "Download all" button, now called "Offline"; `gerenciador-app.js` and `inicio/README.md` pointed to
   `tools/adaptar_inkdos.py`, which does not exist (the right one is `inkdos/assets/handoff.js`).
2. **`inksessao` (Linux), security:** when restoring a session, package names from the file went straight to
   `apk add`. A name starting with `-` would become an apk option (e.g. `--allow-untrusted`). Now only valid names pass.
   The session file belongs to the person, encrypted with their password, and runs in a virtual machine in the browser, so the risk was
   low. **Only takes effect after rebuilding Linux** (`tools/linux/build.sh`), because the script ships inside the image.
3. **`tools/README.md`:** now says `visualizadores/` is the source. The recipe in `tools/inkdos-tools/` no longer produces the
   same files (`bento-carry.js` and `docx/viewer.js` were changed directly in the site).
4. `tools/idiomas-textos.json` regenerated (paths follow the Recorder move from part 2).

## Findings without change

- **Incomplete translations:** of 508 texts, 243 are missing in each language (146 in Portuguese), and 123 to 139 keys are left over (texts that no longer exist). Completing them is costly (7 languages) and waits for Paulo's call.
- `build_apps.sh` pins the main versions but has no lockfile (transitive dependencies can change) and
  `npm i` runs install scripts. For a reproducible build: keep `package-lock.json` and use `npm ci --ignore-scripts`.
  Not changed because the build cannot be tested here cheaply.
- `linux/build.sh` checks Alpine against the official SHA-512 and downloads the kernel by tag. OK.
- Actions use `@v4`/`@v2` (tags), not a pinned hash. Publishing to releases only happens on `main`.
- `tools/inkdos-tools/.github/workflows/` does not run (only the root `.github` folder counts).

## Builds checked

The part 3 and 4 actions ran after the push: `transferir-windows` passed. `webcam-windows` was running when this part started.

## Commit

See `git log -- auditoria/005-tools.md`.
