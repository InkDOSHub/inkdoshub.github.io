# InkDOS Hub Webcam para Windows (teste)

App pequeno (.NET Framework 4.8, que já vem no Windows) que transforma a câmera do iPhone em webcam do Windows sem o OBS.

- **Tela:** nativa, sem WebView2 nem Edge: o QR (gerado em `Qr.cs`), o código, o estado e a escolha de qualidade (720p, 1080p ou 4K, 30 ou 60 fps).
- **Câmera virtual:** [softcam](https://github.com/tshino/softcam) (MIT, DirectShow), o mesmo tipo de câmera da câmera virtual do OBS. O app registra a `softcam.dll` uma vez, como administrador, com o nome "InkDOS Hub Webcam" e um CLSID próprio.
- **Caminho da imagem:** o app fala com o servidor do PeerJS e recebe o vídeo com o GStreamer (`Nativo.cs`). Cada quadro decodificado vira BGR e vai para `scSendFrame` (`Program.cs`).
- **Compilação:** `.github/workflows/webcam-windows.yml` compila o softcam (commit fixado, com o nome e o CLSID trocados) e o app no GitHub Actions e publica `InkDOSHub-Webcam-Windows.zip` na release `webcam-windows`.
