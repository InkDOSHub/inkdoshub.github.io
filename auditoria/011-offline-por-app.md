# 011 · Modo Offline por app (2026-10-30)

Pedido do Paulo: guardar tudo de uma vez (cerca de 700 MB) assusta e pesa. Agora a pessoa escolhe app por app.

## Como ficou
- **"Offline" no ☰** abre um painel na página, sem pop-up, com um item por app, o tamanho e um check verde.
  Só há dois estados. Tocar num item não marcado baixa aquele app e mostra a porcentagem. Tocar num item
  marcado mostra, na própria página, "Remover … deste aparelho? (tamanho)" com Cancelar e Remover.
- **Base sempre guardada:** a tela inicial e os apps leves (menos de 1 MB cada: Fotos, Música, Gravador,
  Transferir, Webcam) vão junto com o primeiro app escolhido. Ao todo, 0,7 MB.
- **"Atualizar"**, no topo do painel, baixa só os arquivos que mudaram nos itens guardados. O aviso
  "Atualização disponível · Atualizar" da tela inicial faz o mesmo.
- **Espaço:** o painel mostra quanto o navegador usa e quanto ainda está livre (`navigator.storage.estimate`).
- **Oferta depois do uso:** o `sw-portal.js` anota a última página aberta (`__uso__` no cache). Ao voltar à
  tela inicial, se aquele app não está guardado, aparece um cartão: "Guardar … neste aparelho? Ocupa X. Sem
  guardar, ele é baixado de novo sempre que o navegador limpar o cache, e não abre sem internet." As opções são
  "Agora não", que fica lembrado para aquele app, e "Guardar".
- Quem já tinha a cópia inteira continua com todos os itens marcados, porque o formato da marca é o mesmo.

## Arquivos
`inicio/offline.js` (reescrito, `?v=2`), `sw-portal.js` (anota o uso), `assets/home.css` (`?v=19`), `index.html`
(texto do "i"), 19 textos novos nos 7 `idiomas/*.json`, `inicio/manifesto.json` (regenerado).

## Teste (Playwright)
1. O painel lista os 7 apps pesados com o tamanho de cada um.
2. Tocar em Quadro mostra o check verde. Com a rede cortada, o Quadro abriu da cópia (HTTP 200, desenho na tela).
3. Tocar de novo pede a confirmação na página. Confirmando, o cache fica sem os arquivos e o check some.
4. "Atualizar" termina com "Up to date".
5. Depois de abrir o Quadro sem guardá-lo, a tela inicial ofereceu "Keep Whiteboard on this device?".
Nenhum erro de JS.
