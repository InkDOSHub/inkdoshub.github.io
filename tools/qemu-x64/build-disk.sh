#!/bin/bash
# Builds the Wine x64 machine (Alpine Linux 3.21 x86_64, Xorg and Wine 9 64-bit) with Docker:
# $OUT/vmlinuz-virt, $OUT/initramfs-virt and $OUT/disk-rootfs.img (ext4). The Wine prefix is made
# here, natively, so the emulated machine does not spend minutes creating it on the first start.
# The desktop uses the same wallpaper as Wine x32 (apps/wine/visual/visual.zip).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=${WORK:-/tmp/qemu-x64}
OUT=${OUT:-$WORK/out}
mkdir -p "$WORK" "$OUT"
rm -rf "$WORK/disk"; mkdir -p "$WORK/disk"
unzip -o -q "$ROOT/apps/wine/visual/visual.zip" -d "$WORK/disk/visual"
docker rm -f ink-x64-disk >/dev/null 2>&1 || true
# behind a proxy (local builds): pass it and its CA into the container
PROXY=()
if [ -n "${HTTPS_PROXY:-}" ]; then
  PROXY=(--network host -e HTTPS_PROXY -e HTTP_PROXY -e https_proxy="$HTTPS_PROXY" -e http_proxy="${HTTP_PROXY:-$HTTPS_PROXY}")
  [ -f "${PROXY_CA:-}" ] && PROXY+=(-v "$PROXY_CA":/proxy-ca.crt:ro)
fi
docker run --name ink-x64-disk "${PROXY[@]}" -v "$HERE/overlay":/overlay:ro -v "$WORK/disk/visual":/visual:ro alpine:3.21 sh -euc '
  [ -f /proxy-ca.crt ] && cat /proxy-ca.crt >> /etc/ssl/certs/ca-certificates.crt
  apk add -q --no-cache linux-virt eudev xorg-server xf86-input-libinput font-misc-misc font-cursor-misc wine xvfb-run >/dev/null
  cp -a /overlay/. /
  export HOME=/root WINEPREFIX=/root/.wine WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="
  xvfb-run -a sh -c "wineboot -i && wineserver -w"
  bmp=$(find /visual -iname "*.bmp" | head -1)
  [ -n "$bmp" ] && cp "$bmp" /root/.wine/drive_c/windows/altai.bmp
  xvfb-run -a sh -c "wine reg add \"HKCU\\Control Panel\\Desktop\" /v Wallpaper /t REG_SZ /d \"C:\\windows\\altai.bmp\" /f; wine reg add \"HKCU\\Software\\Wine\\DllOverrides\" /v winemenubuilder.exe /t REG_SZ /d \"\" /f; wineserver -w"
  apk del -q xvfb-run >/dev/null || true
  rm -rf /var/cache/apk/* /usr/share/man /usr/share/doc /root/.cache
  # smaller machine: 64-bit programs only (no 32-bit Wine parts), and no GPU drivers (the X server
  # draws without acceleration, so Mesa'"'"'s LLVM and Gallium drivers are never loaded)
  rm -rf /usr/lib/wine/i386-windows /root/.wine/drive_c/windows/syswow64 /usr/lib/libLLVM* /usr/lib/gallium-pipe \
    /usr/lib/libgallium* /usr/lib/dri /usr/lib/gstreamer-1.0 /usr/share/gtk-doc /usr/share/info
'
docker cp ink-x64-disk:/boot/vmlinuz-virt "$OUT/vmlinuz-virt"
docker cp ink-x64-disk:/boot/initramfs-virt "$OUT/initramfs-virt"
rm -rf "$WORK/rootfs"; mkdir -p "$WORK/rootfs"
docker export ink-x64-disk | tar -x -C "$WORK/rootfs" --exclude=boot --exclude=.dockerenv
docker rm ink-x64-disk >/dev/null
# the Wine prefix holds copies of Wine's own DLLs: make them hard links to the originals
python3 - "$WORK/rootfs" <<'PY'
import os, sys, hashlib
root = sys.argv[1]; vistos = {}; ganho = 0
for base in ("usr/lib/wine", "root/.wine"):
    for d, _, fs in os.walk(os.path.join(root, base)):
        for f in fs:
            p = os.path.join(d, f)
            if os.path.islink(p) or not os.path.isfile(p): continue
            st = os.stat(p)
            if st.st_size < 4096: continue
            h = hashlib.sha1(open(p, "rb").read()).hexdigest()
            k = (st.st_size, h)
            if k in vistos and os.stat(vistos[k]).st_ino != st.st_ino:
                os.unlink(p); os.link(vistos[k], p); ganho += st.st_size
            else: vistos.setdefault(k, p)
print("hard links saved %d MB" % (ganho >> 20))
PY
du -sm "$WORK/rootfs"
mb=$(( $(du -sm "$WORK/rootfs" | cut -f1) * 110 / 100 + 96 ))
rm -f "$OUT/disk-rootfs.img"
mkfs.ext4 -q -O ^has_journal -L inkx64 -d "$WORK/rootfs" "$OUT/disk-rootfs.img" "${mb}M"
ls -la "$OUT"
