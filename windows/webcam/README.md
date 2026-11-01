# InkDOS Hub Webcam for Windows (test)

Small app (.NET Framework 4.8, built into Windows) that turns the iPhone camera into a Windows webcam without OBS.

- **Window:** native, no WebView2 or Edge: the QR code (generated in `Qr.cs`), the code, the status and the quality choice (720p, 1080p or 4K, 30 or 60 fps).
- **Virtual camera:** [softcam](https://github.com/tshino/softcam) (MIT, DirectShow), the same kind of camera as the OBS virtual camera. The app registers `softcam.dll` once, as administrator, with the name "InkDOS Hub Webcam" and its own CLSID.
- **Video path:** the app talks to the PeerJS server and receives the video with GStreamer (`Nativo.cs`). Each decoded frame becomes BGR and goes to `scSendFrame` (`Program.cs`).
- **Build:** `.github/workflows/webcam-windows.yml` builds softcam (pinned commit, with the name and CLSID changed) and the app on GitHub Actions and publishes `InkDOSHub-Webcam-Windows.zip` to the `webcam-windows` release.
