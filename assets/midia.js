/* Biblioteca local de arquivos (fotos, vídeos, músicas) do InkDOS Hub.
   Os arquivos ficam no IndexedDB deste site, neste aparelho. Nada é enviado. */
(function () {
  function abrir(nome) {
    return new Promise(function (ok, erro) {
      var r = indexedDB.open(nome, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("itens", { keyPath: "id", autoIncrement: true }); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { erro(r.error); };
    });
  }
  function pedido(db, modo, fn) {
    return new Promise(function (ok, erro) {
      var t = db.transaction("itens", modo), s = t.objectStore("itens"), res = fn(s);
      t.oncomplete = function () { ok(res && "result" in res ? res.result : undefined); };
      t.onerror = t.onabort = function () { erro(t.error); };
    });
  }
  window.InkBiblioteca = function (nome) {
    var dbp = abrir(nome).catch(function () { return null; });
    var memoria = [], prox = 1; // sem IndexedDB (navegação privada): só nesta sessão
    return {
      listar: function () {
        return dbp.then(function (db) { return db ? pedido(db, "readonly", function (s) { return s.getAll(); }) : memoria.slice(); });
      },
      adicionar: function (arquivos) {
        var itens = [].map.call(arquivos, function (f) { return { nome: f.name, tipo: f.type, tamanho: f.size, data: Date.now(), blob: f }; });
        return dbp.then(function (db) {
          if (!db) { itens.forEach(function (i) { i.id = prox++; memoria.push(i); }); return itens; }
          return Promise.all(itens.map(function (i) {
            return pedido(db, "readwrite", function (s) { return s.add(i); }).then(function (id) { i.id = id; return i; });
          }));
        });
      },
      trocar: function (item) {
        return dbp.then(function (db) { if (db) return pedido(db, "readwrite", function (s) { return s.put(item); }); });
      },
      remover: function (id) {
        return dbp.then(function (db) {
          if (!db) { memoria = memoria.filter(function (i) { return i.id !== id; }); return; }
          return pedido(db, "readwrite", function (s) { return s.delete(id); });
        });
      },
      limpar: function () {
        return dbp.then(function (db) { memoria = []; if (db) return pedido(db, "readwrite", function (s) { return s.clear(); }); });
      },
    };
  };
  window.inkTamanho = function (n) {
    var loc = window.InkIdioma ? InkIdioma.atual : undefined;
    function um(v) { return v.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
    return n > 1e9 ? um(n / 1e9) + " GB" : n > 1e6 ? um(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)).toLocaleString(loc) + " kB";
  };
  /* Baixa o arquivo (Downloads). */
  window.inkBaixar = function (arq) {
    var a = document.createElement("a"), u = URL.createObjectURL(arq);
    a.href = u; a.download = arq.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
  };
  /* Folha de compartilhar do sistema ("Salvar em Arquivos" no iPhone); onde não existe, baixa. */
  window.inkPartilhar = function (arq) {
    var pode = false;
    try { pode = !!(navigator.canShare && navigator.canShare({ files: [arq] })); } catch (_) {}
    if (!pode) { inkBaixar(arq); return Promise.resolve(); }
    return navigator.share({ files: [arq] }).catch(function (e) { if (!e || e.name !== "AbortError") inkBaixar(arq); });
  };
  /* Painel de progresso do Vídeo e do editor de vídeo (#progresso, #p-titulo, #p-texto, #p-barra, #p-botoes).
     parte: 0 a 1, ou null sem barra. botoes: [{texto, acao, principal}] */
  window.inkPainel = function (titulo, texto, parte, botoes) {
    var $ = function (id) { return document.getElementById(id); };
    $("progresso").classList.add("on");
    $("p-titulo").textContent = titulo;
    $("p-texto").textContent = texto || "";
    $("p-barra").style.display = parte == null ? "none" : "";
    $("p-barra").firstChild.style.width = Math.round((parte || 0) * 100) + "%";
    var b = $("p-botoes"); b.innerHTML = "";
    (botoes || []).forEach(function (x) {
      var e = document.createElement("button");
      e.className = "ink-btn" + (x.principal ? " principal" : "");
      e.textContent = x.texto; e.onclick = x.acao;
      b.appendChild(e);
    });
  };
  window.inkFecharPainel = function () { document.getElementById("progresso").classList.remove("on"); };
  window.inkTempo = function (s) {
    if (!isFinite(s)) return "--:--";
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
})();
