// Screen, mouse and keyboard of Wine x64. QEMU's control channel (QMP) runs on the page's
// terminal (xterm-pty, kept in "Console"): "screendump" writes the screen as a PPM file into
// Emscripten's file system, which is drawn on the canvas; taps and keys go as "input-send-event"
// (absolute pointer: the machine has a USB tablet).
import "./vendor/xterm.js";
import "./vendor/xterm-pty.js";
import initEmscriptenModule from "./maquina/out.js";

const $ = (id) => document.getElementById(id);
const estado = (t) => { $("estado").textContent = t; };
if (!self.crossOriginIsolated) estado("This page needs the isolated address (SharedArrayBuffer).");
const xterm = new Terminal({ fontSize: 12, cols: 100, rows: 12 });
xterm.open($("term"));
const { master, slave } = openpty();
xterm.loadAddon(master);
Module.pty = slave;

const t0 = performance.now();
await initEmscriptenModule(Module);
const oldPoll = Module["TTY"].stream_ops.poll;
const pty = Module["pty"];
Module["TTY"].stream_ops.poll = function (stream, timeout) {
  if (!pty.readable) return (pty.readable ? 1 : 0) | (pty.writable ? 4 : 0);
  return oldPoll.call(stream, timeout);
};
const FS = Module.FS;

function qmp(o) {
  const s = JSON.stringify(o) + "\n";
  if (xterm.input) xterm.input(s, true); else xterm._core.coreService.triggerDataEvent(s, true);
}
qmp({ execute: "qmp_capabilities" });

// --- screen ---
const tela = $("tela"), ctx = tela.getContext("2d");
let img = null, quadros = 0, vivo = false;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function cabecalho(d) {
  // "P6\n<w> <h>\n255\n"
  let i = 0, campos = [];
  while (campos.length < 4 && i < d.length && i < 40) {
    while (i < d.length && /\s/.test(String.fromCharCode(d[i]))) i++;
    let s = i; while (i < d.length && !/\s/.test(String.fromCharCode(d[i]))) i++;
    campos.push(String.fromCharCode.apply(null, d.subarray(s, i)));
  }
  if (campos[0] !== "P6" || campos.length < 4) return null;
  return { w: +campos[1], h: +campos[2], off: i + 1 };
}
async function lerQuadro(nome) {
  const ate = performance.now() + 20000;
  while (performance.now() < ate) {
    await espera(20);
    let d;
    try { if (FS.stat(nome).size < 20) continue; d = FS.readFile(nome); } catch (e) { continue; }
    const c = cabecalho(d);
    if (!c || d.length < c.off + c.w * c.h * 3) continue;
    try { FS.unlink(nome); } catch (e) {}
    return { c, d };
  }
  return null;
}
async function laco() {
  let k = 0;
  for (;;) {
    const nome = "/tela" + (k++ & 1) + ".ppm";
    qmp({ execute: "screendump", arguments: { filename: nome } });
    const q = await lerQuadro(nome);
    if (!q) continue;
    const { c, d } = q;
    if (tela.width !== c.w || tela.height !== c.h) { tela.width = c.w; tela.height = c.h; img = null; }
    if (!img) img = ctx.createImageData(c.w, c.h);
    const px = img.data;
    let escuro = true;
    for (let i = 0, j = c.off, n = c.w * c.h; i < n; i++, j += 3) {
      const o = i * 4; px[o] = d[j]; px[o + 1] = d[j + 1]; px[o + 2] = d[j + 2]; px[o + 3] = 255;
      if (escuro && (d[j] | d[j + 1] | d[j + 2]) > 16) escuro = false;
    }
    ctx.putImageData(img, 0, 0);
    quadros++;
    if (!vivo && !escuro && c.w >= 800) { vivo = true; estado(""); }
    else if (!vivo) estado("Starting the machine… " + Math.round((performance.now() - t0) / 1000) + " s (a few minutes)");
    await espera(vivo ? 40 : 1000);
  }
}
laco();

