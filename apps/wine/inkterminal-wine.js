/* Partes do InkTerminal dentro do emulador (emulador.html), carregadas depois do boxedwine-shell.js.

   1. Programas da pessoa: index.html guarda o .exe, .msi ou .zip no IndexedDB "inkterminal-wine"
      (loja "entrada") e abre o emulador com ?ink-programa=<id>. Antes de o Wine ligar, o arquivo é
      gravado no disco D: (D:\Programas\<pasta>, que fica guardado no aparelho) e vira o programa a
      abrir. Um .zip é extraído ali. Depois disso a entrada é apagada: o programa mora no D:.
   2. Toque no iPad: index.html manda {tipo:"wine:teclado"} para abrir o teclado do iPad e
      {tipo:"wine:direito", ligado} para o próximo toque valer como clique com o botão direito. */
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  var D = "/home/username/.wine/dosdevices/d:";

  function lerEntrada(id) {
    return new Promise(function (ok) {
      var req = indexedDB.open("inkterminal-wine", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("entrada"); };
      req.onerror = function () { ok(null); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction("entrada", "readwrite"), st = tx.objectStore("entrada"), get = st.get(id);
        get.onsuccess = function () { ok(get.result || null); st.delete(id); };
        get.onerror = function () { ok(null); };
        tx.oncomplete = function () { db.close(); };
      };
    });
  }

  /* Lê um .zip (só "guardado" e "deflate", os dois que os .zip comuns usam). */
  function extrair(bytes) {
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), fim = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) return Promise.reject(new Error("zip sem diretório central"));
    var n = v.getUint16(fim + 10, true), p = v.getUint32(fim + 16, true), lista = [];
    for (var k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var flag = v.getUint16(p + 8, true), metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true);
      var ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
      var nome = new TextDecoder(flag & 0x800 ? "utf-8" : "latin1").decode(bytes.subarray(p + 46, p + 46 + ln));
      var ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      lista.push({ nome: nome.replace(/\\/g, "/"), metodo: metodo, dados: bytes.subarray(ini, ini + tam) });
      p += 46 + ln + le + lc;
    }
    return lista.reduce(function (cadeia, e) {
      return cadeia.then(function (saida) {
        if (/\/$/.test(e.nome)) { saida.push({ nome: e.nome, pasta: true }); return saida; }
        if (e.metodo === 0) { saida.push({ nome: e.nome, dados: e.dados }); return saida; }
        if (e.metodo !== 8) throw new Error("compressão não suportada em " + e.nome);
        var s = new Blob([e.dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Response(s).arrayBuffer().then(function (b) { saida.push({ nome: e.nome, dados: new Uint8Array(b) }); return saida; });
      });
    }, Promise.resolve([]));
  }

  function gravar(base, rel, dados) {
    var partes = rel.split("/").filter(function (x) { return x && x !== "." && x !== ".."; });
    if (!partes.length) return;
    var arq = dados ? partes.pop() : null;
    var dir = base;
    partes.forEach(function (x) { try { FS.mkdir(dir + "/" + x); } catch (_) {} dir += "/" + x; });
    if (arq) { try { FS.unlink(dir + "/" + arq); } catch (_) {} FS.writeFile(dir + "/" + arq, dados); }
  }

  function instalar(e) {
    // e: {nome, pasta, exe (caminho dentro da pasta), tipo: "exe"|"msi"|"zip", dados: ArrayBuffer}
    var base = Config.d_drive + "/Programas";
    try { FS.mkdir(base); } catch (_) {}
    base += "/" + e.pasta;
    try { FS.mkdir(base); } catch (_) {}
    var bytes = new Uint8Array(e.dados);
    var feito = e.tipo === "zip" ? extrair(bytes).then(function (l) {
      l.forEach(function (x) { if (x.pasta) gravar(base, x.nome, null); else gravar(base, x.nome, x.dados); });
    }) : Promise.resolve(gravar(base, e.exe, bytes));
    return feito.then(function () {
      // grava no IndexedDB já (o IDBFS também grava sozinho, mas sem pressa)
      return new Promise(function (ok) { FS.syncfs(false, function () { ok(); }); });
    });
  }

  function definirPrograma(pasta, exe, tipo) {
    var rel = exe.split("/"), arq = rel.pop();
    Config.WorkingDir = D + "/Programas/" + pasta + (rel.length ? "/" + rel.join("/") : "");
    if (tipo === "msi" || /\.msi$/i.test(arq)) { Config.Program = "msiexec"; Config.ProgramArgs = ["/i", arq]; }
    else { Config.Program = arq; Config.ProgramArgs = []; }
  }

  var id = q.get("ink-programa");
  if (id && /^[A-Za-z0-9-]{4,64}$/.test(id) && typeof buildBrowserFileSystem === "function") {
    var original = buildBrowserFileSystem;
    // initBrowserFilesystem chama buildBrowserFileSystem pelo nome global, então esta troca vale
    buildBrowserFileSystem = function () {
      var args = arguments, self = this;
      Module.setStatus && Module.setStatus("Guardando o programa no disco D:…");
      lerEntrada(id).then(function (e) {
        if (!e) return;
        return instalar(e).then(function () { definirPrograma(e.pasta, e.exe, e.tipo); });
      }).catch(function (err) {
        console.error("InkTerminal: não consegui gravar o programa no D:", err);
        if (window.parent !== window) window.parent.postMessage({ tipo: "wine:erro", texto: String(err && err.message || err) }, location.origin);
      }).then(function () { original.apply(self, args); });
    };
  } else if (q.get("ink-pasta") && q.get("ink-exe")) {
    // programa já guardado no D:
    var pasta = q.get("ink-pasta"), exe = q.get("ink-exe"), tipo = q.get("ink-tipo") || "exe";
    var orig2 = buildBrowserFileSystem;
    buildBrowserFileSystem = function () { definirPrograma(pasta, exe, tipo); return orig2.apply(this, arguments); };
  }

  /* ---------- Toque no iPad ---------- */
  var direito = false;
  var campo = document.createElement("textarea");
  campo.setAttribute("autocapitalize", "off");
  campo.setAttribute("autocorrect", "off");
  campo.setAttribute("autocomplete", "off");
  campo.setAttribute("spellcheck", "false");
  campo.setAttribute("aria-label", "Teclado");
  campo.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;z-index:-1";
  addEventListener("DOMContentLoaded", function () { document.body.appendChild(campo); });
  // as teclas chegam ao SDL pelo window (o campo só existe para o iPad mostrar o teclado)
  campo.addEventListener("input", function () { campo.value = ""; });

  function canvas() { return document.getElementById("canvas"); }
  function clique(x, y, botao) {
    var c = canvas(); if (!c) return;
    var o = { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: botao, buttons: botao === 2 ? 2 : 1, view: window };
    c.dispatchEvent(new MouseEvent("mousemove", o));
    c.dispatchEvent(new MouseEvent("mousedown", o));
    setTimeout(function () { o.buttons = 0; c.dispatchEvent(new MouseEvent("mouseup", o)); }, 60);
  }
  /* Com "clique direito" ligado, o próximo toque vira um clique com o botão direito. Também dá para
     segurar o dedo por meio segundo, em qualquer momento. */
  var segurar = null, inicio = null;
  document.addEventListener("touchstart", function (e) {
    var t = e.touches[0];
    if (!t || !canvas() || !canvas().contains(e.target)) return;
    if (direito) {
      e.preventDefault(); e.stopPropagation();
      direito = false; avisar();
      clique(t.clientX, t.clientY, 2);
      return;
    }
    inicio = { x: t.clientX, y: t.clientY };
    clearTimeout(segurar);
    segurar = setTimeout(function () { segurar = null; if (inicio) clique(inicio.x, inicio.y, 2); inicio = null; }, 550);
  }, { capture: true, passive: false });
  document.addEventListener("touchmove", function (e) {
    var t = e.touches[0];
    if (inicio && t && Math.hypot(t.clientX - inicio.x, t.clientY - inicio.y) > 10) { clearTimeout(segurar); inicio = null; }
  }, true);
  ["touchend", "touchcancel"].forEach(function (n) { document.addEventListener(n, function () { clearTimeout(segurar); inicio = null; }, true); });

  function avisar() {
    if (window.parent !== window) window.parent.postMessage({ tipo: "wine:direito", ligado: direito }, location.origin);
  }
  addEventListener("message", function (e) {
    if (e.origin !== location.origin || e.source !== window.parent || !e.data) return;
    if (e.data.tipo === "wine:teclado") { campo.focus(); }
    if (e.data.tipo === "wine:direito") { direito = !!e.data.ligado; avisar(); }
    if (e.data.tipo === "wine:enviar" && e.data.arquivos && typeof startWithFiles === "function") {
      // arquivos vão para a raiz do D:
      startWithFiles(e.data.arquivos);
      setTimeout(function () { try { FS.syncfs(false, function () {}); } catch (_) {} }, 1500);
      window.parent.postMessage({ tipo: "wine:enviado", n: e.data.arquivos.length }, location.origin);
    }
  });
})();
