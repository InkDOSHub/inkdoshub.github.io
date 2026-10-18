/* Página do Wine: "Iniciar o Wine", "Instalar programa", o aviso de carregamento e os botões da barra.
   O emulador roda em emulador.html (iframe), sempre com a área de trabalho do tamanho da tela.
   inkterminal-wine.js, lá dentro, põe os arquivos recebidos no disco D:, mostra os programas
   instalados na área de trabalho (area/area.exe) e cuida do teclado e do clique direito no iPad. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  /* Teste do formato de exceções novo (exnref), que o Boxedwine exige: Safari 18.4+, Chrome 137+. */
  var temExnref = false;
  try { temExnref = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,8,1,6,0,31,64,0,11,11])); } catch (_) {}
  if (!temExnref) {
    $("aviso").hidden = false;
    $("aviso").textContent = "Este navegador ainda não roda o Boxedwine. Atualize o iPadOS (Safari 18.4 ou mais novo).";
    $("b-iniciar").disabled = true;
    $("b-instalar").disabled = true;
    $("b-abrir-sessao").disabled = true;
  }

  function rodando() { return document.body.classList.contains("rodando"); }
  function janela() { try { return $("tela").contentWindow; } catch (_) { return null; } }

  /* Tamanho da área de trabalho: o da área da página, com pelo menos 800 pontos no lado menor
     (abaixo disso as janelas do Windows não cabem; a imagem é reduzida para caber). */
  function tamanhoTela() {
    var r = document.querySelector(".ink-main").getBoundingClientRect();
    var w = Math.max(320, Math.round(r.width)), h = Math.max(240, Math.round(r.height));
    var k = Math.max(1, 800 / Math.min(w, h));
    w = Math.min(2048, Math.round(w * k / 2) * 2); h = Math.min(2048, Math.round(h * k / 2) * 2);
    return w + "x" + h;
  }

  /* ---------- Aviso de carregamento ---------- */
  var inicioEm = 0, relogio = null, primeira = false;
  function carregando(titulo, texto, parte) {
    document.body.classList.add("carregando");
    $("c-titulo").textContent = titulo;
    $("c-texto").textContent = texto;
    var barra = $("c-barra");
    barra.classList.toggle("indeterminada", parte == null);
    barra.firstChild.style.width = parte == null ? "" : Math.round(parte * 100) + "%";
  }
  function tempo() {
    var s = Math.round((Date.now() - inicioEm) / 1000);
    var t = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    $("c-tempo").textContent = "Tempo: " + t + (primeira ? " · na primeira vez leva alguns minutos" : "") + ". Não feche a página.";
  }
  function pronto() {
    document.body.classList.remove("carregando");
    clearInterval(relogio);
    $("status").textContent = "";
  }

  var recadoT = null;
  function recado(texto, erro) {
    var r = $("recado");
    r.textContent = texto;
    r.classList.toggle("erro", !!erro);
    r.classList.add("mostrar");
    clearTimeout(recadoT);
    recadoT = setTimeout(function () { r.classList.remove("mostrar"); }, erro ? 12000 : 7000);
  }
  $("recado").onclick = function () { $("recado").classList.remove("mostrar"); };

  /* ---------- Abrir o Wine ---------- */
  function iniciar(entrada) {
    var q = "root=TinyCore15Wine11.0&rootBase=fs&storageKey=default&env=%22WINEDLLOVERRIDES:mscoree,mshtml=%22&ink-tela=" + tamanhoTela();
    if (entrada) q += "&ink-entrada=" + encodeURIComponent(entrada);
    document.body.classList.add("rodando");
    inicioEm = Date.now(); primeira = false;
    carregando("Abrindo o Wine", "Carregando o emulador…", null);
    clearInterval(relogio); relogio = setInterval(tempo, 1000); tempo();
    $("tela").src = "emulador.html?" + q;
    document.title = "Wine · InkTerminal";
  }
  $("b-iniciar").onclick = function () { iniciar(null); };

  function parar() {
    $("tela").src = "about:blank";
    prontoParaReceber = false;
    document.body.classList.remove("rodando");
    pronto();
    marcarDireito(false);
  }
  $("b-parar").onclick = parar;

  /* ---------- Instalar programa ---------- */
  /* O Boxedwine roda só programas de 32 bits (x86). "x64"/"arm64" quando o programa é de outro tipo.
     .exe: campo Machine do cabeçalho PE. .msi: a plataforma do pacote ("x64;1033"). */
  function arquitetura(bytes, ext) {
    try {
      if (ext === "exe") {
        if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
        var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pe = v.getUint32(0x3c, true);
        if (pe + 6 > bytes.length || v.getUint32(pe, true) !== 0x4550) return null;
        var m = v.getUint16(pe + 4, true);
        return m === 0x8664 ? "x64" : m === 0xaa64 ? "arm64" : null;
      }
      if (ext === "msi") {
        var t = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64e6)));
        var r = /(?:^|[^A-Za-z0-9])(x64|Intel64|AMD64|Arm64)[,;]\d{1,5}(?:,\d{1,5})*(?![A-Za-z0-9])/.exec(t);
        if (r) return /arm/i.test(r[1]) ? "arm64" : "x64";
      }
    } catch (_) {}
    return null;
  }
  function avisar(texto) {
    if (rodando()) recado(texto, true);
    else { $("aviso").hidden = false; $("aviso").textContent = texto; }
  }

  function guardarEntrada(valor) {
    var id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    return new Promise(function (ok, erro) {
      var req = indexedDB.open("inkterminal-wine", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("entrada"); };
      req.onerror = function () { erro(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction("entrada", "readwrite"), st = tx.objectStore("entrada");
        // entradas esquecidas (o emulador não chegou a abrir)
        var c = st.openCursor();
        c.onsuccess = function () { var k = c.result; if (!k) return; if (Date.now() - (k.value && k.value.at || 0) > 864e5) k.delete(); k.continue(); };
        st.put(valor, id);
        tx.oncomplete = function () { db.close(); ok(id); };
        tx.onerror = tx.onabort = function () { db.close(); erro(tx.error); };
      };
    });
  }

  var prontoParaReceber = false;
  function instalar(file) {
    if (!file) return;
    var ext = ((file.name.match(/\.([^.]+)$/) || [])[1] || "").toLowerCase();
    if (["exe", "msi", "zip"].indexOf(ext) < 0) { avisar("\"" + file.name + "\" não é um programa do Windows (.exe, .msi ou .zip)."); return; }
    $("aviso").hidden = true;
    file.arrayBuffer().then(function (dados) {
      var arq = arquitetura(new Uint8Array(dados), ext);
      if (arq) {
        avisar("\"" + file.name + "\" é um programa de 64 bits" + (arq === "arm64" ? " para ARM" : "") +
          ". O Wine daqui só roda programas de 32 bits: procure no site do programa a versão de 32 bits (x86, \"win32\").");
        return;
      }
      var w = janela();
      if (rodando() && prontoParaReceber && w) {
        // Wine já aberto: o arquivo vai direto para o D: e a área de trabalho abre o instalador
        w.postMessage({ tipo: "wine:arquivo", arquivo: { nome: file.name, dados: dados } }, location.origin, [dados]);
        recado("Abrindo " + file.name + " no Wine…");
        return;
      }
      return guardarEntrada({ nome: file.name, dados: dados, at: Date.now() }).then(function (id) { iniciar(id); });
    }).catch(function (e) { avisar("Não consegui abrir \"" + file.name + "\": " + (e && e.message || e)); });
  }
  $("b-instalar").onclick = $("b-instalar2").onclick = function () { $("arquivos").click(); };
  // também recebe arquivos da tela inicial (abrir um .exe no XeOS): veja assets/gerenciador-app.js
  $("arquivos").onchange = function () { var f = $("arquivos").files[0]; $("arquivos").value = ""; instalar(f); };

  /* ---------- Sessão em arquivo (assets/sessao.js) ----------
     Salvar pede ao emulador os discos C: (o que o Wine mudou) e D: e cifra num arquivo.
     Abrir guarda os discos no IndexedDB e liga o Wine de novo com ?ink-entrada: inkterminal-wine.js
     troca os discos antes do Windows começar. */
  function pedirDiscos() {
    return new Promise(function (ok, erro) {
      var w = janela();
      if (!w || !rodando()) { erro(new Error("abra o Wine antes de salvar")); return; }
      var t = setTimeout(function () { removeEventListener("message", ouvir); erro(new Error("o Wine não respondeu")); }, 120000);
      function ouvir(e) {
        if (e.origin !== location.origin || !e.data || e.data.tipo !== "wine:sessao-dados") return;
        clearTimeout(t); removeEventListener("message", ouvir);
        if (e.data.erro) erro(new Error(e.data.erro)); else ok(e.data.partes);
      }
      addEventListener("message", ouvir);
      w.postMessage({ tipo: "wine:sessao-salvar" }, location.origin);
    });
  }
  function salvarSessao() {
    InkSessao.salvar("wine", "Wine", function (aviso) {
      aviso.texto("Juntando o disco C: (programas instalados) e o disco D:…");
      return pedirDiscos().then(function (partes) { return { meta: { versao: 1 }, partes: partes }; });
    }, "O arquivo leva os programas instalados e o disco D:, então pode ficar grande.");
  }
  function abrirSessao() {
    InkSessao.abrir("wine", "Wine").then(function (r) {
      if (!r) return;
      var partes = {};
      // cópias soltas: o IndexedDB guarda só o pedaço de cada parte, não o arquivo inteiro
      Object.keys(r.partes).forEach(function (k) { partes[k] = r.partes[k].slice(); });
      return InkSessao.perguntar("Abrir sessão do Wine", "Os programas instalados e o disco D: deste aparelho vão ser trocados pelos do arquivo" +
        (r.meta.criado ? " (salvo em " + new Date(r.meta.criado).toLocaleString() + ")" : "") + ".", "Trocar e abrir").then(function (sim) {
        if (!sim) return;
        if (rodando()) parar();
        return guardarEntrada({ sessao: true, partes: partes, at: Date.now() }).then(function (id) { iniciar(id); });
      });
    }).catch(function (e) { avisar("Não foi possível abrir a sessão: " + (e && e.message || e)); });
  }
  function menuSessao() {
    var d = InkSessao.janela("<form method='dialog'><h2>Sessão em arquivo</h2><p>Guarda num arquivo com senha os programas instalados (disco C:) e o disco D:. " +
      "Abrir põe tudo de volta, mesmo em outro aparelho ou depois de apagar os dados do site.</p><div class='botoes'>" +
      "<button class='ink-btn' value=''>Fechar</button><button class='ink-btn' value='abrir'>Abrir arquivo</button>" +
      "<button class='ink-btn principal' value='salvar'>Salvar em arquivo</button></div></form>");
    // direto no toque (o iPad só abre o seletor de arquivos dentro do toque da pessoa)
    d.querySelector("[value=salvar]").onclick = function (e) { e.preventDefault(); d.close(); salvarSessao(); };
    d.querySelector("[value=abrir]").onclick = function (e) { e.preventDefault(); d.close(); abrirSessao(); };
  }
  $("b-sessao").onclick = menuSessao;
  $("b-abrir-sessao").onclick = abrirSessao;

  /* ---------- Barra com o Wine aberto ---------- */
  $("b-arquivos").onclick = function () {
    var w = janela();
    if (w && typeof w.buildGetFilesModal === "function") w.buildGetFilesModal();
  };
  $("b-enviar").onclick = function () { $("enviar").click(); };
  $("enviar").onchange = function () {
    var w = janela(), f = [].slice.call($("enviar").files);
    $("enviar").value = "";
    if (w && f.length) {
      // inkterminal-wine.js grava no D: e avisa o Wine para ver os arquivos novos
      w.postMessage({ tipo: "wine:enviar", arquivos: f }, location.origin);
      recado((f.length === 1 ? f[0].name : f.length + " arquivos") + " no disco D:");
    }
  };
  // o teclado do iPad só aparece com o foco dado no próprio toque, então o campo é focado daqui
  $("b-teclado").onclick = function () {
    try { var c = $("tela").contentDocument.querySelector("textarea[aria-label='Teclado']"); if (c) c.focus(); } catch (_) {}
  };
  function marcarDireito(v) { $("b-direito").setAttribute("aria-pressed", String(!!v)); }
  $("b-direito").onclick = function () {
    var v = $("b-direito").getAttribute("aria-pressed") !== "true";
    marcarDireito(v);
    var w = janela(); if (w) w.postMessage({ tipo: "wine:direito", ligado: v }, location.origin);
  };

  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    var d = e.data;
    if (d.tipo === "wine:progresso") {
      if (d.recebido < d.total) {
        carregando(d.disco ? "Abrindo o Wine" : "Baixando o Wine",
          (d.disco ? "Lendo o Wine guardado neste aparelho: " : "Só na primeira vez: ") + Math.round(d.recebido / 1e6) + " de " + Math.round(d.total / 1e6) + " MB",
          d.total ? d.recebido / d.total : null);
      } else carregando("Abrindo o Wine", "Ligando o emulador…", null);
    }
    if (d.tipo === "wine:fase") {
      if (d.fase === "ligando") {
        primeira = !!d.primeira; prontoParaReceber = true;
        carregando(primeira ? "Preparando o Windows" : "Ligando o Windows",
          primeira ? "Na primeira vez o Wine monta o disco C:. Isso leva alguns minutos e só acontece uma vez." : "A área de trabalho aparece em instantes.", null);
        tempo();
      }
      if (d.fase === "pronto") pronto();
    }
    if (d.tipo === "wine:aviso") recado(d.texto);
    if (d.tipo === "wine:direito") marcarDireito(d.ligado);
    if (d.tipo === "wine:erro") recado("Erro: " + d.texto, true);
  });
})();
