# 001 · Base (2026-10-29)

**Read:** `index.html`, `sw-portal.js`, `inicio/` (inicio, lancador, meus-apps, offline, guardada),
`assets/` (gerenciador-app, sessao, tema, barra, icones, midia, start of idioma), part of `terminal/app.js`,
`.github/workflows/`.

## Changes made

1. **Dead code removed from `assets/gerenciador-app.js`:** the `peso` field (estimated memory, never used),
   `pesoDe`, `InkPaginas.peso`, `window.INK_APPS` and `window.inkGerenciador.aoGuardar` (did nothing).
2. **`terminal/app.js`:** removed the block that registered `aoGuardar` (never called; the comment said otherwise).
3. **"Stored app" screen removed** (`inicio/guardada.html` and `.js`): nothing opens that page since
   the Hub stopped unloading apps; only a check for it remained in the manager.
4. **`inicio/lancador.js`:** removed `window.INK_ROTAS` (nobody reads it).
5. **Security, `inicio/meus-apps.js`:** when reloading webapps from another tab (`storage` event), the list
   now goes through the same `http(s)://` filter as the initial load. Before, a different value (e.g. `javascript:`)
   could become a card link.
6. **Wrong comments:** mentions of Wine (which no longer exists) in `lancador.js` and `sessao.js`.
7. **`?v=` versions of `gerenciador-app.js` unified** at `v=10` in the 17 pages (they ranged from 7 to 9).

## Findings without change (low gain or risk)

- The fallback `t()` function (without `idioma.js`) is copied in 5 files. It could be centralized, but the gain is small.
- `sw-portal.js` has the 2026-10-29 `REPARO` (one-time fix of the offline copy). It can go in a few
  weeks, once every copy has gone through it.
- `assets/tema.js` migrates old `inkterminal-*` keys and `inicio.js` deletes old keys on every open. Near-zero cost; can go later.
- `inicio/offline.js`: if an update fails midway, the copy has new and old files mixed until the next attempt
  (the update notice keeps showing). Acceptable; fixing it would need a second cache.
- Actions use tags (`@v4`) instead of a pinned hash. Common, but pinning by hash is safer against tag swaps.
- No data sent outside was found: files stay in the device IndexedDB/cache; `sessao.js`
  uses AES-GCM with PBKDF2 (310 thousand rounds).

## Commit

See `git log -- auditoria/001-base.md`.
