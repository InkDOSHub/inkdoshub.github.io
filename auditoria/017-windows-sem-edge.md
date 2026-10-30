# 017 · Windows sem o Edge (2026-10-30)

Pedido: no app de Windows, separar o ONLYOFFICE do InkDOS e parar de abrir o Edge e o motor gráfico dele. O Paulo escolheu "tudo nativo, inclusive a Webcam".

## Hub (windows/hub/)

- O ONLYOFFICE tem os próprios ícones (DOCX, XLSX e PPTX), com "ONLYOFFICE" embaixo do nome, como no site.
- Nenhum app abre o navegador:

| App | Antes | Agora |
| --- | --- | --- |
| PDF e Leitor EPUB | site no navegador | SumatraPDF (GPL-3.0, .zip portátil do site oficial, assinado por Krzysztof Kowalczyk, 8 MB) |
| Fotos | site | app Fotos do Windows |
| Música | site | Media Player do Windows |
| Gravador | site | Gravador de Som do Windows |
| Documentos, Planilhas e Apresentações do InkDOS, Quadro | site | saíram do app de Windows, porque só existem na web. O ONLYOFFICE cobre os documentos |

- A pasta (Abrir arquivo) abre PDF, EPUB, MOBI, CBZ, XPS e DjVu no SumatraPDF.
- `tools/windows_ferramentas.py`: a entrada `sumatra` lê a versão em `update-check-rel.txt`. O site não publica SHA-256, então o script baixa o .zip e calcula o hash.
- O navegador só abre quando a pessoa pede, em "Abrir no navegador" ou "Código-fonte".

## Webcam (windows/webcam/)

- O WebView2 saiu. A janela é nativa, com o QR, o código, o estado, "Novo código" e a qualidade.
- O QR é gerado em `Qr.cs` (modo byte, correção M, versões 1 a 10, algoritmo do Project Nayuki, MIT). Foi conferido com o zbarimg em três tamanhos de texto.
- O código é guardado no registro (`HKCU\Software\InkDOS Hub Webcam\codigo`).
- O vídeo já vinha pelo receptor nativo (GStreamer, `Nativo.cs`). Agora ele é o único caminho. Saíram o buffer compartilhado, a fila e a thread de envio da página.
- A action `webcam-windows.yml` não copia mais as DLLs do WebView2.

## Falta

- Testar no PC: a janela da Webcam (não roda no Linux, porque precisa do softcam) e os atalhos dos apps do Windows (Fotos, Media Player, Gravador de Som).
