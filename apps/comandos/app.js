(function () {
  "use strict";
  var BASE = new URL("../seguranca/native/", location.href).href;
  var V = "3";
  // field: [id, label, type, default, options]
  var CARDS = [
    ["Safety"],
    { t: "Clean PDFs", d: "Neutralises JavaScript, auto actions, launch actions and embedded files in every PDF, in place. Same-size change, undo log included.", s: "inkclean.py", a: [] },
    { t: "Clean Office, check ZIPs and risky files", d: "Removes macros, external links and embedded objects from Word, Excel and PowerPoint (backup of each changed file), lists risky items inside ZIPs and loose executables.", s: "inksec.py", a: ["all", "--here"] },
    ["Find"],
    { t: "Folder sizes", d: "Every folder's size, biggest first.", s: "inkfinder.py", a: ["sizes"] },
    { t: "Search", d: "Files by minimum size, recent changes and type. Use 0 for any.", s: "inkfinder.py", a: ["search", "{mb}", "{days}", "{ext}"],
      f: [["mb", "Over (MB)", "number", "0"], ["days", "Changed in last days", "number", "0"], ["ext", "Extension", "text", "0"]] },
    { t: "Duplicates", d: "Files with the same content (same size, then same hash). Nothing is deleted.", s: "inkfinder.py", a: ["dupes"] },
    ["Organise"],
    { t: "Merge another folder into this one", d: "Copies everything from the other folder, choosing what to do when a file already exists.", s: "inkfinder.py", a: ["merge", "{src}", "{rule}", "{prev}"],
      f: [["src", "Other folder path", "text", ""], ["rule", "When it exists", "select", "keep", ["keep", "replace", "skip"]], ["prev", "Preview only", "check", true]] },
    { t: "Batch rename", d: "Renames the files in this folder (not subfolders): replace text, add numbers and/or the file date.", s: "inkfinder.py", a: ["rename", "{find}", "{to}", "{num}", "{date}", "{prev}"],
      f: [["find", "Find", "text", ""], ["to", "Replace with / new name", "text", ""], ["num", "Add 001, 002…", "check", false], ["date", "Add date", "check", false], ["prev", "Preview only", "check", true]] },
    { t: "Sync to another folder", d: "Copies new and changed files from this folder to the other one. Nothing is deleted.", s: "inkfinder.py", a: ["sync", "{dst}", "{prev}"],
      f: [["dst", "Destination folder path", "text", ""], ["prev", "Preview only", "check", true]] },
    ["Archives"],
    { t: "Zip this folder", d: "Creates NAME.zip next to the folder, a file at a time.", s: "inkfinder.py", a: ["zip", "{name}"], f: [["name", "Zip name", "text", "archive"]] },
    { t: "Unzip", d: "Extracts a .zip into a folder with the same name.", s: "inkfinder.py", a: ["unzip", "{zip}"], f: [["zip", "Zip file path or name", "text", "archive.zip"]] },
    ["Convert"],
    { t: "Video or audio", d: "Needs ffmpeg in the terminal (a-Shell: check with help -l). Examples: mkv to mp4, or audio only with .mp3.", raw: "ffmpeg -i \"{in}\" \"{out}\"", f: [["in", "Input file", "text", "video.mkv"], ["out", "Output file", "text", "video.mp4"]] },
    { t: "Images in batch", d: "Needs ImageMagick (a-Shell: check with help -l). Converts every image of one type in this folder.", raw: "magick mogrify -format {to} *.{from}", f: [["from", "From", "text", "heic"], ["to", "To", "text", "jpg"]] },
    ["Test"],
    { t: "Self-test", d: "Creates its own sample files, runs every job above and writes a log with time and memory. Needs about 1.5 GB free for a moment.", s: "inkfinder.py", a: ["test"] }
  ];

  function limpa(v) { return String(v).replace(/["'`$]/g, "").replace(/\\+$/, "").trim(); }
  function q(v) { return "r'" + limpa(v) + "'"; }

  function montar(c, vals) {
    var sub = function (s) { return s.replace(/\{(\w+)\}/g, function (_, k) { return limpa(vals[k]); }); };
    if (c.raw) return sub(c.raw);
    var args = [];
    c.a.forEach(function (x) {
      var m = /^\{(\w+)\}$/.exec(x);
      if (!m) { args.push(x); return; }
      var k = m[1], v = vals[k];
      if (k === "prev") { if (v) args.push("preview"); return; }
      if (k === "num") { if (v) args.push("number"); return; }
      if (k === "date") { if (v) args.push("date"); return; }
      args.push(v === "" ? "" : v);
    });
    var pasta = limpa(document.getElementById("pasta").value);
    var ch = pasta ? "import os;os.chdir(" + q(pasta) + ");" : "";
    return document.getElementById("py").value + " -c \"" + ch + "import sys,urllib.request as u;sys.argv=['x'" +
      args.map(function (a) { return "," + q(a); }).join("") + "];exec(u.urlopen(u.Request('" + BASE + c.s + "?v=" + V +
      "',headers={'User-Agent':'curl/8'})).read())\"";
  }

  function copiar(txt, btn) {
    var ok = function () { var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = o; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, function () {}); 
  }

  var lista = document.getElementById("lista"), atualizar = [];
  CARDS.forEach(function (c) {
    if (Array.isArray(c)) { var h = document.createElement("p"); h.className = "grupo"; h.textContent = c[0]; lista.appendChild(h); return; }
    var card = document.createElement("div"); card.className = "card"; card.style.marginTop = "10px";
    var h2 = document.createElement("h2"); h2.textContent = c.t; card.appendChild(h2);
    var p = document.createElement("p"); p.className = "nota"; p.textContent = c.d; card.appendChild(p);
    var ins = {};
    if (c.f) {
      var linha = document.createElement("div"); linha.className = "linha";
      c.f.forEach(function (f) {
        var lab = document.createElement("label"), el;
        if (f[2] === "check") {
          lab.className = "chk"; el = document.createElement("input"); el.type = "checkbox"; el.checked = f[3];
          lab.appendChild(el); lab.appendChild(document.createTextNode(f[1]));
        } else {
          lab.className = "campo"; lab.appendChild(document.createTextNode(f[1]));
          if (f[2] === "select") { el = document.createElement("select"); f[4].forEach(function (o) { var op = document.createElement("option"); op.textContent = o; el.appendChild(op); }); el.value = f[3]; }
          else { el = document.createElement("input"); el.type = f[2]; el.value = f[3]; el.autocapitalize = "off"; el.spellcheck = false; }
          lab.appendChild(el);
        }
        ins[f[0]] = el; linha.appendChild(lab);
      });
      card.appendChild(linha);
    }
    var pre = document.createElement("pre"); card.appendChild(pre);
    var b = document.createElement("button"); b.type = "button"; b.className = "copiar"; b.textContent = "Copy"; card.appendChild(b);
    var at = function () {
      var vals = {}; Object.keys(ins).forEach(function (k) { vals[k] = ins[k].type === "checkbox" ? ins[k].checked : ins[k].value; });
      pre.textContent = montar(c, vals);
    };
    card.addEventListener("input", at); card.addEventListener("change", at);
    b.addEventListener("click", function () { copiar(pre.textContent, b); });
    atualizar.push(at); at(); lista.appendChild(card);
  });
  ["pasta", "py"].forEach(function (id) { document.getElementById(id).addEventListener("input", function () { atualizar.forEach(function (f) { f(); }); }); });
  document.getElementById("py").addEventListener("change", function () { atualizar.forEach(function (f) { f(); }); });
  document.querySelectorAll("[data-copia]").forEach(function (b) { b.addEventListener("click", function () { copiar(b.dataset.copia, b); }); });
})();
