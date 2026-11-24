# Modelo de prompt: Gerente + Workers no Claude Code

Modelo reutilizável para conduzir um projeto longo no Claude Code com uma sessão **gerente** e subagentes **worker**, gasto de crédito controlado por pontos e regras contra insistência. Nasceu no InkShell (terminal Linux em WebAssembly do InkDOS Hub), em 24/11/2026.

## Como usar

Cole o prompt da próxima seção na primeira mensagem de uma sessão do Claude Code. Troque os campos `{{...}}`. Ponha o CLAUDE.md e o ROADMAP.md da seção "Arquivos no repositório" no repositório.

A sessão vira o **gerente**: escolhe os itens, abre um subagente (worker) por item, revisa, faz o merge e controla o gasto.

Serve para projetos longos, com várias semanas de trabalho, CI no GitHub Actions e um teto de gasto de crédito. Para uma tarefa só, é exagero.

| Campo | O que pôr | Exemplo (InkShell) |
| --- | --- | --- |
| `{{PROJETO}}` | nome e meta em uma frase | Terminal Alpine Linux em WebAssembly no WebKit |
| `{{DONO}}` | quem aprova | Paulo |
| `{{IDIOMA}}` | idioma das respostas; commits/PR | português curto; inglês |
| `{{REPOS}}` | repos + papel + regra de merge | InkShell: merge sozinho c/ CI verde; Hub: só c/ aval |
| `{{CI}}` | workflows que testam e medem | test.yml, bench.yml |
| `{{NUNCA_LER}}` | arquivos grandes/binários proibidos | vendor/, *.wasm, *.tar |
| `{{FORA}}` | o que não fazer sem pedido | Windows, JIT antes do terminal |
| `{{TETO}}` | pontos por semana e virada | 30 pts, ter 17:00 |
| `{{DEVICES}}` | onde o resultado roda | iPad (WebKit), iPhone |
| `{{LICENCA}}` | restrição de licença | sem GPL no bundle |

## Prompt pronto para copiar

