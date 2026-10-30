# 015 · InkDOS Hub nativo para Windows, versão 0.1 (2026-10-30)

Pedido do Paulo: um InkDOS Hub para Windows que gaste menos CPU e memória que o site no navegador, sem o motor
web do Edge, com Linux e editor de código integrados ao Windows, atualização só do que mudou e downloads
conferidos e explicados. Ele foi feito depois das correções de hoje (logs 010, 011 e 013) e da revisão (014).

## Decisão técnica
Um motor HTML leve (Sciter, Ultralight, litehtml) não roda ONLYOFFICE, VS Code web, BentoPDF nem o Linux v86,
que são apps web pesados. Recompilar um motor completo não deixaria nada mais leve que o Edge. O ganho real vem de
trocar cada app web pelo programa nativo:

| No site (navegador) | No Windows (nativo) | Ganho esperado |
|---|---|---|
| Linux emulado (v86 em WebAssembly) | Alpine no WSL2 (virtualização do Windows) | Muito grande: CPU quase nativa em vez de emulada |
| VS Code web | VS Code (padrão) ou Zed (leve) | VS Code: pequeno (também usa Chromium). Zed: grande, nativo em Rust |
| ONLYOFFICE web | ONLYOFFICE Desktop | Moderado |
| BentoPDF (WebAssembly) | qpdf e Ghostscript | Grande: programas nativos de linha de comando |
| ffmpeg.wasm | ffmpeg nativo | Grande: várias vezes mais rápido |
| Tela inicial no navegador (aba do Edge, 150 a 300 MB) | Lançador WinForms (108 KB, cerca de 20 a 30 MB de RAM, CPU zero parado) | Grande |

Os números de RAM do lançador são estimativas para WinForms com .NET Framework, ainda não medidas num PC. A
medição real (Gerenciador de Tarefas, com o Hub aberto parado e com cada ferramenta aberta) fica como próximo
passo no PC do Paulo.

## O que foi feito
- `windows/hub/` (C#, .NET Framework 4.8, que já vem no Windows 10 e 11, sem admin): `Program.cs` (janela),
  `Ferramentas.cs` (catálogo, download, conferência, instalação), `Textos.cs` (português e inglês).
  - **Visual do Hub:** barra com "InkDOS Hub" e ☰, blocos das ferramentas, tema claro ou escuro igual ao do
    Windows. Nada abre caixa de diálogo: os cartões aparecem dentro da própria janela.
  - **Antes de baixar**, o cartão mostra de onde vem, quem publica, a licença, a versão, o tamanho do download, o
    espaço no disco (aproximado), o espaço livre no PC, o que a ferramenta acessa, como ela é conferida e o
    SHA-256.
  - **Conferência:** o SHA-256 do arquivo precisa bater com o catálogo. Quando o fabricante assina (Microsoft,
    Zed Industries, Ascensio/ONLYOFFICE, Artifex/Ghostscript), o Windows confere a assinatura (`WinVerifyTrust`)
    e o nome de quem assinou precisa ser o esperado. Se falhar, nada é instalado e o motivo aparece na tela.
  - **Linux:** liga o WSL (pede admin uma vez), importa o Alpine oficial (minirootfs, 3,7 MB) como
    `InkDOSHub-Alpine`, cria `~/windows` apontando para a pasta do usuário e abre no Windows Terminal, se houver.
  - **Código:** o VS Code portátil (zip oficial com a pasta `data`) é o padrão. O Zed pode ser escolhido no ☰.
  - **PDF:** juntar e girar com o qpdf e comprimir com o Ghostscript. **Cortar vídeo:** ffmpeg sem recompactar.
  - Webcam e Transferir: os apps do próprio Hub, conferidos pelo SHA-256 que a release publica.
  - "Mais apps" abre o site para o que continua web (fotos, música, gravador, quadro, documentos rápidos).
  - **☰:** ferramentas guardadas, com tamanho no disco, total e remoção com confirmação na janela; procurar
    atualizações, que baixa de novo só a ferramenta com versão nova; editor de código; segurança e privacidade.
  - **Atualização do próprio Hub:** compara o SHA-256 publicado na release `hub-windows`. Se for diferente, uma
    faixa "Atualização disponível · Atualizar" aparece. O .exe novo só entra se o hash bater.
- `tools/windows_ferramentas.py` gera `windows/ferramentas.json` a partir das fontes oficiais:
  - API do VS Code e lista do Alpine, que publicam o SHA-256;
  - "digest" das releases do GitHub (Zed, ONLYOFFICE, qpdf, Ghostscript, ffmpeg do Gyan Doshi);
  - `.sha256` das nossas releases.
  O catálogo vai dentro do .exe e é atualizado pelo site.
- `.github/workflows/windows-hub.yml`: toda semana e a cada mudança, atualiza o catálogo, compila e publica
  `InkDOSHub.exe` e o `.sha256` na release `hub-windows`.
- `windows/index.html`: o link de download entrou na página.

## Teste
- Compilado aqui com o .NET SDK 8 (net48, sem erros nem avisos). O .exe tem 108 KB.
- O catálogo foi gerado com Alpine, VS Code (364 MB, SHA-256 da Microsoft), Webcam e Transferir. As entradas do
  GitHub (Zed, ONLYOFFICE, qpdf, Ghostscript, ffmpeg) são preenchidas pela action, que tem acesso à API.
- Ainda não testado num Windows de verdade. A interface e os instaladores precisam do PC do Paulo.

## Pendências
- Medir RAM e CPU no PC e registrar aqui.
- Assinar o `InkDOSHub.exe` quando a SignPath aprovar.
- OCR (Tesseract) e MuPDF ainda não estão no catálogo.
