/* Emulation test: how fast could an emulator (Box64/Winlator style) run in this browser?
   A tiny guest CPU (registers r0..r3) runs one program: a random-number loop, 10 guest instructions per turn.
   1. direct: the same loop written straight in WebAssembly (the ceiling: what the browser JIT gives)
   2. dynarec chained: guest code translated to WebAssembly at run time, registers kept in memory, block loops on itself
   3. dynarec dispatch: same, but control returns to a JavaScript dispatcher after every block (simple emulators)
   4. interpreter: a switch loop in JavaScript (what an emulator does without JIT)
   Also: translation speed, emulated cores in workers, and the largest guest RAM (WebAssembly.Memory). */
"use strict";
var IS_WORKER = typeof document === "undefined";

// ---------- guest program ----------
var MULI = 0, ADDI = 1, MOV = 2, SHRI = 3, XOR = 4, ANDI = 5, ADD = 6, SUBI = 7, JNZ = 8;
var PROG = [[MULI, 0, 0, 1103515245], [ADDI, 0, 0, 12345], [MOV, 3, 0, 0], [SHRI, 3, 0, 7], [XOR, 2, 3, 0],
  [MOV, 3, 0, 0], [ANDI, 3, 0, 255], [ADD, 2, 3, 0], [SUBI, 1, 0, 1], [JNZ, 1, 0, 0]];
var PER = PROG.length; // guest instructions per turn

// ---------- tiny WebAssembly encoder ----------
function leb(n) { var o = []; for (;;) { var b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } }
function uleb(n) { var o = []; do { var b = n & 0x7f; n >>>= 7; o.push(n ? b | 0x80 : b); } while (n); return o; }
function sec(id, bytes) { return [id].concat(uleb(bytes.length), bytes); }
function str(s) { return uleb(s.length).concat(Array.from(s, function (c) { return c.charCodeAt(0); })); }
function vec(items) { var o = uleb(items.length); items.forEach(function (i) { o = o.concat(i); }); return o; }
// module with N functions of type (i32)->i32, optional imported memory, exports f0..fN-1
function modulo(bodies, mem) {
  var b = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
  b = b.concat(sec(1, vec([[0x60, 1, 0x7f, 1, 0x7f]])));
  if (mem) b = b.concat(sec(2, vec([str("e").concat(str("m"), [2, 0, 1])])));
  b = b.concat(sec(3, vec(bodies.map(function () { return [0]; }))));
  b = b.concat(sec(7, vec(bodies.map(function (_, i) { return str("f" + i).concat([0], uleb(i)); }))));
  b = b.concat(sec(10, vec(bodies.map(function (c) { return uleb(c.length).concat(c); }))));
  return new Uint8Array(b);
}
var C = function (n) { return [0x41].concat(leb(n | 0)); };
var LD = function (r) { return C(r * 4).concat([0x28, 2, 0]); };
var ST = [0x36, 2, 0];
var OPS = {}; OPS[MULI] = 0x6c; OPS[ADDI] = 0x6a; OPS[SHRI] = 0x76; OPS[XOR] = 0x73; OPS[ANDI] = 0x71; OPS[ADD] = 0x6a; OPS[SUBI] = 0x6b;
// one guest instruction -> WebAssembly (registers live in memory, like a simple dynarec)
function traduz(ins) {
  var op = ins[0], a = ins[1], b = ins[2], imm = ins[3];
  if (op === MOV) return C(a * 4).concat(LD(b), ST);
  if (op === XOR || op === ADD) return C(a * 4).concat(LD(a), LD(b), [OPS[op]], ST);
  return C(a * 4).concat(LD(a), C(imm), [OPS[op]], ST);
}
function corpoBloco(encadeado) {
  var c = [0]; // no locals
  var corpo = []; PROG.slice(0, -1).forEach(function (i) { corpo = corpo.concat(traduz(i)); });
  if (encadeado) c = c.concat([0x03, 0x40], corpo, LD(1), [0x0d, 0], [0x0b], C(0), [0x0b]);
  else c = c.concat(corpo, LD(1), [0x0b]); // returns r1: nonzero = jump back to the block
  return c;
}
// the same loop written directly (locals = registers): param 0 = r1 (count), locals 1 = r0, 2 = r2, 3 = r3
function corpoDireto() {
  return [1, 3, 0x7f].concat(C(1), [0x21, 1], [0x03, 0x40],
    [0x20, 1], C(1103515245), [0x6c], C(12345), [0x6a, 0x21, 1],
    [0x20, 2, 0x20, 1], C(7), [0x76, 0x73, 0x21, 2],
    [0x20, 2, 0x20, 1], C(255), [0x71, 0x6a, 0x21, 2],
    [0x20, 0], C(1), [0x6b, 0x22, 0, 0x0d, 0, 0x0b, 0x20, 2, 0x0b]);
}

