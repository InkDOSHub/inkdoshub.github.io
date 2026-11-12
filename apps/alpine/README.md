# Alpine Linux (InkSoC)

A complete Alpine Linux 3.21 (x86-64) terminal in the browser, WSL 1 style: the InkSoC
engine plays the part of the Linux kernel (system calls in WebAssembly) and runs Alpine's
real programs, with their shared libraries (`/lib/ld-musl-x86_64.so.1`).

- `engine.wasm`: a fixed copy of the InkSoC engine for this app (built from
  `apps/inksoc/src/engine`). Engine work for Windows does not change it; copy a new
  build here on purpose when it should.
- `alpine-rootfs.tar.gz`: Alpine's minirootfs, unpacked at `/` on the first start.
- `busybox`: static BusyBox 1.35, used for the base commands.
- `overlay/` (packed into `overlay.tar` by `overlay/build.sh`): first start (user and
  password, like WSL), `help`, `sudo`, `bench`, prompt and welcome text.
- `worker.js`: runs the engine, saves the whole file tree to OPFS (`alpine-fs.tar`) a
  few seconds after it changes, and carries sockets over a wisp tunnel (our server
  `/net/wisp/`, or a public one). DNS is answered by the engine with made-up
  addresses (198.18.x.y) that become host names again when a program connects.

Not yet: threads (`clone` with `CLONE_VM`), listening sockets, signals delivery.
