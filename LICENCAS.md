# Licenças e uso comercial

Resumo para quem quiser usar o InkDOS Hub, ou partes dele, num projeto comercial (por exemplo, dentro do XeOS).
Não é parecer jurídico. Para um produto pago, vale confirmar com um advogado, sobretudo as partes GPL.

## Pode usar em projeto comercial (é só manter o aviso de copyright e a licença)

| Parte | Licença | Observação |
|---|---|---|
| Código do InkDOS Hub (páginas, players de Fotos, Vídeo e Música, editor de Fotos, extensão `inkfs`, `tools/linux/`) | MIT | arquivo `LICENSE` na raiz |
| Excalidraw (Quadro branco) | MIT | as fontes embutidas são OFL-1.1 ou MIT, que também permitem uso comercial |
| VS Code para web (Código) | MIT (código do VS Code, "Code - OSS") | veja "Cuidados" sobre o nome |
| mediainfo.js (leitura de dados do vídeo) | BSD-2-Clause | |
| Apps do InkDOS (`inkdos/`) | MIT | cópia sem mudanças; as bibliotecas que vêm junto têm as licenças em `inkdos/licenses/`. O botão "Editar com ArtCraft" abre os editores em `artcraft/` |
| v86 (emulador do terminal) | BSD-2-Clause | |
| xterm.js | MIT | |

## Pode usar, com obrigações extras (copyleft)

| Parte | Licença | O que precisa |
|---|---|---|
| Kernel Linux 6.6 | GPL-2.0 | oferecer o código-fonte correspondente. Usamos a tag `v6.6` sem mudanças, mais `tools/linux/kernel-extra.config` e `tools/linux/build.sh`, então basta apontar para eles |
| Programas do Alpine dentro da imagem (BusyBox, musl, apk-tools etc.) | GPL-2.0, MIT e outras | mesmo caso: são os pacotes oficiais do Alpine 3.22 sem mudanças, com o código-fonte público no Alpine |
| SeaBIOS / VGA BIOS | LGPL-3.0 | manter a licença (`terminal/bios/COPYING.LESSER`) e indicar onde está o código-fonte |
| Editores ArtCraft (`artcraft/`, páginas em `apps/wordcraft`, `apps/gridcraft`, `apps/deckcraft`) | MIT ou Apache-2.0 | baixados das releases web de github.com/storytold/{wordcraft,gridcraft,deckcraft} pela action `artcraft.yml`, sem mudanças; versões em `artcraft/versoes.txt`. |
| jschardet (dentro do VS Code) | LGPL-2.1 | manter a licença; o arquivo não foi alterado |
| ffmpeg.wasm 0.12.5 (`apps/video/cortar/ffmpeg-core/`, usado ao exportar) | GPL-2.0 ou posterior | oferecer o código-fonte: é o pacote `@ffmpeg/core@0.12.5` sem mudanças, com o código em https://github.com/ffmpegwasm/ffmpeg.wasm |
| FFmpeg dentro do web-demuxer e do ffprobe-wasm | LGPL-2.1 | manter a licença e indicar o código-fonte (pacotes npm sem mudanças) |

A GPL não "contamina" o resto do XeOS: o Linux roda como um programa separado dentro do emulador, o que conta como
agregação, e não como uma obra derivada.

## Cuidados

- **App Store:** se o XeOS for um app da App Store e passar a *embutir* o Linux (em vez de abrir a página
  https://inkdoshub.github.io/), as partes GPL podem entrar em conflito com os termos da Apple (foi o que aconteceu
  com o VLC em 2011). Abrir a página pela internet evita isso, porque nesse caso o app não distribui o código.
- **Nome "VS Code":** "Visual Studio Code" e o logotipo são marcas da Microsoft. Num produto comercial, chame de
  "Editor de código" (como o cartão já faz) e não use o logotipo. A loja de extensões configurada é a Open VSX, que é
  permitida. A loja da Microsoft não é permitida fora dos produtos dela.
- **Música:** o player antigo (Webamp, com o visual do Winamp) foi trocado por um player próprio, então a questão da
  marca "Winamp" deixou de existir.

## Onde estão os textos das licenças

- `apps/*/UPSTREAM-LICENSE.txt` e `apps/*/UPSTREAM-SOURCE.txt`
- `terminal/vendor/v86/LICENSE`, `terminal/vendor/xterm/LICENSE`, `terminal/bios/COPYING.LESSER`
- Kernel e Alpine: `build/` (como recompilar e de onde vem cada parte)
