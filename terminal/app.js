import { V86 } from "./vendor/v86/libv86.mjs?v=5";
import { Terminal } from "./vendor/xterm/xterm.mjs";
import { FitAddon } from "./vendor/xterm/addon-fit.mjs";

const params = new URLSearchParams(location.search);
if (params.has("embed")) document.body.classList.add("embed");

const statusEl = document.getElementById("status");
const setStatus = (t) => { statusEl.textContent = t; };

// ---------- Terminal (xterm.js) ----------
const term = new Terminal({
  cursorBlink: true,
  fontFamily: 'ui-monospace, Menlo, "SF Mono", monospace',
  fontSize: Number(params.get("font")) || (Math.min(screen.width, screen.height) < 500 ? 12 : 15),
  // Cores seguem o tema do InkTerminal (../assets/tema.js)
  theme: document.documentElement.dataset.theme === "dark"
    ? { background: "#0d1117", foreground: "#e6edf3", cursor: "#3fb950", selectionBackground: "#264f78" }
    : { background: "#ffffff", foreground: "#192235", cursor: "#1a7f37", selectionBackground: "#b6d7ff",
        black: "#192235", brightBlack: "#697486", white: "#d0d7de", brightWhite: "#eef1f5",
        green: "#1a7f37", brightGreen: "#1f883d", blue: "#0550ae", brightBlue: "#0969da",
        yellow: "#9a6700", brightYellow: "#7d4e00" },
  scrollback: 5000,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("term"));
fit.fit();
term.focus();
document.getElementById("term").addEventListener("click", () => term.focus());

// ---------- Saved state (IndexedDB) ----------
// KEY muda quando a máquina muda (kernel/dispositivos), porque um estado antigo não serve mais.
const DB = "inkterminal", STORE = "state", KEY = "vm-v4";
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

// ---------- Emulator (v86) ----------
const saved = params.has("fresh") ? undefined : await loadState();
// Rede: como os outros emuladores de Linux no navegador, o Linux sai para a
// internet por um servidor de rede público (o mesmo que o copy.sh/v86 oferece).
//   "wisp"  -> wisps://wisp.mercurywork.shop/v86/ (padrão, TCP completo, http e https)
//   "relay" -> wss://relay.widgetry.org/ (ethernet completa)
//   "off"   -> sem rede
// Também aceita uma URL wss://, wisp:// ou wisps:// de outro servidor.
const REDES = { wisp: "wisps://wisp.mercurywork.shop/v86/", relay: "wss://relay.widgetry.org/", off: undefined };
let savedRede;
try { savedRede = localStorage.getItem("inkterminal-rede2"); } catch {}
const REDE = params.get("rede") || savedRede || "wisp";
const relayUrl = REDE in REDES ? REDES[REDE] : REDE;
const config = {
  wasm_path: "vendor/v86/v86.wasm",
  memory_size: 256 * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  bios: { url: "bios/seabios.bin" },
  vga_bios: { url: "bios/vgabios.bin" },
  bzimage: { url: "images/inkterminal-bzImage.bin?v=4" },
  cmdline: "console=ttyS0 quiet tsc=reliable mitigations=off random.trust_cpu=on",
  filesystem: {},
  net_device: relayUrl ? { type: "virtio", relay_url: relayUrl } : undefined,
  disable_keyboard: true,
  disable_mouse: true,
  disable_speaker: true,
  autostart: true,
};
if (saved) config.initial_state = { buffer: saved };

setStatus(saved ? "Restaurando sessão salva…" : "Iniciando Linux…");
const emulator = new V86(config);

// Serial output -> terminal, batched per frame so it stays fast.
let pending = [];
let scheduled = false;
let booted = !!saved;
emulator.add_listener("serial0-output-byte", (byte) => {
  pending.push(byte);
  if (!booted) { booted = true; setStatus("Pronto"); }
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
  if (saved) { setStatus("Pronto (sessão restaurada)"); emulator.serial0_send("\n"); }
});

// ---------- Input ----------
let ctrl = false;
const ctrlBtn = document.getElementById("key-ctrl");
const setCtrl = (v) => { ctrl = v; ctrlBtn.classList.toggle("on", v); };

function send(data) { emulator.serial0_send(data); }

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
  try {
    setStatus("Salvando…");
    const buf = await emulator.save_state();
    await saveStateDb(buf);
    setStatus(`Salvo (${(buf.byteLength / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    console.error(err);
    setStatus("Não foi possível salvar");
  }
  term.focus();
});
document.getElementById("btn-reset").addEventListener("click", async () => {
  await clearStateDb().catch(() => {});
  location.search = params.has("embed") ? "?embed=1&fresh=1" : "?fresh=1";
});

// ---------- Arquivos do iPad (pasta /mnt/ipad, atalho ~/ipad) ----------
const picker = document.getElementById("file-picker");
document.getElementById("btn-upload").addEventListener("click", () => picker.click());
picker.addEventListener("change", async () => {
  for (const file of picker.files) {
    const data = new Uint8Array(await file.arrayBuffer());
    await emulator.create_file("/" + file.name, data);
  }
  setStatus(picker.files.length === 1 ? `Enviado: ~/ipad/${picker.files[0].name}` : `Enviados ${picker.files.length} arquivos para ~/ipad`);
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
    if (p.id === -1) continue;
    if (fs.IsDirectory(p.id)) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}
document.getElementById("btn-download").addEventListener("click", () => {
  const files = listFiles("/");
  list.innerHTML = "";
  if (!files.length) {
    list.innerHTML = "<p>A pasta ~/ipad está vazia. No terminal, copie um arquivo para lá, por exemplo:<br><code>cp notas.txt ~/ipad/</code></p>";
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
// Um botão (o XeOS redesenha os <select>): cada toque passa para a próxima opção e liga de novo.
const redeBtn = document.getElementById("rede");
const NOMES = { wisp: "Rede: wisp", relay: "Rede: relay", off: "Sem rede" };
const atualRede = REDE in REDES ? REDE : "wisp";
redeBtn.textContent = REDE in NOMES ? NOMES[REDE] : "Rede: própria";
redeBtn.addEventListener("click", () => {
  const ordem = ["wisp", "relay", "off"];
  const prox = ordem[(ordem.indexOf(atualRede) + 1) % ordem.length];
  try { localStorage.setItem("inkterminal-rede2", prox); } catch {}
  const q = new URLSearchParams(location.search);
  q.delete("rede");
  location.search = q.toString();
});

window.inkterminal = { emulator, term };
