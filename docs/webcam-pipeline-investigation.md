# InkTerminal Webcam — investigação do pipeline de vídeo

Data: 2026-10-22  
Escopo: Windows 11, iPhone/Safari → WebRTC → câmera virtual, alvo 1920×1080/30 fps.

## Decisão resumida

**Hipótese preferida após a comparação (B): manter a recepção WebRTC no Chromium/WebView2 e substituir o caminho de pixels Canvas/RGBA por frames WebCodecs/VideoFrame, enviados em formato YUV para um pipeline nativo otimizado (libyuv), mantendo inicialmente o dispositivo DirectShow `softcam`.**

Não recomendo como primeira implementação reescrever simultaneamente o receptor WebRTC nativo e o dispositivo virtual em Media Foundation. Essa é uma arquitetura possível, mas dobra a superfície de risco: negociação WebRTC/sinalização/ICE/codec e implementação COM/Frame Server da câmera. A API `libdatachannel` não inclui decodificação de mídia; a discussão do próprio mantenedor deixa claro que a aplicação precisa fornecer o decoder e o controle de bitrate [11][12]. Isso significa que o “receptor nativo” não elimina o trabalho de codec, jitter buffer e recuperação de pacotes.

O repositório de referência **OmniCam** já demonstra a alternativa A: WebRTC no Chromium/Electron, `MediaStreamTrackProcessor`, `VideoFrame.copyTo`, addon C++ nativo e libyuv, sem desenhar os frames de produção em Canvas. A documentação pública registra medições de cerca de 0,4 ms para copiar frame I420 por software e cerca de 1,5 ms para converter I420 em RGB24 em sua configuração Windows, com a ressalva de que são números de outra máquina e não uma medição do InkTerminal [1][2]. O código atual do InkTerminal tem o mesmo tipo de gargalo que esse projeto deliberadamente evita.

## O que foi observado no InkTerminal

Arquivos atuais:
- `apps/webcam/app.js`: o receptor WebRTC já entrega um `MediaStream` ao elemento `video`; em modo Windows, a função `bombaApp` desenha no Canvas, chama `getImageData`, copia RGBA ao buffer compartilhado e espera a confirmação do processo Windows.
- `windows/webcam/Program.cs`: lê o buffer, converte cada pixel RGBA→BGR e chama `Softcam.scSendFrame`.
- `.github/workflows/webcam-windows.yml`: compila e publica a câmera DirectShow.

Os números históricos do log informado no projeto mostram, em 1080p, aproximadamente 35–40 ms em desenho, 14–17 ms em leitura de pixels, 2,5–3 ms na cópia JS, 4,5 ms na conversão C# e 2 ms no envio. Esses números não são um benchmark novo desta investigação, mas explicam por que o caminho pode ultrapassar o orçamento de 33,33 ms por quadro.

## Referências e o que cada uma sustenta

