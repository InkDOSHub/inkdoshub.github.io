# Auditoria do código do InkDOS Hub

Revisão em partes do código próprio do Hub (código de terceiros em `visualizadores/`, `onlyoffice/` e
`apps/codigo/vscode/` fica de fora). Cada parte tem um log numerado com o que foi lido, o que foi
encontrado, o que mudou e o commit. O histórico do git prova cada mudança.

| Parte | Escopo | Log |
|---|---|---|
| 1 | Base: tela inicial, sw-portal.js, inicio/, assets/, terminal/, actions | [001-base.md](001-base.md) |
| 2 | Apps leves (foto, vídeo, música, gravador, transferir web, editar-pdf, código) | [002-apps-leves.md](002-apps-leves.md) |
| 3 | Webcam (web + Windows) | [003-webcam.md](003-webcam.md) |
| 4 | Transferir Windows | [004-transferir-windows.md](004-transferir-windows.md) |
| 5 | tools/ e actions | [005-tools.md](005-tools.md) |
| 6 | InkDOS (2 rodadas) | [006-inkdos-rodada1.md](006-inkdos-rodada1.md), [007-inkdos-rodada2.md](007-inkdos-rodada2.md) |
| 7 | Quadro | [008-quadro.md](008-quadro.md) |
| 8 | Ponte com os apps externos (Linux, Código, ONLYOFFICE, PDF) | [009-integracao.md](009-integracao.md) |

| — | Quadro: desenho salvo no IndexedDB | [010-quadro-indexeddb.md](010-quadro-indexeddb.md) |
| — | Modo Offline por app | [011-offline-por-app.md](011-offline-por-app.md) |
| — | Apresentações: tela cheia igual à edição | [013-apresentacao-tela-cheia.md](013-apresentacao-tela-cheia.md) |
| — | Revisão depois das mudanças de 2026-10-30 | [014-revisao-final.md](014-revisao-final.md) |

Log 015 (Windows) entra quando estiver pronto.

## Resumo (2026-10-29)

Todas as partes foram revisadas. Principais correções de segurança: confirmação do Transferir sem pop-up e com código imprevisível,
escape completo no Transferir Windows, prazo para conexões HTTP paradas, filtro dos webapps vindos de outra aba, filtro de pacotes
na sessão do Linux, remoção de origens apagadas (`inkdos-tools.github.io`, InkDOS antigo) da CSP e dos visualizadores e CSP nova no
Quadro (que bloqueia o CDN de fontes). Também saíram cerca de 2 mil linhas de código morto ou repetido, e foram corrigidos erros
visíveis (o ✕ das listas, o 404 em todo app do InkDOS, documentos do ONLYOFFICE apagados antes do prazo).

Pendências sugeridas (custam mais e esperam decisão): salvar o Quadro em IndexedDB (risco de perder desenho), completar as
traduções (243 textos por idioma), lockfile e `npm ci --ignore-scripts` no `build_apps.sh`, juntar os vendors repetidos do InkDOS
(cerca de 1 MB a menos na cópia offline), recompilar o Linux para valer o filtro do `inksessao` e assinar os `.exe`.
