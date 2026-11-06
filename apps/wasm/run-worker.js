/* Runs one Emscripten program (its .js loader plus .wasm) for the Wasm Build app's "Run" panel.
   Output goes to the page; keyboard input arrives through a SharedArrayBuffer, so the program can
   wait for a line the way a terminal program does (no pop-ups, which XeOS blocks). */
"use strict";
var ctl = null, dados = null, fila = [], pendentes = [];
function lerByte() {
  if (!fila.length) {
    pendentes.forEach(function (f) { f(); }); // show a prompt written without a line end
    if (!ctl) return null; // no shared memory: input is the end of the file
    Atomics.store(ctl, 0, 0);
    postMessage({ t: "i" });
    Atomics.wait(ctl, 0, 0);
    var n = Atomics.load(ctl, 1);
    if (n < 0) return null;
    fila = Array.prototype.slice.call(dados.subarray(0, n));
    if (!fila.length) return null;
  }
  return fila.shift();
}
onmessage = function (e) {
  var m = e.data;
  if (m.sab) { ctl = new Int32Array(m.sab, 0, 2); dados = new Uint8Array(m.sab, 8); }
  self.Module = {
    arguments: m.args,
    thisProgram: m.nome,
    locateFile: function (n) { return m.urls[n] || n; },
    print: function (s) { postMessage({ t: "o", s: s + "\n" }); },
    printErr: function (s) { postMessage({ t: "e", s: s + "\n" }); },
    // the program's stdin/stdout are Emscripten's terminal device (so programs see a tty, like
    // Lua's interactive prompt); its read and write hooks are pointed here
    preRun: [function () {
      if (typeof TTY === "undefined") { Module.stdin = lerByte; return; }
      function saida(tipo) {
        var dec = new TextDecoder();
        function soltar(tty) { if (tty.output.length) { postMessage({ t: tipo, s: dec.decode(new Uint8Array(tty.output)) }); tty.output = []; } }
        var ultimo = null;
        pendentes.push(function () { if (ultimo) soltar(ultimo); });
        return { put_char: function (tty, v) { ultimo = tty; if (v === null) return soltar(tty); tty.output.push(v); if (v === 10) soltar(tty); }, fsync: soltar };
      }
      var o = saida("o"), e = saida("e");
      TTY.default_tty_ops.get_char = function () { return lerByte(); };
      TTY.default_tty_ops.put_char = o.put_char; TTY.default_tty_ops.fsync = o.fsync;
      if (TTY.default_tty1_ops) { TTY.default_tty1_ops.put_char = e.put_char; TTY.default_tty1_ops.fsync = e.fsync; }
    }],
    onExit: function (c) { postMessage({ t: "x", c: c }); },
    onAbort: function (r) { postMessage({ t: "e", s: "aborted: " + r + "\n" }); postMessage({ t: "x", c: -1 }); }
  };
  try { importScripts(m.js); }
  catch (err) { postMessage({ t: "e", s: "Could not load " + m.nome + ": " + err.message + "\n(builds made with MODULARIZE or EXPORT_ES6 cannot run here)\n" }); postMessage({ t: "x", c: -1 }); }
};
