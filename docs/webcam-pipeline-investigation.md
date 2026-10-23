# InkTerminal Webcam — investigação do pipeline de vídeo

Data: 2026-10-22  
Escopo: Windows 11, iPhone/Safari → WebRTC → câmera virtual, meta final 3840×2160/60 fps; piso obrigatório 1920×1080/30 fps.

## Meta de desempenho e decisão resumida

**Meta final do produto: 4K (3840×2160) a 60 fps sustentados. Piso mínimo de compatibilidade: 1080p a 30 fps.** 1080p30 não conta como conclusão bem-sucedida da otimização; é apenas o nível mínimo para evitar regressão. As metas devem ser avaliadas separadamente por dispositivo, navegador/runtime, codec, rede e consumidor da câmera virtual. A meta 4K60 só pode ser declarada após teste físico de ponta a ponta, não por simulação.

**Hipótese preferida após a comparação (B): manter a recepção WebRTC no Chromium/WebView2 e substituir o caminho de pixels Canvas/RGBA por frames WebCodecs/VideoFrame, enviados em formato YUV para um pipeline nativo otimizado (libyuv), mantendo inicialmente o dispositivo DirectShow `softcam`.**

Não recomendo como primeira implementação reescrever simultaneamente o receptor WebRTC nativo e o dispositivo virtual em Media Foundation. Essa é uma arquitetura possível, mas dobra a superfície de risco: negociação WebRTC/sinalização/ICE/codec e implementação COM/Frame Server da câmera. A API `libdatachannel` não inclui decodificação de mídia; a discussão do próprio mantenedor deixa claro que a aplicação precisa fornecer o decoder e o controle de bitrate [11][12]. Isso significa que o “receptor nativo” não elimina o trabalho de codec, jitter buffer e recuperação de pacotes.

O repositório de referência **OmniCam** já demonstra a alternativa B: WebRTC no Chromium/Electron, `MediaStreamTrackProcessor`, `VideoFrame.copyTo`, addon C++ nativo e libyuv, sem desenhar os frames de produção em Canvas. A documentação pública registra medições de cerca de 0,4 ms para copiar frame I420 por software e cerca de 1,5 ms para converter I420 em RGB24 em sua configuração Windows, com a ressalva de que são números de outra máquina e não uma medição do InkTerminal [1][2]. O código atual do InkTerminal tem o mesmo tipo de gargalo que esse projeto deliberadamente evita.

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

### A — receptor WebRTC nativo + decoder H.264/VP8 + Media Foundation Virtual Camera (hipótese principal a investigar)

- Potencial de evitar inteiramente o readback de pixels do Chromium e obter maior controle do buffer/decoder.
- Requer trocar ou compatibilizar o protocolo de sinalização PeerJS; um receptor nativo não se conecta magicamente ao servidor PeerJS existente.
- `libdatachannel` não decodifica o vídeo por conta própria; precisa de decoder e do trabalho de media pipeline, além de manter jitter, timestamps, perdas, retransmissões, keyframes e renegociação.
- MF Virtual Camera é suportada no Windows 11, mas precisa de uma media source COM e de integração correta ao Frame Server; compatibilidade real com Zoom/Brave/Meet deve ser validada separadamente.
- Maior custo de implementação, manutenção e risco de regressão. A simulação só verifica a aritmética da fila; não há base para afirmar que a decodificação nativa será mais rápida neste computador.

### B — Chromium/WebView2 WebRTC + VideoFrame/YUV + pipeline nativo + DirectShow atual (segunda hipótese)

- Mantém o servidor de pareamento PeerJS, a negociação de codec, ICE, reconexão e permissões do iPhone que já funcionam.
- Retira Canvas e `getImageData` do caminho de cada frame.
- O frame deve ser entregue a um worker via `MediaStreamTrackProcessor`, copiado para memória em seu formato nativo quando suportado, e entregue ao pipeline nativo com buffer de tamanho limitado.
- O pipeline nativo faz rotação, espelhamento, fit/fill e conversão usando libyuv, evitando RGBA intermediário.
- Mantém a câmera DirectShow existente durante a prova de conceito; isso minimiza regressão com Zoom.
- Risco principal: suporte/contexto de `MediaStreamTrackProcessor` no WebView2 runtime e custo de readback se o frame estiver na GPU. A implementação deve testar capacidades reais, usar software decode como experimento controlado e manter fallback atual.
- Risco secundário: formatos/strides/colorimetria devem ser tratados corretamente. Não assumir I420 contíguo sem verificar layout.

