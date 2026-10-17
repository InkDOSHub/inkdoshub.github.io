# Tela inicial (index.html e inicio/)

A tela inicial do InkTerminal é o único ponto de entrada. As ferramentas abrem em tela cheia
dentro dela; os documentos do InkDOS abrem numa aba nova, no site do InkDOS.

A antiga área de trabalho (`desktop/`) foi juntada aqui em 2026-10-17: `desktop/` só redireciona
para a raiz.

## Apps abertos

- Tocar num cartão abre a ferramenta em tela cheia, num iframe do próprio site (`inicio/inicio.js`).
- O botão "InkTerminal" da barra do app, ou o gesto de voltar do Safari, volta para a tela inicial
  sem fechar o app. Ele aparece em **Abertos**, com o botão de fechar.
- Os apps abertos ficam guardados (`localStorage` `inkterminal-inicio`). Se a aba cair ou recarregar,
  eles voltam como "guardado" e só carregam quando tocados.
- O editor de vídeo (omniclip) precisa do modo isolado do navegador, então dentro da tela inicial
  ele abre numa aba própria.

## Gerenciador de memória (`gerenciador.js`)

O Safari não deixa uma página mandar a própria memória para o disco, e o iPadOS fecha a aba quando ela passa do limite. Por isso o gerenciador controla apps inteiros:

- Cada app tem um peso estimado em MB (`apps.js`). A soma dos apps carregados fica abaixo do **limite** (padrão 1 GB; o terminal no modo de memória limitada conta como ~900 MB, o Wine como ~950 MB) e do número máximo de **apps carregados** (padrão 3); os dois se ajustam no botão de memória do topo (chave `inkterminal-desktop-memoria`; a `inkterminal-memoria` é do terminal).
- Quando falta espaço, o app parado há mais tempo é guardado: o iframe sai da página (o único jeito garantido de o Safari devolver a memória).
- Apps que salvam sozinhos (`salvaSozinho` em `apps.js`) são guardados sem perguntar. Os outros só depois de uma confirmação.
- Um app pode avisar que sabe guardar o próprio estado incluindo `assets/gerenciador-app.js` e chamando `inkGerenciador.aoGuardar(fn)`. Antes de descarregar, a tela inicial manda `{tipo:"inkterminal:suspender"}`, espera `{tipo:"inkterminal:pronto"}` (até 20 s) e não pergunta mais nada. Se o app responder `{tipo:"inkterminal:manter", motivo}`, ele fica carregado; ao fechar, a pessoa vê o motivo e decide.

Os pesos são estimativas: o Safari não informa quanta memória cada página usa. Os documentos do
InkDOS ficam em outra aba e não entram na conta.

## Cópia offline (`offline.js`, `../sw-portal.js`, `manifesto.json`)

- O botão **Offline** do topo mostra o que já está guardado e baixa tudo (tela inicial, terminal e ferramentas) para o cache do site. Só os arquivos novos ou alterados são baixados nas atualizações.
- O service worker `sw-portal.js` (escopo `/`, registrado pela tela inicial) usa a rede quando ela existe e a cópia quando não existe, então uma versão nova do site nunca se mistura com arquivos velhos.
- O editor de vídeo tem o service worker próprio dele (`coi-serviceworker`), que vence o do portal naquela pasta; por enquanto ele precisa de internet.
- `manifesto.json` é a lista de arquivos com tamanho e hash. Ele é recriado por `python3 tools/portal_manifesto.py`, e o workflow `.github/workflows/manifesto-offline.yml` faz isso sozinho a cada push no `main`.

## Wine (teste)

`apps/wine/` roda programas do Windows com o Boxedwine (emulador x86 compilado para WebAssembly, alvo
"jit" de uma thread só, então funciona dentro da tela inicial sem modo isolado). O sistema do
Wine (~215 MB) fica em pedaços em `apps/wine/fs/` e `partes.js` junta as partes quando o emulador
pede o .zip. Precisa de exceções WebAssembly no formato novo (Safari 18.4+); a página testa isso
antes de liberar os botões. Pesa ~950 MB no gerenciador de memória, então ao abrir ele guarda os
outros apps. Origem e licenças em `apps/wine/UPSTREAM-SOURCE.txt`.
