// Terminal › Desktop: the terminal's engine (v86, x86 32-bit with a JIT to WebAssembly) with a screen,
// mouse and keyboard. System disk (Alpine 3.22 x86, ext4) downloaded once into the site storage (OPFS)
// and kept with what you install; swap disk and zram for memory. One emulator at a time (Web Locks).
// Session: the running machine (memory plus disks) is saved in this browser right after the desktop first
// appears, every few minutes and when the page is hidden, so the next start resumes in seconds instead of
// booting Linux again. Changes made after the last save are lost if the page closes before the next one.
import { V86 } from "../vendor/v86/libv86.mjs?v=5";

const V = "../";
const IMG = /workers\.dev$|^(localhost|127\.)/.test(location.hostname) ? "linux-gui.img.gz"
  : "https://inkdoshub-github-io.vfydr2m9wk.workers.dev/terminal/desktop/linux-gui.img.gz";
const RAM_MB = 768, SWAP = 2000 * 1024 * 1024, CHAVE = "inkdoshub-linux-disco", SESSAO = "inkdoshub-linux-sessao";
const ESTADO = "inkdoshub-linux-state.gz", DISCO = "inkdoshub-linux.img", TROCA = "inkdoshub-linux-swap.img";
const $ = (id) => document.getElementById(id);
const estado = (t) => { $("estado").textContent = t; };
const linhas = [];
const registra = (t) => { linhas.push(t); if (linhas.length > 600) linhas.shift(); $("log-txt").textContent = linhas.join(""); };

// --- disks in OPFS, through the worker ---
const w = new Worker("disco-worker.js?v=3");
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
  const r = await pedir({ op: "open", name: DISCO, size: info.size });
  let guardado; try { guardado = localStorage.getItem(CHAVE); } catch {}
  if (reinstalar || !guardado || r.size !== info.size) {
    try { localStorage.removeItem(CHAVE); localStorage.removeItem(SESSAO); } catch {}
    await pedir({ op: "dropState", name: ESTADO });
    const mb = (b) => Math.round(b / 1048576);
    aoProgresso = (b) => estado("Downloading the Linux system: " + mb(b) + " of " + mb(info.bytes) + " MB (only the first time)…");
    aoProgresso(0);
    const f = await pedir({ op: "fill", name: DISCO, url: IMG + "?v=" + info.disk, size: info.size });
    if (f.size !== info.raw) throw new Error("incomplete download, reload the page");
    try { localStorage.setItem(CHAVE, info.disk); } catch {}
    await pedir({ op: "open", name: DISCO, size: info.size });
  } else if (guardado !== info.disk) {
    $("aviso-novo").hidden = false;
  }
  return info.size;
}

async function iniciar() {
  const reinstalar = new URLSearchParams(location.search).has("reinstalar");
  if (reinstalar) history.replaceState(null, "", location.pathname);
  if (new URLSearchParams(location.search).has("novo")) { try { localStorage.removeItem(SESSAO); } catch {} history.replaceState(null, "", location.pathname); }
  const tamanho = await prepararSistema(reinstalar);
  // saved session: only valid for the same system disk and memory size
  let marca; try { marca = localStorage.getItem(SESSAO); } catch {}
  const valida = marca && marca === localStorage.getItem(CHAVE) + ":" + RAM_MB;
  let salvo = null;
  if (valida) { estado("Resuming your session…"); salvo = (await pedir({ op: "loadState", name: ESTADO })).buf; }
  await pedir({ op: "open", name: TROCA, size: SWAP, zero: !salvo });
  estado(salvo ? "Resuming your session…" : "Starting Linux… (the first start takes about a minute; then the session is saved and opens in seconds)");
  const emulator = new V86({
    wasm_path: V + "vendor/v86/v86.wasm",
    memory_size: RAM_MB * 1024 * 1024,
    vga_memory_size: 16 * 1024 * 1024,
    bios: { url: V + "bios/seabios.bin" },
    vga_bios: { url: V + "bios/vgabios.bin" },
    bzimage: { url: "linux-gui-bzImage.bin?v=" + (window.KV || 1) },
    cmdline: "console=ttyS0 root=/dev/sda rw rootfstype=ext4 init=/sbin/inkinit tsc=reliable mitigations=off random.trust_cpu=on inkzram=192M",
    hda: disco(DISCO, tamanho),
    hdb: disco(TROCA, SWAP),
    filesystem: {},
    net_device: { type: "virtio", relay_url: "wisps://inkdoshub-github-io.vfydr2m9wk.workers.dev/net/wisp/" },
    screen_container: $("tela"),
    disable_speaker: true,
    autostart: true,
    initial_state: salvo ? { buffer: salvo } : undefined,
  });
  window.inkdoshub = { emulator };
  const dec = new TextDecoder();
  let buf = "", agendado = false;
  emulator.add_listener("serial0-output-byte", (b) => {
    buf += dec.decode(new Uint8Array([b]), { stream: true });
    if (!agendado) { agendado = true; requestAnimationFrame(() => { registra(buf); buf = ""; agendado = false; }); }
  });
  // saving the session: pause, write the disks' new blocks, then the memory, and resume
  let salvando = false, ultimo = 0;
  const salvarSessao = async () => {
    if (salvando) return;
    salvando = true;
    try {
      estado("Saving the session so the next start is fast…");
      try { localStorage.removeItem(SESSAO); } catch {}
      emulator.stop();
      await new Promise((ok) => setTimeout(ok, 300));
      await pedir({ op: "merge" });
      const buf = await emulator.save_state();
      await pedir({ op: "saveState", name: ESTADO, buf }, [buf]);
      try { localStorage.setItem(SESSAO, localStorage.getItem(CHAVE) + ":" + RAM_MB); } catch {}
      ultimo = Date.now();
      estado("");
    } catch (e) {
      estado("Could not save the session: " + e.message);
    } finally {
      emulator.run();
      salvando = false;
    }
  };
  $("btn-salvar").onclick = salvarSessao;
  let telaOk = !!salvo;
  // the screen memory is not part of the saved session: after resuming, ask X to repaint every window
  if (salvo) emulator.add_listener("emulator-started", () => {
    estado(""); ultimo = Date.now();
    setTimeout(() => emulator.serial0_send("DISPLAY=:0 xrefresh\n"), 500);
  });
  emulator.add_listener("screen-set-size", (a) => {
    if (a && a[0] === 1280 && !telaOk) {
      telaOk = true;
      estado("Desktop starting… the session is saved in a moment.");
      setTimeout(salvarSessao, 60000); // after Xfce has finished opening
    }
  });
  setInterval(() => { if (telaOk && ultimo && Date.now() - ultimo > 5 * 60000 && !document.hidden) salvarSessao(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden && telaOk && ultimo && Date.now() - ultimo > 60000) salvarSessao(); });
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
  $("btn-teclado").onclick = () => $("teclado").focus();
  setInterval(() => pedir({ op: "flush" }).catch(() => {}), 10000);
}

$("btn-reinstalar").onclick = () => { location.search = "?reinstalar"; };
$("btn-reiniciar").onclick = () => { location.search = "?novo"; };
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
