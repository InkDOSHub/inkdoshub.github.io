/* ☰ > Diagnostics: o que este navegador oferece e quanto tempo levou cada etapa da última
   abertura de arquivo (anotadas por InkPaginas.marcar em assets/gerenciador-app.js). */
(function () {
  "use strict";
  var btn = document.getElementById("btn-diag"), sec = document.getElementById("diagnostico"), pre = document.getElementById("diag-texto");
  if (!btn || !sec || !pre) return;
  var t = window.InkIdioma ? InkIdioma.t : function (s) { return s; };
  function sim(v) { return v ? "yes" : "no"; }

  function relatorio() {
    var l = [], n = navigator;
    l.push("Date: " + new Date().toISOString());
    l.push("Browser: " + n.userAgent);
    l.push("Installed app: " + sim(matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || n.standalone));
    l.push("Opens files from the system (launchQueue): " + sim(window.launchQueue));
    l.push("Service worker: " + ("serviceWorker" in n ? (n.serviceWorker.controller ? "active" : "supported, not active") : "not supported"));
    l.push("IndexedDB: " + sim(window.indexedDB) + " · Cache Storage: " + sim(window.caches));
    l.push("Memory: " + (n.deviceMemory ? n.deviceMemory + " GB" : "?") + " · CPU cores: " + (n.hardwareConcurrency || "?"));
    var c = n.connection;
    if (c) l.push("Network: " + (c.effectiveType || "?") + (c.downlink ? ", " + c.downlink + " Mb/s" : "") + (c.rtt ? ", " + c.rtt + " ms" : ""));
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (nav && nav.loadEventEnd) l.push("This page: HTML ready " + Math.round(nav.domContentLoadedEventEnd) + " ms, fully loaded " + Math.round(nav.loadEventEnd) + " ms");
    var d = null;
    try { d = JSON.parse(localStorage.getItem("inkdoshub-diag") || "null"); } catch (_) {}
    l.push("");
    if (!d || !d.etapas || !d.etapas.length) l.push("Last file opening: none yet. Open a file from XeOS and come back.");
    else {
      l.push("Last file opening (" + new Date(d.t0).toLocaleString() + "):");
      var ant = d.t0;
      d.etapas.forEach(function (e) {
        l.push("  +" + ((e.t - d.t0) / 1000).toFixed(2) + " s  (" + (e.t - ant) + " ms)  " + e.nome + "  [" + e.pagina + "]");
        ant = e.t;
      });
    }
    return l.join("\n");
  }

  function mostrar() {
    pre.textContent = relatorio();
    sec.hidden = false;
    var menu = document.getElementById("menu-inicio"); if (menu) menu.open = false;
    sec.scrollIntoView({ block: "nearest" });
  }
  btn.addEventListener("click", mostrar);
  document.getElementById("diag-fechar").addEventListener("click", function () { sec.hidden = true; });
  document.getElementById("diag-copiar").addEventListener("click", function () {
    var b = this;
    function ok() { b.textContent = t("Copied"); setTimeout(function () { b.textContent = t("Copy report"); }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pre.textContent).then(ok, selecionar);
    else selecionar();
    function selecionar() { var r = document.createRange(); r.selectNodeContents(pre); var s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
  // ?diag na tela inicial abre o painel direto
  if (/[?&]diag\b/.test(location.search)) mostrar();
})();
