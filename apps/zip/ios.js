/* Apple file formats for Zip, read on this device:
   - property lists: XML and binary (bplist00), as in Info.plist, .strings and .entitlements
   - .mobileprovision: the plist inside the signed (CMS) envelope
   - Apple PNG (CgBI): the "crushed" icons inside an .ipa, which browsers cannot show
   - Mach-O: the program inside an .app (architectures, minimum iOS, encryption, libraries)
   Values are kept as typed nodes { t, v } so the tree shows each type and the XML keeps it:
   dict (v = [[key, node]...], in order), array, string, integer, real, bool, date, data, uid, null. */
(function () {
  "use strict";

  /* ---------- property lists ---------- */
  function ehBinario(u8) { return u8.length > 40 && String.fromCharCode.apply(null, u8.subarray(0, 6)) === "bplist"; }

  function lerBinario(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = u8.length;
    if (String.fromCharCode.apply(null, u8.subarray(6, 8)) !== "00") throw new Error("Unsupported binary plist version");
    var t = n - 32, tamOff = u8[t + 6], tamRef = u8[t + 7];
    var numObj = num(t + 8, 8), topo = num(t + 16, 8), tabela = num(t + 24, 8);
    if (!tamOff || !tamRef || tabela + numObj * tamOff > t) throw new Error("Damaged binary plist");
    var cache = {}, prof = 0;
    function num(p, k) { var r = 0; for (var i = 0; i < k; i++) r = r * 256 + u8[p + i]; return r; }
    function offset(i) { return num(tabela + i * tamOff, tamOff); }
    function obj(i) {
      if (i >= numObj) throw new Error("Damaged binary plist");
      if (cache[i]) return cache[i];
      if (++prof > 512) throw new Error("Binary plist nested too deep");
      var r = ler(offset(i));
      prof--;
      return (cache[i] = r);
    }
    function contagem(p, info) {
      // count in the low nibble, or 0xF and an integer object after the marker
      if (info !== 15) return { c: info, p: p + 1 };
      var m = u8[p + 1], k = 1 << (m & 15);
      return { c: num(p + 2, k), p: p + 2 + k };
    }
    function ler(p) {
      var m = u8[p], tipo = m >> 4, info = m & 15, c, k, i, r;
      switch (tipo) {
        case 0:
          if (m === 8) return { t: "bool", v: false };
          if (m === 9) return { t: "bool", v: true };
          return { t: "null", v: null };
        case 1:
          k = 1 << info;
          if (k === 8) { var b = dv.getBigInt64(p + 1); return { t: "integer", v: b >= -9007199254740991n && b <= 9007199254740991n ? Number(b) : b }; }
          if (k === 16) return { t: "integer", v: dv.getBigInt64(p + 9) };
          return { t: "integer", v: num(p + 1, k) };
        case 2:
          return { t: "real", v: info === 2 ? dv.getFloat32(p + 1) : dv.getFloat64(p + 1) };
        case 3:
          return { t: "date", v: new Date(Date.UTC(2001, 0, 1) + dv.getFloat64(p + 1) * 1000) };
        case 4:
          c = contagem(p, info); return { t: "data", v: u8.slice(c.p, c.p + c.c) };
        case 5:
          c = contagem(p, info); return { t: "string", v: new TextDecoder("latin1").decode(u8.subarray(c.p, c.p + c.c)) };
        case 6:
          c = contagem(p, info); r = "";
          for (i = 0; i < c.c; i++) r += String.fromCharCode(dv.getUint16(c.p + i * 2));
          return { t: "string", v: r };
        case 8:
          return { t: "uid", v: num(p + 1, info + 1) };
        case 10: case 12:
          c = contagem(p, info); r = [];
          for (i = 0; i < c.c; i++) r.push(obj(num(c.p + i * tamRef, tamRef)));
          return { t: "array", v: r };
        case 13:
          c = contagem(p, info); r = [];
          for (i = 0; i < c.c; i++) {
            var ch = obj(num(c.p + i * tamRef, tamRef)), va = obj(num(c.p + (c.c + i) * tamRef, tamRef));
            r.push([ch.t === "string" ? ch.v : String(ch.v), va]);
          }
          return { t: "dict", v: r };
      }
      throw new Error("Unknown binary plist object 0x" + m.toString(16));
    }
    return obj(topo);
  }

  function lerXml(texto) {
    var doc = new DOMParser().parseFromString(texto, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("This XML plist is damaged");
    var raiz = doc.documentElement;
    if (!raiz || raiz.nodeName !== "plist") throw new Error("Not a property list");
    var el = raiz.firstElementChild;
    if (!el) return { t: "dict", v: [] };
    return no(el);
    function no(e) {
      var n = e.nodeName, s = e.textContent, r, k;
      switch (n) {
        case "dict":
          r = []; k = null;
          for (var c = e.firstElementChild; c; c = c.nextElementSibling) {
            if (c.nodeName === "key") k = c.textContent; else { r.push([k == null ? "" : k, no(c)]); k = null; }
          }
          return { t: "dict", v: r };
        case "array":
          r = []; for (var a = e.firstElementChild; a; a = a.nextElementSibling) r.push(no(a));
          return { t: "array", v: r };
        case "string": return { t: "string", v: s };
        case "integer": s = s.trim(); return { t: "integer", v: Math.abs(+s) <= 9007199254740991 ? +s : BigInt(s) };
        case "real": return { t: "real", v: +s };
        case "true": return { t: "bool", v: true };
        case "false": return { t: "bool", v: false };
        case "date": return { t: "date", v: new Date(s.trim()) };
        case "data":
          var b = atob(s.replace(/\s+/g, "")), u = new Uint8Array(b.length);
          for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
          return { t: "data", v: u };
      }
      return { t: "string", v: s };
    }
  }

  /* Reads a plist (XML or binary) from bytes. */
  function plist(u8) {
    if (ehBinario(u8)) return lerBinario(u8);
    return lerXml(texto(u8));
  }

  /* The XML plist inside a .mobileprovision (a CMS envelope around the XML). */
  function provisionamento(u8) {
    var s = new TextDecoder("latin1").decode(u8), a = s.indexOf("<?xml"), b = s.indexOf("</plist>");
    if (a < 0 || b < a) throw new Error("No property list inside this provisioning profile");
    return lerXml(new TextDecoder("utf-8").decode(u8.subarray(a, b + 8)));
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }
  function dataIso(d) { return isNaN(d) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z"); }

  /* Back to XML (a binary plist saved as text). */
  function xml(node) {
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0">'];
    (function vai(n, ind) {
      switch (n.t) {
        case "dict":
          if (!n.v.length) { out.push(ind + "<dict/>"); return; }
          out.push(ind + "<dict>");
          n.v.forEach(function (kv) { out.push(ind + "\t<key>" + esc(kv[0]) + "</key>"); vai(kv[1], ind + "\t"); });
          out.push(ind + "</dict>"); return;
        case "array":
          if (!n.v.length) { out.push(ind + "<array/>"); return; }
          out.push(ind + "<array>"); n.v.forEach(function (x) { vai(x, ind + "\t"); }); out.push(ind + "</array>"); return;
        case "bool": out.push(ind + (n.v ? "<true/>" : "<false/>")); return;
        case "integer": out.push(ind + "<integer>" + n.v + "</integer>"); return;
        case "real": out.push(ind + "<real>" + n.v + "</real>"); return;
        case "date": out.push(ind + "<date>" + dataIso(n.v) + "</date>"); return;
        case "data": out.push(ind + "<data>" + b64(n.v) + "</data>"); return;
        case "uid": out.push(ind + "<dict>", ind + "\t<key>CF$UID</key>", ind + "\t<integer>" + n.v + "</integer>", ind + "</dict>"); return;
        case "null": out.push(ind + "<string></string>"); return;
      }
      out.push(ind + "<string>" + esc(n.v) + "</string>");
    })(node, "");
    out.push("</plist>");
    return out.join("\n") + "\n";
  }

  /* Plain JavaScript value (for summaries). */
  function js(n) {
    if (!n) return n;
    if (n.t === "dict") { var o = {}; n.v.forEach(function (kv) { o[kv[0]] = js(kv[1]); }); return o; }
    if (n.t === "array") return n.v.map(js);
    return n.v;
  }

  /* Short text of a value, for the tree. */
  function resumo(n) {
    switch (n.t) {
      case "dict": return n.v.length + (n.v.length === 1 ? " item" : " items");
      case "array": return n.v.length + (n.v.length === 1 ? " item" : " items");
      case "data":
        var h = ""; for (var i = 0; i < Math.min(n.v.length, 24); i++) h += (n.v[i] < 16 ? "0" : "") + n.v[i].toString(16);
        return n.v.length + " bytes" + (n.v.length ? " · " + h + (n.v.length > 24 ? "…" : "") : "");
      case "date": return isNaN(n.v) ? "?" : n.v.toLocaleString();
      case "bool": return n.v ? "YES" : "NO";
      case "null": return "null";
    }
    return String(n.v);
  }

  /* ---------- text ---------- */
  /* Text in UTF-8 or UTF-16 (with or without BOM, as Apple's .strings files) */
  function texto(u8) {
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder("utf-16be").decode(u8.subarray(2));
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder("utf-16le").decode(u8.subarray(2));
    if (u8.length > 3 && u8[0] && !u8[1] && u8[2] && !u8[3]) return new TextDecoder("utf-16le").decode(u8);
    if (u8.length > 3 && !u8[0] && u8[1] && !u8[2] && u8[3]) return new TextDecoder("utf-16be").decode(u8);
    return new TextDecoder("utf-8").decode(u8);
  }
  /* true when the bytes look like text */
  function pareceTexto(u8) {
    if (!u8.length) return true;
    if ((u8[0] === 0xFE && u8[1] === 0xFF) || (u8[0] === 0xFF && u8[1] === 0xFE)) return true;
    var n = Math.min(u8.length, 4096), ruins = 0;
    for (var i = 0; i < n; i++) { var c = u8[i]; if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) ruins++; }
    if (ruins > n / 50) return false;
    try { new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(0, n - 4 > 0 ? n - 4 : n)); return true; } catch (e) { return false; }
  }
  function hex(u8, max) {
    var linhas = [], n = Math.min(u8.length, max || 4096);
    for (var p = 0; p < n; p += 16) {
      var h = "", a = "";
      for (var i = p; i < p + 16; i++) {
        if (i < n) { h += (u8[i] < 16 ? "0" : "") + u8[i].toString(16) + " "; a += u8[i] > 31 && u8[i] < 127 ? String.fromCharCode(u8[i]) : "."; }
        else h += "   ";
        if (i === p + 7) h += " ";
      }
      linhas.push(("0000000" + p.toString(16)).slice(-8) + "  " + h + " " + a);
    }
    return linhas.join("\n");
  }

  /* ---------- Apple PNG (CgBI) ---------- */
  function ehCgbi(u8) { return u8.length > 16 && u8[12] === 0x43 && u8[13] === 0x67 && u8[14] === 0x42 && u8[15] === 0x49; }
  async function inflar(u8, tipo) {
    var s = new Blob([u8]).stream().pipeThrough(new DecompressionStream(tipo));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  /* Returns a normal PNG Blob: the pixels are un-filtered, BGRA becomes RGBA and the alpha is
     no longer premultiplied, then the canvas writes a standard PNG. */
  async function cgbiParaPng(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = 8, w = 0, h = 0, prof = 0, cor = 0, entrelace = 0, idat = [], tam = 0;
    while (p + 8 <= u8.length) {
      var len = dv.getUint32(p), tipo = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (tipo === "IHDR") { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); prof = u8[p + 16]; cor = u8[p + 17]; entrelace = u8[p + 20]; }
      else if (tipo === "IDAT") { idat.push(u8.subarray(p + 8, p + 8 + len)); tam += len; }
      else if (tipo === "IEND") break;
      p += 12 + len;
    }
    if (prof !== 8 || (cor !== 6 && cor !== 2) || entrelace || !w || !h || w * h > 40e6) throw new Error("Unsupported Apple PNG");
    var z = new Uint8Array(tam), o = 0;
    idat.forEach(function (c) { z.set(c, o); o += c.length; });
    var raw;
    try { raw = await inflar(z, "deflate-raw"); } catch (e) { raw = await inflar(z, "deflate"); }
    var bpp = cor === 6 ? 4 : 3, linha = w * bpp, px = new Uint8ClampedArray(w * h * 4), ant = new Uint8Array(linha), cur = new Uint8Array(linha);
    for (var y = 0; y < h; y++) {
      var base = y * (linha + 1), f = raw[base];
      for (var x = 0; x < linha; x++) {
        var v = raw[base + 1 + x], a = x >= bpp ? cur[x - bpp] : 0, b = ant[x], c = x >= bpp ? ant[x - bpp] : 0;
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { var pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        cur[x] = v & 255;
      }
      for (x = 0; x < w; x++) {
        var s = x * bpp, d = (y * w + x) * 4, al = bpp === 4 ? cur[s + 3] : 255;
        var r = cur[s + 2], g = cur[s + 1], bl = cur[s];
        if (al && al < 255) { r = r * 255 / al; g = g * 255 / al; bl = bl * 255 / al; }
        px[d] = r; px[d + 1] = g; px[d + 2] = bl; px[d + 3] = al;
      }
      var tmp = ant; ant = cur; cur = tmp;
    }
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").putImageData(new ImageData(px, w, h), 0, 0);
    return new Promise(function (ok, erro) { cv.toBlob(function (bl) { if (bl) ok(bl); else erro(new Error("Could not draw the image")); }, "image/png"); });
  }

  /* ---------- Mach-O ---------- */
  var CPU = { 7: "x86", 12: "arm", 16777223: "x86_64", 16777228: "arm64", 33554444: "arm64_32" };
  var TIPO = { 1: "object", 2: "executable", 6: "dynamic library", 8: "bundle", 10: "dSYM" };
  function versao(v) { return (v >>> 16) + "." + ((v >> 8) & 255) + ((v & 255) ? "." + (v & 255) : ""); }
  async function bytesDe(file, a, b) { return new Uint8Array(await file.slice(a, b).arrayBuffer()); }
  /* file: a Blob. Returns null when it is not Mach-O. */
  async function macho(file) {
    var cab = await bytesDe(file, 0, 4096), dv = new DataView(cab.buffer), mag = dv.getUint32(0);
    var fatias = [];
    if (mag === 0xCAFEBABE || mag === 0xCAFEBABF) {
      var n = dv.getUint32(4), d64 = mag === 0xCAFEBABF;
      if (n > 32) return null;
      for (var i = 0; i < n; i++) {
        var q = 8 + i * (d64 ? 32 : 20);
        fatias.push({ off: d64 ? Number(dv.getBigUint64(q + 8)) : dv.getUint32(q + 8) });
      }
    } else fatias.push({ off: 0 });
    var r = [];
    for (var k = 0; k < fatias.length; k++) {
      var h = await bytesDe(file, fatias[k].off, fatias[k].off + 32), hv = new DataView(h.buffer), m = hv.getUint32(0, true);
      if (m !== 0xFEEDFACE && m !== 0xFEEDFACF) { if (fatias.length === 1) return null; continue; }
      var e64 = m === 0xFEEDFACF, cpu = hv.getUint32(4, true), tipo = hv.getUint32(12, true), ncmds = hv.getUint32(16, true), tamCmds = hv.getUint32(20, true);
      var ini = fatias[k].off + (e64 ? 32 : 28), cmds = await bytesDe(file, ini, ini + Math.min(tamCmds, 4 << 20)), cv = new DataView(cmds.buffer);
      var a = { arq: CPU[cpu] || "cpu " + cpu, tipo: TIPO[tipo] || "type " + tipo, bits: e64 ? 64 : 32, libs: [], minOS: "", sdk: "", plataforma: "", cripto: null, assinado: false };
      for (var p = 0, c = 0; c < ncmds && p + 8 <= cmds.length; c++) {
        var cmd = cv.getUint32(p, true), tam = cv.getUint32(p + 4, true);
        if (tam < 8) break;
        if (cmd === 0xC || cmd === 0x80000018 || cmd === 0xD || cmd === 0x8000001F || cmd === 0x80000023) {
          var so = cv.getUint32(p + 8, true), fim = p + so;
          while (fim < p + tam && cmds[fim]) fim++;
          a.libs.push(new TextDecoder().decode(cmds.subarray(p + so, fim)) + (cmd === 0x80000018 ? " (weak)" : ""));
        } else if (cmd === 0x21 || cmd === 0x2C) a.cripto = cv.getUint32(p + 16, true); // LC_ENCRYPTION_INFO(_64): cryptid
        else if (cmd === 0x25 || cmd === 0x24 || cmd === 0x2F || cmd === 0x30) {
          a.plataforma = { 0x25: "iOS", 0x24: "macOS", 0x2F: "tvOS", 0x30: "watchOS" }[cmd]; a.minOS = versao(cv.getUint32(p + 8, true)); a.sdk = versao(cv.getUint32(p + 12, true));
        } else if (cmd === 0x32) {
          a.plataforma = { 1: "macOS", 2: "iOS", 3: "tvOS", 4: "watchOS", 6: "Mac Catalyst", 7: "iOS Simulator", 11: "visionOS" }[cv.getUint32(p + 8, true)] || "";
          a.minOS = versao(cv.getUint32(p + 12, true)); a.sdk = versao(cv.getUint32(p + 16, true));
        } else if (cmd === 0x1D) a.assinado = true; // LC_CODE_SIGNATURE
        p += tam;
      }
      r.push(a);
    }
    return r.length ? r : null;
  }

  /* PNG and JPEG files kept whole inside another file (such as Assets.car) */
  function imagensSoltas(u8) {
    var r = [], n = u8.length, i = 0;
    while (r.length < 1000 && i < n - 12) {
      if (u8[i] === 0x89 && u8[i + 1] === 0x50 && u8[i + 2] === 0x4E && u8[i + 3] === 0x47 && u8[i + 4] === 0x0D && u8[i + 5] === 0x0A) {
        var p = i + 8, ok = false;
        while (p + 12 <= n) {
          var len = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
          if (len > n) break;
          var tipo = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
          p += 12 + len;
          if (tipo === "IEND") { ok = true; break; }
        }
        if (ok && p <= n) { r.push(new Blob([u8.slice(i, p)], { type: "image/png" })); i = p; continue; }
      } else if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF && (u8[i + 3] & 0xF0) === 0xE0) {
        for (var q = i + 4; q < n - 1; q++) if (u8[q] === 0xFF && u8[q + 1] === 0xD9) { r.push(new Blob([u8.slice(i, q + 2)], { type: "image/jpeg" })); i = q + 1; break; }
      }
      i++;
    }
    return r;
  }

  window.InkIOS = {
    imagensSoltas: imagensSoltas,
    plist: plist, ehBinario: ehBinario, provisionamento: provisionamento, xml: xml, js: js, resumo: resumo,
    texto: texto, pareceTexto: pareceTexto, hex: hex, ehCgbi: ehCgbi, cgbiParaPng: cgbiParaPng, macho: macho
  };
})();
