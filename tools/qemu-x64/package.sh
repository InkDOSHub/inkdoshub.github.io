#!/bin/bash
# Packs the machine for the page with Emscripten's file_packager (inside the QEMU build image):
# load-kernel, load-initramfs, load-rom (small, kept in the site) and load-rootfs (LZ4, big:
# published as a release asset and served by worker.js). Copies everything to $SITE.
set -euo pipefail
OUT=${OUT:-/tmp/qemu-x64/out}
SITE=${SITE:-apps/wine/x64/maquina}
P="$OUT/pack"; rm -rf "$P"; mkdir -p "$P"/{pack-kernel,pack-initramfs,pack-rom,pack-rootfs}
cp "$OUT/vmlinuz-virt" "$P/pack-kernel/"; cp "$OUT/initramfs-virt" "$P/pack-initramfs/"
cp "$OUT"/rom/* "$P/pack-rom/"; mv "$OUT/disk-rootfs.img" "$P/pack-rootfs/"
docker run --rm -v "$P":/w -w /w buildqemu-ink sh -euc '
  for f in kernel initramfs rom rootfs; do
    flags=; [ "$f" = rootfs ] && flags=--lz4
    python3 /emsdk/upstream/emscripten/tools/file_packager.py load-$f.data $flags --preload /w/pack-$f@/pack-$f > load-$f.js
  done'
rm -rf "$SITE"; mkdir -p "$SITE"
cp "$OUT/out.js" "$OUT/qemu-system-x86_64.wasm" "$OUT/qemu-system-x86_64.worker.js" "$SITE/"
cp "$P"/load-*.js "$P"/load-kernel.data "$P"/load-initramfs.data "$P"/load-rom.data "$SITE/"
mv "$P/load-rootfs.data" "$OUT/load-rootfs.data"
ls -la "$SITE" "$OUT/load-rootfs.data"
