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
  window.inkTempo = function (s) {
    if (!isFinite(s)) return "--:--";
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
})();
