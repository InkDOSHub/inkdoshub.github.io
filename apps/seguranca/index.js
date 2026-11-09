// Copy buttons for the PowerShell commands.
document.querySelectorAll(".cmd button").forEach(function (b) {
  b.onclick = function () {
    var t = b.parentNode.querySelector("code").textContent;
    function ok() { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () {});
  };
});
// One system open at a time (for browsers without <details name>).
document.querySelectorAll("details.so").forEach(function (d) {
  d.addEventListener("toggle", function () {
    if (d.open) document.querySelectorAll("details.so").forEach(function (o) { if (o !== d) o.open = false; });
  });
});
// PDF tools opened from here return to Security, not to the PDF app.
document.querySelectorAll('a[href*="/bentopdf/"]').forEach(function (a) {
  a.addEventListener("click", function () {
    try { sessionStorage.setItem("inkdos-return", location.href); sessionStorage.removeItem("inkdoshub-pdf-nome"); sessionStorage.setItem("inkdoshub-pdf-volta", "seguranca"); } catch (_) {}
  });
});
