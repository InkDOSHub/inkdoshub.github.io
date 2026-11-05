#!/bin/sh
# Builds the Linux terminal's Desktop system (run from tools/linux-gui/, on Linux with docker, as a user with sudo):
#   terminal/desktop/linux-gui-bzImage.bin      Linux 6.6 i386 (same base as the terminal, plus disk, screen and mouse)
#   work/linux-gui.img.gz                      Alpine 3.22 x86 root disk (ext4) with Xfce, the Greybird theme and Papirus icons
# Needs: gcc make flex bison bc libelf-dev git docker e2fsprogs
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/work}
SIZE_MB=${SIZE_MB:-3072}
mkdir -p "$WORK" && cd "$WORK"

# --- root disk: Alpine packages installed in an x86 container, then copied into an ext4 image ---
PKGS="alpine-base eudev dbus dbus-x11 xorg-server xf86-input-evdev xinit xrandr xsetroot xrdb
  xfce4-session xfwm4 xfce4-panel xfdesktop xfce4-settings xfconf thunar xfce4-terminal xfce4-whiskermenu-plugin mousepad
  greybird-themes-gtk3 greybird-themes-xfwm4 papirus-icon-theme adwaita-icon-theme font-dejavu nano htop ca-certificates e2fsprogs-extra"
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
sudo e2fsck -fy linux-gui.img || true
# ship only the used part (no long runs of zeros for the browser to expand); Linux grows it on first boot
sudo resize2fs -M linux-gui.img
BLOCOS=$(sudo dumpe2fs -h linux-gui.img 2>/dev/null | awk -F: '/^Block count/{print $2+0}')
truncate -s $((BLOCOS * 4096)) linux-gui.img
sudo chown "$(id -u)" linux-gui.img
gzip -9 -c linux-gui.img > linux-gui.img.gz
ls -la linux-gui.img.gz

# --- kernel: the terminal's base (without the built-in system) plus kernel-gui.config ---
# built in Debian 12 (gcc 12): Linux 6.6 does not compile with gcc 15, which uses C23 by default
[ -d linux ] || git clone --depth 1 --branch v6.6 https://github.com/torvalds/linux linux
grep -v -e INITRD -e INITRAMFS "$HERE/../linux/kernel-extra.config" > extra.config
cat "$HERE/kernel-gui.config" >> extra.config
sudo docker run --rm -v "$WORK:/w" -w /w/linux debian:bookworm sh -ec '
  apt-get update -qq && apt-get install -yqq gcc make flex bison bc libelf-dev >/dev/null
  make ARCH=i386 tinyconfig
  cat ../extra.config >> .config
  make ARCH=i386 olddefconfig
  for o in EXT4_FS DRM_BOCHS INPUT_EVDEV MOUSE_PS2 ZRAM ATA_PIIX 9P_FS; do
    grep -q "^CONFIG_$o=y" .config || { echo "missing CONFIG_$o"; exit 1; }
  done
  make ARCH=i386 -j"$(nproc)" bzImage'
cp linux/arch/x86/boot/bzImage "$HERE/../../terminal/desktop/linux-gui-bzImage.bin"
echo "OK"
