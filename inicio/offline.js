/* Botão "Offline" do menu da tela inicial: guarda o InkDOS Hub inteiro neste aparelho.
   Os arquivos vão para o cache "inkdoshub-offline" (lista em inicio/manifesto.json). Com a cópia
   instalada, o sw-portal.js abre tudo daqui e o site só muda quando a pessoa toca em Offline de novo,
   que baixa apenas os arquivos que mudaram. */
(function () {
  "use strict";
  var CACHE = "inkdoshub-offline";
  var BASE = new URL("./", location.href);
  var MARCA = new URL("__offline__/manifesto.json", BASE).href;
  var t = function (s, p) { return window.InkIdioma ? InkIdioma.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  var btn = document.getElementById("btn-offline");
  if (!btn || !("caches" in window) || !("serviceWorker" in navigator)) { if (btn) btn.closest(".menu-offline").hidden = true; return; }
  var info = btn.querySelector("small");
  navigator.serviceWorker.register("sw-portal.js", { scope: "./" }).catch(function () {});

  function estado() {
    return caches.open(CACHE).then(function (c) { return c.match(MARCA); }).then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
  }
  function marcar(m) { btn.setAttribute("aria-pressed", m ? "true" : "false"); }
  estado().then(marcar);

  var ocupado = false;
  btn.addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation();
    if (ocupado) return;
    ocupado = true;
    info.textContent = "…";
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
    Promise.all([fetch(new URL("inicio/manifesto.json", BASE).href, { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }), estado(), caches.open(CACHE)])
      .then(function (x) {
        var novo = x[0], velho = x[1], c = x[2];
        var antes = {};
        if (velho) velho.grupos.forEach(function (g) { g.arquivos.forEach(function (a) { antes[a[0]] = a[2]; }); });
        var todos = [], fila = [], total = 0, feito = 0;
        novo.grupos.forEach(function (g) { g.arquivos.forEach(function (a) { todos.push(a[0]); if (antes[a[0]] !== a[2]) { fila.push(a); total += a[1]; } }); });
        var chave = function (p) { return new URL(p, BASE).href; };
        return Promise.resolve()
          .then(function () {
            var i = 0;
            function proximo() {
              if (i >= fila.length) return Promise.resolve();
              var a = fila[i++];
              return fetch(chave(a[0]), { cache: "reload" }).then(function (r) {
                if (!r.ok) throw new Error(a[0]);
                return c.put(chave(a[0]), r);
              }).then(function () {
                feito += a[1];
                info.textContent = Math.min(99, Math.floor(feito * 100 / Math.max(1, total))) + "%";
                return proximo();
              });
            }
            return Promise.all([proximo(), proximo(), proximo(), proximo(), proximo(), proximo()]);
          })
          .then(function () {
            // arquivos que saíram do site
            var ficam = {}; todos.forEach(function (p) { ficam[chave(p)] = 1; });
            return c.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return !ficam[k.url] && k.url !== MARCA; }).map(function (k) { return c.delete(k); })); });
          })
          .then(function () { return c.put(MARCA, new Response(JSON.stringify(novo), { headers: { "Content-Type": "application/json" } })); })
          .then(function () { return caches.delete("inkdoshub-onlyoffice-v1"); })
          .then(function () { marcar(true); info.textContent = t("Up to date"); });
      })
      .catch(function () { info.textContent = t("Failed, try again"); })
      .then(function () { ocupado = false; });
  });
})();
