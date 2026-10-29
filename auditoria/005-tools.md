# 005 · tools/ e actions (2026-10-29)

**Lido:** `tools/portal_manifesto.py` (roda na action com permissão de escrita), `tools/idiomas_textos.py`,
`tools/build_apps.sh`, `tools/linux/` (build do kernel, `init`, `inksessao`), `tools/README.md`, as 3 actions.
`tools/inkdos-tools/` é a receita antiga dos visualizadores (repositório apagado em 2026-10-29) e foi só conferida por cima.

## Mudanças feitas

1. **Referências a coisas que não existem mais:** `idiomas_textos.py` olhava pastas apagadas (`apps/wine/`, `apps/foto/app/`,
   `coi-serviceworker`, `idiomas-extra`); `portal_manifesto.py` tinha `FORA_PASTAS` vazio com comentário velho; a action do
   manifesto e as duas do Windows tinham uma condição para o espelho `vfydr2m9wk-ops/*`, que foi arquivado; os textos falavam do
   botão "Baixar tudo", que hoje se chama "Offline"; `gerenciador-app.js` e `inicio/README.md` apontavam para
   `tools/adaptar_inkdos.py`, que não existe (o certo é `inkdos/assets/handoff.js`).
2. **`inksessao` (Linux), segurança:** ao restaurar uma sessão, os nomes de pacote vindos do arquivo iam direto para o
   `apk add`. Um nome começando com `-` viraria opção do apk (ex.: `--allow-untrusted`). Agora só passam nomes válidos.
   O arquivo de sessão é da própria pessoa, cifrado com a senha dela, e roda numa máquina virtual no navegador, então o risco era
   baixo. **Vale só depois de recompilar o Linux** (`tools/linux/build.sh`), porque o script vai dentro da imagem.
3. **`tools/README.md`:** agora diz que `visualizadores/` é a fonte. A receita em `tools/inkdos-tools/` já não gera os
   mesmos arquivos (`bento-carry.js` e `docx/viewer.js` foram ajustados direto no site).
4. `tools/idiomas-textos.json` foi regerado (os caminhos acompanham a mudança do Gravador da parte 2).

## Achados sem mudança

- **Traduções incompletas:** de 508 textos, faltam 243 em cada idioma (146 no português), e 123 a 139 chaves sobram (são textos que não existem mais). Completar custa bastante (7 idiomas) e fica para quando o Paulo quiser.
- `build_apps.sh` fixa as versões principais, mas não tem lockfile (as dependências das dependências podem mudar) e o
  `npm i` roda scripts de instalação. Para um build reprodutível: guardar o `package-lock.json` e usar `npm ci --ignore-scripts`.
  Não mudei porque não dá para testar o build aqui sem gastar muito.
- `linux/build.sh` confere o Alpine pelo SHA-512 oficial e baixa o kernel por tag. Ok.
- As actions usam `@v4`/`@v2` (tags), não hash fixo. A publicação nas releases só acontece no `main`.
- `tools/inkdos-tools/.github/workflows/` não roda (só a pasta `.github` da raiz conta).

## Builds conferidos

As actions das partes 3 e 4 rodaram depois do push: `transferir-windows` passou. `webcam-windows` estava rodando quando esta parte começou.

## Commit

Ver `git log -- auditoria/005-tools.md`.