var MODS = null;
function prepara() {
  if (MODS) return MODS;
  MODS = { direto: new WebAssembly.Module(modulo([corpoDireto()], false)), enc: new WebAssembly.Module(modulo([corpoBloco(true)], true)), desp: new WebAssembly.Module(modulo([corpoBloco(false)], true)) };
  return MODS;
}
function inst(mod) { var m = new WebAssembly.Memory({ initial: 1 }); return { f: new WebAssembly.Instance(mod, { e: { m: m } }).exports.f0, r: new Int32Array(m.buffer) }; }

var MODOS = {
  direto: function (n) { return new WebAssembly.Instance(prepara().direto).exports.f0(n); },
  encadeado: function (n) { var x = inst(prepara().enc); x.r[0] = 1; x.r[1] = n; x.r[2] = 0; x.f(0); return x.r[2]; },
  despacho: function (n) { var x = inst(prepara().desp); x.r[0] = 1; x.r[1] = n; x.r[2] = 0; var f = x.f; while (f(0)) {} return x.r[2]; },
  interpretador: function (n) {
    var r = new Int32Array(4); r[0] = 1; r[1] = n; var pc = 0, P = PROG, L = P.length;
    for (;;) {
      var i = P[pc], a = i[1];
      switch (i[0]) {
        case 0: r[a] = Math.imul(r[a], i[3]); break; case 1: r[a] = r[a] + i[3]; break; case 2: r[a] = r[i[2]]; break;
        case 3: r[a] = r[a] >>> i[3]; break; case 4: r[a] ^= r[i[2]]; break; case 5: r[a] &= i[3]; break;
        case 6: r[a] = r[a] + r[i[2]]; break; case 7: r[a] = r[a] - i[3]; break;
        case 8: if (r[a]) { pc = i[3]; continue; } return r[2];
      }
      if (++pc >= L) return r[2];
    }
  }
};
// runs until it takes >= alvo ms; returns million guest instructions per second (MIPS) and the checksum
function mede(modo, alvo) {
  var n = 1e5, t, v;
  for (;;) { var t0 = performance.now(); v = MODOS[modo](n); t = performance.now() - t0; if (t >= alvo || n >= 5e8) break; n = Math.min(n * Math.max(2, Math.ceil(alvo / Math.max(t, 1))), 5e8); }
  return { mips: n * PER / t / 1000, soma: v, ms: t };
}

