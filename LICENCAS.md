# Licenças e uso comercial

Resumo para quem quiser usar o InkTerminal, ou partes dele, num projeto comercial (por exemplo, dentro do XeOS).
Não é parecer jurídico. Para um produto pago, vale confirmar com um advogado, sobretudo as partes GPL.

## Pode usar em projeto comercial (é só manter o aviso de copyright e a licença)

| Parte | Licença | Observação |
|---|---|---|
| Código do InkTerminal (páginas, `app.js`, extensão `inkfs`, `build/`) | do próprio projeto | o repositório não traz um arquivo LICENSE; para outros reutilizarem, falta escolher uma (MIT, por exemplo) |
| miniPaint (Fotos) | MIT | |
| Excalidraw (Quadro branco) | MIT | as fontes embutidas são OFL-1.1 ou MIT, que também permitem uso comercial |
| Webamp (Música), código | MIT | veja "Cuidados" sobre a skin |
| VS Code para web (Código) | MIT (código do VS Code, "Code - OSS") | veja "Cuidados" sobre o nome |
| omniclip (Vídeo) | MIT | hoje só é um link para o site do projeto |
| v86 (emulador do terminal) | BSD-2-Clause | |
| xterm.js | MIT | |

## Pode usar, com obrigações extras (copyleft)

| Parte | Licença | O que precisa |
|---|---|---|
| Kernel Linux 6.6 | GPL-2.0 | oferecer o código-fonte correspondente. Usamos a tag `v6.6` sem mudanças, mais `build/kernel-extra.config` e `build/build.sh`, então basta apontar para eles |
| Programas do Alpine dentro da imagem (BusyBox, musl, apk-tools etc.) | GPL-2.0, MIT e outras | mesmo caso: são os pacotes oficiais do Alpine 3.22 sem mudanças, com o código-fonte público no Alpine |
| SeaBIOS / VGA BIOS | LGPL-3.0 | manter a licença (`terminal/bios/COPYING.LESSER`) e indicar onde está o código-fonte |
| jschardet (dentro do VS Code) | LGPL-2.1 | manter a licença; o arquivo não foi alterado |
| ffmpeg.wasm (usado pelo omniclip no site deles) | GPL-2.0 ou posterior | só importa se um dia o omniclip for hospedado aqui |

A GPL não "contamina" o resto do XeOS: o Linux roda como um programa separado dentro do emulador, o que conta como
agregação, e não como uma obra derivada.

## Cuidados

- **App Store:** se o XeOS for um app da App Store e passar a *embutir* o Linux (em vez de abrir a página
  https://inkterminal.github.io/), as partes GPL podem entrar em conflito com os termos da Apple (foi o que aconteceu
  com o VLC em 2011). Abrir a página pela internet evita isso, porque nesse caso o app não distribui o código.
- **Nome "VS Code":** "Visual Studio Code" e o logotipo são marcas da Microsoft. Num produto comercial, chame de
  "Editor de código" (como o cartão já faz) e não use o logotipo. A loja de extensões configurada é a Open VSX, que é
  permitida. A loja da Microsoft não é permitida fora dos produtos dela.
- **Skin do Webamp:** o código é MIT, mas a skin padrão reproduz o visual clássico do Winamp, e "Winamp" é marca de
  outra empresa. Para uso comercial, o mais seguro é trocar por uma skin com licença livre.
- **omniclip:** o site do projeto tem estatísticas de uso (PostHog). Isso não é um problema de licença, mas de
  privacidade, se o XeOS quiser prometer que nada sai do aparelho.

## Onde estão os textos das licenças

- `apps/*/UPSTREAM-LICENSE.txt` e `apps/*/UPSTREAM-SOURCE.txt`
- `terminal/vendor/v86/LICENSE`, `terminal/vendor/xterm/LICENSE`, `terminal/bios/COPYING.LESSER`
- Kernel e Alpine: `build/` (como recompilar e de onde vem cada parte)
