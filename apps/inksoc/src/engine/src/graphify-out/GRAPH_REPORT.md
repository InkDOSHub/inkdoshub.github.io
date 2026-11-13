# Graph Report - src  (2026-11-13)

## Corpus Check
- 24 files · ~112,321 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 214 nodes · 591 edges · 15 communities (7 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3036c2d3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- jit.rs
- native
- G
- .b
- compile
- decode
- Prod
- OPT

## God Nodes (most connected - your core abstractions)
1. `G` - 65 edges
2. `sse()` - 34 edges
3. `native()` - 31 edges
4. `emit_block()` - 23 edges
5. `muldiv()` - 21 edges
6. `compile()` - 17 edges
7. `popcnt()` - 16 edges
8. `off!` - 13 edges
9. `Ins` - 12 edges
10. `Opd` - 8 edges

## Surprising Connections (you probably didn't know these)
- `compile()` --calls--> `opt()`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 9 → community 41_
- `decode()` --references--> `Engine`  [EXTRACTED]
  jit.rs →   _Bridges community 41 → community 43_
- `muldiv()` --references--> `Ins`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 41 → community 1_
- `sse()` --references--> `Ins`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 41 → community 3_
- `G` --references--> `Prod`  [EXTRACTED]
  jit.rs → jit.rs  _Bridges community 44 → community 3_

## Import Cycles
- None detected.

## Communities (15 total, 8 thin omitted)

### Community 0 - "jit.rs"
Cohesion: 0.02
Nodes (97): BR, CALL, DROP, ELSE, END, F32LOAD, F32R, F32STORE (+89 more)

### Community 1 - "native"
Cohesion: 0.35
Nodes (9): emit_block(), muldiv(), native(), Opd, Imm, Mem, Reg, popcnt() (+1 more)

### Community 3 - "G"
Cohesion: 0.20
Nodes (3): G, off!, sse()

### Community 9 - ".b"
Cohesion: 0.36
Nodes (3): jit_cond(), opt(), set_opt()

### Community 41 - "compile"
Cohesion: 0.17
Nodes (13): Block, compile(), decode_block(), finish(), flag_use(), host_jit(), Ins, is_branch() (+5 more)

### Community 43 - "decode"
Cohesion: 0.40
Nodes (5): add(), decode(), has_modrm1(), has_modrm2(), jit_step()

### Community 44 - "Prod"
Cohesion: 0.67
Nodes (3): Prod, Known, Unknown

## Knowledge Gaps
- **2 isolated node(s):** `Unknown`, `Known`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 117 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `G` connect `G` to `jit.rs`, `native`, `.b`, `compile`, `Prod`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **What connects `Unknown`, `Known` to the rest of the system?**
  _2 weakly-connected nodes found - possible missing edges._
- **Should `jit.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.018867924528301886 - nodes in this community are weakly interconnected._
- **Why does `sse()` connect `G` to `jit.rs`, `native`, `.b`, `compile`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `native()` connect `native` to `jit.rs`, `.b`, `G`, `compile`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._