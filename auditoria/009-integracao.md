# 009 · Parte 8: ponte com os apps externos (2026-10-29)

Escopo: o código do Hub que liga os apps de terceiros ao resto do site. O código dos próprios projetos
(v86/Linux, VS Code web, editor de escritório antigo, BentoPDF, PDF.js, pnk, WebODF) não foi revisado linha a linha.

## Lido
- Linux: `terminal/app.js` (inteiro), `terminal/swap-worker.js`.
- Código: `apps/codigo/index.html`, `editor.html`, `ext/inkfs/extension.js`.
- editor de escritório antigo: a pasta do antigo editor, `inkdos-handoff.js`, `editor-inkdos.js`, `sw.js`, `shared/work-safety.js`.
- PDF e visualizadores: `visualizadores/viewers/` (bento-carry, download-fallback, file-handoff, pnk-embed, viewer-embed, viewer-theme).

## Encontrado e corrigido
1. **Linux aceitava qualquer servidor de rede pelo link.** `terminal/?rede=wss://outro-servidor/` mandava todo o
   tráfego do Linux para o endereço do link. Agora só valem os nomes `wisp`, `relay` e `off`; o resto cai em `wisp`.
   O texto "rede personalizada" do botão saiu. `app.js?v=12`.
2. **Origem antiga na CSP do antigo editor de escritório.** 23 páginas (a pasta do antigo editor e a pasta do antigo editor) ainda
   permitiam frames de `https://vfydr2m9wk-ops.github.io`, um repositório que vai ser apagado. Removida.

## Verificado e sem mudança
- Entregas de arquivo pelo IndexedDB (Código, editor de escritório antigo, visualizadores): são apagadas na leitura e têm prazo.
- `bento-carry.js` só aceita mensagens da própria origem e do frame que abriu. Os `innerHTML` são textos fixos.
- `work-safety.js` do antigo editor de escritório difere do InkDOS só na detecção do tema escuro (normal).
- A sessão do Linux usa a pasta 9p e o filtro de pacotes já corrigido na parte 5 (`005-tools.md`).

## Servidores de terceiros (para transparência)
Teste: Playwright abrindo cada página por 8 s e listando os servidores contatados.

| App | Servidor externo | Para quê |
|---|---|---|
| Linux | `wisp.mercurywork.shop` (padrão) ou `relay.widgetry.org` | Internet do Linux. É um servidor público de terceiros: o tráfego do Linux passa por ele. Dá para desligar em "Rede: sem rede". |
| Código | `*.vscode-cdn.net` (Microsoft) | Molduras dos painéis (webviews), padrão do VS Code web. Só baixa páginas fixas; os arquivos não são enviados. |
| Código | `open-vsx.org` (só ao procurar extensões) | Catálogo de extensões. Extensões instaladas rodam no navegador com acesso aos arquivos do editor. |
| editor de escritório antigo, Editar PDF, visualizadores | nenhum | — |

Possível melhora (não feita): servir as molduras do VS Code pelo próprio site. Tiraria a Microsoft da lista, mas
perde o isolamento por subdomínio que o VS Code usa nos painéis; por isso ficou como está.

## Teste
`node --check terminal/app.js`; Playwright em `terminal/?rede=wss://evil.example/` (conectou no wisp e o botão
mostra "Rede: wisp"), `apps/codigo/`, a pasta do antigo editor, `apps/editar-pdf/` e nas páginas de
`visualizadores/`: sem erros de JS.
