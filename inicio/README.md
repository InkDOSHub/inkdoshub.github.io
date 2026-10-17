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

## Controle de memória (`../assets/gerenciador-app.js`)

Cada página do site (tela inicial, ferramentas, apps do InkDOS, editor ONLYOFFICE) carrega
`assets/gerenciador-app.js`. As páginas se conhecem por um `BroadcastChannel` e pela lista
`inkterminal-paginas` no `localStorage`. O iPadOS fecha páginas quando a memória acaba; o controle
evita chegar lá e garante que o estado foi gravado antes:

- Cada app tem um peso estimado em MB (lista `APPS` no próprio arquivo). Quando uma página abre, ela
  soma o peso das outras páginas carregadas. Se passar do **limite** (padrão 2 GB) ou do número de
  **páginas carregadas** (padrão 4), a página parada há mais tempo e fora da tela é guardada: ela
  grava o estado e troca o conteúdo por `inicio/guardada.html` (quase sem memória), que reabre o app
  com um toque. Os dois valores ficam no botão de memória do topo (chave `inkterminal-paginas-memoria`;
  `inkterminal-memoria` é do terminal).
- Guardam sem perguntar: apps que salvam sozinhos (`salvaSozinho`), apps que registram
  `inkGerenciador.aoGuardar(fn)` (terminal, Fotos) e apps do InkDOS com rascunhos de recuperação
  ligados (sem senha), que gravam o rascunho antes e oferecem "Recuperar" ao reabrir.
- Os outros entram num aviso "Pouca memória" na página que acabou de abrir, com um botão para guardar
  cada um. Nada se perde sem confirmação.
- `aoGuardar(fn)`: a função grava o que precisar e devolve "pronto" (ou nada), ou `"manter"` /
  `{manter: "motivo"}` para continuar aberta. O prazo é de 20 s (o terminal grava a máquina inteira).
- Páginas em segundo plano que o iPad congelou não respondem: aparecem como "em segundo plano" e não
  contam na soma. O próprio iPad decide quando descartá-las.

Os pesos são estimativas: o Safari não informa quanta memória cada página usa.

## Cópia offline (`offline.js`, `../sw-portal.js`, `manifesto.json`)

- O botão **Offline** do topo mostra o que já está guardado e baixa tudo (tela inicial, terminal e ferramentas) para o cache do site. Só os arquivos novos ou alterados são baixados nas atualizações.
- O service worker `sw-portal.js` (escopo `/`, registrado pela tela inicial) usa a rede quando ela existe e a cópia quando não existe, então uma versão nova do site nunca se mistura com arquivos velhos.
- O editor de vídeo tem o service worker próprio dele (`coi-serviceworker`), que vence o do portal naquela pasta; por enquanto ele precisa de internet.
- `manifesto.json` é a lista de arquivos com tamanho e hash. Ele é recriado por `python3 tools/portal_manifesto.py`, e o workflow `.github/workflows/manifesto-offline.yml` faz isso sozinho a cada push no `main`.

## Wine (teste)

`apps/wine/` roda programas do Windows com o Boxedwine (emulador x86 compilado para WebAssembly, alvo
"jit" de uma thread só, então funciona sem modo isolado). O sistema do
Wine (~215 MB) fica em pedaços em `apps/wine/fs/` e `partes.js` junta as partes quando o emulador
pede o .zip. Precisa de exceções WebAssembly no formato novo (Safari 18.4+); a página testa isso
antes de liberar os botões. Pesa ~950 MB no controle de memória, então ao abrir ele guarda as
páginas paradas. Origem e licenças em `apps/wine/UPSTREAM-SOURCE.txt`.

## Editores ONLYOFFICE (`../onlyoffice/`)

"Editar com ONLYOFFICE" nos apps do InkDOS abre uma página nova no toque, guarda o documento no
IndexedDB `inkdos-tool-handoff` e leva essa página para `onlyoffice/editor.html`
(`InkPaginas.abrirEditor`, veja `tools/adaptar_inkdos.py`). O documento fica guardado (até 7 dias)
para o editor reabrir o mesmo arquivo se for recarregado. O Salvar do editor baixa o arquivo (no
iPad, o Safari pergunta onde guardar).
