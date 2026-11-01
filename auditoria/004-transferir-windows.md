# 004 · Transfer for Windows (2026-10-29)

**Read:** `windows/transferir/Program.cs` (local HTTP server, Wi-Fi Direct), `web/pc.html` (PC panel),
`web/celular.html` (phone page). `web/qrcode.js` is third-party (the same library as the Webcam, embedded in the .exe).

## Changes made

1. **Safer HTML escaping (`pc.html`, `celular.html`):** the old `esc()` (via `div.innerHTML`) did not escape
   quotes, and the file name goes into an attribute (`download="..."`). On Windows a name cannot contain `"`, so
   there was no exploitable flaw, but the protection no longer depends on that.
2. **PC panel:** the diagnostic numbers come from the phone. They are now converted to numbers before use,
   so an invalid value neither breaks the panel nor divides by zero.
3. **Server:** each connection had a thread waiting for the header with no timeout. A device on the network could open many
   connections and send nothing. Now the header has 15 s to arrive; after that, reads have no timeout again (long uploads are not affected).

## Security checked (no change)

- The phone only gets in with the QR key (8 characters from a cryptographic generator, constant-time comparison).
- The PC panel (`localhost`) requires a 24-character token, so sites open in the PC browser cannot use the routes.
- The `Host` header must be an IP or `localhost`, which blocks DNS rebinding.
- Received file names are cleaned (`Limpar`: no folders, no forbidden characters) and never overwrite a file
  (creates "name (2)"). Free space is checked, keeping 1 GB spare.
- The phone only downloads files the person chose on the PC (by list id), never by path.
- Wi-Fi Direct uses a random 10-character password and does not need administrator.
- Nothing leaves the local network; there is no external server.

## Findings without change

- The connection is HTTP without TLS: on the password-protected Wi-Fi Direct network the risk is low; through the router, another device on the same network could see the traffic. TLS would need a local certificate, which is complex for a test app.
- `diagCelular` (phone JSON) goes raw into the state JSON after a simple check (`{...}` and no `<`). Only someone with the key can send it. Acceptable.
- The top comment still says "prototype" and describes the router mode, which the panel still accepts.
- The `.exe` is still unsigned (postponed).

## Commit

See `git log -- auditoria/004-transferir-windows.md`. The build runs on the `transferir-windows` action.
