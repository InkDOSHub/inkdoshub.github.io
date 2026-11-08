/* Games: EmulatorJS (ejs/, self-hosted because the site is cross-origin isolated).
   The person picks their own game files; nothing is uploaded. The PS1 BIOS is kept in
   IndexedDB "inkdoshub-jogos" so it is picked only once. */
(function () {
  "use strict";
  var t = window.InkIdioma ? InkIdioma.t : function (s) { return s; };
  var $ = function (id) { return document.getElementById(id); };
  var EXT = { psx: ["cue", "chd", "pbp", "bin", "iso", "img", "m3u", "ccd", "mdf"], snes: ["sfc", "smc", "fig", "swc"],
    n64: ["z64", "n64", "v64"], nes: ["nes", "fds", "unf"], gba: ["gba"] };
  var jogo = null;

  function ext(n) { var i = n.lastIndexOf("."); return i < 0 ? "" : n.slice(i + 1).toLowerCase(); }
  function sistemaDe(n) { var e = ext(n); for (var s in EXT) if (EXT[s].indexOf(e) >= 0) return s; return ""; }
  function msg(s) { $("msg").textContent = s || ""; }

  function banco() {
    return new Promise(function (ok, erro) {
      var r = indexedDB.open("inkdoshub-jogos", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("bios"); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
    });
  }
  function bios(valor) {
    return banco().then(function (db) {
      return new Promise(function (ok) {
        var tx = db.transaction("bios", valor ? "readwrite" : "readonly"), st = tx.objectStore("bios");
        var r = valor ? st.put(valor, "psx") : st.get("psx");
        r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; });
  }
  function mostrarBios() { bios().then(function (f) { $("bios-info").textContent = f ? f.name : t("Optional"); }); }
  mostrarBios();

  // .cue with several .bin: put them in one uncompressed .zip, which EmulatorJS extracts
  var CRC = (function () { var c, t = new Uint32Array(256); for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  async function crc32(file) {
    var c = 0xffffffff, passo = 16 << 20;
    for (var p = 0; p < file.size; p += passo) {
      var b = new Uint8Array(await file.slice(p, p + passo).arrayBuffer());
      for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
      msg(t("Preparing") + " " + file.name + " " + Math.round(100 * (p + b.length) / file.size) + "%");
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  async function zipar(files, nome) {
    var partes = [], central = [], pos = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], n = new TextEncoder().encode(f.name), crc = await crc32(f);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.size, true); h.setUint32(22, f.size, true); h.setUint16(26, n.length, true);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.size, true); c.setUint32(24, f.size, true); c.setUint16(28, n.length, true); c.setUint32(42, pos, true);
      partes.push(h, n, f); central.push(c, n); pos += 30 + n.length + f.size;
    }
    var tc = central.reduce(function (s, x) { return s + x.byteLength; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, tc, true); e.setUint32(16, pos, true);
    msg("");
    return new File(partes.concat(central, [e]), nome + ".zip");
  }

  async function iniciar(sistema) {
    var files = jogo, principal = files.filter(function (f) { return /\.(cue|m3u)$/i.test(f.name); })[0] || files[0];
    var nome = principal.name.replace(/\.[^.]+$/, "");
    var arq = files.length > 1 ? await zipar(files, nome) : principal;
    if (sistema === "psx") { var b = await bios(); if (b) window.EJS_biosUrl = b; }
    window.EJS_player = "#jogo";
    window.EJS_core = sistema;
    window.EJS_gameUrl = arq;
    window.EJS_gameName = nome;
    window.EJS_pathtodata = "ejs/";
    window.EJS_startOnLoaded = true;
    window.EJS_cacheLimit = 0;
    window.EJS_color = "#7c3aed";
    $("titulo").textContent = nome;
    $("inicio").hidden = true; $("jogo").hidden = false; $("main").classList.add("jogando");
    var s = document.createElement("script"); s.src = "ejs/loader.js?v=1"; document.body.appendChild(s);
  }

  $("btn-jogo").onclick = function () { $("arq-jogo").click(); };
  $("btn-bios").onclick = function () { $("arq-bios").click(); };
  $("arq-bios").onchange = function () { var f = this.files[0]; if (f) bios(f).then(mostrarBios); this.value = ""; };
  $("arq-jogo").onchange = function () {
    jogo = [].slice.call(this.files); this.value = "";
    if (!jogo.length) return;
    msg("");
    var sis = "";
    jogo.some(function (f) { return (sis = sistemaDe(f.name)); });
    if (sis) return iniciar(sis);
    $("escolher").hidden = false; // .zip, .7z or unknown: ask which console
  };
  $("iniciar").onclick = function () { if (jogo) iniciar($("sistema").value); };
})();
