#!/bin/sh
# Recompila terminal/images/inkterminal-bzImage.bin: Linux 6.6 (i386) com o Alpine
# Linux 3.22 embutido como initramfs.
# Precisa de uma máquina Linux (ou runner de CI) com:
#   gcc make flex bison bc cpio libelf-dev git
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/work}
mkdir -p "$WORK" && cd "$WORK"
[ -d linux ] || git clone --depth 1 --branch v6.6 https://github.com/torvalds/linux linux
[ -d docker-alpine ] || git clone --depth 1 --branch v3.22 https://github.com/alpinelinux/docker-alpine docker-alpine

# Sistema de arquivos: Alpine minirootfs oficial (x86) + arquivos do InkTerminal
(cd docker-alpine && grep "x86/" checksums.sha512 | sha512sum -c -)
rm -rf rootfs && mkdir rootfs
tar xzf docker-alpine/x86/alpine-minirootfs-*-x86.tar.gz -C rootfs
cp -r "$HERE/alpine-overlay/." rootfs/
chmod +x rootfs/init

# Kernel
cd linux
make ARCH=i386 tinyconfig
sed "s|@ROOTFS@|$WORK/rootfs|; s|@LIST@|$HERE/initramfs.list|" "$HERE/kernel-extra.config" >> .config
make ARCH=i386 olddefconfig
make ARCH=i386 -j"$(nproc)" bzImage
cp arch/x86/boot/bzImage "$HERE/../terminal/images/inkterminal-bzImage.bin"
echo "OK: terminal/images/inkterminal-bzImage.bin"
