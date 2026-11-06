#!/bin/bash
# Builds QEMU Wasm (github.com/ktock/qemu-wasm, GPL-2) for x86_64 guests with a graphics console
# (pixman), so the page can read the screen with QMP "screendump" and send mouse and keyboard
# with "input-send-event". Output in $OUT: out.js, qemu-system-x86_64.wasm, qemu-system-x86_64.worker.js.
set -euo pipefail
WORK=${WORK:-/tmp/qemu-x64}
OUT=${OUT:-$WORK/out}
REV=${QEMU_WASM_REV:-0ef7b4e}
MEM=${WASM_MEMORY:-1600MB}
mkdir -p "$WORK" "$OUT"
[ -d "$WORK/qemu-wasm" ] || git clone -q https://github.com/ktock/qemu-wasm "$WORK/qemu-wasm"
git -C "$WORK/qemu-wasm" checkout -q "$REV"
# zlib.net keeps only the newest release: take the pinned one from GitHub
sed 's#https://zlib.net/zlib-$ZLIB_VERSION.tar.xz#https://github.com/madler/zlib/releases/download/v$ZLIB_VERSION/zlib-$ZLIB_VERSION.tar.xz#' \
  "$WORK/qemu-wasm/Dockerfile" > "$WORK/Dockerfile"
docker build --progress=plain -t buildqemu-ink - < "$WORK/Dockerfile" 2>&1 | grep -E "^#[0-9]+ (DONE|ERROR)|error" | tail -40
docker rm -f build-qemu-ink >/dev/null 2>&1 || true
docker run --rm -d --name build-qemu-ink -v "$WORK/qemu-wasm":/qemu/:ro buildqemu-ink >/dev/null
EXTRA_CFLAGS="-O3 -g -Wno-error=unused-command-line-argument -matomics -mbulk-memory -DNDEBUG -DG_DISABLE_ASSERT -D_GNU_SOURCE -sLZ4=1 -sASYNCIFY=1 -pthread -sPROXY_TO_PTHREAD=1 -sFORCE_FILESYSTEM -sALLOW_TABLE_GROWTH -sTOTAL_MEMORY=$MEM -sWASM_BIGINT -sMALLOC=emmalloc --js-library=/build/node_modules/xterm-pty/emscripten-pty.js -sEXPORT_ES6=1 -sASYNCIFY_IMPORTS=ffi_call_js"
docker exec build-qemu-ink emconfigure /qemu/configure --static --target-list=x86_64-softmmu --cpu=wasm32 --cross-prefix= \
  --without-default-features --enable-system --with-coroutine=fiber --enable-virtfs --enable-pixman --disable-fdt \
  --extra-cflags="$EXTRA_CFLAGS" --extra-cxxflags="$EXTRA_CFLAGS" --extra-ldflags="-sEXPORTED_RUNTIME_METHODS=getTempRet0,setTempRet0,addFunction,removeFunction,TTY,FS"
docker exec build-qemu-ink emmake make -j "$(nproc)" qemu-system-x86_64
docker cp build-qemu-ink:/build/qemu-system-x86_64 "$OUT/out.js"
for f in qemu-system-x86_64.wasm qemu-system-x86_64.worker.js; do docker cp "build-qemu-ink:/build/$f" "$OUT/"; done
mkdir -p "$OUT/rom"
cp "$WORK/qemu-wasm"/pc-bios/{bios-256k.bin,vgabios-stdvga.bin,kvmvapic.bin,linuxboot_dma.bin,efi-virtio.rom} "$OUT/rom/"
docker kill build-qemu-ink >/dev/null || true
ls -la "$OUT"
