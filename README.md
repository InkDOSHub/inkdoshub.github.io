# InkTerminal

Um terminal Linux de verdade que roda inteiro no navegador. Foi pensado para o iPad e o iPhone (Safari) e para ser usado dentro do [InkDOS](https://github.com/vfydr2m9wk-ops/InkDOS).

**Abrir:** https://inkterminal.github.io/

- Roda Alpine Linux 3.22 com kernel Linux 6.6 (i386), emulado pelo [v86](https://github.com/copy/v86) em WebAssembly.
- Instala qualquer programa do Alpine com `apk add` (por exemplo `apk add python3 git nano`).
- Tem internet de verdade dentro do Linux, com http e https (veja "Rede" abaixo).
- A pasta `~/ipad` troca arquivos com o aparelho. **Enviar** coloca arquivos do iPad nela, e **Baixar** salva arquivos dela no app Arquivos.
- **Salvar** guarda a máquina inteira (arquivos, programas instalados e a pasta `~/ipad`) no navegador. Na próxima visita ela volta do mesmo ponto. **Reiniciar** apaga tudo e começa do zero.
- Tem uma barra de teclas extras para o teclado do celular: Esc, Tab, Ctrl, setas, `|`, `/`, `-`, `~` e Ctrl+C.

## Rede

Igual aos outros emuladores de Linux no navegador (como o [copy.sh/v86](https://copy.sh/v86/)), o Linux sai para a internet por um servidor de rede público. Com isso funcionam `apk add` de qualquer pacote do Alpine, `http://`, `https://`, `git clone`, `pip install` e `ssh`.

| Opção | Como funciona |
|---|---|
| Rede: wisp (padrão) | Conexões TCP pelo servidor [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) público `wisps://wisp.mercurywork.shop/v86/` (o mesmo que o copy.sh/v86 oferece). Os nomes de sites são resolvidos por DNS-over-HTTPS da Cloudflare. |
| Rede: relay | Rede completa pelo relay público do v86 (`wss://relay.widgetry.org/`). Use se o wisp estiver fora do ar. |
| Sem rede | O Linux fica sem internet. |

Esses servidores são de terceiros e gratuitos, então podem ficar lentos ou fora do ar. A escolha fica guardada no navegador. Também dá para passar `?rede=wisp`, `?rede=relay`, `?rede=off` ou a URL `wss://`, `wisp://` ou `wisps://` de outro servidor.

## Parâmetros de URL

| Parâmetro | Efeito |
|---|---|
| `?embed=1` | Esconde a barra do topo (para usar dentro de um iframe no InkDOS) |
| `?fresh=1` | Ignora o estado salvo e liga do zero |
| `?font=18` | Muda o tamanho da fonte |
| `?rede=…` | Escolhe a rede (veja acima) |

## Usar dentro do InkDOS

```html
<iframe src="https://inkterminal.github.io/?embed=1" style="width:100%;height:100%;border:0"></iframe>
```

## Limitações

- É emulação, então é bem mais lento que um computador de verdade. Instalar Python leva alguns minutos.
- O sistema fica na memória (256 MB). Programas instalados só continuam lá depois de tocar em **Salvar**.
- O estado salvo pesa de 20 a 100 MB, conforme o que estiver instalado.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html`, `app.js`, `style.css` | A página do terminal |
| `vendor/v86/` | Emulador v86 0.5.471 (licença BSD-2) |
| `vendor/xterm/` | xterm.js 6.0.0 + addon-fit (licença MIT) |
| `bios/` | SeaBIOS e VGA BIOS (LGPL-3) |
| `images/inkterminal-bzImage.bin` | Kernel Linux 6.6 com o Alpine embutido (GPL-2 e licenças do Alpine) |
| `build/` | Script e configurações para recompilar a imagem |

## Recompilar a imagem do Linux

Precisa de uma máquina Linux (ou um runner de CI) com `gcc make flex bison bc cpio libelf-dev git`:

```sh
./build/build.sh
```

O kernel vem de `torvalds/linux` na tag `v6.6`, sem modificações. O Alpine vem do minirootfs oficial x86 (`alpinelinux/docker-alpine`, branch `v3.22`), com o checksum conferido. Os arquivos próprios do InkTerminal ficam em `build/alpine-overlay/`.
