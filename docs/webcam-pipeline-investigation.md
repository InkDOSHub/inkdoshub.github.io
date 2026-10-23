# InkTerminal Webcam — investigação do pipeline de vídeo

Data: 2026-10-22  
Escopo: Windows 11, iPhone/Safari → WebRTC → câmera virtual, meta final 3840×2160/60 fps; piso obrigatório 1920×1080/30 fps.

## Decisão executiva — revisão para a meta 4K60

**Meta final: 3840×2160 a 60 fps sustentados, de ponta a ponta. Piso de compatibilidade: 1920×1080 a 30 fps.** O piso não é critério de conclusão.

A investigação inicial favorecia preservar WebRTC no WebView2 e remover Canvas. Isso continua sendo a melhor melhoria incremental, mas **não é a arquitetura com maior probabilidade de garantir 4K60**. A referência mais relevante, OmniCam, registra que no caminho de decodificação por hardware seus frames ficam em superfícies GPU e `VideoFrame.copyTo()` custou cerca de 12 ms por quadro em 1080p — já 72% do orçamento de 16,67 ms para 60 fps. Uma extrapolação linear simples para 4K seria cerca de 48 ms, antes de qualquer conversão; é uma estimativa de risco, não medição 4K. A documentação do mesmo projeto relata I420 em CPU bem mais rápido a 1080p, mas não prova que o i5-1235U sustente decodificação 4K60 por software.

**Melhor hipótese para a meta real (A): pipeline nativo de ponta a ponta** — captura iOS nativa via AVFoundation/VideoToolbox para controlar formato da câmera e encoder; transporte WebRTC nativo; receptor Windows com decoder acelerado por hardware e superfícies D3D11; câmera virtual Media Foundation fornecendo NV12 sem ida e volta GPU→CPU. É a arquitetura com maior teto de desempenho, mas implica aplicativo/componente nativo iOS, migração ou compatibilidade da sinalização hoje baseada em PeerJS, receiver WebRTC nativo, decoder e media source COM. Deve ser provada por etapas, não implementada toda de uma vez.

**Segunda melhor hipótese (B): manter a experiência web, remover Canvas e usar pipeline YUV nativo** — Safari/PeerJS/WebRTC no telefone e WebView2 como receptor; feature-detect `MediaStreamTrackProcessor`, copiar `VideoFrame` para I420 em CPU quando isso evitar readback lento, transferir por buffer limitado para C++/libyuv e uma Media Foundation Virtual Camera que aceite NV12. Preserva mais do produto atual e reduz o risco de regressão, mas só alcança 4K60 se Safari/iPhone realmente capturar e codificar 4K60 e se não houver readback de GPU caro. É a primeira prova de conceito de menor custo, não uma promessa de que o browser permite 4K60.

**Ponto crítico no código atual:** `apps/webcam/app.js` declara perfil `2160p60` e pede `width/height/frameRate: { ideal: ... }`, mas não verifica a configuração efetiva por `track.getSettings()`. Constraints ideais não garantem os valores pedidos. Além disso, `windows/webcam/Program.cs` oferece atualmente 4K30, não 4K60, e o fluxo usa Canvas → `getImageData()` → RGBA → conversão C# para BGR → DirectShow. Logo, perfil declarado não prova 4K60 capturado, transmitido ou entregue.

Sequência recomendada: (1) instrumentar o fluxo para registrar resolução/FPS reais; (2) testar B com CPU I420 e sem Canvas; (3) identificar se o gargalo restante é captura/encoder Safari, rede, decode, cópia ou softcam; (4) se Safari não entregar 4K60 ou readback/decoder impedir o orçamento, avançar para A. Não reescrever tudo antes de medir, mas também não encerrar o trabalho em 1080p30.

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


---

# Revisão técnica aprofundada: meta 4K60
Esta seção e o prompt final prevalecem sobre recomendações antigas deste documento que tratem 1080p30 como meta ou proponham manter DirectShow como destino definitivo.

## Inspeção do código real do InkTerminal

