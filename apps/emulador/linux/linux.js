// Emulator › Linux: the terminal's engine (v86, x86 32-bit with a JIT to WebAssembly) with a screen,
// mouse and keyboard. System disk (Alpine 3.22 x86, ext4) downloaded once into the site storage (OPFS)
// and kept with what you install; swap disk and zram for memory. One emulator at a time (Web Locks).
import { V86 } from "../../../terminal/vendor/v86/libv86.mjs?v=5";

const V = "../../../terminal/";
const IMG = /workers\.dev$|^(localhost|127\.)/.test(location.hostname) ? "linux-gui.img.gz"
  : "https://inkdoshub-github-io.vfydr2m9wk.workers.dev/apps/emulador/linux/linux-gui.img.gz";
const RAM_MB = 1024, SWAP = 2000 * 1024 * 1024, CHAVE = "inkdoshub-linux-disco";
const $ = (id) => document.getElementById(id);
const estado = (t) => { $("estado").textContent = t; };
const linhas = [];
const registra = (t) => { linhas.push(t); if (linhas.length > 600) linhas.shift(); $("log-txt").textContent = linhas.join(""); };

// --- disks in OPFS, through the worker ---
const w = new Worker("disco-worker.js?v=2");
let seq = 0;
const espera = new Map();
w.onmessage = ({ data }) => {
  if (data.progress !== undefined) return aoProgresso(data.progress);
  const f = espera.get(data.id); espera.delete(data.id); f && f(data);
};
let aoProgresso = () => {};
const pedir = (m, tr) => new Promise((ok, erro) => { m.id = ++seq; espera.set(m.id, (r) => r.ok ? ok(r) : erro(new Error(r.error))); w.postMessage(m, tr || []); });
function disco(name, bytes) {
  return {
    byteLength: bytes, onload: null, onprogress: null,
    load() { this.onload && this.onload({}); },
    get(at, len, fn) { pedir({ op: "read", name, at, len }).then((r) => fn(r.buf), () => fn(new Uint8Array(len))); },
    set(at, slice, fn) { const buf = slice.slice(); pedir({ op: "write", name, at, buf }, [buf.buffer]).then(() => fn && fn(), () => fn && fn()); },
    get_and_cache(at, len, fn) { this.get(at, len, fn); },
    get_from_cache() { return undefined; },
    get_buffer(fn) { fn(undefined); },
    get_state() { return []; },
    set_state() {},
  };
}

async function prepararSistema(reinstalar) {
  const info = await (await fetch("disk.json?t=" + Date.now())).json();
  const r = await pedir({ op: "open", name: "inkdoshub-linux.img" });
  let guardado; try { guardado = localStorage.getItem(CHAVE); } catch {}
  if (reinstalar || !guardado || r.size !== info.size) {
    try { localStorage.removeItem(CHAVE); } catch {}
    const mb = (b) => Math.round(b / 1048576);
    aoProgresso = (b) => estado("Downloading the Linux system: " + mb(b) + " of " + mb(info.bytes) + " MB (only the first time)…");
    aoProgresso(0);
    const f = await pedir({ op: "fill", name: "inkdoshub-linux.img", url: IMG + "?v=" + info.disk, size: info.size });
    if (f.size !== info.raw) throw new Error("incomplete download, reload the page");
    try { localStorage.setItem(CHAVE, info.disk); } catch {}
  } else if (guardado !== info.disk) {
    $("aviso-novo").hidden = false;
  }
  return info.size;
}

