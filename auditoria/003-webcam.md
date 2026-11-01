# 003 · Webcam (2026-10-29)

**Read:** `apps/webcam/app.js` (Host on iPhone, Guest on PC, sending to the virtual camera), `apps/webcam/index.html`,
`windows/webcam/Program.cs` (window, WebView2, virtual camera), security-relevant parts of `windows/webcam/Nativo.cs`
(GStreamer receiver). `apps/webcam/lib/` (qrcode, PeerJS) is third-party.

## Changes made

1. **Guest:** the end of the call (iPhone left) and the PC "stop streaming" repeated the same 8 lines of
   screen cleanup. Both now use `semChamada(msg)`.
2. **Host:** `pagehide` repeated, line by line, what `pararLocal()` already does. Now it calls `pararLocal()`.
3. **`Program.cs`:** the "ok" reply for each frame repeated the send to the page instead of using `ParaPagina()`.
4. `?v=` of `app.js` updated.

## Security checked (no change)

- The pairing code has 10 characters from `crypto.getRandomValues` (about 50 bits). The Guest refuses a
  second call while one is connected and validates the received `metadata` (codec in a list, bitrate between 1 and 40 Mbps, format in a list).
- The Host only accepts commands (`stop`, `restart`, `quality`) from the Guest with the typed code, and the requested quality
  can only be one of the 6 in the list.
- Windows app: WebView2 only navigates to and only accepts messages from `https://inkdoshub.github.io/apps/webcam/`; new windows
  are blocked; DevTools off. `frame:` messages have position and size checked before reading memory
  (`Sw*Sh <= W*H`, position below the number of slots), so the page cannot make the app read outside the buffer.
- Registering the virtual camera asks for administrator only for `--registrar` (Windows UAC).
- Video goes directly between devices (WebRTC). The public PeerJS server only does pairing.

## Findings without change

- The reconnection to the pairing server (`tentarReconectar`) is written twice (Guest and Host), with small differences. Merging needs testing on iPhone.
- The "Diagnostics" panel has fixed Portuguese texts, outside the language system (it is a support tool).
- `Nativo.cs` has its own JSON reader (.NET Framework 4.8 does not ship one). It only reads PeerJS server messages. Acceptable.
- The `.exe` is still unsigned (postponed on 2026-10-24).

## Commit

See `git log -- auditoria/003-webcam.md`. The Windows build runs on the `webcam-windows` action.
