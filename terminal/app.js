import { V86 } from "./vendor/v86/libv86.mjs?v=5";
import { Terminal } from "./vendor/xterm/xterm.mjs";
import { FitAddon } from "./vendor/xterm/addon-fit.mjs";

const params = new URLSearchParams(location.search);
const t = window.InkIdioma ? InkIdioma.t : (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => (p && k in p ? String(p[k]) : m));
const local = window.InkIdioma ? InkIdioma.atual : undefined;
if (params.has("embed")) document.body.classList.add("embed");

const statusEl = document.getElementById("status");
const setStatus = (s) => { statusEl.textContent = s; };

// ---------- Terminal (xterm.js) ----------
const term = new Terminal({
  // Apple Terminal look ("Basic" profile): SF Mono/Menlo, gray block cursor, Terminal.app ANSI colors
  cursorBlink: false,
  cursorStyle: "block",
  fontFamily: '"SF Mono", Menlo, ui-monospace, monospace',
  fontSize: Number(params.get("font")) || (Math.min(screen.width, screen.height) < 500 ? 12 : 14),
  lineHeight: 1.12,
  // Cores seguem o tema do InkDOS Hub (../assets/tema.js)
  theme: Object.assign({
    black: "#000000", red: "#990000", green: "#00a600", yellow: "#999900", blue: "#0000b2", magenta: "#b200b2", cyan: "#00a6b2", white: "#bfbfbf",
    brightBlack: "#666666", brightRed: "#e50000", brightGreen: "#00d900", brightYellow: "#e5e500", brightBlue: "#0000ff", brightMagenta: "#e500e5", brightCyan: "#00e5e5", brightWhite: "#e5e5e5",
  }, document.documentElement.dataset.theme === "dark"
    ? { background: "#1e1e1e", foreground: "#f2f2f2", cursor: "#a6a6a6", cursorAccent: "#1e1e1e", selectionBackground: "#3f638b", blue: "#4f7dff", brightBlue: "#6f95ff" }
    : { background: "#ffffff", foreground: "#000000", cursor: "#7f7f7f", cursorAccent: "#ffffff", selectionBackground: "#b4d5fe" }),
  scrollback: 5000,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("term"));
fit.fit();
term.focus();
document.getElementById("term").addEventListener("click", () => term.focus());

// ---------- Saved state (IndexedDB) ----------
// KEY changes when the machine changes (kernel/devices), because an old state no longer works.
const DB = "inkdoshub", STORE = "state", KEY = "vm-v4";
function idb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((ok, fail) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = () => fail(tx.error);
  });
}
const loadState = () => idbOp("readonly", (s) => s.get(KEY)).catch(() => undefined);
const saveStateDb = (buf) => idbOp("readwrite", (s) => s.put(buf, KEY));
const clearStateDb = () => idbOp("readwrite", (s) => s.delete(KEY));

// ---------- Memory ----------
// "normal": 256 MB, as before, and the session can be saved.
// "maxima": 1.5 GB of RAM for Linux, plus zram (compressed memory) and a 2 GB
// swap disk in the site storage (OPFS), where Linux sends what
// is rarely used. In this mode the session is not saved, because swap is rebuilt on every boot.
let savedMem;
try { savedMem = localStorage.getItem("inkdoshub-memoria"); } catch {}
const MEM = params.get("memoria") || savedMem || "normal";
// ?ram=<MB> (pilot): bigger RAM, same rules as the limited mode (swap, no saved session)
const RAM_MB = Math.min(Math.max(+params.get("ram") || 0, 0), 2048) || (MEM === "maxima" || MEM === "limitada" ? 1536 : 0);
const LIMITADA = RAM_MB > 0;
const SWAP_BYTES = 2000 * 1024 * 1024;