1. **OmniCam — projeto open-source equivalente**: telefone em browser → WebRTC → Chromium → `MediaStreamTrackProcessor`/`VideoFrame.copyTo` → pipeline nativo/libyuv → câmera virtual DirectShow. É a evidência de arquitetura mais próxima do problema real. https://github.com/Orest-Z/OmniCam
2. **OmniCam ARCHITECTURE.md**: medições declaradas no projeto e decisão explícita de não desenhar os frames de produção em Canvas. Os números são do ambiente OmniCam, não promessa para InkTerminal. https://github.com/Orest-Z/OmniCam/blob/main/ARCHITECTURE.md
3. **Microsoft — IMFVirtualCamera**: API para registrar câmera virtual integrada ao Frame Server; disponível a partir do Windows build 22000. https://learn.microsoft.com/pt-br/windows/win32/api/mfvirtualcamera/nn-mfvirtualcamera-imfvirtualcamera
4. **Microsoft — Windows-Camera sample**: exemplo oficial de Media Foundation Virtual Camera e configuração. https://github.com/microsoft/Windows-Camera/tree/master/Samples/VirtualCamera
5. **smourier/VCamSample**: implementação de referência de media source MF, inclusive RGB32 e NV12. https://github.com/smourier/VCamSample
6. **Microsoft — DirectShow video capture**: documentação oficial classifica DirectShow como tecnologia legada e recomenda APIs modernas quando possível; isso não significa que se deva substituir uma câmera que já funciona com Zoom sem testar compatibilidade. https://learn.microsoft.com/en-us/windows/win32/directshow/about-video-capture-devices
7. **OBS2MF**: exemplo comunitário de que MF virtual camera precisa de uma media source e de um canal de frames apropriado; a arquitetura inclui broker/pipe e NV12. https://github.com/mbales-tech/OBS2MF
8. **MDN — VideoFrame.copyTo()**: permite copiar frames para buffer tipado e escolher layout/formato de destino dentro das opções suportadas. https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/copyTo
9. **MDN — VideoFrame.format**: documenta formatos como I420, NV12, RGBA e BGRA; o código precisa respeitar o formato real e o layout/stride, não presumir que todo frame seja RGBA. https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/format
10. **MDN — MediaStreamTrackProcessor**: entrega VideoFrames a partir de uma MediaStreamTrack, mas a disponibilidade varia entre contextos e navegadores; a documentação atual destaca diferenças entre janela e Dedicated Worker. Isso exige feature detection e fallback. https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor
11. **libdatachannel**: biblioteca C++ multiplataforma para WebRTC, mas a biblioteca não oferece decoder de mídia integrado. https://libdatachannel.org/
12. **Discussão do mantenedor de libdatachannel (#688)**: o mantenedor explica que a biblioteca cuida do transporte e não decodifica mídia internamente. https://github.com/paullouisageneau/libdatachannel/issues/688
13. **Discussão de bitrate em libdatachannel (#1307)**: a biblioteca não fornece por si só o encoder/controle de bitrate; isso precisa ser fornecido pelo pipeline de mídia. https://github.com/paullouisageneau/libdatachannel/discussions/1307
14. **Bug de Chromium/WebKit sobre getImageData**: descreve o custo de readback síncrono da GPU para CPU, principal risco ao ler pixels de Canvas em todos os frames. https://bugs.webkit.org/show_bug.cgi?id=65622
15. **Stack Overflow — getImageData em loop**: discussão prática sobre a mudança de caminho de renderização e custo de readback em chamadas repetidas. https://stackoverflow.com/questions/70641858/canvas-painting-time-issue-with-getimagedata-in-game-loop/70644874
16. **Kevin Schiener — willReadFrequently**: relato de investigação prática sobre lentidão causada por leituras frequentes de pixels. A opção pode mudar o backend de Canvas, mas não remove a cópia de pixels. https://www.schiener.io/2024-08-02/canvas-willreadfrequently
17. **OBS VirtualCam — fórum OBS**: projeto comunitário DirectShow e relato de compatibilidade com aplicativos consumidores; mostra que DirectShow ainda tem utilidade prática para apps de videoconferência. https://obsproject.com/forum/resources/obs-virtualcam.1744/
18. **Microsoft Q&A — virtual webcam**: discussão histórica sobre limitações de fontes virtuais em Media Foundation e diferenças de descoberta/ativação. Deve ser lida junto da API MFVirtualCamera moderna, não como descrição do Windows atual. https://learn.microsoft.com/en-us/answers/questions/872883/which-api-to-use-for-creating-virtual-webcam
19. **Microsoft Q&A — falha de ativação de câmera MF**: relato de que enumeração e ativação podem falhar de maneiras distintas após atualizações do Windows, reforçando a necessidade de teste por aplicativo. https://learn.microsoft.com/en-us/answers/questions/3893049/issue-activating-virtual-camera-via-media-foundati
20. **WebView2 — desempenho**: a Microsoft recomenda evitar JavaScript pesado e preservar aceleração de renderização; não se deve desligar a GPU indiscriminadamente como “otimização”. https://learn.microsoft.com/pt-br/microsoft-edge/webview2/concepts/performance

## Confronto das hipóteses

### A — receptor WebRTC nativo + decoder + Media Foundation Virtual Camera (hipótese principal a investigar)

- Mantém o servidor de pareamento PeerJS, a negociação de codec, ICE, reconexão e permissões do iPhone que já funcionam.
- Retira Canvas e `getImageData` do caminho de cada frame.
- O frame deve ser entregue a um worker via `MediaStreamTrackProcessor`, copiado para memória em seu formato nativo (preferencialmente I420/NV12 quando suportado), e entregue ao pipeline nativo com buffer de tamanho limitado.
- O pipeline nativo faz rotação, espelhamento, fit/fill e conversão usando libyuv, evitando RGBA intermediário.
- Mantém a câmera DirectShow existente durante a prova de conceito; isso minimiza regressão com Zoom.
- Risco principal: suporte/contexto de `MediaStreamTrackProcessor` no WebView2 runtime e custo de readback se o frame estiver na GPU. A implementação deve testar capacidades reais, usar software decode como experimento controlado e manter fallback atual.
- Risco secundário: formatos/strides/colorimetria devem ser tratados corretamente. Não assumir I420 contíguo sem verificar layout.

### B — Chromium/WebView2 WebRTC + VideoFrame/YUV + pipeline nativo + DirectShow atual (segunda hipótese)

- Potencial de evitar inteiramente o readback de pixels do Chromium e obter maior controle do buffer/decoder.
- Requer trocar ou compatibilizar o protocolo de sinalização PeerJS; um receptor nativo não se conecta magicamente ao servidor PeerJS existente.
- `libdatachannel` não decodifica o vídeo por conta própria; precisa de decoder e do trabalho de media pipeline, além de manter jitter, timestamps, perdas, retransmissões, keyframes e renegociação.
- MF Virtual Camera é suportada no Windows 11, mas precisa de uma media source COM e de integração correta ao Frame Server; compatibilidade real com Zoom/Brave/Meet deve ser validada separadamente.
- Maior custo de implementação, manutenção e risco de regressão. É a segunda hipótese, apropriada se A continuar limitada pelo readback ou se a exigência futura incluir aplicativos que não reconhecem DirectShow.

## Mini-teste teórico (não é benchmark físico)

Um quadro 1080p RGBA ocupa 1920 × 1080 × 4 = 8.294.400 bytes (7,91 MiB); a 30 fps, uma única passagem desse buffer equivale a aproximadamente 249 MB/s. I420 ocupa aproximadamente 3.110.400 bytes (2,97 MiB), cerca de 93 MB/s a 30 fps — redução aproximada de 62,5% no volume por passagem.

Modelo discreto de fila única com “último quadro vence”, 30 fps de entrada, jitter de chegada ±1,5 ms e serviço aleatório. Os tempos abaixo são **parâmetros hipotéticos** escolhidos para comparar sensibilidade, não medidas do InkTerminal nem garantia de desempenho:

| Cenário | Serviço por quadro assumido | Resultado do modelo |
|---|---:|---|
| Atual (aproximação dos custos observados) | 60 ms ± 5 ms | ~16,7 fps; ~77 ms de latência média |
| A: receptor/decoder nativo + MF (hipótese) | 6 ms ± 2 ms | ~30 fps; ~6 ms de latência média |
| B: VideoFrame/YUV + pipeline nativo (hipótese) | 3 ms ± 1 ms | ~30 fps; ~3 ms de latência média |

O modelo confirma apenas a aritmética da fila: se o serviço excede 33,33 ms continuamente, 30 fps não se sustentam; se fica bem abaixo do período e a fila não acumula, há margem. Não modela CPU real, codecs, rede, GPU, Frame Server, Zoom, pausas do iOS nem comportamento térmico. Os valores de A derivam parcialmente de medições publicadas por OmniCam em outro equipamento; os de B são apenas cenário de sensibilidade. Portanto, o teste não prova que A alcançará 30 fps no computador-alvo.

## Critérios para uma prova de conceito real

A implementação deve ter flag de experimento e fallback automático para o pipeline atual. Não trocar silenciosamente resolução/fps. Medir durante 60 s, com a câmera efetivamente aberta por um consumidor:
- fps recebido do WebRTC, fps processado, fps entregue à câmera e frames descartados;
- p50/p95 de copyTo, conversão, entrega e idade do quadro no momento da saída;
- uso de CPU por processo, memória, crescimento de memória e atraso acumulado;
- estado de reconexão e resultado de 1080p30 após reconectar;
- Zoom e Brave/Chrome separadamente, porque usam caminhos de captura distintos.

**Critério mínimo de aprovação sugerido:** 30 fps de saída sustentados por 60 s (média ≥29,5), p95 da idade do quadro <100 ms, fila limitada a um quadro pendente, nenhum crescimento contínuo de memória e nenhuma regressão em pareamento, rotação, fit/fill ou reconexão. Não declarar sucesso só porque o log mostra 1080p.

## Próxima implementação recomendada

1. Criar pipeline nativo de frames com buffer limitado (double/triple buffer), “newest frame wins”, timestamps e contadores.
2. Provar a leitura de frames no WebView2 usando `MediaStreamTrackProcessor` em Dedicated Worker e `VideoFrame.copyTo`; feature-detect e manter fallback.
3. Adicionar libyuv ao build Windows e converter do formato real de entrada diretamente para o formato exigido por softcam, executando rotação/espelhamento/fit/fill no pipeline nativo.
4. Manter DirectShow no primeiro experimento. Avaliar MFVirtualCamera em ramo separado somente após B passar os testes e com matriz de compatibilidade de Zoom/Brave/Chrome.
5. Se o readback continuar acima do orçamento, estudar compartilhamento GPU/D3D11 e só então considerar receptor WebRTC nativo completo.

## Prompt de implementação para o agente de código

> Trabalhe no repositório `Inkterminal/Inkterminal.github.io`, em branch isolada. Implemente a hipótese B como prova de conceito opt-in para o InkTerminal Webcam Windows: substitua o pipeline Canvas → getImageData → cópia RGBA → conversão manual BGR por captura de VideoFrames do MediaStream WebRTC no WebView2, preferencialmente via MediaStreamTrackProcessor em Dedicated Worker, e um pipeline nativo C++ com libyuv.
>
> Requisitos:
> - Preserve PeerJS, pareamento QR/código, codec, qualidade, reconexão, rotação, espelhamento, fit/fill, placeholder, perfis e compatibilidade atual.
> - Não mude a resolução nem o FPS solicitados para esconder lentidão.
> - Detecte suporte a cada API e mantenha fallback para o pipeline atual.
> - Trate formatos reais (I420/NV12/RGBA/BGRA), layout/strides, timestamps, colorimetria e rotação; não assuma buffer I420 apertado sem validação.
> - Use fila limitada e política “quadro mais novo vence”; nunca permita backlog crescente. Não bloquear a thread UI do WebView2 com conversão de pixels.
> - Adicione métricas de fps recebido/processado/entregue, descartes, idade do quadro e p50/p95 de cada etapa.
> - Não introduza Media Foundation Virtual Camera no mesmo patch inicial; mantenha softcam/DirectShow até provar a melhoria. Faça a hipótese A (receptor WebRTC nativo + Media Foundation Virtual Camera) uma segunda experiência separada, pois exige decoder, adaptação da sinalização PeerJS, media source COM e validação de compatibilidade.
> - Acrescente teste sintético de formatos/layouts, rotação, resolução, cadência, perda de conexão e shutdown seguro. Atualize o workflow Windows para compilar e executar testes automaticamente.
> - Execute build Windows em CI e registre os resultados. Se não houver máquina física para medir Zoom, declare explicitamente que a meta de 1080p30 ainda não foi validada em hardware.
> - Só habilite a nova rota por padrão depois de demonstrar ≥29,5 fps de saída por 60 s, p95 de idade do quadro <100 ms, fila limitada, memória estável e nenhum regresso de funcionalidades. Caso contrário, deixe o experimento opt-in e documente o bloqueio.
>
> Faça alterações pequenas, revisáveis e licenciadas corretamente. Não copie arquivos de terceiros sem preservar os avisos/licenças. Não afirme que o build, o teste físico ou a compatibilidade com Zoom passaram sem evidência correspondente.
