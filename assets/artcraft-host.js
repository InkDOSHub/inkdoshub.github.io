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

  /* Arquivo aberto no XeOS: chega direto aqui (manifest.webmanifest, "file_handlers"), sem passar
     pela tela inicial. Se a pessoa escolheu os editores do InkDOS no ☰, vai para o app do InkDOS. */
  var doXeos = null;
  var chegou = new Promise(function (ok) {
    if (!window.launchQueue || typeof launchQueue.setConsumer !== "function") return ok();
    launchQueue.setConsumer(function (params) {
      var h = params && params.files && params.files[0];
      if (!h) return ok();
      h.getFile().then(function (f) { return f.arrayBuffer().then(function (b) { doXeos = { bytes: b, name: f.name, type: f.type || "" }; }); })
        .then(function () { if (window.InkPaginas && InkPaginas.marcar) InkPaginas.marcar("app: file received from XeOS"); paraInkdos(); ok(); }, function () { ok(); });
    });
    // sem arquivo do XeOS o consumidor não é chamado: segue depois de a página carregar
    addEventListener("load", function () { setTimeout(ok, 0); });
  });
  function paraInkdos() {
    var pref = null;
    try { pref = localStorage.getItem("inkdoshub-abrir-office"); } catch (_) {}
    if (!pref && /iPhone|iPod|Android.+Mobile/.test(navigator.userAgent)) pref = "inkdos";
    if (pref !== "inkdos") return;
    var nome = { wordcraft: "documents", gridcraft: "spreadsheets", deckcraft: "presentations" }[APP], idn = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    var req = indexedDB.open("inkdos-launch-handoff", 1);
    req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
    req.onsuccess = function () {
      var db = req.result, tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put({ name: doXeos.name, type: doXeos.type, lastModified: Date.now(), data: doXeos.bytes, at: Date.now() }, idn);
      tx.oncomplete = function () { db.close(); location.replace("../../inkdos/apps/" + nome + "/index.html?suite=1#inkdos-launch=" + idn); };
    };
    doXeos = null;
    throw 0; // para o carregamento do ArtCraft
  }

  function ler() {
    return new Promise(function (ok) {
      if (doXeos) return ok(doXeos);
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
    var url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes]));
    var a = document.createElement("a");
    a.href = url; a.download = nome || "documento"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function mostrarNome(n) { if (n && titulo) { titulo.textContent = n; document.title = n + " · InkDOS Hub"; } }

  addEventListener("message", function (e) {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    var d = e.data || {}, t = String(d.type || "");
    if (t === APP + ":ready") pronto();
    if (t === APP + ":ready" && arquivo) {
      var b = arquivo.bytes instanceof ArrayBuffer ? arquivo.bytes.slice(0) : arquivo.bytes;
      frame.contentWindow.postMessage({ type: APP + ":open", name: arquivo.name, bytes: b }, location.origin);
    } else if (t === APP + ":save") {
      baixar(d.name, d.bytes);
      if (d.saveAs) mostrarNome(d.name);
    } else if (t === APP + ":dirty") {
      sujo = !!d.dirty;
    } else if (t === APP + ":failed") {
      pronto();
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

  /* Aviso de carregamento: "Aguardando download", "Baixando N%" (o .wasm, tamanho em artcraft/tamanhos.json)
     e "Abrindo" até o editor ficar pronto. O download fica no cache do navegador e o editor o reaproveita. */
  var carga = document.createElement("div");
  carga.id = "carga";
  carga.style.cssText = "position:fixed;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:var(--muted);font-size:15px;pointer-events:none";
  document.body.appendChild(carga);
  function tr(txt, v) { return window.InkIdioma ? InkIdioma.t(txt, v) : txt.replace("{n}", v && v.n); }
  function status(txt, v) { carga.hidden = false; carga.textContent = tr(txt, v); }
  function pronto() { carga.hidden = true; }

  function baixarWasm(dir) {
    return fetch(dir + "../tamanhos.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (tam) {
      var info = tam[APP];
      if (!info) return;
      return fetch(dir + info.wasm).then(function (r) {
        if (!r.ok || !r.body || !r.body.getReader) return r.arrayBuffer();
        var leitor = r.body.getReader(), lidos = 0;
        return (function ler() {
          return leitor.read().then(function (p) {
            if (p.done) return;
            lidos += p.value.length;
            status("Downloading {n}%", { n: Math.min(100, Math.floor(lidos * 100 / info.bytes)) });
            return ler();
          });
        })();
      });
    }).catch(function () {});
  }

  /* DeckCraft baixa o arquivo de dentro do iframe, e o XeOS recusa downloads feitos num iframe
     ("invalid path"). Aqui o clique no link de download dele é desviado para esta página. */
  function desviarDownloads() {
    try {
      var w = frame.contentWindow, clique = w.HTMLAnchorElement.prototype.click;
      w.HTMLAnchorElement.prototype.click = function () {
        if (this.download && /^blob:/.test(this.href)) {
          var nome = this.download;
          fetch(this.href).then(function (r) { return r.blob(); }).then(function (b) { baixar(nome, b); });
          return;
        }
        return clique.apply(this, arguments);
      };
    } catch (_) {}
  }

  function esperarDeck() {
    var n = 0;
    (function ver() {
      var doc = null;
      try { doc = frame.contentDocument; } catch (_) {}
      if (doc && doc.querySelector("canvas") && !doc.getElementById(APP + "_loading")) return pronto();
      if (++n < 480) setTimeout(ver, 250); else pronto();
    })();
  }

  /* WordCraft: sem o botão do Discord na barra de título (opção "show_discord" das preferências dele,
     guardadas em localStorage "wordcraft.ui", que o iframe lê ao abrir). */
  if (APP === "wordcraft") try {
    var pref = {};
    try { pref = JSON.parse(localStorage.getItem("wordcraft.ui") || "{}") || {}; } catch (_) {}
    if (pref.show_discord !== false) { pref.show_discord = false; localStorage.setItem("wordcraft.ui", JSON.stringify(pref)); }
  } catch (_) {}

  var dir = "../../artcraft/" + APP + "/", base = dir + "index.html";
  status("Waiting for download…");
  fetch(base, { method: "HEAD", cache: "no-store" }).then(function (r) {
    if (!r.ok) throw 0;
    return baixarWasm(dir);
  }).then(function () {
    status("Opening…");
    return chegou;
  }).then(function () {
    return ler();
  }).then(function (v) {
    arquivo = v;
    if (v) mostrarNome(v.name);
    var extra = PONTE ? "?host=parent" : "?blank";
    frame.src = base + extra;
    if (!PONTE) frame.addEventListener("load", function () { desviarDownloads(); if (v) soltar(v); esperarDeck(); }, { once: true });
  }).catch(function () { pronto(); erro(""); });
})();