function abrirSwap() {
  const w = new Worker("swap-worker.js?v=1");
  let seq = 0;
  const espera = new Map();
  w.onmessage = ({ data }) => { const f = espera.get(data.id); espera.delete(data.id); f && f(data); };
  const pedir = (m, transf) => new Promise((ok) => { m.id = ++seq; espera.set(m.id, ok); w.postMessage(m, transf || []); });
  const disco = {
    byteLength: SWAP_BYTES,
    onload: null, onprogress: null,
    lidos: 0, gravados: 0,
    load() { this.onload && this.onload({}); },
    get(start, len, fn) {
      pedir({ op: "read", at: start, len }).then((r) => { this.lidos += len; fn(r.ok ? r.buf : new Uint8Array(len)); });
    },
    set(start, slice, fn) {
      const buf = slice.slice();
      pedir({ op: "write", at: start, buf }, [buf.buffer]).then(() => { this.gravados += buf.length; fn && fn(); });
    },
    get_and_cache(start, len, fn) { this.get(start, len, fn); },
    get_from_cache() { return undefined; },
    get_buffer(fn) { fn(undefined); },
    get_state() { return []; },
    set_state() {},
    tamanho: () => pedir({ op: "size" }).then((r) => r.size),
  };
  return pedir({ op: "open", name: "inkdoshub-swap.img" }).then((r) => {
    if (!r.ok) { w.terminate(); throw new Error(r.error); }
    return disco;
  });
}

// ---------- Emulator (v86) ----------
const saved = params.has("fresh") || LIMITADA ? undefined : await loadState();
let swap = null;
if (LIMITADA) {
  try { swap = await abrirSwap(); } catch (err) { console.warn("storage swap unavailable:", err); }
}
// Network: like other in-browser Linux emulators, Linux reaches the
// internet through a public network server (the same one copy.sh/v86 offers).
//   "wisp"  -> wisps://wisp.mercurywork.shop/v86/ (default, full TCP, http and https)
//   "relay" -> wss://relay.widgetry.org/ (ethernet completa)
//   "off"   -> no network
// Only the known names are accepted (see below).
const REDES = { wisp: "wisps://wisp.mercurywork.shop/v86/", relay: "wss://relay.widgetry.org/", off: undefined };
let savedRede;
try { savedRede = localStorage.getItem("inkdoshub-rede2"); } catch {}
// Only known names: a link with ?rede=<address> cannot send Linux traffic to another server.
const REDE = [params.get("rede"), savedRede].find((r) => Object.hasOwn(REDES, r)) || "wisp";
const relayUrl = REDES[REDE];
const config = {
  wasm_path: "vendor/v86/v86.wasm",
  memory_size: (RAM_MB || 256) * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  bios: { url: "bios/seabios.bin" },
  vga_bios: { url: "bios/vgabios.bin" },
  bzimage: { url: "images/inkdoshub-bzImage.bin?v=9" },
  cmdline: "console=ttyS0 quiet tsc=reliable mitigations=off random.trust_cpu=on" +
    (LIMITADA ? " inkzram=192M" + (swap ? " inkswap=1" : "") : ""),
  hda: swap || undefined,
  filesystem: {},
  net_device: relayUrl ? { type: "virtio", relay_url: relayUrl } : undefined,
  disable_keyboard: true,
  disable_mouse: true,
  disable_speaker: true,
  autostart: true,
};
if (saved) config.initial_state = { buffer: saved };

setStatus(saved ? t("Restoring saved session…") : LIMITADA && !swap ? t("Starting (no swap in storage, zram only)…") : t("Starting Linux…"));
const emulator = new V86(config);

// Serial output -> terminal, batched per frame so it stays fast.
let pending = [];
let scheduled = false;
let booted = !!saved;
emulator.add_listener("serial0-output-byte", (byte) => {
  pending.push(byte);
  if (!booted) { booted = true; setStatus(t("Ready")); }
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(() => {
      term.write(new Uint8Array(pending));
      pending = [];
      scheduled = false;
    });
  }
});
emulator.add_listener("emulator-ready", () => {
  if (saved) { setStatus(t("Ready (session restored)")); emulator.serial0_send("\n"); }
});

// ---------- Input ----------
let ctrl = false;
const ctrlBtn = document.getElementById("key-ctrl");
const setCtrl = (v) => { ctrl = v; ctrlBtn.classList.toggle("on", v); };