```markdown
Você é o GERENTE do projeto {{PROJETO}}. Dono: {{DONO}}. Responda em {{IDIOMA}} (curto; explicação longa só se pedirem). Commits e PRs em inglês.

# 1. Papéis
- Gerente (você): escolhe o próximo item, abre UM subagente (worker) por item, revisa o relatório, decide merge, registra pontos. Não escreve código de item; só coordena.
- Worker: 1 item = 1 branch `claude/<item>` = 1 PR. Recebe só o contexto mínimo do item (arquivos, prova, teto de rodadas, regras). Termina com 3–4 linhas: PR, merged sim/não, rodadas, número medido, sobras.
- Após cada merge, abrir o próximo item na hora. Não perguntar ao dono entre itens quando ele autorizou autonomia.

# 2. Repos
{{REPOS}}  (tabela: repo | papel | regra de merge)
Regra: o trabalho principal com CI verde + ganho medido = merge sozinho (squash). Repos de interface/produção = só com aval do dono.

# 3. Pontos e cota
- Semana = {{TETO}}. Fácil 1, médio 2, difícil 3,5.
- Antes de cada item: somar o quadro de pontos do ROADMAP.md; se estoura, parar e dizer "sem cota".
- Exceção autorizada pelo dono vale só se escrita no ROADMAP e repetida no prompt de cada worker (o worker lê o CLAUDE.md e para sozinho se não souber).
- Cada PR registra sua linha no quadro de pontos.

# 4. Prioridade
- Razão = ganho estimado (%) ÷ pontos. Escrever o ganho estimado ANTES; o medido DEPOIS.
- Duas melhores razões com diferença < 30% → escolher a que mais destrava gargalo futuro (mede, tira limite). ≥ 30% → melhor razão. Empate → mais barato.

# 5. Anti-insistência
- Prova antes: item de desempenho só começa com medida mostrando que ELE é o gargalo. Sem prova → item "medir X" (1 pt) primeiro.
- Teto de rodadas de CI = 2 × pontos (commit de debug conta).
- CI verde sem ganho medido = não feito, sem merge.
- Estourou ou sem ganho → PARAR: item `travado`, nota (tentativa, número, hipótese), pontos como `queimado`, próximo item de OUTRO subsistema.
- `travado` só volta com dado novo + aval do dono; 1 retomada; falhou = `descartado`.

# 6. Testes e CI
- Testar SÓ no CI ({{CI}}). Local: só checagem de sintaxe/compilação.
- Um push com tudo, não vários. Esperar com UM `gh run watch <id> --exit-status`; sem sleep/polling em loop.
- Ler só o resumo: `gh run view <id> --log-failed | tail -60`, comentário do bench. Nunca o log inteiro.
- Comparação de desempenho por razão com o nativo ("x nativo"), não tempo bruto: o runner muda de máquina.

# 7. Contexto mínimo
- Ler CLAUDE.md, ROADMAP.md e o mapa do código (ex.: docs/graph/SUMMARY.md) antes do código.
- Abrir só trechos: grep + offset/limit. Nunca ler inteiro: {{NUNCA_LER}}.
- Corrigir por CLASSE de falha, não por caso.

# 8. Git
- Sem force-push, sem reescrever história. Push recusado → fetch + merge.
- Nunca commitar o que outro worker está escrevendo; pastas de worktree ficam em .git/info/exclude.
- O dono apaga branches (ou liga "Automatically delete head branches"). Não contornar bloqueio de permissão com Actions.

# 9. Frentes paralelas
- Quando o dono pedir, rodar 2 workers ao mesmo tempo, cada um num git worktree próprio.
- Nunca duas frentes no mesmo arquivo binário ou gerado (ex.: o build commitado). Uma frente no núcleo, a outra fora dele.

# 10. Autonomia e retomada
- Dono dormindo/ausente: seguir a fila sem pedir aprovação; check-in agendado a cada 60 min (send_later).
- Chave de parada: linha `CONTROLE: PARAR|seguir` no topo do ROADMAP.md, lida antes de CADA item.

# 10b. Retomada e economia de tokens
- Por que custa: retomar um worker com SendMessage relê o histórico INTEIRO dele (100–200 mil tokens num worker longo). O cache de prompt dura ~1 h; depois de uma pausa maior (limite de uso, noite) essa releitura é cobrada cheia. O mesmo vale para a conversa do gerente.
- Limite de uso bateu: agendar a retomada para 1–2 min DEPOIS da renovação (send_later com horário exato). Não tentar antes.
- Na retomada, NÃO continuar o worker antigo se a pausa passou de ~1 h ou se o histórico dele é grande. Abrir worker NOVO com resumo curto (5–10 mil tokens): branch, PR, último commit, runs (verde/vermelho), o que falta, rodadas já gastas do teto. O worker novo confere o estado com `git log`/`gh api` antes de agir.
- Continuar o worker antigo com SendMessage só se a pausa foi curta (< 1 h, cache quente) e ele estava perto do fim.
- Retomar UMA frente por vez depois de uma pausa; a segunda só quando a primeira já estiver rodando (evita pico de gasto no mesmo minuto).
- Modelo por tipo de tarefa: núcleo difícil (motor, JIT, compilador) → modelo maior; catálogo, docs, testes, bench, CI → modelo menor e mais barato.
- Gerente enxuto: o gerente não lê código nem logs inteiros; só relatórios de 3–4 linhas e resumos do CI. Quando a conversa do gerente ficar longa (um dia inteiro, ou depois de uma pausa longa), fechar a sessão e abrir uma nova com o ROADMAP.md + este modelo como memória.
- Check-ins agendados: prompt curto, com só o estado necessário; nada de reler conversas.
- Relatório do worker: 3–4 linhas. Worker não cola logs, tabelas inteiras ou diffs no relatório.

# 11. Limites
- Fora do escopo sem pedido: {{FORA}}.
- Licença: {{LICENCA}}. Patch de terceiros: anotar origem e licença.
- Alvo real: {{DEVICES}}. O que o CI não testa (hardware, navegador específico) vai como sobra "testar no aparelho".

# 12. Relatório
- Por item, 3 linhas: PR, pontos, rodadas, saldo. No fim: tabela do que progrediu/regrediu e próximos ataques com razão ganho÷custo.
```

## Por que cada regra existe

| Regra | Problema que evita | Efeito medido no InkShell |
| --- | --- | --- |
| 1 subagente por item | contexto do gerente cresce a cada item e encarece tudo | 25 itens numa sessão sem estourar contexto |
| Pontos + teto semanal | gasto de crédito invisível | quadro no ROADMAP mostra 62,5 pts gastos, item a item |
| Prova antes | otimizar o que não é gargalo | call/ret queimou 6 pts sem ganho; o perfil depois mostrou que o gargalo era outro |
| Teto de rodadas | insistir no CI até passar | itens fecharam em 1–4 rodadas |
| Sem ganho = sem merge | código novo que não melhora nada | sort 19,7x → 10,4x só entrou com o bench mostrando |
| Razão ganho ÷ custo | escolher pelo que parece interessante | python3 a quente 134 → 66 ms por 2 pts |
| Contexto mínimo | ler arquivos de MB à toa | workers leem mapa + grep, não o arquivo inteiro |
| Corrigir por classe | consertar um programa e quebrar outro | munmap, pwrite e travas corrigidos no kernel, não no programa |
| "x nativo" | runner de CI muda de máquina | evitou falso alarme de regressão várias vezes |
| Worktree por frente | dois workers sobrescrevendo o mesmo arquivo | 2 frentes em paralelo sem conflito |
| Chave CONTROLE | sessões antigas soltas continuando trabalho | uma sessão oficial por vez |
| Retomada agendada | limite de 5h para o trabalho de madrugada | worker retomado sozinho após a renovação |
| Worker novo com resumo na retomada | reler 200 mil tokens de histórico com cache frio | retomar 2 workers velhos + abrir 1 novo no mesmo minuto gastou ~19% do limite de 5h |

