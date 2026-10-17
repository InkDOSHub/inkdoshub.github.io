/* Página do Wine: lista de programas, "Adicionar programa" e os botões da barra.
   O emulador roda em emulador.html (iframe); inkterminal-wine.js, lá dentro, grava os programas
   da pessoa no disco D: e cuida do teclado e do clique direito no iPad. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var CHAVE = "inkterminal-wine-meus";
  var PROGRAMAS = [
    { id: "desktop", nome: "Área de trabalho", sobre: "Windows com menu Iniciar e os programas instalados" },
    { id: "abiword", nome: "AbiWord", sobre: "Editor de texto (abre .doc e .rtf)", p: "ABIWORD.EXE", app: "abiword" },
    { id: "explorer", nome: "Arquivos", sobre: "Ver os discos C: e D:", p: "explorer" },
    { id: "notepad", nome: "Bloco de notas", sobre: "Do próprio Wine", p: "notepad" },
    { id: "cmd", nome: "Prompt de comando", sobre: "cmd do Wine", p: "wineconsole", args: "cmd" },
    { id: "winemine", nome: "Campo minado", sobre: "Do próprio Wine", p: "winemine" },
  ];

  /* Teste do formato de exceções novo (exnref), que o Boxedwine exige: Safari 18.4+, Chrome 137+. */
  var temExnref = false;
  try { temExnref = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,8,1,6,0,31,64,0,11,11])); } catch (_) {}
  if (!temExnref) {
    $("aviso").hidden = false;
    $("aviso").textContent = "Este navegador ainda não roda o Boxedwine. Atualize o iPadOS (Safari 18.4 ou mais novo).";
    $("b-adicionar").disabled = true;
  }

  function cartao(nome, sobre, acao) {
    var b = document.createElement("button");
    b.className = "ink-btn"; b.type = "button";
    b.innerHTML = "<strong></strong><small></small>";
    b.querySelector("strong").textContent = nome;
    b.querySelector("small").textContent = sobre;
    b.onclick = acao;
    b.disabled = !temExnref;
    return b;
  }
  PROGRAMAS.forEach(function (prog) {
    $("programas").appendChild(cartao(prog.nome, prog.sobre, function () { abrir(prog.nome, prog); }));
  });

  function lerMeus() { try { return JSON.parse(localStorage.getItem(CHAVE) || "[]") || []; } catch (_) { return []; } }
  function gravarMeus(l) { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch (_) {} }
  function desenharMeus() {
    var el = $("meus"), l = lerMeus();
    el.innerHTML = "";
    if (!l.length) { el.innerHTML = '<p class="vazio">Nenhum programa adicionado ainda.</p>'; return; }
    l.forEach(function (m) {
      var d = cartao(m.nome, (m.instalador ? "Instalador · " : "") + "D:\\Programas\\" + m.pasta, function () {
        abrir(m.nome, { pasta: m.pasta, exe: m.exe, tipo: m.tipo });
      });
      d.classList.add("meu");
      var x = document.createElement("span");
      x.className = "ink-btn tirar"; x.textContent = "×"; x.title = "Tirar da lista (os arquivos continuam no D:)";
      x.setAttribute("role", "button");
      x.onclick = function (e) {
        e.stopPropagation();
        gravarMeus(lerMeus().filter(function (y) { return y.id !== m.id; }));
        desenharMeus();
      };
      d.appendChild(x);
      el.appendChild(d);
    });
  }
  desenharMeus();

  function abrir(nome, prog) {
    // storageKey=default: todos os programas usam o mesmo C: e o mesmo D:
    var q = "root=TinyCore15Wine11.0&rootBase=fs&storageKey=default&env=%22WINEDLLOVERRIDES:mscoree,mshtml=%22";
    if (prog.p) q += "&p=" + encodeURIComponent(prog.p);
    if (prog.args) q += "&args=" + encodeURIComponent(prog.args);
    if (prog.app) q += "&app=" + prog.app + "&appBase=programas";
    if (prog.entrada) q += "&ink-programa=" + encodeURIComponent(prog.entrada);
    else if (prog.pasta) q += "&ink-pasta=" + encodeURIComponent(prog.pasta) + "&ink-exe=" + encodeURIComponent(prog.exe) + "&ink-tipo=" + (prog.tipo || "exe");
    $("status").textContent = "Abrindo " + nome + "…";
    $("tela").src = "emulador.html?" + q;
    document.body.classList.add("rodando");
    document.title = nome + " · Wine · InkTerminal";
  }

  /* ---------- Adicionar programa ---------- */
  function nomesNoZip(bytes) {
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), fim = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) return null;
    var n = v.getUint16(fim + 10, true), p = v.getUint32(fim + 16, true), nomes = [];
    for (var k = 0; k < n && p + 46 <= bytes.length; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var flag = v.getUint16(p + 8, true), ln = v.getUint16(p + 28, true);
      nomes.push(new TextDecoder(flag & 0x800 ? "utf-8" : "latin1").decode(bytes.subarray(p + 46, p + 46 + ln)).replace(/\\/g, "/"));
      p += 46 + ln + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    return nomes;
  }
  function pastaPara(nome) {
    var base = nome.replace(/\.(exe|msi|zip)$/i, "").replace(/[^A-Za-z0-9 ._-]+/g, "_").replace(/^[ .]+|[ .]+$/g, "").slice(0, 40) || "Programa";
    var usadas = lerMeus().map(function (m) { return m.pasta.toLowerCase(); }), p = base, i = 2;
    while (usadas.indexOf(p.toLowerCase()) >= 0) p = base + " " + i++;
    return p;
  }
  function ehInstalador(nome) { return /(^|[\/_ -])(setup|install|instal|installer)[^\/]*\.(exe|msi)$/i.test(nome) || /\.msi$/i.test(nome); }

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

  function concluir(file, dados, tipo, exe) {
    var nome = file.name.replace(/\.(exe|msi|zip)$/i, "");
    var pasta = pastaPara(file.name);
    var m = { id: pasta + "-" + Date.now().toString(36), nome: nome, pasta: pasta, exe: exe, tipo: tipo === "zip" ? (/\.msi$/i.test(exe) ? "msi" : "exe") : tipo, instalador: ehInstalador(exe) };
    $("escolha").hidden = true;
    return guardarEntrada({ nome: nome, pasta: pasta, exe: exe, tipo: tipo, dados: dados, at: Date.now() }).then(function (id) {
      var l = lerMeus(); l.unshift(m); gravarMeus(l); desenharMeus();
      // na primeira abertura o arquivo vai para o D:; o tipo de abrir é o do .exe/.msi escolhido
      abrir(nome, { entrada: id });
    });
  }

  function adicionar(file) {
    if (!file) return;
    var ext = (file.name.match(/\.([^.]+)$/) || [])[1];
    ext = ext ? ext.toLowerCase() : "";
    if (["exe", "msi", "zip"].indexOf(ext) < 0) {
      $("aviso").hidden = false; $("aviso").textContent = "\"" + file.name + "\" não é um programa do Windows (.exe, .msi ou .zip).";
      return;
    }
    $("aviso").hidden = true;
    file.arrayBuffer().then(function (dados) {
      if (ext !== "zip") return concluir(file, dados, ext, file.name);
      var nomes = nomesNoZip(new Uint8Array(dados));
      var exes = (nomes || []).filter(function (n) { return /\.(exe|msi)$/i.test(n) && !/\/$/.test(n); });
      if (!exes.length) {
        $("aviso").hidden = false; $("aviso").textContent = nomes ? "Não há .exe nem .msi dentro de \"" + file.name + "\"." : "\"" + file.name + "\" não parece um .zip válido.";
        return;
      }
      if (exes.length === 1) return concluir(file, dados, "zip", exes[0]);
      // vários: a pessoa escolhe qual abre (os instaladores e os mais rasos primeiro)
      exes.sort(function (a, b) { return (ehInstalador(b) - ehInstalador(a)) || (a.split("/").length - b.split("/").length) || a.localeCompare(b); });
      var esc = $("escolha");
      esc.innerHTML = "<strong></strong><ul></ul>";
      esc.firstChild.textContent = "Qual programa de \"" + file.name + "\" abrir?";
      exes.slice(0, 30).forEach(function (n) {
        var li = document.createElement("li"), b = document.createElement("button");
        b.className = "ink-btn"; b.type = "button"; b.textContent = n;
        b.onclick = function () { concluir(file, dados, "zip", n); };
        li.appendChild(b); esc.lastChild.appendChild(li);
      });
      esc.hidden = false;
      esc.scrollIntoView({ block: "nearest" });
    }).catch(function (e) {
      $("aviso").hidden = false; $("aviso").textContent = "Não consegui guardar o programa: " + (e && e.message || e);
    });
  }
  $("b-adicionar").onclick = function () { $("arquivos").click(); };
  // também recebe arquivos da tela inicial (abrir um .exe no XeOS): veja assets/gerenciador-app.js
  $("arquivos").onchange = function () { var f = $("arquivos").files[0]; $("arquivos").value = ""; adicionar(f); };

  /* ---------- Barra com o programa aberto ---------- */
  function janela() { try { return $("tela").contentWindow; } catch (_) { return null; } }
  $("b-parar").onclick = function () {
    $("tela").src = "about:blank";
    document.body.classList.remove("rodando");
    $("status").textContent = "";
    document.title = "Wine · InkTerminal";
    marcarDireito(false);
  };
  $("b-arquivos").onclick = function () {
    var w = janela();
    if (w && typeof w.buildGetFilesModal === "function") w.buildGetFilesModal();
  };
  $("b-enviar").onclick = function () { $("enviar").click(); };
  $("enviar").onchange = function () {
    var w = janela(), f = [].slice.call($("enviar").files);
    $("enviar").value = "";
    if (w && typeof w.startWithFiles === "function" && f.length) {
      w.startWithFiles(f);
      $("status").textContent = (f.length === 1 ? f[0].name : f.length + " arquivos") + " no disco D:";
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
      $("status").textContent = d.recebido < d.total ?
        (d.disco ? "Abrindo o Wine guardado… " : "Baixando o Wine… ") + Math.round(d.recebido / 1e6) + " de " + Math.round(d.total / 1e6) + " MB" :
        "Wine ligado. Na primeira vez o Windows leva uns minutos para aparecer.";
    }
    if (d.tipo === "wine:direito") marcarDireito(d.ligado);
    if (d.tipo === "wine:erro") { $("status").textContent = "Erro: " + d.texto; }
  });
})();
