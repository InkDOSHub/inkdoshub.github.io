# 002 · Apps leves (2026-10-29)

**Lido:** `apps/foto/` (app, editor), `apps/video/` (app, cortar, cortar-worker), `apps/musica/` (app, gravar),
`apps/gravador/`, `apps/transferir/app.js`, `apps/editar-pdf/`, `apps/codigo/` (index, extensão inkfs).

## Mudanças feitas

1. **Erro corrigido em Vídeo e Música:** tocar no ✕ de um item da lista abria o item em vez de tirá-lo,
   quando o toque caía no desenho do ✕ (o teste olhava só o elemento exato). Agora usa `closest(".x")`.
2. **Transferir, segurança:**
   - a confirmação de quem quer conectar usava `confirm()`, que o XeOS bloqueia (a conexão seria sempre recusada
     ou aceita sem pergunta, conforme o navegador). Agora é uma caixa na própria página com "Recusar" e "Aceitar";
   - o código de pareamento passou de `Math.random()` para `crypto.getRandomValues()` (difícil de prever).
3. **Fotos:** os três `alert()` (bloqueados no XeOS) viraram mensagem na própria tela.
4. **Gravador, código morto:** desde 2026-10-28 a gravação vai sempre para Downloads, mas a escolha de pasta
   (File System Access, IndexedDB `inkdoshub-gravador`, escrita em partes) continuava no código, desligada por
   `temPasta = false`. Saíram cerca de 70 linhas e o botão escondido. O `"use strict"` estava depois de um comando
   e não valia; foi para o lugar certo.
5. **Página duplicada removida:** `apps/musica/gravar/index.html` era uma cópia antiga do Gravador sem nenhum link.
   Os scripts que o Gravador usa (`gravar.js`, `extrair-m4a.js`) foram para `apps/gravador/`.
6. **Funções repetidas viraram uma só** em `assets/midia.js`: `inkBaixar` (baixar arquivo, estava copiada em 6 lugares),
   `inkPartilhar` (compartilhar ou baixar, em 3 lugares) e `inkPainel`/`inkFecharPainel` (painel de progresso, igual
   no Vídeo e no editor de vídeo).
7. **Editar PDF:** o endereço das ferramentas era absoluto (`/visualizadores/...`) e quebraria fora da raiz do domínio; ficou relativo.
8. Textos novos "Accept" e "Decline" traduzidos nos 7 idiomas. Versões `?v=` atualizadas nas páginas alteradas.

## Achados sem mudança

- As listas do Vídeo e da Música são quase iguais (desenho, remover, guardar o último aberto). Dá para unir, mas o ganho é médio e o risco de mexer no visual também.
- Editar PDF tem os nomes das ferramentas principais só em português e inglês, fora do sistema de idiomas.
- Transferir usa o servidor público do PeerJS só para o pareamento; os arquivos vão direto entre os aparelhos. O código tem cerca de 30 bits e cada conexão nova precisa ser aceita na tela.
- Editor de código (`inkfs`): grava no IndexedDB do navegador, sem rede. Sem problemas.
- Não encontrei envio de arquivos para fora em nenhum desses apps.

## Commit

Ver `git log -- auditoria/002-apps-leves.md`.
