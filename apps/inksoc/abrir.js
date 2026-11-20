/* Opens an .exe or .msi from the Hub's "Open file" (inicio/lancador.js) in InkSoC.
   The file waits in IndexedDB "inkdoshub-entrada" (#ink-arquivos=<id>). InkSoC opens in a frame
   with ?file=1 (it waits for a file, as in an InkOS window) and gets the file as the "inkos:file"
   event, the same path InkOS uses: .exe runs, .msi installs. Same origin, so the event is sent
   straight to the frame (no postMessage). */
(function () {
  "use strict";
  var msg = document.getElementById("msg");
  var m = /(?:^#|&)ink-arquivos=([A-Za-z0-9-]+)/.exec(location.hash);
  function falha(t) { msg.textContent = t; }
  function abrirInkSoC(arq) {
    var fr = document.createElement("iframe");
    fr.src = "/InkSoC/?file=1";
    fr.allow = "cross-origin-isolated; fullscreen; clipboard-read; clipboard-write; gamepad";
    fr.addEventListener("load", function () {
      msg.remove();
      var w = fr.contentWindow;
      // after engine.js has its listener in place
      setTimeout(function () {
        try {
          var f = new w.File([arq.data], arq.name, { type: arq.type || "", lastModified: arq.lastModified || Date.now() });
          w.dispatchEvent(new w.CustomEvent("inkos:file", { detail: f, cancelable: true }));
        } catch (e) { falha("Could not hand the file to InkSoC: " + (e && e.message || e)); }
      }, 300);
    }, { once: true });
    document.body.appendChild(fr);
  }
  // the program names its window: show it in the tab
  addEventListener("message", function (e) {
    if (e.origin === location.origin && e.data && e.data.type === "inkos-title" && typeof e.data.title === "string") document.title = e.data.title.slice(0, 128);
  });
  if (!m || !window.indexedDB) { location.replace("/InkSoC/"); return; }
  var id = m[1];
  try { history.replaceState(null, "", location.pathname); } catch (_) {}
  var req = indexedDB.open("inkdoshub-entrada", 1);
  req.onupgradeneeded = function () { req.result.createObjectStore("arquivos"); };
  req.onerror = function () { falha("Could not read the file."); };
  req.onsuccess = function () {
    var db = req.result, tx = db.transaction("arquivos", "readwrite"), st = tx.objectStore("arquivos"), get = st.get(id);
    get.onsuccess = function () {
      var v = get.result;
      st.delete(id);
      if (!v || !v.arquivos || !v.arquivos.length) { location.replace("/InkSoC/"); return; }
      abrirInkSoC(v.arquivos[0]);
    };
    tx.oncomplete = function () { db.close(); };
  };
})();
