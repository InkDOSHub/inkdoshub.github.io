# InkTerminal

A tela inicial de ferramentas avançadas do [InkDOS](https://github.com/vfydr2m9wk-ops/InkDOS), feita para o iPad e o iPhone (Safari e XeOS). O InkDOS fica com os documentos e o InkTerminal com o resto.

**Abrir:** https://inkterminal.github.io/

| Cartão | Ferramenta (código aberto) | Pasta |
|---|---|---|
| Linux terminal | Alpine Linux 3.22 no [v86](https://github.com/copy/v86), feito aqui | `terminal/` |
| Fotos | Galeria e visualizador feitos aqui; **Editar** abre o [miniPaint](https://github.com/viliusle/miniPaint) (MIT) | `apps/foto/` (o miniPaint fica em `apps/foto/app/`) |
| Vídeo | Player nativo do Safari feito aqui; **Editar** abre o [omniclip](https://github.com/omni-media/omniclip) (MIT) copiado para cá | `apps/video/` (o omniclip fica em `apps/video/editor/`) |
| Código | [VS Code para web](https://github.com/Felx-B/vscode-web) (MIT), com uma pasta guardada no navegador | `apps/codigo/` |
| Quadro branco | [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT) | `apps/quadro/` |
| Música | Player feito aqui, com o `<audio>` do Safari, lista, equalizador de 10 faixas, volume extra, balanço e velocidade | `apps/musica/` |
| Wine | [Boxedwine](https://github.com/danoon2/Boxedwine) (GPL-2.0) com Wine 11: seus programas .exe, .msi e .zip, área de trabalho e o AbiWord | `apps/wine/` |
| Documentos, Planilhas, Apresentações, PDF, Texto simples, Leitor EPUB | Apps do [InkDOS](https://github.com/vfydr2m9wk-ops/InkDOS) (editores ONLYOFFICE), copiados para cá (`tools/copiar_inkdos.sh`); "Editar com ONLYOFFICE" abre os editores copiados em `onlyoffice/` | `inkdos/`, `onlyoffice/` |

Cada ferramenta abre na própria aba, só quando é pedida, e cuida da própria memória; há cópia offline (veja [inicio/README.md](inicio/README.md)).

Cada pasta tem `UPSTREAM-LICENSE.txt` e `UPSTREAM-SOURCE.txt`; o resumo de licenças e uso comercial está em [LICENCAS.md](LICENCAS.md). `tools/build_apps.sh` recria as ferramentas a partir das versões fixadas.

Fotos, Vídeo e Música seguem a mesma ideia: primeiro o visualizador nativo do Safari, e a edição como segunda opção. Os arquivos abertos ficam guardados no próprio navegador (IndexedDB deste site), neste aparelho, e nada é enviado. Tudo é servido por este site; nenhuma ferramenta abre outro site nem busca código em CDNs.

O editor de vídeo é o omniclip com todas as bibliotecas copiadas para `apps/video/editor/` (`tools/omniclip-build.mjs`): sem as estatísticas de uso (PostHog) do site original e sem as fontes do Google. Ele precisa de isolamento entre origens (SharedArrayBuffer), ligado pelo `coi-serviceworker.js` só dentro dessa pasta. O botão **Colaborar** do omniclip continua lá, mas usa um servidor de conexão de terceiros, só quando é tocado.

Todas as páginas usam a mesma barra e o mesmo tema claro/escuro do InkDOS (`assets/barra.css`, `assets/tema.js`); o tema se troca no botão da tela inicial.

## Linux terminal

- Roda Alpine Linux 3.22 com kernel Linux 6.6 (i386), emulado pelo [v86](https://github.com/copy/v86) em WebAssembly.
- Instala qualquer programa do Alpine com `apk add` (por exemplo `apk add python3 git nano`).
- Tem internet de verdade dentro do Linux, com http e https (veja "Rede" abaixo).
- A pasta `~/ipad` troca arquivos com o aparelho. **Enviar** coloca arquivos do iPad nela, e **Baixar** salva arquivos dela no app Arquivos.
- **Salvar** guarda a máquina inteira (arquivos, programas instalados e a pasta `~/ipad`) no navegador. Na próxima visita ela volta do mesmo ponto. **Reiniciar** apaga tudo e começa do zero.
- **Memória:** o botão alterna entre 256 MB (padrão, a sessão pode ser salva) e **640 MB + swap**. No segundo modo o Linux tem 640 MB de RAM, 192 MB de zram (memória comprimida) e 1 GB de swap num arquivo do armazenamento privado do site (OPFS), gravado aos pedaços por um worker (`terminal/swap-worker.js`) sem passar pela RAM da página. A aba fica abaixo de 1 GB mesmo com o Linux usando mais memória do que tem. Nesse modo a sessão não é salva, porque o swap recomeça a cada boot.
- Tem uma barra de teclas extras para o teclado do celular: Esc, Tab, Ctrl, setas, `|`, `/`, `-`, `~` e Ctrl+C.

### Rede

Igual aos outros emuladores de Linux no navegador (como o [copy.sh/v86](https://copy.sh/v86/)), o Linux sai para a internet por um servidor de rede público. Com isso funcionam `apk add` de qualquer pacote do Alpine, `http://`, `https://`, `git clone`, `pip install` e `ssh`.

| Opção | Como funciona |
|---|---|
| Rede: wisp (padrão) | Conexões TCP pelo servidor [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) público `wisps://wisp.mercurywork.shop/v86/` (o mesmo que o copy.sh/v86 oferece). Os nomes de sites são resolvidos por DNS-over-HTTPS da Cloudflare. |
| Rede: relay | Rede completa pelo relay público do v86 (`wss://relay.widgetry.org/`). Use se o wisp estiver fora do ar. |
| Sem rede | O Linux fica sem internet. |

Esses servidores são de terceiros e gratuitos, então podem ficar lentos ou fora do ar. A escolha fica guardada no navegador. Também dá para passar `?rede=wisp`, `?rede=relay`, `?rede=off` ou a URL `wss://`, `wisp://` ou `wisps://` de outro servidor.

### Parâmetros de URL (terminal/)

| Parâmetro | Efeito |
|---|---|
| `?embed=1` | Esconde a barra do topo (para usar dentro de um iframe no InkDOS) |
| `?fresh=1` | Ignora o estado salvo e liga do zero |
| `?font=18` | Muda o tamanho da fonte |
| `?rede=…` | Escolhe a rede (veja acima) |
| `?memoria=limitada` | Liga o modo 640 MB + swap (`?memoria=normal` volta para 256 MB) |

### Usar dentro de outra página

```html
<iframe src="https://inkterminal.github.io/terminal/?embed=1" style="width:100%;height:100%;border:0"></iframe>
```

### Limitações

- É emulação, então é bem mais lento que um computador de verdade. Instalar Python leva alguns minutos.
- O sistema fica na memória (256 MB). Programas instalados só continuam lá depois de tocar em **Salvar**.
- O estado salvo pesa de 20 a 100 MB, conforme o que estiver instalado.

### Estrutura

| Caminho | O que é |
|---|---|
| `terminal/index.html`, `app.js`, `style.css` | A página do terminal |
| `terminal/vendor/v86/` | Emulador v86 0.5.471 (licença BSD-2) |
| `terminal/vendor/xterm/` | xterm.js 6.0.0 + addon-fit (licença MIT) |
| `terminal/bios/` | SeaBIOS e VGA BIOS (LGPL-3) |
| `terminal/images/inkterminal-bzImage.bin` | Kernel Linux 6.6 com o Alpine embutido (GPL-2 e licenças do Alpine) |
| `build/` | Script e configurações para recompilar a imagem |

### Recompilar a imagem do Linux

Precisa de uma máquina Linux (ou um runner de CI) com `gcc make flex bison bc cpio libelf-dev git`:

```sh
./build/build.sh
```

O kernel vem de `torvalds/linux` na tag `v6.6`, sem modificações. O Alpine vem do minirootfs oficial x86 (`alpinelinux/docker-alpine`, branch `v3.22`), com o checksum conferido. Os arquivos próprios do InkTerminal ficam em `build/alpine-overlay/`.
