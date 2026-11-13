# Graph Report - src  (2026-11-13)

## Corpus Check
- 24 files · ~111,909 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1222 nodes · 3200 edges · 55 communities (46 shown, 9 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7200edde`
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
- .sched_switch
- .cxx_throw
- .wow64_boot
- Engine
- Lx
- Rect
- mmu.rs
- .heap_alloc
- .set_bitmap_bits
- hashmap
- call
- ntsys.rs
- pe.rs
- call
- .call_native
- call
- Shared
- Win
- kernel32.rs
- Cond
- Engine
- Keys
- Jit
- Brush
- decode
- Prod
- .fault
- Fault
- .linux_boot
- .fill
- exit_proc
- net_call
- St
- OPT

## God Nodes (most connected - your core abstractions)
1. `call()` - 70 edges
2. `Engine` - 65 edges
3. `G` - 64 edges
4. `Engine` - 63 edges
5. `Engine` - 61 edges
6. `Mmu` - 53 edges
7. `call()` - 53 edges
8. `Rect` - 40 edges
9. `F80` - 35 edges
10. `step_raw()` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Shared` --references--> `ProcInfo`  [INFERRED]
  src/engine/src/lib.rs → src/engine/src/proc.rs
- `Engine` --references--> `Jit`  [INFERRED]
  src/engine/src/lib.rs → src/engine/src/jit.rs
- `Saved` --references--> `Jit`  [INFERRED]
  src/engine/src/linux.rs → src/engine/src/jit.rs
- `ProcSave` --references--> `Jit`  [INFERRED]
  src/engine/src/proc.rs → src/engine/src/jit.rs
- `decode()` --calls--> `modrm()`  [INFERRED]
  src/engine/src/jit.rs → src/engine/src/cpu.rs

## Import Cycles
- 2-file cycle: `src/engine/src/cpu.rs -> src/engine/src/lib.rs -> src/engine/src/cpu.rs`

## Communities (55 total, 9 thin omitted)

### Community 0 - "jit.rs"
Cohesion: 0.02
Nodes (96): BR, CALL, DROP, ELSE, END, F32LOAD, F32R, F32STORE (+88 more)

### Community 1 - "step_raw"
Cohesion: 0.08
Nodes (52): Dec, Dec<'a>, ea(), Engine, host_diff(), imul_set(), K, Loc (+44 more)

### Community 2 - "Engine"
Cohesion: 0.09
Nodes (11): text_width(), call(), Cont, Engine, full(), Msg, now_ms(), Step (+3 more)

### Community 3 - "G"
Cohesion: 0.13
Nodes (24): Block, compile(), decode_block(), emit_block(), finish(), flag_use(), G, Ins (+16 more)

### Community 4 - "sched.rs"
Cohesion: 0.12
Nodes (13): Cpu, RET_THREAD, BLOCK, MAIN_TID, NO_CORE, RETRY, Sched, SLICE (+5 more)

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
Nodes (30): BLOCKED, EAFNOSUPPORT, EAGAIN, EBADF, ECHILD, ECONNREFUSED, EEXIST, EINVAL (+22 more)

### Community 9 - "lib.rs"
Cohesion: 0.07
Nodes (23): set_opt(), add_file(), BUF, CORE0_MMU, eng(), MSG, msg_ptr(), OUT (+15 more)

### Community 10 - ".view"
Cohesion: 0.18
Nodes (12): Be, be_at(), Hatch, None, Pat, rgb(), rop2(), rop3() (+4 more)

### Community 11 - "wingdi.rs"
Cohesion: 0.05
Nodes (40): ATTR_SIZE, Bmp, char_adv(), DARK, Dc, DESKTOP_COLOR, draw_glyph(), E_BMP (+32 more)

### Community 12 - "call"
Cohesion: 0.15
Nodes (12): Solid, call(), default_pal(), Engine, idx(), mk_lf(), Brush, Pal (+4 more)

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
Nodes (15): call(), run(), COUNT, count_locked(), DEPTH, GEN, Guard, idle() (+7 more)

### Community 17 - "Mmu"
Cohesion: 0.10
Nodes (3): Mmu, .TLB_MASK, Space

### Community 18 - ".call_native"
Cohesion: 0.20
Nodes (5): candidates(), Engine, export_names(), HIDDEN, redirect()

### Community 19 - ".sched_switch"
Cohesion: 0.31
Nodes (3): diff_get(), now(), timer_due()

### Community 20 - ".cxx_throw"
Cohesion: 0.21
Nodes (8): Ctx, Eh, Engine, Frame, Step, Call, Catch, RET_EH

### Community 21 - ".wow64_boot"
Cohesion: 0.23
Nodes (9): key_of(), call(), Engine, export_addr(), find_module(), load_by_name(), norm(), proc_address() (+1 more)

### Community 22 - "Engine"
Cohesion: 0.22
Nodes (4): kick(), call(), Engine, nt_timeout()

### Community 23 - "Lx"
Cohesion: 0.18
Nodes (8): Fd, Dev, Dir, File, Pipe, Sock, Tty, open()

### Community 24 - "Rect"
Cohesion: 0.19
Nodes (7): colorref(), Cv, Cv<'a>, Inset, Rect, win_frame(), Rect

### Community 25 - "mmu.rs"
Cohesion: 0.16
Nodes (14): AWAY, EPOCH, Frame, MAXC, MmuShared, NONE, PAGE, Pte (+6 more)

### Community 26 - ".heap_alloc"
Cohesion: 0.27
Nodes (5): step(), step_one(), step_trace(), Engine, ENGINE

### Community 27 - ".set_bitmap_bits"
Cohesion: 0.31
Nodes (6): chan(), decode(), encode(), Fmt, nearest(), unchan()

### Community 28 - "hashmap"
Cohesion: 0.17
Nodes (8): ARENA, MAX_SMALL, PEB, PEB32, TEB, TEB32_OFF, ProcInfo, LOW_ALLOC

### Community 29 - "call"
Cohesion: 0.26
Nodes (5): class(), Engine, call(), Engine, VT_BSTR

### Community 30 - "ntsys.rs"
Cohesion: 0.15
Nodes (12): ACCESS_DENIED, BUFFER_TOO_SMALL, END_OF_FILE, INFO_LENGTH_MISMATCH, INVALID_HANDLE, INVALID_INFO_CLASS, INVALID_PARAMETER, NO_MORE_ENTRIES (+4 more)

### Community 31 - "pe.rs"
Cohesion: 0.37
Nodes (13): linux_save_tar(), entry_rva(), hdr(), image_info(), image_size(), ImageInfo, load_image(), map_image() (+5 more)

### Community 32 - "call"
Cohesion: 0.14
Nodes (13): W, Addr, Cs, Keyed, Lx, Msg, MsgOrObjs, Objs (+5 more)

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

### Community 42 - "Brush"
Cohesion: 0.33
Nodes (6): Brush, Dc, Hatch, Null, Pat, Solid

### Community 43 - "decode"
Cohesion: 0.40
Nodes (5): add(), decode(), has_modrm1(), has_modrm2(), jit_step()

### Community 44 - "Prod"
Cohesion: 0.67
Nodes (3): Prod, Known, Unknown

### Community 45 - ".fault"
Cohesion: 0.36
Nodes (3): guest_read32(), guest_read8(), Engine

### Community 47 - ".linux_boot"
Cohesion: 0.17
Nodes (10): execve(), linux_get_file(), linux_put_file(), Lx, Node, Dir, File, Link (+2 more)

### Community 48 - ".fill"
Cohesion: 0.25
Nodes (3): host_swap_read(), host_swap_write(), unsafe_tlb_unused()

### Community 49 - "exit_proc"
Cohesion: 0.67
Nodes (3): crash(), exit_proc(), linux_interrupt()

### Community 50 - "net_call"
Cohesion: 0.33
Nodes (7): dns_answer(), linux_net_poll(), net_call(), net_event(), read_addr(), sock_send(), write_addr()

### Community 51 - "St"
Cohesion: 0.33
Nodes (6): St, Done, Ready, Running, Suspended, Wait

## Knowledge Gaps
- **52 isolated node(s):** `Unknown`, `Known`, `None`, `Pat`, `None` (+47 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 389 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Engine` connect `.heap_alloc` to `jit.rs`, `step_raw`, `Engine`, `G`, `sched.rs`, `winsys.rs`, `call`, `F80`, `linux.rs`, `lib.rs`, `wingdi.rs`, `call`, `msvcrt.rs`, `Engine`, `call`, `Mmu`, `.call_native`, `.cxx_throw`, `.wow64_boot`, `hashmap`, `call`, `ntsys.rs`, `pe.rs`, `.call_native`, `Shared`, `kernel32.rs`, `Jit`, `decode`, `.fault`?**
  _High betweenness centrality (0.556) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Engine` (e.g. with `Eh` and `Jit`) actually correct?**
  _`Engine` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Unknown`, `Known`, `None` to the rest of the system?**
  _52 weakly-connected nodes found - possible missing edges._
- **Should `jit.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.019801980198019802 - nodes in this community are weakly interconnected._
- **Why does `Mmu` connect `Mmu` to `sched.rs`, `lib.rs`, `Fault`, `.fill`, `mmu.rs`, `.heap_alloc`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Should `step_raw` be split into smaller, more focused modules?**
  _Cohesion score 0.08072072072072072 - nodes in this community are weakly interconnected._
- **Why does `call()` connect `Engine` to `call`, `winsys.rs`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._