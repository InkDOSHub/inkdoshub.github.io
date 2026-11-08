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
    mostrar(A, f, links, det);
  }
  function nomesAnexos(s) {
    var r = /\/(?:UF|F)\s*\(([^)]{1,100}\.[A-Za-z0-9]{1,5})\)/g, m, v = {}, o = [];
    while ((m = r.exec(s)) && o.length < 8) if (!v[m[1]]) { v[m[1]] = 1; o.push(m[1]); }
    return o.length ? " (" + o.join(", ") + ")" : "";
  }
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
    document.getElementById("res").hidden = false;
    document.getElementById("dica").textContent = T("Verificar outro PDF", "Check another PDF");
  }
})();
