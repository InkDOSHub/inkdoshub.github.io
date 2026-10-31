# 006 · InkDOS, rodada 1 (2026-10-29)

**Lido:** `inkdos/shared/` (work-safety, ui-density), `runtime/platform/file-launch.js` dos 6 apps, `apps/pdf/ui/edit-pdf-button.js`,
`handoff.html` + `assets/handoff.js`, a estrutura de `apps/txt/`. As engines de documentos, planilhas e apresentações ficam para a rodada 2.

## Mudanças feitas

1. **`file-launch.js`: de 145 para 46 linhas, igual nos 6 apps.** Saíram o caminho para o antigo editor de escritório do site antigo
   (`inkdos-tools.github.io`, apagado), a camada em tela cheia que só ele usava, o botão "Editar com editor de escritório antigo" do topo (desligado
   desde 2026-10-28), a preparação do documento para ele e o `handOff` usado só pelo botão Editar PDF. Fica o que é usado: abrir
   arquivos, a fila do `launchQueue`, a entrega da tela inicial e o "Editar com editor de escritório antigo" do aviso de visualização, que usa o editor local.
2. **PDF:** `ui/edit-pdf-button.js` (118 linhas) era carregado em toda abertura, mas o botão não era mais instalado (as ferramentas de PDF ficam no app Editar PDF). Arquivo e `<script>` removidos.
3. **`inkdos/handoff.html` + `assets/handoff.js` removidos:** só eram usados pelo caminho acima. Além disso, apagavam
   do banco compartilhado `inkdos-tool-handoff` os documentos com mais de 1 dia, que o antigo editor de escritório guarda por 7 dias para poder recarregar.
4. **Mesmo problema na tela inicial (`inicio/lancador.js`):** ao entregar um Office ao antigo editor de escritório, também apagava as
   entregas com mais de 1 dia. Agora `gravar()` recebe o prazo em dias: 7 para o antigo editor de escritório, 1 para as outras.
5. **Erro 404 em toda abertura de app do InkDOS:** `shared/ui-density.js` registrava `inkdos/service-worker.js`, que nunca
   foi copiado (a cópia offline é a do Hub). O registro saiu.
6. **Texto (`apps/txt/`):** a página servida (`index.html`) traz todo o código embutido. As 23 cópias soltas (JS e CSS,
   cerca de 160 KB) não eram carregadas por nada e já tinham ficado diferentes da versão servida. Foram removidas; a fonte agora é o `index.html`.
7. `inkdos/UPSTREAM-SOURCE.txt` registra essas mudanças. Comentários de `gerenciador-app.js` e `inicio/README.md` apontam para o leitor certo (a pasta do antigo editor).

**Teste:** abri os 6 apps do InkDOS, a tela inicial e os apps leves num Chromium sem tela: nenhum erro de JavaScript nem 404. O PDF
abriu `4-artigo.pdf` normalmente.

## Segurança conferida (sem mudança)

- `shared/work-safety.js` (rascunhos de recuperação): AES-GCM 256 com chave não exportável gerada no navegador, ou, no modo
  com senha, PBKDF2-SHA-256 com 310 mil rodadas e sal aleatório; IV novo a cada gravação. Correto.
- As entregas entre páginas usam IndexedDB do próprio site, com id aleatório (`crypto.randomUUID`), e são apagadas depois de lidas.

## Achados sem mudança

- `jszip.min.js` está copiado em 4 apps, `pako_inflate.min.js` em 3 e `pdf-lib.min.js` (cerca de 500 KB) em 2. Juntar em
  `inkdos/shared/vendor/` deixaria a cópia offline cerca de 1 MB menor, mas mexe nos 6 apps. Fica como sugestão.
- `apps/*/ui/zoom-menu.css` é igual em 4 apps (pequeno).
- Os textos dos apps do InkDOS têm o próprio sistema de idiomas (`shared/localization/`), separado do Hub.

## Commit

Ver `git log -- auditoria/006-inkdos-rodada1.md`.