## Custo de dados para a meta 4K60

O 4K (3840×2160) contém 8.294.400 pixels por quadro. A 60 fps são 497,7 milhões de pixels/s — **8 vezes** o volume de pixels de 1080p30. Um quadro 4K RGBA ocupa 33.177.600 bytes (31,64 MiB); uma única passagem a 60 fps movimenta aproximadamente 1,99 GB/s (antes de cópias adicionais). Um quadro 4K I420 ocupa aproximadamente 12.441.600 bytes (11,87 MiB), cerca de 746 MB/s a 60 fps por passagem. Esses números são tráfego bruto teórico, não largura de banda de rede nem medições do computador. WebRTC normalmente transporta vídeo comprimido; os custos acima aparecem em buffers/descompressão e cópias de pixels.

## Mini-teste teórico (não é benchmark físico)

Um quadro 1080p RGBA ocupa 8.294.400 bytes; a 30 fps, uma passagem equivale a aproximadamente 249 MB/s. I420 ocupa 3.110.400 bytes, cerca de 93 MB/s a 30 fps. Para 4K60, esses volumes sobem para cerca de 1,99 GB/s em RGBA e 746 MB/s em I420 por passagem — portanto, cópias intermediárias precisam ser minimizadas.

Modelo discreto de fila única com “último quadro vence”, 30 fps de entrada para os cenários comparativos iniciais, jitter de chegada ±1,5 ms e serviço aleatório. Este modelo não demonstra a meta 4K60. Os tempos abaixo são **parâmetros hipotéticos** escolhidos para comparar sensibilidade, não medidas do InkTerminal nem garantia de desempenho:

| Cenário | Serviço por quadro assumido | Resultado do modelo |
|---|---:|---|
| Atual (aproximação dos custos observados) | 60 ms ± 5 ms | ~16,7 fps; ~77 ms de latência média |
| A: receptor/decoder nativo + MF (hipótese) | 6 ms ± 2 ms | ~30 fps; ~6 ms de latência média |
| B: VideoFrame/YUV + pipeline nativo (hipótese) | 3 ms ± 1 ms | ~30 fps; ~3 ms de latência média |

O modelo confirma apenas a aritmética da fila: se o serviço excede 33,33 ms continuamente, 30 fps não se sustentam; se fica bem abaixo do período e a fila não acumula, há margem. Não modela CPU real, codecs, rede, GPU, Frame Server, Zoom, pausas do iOS nem comportamento térmico. Os valores de B derivam parcialmente de medições publicadas por OmniCam em outro equipamento; os de A são apenas cenário de sensibilidade. Portanto, o teste não prova que A alcançará 30 fps no computador-alvo.

## Critérios para uma prova de conceito real

A implementação deve ter flag de experimento e fallback automático para o pipeline atual. Não trocar silenciosamente resolução/fps. Medir durante 60 s, com a câmera efetivamente aberta por um consumidor:
- fps recebido do WebRTC, fps processado, fps entregue à câmera e frames descartados;
- p50/p95 de copyTo, conversão, entrega e idade do quadro no momento da saída;
- uso de CPU por processo, memória, crescimento de memória e atraso acumulado;
- estado de reconexão e resultado de 1080p30 após reconectar;
- Zoom e Brave/Chrome separadamente, porque usam caminhos de captura distintos.

**Critério de piso (necessário, mas insuficiente para concluir o projeto):** 1080p30 de saída sustentados por 60 s (média ≥29,5), p95 da idade do quadro <100 ms, fila limitada a um quadro pendente, memória estável e nenhuma regressão funcional.

**Critério da meta final:** 3840×2160 a 60 fps de ponta a ponta por pelo menos 10 minutos, com média ≥59 fps, p95 de idade do quadro <50 ms (alvo de engenharia, a validar), sem backlog crescente, sem crescimento contínuo de memória e sem queda sustentada de resolução/fps. Medir CPU/GPU, bitrate, perdas, drops e temperatura/limitação térmica. Testar separadamente a saída da câmera virtual nos consumidores suportados. Se o iPhone, a rede, o runtime WebView2, o codec ou o dispositivo virtual não suportarem 4K60, reportar o gargalo e o melhor perfil realmente sustentado; não declarar a meta cumprida com base apenas em fps do WebRTC.

## Próxima implementação recomendada

