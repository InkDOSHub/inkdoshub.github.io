/* Página do Wine: "Iniciar o Wine", "Instalar programa", o aviso de carregamento e os botões da barra.
   O emulador roda em emulador.html (iframe), com a área de trabalho num tamanho padrão do formato da página.
   inkterminal-wine.js, lá dentro, põe os arquivos recebidos no disco D:, mostra os programas
   instalados na área de trabalho (area/area.exe) e cuida do teclado e do clique direito no iPad. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var t = InkIdioma.t;

  /* Teste do formato de exceções novo (exnref), que o Boxedwine exige: Safari 18.4+, Chrome 137+. */
  var temExnref = false;
  try { temExnref = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,8,1,6,0,31,64,0,11,11])); } catch (_) {}
  if (!temExnref) {
    $("aviso").hidden = false;
    $("aviso").textContent = t("This browser can't run Boxedwine yet. Update iPadOS (Safari 18.4 or newer).");
    $("b-iniciar").disabled = true;
    $("b-instalar").disabled = true;
    $("b-abrir-sessao").disabled = true;
  }

  function rodando() { return document.body.classList.contains("rodando"); }
  function janela() { try { return $("tela").contentWindow; } catch (_) { return null; } }

  /* Tamanho da área de trabalho. O Wine só aceita os tamanhos de tela padrão da lista dele
     (dlls/win32u/sysparams.c, default_sizes); pedir outro deixa a área de trabalho em 1024x768, com
     a barra de tarefas no meio da página. Vale o tamanho da lista com o formato mais parecido com o
     da área da página e, entre os de mesmo formato, o de lado menor mais perto de 800 pontos (menos
     e as janelas do Windows não cabem; mais e o texto fica miúdo). Página em pé: o mesmo tamanho
     deitado de lado. inkterminal-wine.js reduz a imagem para caber, sem esticar. */
  var TAMANHOS = [[1024, 768], [1152, 864], [1280, 960], [1280, 720], [1600, 900], [1440, 900], [1440, 960], [1280, 768], [1920, 800]];
  function tamanhoTela() {
    var r = document.querySelector(".ink-main").getBoundingClientRect();
    var emPe = r.height > r.width, formato = Math.max(r.width, r.height, 1) / Math.max(Math.min(r.width, r.height), 1);
    var melhor = null, nota = Infinity;
    TAMANHOS.forEach(function (s) {
      var n = Math.round(Math.abs(Math.log(s[0] / s[1] / formato)) * 50) * 1000 + Math.abs(s[1] - 800);
      if (n < nota) { nota = n; melhor = s; }
    });
    return emPe ? melhor[1] + "x" + melhor[0] : melhor[0] + "x" + melhor[1];
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
    var hm = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    $("c-tempo").textContent = primeira ? t("Time: {time} · the first time takes a few minutes. Don't close the page.", { time: hm })
      : t("Time: {time}. Don't close the page.", { time: hm });
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
    carregando(t("Opening Wine"), t("Loading the emulator…"), null);
    clearInterval(relogio); relogio = setInterval(tempo, 1000); tempo();
    $("tela").src = "emulador.html?" + q;
    document.title = t("Wine · InkTerminal");
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
        var txt = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64e6)));
        var r = /(?:^|[^A-Za-z0-9])(x64|Intel64|AMD64|Arm64)[,;]\d{1,5}(?:,\d{1,5})*(?![A-Za-z0-9])/.exec(txt);
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
    if (["exe", "msi", "zip"].indexOf(ext) < 0) { avisar(t("\"{name}\" is not a Windows program (.exe, .msi or .zip).", { name: file.name })); return; }
    $("aviso").hidden = true;
    file.arrayBuffer().then(function (dados) {
      var arq = arquitetura(new Uint8Array(dados), ext);
      if (arq) {
        avisar(arq === "arm64"
          ? t("\"{name}\" is a 64-bit program for ARM. Wine here only runs 32-bit programs: look for the 32-bit version (x86, \"win32\") on the program's website.", { name: file.name })
          : t("\"{name}\" is a 64-bit program. Wine here only runs 32-bit programs: look for the 32-bit version (x86, \"win32\") on the program's website.", { name: file.name }));
        return;
      }
      var w = janela();
      if (rodando() && prontoParaReceber && w) {
        // Wine já aberto: o arquivo vai direto para o D: e a área de trabalho abre o instalador
        w.postMessage({ tipo: "wine:arquivo", arquivo: { nome: file.name, dados: dados } }, location.origin, [dados]);
        recado(t("Opening {name} in Wine…", { name: file.name }));
        return;
      }
      return guardarEntrada({ nome: file.name, dados: dados, at: Date.now() }).then(function (id) { iniciar(id); });
    }).catch(function (e) { avisar(t("Couldn't open \"{name}\": {error}", { name: file.name, error: (e && e.message || e) })); });
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
      if (!w || !rodando()) { erro(new Error(t("Start Wine before saving"))); return; }
      var espera = setTimeout(function () { removeEventListener("message", ouvir); erro(new Error(t("Wine didn't respond"))); }, 120000);
      function ouvir(e) {
        if (e.origin !== location.origin || !e.data || e.data.tipo !== "wine:sessao-dados") return;
        clearTimeout(espera); removeEventListener("message", ouvir);
        if (e.data.erro) erro(new Error(e.data.erro)); else ok(e.data.partes);
      }
      addEventListener("message", ouvir);
      w.postMessage({ tipo: "wine:sessao-salvar" }, location.origin);
    });
  }
  function salvarSessao() {
    InkSessao.salvar("wine", "Wine", function (aviso) {
      aviso.texto(t("Gathering drive C: (installed programs) and drive D:…"));
      return pedirDiscos().then(function (partes) { return { meta: { versao: 1 }, partes: partes }; });
    }, t("The file includes the installed programs and drive D:, so it can be large."));
  }
  function abrirSessao() {
    InkSessao.abrir("wine", "Wine").then(function (r) {
      if (!r) return;
      var partes = {};
      // cópias soltas: o IndexedDB guarda só o pedaço de cada parte, não o arquivo inteiro
      Object.keys(r.partes).forEach(function (k) { partes[k] = r.partes[k].slice(); });
      return InkSessao.perguntar(t("Open Wine session"), r.meta.criado
        ? t("The installed programs and drive D: on this device will be replaced by the ones in the file (saved {date}).", { date: new Date(r.meta.criado).toLocaleString(InkIdioma.atual) })
        : t("The installed programs and drive D: on this device will be replaced by the ones in the file."), t("Replace and open")).then(function (sim) {
        if (!sim) return;
        if (rodando()) parar();
        return guardarEntrada({ sessao: true, partes: partes, at: Date.now() }).then(function (id) { iniciar(id); });
      });
    }).catch(function (e) { avisar(t("Couldn't open the session: {error}", { error: (e && e.message || e) })); });
  }
  function menuSessao() {
    var d = InkSessao.janela("<form method='dialog'><h2>" + t("Session file") + "</h2><p>" +
      t("Saves the installed programs (drive C:) and drive D: to a password-protected file. Opening it brings everything back, even on another device or after the site data is cleared.") +
      "</p><div class='botoes'>" +
      "<button class='ink-btn' value=''>" + t("Close") + "</button><button class='ink-btn' value='abrir'>" + t("Open file") + "</button>" +
      "<button class='ink-btn principal' value='salvar'>" + t("Save to file") + "</button></div></form>");
    // direto no toque (o iPad só abre o seletor de arquivos dentro do toque da pessoa)
    d.querySelector("[value=salvar]").onclick = function (e) { e.preventDefault(); d.close(); salvarSessao(); };
    d.querySelector("[value=abrir]").onclick = function (e) { e.preventDefault(); d.close(); abrirSessao(); };
  }
  $("b-sessao").onclick = menuSessao;
  $("b-abrir-sessao").onclick = abrirSessao;

  /* ---------- Segundo plano ----------
     "pausa": oculto e parado, o Wine pausa para não gastar bateria (veja inkterminal-wine.js).
     "continua": nunca pausa, para deixar algo rodando com a página escondida. */
  function fundo() { try { return localStorage.getItem("inkterminal-wine-fundo") || "pausa"; } catch (_) { return "pausa"; } }
  function mostrarFundo() { $("b-fundo").textContent = fundo() === "continua" ? t("Background: keep running") : t("Background: pause"); }
  $("b-fundo").onclick = function () {
    var v = fundo() === "continua" ? "pausa" : "continua";
    try { localStorage.setItem("inkterminal-wine-fundo", v); } catch (_) {}
    mostrarFundo();
    var w = janela(); if (w) w.postMessage({ tipo: "wine:fundo", manter: v === "continua" }, location.origin);
  };
  mostrarFundo();

  /* ---------- Menus da barra (Arquivos, Mais) ---------- */
  function fecharMenus() {
    [].forEach.call(document.querySelectorAll("[data-menu]"), function (b) {
      b.setAttribute("aria-expanded", "false");
      $(b.dataset.menu).hidden = true;
    });
  }
  [].forEach.call(document.querySelectorAll("[data-menu]"), function (b) {
    var m = $(b.dataset.menu);
    b.onclick = function (e) {
      e.stopPropagation();
      var abrir = m.hidden;
      fecharMenus();
      if (!abrir) return;
      var r = b.getBoundingClientRect();
      m.hidden = false;
      m.style.top = Math.round(r.bottom + 4) + "px";
      m.style.left = Math.round(Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))) + "px";
      b.setAttribute("aria-expanded", "true");
    };
    // escolher um item fecha o menu (o item faz o resto, ainda dentro do toque)
    m.addEventListener("click", function () { fecharMenus(); });
  });
  document.addEventListener("click", function (e) { if (!e.target.closest(".menu")) fecharMenus(); });
  window.addEventListener("blur", fecharMenus); // toque no Wine (iframe)
  window.addEventListener("resize", fecharMenus);
  $("b-parar").addEventListener("click", fecharMenus);

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
      recado(f.length === 1 ? t("{name} on drive D:", { name: f[0].name }) : t("{n} files on drive D:", { n: f.length.toLocaleString(InkIdioma.atual) }));
    }
  };
  // o teclado do iPad só aparece com o foco dado no próprio toque, então o campo é focado daqui
  $("b-teclado").onclick = function () {
    try { var c = $("tela").contentDocument.getElementById("ink-teclado"); if (c) c.focus(); } catch (_) {}
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
        var mb = { done: Math.round(d.recebido / 1e6).toLocaleString(InkIdioma.atual), total: Math.round(d.total / 1e6).toLocaleString(InkIdioma.atual) };
        carregando(d.disco ? t("Opening Wine") : t("Downloading Wine"),
          d.disco ? t("Reading the Wine saved on this device: {done} of {total} MB", mb) : t("First time only: {done} of {total} MB", mb),
          d.total ? d.recebido / d.total : null);
      } else carregando(t("Opening Wine"), t("Starting the emulator…"), null);
    }
    if (d.tipo === "wine:fase") {
      if (d.fase === "ligando") {
        primeira = !!d.primeira; prontoParaReceber = true;
        carregando(primeira ? t("Setting up Windows") : t("Starting Windows"),
          primeira ? t("The first time, Wine builds drive C:. This takes a few minutes and only happens once.") : t("The desktop will appear in a moment."), null);
        tempo();
      }
      if (d.fase === "pronto") pronto();
    }
    if (d.tipo === "wine:aviso") recado(d.texto);
    if (d.tipo === "wine:pausa") document.title = d.pausado ? t("Wine paused (hidden) · InkTerminal") : t("Wine · InkTerminal");
    if (d.tipo === "wine:direito") marcarDireito(d.ligado);
    if (d.tipo === "wine:erro") recado(t("Error: {error}", { error: d.texto }), true);
  });
})();
