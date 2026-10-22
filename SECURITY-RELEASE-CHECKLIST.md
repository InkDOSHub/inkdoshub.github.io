# Security release gate — InkTerminal

Before promoting an experimental app to the public `main` branch:

- [ ] Review every changed file and remove debug endpoints, test credentials, tokens, and personal data.
- [ ] Treat imported HTML, Markdown, SVG, office documents, filenames, and URLs as untrusted input. Avoid inserting untrusted strings with `innerHTML`; prefer `textContent` or safe DOM construction.
- [ ] Keep camera/microphone access behind explicit user action; stop media tracks and close peer connections when the user stops or leaves.
- [ ] Validate URL schemes and external navigation. Do not allow untrusted content to execute in the app's origin; sandbox embedded documents where possible.
- [ ] Check storage, exports, and error messages for unintended disclosure of user content.
- [ ] Test permission denial, malformed files, offline/reconnect, repeated start/stop, and mobile Safari/XeOS behavior.
- [ ] Run syntax/build checks and test the deployed site in a private window after deployment.
- [ ] Keep GitHub Actions permissions minimal. Pin third-party actions to full commit SHAs and avoid exposing write-capable credentials to untrusted code.
- [ ] Confirm rollback instructions and identify the last known-good commit.

Passing this checklist is a release process, not a guarantee that an app is vulnerability-free. Apps handling untrusted documents, remote browsing, camera/microphone, or recording need a focused code review before release.