- `apps/webcam/app.js` declara perfis de envio, incluindo `2160p60` com limite nominal de 40 Mbps e `2160p30` com 25 Mbps.
- A captura iPhone usa `getUserMedia()` com `ideal` para largura, altura e FPS. O sucesso da Promise só confirma que alguma configuração foi concedida; o código deve registrar `track.getSettings()` e comparar width, height e frameRate reais.
- O sender configura `contentHint = "motion"`, `maxFramerate` e bitrate, mas isso não força a câmera a capturar no formato solicitado. Registrar também stats de quadros codificados/enviados, recebidos/decodificados, bitrate e dimensões.
- O receiver Windows usa `bombaApp`: Canvas de saída, `drawImage`, `getImageData`, cópia para `CoreWebView2SharedBuffer`; C# converte RGBA para BGR e chama `scSendFrame` do softcam.
- A UI nativa em `windows/webcam/Program.cs` oferece 1080p60, 1080p30, 720p60, 720p30 e 4K30; não oferece 4K60.
- `.github/workflows/webcam-windows.yml` compila executável e softcam, mas não faz benchmark 4K60 nem teste de câmera virtual com consumidor real.

## Hipótese A — maior teto: captura nativa iOS + WebRTC nativo + decode GPU/D3D11 + Media Foundation Virtual Camera

1. No iPhone, AVFoundation seleciona um formato de câmera que realmente suporte 3840×2160/60; VideoToolbox codifica H.264 por hardware. O app verifica e informa o formato ativo.
2. Cliente WebRTC nativo envia vídeo com timestamps, congestion control e feedback. A UI pode preservar QR/código de pareamento, mas a sinalização deve ser adaptada de forma explícita; não presumir compatibilidade automática com PeerJS.
3. No Windows, uma stack WebRTC nativa com decoder acelerado entrega superfícies D3D11 quando possível, evitando mapear cada quadro GPU para CPU.
4. Media Foundation Virtual Camera publica NV12 e media types exatos de resolução/FPS. Rotação, espelhamento e crop devem ocorrer na GPU; quando não há transformação, encaminhar sem conversão.
5. Filas limitadas, timestamps preservados, política latest-frame-wins e métricas de drops/idade. Só mostrar 4K60 ativo quando captura, sender, receiver e câmera virtual confirmarem esse modo.

**Vantagem:** maior teto de desempenho e controle do encoder/câmera no iPhone, além de acesso a superfícies GPU no Windows. **Custo:** maior reescrita e manutenção. Riscos: o iPhone pode não oferecer 4K60 em todos os modos; encoder, calor/bateria e Wi-Fi podem limitar sessões longas; nem todo consumidor enumera a câmera MF em 4K60; native não significa zero-copy por si só.

## Hipótese B — melhor caminho incremental: Safari/PeerJS + WebView2 + frames YUV + C++/libyuv + MF

1. Preservar pareamento atual e página iPhone. Pedir 4K60, consultar `getCapabilities()` quando disponível e registrar `getSettings()`; não anunciar 4K60 se browser/runtime conceder menos.
2. No WebView2, testar `MediaStreamTrackProcessor` num Dedicated Worker e `VideoFrame.copyTo()`. Medir decode, copyTo, IPC e entrega. Comparar decode software I420 contra hardware/GPU-backed NV12: hardware decode pode ser contraproducente se exigir readback.
3. Transferir I420 por buffer nativo limitado a C++/libyuv. Respeitar formato, offsets, strides, layout, colorimetria e timestamps; não presumir I420 contíguo.
4. Implementar MF Virtual Camera opt-in com NV12. Usar GPU para rotação/crop quando possível; manter DirectShow como fallback enquanto a matriz Zoom/Brave/Chrome/OBS não passar.
5. Feature detection e fallback para pipeline atual, sem reduzir silenciosamente resolução/FPS. Se browser não conceder 4K60, mostrar o modo efetivo e o bloqueio.

**Vantagem:** preserva PeerJS e a experiência web. Pode ser suficiente para 4K30 e, se captura e decode forem adequados, talvez 4K60. **Risco principal:** OmniCam relata que, no ambiente deles, navegadores de telefone só oferecem 60 fps abaixo de 1080p. Isso é um aviso concreto, não prova universal sobre todo iPhone/Safari; medir o dispositivo alvo é obrigatório.

## Teste teórico em Node.js — não é benchmark físico

