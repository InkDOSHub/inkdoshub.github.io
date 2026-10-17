/* Office do InkTerminal: LibreOffice compilado para WebAssembly (ZetaOffice, MPL-2.0) com zetajs (MIT).

   O LibreOffice usa várias threads (SharedArrayBuffer), e o Safari só libera isso numa página
   "isolada" (headers COOP/COEP). O GitHub Pages não manda esses headers, então o service worker do
   portal (../../sw-portal.js) os acrescenta nesta pasta e entrega soffice.wasm/soffice.data
   descompactados a partir dos .gz. Na primeira visita a página registra o service worker e recarrega. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var status = $("status"), aviso = $("aviso"), avisoTexto = $("aviso-texto"), barra = $("aviso-barra");
  var canvas = $("qtcanvas");

  function falha(texto) {
    aviso.style.display = "";
    aviso.querySelector("strong").textContent = "Não deu para abrir o LibreOffice";
    avisoTexto.textContent = texto;
    barra.parentNode.style.display = "none";
    status.textContent = "";
  }

  if (!window.crossOriginIsolated) {
    if (!("serviceWorker" in navigator)) { falha("Este navegador não tem service worker."); return; }
    var tentou = false;
    try { tentou = sessionStorage.getItem("inkterminal-office-recarga") === "1"; } catch (_) {}
    if (tentou) {
      try { sessionStorage.removeItem("inkterminal-office-recarga"); } catch (_) {}
      falha("O modo isolado do navegador não ligou. Feche e abra esta página de novo. No Safari, o Modo de Navegação Privada e o Modo de Isolamento (Lockdown) impedem esse modo.");
      return;
    }
    avisoTexto.textContent = "Preparando o modo isolado do navegador…";
    navigator.serviceWorker.register("../../sw-portal.js", { scope: "../../" }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function () {
      try { sessionStorage.setItem("inkterminal-office-recarga", "1"); } catch (_) {}
      location.reload();
    }).catch(function (e) { falha("O service worker não pôde ser registrado (" + e.message + ")."); });
    return;
  }
  try { sessionStorage.removeItem("inkterminal-office-recarga"); } catch (_) {}

  var porta = null, nomeAtual = null, tipoAtual = "texto", seq = 0, esperando = {};
  var botoes = ["b-texto", "b-planilha", "b-apresentacao", "b-abrir", "b-salvar", "b-pdf"];
  function liberar(lista, sim) { lista.forEach(function (id) { $(id).disabled = !sim; }); }

  var EXT_PADRAO = { texto: "odt", planilha: "ods", apresentacao: "odp", desenho: "odg" };
  var NOME_PADRAO = { texto: "Documento", planilha: "Planilha", apresentacao: "Apresentação", desenho: "Desenho" };
  var FILTRO = {
    odt: "writer8", ods: "calc8", odp: "impress8", odg: "draw8",
    docx: "MS Word 2007 XML", doc: "MS Word 97", rtf: "Rich Text Format", txt: "Text",
    xlsx: "Calc MS Excel 2007 XML", xls: "MS Excel 97", csv: "Text - txt - csv (StarCalc)",
    pptx: "Impress MS PowerPoint 2007 XML", ppt: "MS PowerPoint 97",
  };

  function pedir(msg) {
    return new Promise(function (ok, erro) {
      msg.id = ++seq;
      esperando[msg.id] = { ok: ok, erro: erro };
      porta.postMessage(msg);
    });
  }

  function baixar(nome, tipoMime) {
    var bytes = FS.readFile("/tmp/office/" + nome);
    var blob = new Blob([bytes], { type: tipoMime || "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
  }

  function mostrarCanvas() {
    window.dispatchEvent(new Event("resize"));
    setTimeout(function () { aviso.style.display = "none"; canvas.style.visibility = "visible"; canvas.focus(); }, 800);
  }

  $("b-texto").onclick = function () { novo("texto"); };
  $("b-planilha").onclick = function () { novo("planilha"); };
  $("b-apresentacao").onclick = function () { novo("apresentacao"); };
  function novo(tipo) {
    nomeAtual = null; tipoAtual = tipo;
    status.textContent = "Abrindo…";
    porta.postMessage({ cmd: "novo", tipo: tipo });
  }

  $("b-abrir").onclick = function () { $("arquivo").click(); };
  $("arquivo").onchange = function () {
    var f = this.files[0]; this.value = "";
    if (!f) return;
    status.textContent = "Abrindo " + f.name + "…";
    f.arrayBuffer().then(function (buf) {
      try { FS.mkdir("/tmp/office/"); } catch (_) {}
      FS.writeFile("/tmp/office/" + f.name, new Uint8Array(buf));
      nomeAtual = f.name;
      porta.postMessage({ cmd: "abrir", nome: f.name });
    });
  };

  $("b-salvar").onclick = function () {
    var nome = nomeAtual || (NOME_PADRAO[tipoAtual] + "." + EXT_PADRAO[tipoAtual]);
    var ext = (nome.split(".").pop() || "").toLowerCase();
    status.textContent = "Salvando…";
    pedir({ cmd: "salvar", nome: nome, filtro: FILTRO[ext] || null }).then(function () {
      baixar(nome); status.textContent = "Salvo: " + nome;
    }, function (e) { status.textContent = "Erro ao salvar: " + e; });
  };

  $("b-pdf").onclick = function () {
    var base = (nomeAtual || NOME_PADRAO[tipoAtual]).replace(/\.[^.]+$/, "");
    status.textContent = "Gerando PDF…";
    pedir({ cmd: "pdf", nome: base + ".pdf" }).then(function () {
      baixar(base + ".pdf", "application/pdf"); status.textContent = "PDF pronto";
    }, function (e) { status.textContent = "Erro no PDF: " + e; });
  };

  canvas.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });

  var totalDeps = 0;
  window.Module = {
    canvas: canvas,
    uno_scripts: ["./zeta.js", "./office_thread.js"],
    locateFile: function (path, prefix) { return (prefix || "") + path; },
    setStatus: function (t) {
      var m = /\((\d+(?:\.\d+)?)\/(\d+)\)/.exec(t || "");
      if (m) {
        barra.style.width = Math.round(m[1] / m[2] * 100) + "%";
        avisoTexto.textContent = "Baixando… " + Math.round(m[1] / 1e6) + " de " + Math.round(m[2] / 1e6) + " MB";
      } else if (t) avisoTexto.textContent = t;
    },
    monitorRunDependencies: function (n) { totalDeps = Math.max(totalDeps, n); if (!n) avisoTexto.textContent = "Iniciando o LibreOffice…"; },
    onAbort: function (motivo) {
      falha("O LibreOffice parou (" + motivo + "). Ele precisa de cerca de 1,2 GB de memória; feche outras abas e tente de novo.");
    },
  };

  var s = document.createElement("script");
  s.src = "soffice.js";
  s.onload = function () {
    Module.uno_main.then(function (p) {
      porta = p;
      porta.onmessage = function (e) {
        var d = e.data;
        if (d.cmd === "iniciado") {
          status.textContent = "Pronto";
          liberar(["b-texto", "b-planilha", "b-apresentacao", "b-abrir"], true);
          novo("texto");
        } else if (d.cmd === "pronto") {
          tipoAtual = d.tipo;
          status.textContent = nomeAtual || NOME_PADRAO[tipoAtual] + " novo";
          liberar(botoes, true);
          mostrarCanvas();
        } else if (d.cmd === "salvo" && esperando[d.id]) {
          esperando[d.id].ok(); delete esperando[d.id];
        } else if (d.cmd === "erro") {
          if (esperando[d.id]) { esperando[d.id].erro(d.texto); delete esperando[d.id]; }
          else status.textContent = "Erro: " + d.texto;
        }
      };
    });
  };
  s.onerror = function () { falha("Os arquivos do LibreOffice não carregaram. Confira a internet (ou baixe a cópia offline na área de trabalho)."); };
  document.body.appendChild(s);

  var dpr = window.devicePixelRatio;
  window.addEventListener("resize", function () {
    if (window.devicePixelRatio !== dpr) { dpr = window.devicePixelRatio; setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 100); }
  });
})();
