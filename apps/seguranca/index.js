// Copy buttons for the PowerShell commands.
document.querySelectorAll(".cmd button").forEach(function (b) {
  b.onclick = function () {
    var t = b.parentNode.querySelector("code").textContent;
    function ok() { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () {});
  };
});
