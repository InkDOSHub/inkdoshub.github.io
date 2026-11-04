import "./vendor/xterm.js";
import "./vendor/xterm-pty.js";
import initEmscriptenModule from "./alpine/out.js";

const estado = document.getElementById("estado");
if (!self.crossOriginIsolated) estado.textContent = "This test needs the isolated address (SharedArrayBuffer): open it from the fast link.";
const xterm = new Terminal({ fontSize: 13, cols: 80, rows: 30 });
xterm.open(document.getElementById("term"));
const { master, slave } = openpty();
xterm.loadAddon(master);
Module.pty = slave;
const t0 = performance.now();
const instance = await initEmscriptenModule(Module);
estado.textContent = "QEMU started in " + Math.round((performance.now() - t0) / 1000) + " s. Linux is booting…";
const oldPoll = Module["TTY"].stream_ops.poll;
const pty = Module["pty"];
Module["TTY"].stream_ops.poll = function (stream, timeout) {
  if (!pty.readable) return (pty.readable ? 1 : 0) | (pty.writable ? 4 : 0);
  return oldPoll.call(stream, timeout);
};

// Buttons that type into the terminal (iPhone has no paste in the terminal).
function digitar(texto) {
  if (xterm.input) xterm.input(texto, true);
  else xterm._core.coreService.triggerDataEvent(texto, true);
}
document.getElementById("btn-root").onclick = () => digitar("root\r");
document.getElementById("btn-teste").onclick = () =>
  digitar("time sh -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done'\r");