async function iniciar() {
  const reinstalar = new URLSearchParams(location.search).has("reinstalar");
  if (reinstalar) history.replaceState(null, "", location.pathname);
  const tamanho = await prepararSistema(reinstalar);
  await pedir({ op: "open", name: "inkdoshub-linux-swap.img", zero: true });
  estado("Starting Linux…");
  const emulator = new V86({
    wasm_path: V + "vendor/v86/v86.wasm",
    memory_size: RAM_MB * 1024 * 1024,
    vga_memory_size: 16 * 1024 * 1024,
    bios: { url: V + "bios/seabios.bin" },
    vga_bios: { url: V + "bios/vgabios.bin" },
    bzimage: { url: "linux-gui-bzImage.bin?v=" + (window.KV || 1) },
    cmdline: "console=ttyS0 root=/dev/sda rw rootfstype=ext4 init=/sbin/inkinit tsc=reliable mitigations=off random.trust_cpu=on inkzram=192M",
    hda: disco("inkdoshub-linux.img", tamanho),
    hdb: disco("inkdoshub-linux-swap.img", SWAP),
    filesystem: {},
    net_device: { type: "virtio", relay_url: "wisps://inkdoshub-github-io.vfydr2m9wk.workers.dev/net/wisp/" },
    screen_container: $("tela"),
    disable_speaker: true,
    autostart: true,
  });
  window.inkdoshub = { emulator };
  const dec = new TextDecoder();
  let buf = "", agendado = false;
  emulator.add_listener("serial0-output-byte", (b) => {
    buf += dec.decode(new Uint8Array([b]), { stream: true });
    if (!agendado) { agendado = true; requestAnimationFrame(() => { registra(buf); buf = ""; agendado = false; }); }
  });
  let telaOk = false;
  emulator.add_listener("screen-set-size", (a) => {
    if (a && a[0] >= 800 && !telaOk) { telaOk = true; estado(""); }
  });
  // files from the device go to /root/Device
  $("btn-abrir").onclick = () => $("arquivo").click();
  $("arquivo").onchange = async function () {
    for (const f of this.files) {
      const nome = f.name.replace(/[^\w.\- ]/g, "_");
      await emulator.create_file("/" + nome, new Uint8Array(await f.arrayBuffer()));
      estado("Copied to /root/Device/" + nome);
    }
    this.value = "";
  };
  // shared folder with the Windows environment (../compartilhada.js): /root/Device
  emulator.add_listener("emulator-ready", async () => {
    const fs = emulator.fs9p;
    try {
      for (const f of await Compartilhada.carregar()) {
        const partes = f.path.split("/");
        let pai = 0;
        for (const nome of partes.slice(0, -1)) {
          const sub = fs.Search(pai, nome);
          pai = sub === -1 ? fs.CreateDirectory(nome, pai) : sub;
        }
        await emulator.create_file("/" + f.path, f.data);
      }
    } catch (e) { console.warn("shared folder:", e); }
    const listar = (dir) => {
      const out = [];
      for (const nome of fs.read_dir(dir) || []) {
        const c = (dir === "/" ? "" : dir) + "/" + nome, r = fs.SearchPath(c);
        if (r.id === -1 || nome === ".inkdoshub") continue;
        if (fs.IsDirectory(r.id)) out.push(...listar(c));
        else out.push({ path: c.slice(1), mtime: fs.GetInode(r.id).mtime + ":" + fs.GetInode(r.id).size, ler: () => emulator.read_file(c) });
      }
      return out;
    };
    const salvar = () => Compartilhada.salvar(listar("/"));
    salvar();
    setInterval(salvar, 5000);
    addEventListener("pagehide", salvar);
  });
  $("btn-teclado").onclick = () => $("teclado").focus();
  setInterval(() => pedir({ op: "flush" }).catch(() => {}), 10000);
}

$("btn-reinstalar").onclick = () => { location.search = "?reinstalar"; };
$("btn-reiniciar").onclick = () => location.reload();
$("btn-copiar").onclick = function () {
  const b = this;
  navigator.clipboard.writeText($("log-txt").textContent).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy log"; }, 1500); }, () => {});
};
const falha = (e) => { estado("Could not start: " + e.message); console.error(e); };
if (navigator.locks) {
  navigator.locks.request("inkdoshub-emulador", { ifAvailable: true }, (lock) => {
    if (!lock) { estado("Another emulator is open in another tab or window. Close it first, then reload this page."); return; }
    iniciar().catch(falha);
    return new Promise(() => {});
  });
} else iniciar().catch(falha);
