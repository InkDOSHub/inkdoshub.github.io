# 003 · Webcam (2026-10-29)

**Lido:** `apps/webcam/app.js` (Host no iPhone, Guest no PC, envio para a câmera virtual), `apps/webcam/index.html`,
`windows/webcam/Program.cs` (janela, WebView2, câmera virtual), trechos de segurança de `windows/webcam/Nativo.cs`
(receptor GStreamer). `apps/webcam/lib/` (qrcode, PeerJS) é de terceiros.

## Mudanças feitas

1. **Guest:** o fim da chamada (o iPhone saiu) e o "parar transmissão" do PC repetiam as mesmas 8 linhas de
   limpeza da tela. Agora as duas usam `semChamada(msg)`.
2. **Host:** o `pagehide` repetia, linha por linha, o que `pararLocal()` já faz. Agora chama `pararLocal()`.
3. **`Program.cs`:** a resposta "ok" de cada quadro repetia o envio para a página em vez de usar `ParaPagina()`.
4. `?v=` do `app.js` atualizado.

## Segurança conferida (sem mudança)

- O código de pareamento tem 10 caracteres de `crypto.getRandomValues` (cerca de 50 bits). O Guest recusa uma
  segunda chamada enquanto há uma conectada e valida o `metadata` recebido (codec numa lista, bitrate entre 1 e 40 Mbps, formato numa lista).
- O Host só aceita comandos (`stop`, `restart`, `quality`) vindos do Guest com o código digitado, e a qualidade pedida
  só pode ser uma das 6 da lista.
- App de Windows: o WebView2 só navega e só aceita mensagens de `https://inkdoshub.github.io/apps/webcam/`; janelas novas
  são bloqueadas; DevTools desligado. As mensagens `frame:` têm posição e tamanho conferidos antes de ler a memória
  (`Sw*Sh <= W*H`, posição menor que o número de slots), então a página não consegue fazer o app ler fora do buffer.
- O registro da câmera virtual pede administrador só para `--registrar` (UAC do Windows).
- Vídeo vai direto entre os aparelhos (WebRTC). O servidor público do PeerJS só faz o pareamento.

## Achados sem mudança

- A reconexão ao servidor de pareamento (`tentarReconectar`) está escrita duas vezes (Guest e Host), com pequenas diferenças. Unir exige teste no iPhone.
- O painel "Diagnóstico" tem textos fixos em português, fora do sistema de idiomas (é uma ferramenta de suporte).
- `Nativo.cs` tem um leitor de JSON próprio (o .NET Framework 4.8 não traz um). Ele só lê mensagens do servidor do PeerJS. Aceitável.
- O app `.exe` continua sem assinatura digital (adiado em 2026-10-24).

## Commit

Ver `git log -- auditoria/003-webcam.md`. O build do Windows roda sozinho na action `webcam-windows`.
