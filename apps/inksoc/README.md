# InkSoC (proof)

Our own engine to run Windows `.exe` files in the browser, WebKit first (iPhone/iPad).
This folder holds the first proof:

- `src/engine/`: Rust → wasm engine. PE32+ loader, x86-64 interpreter, 64-bit page
  table with a fixed pool of real RAM and swap to OPFS, and a bridge to "Wine side"
  C code compiled to wasm (`wine/ntdll_proof.c`).
- `src/test/test.c`: the x86-64 test program (`test.exe`).
- `index.html`, `inksoc.js`, `worker.js`: test page (engine proof, OPFS swap cost,
  draw calls per frame, memory and GPU texture limits).

Build:

```
cd src/engine && cargo build --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/inksoc.wasm ../../
cd ../test && x86_64-w64-mingw32-gcc -O2 -nostdlib -ffreestanding -fno-builtin -fno-stack-protector -mgeneral-regs-only -mno-stack-arg-probe -fno-asynchronous-unwind-tables -e start -Wl,--no-insert-timestamp -o ../../test.exe test.c -lkernel32 -lntdll
```

`worker.js` patches `test_mb` at 0x140002000 (check with `x86_64-w64-mingw32-nm test.exe`).

License: GPL-3.0-or-later.
