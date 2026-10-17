(function () {
  "use strict";
  var nome = new URLSearchParams(location.search).get("nome") || "App";
  var volta = "";
  try { volta = decodeURIComponent(location.hash.slice(1)); } catch (_) {}
  // só endereços deste site
  try { if (new URL(volta).origin !== location.origin) volta = ""; } catch (_) { volta = ""; }
  document.getElementById("titulo").textContent = nome + " foi guardado";
  document.title = nome + " (guardado) · InkTerminal";
  var b = document.getElementById("reabrir");
  if (!volta) b.disabled = true;
  b.addEventListener("click", function () { location.replace(volta); });
})();
