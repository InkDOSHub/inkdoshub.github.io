# Legado: controle de memória entre páginas

Fora de uso desde 2026-10-17. Nada no site carrega estes arquivos; ficam só para consulta.

Era um controle que somava a memória estimada de todas as páginas abertas do InkTerminal (por um
`BroadcastChannel` e pela lista `inkterminal-paginas` no `localStorage`) e, quando uma página nova
passava do limite (2 GB e 4 páginas, por padrão), guardava a página parada há mais tempo: ela
gravava o próprio estado e virava `inicio/guardada.html`, que reabria o app com um toque.

Saiu porque no XeOS, que é um app próprio, o limite de memória depende do iOS e é bem mais largo
que o do Safari, e a soma estimada não batia com o Monitor de Atividade. Agora cada app abre na
própria aba e o sistema gerencia a memória, sem limite do site (veja `../inicio/README.md`,
"Abas e memória").

- `gerenciador-paginas.js`: a versão antiga de `assets/gerenciador-app.js`.
- `inicio-memoria.js`: a versão antiga de `inicio/inicio.js` (lista "Abertos" e painel de memória).
- `inicio-memoria.html`: os trechos da tela inicial que esses dois usavam.
- `../inicio/guardada.html` continua no lugar, para as abas que ficaram guardadas antes da troca.