O script `tools/webcam-4k60-sim.js` simula estágios em pipeline com fila limitada a um quadro mais recente. Executa em Node.js 22; não decodifica vídeo, não usa GPU e não cria câmera virtual.

Para 3840×2160/60:
- 8.294.400 pixels/quadro; 497.664.000 pixels/s.
- RGBA: 33.177.600 bytes/quadro, cerca de **1,991 GB/s por passagem**.
- I420/NV12: 12.441.600 bytes/quadro, cerca de **0,746 GB/s por passagem**.
- Isso não é bitrate de rede. É volume de memória por passagem; várias cópias multiplicam o custo.

Tempos abaixo são hipóteses de serviço para comparar sensibilidade, não medições:

| Cenário simulado | FPS de saída | Latência média | p95 | Interpretação |
|---|---:|---:|---:|---|
| Canvas/RGBA + IPC + BGR (28/4/12 ms) | ~35,7 | ~52,2 ms | ~63,6 ms | Canvas sozinho excede o orçamento de 16,67 ms. |
| Browser + I420 CPU + pipeline nativo/MF (3,2/2,5/5/1,5 ms) | ~60 | ~12,2 ms | ~15,3 ms | A matemática fecha se os tempos se confirmarem em hardware. |
| Browser com readback GPU 4K estimado em 48 ms + etapas posteriores | ~20 | >50 ms | alto | Extrapolação linear de ~12 ms em 1080p publicada por OmniCam; não é medição 4K. |
| WebRTC nativo + decode hardware/D3D11 + MF NV12 (1,5/3,5/2,5 ms) | ~60 | ~7,5 ms | ~9,6 ms | Maior margem teórica se as superfícies GPU funcionarem. |
| Mesmo caminho nativo com folga (2/4,5/3,5 ms) | ~60 | ~10 ms | ~12,5 ms | Folga teórica, ainda sem rede, aquecimento ou perdas reais. |

A simulação não prova que A atingirá 4K60. Mostra que um único readback de dezenas de milissegundos inviabiliza 60 fps; é necessário medir por estágio e substituir as hipóteses por percentis reais.

## Referências técnicas e discussões de implementação

1. OmniCam — implementação próxima (telefone/browser → WebRTC → virtual camera); lista 4K, mas relata 60 fps no browser de telefone apenas abaixo de 1080p no ambiente deles: https://github.com/Orest-Z/OmniCam
2. OmniCam ARCHITECTURE — medições de `VideoFrame.copyTo`, software I420 versus GPU-backed NV12 e crescimento de memória ao desenhar frames em Canvas/IMG: https://github.com/Orest-Z/OmniCam/blob/main/ARCHITECTURE.md
3. WebRTC sample — pedir resolução 4K via constraints, sem garantir que o hardware/runtime a conceda: https://webrtc.github.io/samples/src/content/getusermedia/resolution/
4. MDN `MediaStreamTrack.getSettings()` — configuração efetiva: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings
5. MDN constraints/capabilities — diferença entre ideal e obrigatório: https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Constraints
6. MDN `VideoFrame.copyTo()`: https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/copyTo
7. Chrome Developers — insertable MediaStreamTrack streams/VideoFrame: https://developer.chrome.com/docs/capabilities/web-apis/mediastreamtrack-insertable-media-processing?hl=pt-br
8. MDN `RTCRtpSender.getStats()`: https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/getStats
9. Microsoft `IMFVirtualCamera`: https://learn.microsoft.com/pt-br/windows/win32/api/mfvirtualcamera/nn-mfvirtualcamera-imfvirtualcamera
10. Microsoft Windows-Camera VirtualCamera sample: https://github.com/microsoft/Windows-Camera/tree/master/Samples/VirtualCamera
11. smourier VCamSample — Media Foundation source RGB32/NV12: https://github.com/smourier/VCamSample
12. OBS Studio issue #13559 — relato de uma câmera virtual cuja resolução máxima anunciada ao browser é menor que a capacidade observada por outra API. O caso é macOS, portanto ilustra o risco de negociação, não prova falha no Windows: https://github.com/obsproject/obs-studio/issues/13559
13. WebKit bug #179994 — discussão sobre constraints de resolução/FPS em Safari/WebKit: https://bugs.webkit.org/show_bug.cgi?id=179994
14. Microsoft AVStream driver samples: https://learn.microsoft.com/en-us/windows-hardware/drivers/samples/avstream-driver-samples
15. libdatachannel — biblioteca WebRTC nativa, sem decoder de vídeo integrado: https://libdatachannel.org/
16. Discussão do mantenedor libdatachannel #688 sobre transporte versus decoder: https://github.com/paullouisageneau/libdatachannel/issues/688
17. Discussão libdatachannel #1307 sobre bitrate/encoder: https://github.com/paullouisageneau/libdatachannel/discussions/1307
18. WebKit bug sobre custo de `getImageData`/GPU readback: https://bugs.webkit.org/show_bug.cgi?id=65622
19. Investigação técnica sobre `willReadFrequently`: https://www.schiener.io/2024-08-02/canvas-willreadfrequently
20. Recomendações de desempenho WebView2: https://learn.microsoft.com/pt-br/microsoft-edge/webview2/concepts/performance