1. Criar pipeline nativo de frames com buffer limitado (double/triple buffer), “newest frame wins”, timestamps e contadores.
2. Provar a leitura de frames no WebView2 usando `MediaStreamTrackProcessor` em Dedicated Worker e `VideoFrame.copyTo`; feature-detect e manter fallback.
3. Adicionar libyuv ao build Windows e converter do formato real de entrada diretamente para o formato exigido por softcam, executando rotação/espelhamento/fit/fill no pipeline nativo.
4. Manter DirectShow no primeiro experimento. Avaliar MFVirtualCamera em ramo separado somente após B passar os testes e com matriz de compatibilidade de Zoom/Brave/Chrome.
5. Projetar o pipeline para 4K60 desde o início: evitar RGBA e cópias repetidas, usar buffers limitados, converter no formato nativo mais adequado e medir aceleração por hardware/D3D11. Se houver readback GPU→CPU inevitável, avaliar compartilhamento de superfícies GPU.
6. Testar separadamente limites reais de captura do iPhone/Safari, resolução negociada do WebRTC, codec/encoder, bitrate e capacidades do softcam e dos aplicativos consumidores. Não presumir que 4K60 é suportado só porque a tela de configuração oferece esse perfil.

## Prompt de implementação para o agente de código

> Trabalhe no repositório `Inkterminal/Inkterminal.github.io`, em branch isolada. Implemente a hipótese B como prova de conceito opt-in para o InkTerminal Webcam Windows, projetando para a meta final de 4K (3840×2160) a 60 fps; 1080p30 é somente o piso mínimo: substitua o pipeline Canvas → getImageData → cópia RGBA → conversão manual BGR por captura de VideoFrames do MediaStream WebRTC no WebView2, preferencialmente via MediaStreamTrackProcessor em Dedicated Worker, e um pipeline nativo C++ com libyuv.
>
> Requisitos:
> - Preserve PeerJS, pareamento QR/código, codec, qualidade, reconexão, rotação, espelhamento, fit/fill, placeholder, perfis e compatibilidade atual.
> - Meta final obrigatória: sustentar 3840×2160 a 60 fps ponta a ponta; piso de compatibilidade: 1920×1080 a 30 fps. Não trate o piso como conclusão do projeto.
> - Não mude a resolução nem o FPS solicitados para esconder lentidão. Registre resolução/FPS solicitados e efetivamente negociados/entregues em cada etapa.
> - Detecte suporte a cada API e mantenha fallback para o pipeline atual.
> - Trate formatos reais (I420/NV12/RGBA/BGRA), layout/strides, timestamps, colorimetria e rotação; não assuma buffer I420 apertado sem validação.
> - Use fila limitada e política “quadro mais novo vence”; nunca permita backlog crescente. Não bloquear a thread UI do WebView2 com conversão de pixels.
> - Adicione métricas de fps recebido/processado/entregue, descartes, idade do quadro e p50/p95 de cada etapa.
> - Não introduza Media Foundation Virtual Camera no mesmo patch inicial; mantenha softcam/DirectShow até provar a melhoria. Faça a hipótese A (receptor WebRTC nativo + Media Foundation Virtual Camera) uma segunda experiência separada, pois exige decoder, adaptação da sinalização PeerJS, media source COM e validação de compatibilidade.
> - Acrescente teste sintético de formatos/layouts, rotação, resolução, cadência, perda de conexão e shutdown seguro. Atualize o workflow Windows para compilar e executar testes automaticamente.
> - Execute build Windows em CI e registre os resultados. Se não houver máquina física para medir Zoom, declare explicitamente que a meta de 1080p30 ainda não foi validada em hardware.
> - Só considere o piso aprovado após ≥29,5 fps em 1080p por 60 s, p95 da idade do quadro <100 ms, fila limitada, memória estável e nenhuma regressão. Só declare a meta final aprovada após 4K60 sustentado por 10 minutos (média ≥59 fps), p95 da idade do quadro <50 ms como alvo a validar, sem backlog/memória crescente e com consumidor real da câmera virtual. Até provar isso em hardware, mantenha a rota opt-in e documente claramente o que foi validado apenas em CI/simulação versus em máquina física.
>
> Faça alterações pequenas, revisáveis e licenciadas corretamente. Não copie arquivos de terceiros sem preservar os avisos/licenças. Não afirme que o build, o teste físico ou a compatibilidade com Zoom passaram sem evidência correspondente.
