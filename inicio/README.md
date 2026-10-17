# Tela inicial (index.html e inicio/)

A tela inicial do InkTerminal é o único ponto de entrada. Cada cartão abre a ferramenta, ou um app
do InkDOS (cópia em `inkdos/`, veja `inkdos/UPSTREAM-SOURCE.txt`), na própria página (aba ou janela).
Nada carrega antes de ser pedido.

A antiga área de trabalho (`desktop/`) foi juntada aqui em 2026-10-17: `desktop/` só redireciona
para a raiz.

## Páginas abertas

- Tocar num cartão abre o app numa página nova chamada `inkterminal-<app>`. Tocar de novo volta para
  essa página em vez de abrir outra (`window.open("", nome)`). Se o navegador bloquear a página nova,
  o app abre na mesma.
- O botão "InkTerminal" da barra do app e o Home dos apps do InkDOS vão para a página da tela inicial
  (`inkterminal-inicio`) sem fechar o app.
- **Abertos** mostra as páginas abertas; o X fecha a página (o navegador só deixa fechar as que a
  tela inicial abriu; as outras viram a tela inicial).

## Lançador de arquivos (`lancador.js`, `../manifest.webmanifest`)

Como a tela inicial do InkDOS original: com o InkTerminal instalado, o manifesto registra a tela
inicial para os tipos de arquivo dos apps (`file_handlers`, ação `./`). Abrir um arquivo no XeOS manda
o arquivo para ela (`launchQueue`), e ela escolhe o app pela extensão:

| App | Extensões |
|---|---|
| Documentos | docx, rtf, doc, odt, pages |
| Planilhas | xlsx, xls, csv, tsv, ods, numbers |
| Apresentações | pptx, ppt, odp, key |
| PDF | pdf |
| Leitor EPUB | epub |
| Texto simples | txt, md, log, ini, json, xml, yaml e parecidos |
| Fotos | jpg, png, gif, webp, heic, avif, svg e outras imagens |
| Vídeo | mp4, mov, m4v, webm, mkv |
| Música | mp3, m4a, aac, wav, ogg, flac, opus |
| Código | js, ts, py, html, css, c, cpp, java, rs, go, sh, sql e outras linguagens |

Um arquivo (ou vários do mesmo app de mídia ou do Código) abre o app nesta mesma página. Arquivos
de apps diferentes aparecem em "Arquivos recebidos", com um botão para cada app. A lista de extensões fica em
`ROTAS` (lancador.js); o manifesto tem que ter as mesmas.

## Abas e memória (`../assets/gerenciador-app.js`)

Cada ferramenta abre na própria aba, só quando é pedida. Tocar num cartão de um app que já está
aberto volta para a aba dele (nome de janela `inkterminal-<app>`). As abas não se coordenam: cada
app cuida da própria memória (o terminal, por exemplo, tem o botão de memória dele).

O site não aplica limite de memória: o sistema (iOS, XeOS, navegador) decide quais abas fecha.
Os pesos da lista `APPS` são só estimativas informativas.

O controle anterior, que somava a memória de todas as páginas abertas e guardava as paradas, está
em `../legado/`, fora de uso.

## Cópia offline (`offline.js`, `../sw-portal.js`, `manifesto.json`)

- O botão **Offline** do topo mostra o que já está guardado e baixa tudo (tela inicial, terminal e ferramentas) para o cache do site. Só os arquivos novos ou alterados são baixados nas atualizações.
- O service worker `sw-portal.js` (escopo `/`, registrado pela tela inicial) usa a rede quando ela existe e a cópia quando não existe, então uma versão nova do site nunca se mistura com arquivos velhos.
- O editor de vídeo tem o service worker próprio dele (`coi-serviceworker`), que vence o do portal naquela pasta; por enquanto ele precisa de internet.
- `manifesto.json` é a lista de arquivos com tamanho e hash. Ele é recriado por `python3 tools/portal_manifesto.py`, e o workflow `.github/workflows/manifesto-offline.yml` faz isso sozinho a cada push no `main`.

## Wine (`../apps/wine/`)

Roda programas do Windows com o Boxedwine (emulador x86 compilado para WebAssembly, alvo "jit" de
uma thread só, então funciona sem modo isolado). O sistema do Wine (~215 MB) fica em pedaços em
`apps/wine/fs/`, e `partes.js` junta as partes e guarda no Cache Storage. Precisa de exceções
WebAssembly no formato novo (Safari 18.4+). Pesa ~950 MB.

- Todos os programas usam os mesmos discos (`storageKey=default`): o C: guarda o que for instalado
  e o D: guarda arquivos e programas da pessoa, os dois no IndexedDB do site.
- **Adicionar programa** (`wine.js`): um .exe, .msi ou .zip vai para o IndexedDB `inkterminal-wine`
  (loja `entrada`). O emulador (`inkterminal-wine.js`) grava em `D:\Programas\<pasta>` (extrai o
  .zip), apaga a entrada e abre o programa. A lista "Meus programas" fica no localStorage
  `inkterminal-wine-meus` e abre direto do D: depois.
- **Área de trabalho**: o Wine sem programa abre `explorer /desktop=shell`, com menu Iniciar.
- No iPad: **Teclado** foca um campo escondido dentro do emulador (o iPad mostra o teclado e as
  teclas chegam ao SDL), **Clique direito** faz o próximo toque valer como botão direito (segurar o
  dedo meio segundo também), **Enviar para D:** e **Baixar de D:** trocam arquivos com o aparelho.
- A tela inicial manda .exe e .msi para cá (`#ink-arquivos`, o mesmo caminho de Fotos e Música).

Origem e licenças em `apps/wine/UPSTREAM-SOURCE.txt`.

## Editores ONLYOFFICE (`../onlyoffice/`)

"Editar com ONLYOFFICE" nos apps do InkDOS abre uma página nova no toque, guarda o documento no
IndexedDB `inkdos-tool-handoff` e leva essa página para `onlyoffice/editor.html`
(`InkPaginas.abrirEditor`, veja `tools/adaptar_inkdos.py`). O documento fica guardado (até 7 dias)
para o editor reabrir o mesmo arquivo se for recarregado. O Salvar do editor baixa o arquivo (no
iPad, o Safari pergunta onde guardar).
