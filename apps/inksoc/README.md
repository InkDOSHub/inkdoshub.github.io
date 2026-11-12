# InkSoC (proof)

Our own engine to run Windows `.exe` files in the browser, WebKit first (iPhone/iPad).
This folder holds the first proof:

- `src/engine/`: Rust → wasm engine. PE32+ loader, x86-64 interpreter, 64-bit page
  table with a fixed pool of real RAM and swap to OPFS, and a bridge to "Wine side"
  C code compiled to wasm (`wine/ntdll_proof.c`).
- `src/engine/src/jit.rs`: JIT. Hot x86-64 blocks (40 visits) become small wasm
  modules that the page compiles and adds to the engine's function table.
  Registers live in wasm locals, flags are lazy (a cmp + jcc becomes one wasm
  compare), a jump back to the block start is a wasm loop, and memory uses the
  same software TLB inline. Instructions it does not translate run through the
  interpreter one at a time. The "JIT" box on the page turns it off.
- `src/wine/`: Wine's msvcrt (string functions, printf, ctype; Wine 10.0, LGPL)
  compiled to `wine.wasm`. The C files are compiled as x86-64 Windows code (so
  structs and `va_list` match the program exactly), retargeted to wasm64, and every
  load/store is routed through the engine's page table (`wasm-opt
  --instrument-memory`, then `--memory64-lowering`). Program pointers are used as
  is, even when their page is in swap. `glue.c` gives it a fixed "C" locale and
  the entry point `ink_call`. Wine's own data and stack sit at 1-4 MB of the
  engine's memory (the engine is linked with `--global-base=4194304`).
- `src/test/test.c`: the x86-64 test program (`test.exe`).
- `src/engine/src/sched.rs`: program threads. Each thread is a saved CPU state;
  the engine switches every 200,000 instructions or when a thread waits
  (WaitFor*, Sleep, critical sections, SRW locks, events, mutexes, semaphores).
  When every thread waits on a timeout, `run` returns 3 and the page waits.
- `src/test64/`: stage 1 test (`main.c` + `testdll.c`), stage 2 test (`stage2.c`,
  real msvcrt.dll API) and stage 4 test (`stage4.c`, threads; same build
  command as stage 2).
- `index.html`, `inksoc.js`, `worker.js`: test page (engine proof, OPFS swap cost,
  draw calls per frame, memory and GPU texture limits).

Build:

```
cd src/engine && cargo build --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/inksoc.wasm ../../
src/wine/build.sh   # needs clang/llc/wasm-ld 18, binaryen, git (fetches Wine 10.0)
cd src/test64 && x86_64-w64-mingw32-gcc -O2 -D__USE_MINGW_ANSI_STDIO=0 -nostartfiles -fno-builtin -fno-stack-protector -mno-stack-arg-probe -fno-asynchronous-unwind-tables -e start -Wl,--no-insert-timestamp -o ../../stage2.exe stage2.c -lmingw32 -lmsvcrt -lkernel32
cd ../test && x86_64-w64-mingw32-gcc -O2 -nostdlib -ffreestanding -fno-builtin -fno-stack-protector -mgeneral-regs-only -mno-stack-arg-probe -fno-asynchronous-unwind-tables -e start -Wl,--no-insert-timestamp -o ../../test.exe test.c -lkernel32 -lntdll
```

Own programs: build with `-D__USE_MINGW_ANSI_STDIO=0` so printf comes from msvcrt.dll
(mingw's own printf uses x87 instructions, not supported yet).

`worker.js` patches `test_mb` at 0x140002000 (check with `x86_64-w64-mingw32-nm test.exe`).

License: GPL-3.0-or-later.

## Linux (experimental)

`linux.html` / `linux.js`: a terminal (xterm.js, in `vendor/`) running BusyBox
(`bin/busybox`, 1.35.0 static x86-64 musl build from busybox.net, GPL-2.0) on
the same CPU and JIT.

- `src/engine/src/linux.rs`: static ELF loader, Linux system calls (`syscall`),
  an in-memory file tree, processes (fork copies the address space, execve,
  wait4, pipes, `#!` scripts), terminal modes and Ctrl+C / Ctrl+D. A syscall
  that has to wait rewinds to the `syscall` instruction and runs again when the
  scheduler wakes it. Linux processes run on core 0 only.
- `src/engine/src/x87.rs` + `f80.rs`: the x87 FPU with exact 80-bit arithmetic
  (musl's printf and strtod depend on it).
- `mmu.rs`: one address space per process (`Space`), swapped on a switch.

