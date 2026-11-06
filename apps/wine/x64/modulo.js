// Wine x64 (experimental): QEMU Wasm (x86_64, TCG JIT to WebAssembly; github.com/ktock/qemu-wasm, GPL-2)
// built with a graphics console by .github/workflows/qemu-x64.yml. The machine (maquina/) is Alpine Linux
// x86_64 with Xorg and Wine 64-bit; tela.js shows its screen and sends mouse and keyboard over QMP.
// Single core by default; ?nucleos=4 adds virtual CPUs (multi-core, may not work in every browser).
// QEMU Wasm always needs SharedArrayBuffer, so a page without isolation moves to the Cloudflare address.
if (!self.crossOriginIsolated && !/workers\.dev$|^localhost$|^127\./.test(location.hostname)) {
  location.replace("https://inkdoshub-github-io.vfydr2m9wk.workers.dev" + location.pathname + location.search);
}
var MAQ = new URL("maquina/", location.href).href;
var NUCLEOS = Math.max(1, Math.min(4, +(new URLSearchParams(location.search).get("nucleos")) || 1));
var DISCO = "";
if (typeof Module === "undefined") Module = {};
Module["arguments"] = [
  "-M", "pc", "-m", "768M", "-smp", String(NUCLEOS), "-accel", "tcg,tb-size=256",
  "-display", "none", "-vga", "std", "-serial", "none", "-monitor", "none", "-qmp", "stdio",
  "-usb", "-device", "usb-tablet",
  "-L", "/pack-rom/", "-nic", "none",
  "-kernel", "/pack-kernel/vmlinuz-virt", "-initrd", "/pack-initramfs/initramfs-virt",
  "-append", "root=/dev/vda rootfstype=ext4 rw init=/sbin/inkinit modules=ext4 console=tty0 video=1024x768",
  "-drive", "id=d,file=/pack-rootfs/disk-rootfs.img,format=raw,if=none,snapshot=on", "-device", "virtio-blk-pci,drive=d"
];
Module["locateFile"] = function (path) { return MAQ + path + (/rootfs\.data$/.test(path) && DISCO ? "?v=" + DISCO : ""); };
Module["mainScriptUrlOrBlob"] = MAQ + "out.js";
Module["setStatus"] = function (t) {
  var e = document.getElementById("estado"); if (!e || !t) return;
  var m = /\((\d+)\/(\d+)\)/.exec(t);
  e.textContent = m ? "Downloading the machine… " + Math.round(m[1] / 1048576) + " of " + Math.round(m[2] / 1048576) + " MB" : t;
};
// the disk version changes the address, so a new build is not taken from the cache
try { var x = new XMLHttpRequest(); x.open("GET", MAQ + "disk.json?t=" + Date.now(), false); x.send(); DISCO = JSON.parse(x.responseText).rootfs || ""; } catch (e) {}
// QEMU keeps the disk changes (snapshot=on) in a temporary file under /var/tmp
Module["preRun"] = Module["preRun"] || [];
Module["preRun"].push(function () { try { Module.FS.mkdirTree("/var/tmp"); } catch (e) { try { FS.mkdirTree("/var/tmp"); } catch (e2) {} } });
