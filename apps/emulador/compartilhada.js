/* Emulator: folder shared between the Linux and Windows environments (Linux /root/Device, Windows D:\Shared).
   The files live in this browser (IndexedDB "inkdoshub-shared"). Each page copies them into its emulator
   when it starts and saves back what changed every few seconds (only one emulator runs at a time).
   Each page passes a list of its files: [{ path, mtime, ler: () => Promise<Uint8Array> }]. */
"use strict";
window.Compartilhada = (function () {
  var db = null, vistos = {};
  function abrir() {
    if (db) return Promise.resolve(db);
    return new Promise(function (ok, erro) {
      var r = indexedDB.open("inkdoshub-shared", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("files"); };
      r.onsuccess = function () { db = r.result; ok(db); };
      r.onerror = function () { erro(r.error); };
    });
  }
  function op(modo, fn) {
    return abrir().then(function (d) {
      return new Promise(function (ok, erro) {
        var t = d.transaction("files", modo), s = t.objectStore("files"), res = fn(s);
        t.oncomplete = function () { ok(res && res.result); };
        t.onerror = function () { erro(t.error); };
      });
    });
  }
  // every file saved: [{ path, data }]
  function carregar() {
    var lista = [];
    return op("readonly", function (s) {
      s.openCursor().onsuccess = function (e) {
        var c = e.target.result; if (!c) return;
        lista.push({ path: c.key, data: c.value }); c.continue();
      };
    }).then(function () { return lista; });
  }
  // the page's current files: the first call only records them, later calls save what changed
  var primeira = true, ocupado = false;
  function salvar(atuais) {
    if (ocupado) return Promise.resolve();
    ocupado = true;
    var novos = {}, mudou = [], apagar = [];
    atuais.forEach(function (f) { novos[f.path] = f.mtime; if (!primeira && vistos[f.path] !== f.mtime) mudou.push(f); });
    if (!primeira) for (var p in vistos) if (!(p in novos)) apagar.push(p);
    primeira = false;
    return Promise.all(mudou.map(function (f) { return f.ler().then(function (d) { return { path: f.path, data: d }; }, function () { return null; }); }))
      .then(function (dados) {
        if (!dados.some(Boolean) && !apagar.length) return;
        return op("readwrite", function (s) {
          dados.forEach(function (x) { if (x) s.put(x.data, x.path); });
          apagar.forEach(function (p) { s.delete(p); });
        });
      })
      .then(function () { vistos = novos; }, function (e) { console.warn("shared folder:", e); })
      .then(function () { ocupado = false; });
  }
  return { carregar: carregar, salvar: salvar };
})();
