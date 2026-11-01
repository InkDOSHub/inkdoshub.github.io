# 017 · Windows without Edge (2026-10-30)

> Superseded by log 018 (Electron, the same apps as the web). Kept as history.

Request: in the Windows app, separate the old office editor from InkDOS and stop opening Edge and its graphics engine. Paulo chose "everything native, including the Webcam".

## Hub (windows/hub/)

- The old office editor has its own icons (DOCX, XLSX and PPTX), with its name under the app name, as on the site.
- No app opens the browser:

| App | Before | Now |
| --- | --- | --- |
| PDF and EPUB reader | site in the browser | SumatraPDF (GPL-3.0, portable .zip from the official site, signed by Krzysztof Kowalczyk, 8 MB) |
| Photos | site | Windows Photos app |
| Music | site | Windows Media Player |
| Recorder | site | Windows Sound Recorder |
| InkDOS Documents, Spreadsheets and Presentations, Whiteboard | site | removed from the Windows app, because they only exist on the web. The office editor covers documents |

- The folder (Open file) opens PDF, EPUB, MOBI, CBZ, XPS and DjVu in SumatraPDF.
- `tools/windows_ferramentas.py`: the `sumatra` entry reads the version from `update-check-rel.txt`. The site publishes no SHA-256, so the script downloads the .zip and computes the hash.
- The browser only opens when the person asks, in "Open in browser" or "Source code".

## Webcam (windows/webcam/)

- WebView2 was removed. The window is native, with the QR code, the code, the status, "New code" and quality.
- The QR code is generated in `Qr.cs` (byte mode, M correction, versions 1 to 10, Project Nayuki algorithm, MIT). Checked with zbarimg at three text sizes.
- The code is stored in the registry (`HKCU\Software\InkDOS Hub Webcam\codigo`).
- Video already came through the native receiver (GStreamer, `Nativo.cs`). Now it is the only path. The shared buffer, queue and page send thread were removed.
- The `webcam-windows.yml` action no longer copies the WebView2 DLLs.

## Pending

- Test on the PC: the Webcam window (does not run on Linux, needs softcam) and the Windows app shortcuts (Photos, Media Player, Sound Recorder).
