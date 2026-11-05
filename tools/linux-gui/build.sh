#!/bin/sh
# Builds the Emulator › Linux system (run from tools/linux-gui/, on Linux with docker, as a user with sudo):
#   apps/emulador/linux/linux-gui-bzImage.bin  Linux 6.6 i386 (same base as the terminal, plus disk, screen and mouse)
#   work/linux-gui.img.gz                      Alpine 3.22 x86 root disk (ext4) with Openbox, tint2 and PCManFM
# Needs: gcc make flex bison bc libelf-dev git docker e2fsprogs
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/work}
SIZE_MB=${SIZE_MB:-3072}
mkdir -p "$WORK" && cd "$WORK"

# --- root disk: Alpine packages installed in an x86 container, then copied into an ext4 image ---
PKGS="alpine-base eudev dbus dbus-x11 xorg-server xf86-input-evdev xinit xrandr xsetroot
  openbox tint2 pcmanfm xterm font-dejavu font-misc-misc adwaita-icon-theme nano htop ca-certificates"
sudo docker rm -f inkgui 2>/dev/null || true
sudo docker run --name inkgui --platform linux/386 alpine:3.22 sh -c "apk add --no-cache $(echo $PKGS)"
sudo rm -rf rootfs && mkdir rootfs
sudo docker export inkgui | sudo tar -x -C rootfs
sudo docker rm inkgui
sudo cp -r "$HERE/overlay/." rootfs/
sudo chmod +x rootfs/sbin/inkinit rootfs/root/.xinitrc
printf 'nameserver 1.1.1.1\n' | sudo tee rootfs/etc/resolv.conf >/dev/null
printf '127.0.0.1 localhost inkdoshub\n' | sudo tee rootfs/etc/hosts >/dev/null
echo inkdoshub | sudo tee rootfs/etc/hostname >/dev/null
sudo du -sh rootfs
rm -f linux-gui.img
truncate -s ${SIZE_MB}M linux-gui.img
sudo mkfs.ext4 -q -L inkroot -O ^has_journal,^metadata_csum -d rootfs linux-gui.img
sudo chown "$(id -u)" linux-gui.img
gzip -9 -c linux-gui.img > linux-gui.img.gz
ls -la linux-gui.img.gz

# --- kernel: the terminal's base (without the built-in system) plus kernel-gui.config ---
[ -d linux ] || git clone --depth 1 --branch v6.6 https://github.com/torvalds/linux linux
cd linux
make ARCH=i386 tinyconfig
grep -v -e INITRD -e INITRAMFS "$HERE/../linux/kernel-extra.config" >> .config
cat "$HERE/kernel-gui.config" >> .config
make ARCH=i386 olddefconfig
for o in EXT4_FS DRM_BOCHS INPUT_EVDEV MOUSE_PS2 ZRAM ATA_PIIX 9P_FS; do
  grep -q "^CONFIG_$o=y" .config || { echo "missing CONFIG_$o"; exit 1; }
done
make ARCH=i386 -j"$(nproc)" bzImage
mkdir -p "$HERE/../../apps/emulador/linux"
cp arch/x86/boot/bzImage "$HERE/../../apps/emulador/linux/linux-gui-bzImage.bin"
echo "OK"
