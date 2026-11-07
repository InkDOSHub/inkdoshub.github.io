/* Guide: a short "start here" in the home menu (☰ › Guide). */
(function () {
  var b = document.getElementById("btn-guia"), d = document.getElementById("dlg-guia");
  if (!b || !d) return;
  b.onclick = function () { var m = document.getElementById("menu-inicio"); if (m) m.open = false; d.showModal(); };
})();
