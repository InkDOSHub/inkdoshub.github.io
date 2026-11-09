// Check PDF security: scans raw bytes and decompressed object streams for risky PDF features. Runs only on this device.
(function () {
  var pt = /^pt/i.test(document.documentElement.lang || navigator.language || "");
  function T(p, e) { return pt ? p : e; }
  if (pt) {
    document.getElementById("titulo").textContent = "Verificar segurança do PDF";
    document.title = "Verificar segurança do PDF · InkDOS Hub";
    document.getElementById("sobre").textContent = "Analisa o PDF em busca de recursos de risco: JavaScript, ações automáticas, abertura de programas, arquivos embutidos, formulários que enviam dados, links externos, conteúdo oculto ou disfarçado e criptografia. O arquivo não sai deste aparelho. Um relatório limpo reduz o risco, mas não é garantia.";
    document.getElementById("dica").textContent = "Solte um PDF aqui";
    document.getElementById("escolher").textContent = "Escolher PDF";
    document.getElementById("lote-arq").textContent = "Limpar vários arquivos";
    document.getElementById("lote-pasta").textContent = "Limpar uma pasta";
  }
  var arq = document.getElementById("arq"), solta = document.getElementById("solta");
  document.getElementById("escolher").onclick = function (e) { e.preventDefault(); arq.click(); };
  arq.onchange = function () { if (arq.files[0]) analisar(arq.files[0]); arq.value = ""; };
  solta.addEventListener("dragover", function (e) { e.preventDefault(); solta.classList.add("sobre"); });
  solta.addEventListener("dragleave", function () { solta.classList.remove("sobre"); });
  solta.addEventListener("drop", function (e) { e.preventDefault(); solta.classList.remove("sobre"); var f = e.dataTransfer.files[0]; if (f) analisar(f); });

  function latin1(u8) { var s = "", i, n = 0x8000; for (i = 0; i < u8.length; i += n) s += String.fromCharCode.apply(null, u8.subarray(i, i + n)); return s; }
  // PDF names may hide letters as #xx (e.g. /J#61vaScript)
  function normNomes(s) { return s.replace(/\/[^\s\/<>\[\]()%{}]*#[0-9A-Fa-f]{2}[^\s\/<>\[\]()%{}]*/g, function (m) { return m.replace(/#([0-9A-Fa-f]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); }); }); }
  function inflarU8(bytes, fmt) { // whole stream, no size cap
    var ds = new DecompressionStream(fmt), w = ds.writable.getWriter();
    w.write(bytes).catch(function () {}); w.close().catch(function () {});
    return new Response(ds.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  // reads a ZIP's file list without loading it; entries point to slices of the original file
  function lerZip(f) { // ZIP and ZIP64 (over 4 GB)
    var cauda = Math.min(f.size, 65557 + 20), M = 0xFFFFFFFF, base = f.size - cauda;
    function u64(d, o) { return Number(d.getBigUint64(o, true)); }
    return f.slice(base).arrayBuffer().then(function (b) {
      var d = new DataView(b), p = -1;
      for (var i = b.byteLength - 22; i >= 0; i--) if (d.getUint32(i, true) === 0x06054b50) { p = i; break; }
      if (p < 0) throw new Error("ZIP?");
      var n = d.getUint16(p + 10, true), tam = d.getUint32(p + 12, true), off = d.getUint32(p + 16, true);
      if (p >= 20 && d.getUint32(p - 20, true) === 0x07064b50) { // ZIP64 end record
        var r64 = u64(d, p - 12);
        return f.slice(r64, r64 + 56).arrayBuffer().then(function (eb) { var e = new DataView(eb); return [u64(e, 32), u64(e, 40), u64(e, 48)]; });
      }
      return [n, tam, off];
    }).then(function (x) {
      var n = x[0], tam = x[1], off = x[2];
      return f.slice(off, off + tam).arrayBuffer().then(function (cb) {
        var c = new DataView(cb), q = 0, ents = [], dec = new TextDecoder();
        for (var k = 0; k < n; k++) {
          var nl = c.getUint16(q + 28, true), el = c.getUint16(q + 30, true), cl = c.getUint16(q + 32, true);
          var e = { dt: [c.getUint16(q + 12, true), c.getUint16(q + 14, true)], nome: dec.decode(new Uint8Array(cb, q + 46, nl)), m: c.getUint16(q + 10, true), crc: c.getUint32(q + 16, true), cs: c.getUint32(q + 20, true), us: c.getUint32(q + 24, true), lo: c.getUint32(q + 42, true) };
          for (var x0 = q + 46 + nl, xf = x0 + el; x0 + 4 <= xf;) { // ZIP64 extra field: only the fields that were 0xFFFFFFFF
            var id = c.getUint16(x0, true), sz = c.getUint16(x0 + 2, true), o = x0 + 4;
            if (id === 1) { if (e.us === M) { e.us = u64(c, o); o += 8; } if (e.cs === M) { e.cs = u64(c, o); o += 8; } if (e.lo === M) { e.lo = u64(c, o); } }
            x0 += 4 + sz;
          }
          ents.push(e); q += 46 + nl + el + cl;
        }
        ents = ents.filter(function (e) { return !/\/$/.test(e.nome) && !/^__MACOSX\//.test(e.nome) && !/(^|\/)\.DS_Store$/.test(e.nome); });
        return Promise.all(ents.map(function (e) {
          return f.slice(e.lo, e.lo + 30).arrayBuffer().then(function (lb) {
            var l = new DataView(lb), ini = e.lo + 30 + l.getUint16(26, true) + l.getUint16(28, true);
            e.blob = f.slice(ini, ini + e.cs); return e;
          });
        }));
      });
    });
  }
  function inflar(bytes) {
    if (!window.DecompressionStream) return Promise.resolve(null);
    try {
      var ds = new DecompressionStream("deflate"), w = ds.writable.getWriter();
      w.write(bytes).catch(function () {}); w.close().catch(function () {});
      var r = ds.readable.getReader(), partes = [], tot = 0;
      function ler() { return r.read().then(function (x) { if (x.done || tot > 2e7) return; partes.push(x.value); tot += x.value.length; return ler(); }); }
      return ler().catch(function () {}).then(function () { var u = new Uint8Array(tot), o = 0; partes.forEach(function (p) { u.set(p, o); o += p.length; }); return tot ? latin1(u) : null; });
    } catch (_) { return Promise.resolve(null); }
  }
  function conta(s, re) { var m = s.match(re); return m ? m.length : 0; }

  // decompress object streams (where names are often hidden)
  function compactado(u8, raw) {
    var tarefas = [], rs = /stream\r?\n/g, m, n = 0;
    while ((m = rs.exec(raw)) && n < 400) {
      var ini = m.index + m[0].length, dic = raw.slice(Math.max(0, m.index - 600), m.index);
      dic = dic.slice(dic.lastIndexOf("obj") + 3);
      if (!/FlateDecode/.test(dic) || !/\/ObjStm\b/.test(normNomes(dic))) continue;
      var fim = raw.indexOf("endstream", ini); if (fim < 0) break;
      tarefas.push(inflar(u8.subarray(ini, fim))); n++; rs.lastIndex = fim;
    }
    return Promise.all(tarefas).then(function (txts) { return txts.filter(Boolean).join("\n"); });
  }
  function analisar(f) {
    f.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), raw = latin1(u8);
      return compactado(u8, raw).then(function (d) { relatorio(f, u8, raw, d); });
    }).catch(function (e) { mostrar([{ n: "alto", t: T("Não foi possível ler o arquivo", "Could not read the file"), d: String(e) }], f, [], []); });
  }

  function relatorio(f, u8, raw, desc) {
    var ofusc = /\/[A-Za-z]*#[0-9A-Fa-f]{2}/.test(raw);
    var s = normNomes(raw) + "\n" + normNomes(desc);
    var A = [], det = [], links = [];
    var cab = raw.indexOf("%PDF-");
    if (cab < 0) A.push({ n: "alto", t: T("Não é um PDF válido", "Not a valid PDF"), d: T("O cabeçalho %PDF não foi encontrado. Pode ser outro tipo de arquivo disfarçado.", "No %PDF header found. It may be another file type in disguise.") });
    else if (cab > 0) A.push({ n: "medio", t: T("Dados antes do cabeçalho", "Data before the header"), d: cab + T(" bytes antes de %PDF. Técnica usada para enganar antivírus (arquivo poliglota).", " bytes before %PDF. Used to fool scanners (polyglot file).") });
    var eof = raw.lastIndexOf("%%EOF"), depois = eof >= 0 ? raw.slice(eof + 5).replace(/\s/g, "").length : 0;
    if (depois > 32) A.push({ n: "medio", t: T("Dados escondidos após o fim", "Hidden data after the end"), d: depois + T(" bytes depois de %%EOF.", " bytes after %%EOF.") });
    var js = conta(s, /\/(JS|JavaScript)\b/g), oa = conta(s, /\/OpenAction\b/g), aa = conta(s, /\/AA\b/g);
    if (js) A.push({ n: "alto", t: "JavaScript", d: js + T(" referência(s). Código pode rodar ao abrir ou ao clicar. É a forma mais comum de PDF malicioso.", " reference(s). Code can run when opened or clicked. The most common sign of a malicious PDF.") });
    if (oa) A.push({ n: js ? "alto" : "medio", t: T("Ação ao abrir (OpenAction)", "Action on open (OpenAction)"), d: T("O PDF executa algo assim que é aberto", "The PDF does something as soon as it opens") + (js ? T(", e contém JavaScript.", ", and it contains JavaScript.") : T(" (geralmente só ir para uma página).", " (often just jumping to a page).")) });
    if (aa) A.push({ n: "medio", t: T("Ações automáticas (AA)", "Automatic actions (AA)"), d: aa + T(" gatilho(s) ao abrir páginas, focar campos ou fechar.", " trigger(s) on page open, field focus or close.") });
    var la = conta(s, /\/Launch\b/g); if (la) A.push({ n: "alto", t: T("Abre programas (Launch)", "Launches programs (Launch)"), d: la + T(" ação(ões) que podem abrir arquivos ou executar comandos no computador.", " action(s) that can open files or run commands on the computer.") });
    var ef = conta(s, /\/EmbeddedFiles?\b/g); if (ef) A.push({ n: "alto", t: T("Arquivos embutidos", "Embedded files"), d: T("O PDF carrega outros arquivos dentro. Não abra anexos que você não esperava.", "The PDF carries other files inside. Don't open attachments you weren't expecting.") + nomesAnexos(s) });
    var rm = conta(s, /\/(RichMedia|Flash|Movie|Sound)\b/g); if (rm) A.push({ n: "alto", t: T("Mídia ativa (Flash/RichMedia)", "Active media (Flash/RichMedia)"), d: rm + T(" objeto(s). Recurso antigo muito explorado por ataques.", " object(s). An old feature often used by attacks.") });
    var xfa = conta(s, /\/XFA\b/g); if (xfa) A.push({ n: "alto", t: T("Formulário XFA", "XFA form"), d: T("Formulário dinâmico em XML que pode conter scripts.", "Dynamic XML form that can contain scripts.") });
    var imp = conta(s, /\/(ImportData|GoToE)\b/g); if (imp) A.push({ n: "alto", t: T("Importa dados / abre embutidos", "Imports data / opens embedded"), d: imp + T(" ação(ões) ImportData ou GoToE.", " ImportData or GoToE action(s).") });
    var sub = conta(s, /\/SubmitForm\b/g); if (sub) A.push({ n: "medio", t: T("Envia formulário pela internet", "Submits form over the internet"), d: sub + T(" ação(ões) que mandam dados digitados para um servidor.", " action(s) that send typed data to a server.") });
    var gr = conta(s, /\/GoToR\b/g); if (gr) A.push({ n: "medio", t: T("Abre outro arquivo (GoToR)", "Opens another file (GoToR)"), d: gr + T(" link(s) para arquivos externos. Pode vazar credenciais de rede no Windows.", " link(s) to external files. Can leak network credentials on Windows.") });
    var ru = /\/URI\s*\(((?:\\.|[^\\)])*)\)/g, mu, vist = {};
    while ((mu = ru.exec(s)) && links.length < 50) { var url = mu[1].replace(/\\(.)/g, "$1"); if (!vist[url]) { vist[url] = 1; links.push(url); } }
    var nUri = conta(s, /\/URI\b/g);
    if (nUri) {
      var ruins = links.filter(function (u) { return /^(javascript|file|data|smb):|^\\\\|\.(exe|scr|bat|cmd|js|vbs|ps1|msi|jar|hta)(\?|$)/i.test(u) || /^https?:\/\/\d+\.\d+\.\d+\.\d+/i.test(u); });
      A.push({ n: ruins.length ? "alto" : "baixo", t: T("Links externos", "External links"), d: nUri + T(" link(s). ", " link(s). ") + (ruins.length ? T("Alguns apontam para programas, arquivos locais ou IPs: ", "Some point to programs, local files or raw IPs: ") + ruins.slice(0, 3).join(", ") : T("Confira o destino antes de clicar.", "Check where they go before clicking.")) });
    }
    if (ofusc) A.push({ n: "medio", t: T("Nomes disfarçados", "Disguised names"), d: T("Nomes internos escritos com códigos #xx para escapar de antivírus.", "Internal names written with #xx codes to slip past scanners.") });
    var jb = conta(s, /\/JBIG2Decode\b/g); if (jb) A.push({ n: "baixo", t: "JBIG2", d: T("Formato de imagem que já teve falhas exploradas em leitores antigos. Mantenha o leitor atualizado.", "Image format with past exploits in old readers. Keep your reader updated.") });
    var af = conta(s, /\/AcroForm\b/g); if (af && !xfa) A.push({ n: "baixo", t: T("Formulário", "Form"), d: T("Tem campos para preencher.", "Has fillable fields.") });
    var enc = /\/Encrypt\b/.test(raw);
    if (enc) {
      var pm = raw.match(/\/P\s+(-?\d+)/), p = pm ? parseInt(pm[1], 10) : null, v = (raw.match(/\/V\s+(\d)/) || [])[1], r = (raw.match(/\/R\s+(\d)/) || [])[1];
      var alg = v === "5" || r === "6" ? "AES-256" : v === "4" ? "AES-128 / RC4-128" : v === "2" ? "RC4-128" : v === "1" ? T("RC4-40 (fraco)", "RC4-40 (weak)") : "?";
      var perm = p === null ? "" : [[3, T("imprimir", "print")], [4, T("editar", "edit")], [5, T("copiar", "copy")], [6, T("anotar", "annotate")]].map(function (b) { return (p & (1 << (b[0] - 1)) ? "✓ " : "✗ ") + b[1]; }).join(" · ");
      A.push({ n: v === "1" ? "medio" : "info", t: T("Criptografado", "Encrypted"), d: T("Algoritmo: ", "Algorithm: ") + alg + (perm ? " · " + perm : "") + T(". A análise do conteúdo cifrado é limitada.", ". Scanning of encrypted content is limited.") });
    }
    var pags = conta(s, /\/Type\s*\/Page\b/g), upd = conta(raw, /%%EOF/g), os = conta(raw, /\/ObjStm\b/g), objs = conta(raw, /\d+\s+\d+\s+obj\b/g);
    det.push({ t: T("Tamanho", "Size"), d: (f.size / 1048576).toFixed(2) + " MB" });
    var ver = raw.match(/%PDF-(\d\.\d)/); if (ver) det.push({ t: T("Versão", "Version"), d: "PDF " + ver[1] });
    det.push({ t: T("Páginas (aprox.)", "Pages (approx.)"), d: String(pags || "?") });
    det.push({ t: T("Objetos", "Objects"), d: objs + (os ? " + " + os + T(" fluxo(s) compactado(s)", " compressed stream(s)") : "") });
    det.push({ t: T("Revisões", "Revisions"), d: upd + (upd > 1 ? T(" (o arquivo foi editado depois de criado)", " (edited after creation)") : "") });
    var prod = s.match(/\/Producer\s*\(([^)]{1,120})\)/), cri = s.match(/\/Creator\s*\(([^)]{1,120})\)/);
    if (cri) det.push({ t: T("Criado com", "Created with"), d: cri[1] });
    if (prod) det.push({ t: T("Gerado por", "Produced by"), d: prod[1] });
    var achou = {}, nr = normNomes(raw), nd = normNomes(desc);
    REM.forEach(function (c) { var k = 0; c.nomes.forEach(function (nm) { k += conta(nr, new RegExp("\\/" + nm + "(?![^\\s\\/<>\\[\\]()%{}])", "g")); }); if (k) achou[c.id] = k; });
    var soComp = REM.some(function (c) { return !achou[c.id] && c.nomes.some(function (nm) { return new RegExp("\\/" + nm + "\\b").test(nd); }); });
    ultimo = { f: f, u8: u8, A: A, links: links, det: det, achou: achou, soComp: soComp };
    mostrar(A, f, links, det);
  }
  function nomesAnexos(s) {
    var r = /\/(?:UF|F)\s*\(([^)]{1,100}\.[A-Za-z0-9]{1,5})\)/g, m, v = {}, o = [];
    while ((m = r.exec(s)) && o.length < 8) if (!v[m[1]]) { v[m[1]] = 1; o.push(m[1]); }
    return o.length ? " (" + o.join(", ") + ")" : "";
  }
  var ultimo = null, hashes = {};
  // what can be stripped: each name is renamed in place to /xxx… (same length, so the file structure stays valid)
  var REM = [
    { id: "js", nomes: ["JavaScript", "JS"], p: "JavaScript", e: "JavaScript", on: 1 },
    { id: "auto", nomes: ["OpenAction", "AA"], p: "Ações automáticas", e: "Automatic actions", on: 1 },
    { id: "launch", nomes: ["Launch"], p: "Abrir programas (Launch)", e: "Program launch (Launch)", on: 1 },
    { id: "files", nomes: ["EmbeddedFiles", "EmbeddedFile"], p: "Arquivos embutidos", e: "Embedded files", on: 1 },
    { id: "media", nomes: ["RichMedia", "Flash", "Movie", "Sound"], p: "Mídia ativa", e: "Active media", on: 1 },
    { id: "xfa", nomes: ["XFA"], p: "Formulário XFA", e: "XFA form", on: 1 },
    { id: "import", nomes: ["ImportData", "GoToE"], p: "Importar dados", e: "Data import", on: 1 },
    { id: "submit", nomes: ["SubmitForm"], p: "Envio de formulário", e: "Form submission", on: 1 },
    { id: "gotor", nomes: ["GoToR"], p: "Abrir outro arquivo", e: "Open other file", on: 1 },
    { id: "links", nomes: ["URI"], p: "Links externos (deixam de funcionar)", e: "External links (they stop working)", on: 0 }
  ];
  function reNome(nm) {
    var p = nm.split("").map(function (c) { return "(?:" + c + "|#" + c.charCodeAt(0).toString(16) + ")"; }).join("");
    return new RegExp("\\/" + p + "(?![^\\s\\/<>\\[\\]()%{}])", "gi");
  }
  function montarRemover() {
    var box = document.getElementById("remover"), ul = document.getElementById("rem-lista"), ids = Object.keys(ultimo.achou);
    box.hidden = !ids.length && !ultimo.soComp; ul.textContent = "";
    document.getElementById("t-rem").textContent = T("Remover partes perigosas", "Remove dangerous parts");
    REM.forEach(function (c) {
      if (!ultimo.achou[c.id]) return;
      var li = document.createElement("li"), l = document.createElement("label"), cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!c.on; cb.value = c.id; l.style.cssText = "display:flex;gap:10px;align-items:center;font-weight:600";
      l.appendChild(cb); l.appendChild(document.createTextNode(T(c.p, c.e) + " (" + ultimo.achou[c.id] + ")")); li.appendChild(l); ul.appendChild(li);
    });
    var ok = document.getElementById("rem-ok"); ok.hidden = !ids.length; ok.textContent = T("Remover e salvar cópia limpa", "Remove and save clean copy"); ok.onclick = remover;
    var av = document.getElementById("rem-aviso"); av.hidden = !ultimo.soComp;
    av.innerHTML = ""; av.appendChild(document.createTextNode(T("Parte do conteúdo perigoso está compactada e não pode ser removida aqui. Use ", "Some dangerous content is compressed and can't be removed here. Use ")));
    var a = document.createElement("a"); a.href = "../../visualizadores/bentopdf/sanitize-pdf.html"; a.textContent = T("Higienizar PDF", "Sanitize PDF"); av.appendChild(a); av.appendChild(document.createTextNode("."));
  }
  function remover() {
    var sel = Array.prototype.map.call(document.querySelectorAll("#rem-lista input:checked"), function (x) { return x.value; });
    if (!sel.length) return;
    var s = latin1(ultimo.u8), feitos = [];
    REM.forEach(function (c) {
      if (sel.indexOf(c.id) < 0) return;
      var k = 0; c.nomes.forEach(function (nm) { s = s.replace(reNome(nm), function (m) { k++; return "/" + new Array(m.length).join("x"); }); });
      feitos.push(T(c.p, c.e) + ": " + k);
    });
    var out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    var nome = ultimo.f.name.replace(/\.pdf$/i, "") + T("-limpo.pdf", "-clean.pdf");
    baixar(new Blob([out], { type: "application/pdf" }), nome);
    var nf = new File([out], nome, { type: "application/pdf" }); nf.removidos = feitos;
    analisar(nf); // scan the clean copy so the result is visible
  }
  function baixar(blob, nome) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
    a.remove(); // blob URL kept alive: Safari may start a big download minutes later
  }
  function sha256(u8) { return crypto.subtle ? crypto.subtle.digest("SHA-256", u8).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }) : Promise.resolve("?"); }
  function textoLog() {
    var u = ultimo, v = document.getElementById("veredito");
    return sha256(u.u8).then(function (h) {
      var L = ["InkDOS Hub · " + T("Verificação de segurança do PDF", "PDF security check"), new Date().toISOString(), "", T("Arquivo: ", "File: ") + u.f.name, "SHA-256: " + h, T("Veredito: ", "Verdict: ") + v.firstChild.textContent, ""];
      if (u.f.removidos) { L.push(T("Removido:", "Removed:")); u.f.removidos.forEach(function (x) { L.push("  - " + x); }); L.push(""); }
      L.push(T("Achados:", "Findings:")); if (!u.A.length) L.push("  -");
      u.A.forEach(function (x) { L.push("  [" + { alto: "HIGH", medio: "MEDIUM", baixo: "LOW", info: "INFO" }[x.n] + "] " + x.t + " — " + x.d); });
      if (u.soComp) L.push("  " + T("Obs.: conteúdo perigoso dentro de fluxos compactados.", "Note: dangerous content inside compressed streams."));
      if (u.links.length) { L.push("", T("Links:", "Links:")); u.links.forEach(function (x) { L.push("  " + x); }); }
      L.push("", T("Detalhes:", "Details:")); u.det.forEach(function (x) { L.push("  " + x.t + ": " + x.d); });
      return L.join("\n");
    });
  }
  document.getElementById("log-cop").onclick = function () { var b = this; textoLog().then(function (t) { return navigator.clipboard.writeText(t); }).then(function () { b.textContent = T("Copiado ✓", "Copied ✓"); }).catch(function () {}); };
  document.getElementById("log-sal").onclick = function () { textoLog().then(function (t) { baixar(new Blob([t], { type: "text/plain" }), ultimo.f.name.replace(/\.pdf$/i, "") + "-security-log.txt"); }); };
  document.getElementById("log-env").onclick = function () { textoLog().then(function (t) { return navigator.share({ title: "PDF security log", text: t }); }).catch(function () {}); };
  // ---- batch: clean many files / a folder into one ZIP (non-PDF files copied as they are)
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function dosData(ms) { var d = new Date(ms || Date.now()); return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()]; }
  function zip(itens) { // store-only ZIP, ZIP64 when over 4 GB; names in UTF-8
    var partes = [], central = [], off = 0, enc = new TextEncoder(), M = 0xFFFFFFFF;
    function n32(v) { return v >= M ? M : v; }
    itens.forEach(function (it) {
      var nm = enc.encode(it.nome), c = it.crc, s = it.tam, us = it.us == null ? s : it.us, m = it.m || 0, dt = it.dt || dosData(Date.now());
      var big = s >= M || us >= M, cx = [];
      if (us >= M) cx.push(us); if (s >= M) cx.push(s); if (off >= M) cx.push(off);
      var L = new DataView(new ArrayBuffer(30 + (big ? 20 : 0))), C = new DataView(new ArrayBuffer(46 + (cx.length ? 4 + 8 * cx.length : 0))), v = big || cx.length ? 45 : 20;
      L.setUint32(0, 0x04034b50, true); L.setUint16(4, v, true); L.setUint16(6, 0x0800, true); L.setUint16(8, m, true); L.setUint16(10, dt[0], true); L.setUint16(12, dt[1], true); L.setUint32(14, c, true); L.setUint32(18, big ? M : s, true); L.setUint32(22, big ? M : us, true); L.setUint16(26, nm.length, true);
      if (big) { L.setUint16(28, 20, true); L.setUint16(30, 1, true); L.setUint16(32, 16, true); L.setBigUint64(34, BigInt(us), true); L.setBigUint64(42, BigInt(s), true); }
      C.setUint32(0, 0x02014b50, true); C.setUint16(4, v, true); C.setUint16(6, v, true); C.setUint16(8, 0x0800, true); C.setUint16(10, m, true); C.setUint16(12, dt[0], true); C.setUint16(14, dt[1], true); C.setUint32(16, c, true); C.setUint32(20, n32(s), true); C.setUint32(24, n32(us), true); C.setUint16(28, nm.length, true); C.setUint32(42, n32(off), true);
      if (cx.length) { C.setUint16(30, 4 + 8 * cx.length, true); C.setUint16(46, 1, true); C.setUint16(48, 8 * cx.length, true); cx.forEach(function (x, i) { C.setBigUint64(50 + 8 * i, BigInt(x), true); }); }
      var cb = new Uint8Array(C.buffer), lb = new Uint8Array(L.buffer);
      // name goes between the fixed header and the extra field
      partes.push(lb.subarray(0, 30), nm, lb.subarray(30), it.dados); central.push(cb.subarray(0, 46), nm, cb.subarray(46)); off += 30 + nm.length + (big ? 20 : 0) + s;
    });
    var tam = central.reduce(function (a, b) { return a + b.byteLength; }, 0), n = itens.length, fim = [];
    if (off >= M || tam >= M || n >= 0xFFFF) {
      var Z = new DataView(new ArrayBuffer(76));
      Z.setUint32(0, 0x06064b50, true); Z.setBigUint64(4, 44n, true); Z.setUint16(12, 45, true); Z.setUint16(14, 45, true); Z.setBigUint64(24, BigInt(n), true); Z.setBigUint64(32, BigInt(n), true); Z.setBigUint64(40, BigInt(tam), true); Z.setBigUint64(48, BigInt(off), true);
      Z.setUint32(56, 0x07064b50, true); Z.setBigUint64(64, BigInt(off + tam), true); Z.setUint32(72, 1, true);
      fim.push(Z.buffer);
    }
    var E = new DataView(new ArrayBuffer(22));
    E.setUint32(0, 0x06054b50, true); E.setUint16(8, Math.min(n, 0xFFFF), true); E.setUint16(10, Math.min(n, 0xFFFF), true); E.setUint32(12, n32(tam), true); E.setUint32(16, n32(off), true);
    return new Blob(partes.concat(central, fim, [E.buffer]), { type: "application/zip" });
  }

  // byte-level clean (no big strings, so large PDFs fit in memory): same renames as the single-file tool, all except links
  var DELIM = {}; [0, 9, 10, 12, 13, 32, 40, 41, 60, 62, 91, 93, 123, 125, 47, 37].forEach(function (c) { DELIM[c] = 1; });
  function nomeEm(u8, j, nm) { // end index if name nm starts at j (allowing #xx), else -1
    for (var k = 0; k < nm.length; k++) {
      var c = nm.charCodeAt(k);
      if (u8[j] === c) j++;
      else if (u8[j] === 35 && parseInt(String.fromCharCode(u8[j + 1], u8[j + 2]), 16) === c) j += 3;
      else return -1;
    }
    return j < u8.length && !DELIM[u8[j]] ? -1 : j;
  }
  function limparBytes(u8) {
    var cont = {}, lista = [];
    REM.forEach(function (c) { if (c.id !== "links") c.nomes.forEach(function (nm) { lista.push([nm, c.id, nm.charCodeAt(0)]); }); });
    for (var i = 0, n = u8.length - 1; i < n; i++) {
      if (u8[i] !== 47) continue;
      var b = u8[i + 1];
      for (var q = 0; q < lista.length; q++) {
        if (b !== lista[q][2] && b !== 35) continue;
        var fim = nomeEm(u8, i + 1, lista[q][0]);
        if (fim < 0) continue;
        u8.fill(120, i + 1, fim); cont[lista[q][1]] = (cont[lista[q][1]] || 0) + 1; i = fim - 1; break;
      }
    }
    var feitos = REM.filter(function (c) { return cont[c.id]; }).map(function (c) { return T(c.p, c.e) + ": " + cont[c.id]; });
    return { u8: u8, feitos: feitos };
  }
  function achar(u8, pat, de) { var p0 = pat[0]; for (var i = de || 0, n = u8.length - pat.length; i <= n; i++) { if (u8[i] !== p0) continue; for (var k = 1; k < pat.length && u8[i + k] === pat[k]; k++); if (k === pat.length) return i; } return -1; }
  function bytesDe(s) { return Array.prototype.map.call(s, function (c) { return c.charCodeAt(0); }); }
  var P_OBJSTM = bytesDe("/ObjStm"), P_STREAM = bytesDe("stream"), P_END = bytesDe("endstream");
  function compactadoU8(u8) { // decompress only object streams, one at a time
    var p = 0, achados = false, n = 0;
    function prox() {
      if (achados || n++ > 400) return Promise.resolve(achados);
      p = achar(u8, P_OBJSTM, p); if (p < 0) return Promise.resolve(achados);
      var st = achar(u8, P_STREAM, p); if (st < 0) return Promise.resolve(achados);
      var dic = latin1(u8.subarray(Math.max(0, p - 300), st)), ini = st + 6;
      if (u8[ini] === 13) ini++; if (u8[ini] === 10) ini++;
      var fim = achar(u8, P_END, ini); if (fim < 0) return Promise.resolve(achados);
      p = fim;
      if (!/FlateDecode/.test(dic)) return prox();
      return inflar(u8.subarray(ini, fim)).then(function (t) {
        if (t) { var nd = normNomes(t); achados = REM.some(function (c) { return c.id !== "links" && c.nomes.some(function (nm) { return new RegExp("\\/" + nm + "(?![^\\s\\/<>\\[\\]()%{}])").test(nd); }); }); }
        return prox();
      });
    }
    return prox();
  }
  var lote = null;
  document.getElementById("lote-arq").onclick = function () { document.getElementById("lote-in").click(); };
  document.getElementById("lote-pasta").onclick = function () { document.getElementById("lote-dir").click(); };
  document.getElementById("lote-in").onchange = document.getElementById("lote-dir").onchange = function () { var fs = Array.prototype.slice.call(this.files); this.value = ""; if (fs.length) limparLote(fs); };
  function limparLote(fs) {
    // the ZIP gets the source's name (ZIP or top folder), so unzipping recreates the same folder
    var raiz = fs.length === 1 && /\.zip$/i.test(fs[0].name) ? fs[0].name.replace(/\.zip$/i, "") : ((fs[0].webkitRelativePath || "").split("/")[0] || "");
    function add(e, o) { o.dt = e.dt; itens.push(o); }
    var ul = document.getElementById("lote-lista"), st = document.getElementById("lote-st"), itens = [], log = [], nLimpos = 0, nComp = 0, i = 0;
    ul.textContent = ""; document.getElementById("lote").hidden = false; document.getElementById("res").hidden = true;
    document.getElementById("lote-t").textContent = T("Limpeza em lote", "Batch clean");
    document.getElementById("lote-zip").hidden = document.getElementById("lote-log").hidden = true;
    function linha(t, d) { var li = document.createElement("li"), b = document.createElement("b"), sm = document.createElement("small"); b.textContent = t; sm.textContent = d; li.appendChild(b); li.appendChild(sm); ul.appendChild(li); }
    var ents = [], nZip = 0;
    st.textContent = T("Lendo…", "Reading…");
    Promise.all(fs.map(function (f) {
      if (/\.zip$/i.test(f.name)) return lerZip(f).then(function (es) { nZip++; return es; });
      return [{ nome: f.webkitRelativePath || f.name, blob: f, m: -1, dt: dosData(f.lastModified) }];
    })).then(function (ls) {
      ls.forEach(function (l) { ents = ents.concat(l); });
      // no folder paths came with the files: the ZIP would be flat, so stop and point to the ZIP route
      if (!nZip && ents.length > 1 && !ents.some(function (e) { return e.nome.indexOf("/") >= 0; })) linha(T("Sem estrutura de pastas", "No folder structure"), T("Este aparelho não informou as pastas. Para manter as subpastas: no Arquivos, toque e segure a pasta › Comprimir, e escolha o .zip aqui.", "This device didn't pass the folders. To keep subfolders: in Files, long-press the folder › Compress, then pick that .zip here."));
      fs = ents; prox();
    }).catch(function (e) { st.textContent = String(e); });
    function prox() {
      if (i >= fs.length) return fim();
      var e = fs[i++], f = e.blob, nome = e.nome, pdf = /\.pdf$/i.test(nome);
      st.textContent = i + " / " + fs.length + " · " + nome;
      if (e.m >= 0 && !pdf) { add(e, { nome: nome, dados: f, crc: e.crc, tam: e.cs, us: e.us, m: e.m }); return setTimeout(prox, 0); } // copied from the ZIP as it is
      (e.m === 8 ? f.arrayBuffer().then(function (b) { return inflarU8(new Uint8Array(b), "deflate-raw"); }) : f.arrayBuffer().then(function (b) { return new Uint8Array(b); })).then(function (u8) {
        if (!pdf || latin1(u8.subarray(0, 1024)).indexOf("%PDF-") < 0) { add(e, e.m >= 0 ? { nome: nome, dados: f, crc: e.crc, tam: e.cs, us: e.us, m: e.m } : { nome: nome, dados: f, crc: crc32(u8), tam: u8.length }); return; }
        var r = limparBytes(u8);
        return compactadoU8(r.u8).then(function (comp) {
          if (r.feitos.length) add(e, { nome: nome, dados: new Blob([r.u8]), crc: crc32(r.u8), tam: r.u8.length }); // Blob: out of the page's memory
          else if (e.m >= 0) add(e, { nome: nome, dados: f, crc: e.crc, tam: e.cs, us: e.us, m: e.m }); // unchanged: copied from the ZIP
          else add(e, { nome: nome, dados: f, crc: crc32(r.u8), tam: r.u8.length });
          var txt = (r.feitos.length ? T("Limpo: ", "Cleaned: ") + r.feitos.join(", ") : T("Nada perigoso", "Nothing dangerous")) + (comp ? T(" · ATENÇÃO: perigo em parte compactada, use Higienizar PDF", " · WARNING: danger in a compressed part, use Sanitize PDF") : "");
          if (r.feitos.length) nLimpos++; if (comp) nComp++;
          if (r.feitos.length || comp) linha(nome, txt);
          log.push(nome + " — " + txt);
        });
      }).catch(function (e) { log.push(nome + " — " + T("erro: ", "error: ") + e); linha(nome, String(e)); }).then(function () { setTimeout(prox, 0); });
    }
    function fim() {
      var pdfs = log.length;
      st.textContent = fs.length + T(" arquivos · ", " files · ") + pdfs + " PDF · " + nLimpos + T(" limpos", " cleaned") + (nComp ? " · " + nComp + T(" precisam de Higienizar", " need Sanitize") : "");
      if (!nLimpos && !nComp) linha(T("Tudo limpo", "All clean"), T("Nenhum PDF tinha partes perigosas.", "No PDF had dangerous parts."));
      lote = { nome: (raiz || T("pdfs-limpos", "clean-pdfs")) + ".zip", blob: zip(itens), log: ["InkDOS Hub · " + T("Limpeza de PDFs em lote", "Batch PDF clean"), new Date().toISOString(), st.textContent, ""].concat(log).join("\n") };
      var z = document.getElementById("lote-zip"); z.hidden = false; z.textContent = T("Salvar ZIP", "Save ZIP");
      var l = document.getElementById("lote-log"); l.hidden = false; l.textContent = T("Salvar relatório", "Save report");
    }
  }
  document.getElementById("lote-zip").onclick = function () {
    var nome = lote.nome;
    if (window.showSaveFilePicker) window.showSaveFilePicker({ suggestedName: nome }).then(function (h) { return h.createWritable(); }).then(function (w) { return w.write(lote.blob).then(function () { return w.close(); }); }).catch(function () { baixar(lote.blob, nome); });
    else baixar(lote.blob, nome);
  };
  document.getElementById("lote-log").onclick = function () { baixar(new Blob([lote.log], { type: "text/plain" }), T("pdfs-limpos-relatorio.txt", "clean-pdfs-report.txt")); };
  function mostrar(A, f, links, det) {
    var ordem = { alto: 0, medio: 1, baixo: 2, info: 3 };
    A.sort(function (a, b) { return ordem[a.n] - ordem[b.n]; });
    var pior = A.length ? A[0].n : "ok";
    var V = {
      alto: ["alto", T("Risco alto", "High risk"), T("Não abra este PDF em um leitor comum sem ter certeza da origem.", "Don't open this PDF in a regular reader unless you trust the source.")],
      medio: ["medio", T("Atenção", "Caution"), T("Tem recursos que podem ser usados para enganar. Veja abaixo.", "Has features that can be misused. See below.")],
      baixo: ["baixo", T("Risco baixo", "Low risk"), T("Nada perigoso encontrado.", "Nothing dangerous found.")],
      info: ["baixo", T("Risco baixo", "Low risk"), T("Nada perigoso encontrado.", "Nothing dangerous found.")],
      ok: ["baixo", T("Nenhum risco encontrado", "No risks found"), T("Sem JavaScript, ações automáticas, anexos ou links.", "No JavaScript, auto actions, attachments or links.")]
    }[pior];
    var v = document.getElementById("veredito"); v.className = "veredito " + V[0];
    v.firstChild.textContent = V[1]; v.lastChild.textContent = f.name + " · " + V[2];
    function lista(id, itens, cls) {
      var ul = document.getElementById(id); ul.textContent = "";
      itens.forEach(function (x) { var li = document.createElement("li"); if (cls) li.className = x.n; var b = document.createElement("b"); b.textContent = x.t; var sm = document.createElement("small"); sm.textContent = x.d; li.appendChild(b); li.appendChild(sm); ul.appendChild(li); });
    }
    lista("achados", A, true);
    var lp = document.getElementById("limpar-p"), lk = document.getElementById("limpar");
    lp.hidden = !(pior === "alto" || pior === "medio"); lk.textContent = T("Remover ameaças (cópia limpa)", "Remove threats (clean copy)");
    lk.onclick = function () { try { sessionStorage.setItem("inkdos-return", location.href); } catch (_) {} };
    lista("links", links.map(function (u) { return { t: u.length > 80 ? u.slice(0, 80) + "…" : u, d: "" }; }), false);
    var tl = document.getElementById("t-links"); tl.hidden = !links.length; tl.textContent = T("Links encontrados", "Links found");
    document.getElementById("t-det").textContent = T("Detalhes", "Details");
    lista("detalhes", det, false);
    montarRemover();
    document.getElementById("t-log").textContent = T("Relatório", "Report");
    document.getElementById("log-env").textContent = T("Enviar", "Send");
    document.getElementById("log-cop").textContent = T("Copiar", "Copy");
    document.getElementById("log-sal").textContent = T("Salvar .txt", "Save .txt");
    document.getElementById("log-env").hidden = !navigator.share;
    document.getElementById("res").hidden = false;
    document.getElementById("dica").textContent = T("Verificar outro PDF", "Check another PDF");
  }
})();