// The v86 serial port has a small queue: a large pasted text loses letters if sent at once.
// So everything goes through a queue that sends 256 characters every 15 ms.
let fila = "";
let enviando = false;
function send(data) {
  fila += data;
  if (enviando) return;
  enviando = true;
  (function drenar() {
    const parte = fila.slice(0, 256);
    fila = fila.slice(256);
    emulator.serial0_send(parte);
    if (fila) setTimeout(drenar, 15); else enviando = false;
  })();
}

// Paste: xterm.js turns \n into Enter and uses "bracketed paste" when the shell asks.
function colar(texto) {
  if (!texto) return;
  setCtrl(false);
  term.paste(texto);
  term.focus();
}
document.getElementById("key-colar").addEventListener("click", async () => {
  try {
    // In Safari the "Paste" bubble appears to confirm; it is how iOS releases the clipboard.
    colar(await navigator.clipboard.readText());
  } catch (_) {
    const colado = prompt(t("The browser did not allow reading the clipboard. Paste the text here:"));
    colar(colado);
  }
});
// Paste from the long-press menu or Cmd+V anywhere in the terminal.
document.getElementById("term").addEventListener("paste", (e) => {
  if (e.defaultPrevented) return; // xterm.js already handled it
  const txt = e.clipboardData && e.clipboardData.getData("text/plain");
  if (txt) { e.preventDefault(); colar(txt); }
});

term.onData((data) => {
  if (ctrl && data.length === 1) {
    const c = data.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) data = String.fromCharCode(c - 64);
    setCtrl(false);
  }
  send(data);
});

const KEYS = {
  esc: "\x1b", tab: "\t", up: "\x1b[A", down: "\x1b[B",
  right: "\x1b[C", left: "\x1b[D", "ctrl-c": "\x03",
};
document.getElementById("keys").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.key === "ctrl") setCtrl(!ctrl);
  else if (b.dataset.key) send(KEYS[b.dataset.key]);
  else if (b.dataset.text) send(b.dataset.text);
  term.focus();
});
// Keep the soft keyboard open when tapping the extra keys.
document.getElementById("keys").addEventListener("mousedown", (e) => e.preventDefault());

// ---------- Resize ----------
// On iOS the soft keyboard covers the page instead of shrinking it, so size
// the layout to the visible area. That keeps the extra-keys bar above the keyboard.
const vv = window.visualViewport;
function refit() {
  if (vv) {
    document.body.style.height = vv.height + "px";
    window.scrollTo(0, 0);
  }
  fit.fit();
}
window.addEventListener("resize", refit);
if (vv) { vv.addEventListener("resize", refit); vv.addEventListener("scroll", () => window.scrollTo(0, 0)); }
refit();
// The guest runs `resize` at login (see /etc/profile); after a layout change,
// typing `resize` updates the size inside Linux.

