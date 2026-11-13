# Graph Report - src  (2026-11-13)

## Corpus Check
- 24 files · ~111,300 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1210 nodes · 3210 edges · 46 communities (40 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.67)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `568bc469`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- jit.rs
- step_raw
- Engine
- G
- sched.rs
- winsys.rs
- call
- F80
- linux.rs
- lib.rs
- .view
- wingdi.rs
- call
- msvcrt.rs
- Engine
- call
- lock.rs
- Mmu
- .call_native
- Obj
- .cxx_throw
- .wow64_boot
- Fault
- Lx
- Rect
- mmu.rs
- Engine
- .take
- hashmap
- call
- ntsys.rs
- pe.rs
- .linux_boot
- .fill
- call
- Shared
- Win
- kernel32.rs
- Cond
- .load_elf
- Keys
- Jit
- Brush
- decode
- Prod
- Cpu

## God Nodes (most connected - your core abstractions)
1. `call()` - 70 edges
2. `Engine` - 65 edges
3. `G` - 63 edges
4. `Engine` - 63 edges
5. `Engine` - 61 edges
6. `call()` - 54 edges
7. `Mmu` - 52 edges
8. `Rect` - 40 edges
9. `step_raw()` - 35 edges
10. `F80` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Shared` --references--> `ProcInfo`  [INFERRED]
  src/engine/src/lib.rs → src/engine/src/proc.rs
- `linux_save_tar()` --calls--> `hdr()`  [INFERRED]
  src/engine/src/linux.rs → src/engine/src/pe.rs
- `Cpu` --references--> `F80`  [INFERRED]
  src/engine/src/cpu.rs → src/engine/src/f80.rs
- `Mmu` --references--> `Cpu`  [INFERRED]
  src/engine/src/mmu.rs → src/engine/src/cpu.rs
- `decode()` --calls--> `modrm()`  [INFERRED]
  src/engine/src/jit.rs → src/engine/src/cpu.rs

## Import Cycles
- 2-file cycle: `src/engine/src/cpu.rs -> src/engine/src/lib.rs -> src/engine/src/cpu.rs`

## Communities (46 total, 6 thin omitted)

### Community 0 - "jit.rs"
Cohesion: 0.02
Nodes (96): BR, CALL, DROP, ELSE, END, F32LOAD, F32R, F32STORE (+88 more)

### Community 1 - "step_raw"
Cohesion: 0.07
Nodes (57): Dec, Dec<'a>, diff_get(), ea(), Engine, host_diff(), imul_set(), K (+49 more)

### Community 2 - "Engine"
Cohesion: 0.09
Nodes (11): text_width(), call(), Cont, Engine, full(), Msg, now_ms(), Step (+3 more)

### Community 3 - "G"
Cohesion: 0.13
Nodes (23): Block, compile(), decode_block(), emit_block(), finish(), flag_use(), G, Ins (+15 more)

### Community 4 - "sched.rs"
Cohesion: 0.05
Nodes (38): RET_THREAD, kick(), Engine, BLOCK, call(), Engine, MAIN_TID, NO_CORE (+30 more)

### Community 5 - "winsys.rs"
Cohesion: 0.04
Nodes (52): CW_USEDEFAULT, DESKTOP, MSG_WINDOW, WM_ACTIVATE, WM_CHAR, WM_CLOSE, WM_COMMAND, WM_CREATE (+44 more)

### Community 6 - "call"
Cohesion: 0.07
Nodes (30): ATTR_DIR, ATTR_NORMAL, call(), case_of(), civil(), days_from(), DIR, Engine (+22 more)

### Community 7 - "F80"
Cohesion: 0.09
Nodes (13): F80, .NAN, .ZERO, QNAN, SPECIAL, arith(), C0, C1 (+5 more)

### Community 8 - "linux.rs"
Cohesion: 0.05
Nodes (35): BLOCKED, dns_answer(), EAFNOSUPPORT, EAGAIN, EBADF, ECHILD, ECONNREFUSED, EEXIST (+27 more)

### Community 9 - "lib.rs"
Cohesion: 0.07
Nodes (25): add_file(), BUF, CORE0_MMU, eng(), ENGINE, guest_read32(), guest_read8(), MSG (+17 more)

### Community 10 - ".view"
Cohesion: 0.17
Nodes (11): Be, be_at(), Hatch, None, Pat, default_pal(), rgb(), rop2() (+3 more)

### Community 11 - "wingdi.rs"
Cohesion: 0.07
Nodes (29): ATTR_SIZE, Cv, DARK, DESKTOP_COLOR, E_BMP, E_BRUSH, E_DC, E_EXTPEN (+21 more)

### Community 12 - "call"
Cohesion: 0.18
Nodes (5): call(), char_adv(), Engine, fonts(), idx()

### Community 13 - "msvcrt.rs"
Cohesion: 0.13
Nodes (16): RET_INITTERM, bounce(), BOUNCE, call(), data_export(), Engine, FILE_SIZE, initterm_next() (+8 more)

### Community 14 - "Engine"
Cohesion: 0.21
Nodes (25): align(), do_pread(), do_read(), do_write(), Engine, enter(), fork(), fstat() (+17 more)

### Community 15 - "call"
Cohesion: 0.14
Nodes (13): call(), civil_1970(), compare(), ctype1(), Engine, ERROR_FILE_NOT_FOUND, ERROR_INVALID_PARAMETER, ERROR_NO_MORE_ITEMS (+5 more)

### Community 16 - "lock.rs"
Cohesion: 0.13
Nodes (18): call(), run(), COUNT, count_locked(), DEPTH, gen(), GEN, Guard (+10 more)

### Community 17 - "Mmu"
Cohesion: 0.11
Nodes (3): Mmu, .TLB_MASK, Space

### Community 18 - ".call_native"
Cohesion: 0.15
Nodes (8): wine_lstrlenA(), wine_RtlComputeCrc32(), alias(), candidates(), Engine, export_names(), HIDDEN, redirect()

### Community 19 - "Obj"
Cohesion: 0.14
Nodes (16): Solid, Bmp, colorref(), Font, Obj, Bmp, Brush, Dc (+8 more)

### Community 20 - ".cxx_throw"
Cohesion: 0.20
Nodes (8): Ctx, Eh, Engine, Frame, Step, Call, Catch, RET_EH

### Community 21 - ".wow64_boot"
Cohesion: 0.24
Nodes (8): key_of(), call(), Engine, find_module(), load_by_name(), norm(), proc_address(), Engine

### Community 23 - "Lx"
Cohesion: 0.16
Nodes (12): Fd, Dev, Dir, File, Pipe, Sock, Tty, Lx (+4 more)

### Community 24 - "Rect"
Cohesion: 0.25
Nodes (7): Cv<'a>, Dc, draw_glyph(), Inset, Rect, Saved, Rect

### Community 25 - "mmu.rs"
Cohesion: 0.17
Nodes (13): AWAY, EPOCH, Frame, MAXC, MmuShared, NONE, PAGE, Pte (+5 more)

### Community 26 - "Engine"
Cohesion: 0.28
Nodes (3): Engine, start(), export_addr()

### Community 27 - ".take"
Cohesion: 0.21
Nodes (8): chan(), decode(), Fmt, mk_lf(), Tgt, Bmp, None, Surf

### Community 28 - "hashmap"
Cohesion: 0.17
Nodes (9): ARENA, MAX_SMALL, PEB, PEB32, TEB, TEB32_OFF, ProcInfo, is_pe32() (+1 more)

### Community 29 - "call"
Cohesion: 0.26
Nodes (5): class(), Engine, call(), Engine, VT_BSTR

### Community 30 - "ntsys.rs"
Cohesion: 0.15
Nodes (12): ACCESS_DENIED, BUFFER_TOO_SMALL, END_OF_FILE, INFO_LENGTH_MISMATCH, INVALID_HANDLE, INVALID_INFO_CLASS, INVALID_PARAMETER, NO_MORE_ENTRIES (+4 more)

### Community 31 - "pe.rs"
Cohesion: 0.42
Nodes (12): entry_rva(), hdr(), image_info(), image_size(), ImageInfo, load_image(), map_image(), NATIVE_DLLS (+4 more)

### Community 32 - ".linux_boot"
Cohesion: 0.27
Nodes (6): linux_put_file(), Node, Dir, File, Link, split_args()

### Community 35 - "Shared"
Cohesion: 0.39
Nodes (8): Heap, Shared, SHARED, Crt, Stream, Module, ProcSave, Resume

### Community 36 - "Win"
Cohesion: 0.25
Nodes (8): Class, Frame, Menu, MenuItem, Popup, Queue, Timer, Win

### Community 37 - "kernel32.rs"
Cohesion: 0.29
Nodes (6): ERROR_ENVVAR_NOT_FOUND, NO_RETURN, PROCESS_HEAP, console(), host_console(), RET_LOADLIB

### Community 38 - "Cond"
Cohesion: 0.29
Nodes (7): Cond, Child, PipeRead, Poll, Socks, Stdin, Until

### Community 39 - ".load_elf"
Cohesion: 0.33
Nodes (5): crash(), execve(), exit_proc(), linux_get_file(), linux_interrupt()

### Community 42 - "Brush"
Cohesion: 0.33
Nodes (6): Brush, Dc, Hatch, Null, Pat, Solid

### Community 43 - "decode"
Cohesion: 0.40
Nodes (5): add(), decode(), has_modrm1(), has_modrm2(), jit_step()

### Community 44 - "Prod"
Cohesion: 0.67
Nodes (3): Prod, Known, Unknown

## Knowledge Gaps
- **52 isolated node(s):** `File`, `Dir`, `Find`, `Event`, `Mutex` (+47 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 380 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Engine` connect `Engine` to `jit.rs`, `step_raw`, `Engine`, `G`, `sched.rs`, `winsys.rs`, `call`, `F80`, `linux.rs`, `lib.rs`, `wingdi.rs`, `call`, `msvcrt.rs`, `Engine`, `call`, `Mmu`, `.call_native`, `.cxx_throw`, `.wow64_boot`, `hashmap`, `call`, `ntsys.rs`, `pe.rs`, `Shared`, `kernel32.rs`, `Jit`, `decode`, `Cpu`?**
  _High betweenness centrality (0.571) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Engine` (e.g. with `Eh` and `Jit`) actually correct?**
  _`Engine` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `File`, `Dir`, `Find` to the rest of the system?**
  _52 weakly-connected nodes found - possible missing edges._
- **Should `jit.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.019801980198019802 - nodes in this community are weakly interconnected._
- **Why does `Mmu` connect `Mmu` to `.fill`, `lib.rs`, `Cpu`, `Fault`, `mmu.rs`, `Engine`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `step_raw` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Why does `F80` connect `F80` to `step_raw`, `Cpu`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._