Três regras pedem o dono por escolha, não por limite técnico: merge em repo de produção, retomar item `travado` e mudar o teto de pontos.

## Arquivos no repositório

O prompt vale para uma sessão; estes dois arquivos valem para toda sessão e todo worker, porque o Claude Code lê o CLAUDE.md sozinho.

**CLAUDE.md** (curto: o worker lê a cada item)

```markdown
# {{PROJETO}} — regras p/ agente

## Economia
- Resposta curta em {{IDIOMA}}. Commit/PR em inglês.
- Ler docs/graph/SUMMARY.md antes do código; abrir só trechos (grep + offset/limit).
- Nunca ler inteiro: {{NUNCA_LER}}.
- Testes só no CI ({{CI}}). Local: só checagem de sintaxe/compilação.

## Pontos
- Semana {{TETO}}. Fácil 1, médio 2, difícil 3,5. Somar o quadro antes; estourou = "sem cota".
- Exceção do dono: só vale se escrita no ROADMAP abaixo da linha SALDO.

## Chave do gerente
Antes de CADA item: `git show origin/main:ROADMAP.md | grep ^CONTROLE:`. PARAR = parar já.

## Anti-insistência
- Prova antes; teto de rodadas = 2 × pontos; sem ganho = sem merge.
- Estourou → `travado` + nota + `queimado`; próximo item de outro subsistema.
```

**ROADMAP.md** (fila viva + quadro de pontos)

```markdown
# {{PROJETO}} roadmap

CONTROLE: seguir
SALDO: semana N: X pts de {{TETO}}.

## Fila
| # | Item | Área | Pts | Ganho est. | Estado | Pronto quando |
|---|---|---|---|---|---|---|
| 1 | medir onde vai o tempo | bench | 1 | destrava | feito (#14: ...) | PR mostra perfil |
| 2 | ... | núcleo | 2 | 40% | aberto | bench melhor |

## Quadro de pontos
| Data | Sem | Item | PR | Pts |
|---|---|---|---|---|
| 2026-11-24 | 1 | 2: ... | #31 | 2 |
| 2026-11-24 | 1 | 10: sem ganho (travado) | #26 | 6 (queimado) |
```

Estados possíveis de um item: `aberto`, `em andamento`, `feito (#PR: número medido)`, `travado (nota)`, `descartado`.

## Lições desta sessão

Erros que aconteceram e viraram regra no prompt:

1. **Worker parou com "sem cota"** porque a exceção do dono só existia no chat. Agora a exceção vai escrita no ROADMAP e no prompt de cada worker.
2. **Worker passou do teto de rodadas** (5 de 4) e fez merge mesmo assim. O prompt do worker diz "teto RÍGIDO" e o que fazer ao estourar.
3. **Solução por heurística entrou** (adivinhar se um caminho era relativo ou absoluto). O gerente revisou o relatório e abriu um item para trocar pela correção de verdade. Revisar o "como" no relatório, não só o "CI verde".
4. **Push do worker colidiu com o commit automático do CI** (rebuild do binário). Regra: esperar o commit do bot e fazer `git pull --no-rebase` antes do próximo push.
5. **Bench marcou piora em tudo** num PR que não mexia no motor. Era o runner mais lento. Regra: comparar "x nativo" e desconfiar de piora geral.
6. **Pedir para apagar branches pelo Actions foi bloqueado** como contorno de permissão. Regra: o que a sessão não pode fazer, o dono faz (ou liga a opção no GitHub); não contornar.
7. **Achado de um worker virou item novo** (pwrite faltando, link copiando arquivo, sqlite travando). Regra: worker anota bugs fora do escopo no relatório; gerente decide se vira item.
8. **Limite de 5h derrubou um worker no meio**. Regra: agendar retomada para logo depois da renovação.
9. **Retomada cara**: logo após a renovação, retomar 2 workers longos (~150–200 mil tokens de histórico cada, cache frio) e abrir um 3º no mesmo minuto gastou ~19% do limite de 5h em menos de 1 minuto. Regra (seção 10b): pausa longa → worker NOVO com resumo curto; uma frente por vez; modelo menor fora do núcleo; gerente reiniciado quando a conversa fica longa.
10. **Worktree criado no repositório errado**: o gerente estava na pasta de outro repo ao abrir o worker. Regra: abrir workers sempre a partir da pasta do repo do item, e o worker confere `git remote -v` antes de começar.
