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
  // Visual do Terminal da Apple (perfil "Basic"): SF Mono/Menlo, cursor em bloco cinza, cores ANSI do Terminal.app
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
// KEY muda quando a máquina muda (kernel/dispositivos), porque um estado antigo não serve mais.
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

// ---------- Memória ----------
// "normal": 256 MB, como antes, e a sessão pode ser salva.
// "limitada": 640 MB de RAM para o Linux (a aba fica perto de 1 GB), mais zram (memória comprimida) e um disco
// de swap de 1 GB no armazenamento do site (OPFS), para onde o Linux manda o que
// está pouco usado. Nesse modo a sessão não é salva, porque o swap é refeito a cada boot.
let savedMem;
try { savedMem = localStorage.getItem("inkdoshub-memoria"); } catch {}
const MEM = params.get("memoria") || savedMem || "normal";
const LIMITADA = MEM === "limitada";
const SWAP_BYTES = 1024 * 1024 * 1024;

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
  try { swap = await abrirSwap(); } catch (err) { console.warn("swap no armazenamento indisponível:", err); }
}
// Rede: como os outros emuladores de Linux no navegador, o Linux sai para a
// internet por um servidor de rede público (o mesmo que o copy.sh/v86 oferece).
//   "wisp"  -> wisps://wisp.mercurywork.shop/v86/ (padrão, TCP completo, http e https)
//   "relay" -> wss://relay.widgetry.org/ (ethernet completa)
//   "off"   -> sem rede
// Também aceita uma URL wss://, wisp:// ou wisps:// de outro servidor.
const REDES = { wisp: "wisps://wisp.mercurywork.shop/v86/", relay: "wss://relay.widgetry.org/", off: undefined };
let savedRede;
try { savedRede = localStorage.getItem("inkdoshub-rede2"); } catch {}
const REDE = params.get("rede") || savedRede || "wisp";
const relayUrl = REDE in REDES ? REDES[REDE] : REDE;
const config = {
  wasm_path: "vendor/v86/v86.wasm",
  memory_size: (LIMITADA ? 640 : 256) * 1024 * 1024,
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

// A porta serial do v86 tem uma fila pequena: um texto colado grande perde letras se for de uma vez.
// Então tudo passa por uma fila que manda 256 caracteres a cada 15 ms.
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

// Colar: o xterm.js troca \n por Enter e usa o "bracketed paste" quando o shell pede.
function colar(texto) {
  if (!texto) return;
  setCtrl(false);
  term.paste(texto);
  term.focus();
}
document.getElementById("key-colar").addEventListener("click", async () => {
  try {
    // No Safari aparece a bolha "Colar" para confirmar; é o jeito do iOS liberar a área de transferência.
    colar(await navigator.clipboard.readText());
  } catch (_) {
    const colado = prompt(t("The browser did not allow reading the clipboard. Paste the text here:"));
    colar(colado);
  }
});
// Colar pelo menu do toque longo ou pelo Cmd+V em qualquer lugar do terminal.
document.getElementById("term").addEventListener("paste", (e) => {
  if (e.defaultPrevented) return; // o xterm.js já tratou
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
    if (p.id === -1 || path === "/.inkdoshub") continue; // pasta do botão Sessão
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
// Um botão (o XeOS redesenha os <select>): cada toque passa para a próxima opção e liga de novo.
const redeBtn = document.getElementById("rede");
const NOMES = { wisp: t("Network: {name}", { name: "wisp" }), relay: t("Network: {name}", { name: "relay" }), off: t("No network") };
const atualRede = REDE in REDES ? REDE : "wisp";
redeBtn.textContent = REDE in NOMES ? NOMES[REDE] : t("Network: custom");
redeBtn.addEventListener("click", () => {
  const ordem = ["wisp", "relay", "off"];
  const prox = ordem[(ordem.indexOf(atualRede) + 1) % ordem.length];
  try { localStorage.setItem("inkdoshub-rede2", prox); } catch {}
  const q = new URLSearchParams(location.search);
  q.delete("rede");
  location.search = q.toString();
});

// ---------- Escolha da memória ----------
const memBtn = document.getElementById("memoria");
memBtn.textContent = t("Memory: {size}", { size: LIMITADA ? "640 MB + swap" : "256 MB" });
memBtn.addEventListener("click", () => {
  try { localStorage.setItem("inkdoshub-memoria", LIMITADA ? "normal" : "limitada"); } catch {}
  const q = new URLSearchParams(location.search);
  q.delete("memoria");
  location.search = q.toString();
});
if (LIMITADA) document.getElementById("btn-save").title = t("The session is not saved in this mode (swap is rebuilt on every boot)");

// Tela inicial (inicio/): antes de descarregar este app, guarda a sessão.
// No modo de memória limitada não há como guardar (o swap recomeça a cada boot),
// então pede para a janela continuar aberta.
if (window.inkGerenciador) {
  inkGerenciador.aoGuardar(async () => {
    if (LIMITADA) return { manter: t("The terminal is in 640 MB + swap mode, which cannot be saved. Closing it erases the session.") };
    setStatus(t("Saving before closing…"));
    await saveStateDb(await emulator.save_state());
  });
}

// ---------- Sessão em arquivo (assets/sessao.js) ----------
// O Linux roda /usr/local/sbin/inksessao (tools/linux/), que conversa pela pasta /mnt/ipad/.inkdoshub:
// a página escreve "pedido" (salvar ou restaurar) e lê "estado" ("trabalhando ...", "ok ...",
// "aviso ..." ou "erro ..."). A receita é um .tar.gz com a lista de pacotes do apk, /root, /home e /usr/local.
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
  // arquivo vazio ou apagado pelo Linux no meio da leitura
  return emulator.read_file(caminho).catch(() => null);
}
const texto9p = async (c) => { const b = await ler9p(c); return b ? new TextDecoder().decode(b).trim() : null; };
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Um Linux restaurado de um "Salvar" antigo (antes desta função) não tem o inksessao rodando.
// Nesse caso a página manda o mesmo programa pela pasta e digita o comando que o liga.
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
    console.error("sessão:", err);
    aviso.fim(t("Could not open the session: {error}", { error: err && err.message || err }), true);
  }
  term.focus();
});

window.inkdoshub = { emulator, term, swap };