## Ambiente de execução acessível e limites

- Executei localmente uma simulação determinística em Node.js 22.16.0; o script foi adicionado ao branch de pesquisa.
- Consultei os workflows associados ao commit da simulação; nenhum workflow foi iniciado para esse commit. O workflow Windows existente compila app/softcam em condições específicas, mas não executa benchmark 4K60 de câmera virtual.
- Não há neste ambiente iPhone físico, Windows 11 com GPU/Frame Server nem Zoom/Brave usando a câmera virtual. Não foi possível provar 4K60 real. Um runner CI Windows pode validar compilação e testes sintéticos, mas não substitui o teste físico ponta a ponta.

## Prompt final para o agente de código — provar antes de reescrever

> Trabalhe em branch isolada em `Inkterminal/Inkterminal.github.io`. Meta final: 3840×2160 a 60 fps sustentados de ponta a ponta; 1080p30 é apenas o piso.
>
> **Fase 1 — medir o existente:** instrumente captura, sender WebRTC, receiver, pipeline Windows e câmera. Registre `track.getSettings()`, dimensões/FPS efetivos, codec, bitrate, FPS codificado/enviado/recebido/decodificado/entregue, drops, idade do quadro, RTT/jitter/perda e p50/p95 por etapa. Não anuncie 4K60 se o navegador não o conceder.
>
> **Fase 2 — prova B de menor custo:** preserve QR/código, PeerJS, reconexão, seleção de câmera, perfis, rotação, mirror, fit/fill e fallback. Remova Canvas/`getImageData` da rota de produção. Teste `MediaStreamTrackProcessor`/Dedicated Worker e `VideoFrame.copyTo`; compare software I420 com hardware/GPU-backed NV12, pois readback GPU pode ser mais lento. Use C++/libyuv, buffers limitados e fila latest-frame-wins; respeite formato, stride, layout, colorimetria e timestamps. Implemente MF Virtual Camera opt-in em NV12, mantendo DirectShow como fallback até validar Zoom/Brave/Chrome/OBS.
>
> **Fase 3 — decidir com evidência:** se iPhone/Safari não conceder 3840×2160/60, ou se copyTo/readback/decoder/CPU impedir 60 fps, não tente resolver apenas com mais conversões C++. Faça experiência A separada: captura iOS nativa (AVFoundation + VideoToolbox), WebRTC nativo com sinalização compatível com o pareamento, receiver Windows com decoder acelerado/superfícies D3D11 e MF Virtual Camera NV12. Preserve QR/código e documente o custo de exigir app iOS.
>
> Acrescente testes sintéticos de formatos/layouts/strides, rotação, crop/fill, mudança de resolução, reconexão, perda e shutdown. CI compila Windows e executa testes. Teste físico por pelo menos 10 minutos em 4K60 com iPhone alvo e consumidor real: média ≥59 fps, p95 da idade do quadro <50 ms como alvo a validar, sem backlog/memória crescente ou throttling térmico progressivo, sem regressões. Teste 1080p30 como piso separadamente.
>
> Sem hardware real, declare “simulação/CI apenas”. Não faça merge automático nem troque o perfil padrão sem evidência. Mantenha licenças/avisos de dependências e não solicite etapas manuais ao usuário.

