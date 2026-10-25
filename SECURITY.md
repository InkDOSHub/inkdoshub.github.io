# Security

## Reporting a vulnerability

Report security problems privately through **Security → Report a vulnerability** (https://github.com/InkDOSHub/inkdoshub.github.io/security). Never open a public issue for them. This is a personal project: reports are read, but no response time is promised.

## Privacy

InkDOS Hub keeps your files in your own browser (IndexedDB/OPFS of this site) and sends nothing to a server. Do not attach real files, screenshots, recordings or private filenames to public issues or pull requests; reproduce problems with synthetic material.

## Origin isolation

The Hub is served from its own organization at `https://inkdoshub.github.io/`, a different origin from [InkDOS](https://github.com/vfydr2m9wk-ops/InkDOS) (`vfydr2m9wk-ops.github.io`). The two sites only link to each other; neither frames the other or exchanges messages. No other site may be published under the `InkDOSHub` account, because every GitHub Pages site of an account shares the same origin and could read the Hub's stored data.

## Third-party code

- Every tool is served by this site, from pinned versions rebuilt by `tools/build_apps.sh`; no page loads code from a CDN.
- Each vendored folder has `UPSTREAM-LICENSE.txt` and `UPSTREAM-SOURCE.txt`; the summary is in [LICENCAS.md](LICENCAS.md).
- Network use is limited to what a tool needs: the Linux terminal's internet (public [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) server `wisp.mercurywork.shop` and Cloudflare DNS-over-HTTPS), and the PeerJS public server used only to pair devices in Webcam (video flows directly between devices over WebRTC).

## Windows helpers

The optional `.exe` files in `windows/` are built by GitHub Actions from this repository's source. They are **not code-signed yet**, so Windows SmartScreen may warn. Download them only from this repository's releases.
