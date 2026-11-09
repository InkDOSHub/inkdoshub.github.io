(function () {
  "use strict";
  var BASE = "https://inkdoshub.github.io/apps/seguranca/native/"; // scripts come from GitHub Pages (always current)
  var V = "8";
  // field: [id, label, type, default, options]
  var CARDS = [
    ["Easiest"],
    { t: "All tools in one menu", d: "Recommended. Paste this one command and pick from menus: PDF, Images, Video, Music and audio, Office documents, Files and folders. It asks for the folder and every option from a list. Everything runs on this device.", s: "inkmenu.py", a: [] },
    ["Safety"],
    { t: "Clean PDFs", d: "Neutralises JavaScript, auto actions, launch actions and embedded files in every PDF, in place. Same-size change, undo log included.", s: "inkclean.py", a: [] },
    { t: "Clean Office, check ZIPs and risky files", d: "Removes macros, external links and embedded objects from Word, Excel and PowerPoint (backup of each changed file), lists risky items inside ZIPs and loose executables.", s: "inksec.py", a: ["all", "--here"] },
    ["Find"],
    { t: "Folder sizes", d: "Every folder's size, biggest first.", s: "inkfinder.py", a: ["sizes"] },
    { t: "Search", d: "Files by minimum size, recent changes and type. Use 0 for any.", s: "inkfinder.py", a: ["search", "{mb}", "{days}", "{ext}"],
      f: [["mb", "Over (MB)", "number", "0"], ["days", "Changed in last days", "number", "0"], ["ext", "Extension", "text", "0"]] },
    { t: "Duplicates", d: "Files with the same content (same size, then same hash). Nothing is deleted.", s: "inkfinder.py", a: ["dupes"] },
    ["Organise"],
    { t: "Merge another folder into this one", d: "Asks for this folder, then for the other one, and copies everything from the other folder, choosing what to do when a file already exists.", s: "inkfinder.py", a: ["merge", "-", "{rule}", "{prev}"],
      f: [["rule", "When it exists", "select", "keep", ["keep", "replace", "skip"]], ["prev", "Preview only", "check", true]] },
    { t: "Batch rename", d: "Renames the files in this folder (not subfolders): replace text, add numbers and/or the file date.", s: "inkfinder.py", a: ["rename", "{find}", "{to}", "{num}", "{date}", "{prev}"],
      f: [["find", "Find", "text", ""], ["to", "Replace with / new name", "text", ""], ["num", "Add 001, 002…", "check", false], ["date", "Add date", "check", false], ["prev", "Preview only", "check", true]] },
    { t: "Sync to another folder", d: "Asks for this folder, then for the destination, and copies new and changed files. Nothing is deleted.", s: "inkfinder.py", a: ["sync", "{prev}"],
      f: [["prev", "Preview only", "check", true]] },
    ["Archives"],
    { t: "Zip this folder", d: "Creates NAME.zip next to the folder, a file at a time.", s: "inkfinder.py", a: ["zip", "{name}"], f: [["name", "Zip name", "text", "archive"]] },
    { t: "Unzip", d: "Asks for the folder, lists its .zip files to pick from and extracts into a folder with the same name.", s: "inkfinder.py", a: ["unzip"] },
    ["Convert"],
    { t: "Video or audio", d: "Asks for the folder, lists its videos and audio files to pick from and converts it. Uses ffmpeg (built into a-Shell; on a computer install it first).", s: "inkfinder.py", a: ["video", "{to}"],
      f: [["to", "Convert to", "select", "mp4", ["mp4", "mov", "mkv", "webm", "gif", "mp3", "m4a", "wav", "flac"]]] },
    { t: "Images in batch", d: "Asks for the folder and converts every image of one type in it. Originals are kept.", s: "inkfinder.py", a: ["images", "{from}", "{to}"],
      f: [["from", "From", "select", "heic", ["heic", "png", "jpg", "webp", "tiff", "gif", "bmp"]], ["to", "To", "select", "jpg", ["jpg", "png", "webp", "tiff", "gif", "bmp", "pdf"]]] },
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
    if (pasta) args.push("--in");
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
