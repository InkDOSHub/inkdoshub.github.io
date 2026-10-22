# InkTerminal Webcam para Windows (teste)

App pequeno (.NET Framework 4.8, que já vem no Windows) que transforma a câmera do iPhone em webcam do Windows sem o OBS.

- **Tela:** um WebView2 com a página Guest do app Webcam (`apps/webcam/?app=1`) e a escolha de qualidade (720p, 1080p ou 4K, 30 ou 60 fps).
- **Câmera virtual:** [softcam](https://github.com/tshino/softcam) (MIT, DirectShow), o mesmo tipo de câmera da câmera virtual do OBS. O app registra a `softcam.dll` uma vez, como administrador, com o nome "InkTerminal Webcam" e um CLSID próprio.
- **Caminho da imagem:** a página desenha cada quadro num canvas do tamanho da câmera e copia os pixels para um buffer compartilhado (`CoreWebView2SharedBuffer`). O app converte para BGR e chama `scSendFrame` (código em `apps/webcam/app.js`, função `bombaApp`, e `Program.cs`).
- **Compilação:** `.github/workflows/webcam-windows.yml` compila o softcam (commit fixado, com o nome e o CLSID trocados) e o app no GitHub Actions e publica `InkTerminal-Webcam-Windows.zip` na release `webcam-windows`.
