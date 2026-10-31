# Tela inicial (index.html e inicio/)

A tela inicial do InkDOS Hub é o único ponto de entrada. Cada cartão abre a ferramenta, ou um app
do InkDOS (cópia em `inkdos/`, veja `inkdos/UPSTREAM-SOURCE.txt`), na própria página (aba ou janela).
Nada carrega antes de ser pedido.

A antiga área de trabalho (`desktop/`) foi juntada aqui em 2026-10-17: `desktop/` só redireciona
para a raiz.

## Páginas abertas

- Tocar num cartão abre o app numa página nova chamada `inkdoshub-<app>`. Tocar de novo volta para
  essa página em vez de abrir outra (`window.open("", nome)`). Se o navegador bloquear a página nova,
  o app abre na mesma.
- O botão "InkDOS Hub" da barra do app e o Home dos apps do InkDOS vão para a página da tela inicial
  (`inkdoshub-inicio`) sem fechar o app.

## Lançador de arquivos (`lancador.js`, `../manifest.webmanifest`)

Como a tela inicial do InkDOS original: com o InkDOS Hub instalado, o manifesto registra a tela
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
aberto volta para a aba dele (nome de janela `inkdoshub-<app>`). As abas não se coordenam: cada
app cuida da própria memória (o terminal, por exemplo, tem o botão de memória dele).

O site não aplica limite de memória: o sistema (iOS, XeOS, navegador) decide quais abas fecha.
Os pesos da lista `APPS` são só estimativas informativas.

## Cópia offline (`offline.js`, `../sw-portal.js`, `manifesto.json`)

- O botão **Offline** do topo mostra o que já está guardado e baixa tudo (tela inicial, terminal e ferramentas) para o cache do site. Só os arquivos novos ou alterados são baixados nas atualizações.
- O service worker `sw-portal.js` (escopo `/`, registrado pela tela inicial) usa a rede quando ela existe e a cópia quando não existe, então uma versão nova do site nunca se mistura com arquivos velhos.
- O editor de vídeo tem o service worker próprio dele (`coi-serviceworker`), que vence o do portal naquela pasta; por enquanto ele precisa de internet.
- `manifesto.json` é a lista de arquivos com tamanho e hash. Ele é recriado por `python3 tools/portal_manifesto.py`, e o workflow `.github/workflows/manifesto-offline.yml` faz isso sozinho a cada push no `main`.

## Sessão em arquivo (`../assets/sessao.js`)

O botão **Sessão** do Linux guarda o trabalho num arquivo `.inksessao` no aparelho (Arquivos,
iCloud Drive), para recuperar mesmo se o site apagar os dados. Sempre com senha: AES-GCM com chave
PBKDF2-SHA256 (310 mil rodadas); sem a senha o arquivo não abre. A entrega usa a folha de compartilhar do
iOS ("Salvar em Arquivos") ou um download.

- **Linux** (`../terminal/app.js`): guarda a receita, não a memória. O `inksessao` do Linux
  (`../tools/linux/alpine-overlay/usr/local/sbin/inksessao`, ligado pelo `init`) faz um .tar.gz com
  `etc/apk/world`, os repositórios, `/root` (sem `~/files` e `~/.cache`), `/home` e `/usr/local`. Para abrir,
  instala pela internet os pacotes que faltam (`apk add`) e põe os arquivos de volta. A conversa é pela
  pasta `/mnt/ipad/.inkdoshub` (`pedido`, `estado`). Num Linux restaurado de um Salvar antigo, sem o
  `inksessao`, a página manda o programa pela pasta e digita o comando que o liga (pede antes).

## Editores ArtCraft (`../artcraft/`, `../apps/*craft/`)

WordCraft, GridCraft e DeckCraft (ArtCraft, MIT/Apache-2.0) vêm compilados das releases web pela
action `.github/workflows/artcraft.yml` (toda segunda e manual). "Editar com ArtCraft" nos apps do
InkDOS e a preferência "ArtCraft completo" do ☰ guardam o documento no IndexedDB
`inkdos-tool-handoff` e abrem `apps/<editor>/?inkdos-handoff=<id>`; `assets/artcraft-host.js` entrega
o arquivo ao editor (ponte postMessage `?host=parent` no WordCraft e GridCraft; arrastar-e-soltar
simulado no DeckCraft). Salvar baixa o arquivo.

## Botão "Abrir arquivo" (`lancador.js`)

- **Abrir arquivo** (topo da tela inicial): abre o seletor do sistema (no iPhone, o app Arquivos), qualquer
  tipo, e manda o arquivo para o app certo pela mesma tabela acima. Sem limite de tamanho.
