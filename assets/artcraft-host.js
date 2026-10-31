/* Página do Hub para os editores ArtCraft (WordCraft, GridCraft, DeckCraft; MIT/Apache-2.0).
   O editor compilado fica em artcraft/<app>/ (atualizado pela action artcraft.yml) e roda num iframe.
   Arquivo aberto pela tela inicial ou pelos apps do InkDOS: vem do IndexedDB "inkdos-tool-handoff"
   (?inkdos-handoff=<id>). WordCraft e GridCraft falam a ponte postMessage deles (?host=parent:
   <app>:ready/open/save/dirty); o DeckCraft não tem ponte, então o arquivo entra como se fosse
   arrastado para a janela e o Salvar do próprio editor baixa o arquivo. */
(function () {
  "use strict";
  var APP = document.body.getAttribute("data-artcraft");
  var PONTE = APP === "wordcraft" || APP === "gridcraft";
  var q = new URLSearchParams(location.search);
  var id = q.get("inkdos-handoff");
  if (id && !/^[A-Za-z0-9-]{8,64}$/.test(id)) id = null;
  var frame = document.getElementById("editor");
  var titulo = document.querySelector(".ink-title");
  var sujo = false, arquivo = null;

  function ler() {
    return new Promise(function (ok) {
      if (!id) return ok(null);
      var req = indexedDB.open("inkdos-tool-handoff", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
      req.onerror = function () { ok(null); };
      req.onsuccess = function () {
        var db = req.result, g = db.transaction("files", "readonly").objectStore("files").get(id);
        g.onsuccess = function () { db.close(); ok(g.result || null); };
        g.onerror = function () { db.close(); ok(null); };
      };
    });
  }

  function baixar(nome, bytes) {
    var url = URL.createObjectURL(new Blob([bytes]));
    var a = document.createElement("a");
    a.href = url; a.download = nome || "documento"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function mostrarNome(n) { if (n && titulo) { titulo.textContent = n; document.title = n + " · InkDOS Hub"; } }

  addEventListener("message", function (e) {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    var d = e.data || {}, t = String(d.type || "");
    if (t === APP + ":ready" && arquivo) {
      var b = arquivo.bytes instanceof ArrayBuffer ? arquivo.bytes.slice(0) : arquivo.bytes;
      frame.contentWindow.postMessage({ type: APP + ":open", name: arquivo.name, bytes: b }, location.origin);
    } else if (t === APP + ":save") {
      baixar(d.name, d.bytes);
      if (d.saveAs) mostrarNome(d.name);
    } else if (t === APP + ":dirty") {
      sujo = !!d.dirty;
    } else if (t === APP + ":failed") {
      erro(String(d.error || ""));
    }
  });
  addEventListener("beforeunload", function (e) { if (sujo) { e.preventDefault(); e.returnValue = ""; } });

  /* DeckCraft: entrega o arquivo como um arrastar-e-soltar na tela do editor. */
  function soltar(v) {
    var tentativas = 0;
    (function tentar() {
      var doc = null, alvo = null;
      try { doc = frame.contentDocument; alvo = doc && doc.querySelector("canvas"); } catch (_) {}
      var pronto = alvo && doc.getElementById(APP + "_loading") === null;
      if (!pronto) { if (++tentativas < 240) setTimeout(tentar, 250); return; }
      try {
        var dt = new DataTransfer();
        dt.items.add(new File([v.bytes], v.name, { type: v.type || "" }));
        ["dragenter", "dragover", "drop"].forEach(function (tipo) {
          alvo.dispatchEvent(new DragEvent(tipo, { bubbles: true, cancelable: true, dataTransfer: dt }));
        });
      } catch (_) {}
    })();
  }

  function erro(txt) {
    var p = document.getElementById("aviso");
    p.hidden = false;
    if (txt) p.querySelector("code").textContent = txt;
  }

  var base = "../../artcraft/" + APP + "/index.html";
  fetch(base, { method: "HEAD", cache: "no-store" }).then(function (r) {
    if (!r.ok) throw 0;
    return ler();
  }).then(function (v) {
    arquivo = v;
    if (v) mostrarNome(v.name);
    var extra = PONTE ? "?host=parent" : "?blank";
    frame.src = base + extra;
    if (!PONTE && v) frame.addEventListener("load", function () { soltar(v); }, { once: true });
  }).catch(function () { erro(""); });
})();
