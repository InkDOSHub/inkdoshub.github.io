# Graph Report - src  (2026-11-13)

## Corpus Check
- 24 files · ~112,583 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 216 nodes · 603 edges · 14 communities (5 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f18c5cb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- jit.rs
- native
- G
- .b
- compile
- Prod
- OPT

## God Nodes (most connected - your core abstractions)
1. `G` - 66 edges
2. `sse()` - 34 edges
3. `native()` - 31 edges
4. `emit_block()` - 24 edges
5. `muldiv()` - 21 edges
6. `compile()` - 17 edges
7. `popcnt()` - 16 edges
8. `off!` - 13 edges
9. `Ins` - 12 edges
10. `Opd` - 8 edges

## Surprising Connections (you probably didn't know these)
- `compile()` --calls--> `opt()`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 9 → community 41_
- `muldiv()` --references--> `Ins`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 41 → community 1_
- `G` --references--> `Prod`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 44 → community 9_
- `sse()` --references--> `Mem`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 1 → community 9_
- `compile()` --calls--> `off!`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 3 → community 41_

## Import Cycles
- None detected.

## Communities (14 total, 9 thin omitted)

### Community 0 - "jit.rs"
Cohesion: 0.02
Nodes (100): BR, CALL, DROP, DYN, ELSE, END, F32LOAD, F32R (+92 more)

### Community 1 - "native"
Cohesion: 0.30
Nodes (9): emit_block(), muldiv(), native(), Opd, Imm, Mem, Reg, popcnt() (+1 more)

### Community 9 - ".b"
Cohesion: 0.29
Nodes (3): G, opt(), sse()

### Community 41 - "compile"
Cohesion: 0.14
Nodes (18): add(), Block, compile(), decode(), decode_block(), finish(), flag_use(), has_modrm1() (+10 more)

### Community 44 - "Prod"
Cohesion: 0.67
Nodes (3): Prod, Known, Unknown

## Knowledge Gaps
- **2 isolated node(s):** `Unknown`, `Known`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 118 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `G` connect `.b` to `jit.rs`, `native`, `G`, `compile`, `Prod`?**
  _High betweenness centrality (0.194) - this node is a cross-community bridge._
- **What connects `Unknown`, `Known` to the rest of the system?**
  _2 weakly-connected nodes found - possible missing edges._
- **Should `jit.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.01834862385321101 - nodes in this community are weakly interconnected._
- **Why does `sse()` connect `.b` to `jit.rs`, `native`, `G`, `compile`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Should `compile` be split into smaller, more focused modules?**
  _Cohesion score 0.13666666666666666 - nodes in this community are weakly interconnected._
- **Why does `native()` connect `native` to `jit.rs`, `.b`, `compile`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._