if (IS_WORKER) {
  onmessage = function (e) {
    var fim = performance.now() + e.data.ms, feitos = 0, x = inst(prepara().enc);
    while (performance.now() < fim) { x.r[0] = 1; x.r[1] = 2e6; x.r[2] = 0; x.f(0); feitos += 2e6 * PER; }
    postMessage(feitos);
  };
} else {
  var $ = function (id) { return document.getElementById(id); };
  var linhas = [];
  var linha = function (k, v) { linhas.push(k + "\t" + v); var tr = document.createElement("tr"); tr.innerHTML = "<td></td><td></td>"; tr.cells[0].textContent = k; tr.cells[1].textContent = v; $("tab").appendChild(tr); };
  var pausa = function () { return new Promise(function (ok) { setTimeout(ok, 30); }); };
  var nucleos = function (n, ms) {
    return Promise.all(Array.from({ length: n }, function () {
      return new Promise(function (ok) { var w = new Worker("emu.js?v=1"); w.onmessage = function (e) { w.terminate(); ok(e.data); }; w.onerror = function () { w.terminate(); ok(0); }; w.postMessage({ ms: ms }); });
    })).then(function (v) { return v.reduce(function (a, b) { return a + b; }, 0) / ms / 1000; });
  };
  $("rodar").onclick = async function () {
    $("rodar").disabled = true; $("tab").textContent = ""; linhas = [];
    var est = function (s) { $("estado").textContent = "⏳ " + s; };
    linha("device", navigator.userAgent.replace(/^Mozilla\/5\.0 /, ""));
    linha("isolated (SharedArrayBuffer)", String(self.crossOriginIsolated === true));
    linha("logical cores reported", String(navigator.hardwareConcurrency || "?"));
    var res = {};
    for (var m of ["direto", "encadeado", "despacho", "interpretador"]) {
      est(m + "…"); await pausa();
      try { mede(m, 150); res[m] = mede(m, 1500); } catch (e) { res[m] = { mips: 0, erro: String(e) }; }
    }
    var nomes = { direto: "1. direct WebAssembly (ceiling)", encadeado: "2. dynarec, chained blocks", despacho: "3. dynarec, JS dispatch per block", interpretador: "4. interpreter (no JIT)" };
    var ok = ["encadeado", "despacho", "interpretador"].every(function (m) { return MODOS[m](12345) === MODOS.direto(12345); });
    for (var k in nomes) linha(nomes[k], res[k].erro ? "error: " + res[k].erro : Math.round(res[k].mips) + " MIPS (" + (res[k].mips / res.direto.mips * 100).toFixed(0) + "% of direct)");
    linha("same result in all 4", String(ok));
    linha("JIT gain over interpreter", (res.encadeado.mips / res.interpretador.mips).toFixed(1) + "x");

    est("translation speed…"); await pausa();
    try {
      var corpos = []; for (var i = 0; i < 3000; i++) { var c = corpoBloco(true); c[c.length - 2] = (i & 0x3f); corpos.push(c); }
      var bytes = modulo(corpos, true), t0 = performance.now(); new WebAssembly.Module(bytes); var tc = performance.now() - t0;
      linha("translation: compile 3000 blocks", tc.toFixed(0) + " ms = " + Math.round(3000 / tc * 1000) + " blocks/s (" + (bytes.length / 1024 / tc * 1000 / 1024).toFixed(1) + " MB/s of code)");
      t0 = performance.now(); var n1 = 0; while (performance.now() - t0 < 300) { new WebAssembly.Module(modulo([corpoBloco(true)], true)); n1++; }
      linha("translation: one small module at a time", (n1 / (performance.now() - t0) * 1000).toFixed(0) + " modules/s");
    } catch (e) { linha("translation", "error: " + e); }

    var um = 0;
    for (var n of [1, 2, 4, 6, 8]) {
      est("emulated cores: " + n + "…"); await pausa();
      var v = await nucleos(n, 2000); if (n === 1) um = v;
      linha("emulated cores: " + n + " workers", Math.round(v) + " MIPS total (" + (v / um).toFixed(2) + "x)");
    }

    est("guest RAM…"); await pausa();
    try {
      var mem = new WebAssembly.Memory({ initial: 1, maximum: 65536 }), mb = 0;
      for (var p = 4096; p <= 65536; p += 4096) { try { mem.grow(4096); mb = mem.buffer.byteLength / 1048576; } catch (e) { break; } }
      linha("guest RAM: WebAssembly.Memory reserved", Math.round(mb) + " MB (address space; not filled)");
      mem = null;
    } catch (e) { linha("guest RAM", "error: " + e); }

    $("estado").textContent = "✓ Done. Tap Copy results and paste it in the chat.";
    $("txt").value = linhas.join("\n"); $("copiar").hidden = false; $("rodar").disabled = false;
  };
  $("copiar").onclick = function () {
    var t = $("txt").value;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { $("estado").textContent = "✓ Copied."; }, function () { $("txt").hidden = false; $("txt").select(); $("estado").textContent = "Select the text below and copy it."; });
  };
}
