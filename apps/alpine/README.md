# Alpine Linux (InkSoC)

A complete Alpine Linux 3.21 (x86-64) terminal in the browser, WSL 1 style: the InkSoC
engine plays the part of the Linux kernel (system calls in WebAssembly) and runs Alpine's
real programs, with their shared libraries (`/lib/ld-musl-x86_64.so.1`).

- `engine-src/`: this app's own copy of the InkSoC engine source (taken from
  `apps/inksoc/src/engine` at 655e8ac). Changes for Linux go here, so the Windows engine is
  never touched. Its MMU swaps the pages of every process (each frame knows its owner;
  fork copies pages into free frames, then straight to swap). Build:
  `cd engine-src && cargo build --release --target wasm32-unknown-unknown` and copy
  `target/wasm32-unknown-unknown/release/inksoc.wasm` to `engine.wasm`. Bring in engine
  speed work from `apps/inksoc` on purpose, file by file.
- `engine.wasm`: the build of `engine-src`.
- Memory: the same budget as InkSoC. Programs see 8 GB; real RAM = half of the lowest tab
  limit seen on this device (key `inksoc-limits`, shared with the InkSoC page; 256 MB before
  any calibration); the rest goes to `alpine-swap.bin` in OPFS.
- Start panel (like the Wine app): system, network, memory with "Calibrate memory", saved
  data with "Erase and start from zero", and Start. Nothing runs before Start.
- `alpine-rootfs.tar.gz`: Alpine's minirootfs, unpacked at `/` on the first start.
- `busybox`: static BusyBox 1.35, used for the base commands.
- `overlay/` (packed into `overlay.tar` by `overlay/build.sh`): first start (user and
  password, like WSL), `help`, `sudo`, `bench`, prompt and welcome text.
- `worker.js`: runs the engine, saves the whole file tree to OPFS (`alpine-fs.tar`) a
  few seconds after it changes, and carries sockets over a public wisp tunnel
  (wisp.mercurywork.shop). DNS is answered by the engine with made-up
  addresses (198.18.x.y) that become host names again when a program connects.

Not yet: threads (`clone` with `CLONE_VM`), listening sockets, signals delivery.
