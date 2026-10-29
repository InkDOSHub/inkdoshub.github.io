# 001 · Base (2026-10-29)

**Lido:** `index.html`, `sw-portal.js`, `inicio/` (inicio, lancador, meus-apps, offline, guardada),
`assets/` (gerenciador-app, sessao, tema, barra, icones, midia, início de idioma), trecho de `terminal/app.js`,
`.github/workflows/`.

## Mudanças feitas

1. **Código morto removido em `assets/gerenciador-app.js`:** o campo `peso` (memória estimada, nunca usada),
   `pesoDe`, `InkPaginas.peso`, `window.INK_APPS` e `window.inkGerenciador.aoGuardar` (não fazia nada).
2. **`terminal/app.js`:** saiu o bloco que registrava `aoGuardar` (nunca era chamado; o comentário dizia o contrário).
3. **Tela "app guardado" removida** (`inicio/guardada.html` e `.js`): nada abre mais essa página desde que
   o Hub deixou de descarregar apps; só sobrava uma checagem dela no gerenciador.
4. **`inicio/lancador.js`:** saiu `window.INK_ROTAS` (ninguém lê).
5. **Segurança, `inicio/meus-apps.js`:** ao recarregar os webapps por outra aba (evento `storage`), a lista
   agora passa pelo mesmo filtro `http(s)://` da carga inicial. Antes um valor diferente (ex. `javascript:`)
   poderia virar link de cartão.
6. **Comentários errados:** menções ao Wine (que não existe mais) em `lancador.js` e `sessao.js`.
7. **Versões `?v=` do `gerenciador-app.js` unificadas** em `v=10` nas 17 páginas (estavam entre 7 e 9).

## Achados sem mudança (baixo ganho ou risco)

- A função `t()` de reserva (sem `idioma.js`) está copiada em 5 arquivos. Dá para centralizar, mas o ganho é pequeno.
- `sw-portal.js` tem o `REPARO` de 2026-10-29 (conserto único da cópia offline). Pode sair daqui a algumas
  semanas, quando todas as cópias tiverem passado por ele.
- `assets/tema.js` migra chaves antigas `inkterminal-*` e `inicio.js` apaga chaves antigas a cada abertura. Custo quase nulo; podem sair no futuro.
- `inicio/offline.js`: se a atualização falha no meio, a cópia fica com arquivos novos e velhos misturados até a próxima tentativa
  (o aviso de atualização continua aparecendo). Aceitável; corrigir exigiria um segundo cache.
- Actions usam tags (`@v4`) em vez de hash fixo. Comum, mas fixar por hash é mais seguro contra troca de tag.
- Nenhum envio de dados para fora foi encontrado: os arquivos ficam em IndexedDB/cache do aparelho; `sessao.js`
  usa AES-GCM com PBKDF2 (310 mil rodadas).

## Commit

Ver `git log -- auditoria/001-base.md`.
