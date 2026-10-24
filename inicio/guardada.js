(function () {
  "use strict";
  var nome = new URLSearchParams(location.search).get("nome") || "App";
  var volta = "";
  try { volta = decodeURIComponent(location.hash.slice(1)); } catch (_) {}
  // só endereços deste site
  try { if (new URL(volta).origin !== location.origin) volta = ""; } catch (_) { volta = ""; }
  var t = window.InkIdioma ? InkIdioma.t : function (s, p) { return s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  document.getElementById("titulo").textContent = t("{name} was put away", { name: nome });
  setTimeout(function () { document.title = t("{name} (put away)", { name: nome }) + " · InkDOS Hub"; });
  var b = document.getElementById("reabrir");
  if (!volta) b.disabled = true;
  b.addEventListener("click", function () { location.replace(volta); });
})();
