# Área de trabalho (desktop/)

Portal em forma de desktop para o iPad (Safari e XeOS): os apps do InkTerminal abrem em janelas na mesma aba, com barra de tarefas, gerenciador de memória e uma cópia offline completa.

**Abrir:** https://inkterminal.github.io/desktop/

## Janelas

- Menu **InkTerminal** (canto esquerdo) ou ícones da mesa abrem os apps. Cada app roda num iframe do próprio site; o InkDOS sempre abre numa aba nova (fica isolado no site dele).
- As janelas podem ser arrastadas pela barra, redimensionadas pelo canto, minimizadas e maximizadas (dois toques na barra). Em telas estreitas elas ficam sempre maximizadas.
- As janelas abertas ficam guardadas (`localStorage` `inkterminal-desktop`). Se a aba cair ou recarregar, a área de trabalho volta com as mesmas janelas; só a que estava em foco carrega, e as outras esperam um toque.

## Gerenciador de memória (`gerenciador.js`)

O Safari não deixa uma página mandar a própria memória para o disco, e o iPadOS fecha a aba quando ela passa do limite. Por isso o gerenciador controla janelas inteiras:

- Cada app tem um peso estimado em MB (`apps.js`). A soma dos apps carregados fica abaixo do **limite** (padrão 1 GB; o terminal no modo de memória limitada conta como ~900 MB) e do número máximo de **janelas carregadas** (padrão 3); os dois se ajustam no botão de memória do topo.
- Quando falta espaço, a janela parada há mais tempo é guardada: o iframe sai da página (o único jeito garantido de o Safari devolver a memória) e a janela mostra "Abrir de novo".
- Apps que salvam sozinhos (`salvaSozinho` em `apps.js`) são guardados sem perguntar. Os outros só depois de uma confirmação.
- Um app pode avisar que sabe guardar o próprio estado incluindo `assets/gerenciador-app.js` e chamando `inkGerenciador.aoGuardar(fn)`. Antes de descarregar, a área de trabalho manda `{tipo:"inkterminal:suspender"}`, espera `{tipo:"inkterminal:pronto"}` (até 3 s) e não pergunta mais nada.

Os pesos são estimativas: o Safari não informa quanta memória cada página usa.

## Cópia offline (`offline.js`, `../sw-portal.js`, `manifesto.json`)

- O botão **Offline** do topo mostra o que já está guardado e baixa tudo (área de trabalho, terminal e apps) para o cache do site. Só os arquivos novos ou alterados são baixados nas atualizações.
- O service worker `sw-portal.js` (escopo `/`, registrado só pela área de trabalho) usa a rede quando ela existe e a cópia quando não existe, então uma versão nova do site nunca se mistura com arquivos velhos.
- O editor de vídeo (omniclip) tem o service worker próprio dele (`coi-serviceworker`), que vence o do portal naquela pasta; por enquanto ele precisa de internet.
- `manifesto.json` é a lista de arquivos com tamanho e hash. Ele é recriado por `python3 tools/portal_manifesto.py`, e o workflow `.github/workflows/manifesto-offline.yml` faz isso sozinho a cada push no `main`.
