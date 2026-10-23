/* Partes do InkDOS Hub dentro do emulador (emulador.html), carregadas depois do boxedwine-shell.js.

   1. Área de trabalho: o Wine sempre abre numa área de trabalho do tamanho pedido (?ink-tela=LxA),
      com a nossa área de trabalho (area/area.exe, guardada em D:\.inkdoshub) por baixo das
      janelas: fundo azul e um ícone por programa instalado. Ela grava D:\.inkdoshub\pronto quando
      aparece; esta página avisa a de fora para tirar o aviso de carregamento.
   2. Arquivos recebidos (instaladores): index.html guarda o .exe, .msi ou .zip no IndexedDB
      "inkdoshub-wine" (loja "entrada") e abre o emulador com ?ink-entrada=<id>, ou, com o Wine já
      aberto, manda {tipo:"wine:arquivo"}. O arquivo vai para o D: e o caminho dele para
      D:\.inkdoshub\abrir.txt, que a área de trabalho abre.
   3. Toque no iPad: {tipo:"wine:teclado"} mostra o teclado e {tipo:"wine:direito", ligado} faz o
      próximo toque valer como clique com o botão direito. */
(function () {
  "use strict";
  var q = new URLSearchParams(location.search);
  /* Textos: traduzidos pelo assets/idioma.js da página de fora (mesma origem). */
  var t = function (s, p) {
    try { var I = window.parent.InkIdioma; if (I) return I.t(s, p); } catch (_) {}
    return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m; }) : s;
  };
  /* Lê um .zip (só "guardado" e "deflate", os dois que os .zip comuns usam). */
  function extrair(bytes) {
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), fim = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) return Promise.reject(new Error(t("The .zip file has no central directory")));
    var n = v.getUint16(fim + 10, true), p = v.getUint32(fim + 16, true), lista = [];
    for (var k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var flag = v.getUint16(p + 8, true), metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true);
      var ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
      var nome = new TextDecoder(flag & 0x800 ? "utf-8" : "latin1").decode(bytes.subarray(p + 46, p + 46 + ln));
      var ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      lista.push({ nome: nome.replace(/\\/g, "/"), metodo: metodo, dados: bytes.subarray(ini, ini + tam) });
      p += 46 + ln + le + lc;
    }
    return lista.reduce(function (cadeia, e) {
      return cadeia.then(function (saida) {
        if (/\/$/.test(e.nome)) { saida.push({ nome: e.nome, pasta: true }); return saida; }
        if (e.metodo === 0) { saida.push({ nome: e.nome, dados: e.dados }); return saida; }
        if (e.metodo !== 8) throw new Error(t("Unsupported compression in {file}", { file: e.nome }));
        var s = new Blob([e.dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Response(s).arrayBuffer().then(function (b) { saida.push({ nome: e.nome, dados: new Uint8Array(b) }); return saida; });
      });
    }, Promise.resolve([]));
  }

  function gravar(base, rel, dados) {
    var partes = rel.split("/").filter(function (x) { return x && x !== "." && x !== ".."; });
    if (!partes.length) return;
    var arq = dados ? partes.pop() : null;
    var dir = base;
    partes.forEach(function (x) { try { FS.mkdir(dir + "/" + x); } catch (_) {} dir += "/" + x; });
    if (arq) { try { FS.unlink(dir + "/" + arq); } catch (_) {} FS.writeFile(dir + "/" + arq, dados); }
    marcar(dir);
  }
  /* O Boxedwine guarda a lista de cada pasta do D: que já leu e não vê arquivos que a página
     grava depois. Cada pasta mexida fica marcada, e avisarWine() manda o Boxedwine reler. */
  var marcadas = {};
  function marcar(dir) {
    var raiz = Config.d_drive;
    if (dir.indexOf(raiz) !== 0) return;
    var rel = dir.slice(raiz.length).replace(/^\/+|\/+$/g, "");
    marcadas["."] = 1;
    var partes = rel ? rel.split("/") : [];
    for (var i = 1; i <= partes.length; i++) marcadas[partes.slice(0, i).join("/")] = 1;
  }
  function avisarWine() {
    var l = Object.keys(marcadas).sort();
    marcadas = {};
    if (!l.length || typeof Module === "undefined" || typeof Module.ccall !== "function") return;
    try { Module.ccall("boxedwineHostFolderSyncDirectories", null, ["string", "string"], [D_GUEST, l.join("\n")]); }
    catch (e) { console.error("InkDOS Hub: reler D:", e); }
  }
  function existe(c) { try { return FS.analyzePath(c).exists; } catch (_) { return false; } }
  function pasta(c) { try { FS.mkdirTree(c); } catch (_) {} marcar(c); }
  function nomeLivre(base, nome) {
    var n = nome, i = 2, ponto = nome.lastIndexOf(".");
    while (existe(base + "/" + n)) n = (ponto > 0 ? nome.slice(0, ponto) : nome) + " (" + i++ + ")" + (ponto > 0 ? nome.slice(ponto) : "");
    return n;
  }
  function limpo(nome) { return String(nome).replace(/[\\/:*?"<>|]+/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 80) || "programa"; }
  function ehInstalador(nome) { return /(^|[\/_ .-])(setup|install|instal|installer|instalador)[^\/]*\.(exe|msi)$/i.test(nome) || /\.msi$/i.test(nome); }
  function arquitetura(b) {
    try {
      var v = new DataView(b.buffer, b.byteOffset, b.byteLength), pe = v.getUint32(0x3c, true);
      if (b[0] !== 0x4d || b[1] !== 0x5a || v.getUint32(pe, true) !== 0x4550) return null;
      var m = v.getUint16(pe + 4, true);
      return m === 0x8664 ? "x64" : m === 0xaa64 ? "arm64" : null;
    } catch (_) { return null; }
  }

  /* Atalho .lnk mínimo (MS-SHLLINK): cabeçalho, LinkInfo com o caminho local e a pasta de trabalho. */
  function criarLnk(alvo, pastaTrabalho) {
    var enc = function (s) { var b = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); b.push(c < 256 ? c : 63); } return b; };
    var u16 = function (s) { var b = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); b.push(c & 255, c >> 8); } return b; };
    var le = function (n, bytes) { var b = []; for (var i = 0; i < bytes; i++) { b.push(n & 255); n = Math.floor(n / 256); } return b; };
    var cab = [].concat(le(0x4c, 4), [0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46],
      le(0x02 | 0x10 | 0x80, 4), le(0x20, 4), le(0, 8), le(0, 8), le(0, 8), le(0, 4), le(0, 4), le(1, 4), le(0, 2), le(0, 2), le(0, 4), le(0, 4));
    var volume = [].concat(le(0x11, 4), le(3, 4), le(0, 4), le(0x10, 4), [0]);
    var base = enc(alvo).concat([0]), offBase = 0x1c + volume.length, offSuf = offBase + base.length;
    var info = [].concat(le(offSuf + 1, 4), le(0x1c, 4), le(1, 4), le(0x1c, 4), le(offBase, 4), le(0, 4), le(offSuf, 4), volume, base, [0]);
    return new Uint8Array([].concat(cab, info, le(pastaTrabalho.length, 2), u16(pastaTrabalho), le(0, 4)));
  }

  var INK = function () { return Config.d_drive + "/.inkdoshub"; };
  function pedirAbertura(caminhoWin) {
    pasta(INK());
    var antes = existe(INK() + "/abrir.txt") ? new TextDecoder().decode(FS.readFile(INK() + "/abrir.txt")) : "";
    FS.writeFile(INK() + "/abrir.txt", new TextEncoder().encode(antes + caminhoWin + "\r\n"));
    marcar(INK());
  }

  /* Guarda um arquivo recebido no D: e pede para a área de trabalho abri-lo.
     e: {nome, dados: ArrayBuffer}. Devolve uma frase para o aviso da página de fora. */
  function receberArquivo(e) {
    var bytes = new Uint8Array(e.dados), nome = limpo(e.nome), ext = (nome.match(/\.([^.]+)$/) || [])[1];
    ext = ext ? ext.toLowerCase() : "";
    if (ext === "exe" && arquitetura(bytes)) return Promise.resolve(t("\"{name}\" is 64-bit, and Wine here only runs 32-bit programs. Look for the 32-bit (x86) version.", { name: nome }));
    if (ext === "zip") {
      var base = Config.d_drive + "/Programas", dir = nomeLivre(base, nome.replace(/\.zip$/i, ""));
      pasta(base + "/" + dir);
      return extrair(bytes).then(function (l) {
        var exes = [];
        l.forEach(function (x) { if (x.pasta) gravar(base + "/" + dir, x.nome, null); else { gravar(base + "/" + dir, x.nome, x.dados); if (/\.(exe|msi)$/i.test(x.nome)) exes.push(x.nome); } });
        var win = "D:\\Programas\\" + dir;
        var inst = exes.filter(ehInstalador).sort(function (a, b) { return a.split("/").length - b.split("/").length; })[0];
        if (inst) { pedirAbertura(win + "\\" + inst.replace(/\//g, "\\")); return t("Opening the installer from {name}…", { name: nome }); }
        var programas = exes.filter(function (x) { return /\.exe$/i.test(x); });
        if (programas.length === 1) {
          var alvo = win + "\\" + programas[0].replace(/\//g, "\\");
          criarAtalho(programas[0].split("/").pop().replace(/\.exe$/i, ""), alvo);
          pedirAbertura(alvo);
          return t("{name} is in {folder}, with a shortcut on the desktop.", { name: nome, folder: "D:\\Programas" });
        }
        criarAtalho(dir, win);
        pedirAbertura(win);
        return t("{name} was extracted to {folder}.", { name: nome, folder: win });
      });
    }
    if (ext !== "exe" && ext !== "msi") return Promise.resolve(t("\"{name}\" is not a Windows program.", { name: nome }));
    var instalador = ehInstalador(nome) || ext === "msi";
    var raiz = instalador ? "Recebidos" : "Programas";
    var destino = Config.d_drive + "/" + raiz;
    pasta(destino);
    var arq = nomeLivre(destino, nome);
    FS.writeFile(destino + "/" + arq, bytes);
    marcar(destino);
    var caminho = "D:\\" + raiz + "\\" + arq;
    if (!instalador) criarAtalho(arq.replace(/\.exe$/i, ""), caminho);
    pedirAbertura(caminho);
    return Promise.resolve(instalador ? t("Opening the installer {name}…", { name: arq }) : t("{name} is in {folder}, with a shortcut on the desktop.", { name: arq, folder: "D:\\Programas" }));
  }
  function criarAtalho(nome, alvoWin) {
    pasta(INK() + "/atalhos");
    var dirTrab = /\.\w{2,4}$/.test(alvoWin) ? alvoWin.slice(0, alvoWin.lastIndexOf("\\")) : alvoWin;
    FS.writeFile(INK() + "/atalhos/" + limpo(nome) + ".lnk", criarLnk(alvoWin, dirTrab));
    marcar(INK() + "/atalhos");
  }

  function lerEntrada(id) {
    return new Promise(function (ok) {
      var req = indexedDB.open("inkdoshub-wine", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("entrada"); };
      req.onerror = function () { ok(null); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction("entrada", "readwrite"), st = tx.objectStore("entrada"), get = st.get(id);
        get.onsuccess = function () { ok(get.result || null); st.delete(id); };
        get.onerror = function () { ok(null); };
        tx.oncomplete = function () { db.close(); };
      };
    });
  }
  function avisarFora(m) { if (window.parent !== window) window.parent.postMessage(m, location.origin); }

  /* ---------- Área de trabalho ---------- */
  var tela = /^\d{3,4}x\d{3,4}$/.test(q.get("ink-tela") || "") ? q.get("ink-tela") : "1024x768";
  /* Tamanhos acima de 1024x768: o Boxedwine usa window.screen como tamanho da tela física e, abaixo
     de 1601 pontos de largura (todo iPad), só oferece 1024x768, 800x600 e 640x480 ao Wine, que
     então recusa qualquer tamanho maior. Com uma tela "física" grande, o Wine aceita os tamanhos
     padrão até ela (wine.js escolhe um deles). Mais alta que larga, o Wine passa a oferecer os
     tamanhos em pé (768x1024 etc.), para a página em pé. */
  var emPe = (function () { var m = /^(\d+)x(\d+)$/.exec(tela); return +m[2] > +m[1]; })();
  try {
    Object.defineProperty(window.screen, "width", { configurable: true, get: function () { return emPe ? 2000 : 2048; } });
    Object.defineProperty(window.screen, "height", { configurable: true, get: function () { return 2048; } });
  } catch (_) {}
  /* A imagem do Wine cabe inteira na página, sem esticar, centralizada; o que sobra fica com a cor
     do fundo. O toque continua certo: o Emscripten converte a posição pelo tamanho do canvas. */
  (function () {
    var m = /^(\d+)x(\d+)$/.exec(tela), W = +m[1], H = +m[2];
    function caber() {
      var c = document.getElementById("canvas");
      if (!c) return;
      var k = Math.min(innerWidth / W, innerHeight / H), w = Math.floor(W * k), h = Math.floor(H * k);
      c.style.setProperty("width", w + "px", "important");
      c.style.setProperty("height", h + "px", "important");
      c.style.setProperty("position", "fixed", "important");
      c.style.setProperty("margin", "0", "important");
      c.style.setProperty("left", Math.floor((innerWidth - w) / 2) + "px", "important");
      c.style.setProperty("top", Math.floor((innerHeight - h) / 2) + "px", "important");
      c.style.setProperty("background", "#163254", "important");
    }
    addEventListener("resize", caber);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", caber); else caber();
  })();
  if (typeof buildBrowserFileSystem === "function") {
    var original = buildBrowserFileSystem;
    // initBrowserFilesystem chama buildBrowserFileSystem pelo nome global, então esta troca vale
    buildBrowserFileSystem = function () {
      var args = arguments, self = this, primeira = false;
      pasta(INK());
      try { FS.unlink(INK() + "/pronto"); } catch (_) {}
      try { FS.unlink(INK() + "/abrir.txt"); } catch (_) {} // pedidos de uma sessão anterior
      var id = q.get("ink-entrada"), entrada = null;
      var passos = (id && /^[A-Za-z0-9-]{4,64}$/.test(id) ? lerEntrada(id) : Promise.resolve(null)).then(function (e) {
        entrada = e;
        // a sessão troca os discos inteiros, então vem antes de gravar a área de trabalho no D:
        if (e && e.sessao) restaurarSessao(e.partes);
        return fetch("area/area.exe?v=3");
      }).then(function (r) {
        if (!r.ok) throw new Error("area.exe " + r.status);
        return r.arrayBuffer();
      }).then(function (b) {
        FS.writeFile(INK() + "/area.exe", new Uint8Array(b));
        if (entrada && entrada.sessao) avisarFora({ tipo: "wine:aviso", texto: t("Session opened: programs and drive D: are back.") });
        else if (entrada) return receberArquivo(entrada).then(function (t) { avisarFora({ tipo: "wine:aviso", texto: t }); });
      });
      passos.catch(function (err) {
        console.error("InkDOS Hub:", err);
        avisarFora({ tipo: "wine:erro", texto: String(err && err.message || err) });
      }).then(function () {
        primeira = !existe(ROOT + "/home/username/.wine/system.reg");
        Config.resolution = tela;
        Config.Program = "explorer";
        Config.ProgramArgs = ["/desktop=shell," + tela, "D:\\.inkdoshub\\area.exe"];
        Config.WorkingDir = "";
        ligarD();
        avisarFora({ tipo: "wine:fase", fase: "ligando", primeira: primeira });
        var t = setInterval(function () {
          if (existe(INK() + "/pronto")) { clearInterval(t); avisarFora({ tipo: "wine:fase", fase: "pronto" }); }
        }, 1000);
        original.apply(self, args);
      });
    };
  }

  /* ---------- Sessão em arquivo (botão Sessão, assets/sessao.js) ----------
     Guarda tudo o que o Wine mudou: o disco do Boxedwine em /root (o C: com os programas
     instalados e o registro, por cima do sistema que vem no .zip) e o disco D:.
     Pacote: tamanho do índice (4 bytes) + índice JSON [[caminho, tipo, tamanho]] + os dados.
     tipo: "d" pasta, "f" arquivo, "l" link (o destino vai nos dados). */
  var FORA_C = /^tmp\//, FORA_D = /^\.inkdoshub\/(area\.exe|pronto|abrir\.txt)$/;
  function empacotar(base, FORA) {
    var lista = [], dados = [], total = 0;
    (function andar(rel) {
      var nomes; try { nomes = FS.readdir(base + (rel ? "/" + rel : "")); } catch (_) { return; }
      nomes.forEach(function (n) {
        if (n === "." || n === "..") return;
        var r = rel ? rel + "/" + n : n, c = base + "/" + r, st;
        if (FORA.test(r)) return;
        try { st = FS.lstat(c); } catch (_) { return; }
        if (FS.isLink(st.mode)) { var b = new TextEncoder().encode(FS.readlink(c)); lista.push([r, "l", b.length]); dados.push(b); total += b.length; }
        else if (FS.isDir(st.mode)) { lista.push([r, "d", 0]); andar(r); }
        else if (FS.isFile(st.mode)) { var f = FS.readFile(c); lista.push([r, "f", f.length]); dados.push(f); total += f.length; }
      });
    })("");
    var j = new TextEncoder().encode(JSON.stringify(lista)), out = new Uint8Array(4 + j.length + total), p = 4 + j.length;
    new DataView(out.buffer).setUint32(0, j.length, true);
    out.set(j, 4);
    dados.forEach(function (d) { out.set(d, p); p += d.length; });
    return out;
  }
  function apagarTudo(base) {
    var nomes; try { nomes = FS.readdir(base); } catch (_) { return; }
    nomes.forEach(function (n) {
      if (n === "." || n === "..") return;
      var c = base + "/" + n, st;
      try { st = FS.lstat(c); } catch (_) { return; }
      if (FS.isDir(st.mode) && !FS.isLink(st.mode)) { apagarTudo(c); try { FS.rmdir(c); } catch (_) {} }
      else { try { FS.unlink(c); } catch (_) {} }
    });
  }
  function desempacotar(base, b) {
    var n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
    var lista = JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + n))), p = 4 + n;
    lista.forEach(function (x) {
      var c = base + "/" + x[0], d = b.subarray(p, p + x[2]); p += x[2];
      if (x[1] === "d") pasta(c);
      else if (x[1] === "f") { pasta(c.slice(0, c.lastIndexOf("/"))); FS.writeFile(c, d); }
      else if (x[1] === "l") { try { FS.symlink(new TextDecoder().decode(d), c); } catch (_) {} }
    });
  }
  function restaurarSessao(partes) {
    if (!partes || !partes["c.pacote"] || !partes["d.pacote"]) throw new Error(t("The file doesn't contain the Wine drives"));
    apagarTudo(ROOT);
    apagarTudo(Config.d_drive);
    desempacotar(ROOT, partes["c.pacote"]);
    desempacotar(Config.d_drive, partes["d.pacote"]);
    pasta(INK());
    try { FS.syncfs(false, function () {}); } catch (_) {}
  }

  /* ---------- Disco D: com gravação ----------
     O "-mount_drive" do Boxedwine põe o D: em /mnt/drive_d, e o Boxedwine só deixa o usuário
     do Wine gravar em /home, /tmp e /var: lá dentro os programas recebem "acesso negado".
     Por isso a pasta do D: entra em /home/username/d ("-mount") e o link d: do Wine
     (dosdevices/d:, gravado como "d(_colon_).link" no disco do Boxedwine) aponta para ela. */
  var D_GUEST = "/home/username/d";
  function ligarD() {
    var dir = ROOT + "/home/username/.wine/dosdevices";
    try { FS.mkdirTree(dir); } catch (_) {}
    try { FS.writeFile(dir + "/d(_colon_).link", D_GUEST); } catch (e) { console.error("InkDOS Hub: link d:", e); }
  }
  if (typeof getEmulatorParams === "function") {
    var paramsOriginal = getEmulatorParams;
    getEmulatorParams = function () {
      var p = paramsOriginal.apply(this, arguments);
      var i = p.indexOf("-mount_drive");
      if (i >= 0 && p[i + 2] === "d") p.splice(i, 3, "-mount", p[i + 1], D_GUEST);
      console.log("InkDOS Hub params: " + p.join(" "));
      return p;
    };
  }

  /* ---------- Pausa em segundo plano ----------
     Com a página oculta, o Wine pausa (Module.pauseMainLoop) quando está parado: nada gravado no
     disco há 1 minuto. Instalações e cópias gravam o tempo todo, então seguem rodando. A barra da
     página tem "Segundo plano: continua" para nunca pausar. Volta na hora quando a página aparece. */
  var ultimaGravacao = Date.now(), pausado = false, manterLigado = false;
  try { manterLigado = localStorage.getItem("inkdoshub-wine-fundo") === "continua"; } catch (_) {}
  function marcarGravacao() {
    if (typeof FS === "undefined" || !FS.write || FS.write.inkMarcado) return;
    var w = FS.write;
    // só arquivos de verdade: o texto do console do Boxedwine também passa por FS.write
    FS.write = function (st) {
      try { if (st && st.node && FS.isFile(st.node.mode)) ultimaGravacao = Date.now(); } catch (_) {}
      return w.apply(this, arguments);
    };
    FS.write.inkMarcado = true;
  }
  function oculta() { try { return window.top.document.visibilityState === "hidden"; } catch (_) { return document.visibilityState === "hidden"; } }
  function rever() {
    marcarGravacao();
    if (typeof Module === "undefined" || !Module.pauseMainLoop) return;
    var pausar = oculta() && !manterLigado && Date.now() - ultimaGravacao > 60000;
    if (pausar && !pausado) { Module.pauseMainLoop(); pausado = true; avisarFora({ tipo: "wine:pausa", pausado: true }); }
    else if (!pausar && pausado) { Module.resumeMainLoop(); pausado = false; ultimaGravacao = Date.now(); avisarFora({ tipo: "wine:pausa", pausado: false }); }
  }
  setInterval(rever, 5000);
  window.inkPausa = function () { return { pausado: pausado, semGravar: Date.now() - ultimaGravacao, oculta: oculta(), manter: manterLigado, marcado: typeof FS !== "undefined" && !!FS.write.inkMarcado }; };
  document.addEventListener("visibilitychange", rever);
  try { window.top.document.addEventListener("visibilitychange", rever); } catch (_) {}

  /* ---------- Toque no iPad ---------- */
  var direito = false;
  var campo = document.createElement("textarea");
  campo.setAttribute("autocapitalize", "off");
  campo.setAttribute("autocorrect", "off");
  campo.setAttribute("autocomplete", "off");
  campo.setAttribute("spellcheck", "false");
  campo.id = "ink-teclado";
  campo.setAttribute("aria-label", t("Keyboard"));
  campo.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;z-index:-1";
  addEventListener("DOMContentLoaded", function () { document.body.appendChild(campo); });
  // as teclas chegam ao SDL pelo window (o campo só existe para o iPad mostrar o teclado)
  campo.addEventListener("input", function () { campo.value = ""; });

  function canvas() { return document.getElementById("canvas"); }
  function mouse(tipo, x, y, botao, botoes) {
    var c = canvas(); if (!c) return;
    c.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: botao, buttons: botoes, view: window }));
  }
  function clique(x, y, botao) {
    mouse("mousemove", x, y, 0, 0);
    mouse("mousedown", x, y, botao, botao === 2 ? 2 : 1);
    setTimeout(function () { mouse("mouseup", x, y, botao, 0); }, 60);
  }
  /* Toque no iPad: vira mouse aqui mesmo, e o Safari e o SDL não recebem o toque. No Safari do iPad
     o toque entregue ao SDL não chegava ao Wine (tocar num ícone não fazia nada).
     - toque rápido: clique com o botão esquerdo;
     - arrastar: botão esquerdo apertado enquanto o dedo anda (mover janelas, selecionar);
     - segurar meio segundo sem mexer, ou tocar com "clique direito" ligado: botão direito. */
  var segurar = null, toque = null;
  function dentro(e) { var c = canvas(); return c && (e.target === c || c.contains(e.target)); }
  document.addEventListener("touchstart", function (e) {
    var t = e.touches[0];
    if (!t || !dentro(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.touches.length > 1 || toque) return;
    if (direito) {
      direito = false; avisar();
      clique(t.clientX, t.clientY, 2);
      return;
    }
    toque = { x: t.clientX, y: t.clientY, apertado: false };
    mouse("mousemove", t.clientX, t.clientY, 0, 0);
    clearTimeout(segurar);
    segurar = setTimeout(function () {
      segurar = null;
      if (toque && !toque.apertado) { clique(toque.x, toque.y, 2); toque = null; }
    }, 550);
  }, { capture: true, passive: false });
  document.addEventListener("touchmove", function (e) {
    var t = e.touches[0];
    if (!toque || !t) return;
    e.preventDefault(); e.stopPropagation();
    if (!toque.apertado && Math.hypot(t.clientX - toque.x, t.clientY - toque.y) > 10) {
      clearTimeout(segurar);
      toque.apertado = true;
      mouse("mousedown", toque.x, toque.y, 0, 1);
    }
    if (toque.apertado) mouse("mousemove", t.clientX, t.clientY, 0, 1);
  }, { capture: true, passive: false });
  ["touchend", "touchcancel"].forEach(function (n) {
    document.addEventListener(n, function (e) {
      if (!toque) return;
      e.preventDefault(); e.stopPropagation();
      clearTimeout(segurar);
      var t = e.changedTouches[0], x = t ? t.clientX : toque.x, y = t ? t.clientY : toque.y;
      if (toque.apertado) mouse("mouseup", x, y, 0, 0);
      else if (n === "touchend") clique(toque.x, toque.y, 0);
      toque = null;
    }, { capture: true, passive: false });
  });

  function avisar() {
    if (window.parent !== window) window.parent.postMessage({ tipo: "wine:direito", ligado: direito }, location.origin);
  }
  addEventListener("message", function (e) {
    if (e.origin === location.origin && e.data && e.data.tipo === "wine:fundo") { manterLigado = !!e.data.manter; rever(); return; }
    if (e.origin === location.origin && e.data && e.data.tipo === "wine:sessao-salvar") {
      try {
        // o Wine grava o registro de tempos em tempos; o que estiver no disco agora é o que vai
        var c = empacotar(ROOT, FORA_C), d = empacotar(Config.d_drive, FORA_D);
        e.source.postMessage({ tipo: "wine:sessao-dados", partes: { "c.pacote": c, "d.pacote": d } }, location.origin, [c.buffer, d.buffer]);
      } catch (err) {
        e.source.postMessage({ tipo: "wine:sessao-dados", erro: String(err && err.message || err) }, location.origin);
      }
      return;
    }
    if (e.origin !== location.origin || e.source !== window.parent || !e.data) return;
    if (e.data.tipo === "wine:teclado") { campo.focus(); }
    if (e.data.tipo === "wine:direito") { direito = !!e.data.ligado; avisar(); }
    if (e.data.tipo === "wine:arquivo" && e.data.arquivo) {
      receberArquivo(e.data.arquivo).then(function (t) { avisarWine(); avisarFora({ tipo: "wine:aviso", texto: t }); },
        function (err) { avisarWine(); avisarFora({ tipo: "wine:erro", texto: String(err && err.message || err) }); });
    }
    if (e.data.tipo === "wine:enviar" && e.data.arquivos && typeof startWithFiles === "function") {
      // arquivos vão para a raiz do D:
      startWithFiles(e.data.arquivos);
      setTimeout(function () { marcar(Config.d_drive); avisarWine(); try { FS.syncfs(false, function () {}); } catch (_) {} }, 1500);
      window.parent.postMessage({ tipo: "wine:enviado", n: e.data.arquivos.length }, location.origin);
    }
  });
})();
