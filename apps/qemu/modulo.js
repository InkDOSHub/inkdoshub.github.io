// QEMU Wasm (x86_64, TCG JIT to WebAssembly) settings, from ktock/qemu-wasm-demo (Apache-2.0), without networking.
// Small scripts are served by the Hub; the big files (QEMU .wasm 41 MB, Linux disk 83 MB) come from the
// original demo site (it allows cross-origin reads), so they do not weigh on the Hub repository.
var REMOTO = "https://ktock.github.io/qemu-wasm-demo/images/alpine-x86_64/";
var LOCAL = new URL("alpine/", location.href).href;
if (typeof Module === "undefined") Module = {};
Module["arguments"] = [
  "-nographic", "-M", "pc", "-m", "512M", "-accel", "tcg,tb-size=500",
  "-L", "/pack-rom/", "-nic", "none",
  "-kernel", "/pack-kernel/vmlinuz-virt", "-initrd", "/pack-initramfs/initramfs-virt",
  "-append", "console=ttyS0 root=/dev/vda noautodetect hostname=inkdoshub",
  "-drive", "id=test,file=/pack-rootfs/disk-rootfs.img,format=raw,if=none", "-device", "virtio-blk-pci,drive=test"
];
Module["locateFile"] = function (path) { return (/\.(wasm|data)$/.test(path) ? REMOTO : LOCAL) + path; };
Module["mainScriptUrlOrBlob"] = LOCAL + "out.js";
Module["setStatus"] = function (t) { var e = document.getElementById("estado"); if (e && t) e.textContent = t; };
