// Wine x64 (experimental): QEMU Wasm (x86_64, TCG JIT to WebAssembly) from ktock/qemu-wasm-demo (Apache-2.0).
// Small scripts are served by the Hub; the big files (QEMU .wasm 41 MB, Linux disk 83 MB) come from the
// demo site (it allows cross-origin reads). Single core by default; ?nucleos=4 turns on multi-core (MTTCG).
// QEMU Wasm always needs SharedArrayBuffer, so a page without isolation moves to the Cloudflare address.
if (!self.crossOriginIsolated && !/workers\.dev$|^localhost$|^127\./.test(location.hostname)) {
  location.replace("https://inkdoshub-github-io.vfydr2m9wk.workers.dev" + location.pathname + location.search);
}
var REMOTO = "https://ktock.github.io/qemu-wasm-demo/images/alpine-x86_64/";
var LOCAL = new URL("alpine/", location.href).href;
var NUCLEOS = Math.max(1, Math.min(4, +(new URLSearchParams(location.search).get("nucleos")) || 1));
if (typeof Module === "undefined") Module = {};
Module["arguments"] = [
  "-nographic", "-M", "pc", "-m", "512M", "-smp", String(NUCLEOS),
  "-accel", "tcg,tb-size=500,thread=" + (NUCLEOS > 1 ? "multi" : "single"),
  "-L", "/pack-rom/", "-nic", "none",
  "-kernel", "/pack-kernel/vmlinuz-virt", "-initrd", "/pack-initramfs/initramfs-virt",
  "-append", "console=ttyS0 root=/dev/vda noautodetect hostname=inkdoshub",
  "-drive", "id=test,file=/pack-rootfs/disk-rootfs.img,format=raw,if=none", "-device", "virtio-blk-pci,drive=test"
];
Module["locateFile"] = function (path) { return (/\.(wasm|data)$/.test(path) ? REMOTO : LOCAL) + path; };
Module["mainScriptUrlOrBlob"] = LOCAL + "out.js";
Module["setStatus"] = function (t) { var e = document.getElementById("estado"); if (e && t) e.textContent = t; };