// ---------- Buttons ----------
document.getElementById("btn-save").addEventListener("click", async () => {
  if (LIMITADA) { setStatus(t("The session is not saved in limited memory mode")); term.focus(); return; }
  try {
    setStatus(t("Saving…"));
    const buf = await emulator.save_state();
    await saveStateDb(buf);
    setStatus(t("Saved ({size} MB)", { size: (buf.byteLength / 1048576).toLocaleString(local, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }));
  } catch (err) {
    console.error(err);
    setStatus(t("Could not save"));
  }
  term.focus();
});
document.getElementById("btn-reset").addEventListener("click", async () => {
  await clearStateDb().catch(() => {});
  location.search = params.has("embed") ? "?embed=1&fresh=1" : "?fresh=1";
});

// ---------- Arquivos do dispositivo (pasta /mnt/ipad, atalho ~/files) ----------
const picker = document.getElementById("file-picker");
document.getElementById("btn-upload").addEventListener("click", () => picker.click());
picker.addEventListener("change", async () => {
  for (const file of picker.files) {
    const data = new Uint8Array(await file.arrayBuffer());
    await emulator.create_file("/" + file.name, data);
  }
  setStatus(picker.files.length === 1 ? t("Uploaded: ~/files/{name}", { name: picker.files[0].name }) : t("Uploaded {n} files to ~/files", { n: picker.files.length.toLocaleString(local) }));
  picker.value = "";
  term.focus();
});

const dialog = document.getElementById("download-dialog");
const list = document.getElementById("download-list");
function listFiles(dir) {
  const fs = emulator.fs9p;
  const out = [];
  for (const name of fs.read_dir(dir) || []) {
    const path = (dir === "/" ? "" : dir) + "/" + name;
    const p = fs.SearchPath(path);
    if (p.id === -1 || path === "/.inkdoshub") continue; // Session button folder
    if (fs.IsDirectory(p.id)) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}
document.getElementById("btn-download").addEventListener("click", () => {
  const files = listFiles("/");
  list.innerHTML = "";
  if (!files.length) {
    const p = document.createElement("p");
    p.textContent = t("The ~/files folder is empty. In the terminal, copy a file there, for example:");
    p.insertAdjacentHTML("beforeend", "<br><code>cp notes.txt ~/files/</code>");
    list.appendChild(p);
  }
  for (const path of files) {
    const b = document.createElement("button");
    b.className = "ink-btn";
    b.textContent = path.slice(1);
    b.addEventListener("click", async () => {
      const data = await emulator.read_file(path);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      dialog.close();
    });
    list.appendChild(b);
  }
  dialog.showModal();
});
document.getElementById("download-close").addEventListener("click", () => dialog.close());

// ---------- Escolha da rede ----------
// One button (XeOS redraws <select>s): each tap moves to the next option and boots again.
const redeBtn = document.getElementById("rede");
const NOMES = { wisp: t("Network: {name}", { name: "wisp" }), relay: t("Network: {name}", { name: "relay" }), off: t("No network") };
redeBtn.textContent = NOMES[REDE];
redeBtn.addEventListener("click", () => {
  const ordem = ["wisp", "relay", "off"];
  const prox = ordem[(ordem.indexOf(REDE) + 1) % ordem.length];
  try { localStorage.setItem("inkdoshub-rede2", prox); } catch {}
  const q = new URLSearchParams(location.search);
  q.delete("rede");
  location.search = q.toString();
});

// ---------- Memory choice ----------
const memBtn = document.getElementById("memoria");
memBtn.textContent = t("Memory: {size}", { size: RAM_MB ? (RAM_MB === 1536 ? "1.5 GB + 2 GB swap" : RAM_MB + " MB + swap") : "256 MB" });
memBtn.addEventListener("click", () => {
  // two modes: 256 MB <-> 1.5 GB + 2 GB swap
  const next = RAM_MB ? "normal" : "maxima";
  try { localStorage.setItem("inkdoshub-memoria", next); } catch {}
  const q = new URLSearchParams(location.search);
  q.delete("memoria"); q.delete("ram");
  location.search = q.toString();
});
if (LIMITADA) document.getElementById("btn-save").title = t("The session is not saved in this mode (swap is rebuilt on every boot)");

// ---------- Session file (assets/sessao.js) ----------
// Linux runs /usr/local/sbin/inksessao (tools/linux/), which talks through the /mnt/ipad/.inkdoshub folder:
// the page writes "pedido" (save or restore) and reads "estado" ("trabalhando ...", "ok ...",
// "aviso ..." or "erro ..."). The recipe is a .tar.gz with the apk package list, /root, /home and /usr/local.
const SESSAO = "/.inkdoshub";
const fs9 = () => emulator.fs9p;
function pastaSessao() {
  if (fs9().SearchPath(SESSAO).id === -1) fs9().CreateDirectory(SESSAO.slice(1), 0);
}
async function gravar9p(caminho, dados) {
  pastaSessao();
  const p = fs9().SearchPath(caminho);
  if (p.id !== -1) fs9().Unlink(p.parentid, caminho.split("/").pop());
  await emulator.create_file(caminho, dados);
}
async function ler9p(caminho) {
  if (fs9().SearchPath(caminho).id === -1) return null;
  // file empty or deleted by Linux in the middle of the read
  return emulator.read_file(caminho).catch(() => null);
}
const texto9p = async (c) => { const b = await ler9p(c); return b ? new TextDecoder().decode(b).trim() : null; };
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// A Linux restored from an old "Save" (before this feature) does not have inksessao running.
// In that case the page sends the same program through the folder and types the command that starts it.
async function pedirAoLinux(pedido, aviso) {
  await gravar9p(SESSAO + "/estado", new TextEncoder().encode("esperando"));
  await gravar9p(SESSAO + "/pedido", new TextEncoder().encode(pedido));
  let ligou = false;
  for (let i = 0; ; i++) {
    await espera(1000);
    const e = await texto9p(SESSAO + "/estado");
    if (e && e !== "esperando") {
      if (!e.startsWith("trabalhando")) return e;
      const log = pedido === "restaurar" ? await texto9p(SESSAO + "/apk.log") : null;
      const ultima = log ? log.split("\n").pop() : "";
      aviso.texto(e.replace(/^trabalhando /, "").replace(/^./, (c) => c.toUpperCase()) + "…" + (ultima ? "\n" + ultima : ""));
      continue;
    }
    if (i === 6 && !ligou && await texto9p(SESSAO + "/pedido")) {
      ligou = true;
      if (!await InkSessao.perguntar(t("Turn on session saving"), t("This Linux was saved before the Session button existed. To continue, a command will be typed in the terminal. Quit any open programs (such as nano or vi) first."), t("Type the command"))) {
        throw new Error(t("Canceled."));
      }
      const r = await fetch("../tools/linux/alpine-overlay/usr/local/sbin/inksessao?v=4");
      if (!r.ok) throw new Error(t("could not download inksessao ({status})", { status: r.status }));
      await gravar9p(SESSAO + "/inksessao", new Uint8Array(await r.arrayBuffer()));
      send("(sh /mnt/ipad/.inkdoshub/inksessao </dev/null >/dev/null 2>&1 &)\n");
    }
    if (i > 40 && !ligou) throw new Error(t("Linux did not respond. Wait for it to finish starting and try again."));
    if (i > 60) throw new Error(t("Linux did not respond."));
  }
}

const sessaoDialog = document.getElementById("sessao-dialog");
document.getElementById("btn-sessao").addEventListener("click", () => sessaoDialog.showModal());
document.getElementById("sessao-fechar").addEventListener("click", () => sessaoDialog.close());
document.getElementById("sessao-salvar").addEventListener("click", () => {
  sessaoDialog.close();
  InkSessao.salvar("linux", "Linux", async (aviso) => {
    aviso.texto(t("Asking Linux for the package list and the home folder…"));
    const e = await pedirAoLinux("salvar", aviso);
    if (!e.startsWith("ok")) throw new Error(e.replace(/^erro ?/, "") || t("error in Linux"));
    const receita = await ler9p(SESSAO + "/receita.tar.gz");
    if (!receita) throw new Error(t("Linux did not create the file"));
    const pacotes = Number(e.split(" ")[2]) || 0;
    gravar9p(SESSAO + "/receita.tar.gz", new Uint8Array(0)).catch(() => {});
    return { meta: { versao: 1, pacotes }, partes: { "receita.tar.gz": receita } };
  }).finally(() => term.focus());
});
document.getElementById("sessao-abrir").addEventListener("click", async () => {
  sessaoDialog.close();
  const r = await InkSessao.abrir("linux", "Linux");
  if (!r) { term.focus(); return; }
  const receita = r.partes["receita.tar.gz"];
  const aviso = InkSessao.aviso(t("Opening the session"), t("Sending the file to Linux…"));
  try {
    if (!receita) throw new Error(t("the file does not contain the Linux recipe"));
    await gravar9p(SESSAO + "/receita.tar.gz", receita);
    const e = await pedirAoLinux("restaurar", aviso);
    if (e.startsWith("ok")) aviso.fim(t("Done: packages installed and files restored. Tap Save to keep this Linux in the browser."));
    else if (e.startsWith("aviso")) aviso.fim(t("Your files were restored, but the packages could not be installed (no internet?). The list was saved to {file}. With the network on, run: {command}", { file: "~/session-packages.txt", command: "apk add $(cat ~/session-packages.txt)" }), true);
    else throw new Error(e.replace(/^erro ?/, ""));
  } catch (err) {
    console.error("session:", err);
    aviso.fim(t("Could not open the session: {error}", { error: err && err.message || err }), true);
  }
  term.focus();
});

window.inkdoshub = { emulator, term, swap };
