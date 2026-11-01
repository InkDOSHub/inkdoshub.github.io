# 015 · Native InkDOS Hub for Windows, version 0.1 (2026-10-30)

> Superseded by log 018 (Electron, the same apps as the web). Kept as history.

Paulo's request: an InkDOS Hub for Windows that uses less CPU and memory than the site in the browser, without the Edge
web engine, with Linux and a code editor integrated with Windows, updates of only what changed, and downloads
checked and explained. Done after today's fixes (logs 010, 011 and 013) and the review (014).

## Technical decision
A light HTML engine (Sciter, Ultralight, litehtml) cannot run the old office editor, VS Code web, BentoPDF or v86 Linux,
which are heavy web apps. Rebuilding a full engine would be no lighter than Edge. The real gain comes from
replacing each web app with the native program:

| On the site (browser) | On Windows (native) | Expected gain |
|---|---|---|
| Emulated Linux (v86 in WebAssembly) | Alpine on WSL2 (Windows virtualization) | Very large: near-native CPU instead of emulated |
| VS Code web | VS Code (default) or Zed (light) | VS Code: small (also Chromium). Zed: large, native Rust |
| Old office editor, web | Office editor, desktop | Moderate |
| BentoPDF (WebAssembly) | qpdf and Ghostscript | Large: native command-line programs |
| ffmpeg.wasm | native ffmpeg | Large: several times faster |
| Home screen in the browser (Edge tab, 150 to 300 MB) | WinForms launcher (108 KB, about 20 to 30 MB RAM, zero CPU idle) | Large |

The launcher RAM numbers are estimates for WinForms on .NET Framework, not yet measured on a PC. The
real measurement (Task Manager, with the Hub idle and with each tool open) is the next step on Paulo's PC.

## What was done
- `windows/hub/` (C#, .NET Framework 4.8, built into Windows 10 and 11, no admin): `Program.cs` (window),
  `Ferramentas.cs` (catalog, download, verification, install), `Textos.cs` (Portuguese and English).
  - **Hub look:** bar with "InkDOS Hub" and ☰, tool tiles, light or dark theme matching
    Windows. Nothing opens a dialog box: cards appear inside the window.
  - **Before downloading**, the card shows where it comes from, the publisher, license, version, download size,
    disk space (approximate), free space on the PC, what the tool accesses, how it is verified and the
    SHA-256.
  - **Verification:** the file SHA-256 must match the catalog. When the vendor signs (Microsoft,
    Zed Industries, Ascensio, Artifex/Ghostscript), Windows checks the signature (`WinVerifyTrust`)
    and the signer name must be the expected one. If it fails, nothing is installed and the reason is shown.
  - **Linux:** enables WSL (asks for admin once), imports the official Alpine (minirootfs, 3.7 MB) as
    `InkDOSHub-Alpine`, creates `~/windows` pointing to the user folder and opens it in Windows Terminal, if present.
  - **Code:** portable VS Code (official zip with the `data` folder) is the default. Zed can be chosen in the ☰ menu.
  - **PDF:** merge and rotate with qpdf, compress with Ghostscript. **Video trim:** ffmpeg without re-encoding.
  - Webcam and Transfer: the Hub's own apps, verified by the SHA-256 the release publishes.
  - "More apps" opens the site for what stays web (photos, music, recorder, whiteboard, quick documents).
  - **☰:** stored tools, with disk size, total and removal with in-window confirmation; check for
    updates, which re-downloads only the tool with a new version; code editor; security and privacy.
  - **Hub self-update:** compares the SHA-256 published in the `hub-windows` release. If different, an
    "Update available · Update" bar appears. The new .exe is only used if the hash matches.
- `tools/windows_ferramentas.py` builds `windows/ferramentas.json` from the official sources:
  - VS Code API and Alpine list, which publish SHA-256;
  - GitHub release "digest" (Zed, office editor, qpdf, Ghostscript, Gyan Doshi's ffmpeg);
  - `.sha256` of our releases.
  The catalog ships inside the .exe and is updated from the site.
- `.github/workflows/windows-hub.yml`: weekly and on every change, updates the catalog, builds and publishes
  `InkDOSHub.exe` and its `.sha256` to the `hub-windows` release.
- `windows/index.html`: the download link was added.

## Test
- Built here with the .NET 8 SDK (net48, no errors or warnings). The .exe is 108 KB.
- The catalog was generated with Alpine, VS Code (364 MB, Microsoft SHA-256), Webcam and Transfer. GitHub entries
  (Zed, office editor, qpdf, Ghostscript, ffmpeg) are filled by the action, which has API access.
- Not yet tested on real Windows. The interface and installers need Paulo's PC.

## Pending
- Measure RAM and CPU on the PC and record it here.
- Sign `InkDOSHub.exe` when SignPath approves.
- OCR (Tesseract) and MuPDF are not in the catalog yet.
