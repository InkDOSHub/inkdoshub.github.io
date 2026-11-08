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

  function analisar(f) {
    f.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), raw = latin1(u8);
      // decompress object streams (where names are often hidden) and embedded file streams
      var tarefas = [], rs = /stream\r?\n/g, m, n = 0;
      while ((m = rs.exec(raw)) && n < 400) {
        var ini = m.index + m[0].length, dic = raw.slice(Math.max(0, m.index - 600), m.index);
        dic = dic.slice(dic.lastIndexOf("obj") + 3);
        if (!/FlateDecode/.test(dic) || !/\/ObjStm\b/.test(normNomes(dic))) continue;
        var fim = raw.indexOf("endstream", ini); if (fim < 0) break;
        tarefas.push(inflar(u8.subarray(ini, fim))); n++; rs.lastIndex = fim;
      }
      return Promise.all(tarefas).then(function (txts) { relatorio(f, u8, raw, txts.filter(Boolean).join("\n")); });
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
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
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
