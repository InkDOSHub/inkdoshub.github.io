# Alpine Linux (InkSoC)

A complete Alpine Linux 3.21 (x86-64) terminal in the browser, WSL 1 style: the InkSoC
engine plays the part of the Linux kernel (system calls in WebAssembly) and runs Alpine's
real programs, with their shared libraries (`/lib/ld-musl-x86_64.so.1`).

- Engine: Windows first, Linux follows. The Windows engine (`apps/inksoc/src/engine`) never
  gets Linux changes. This app keeps them as `linux.patch` (today: `src/mmu.rs`, swap for
  every process, and `src/linux.rs`) on top of the Windows engine commit in `engine-base.txt`.
  - `tools/sync-engine.sh <commit or version tag>`: takes that Windows engine, re-applies
    `linux.patch`, builds, runs `tests/linux-test.mjs`, and only then replaces `engine-src/`,
    `engine.wasm` and `engine-base.txt`. Speed work on the CPU and JIT comes along as is.
  - `tools/make-patch.sh`: after changing Linux parts in `engine-src/`, rebuilds `linux.patch`.
  - `tests/linux-test.mjs [engine.wasm]`: boots Alpine with 24 MB of real RAM and checks the
    first start, sudo, files, fork/exec, apk, /proc and the swap (node, no network).
- `engine-src/`: the Windows engine at `engine-base.txt` plus `linux.patch`.
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