// --- mouse / touch ---
const ABS = 32767;
let direito = false, ultimo = 0, pendente = null;
function pos(e) {
  const r = tela.getBoundingClientRect();
  // object-fit: contain in full screen
  const esc = Math.min(r.width / tela.width, r.height / tela.height);
  const w = tela.width * esc, h = tela.height * esc, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - h) / 2;
  return [Math.max(0, Math.min(ABS, Math.round((e.clientX - x0) / w * ABS))), Math.max(0, Math.min(ABS, Math.round((e.clientY - y0) / h * ABS)))];
}
function mover(x, y) { return [{ type: "abs", data: { axis: "x", value: x } }, { type: "abs", data: { axis: "y", value: y } }]; }
function enviar(ev) { qmp({ execute: "input-send-event", arguments: { events: ev } }); }
let botao = "left";
tela.addEventListener("pointerdown", (e) => {
  e.preventDefault(); tela.setPointerCapture(e.pointerId);
  botao = e.button === 2 || direito ? "right" : "left";
  if (direito) { direito = false; $("btn-direito").setAttribute("aria-pressed", "false"); }
  const [x, y] = pos(e);
  enviar(mover(x, y).concat([{ type: "btn", data: { down: true, button: botao } }]));
});
tela.addEventListener("pointermove", (e) => {
  const [x, y] = pos(e), t = performance.now();
  if (t - ultimo < 40) { pendente = [x, y]; return; }
  ultimo = t; pendente = null; enviar(mover(x, y));
});
setInterval(() => { if (pendente) { enviar(mover(pendente[0], pendente[1])); pendente = null; } }, 60);
tela.addEventListener("pointerup", (e) => { const [x, y] = pos(e); enviar(mover(x, y).concat([{ type: "btn", data: { down: false, button: botao } }])); });
tela.addEventListener("contextmenu", (e) => e.preventDefault());
tela.addEventListener("wheel", (e) => {
  e.preventDefault();
  const b = e.deltaY < 0 ? "wheel-up" : "wheel-down";
  enviar([{ type: "btn", data: { down: true, button: b } }, { type: "btn", data: { down: false, button: b } }]);
}, { passive: false });
$("btn-direito").onclick = () => { direito = !direito; $("btn-direito").setAttribute("aria-pressed", String(direito)); };

// --- keyboard ---
const CODIGOS = { Enter: "ret", Backspace: "backspace", Tab: "tab", Escape: "esc", Space: "spc", Minus: "minus", Equal: "equal",
  BracketLeft: "bracket_left", BracketRight: "bracket_right", Semicolon: "semicolon", Quote: "apostrophe", Backquote: "grave_accent",
  Backslash: "backslash", Comma: "comma", Period: "dot", Slash: "slash", Delete: "delete", Home: "home", End: "end", PageUp: "pgup",
  PageDown: "pgdn", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", ShiftLeft: "shift", ShiftRight: "shift_r",
  ControlLeft: "ctrl", ControlRight: "ctrl_r", AltLeft: "alt", AltRight: "alt_r", MetaLeft: "meta_l", MetaRight: "meta_r", CapsLock: "caps_lock", Insert: "insert" };
function qcode(code) {
  if (CODIGOS[code]) return CODIGOS[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1].toLowerCase();
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(code); if (m) return "f" + m[1];
  return null;
}
function tecla(q, baixo) { enviar([{ type: "key", data: { down: baixo, key: { type: "qcode", data: q } } }]); }
// characters typed on a touch keyboard (no key codes): US layout
const SHIFT = '~!@#$%^&*()_+{}|:"<>?', BASE = "`1234567890-=[]\;',./";
function porCaractere(ch) {
  if (ch === "\n") return ["ret", false];
  if (ch === " ") return ["spc", false];
  if (/[a-z0-9]/.test(ch)) return [ch, false];
  if (/[A-Z]/.test(ch)) return [ch.toLowerCase(), true];
  let i = BASE.indexOf(ch); if (i >= 0) return [qcode(["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash"][i]), false];
  i = SHIFT.indexOf(ch); if (i >= 0) return [qcode(["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash"][i]), true];
  return null;
}
const teclas = $("teclas");
function chave(e, baixo) {
  if (document.activeElement === teclas && (!e.code || e.key === "Unidentified" || e.key === "Process")) return;
  const q = qcode(e.code); if (!q) return;
  e.preventDefault(); tecla(q, baixo);
}
addEventListener("keydown", (e) => { if (e.target.closest && e.target.closest("details")) return; chave(e, true); });
addEventListener("keyup", (e) => { if (e.target.closest && e.target.closest("details")) return; chave(e, false); });
teclas.addEventListener("input", () => {
  for (const ch of teclas.value) {
    const r = porCaractere(ch); if (!r) continue;
    if (r[1]) tecla("shift", true);
    tecla(r[0], true); tecla(r[0], false);
    if (r[1]) tecla("shift", false);
  }
  teclas.value = "";
});
$("btn-teclado").onclick = () => { teclas.focus(); };

// --- full screen ---
function telaCheia(liga) {
  document.body.classList.toggle("cheia", liga);
  const el = document.documentElement, rf = el.requestFullscreen || el.webkitRequestFullscreen;
  if (liga && rf) { const r = rf.call(el); if (r && r.catch) r.catch(() => {}); }
  if (!liga && (document.fullscreenElement || document.webkitFullscreenElement)) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
}
$("btn-cheia").onclick = () => telaCheia(true);
$("sair-cheia").onclick = () => telaCheia(false);
