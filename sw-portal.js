/* Service worker do portal offline do InkDOS Hub.

   Ele é registrado pela tela inicial (inicio/offline.js). Sem o modo offline, tudo vem do site e o cache
   só serve quando não há rede. Com o modo offline instalado, a cópia inteira vem primeiro. */
"use strict";
var CACHE = "inkdoshub-offline";
var RAIZ = self.INK_RAIZ || new URL("./", self.location.href).pathname; // "/" no GitHub Pages (o editor do OnlyOffice informa a raiz)

self.addEventListener("install", function () { self.skipWaiting(); });
/* Conserto (2026-10-29): uma atualização da cópia pode ter guardado arquivos velhos do CDN do GitHub com o
   número novo. Estes arquivos saem da cópia (abrem do site) e a tela inicial oferece atualizar de novo. */
var REPARO = ["index.html", "inicio/offline.js", "inicio/lancador.js", "assets/home.css", "assets/gerenciador-app.js",
  "assets/icones-inkdos/editar-pdf.svg", "apps/editar-pdf/index.html", "idiomas/de.json", "idiomas/es.json", "idiomas/fr.json",
  "idiomas/ja.json", "idiomas/pt-BR.json", "idiomas/ru.json", "idiomas/zh-CN.json",
  "inkdos/apps/documents/io/external-viewer.js", "inkdos/apps/pdf/ui/edit-pdf-button.js",
  "inkdos/apps/presentations/io/external-viewer.js", "inkdos/apps/spreadsheets/io/external-viewer.js",
  "inkdos/assets/handoff.js", "inkdos/handoff.html", "visualizadores/viewers/bento-carry.js"];
function reparar() {
  var base = self.location.origin + RAIZ, marca = base + "__offline__/manifesto.json";
  return caches.open(CACHE).then(function (c) {
    return c.match(marca).then(function (r) { return r ? r.json() : null; }).then(function (m) {
      if (!m || m.reparo1) return;
      var fora = {}; REPARO.forEach(function (p) { fora[p] = 1; });
      m.grupos.forEach(function (g) { g.arquivos.forEach(function (a) { if (fora[a[0]]) a[2] = ""; }); });
      m.versao = "reparo"; m.reparo1 = true;
      return Promise.all(REPARO.map(function (p) { return c.delete(base + p); }))
        .then(function () { return c.put(marca, new Response(JSON.stringify(m), { headers: { "Content-Type": "application/json" } })); });
    });
  }).catch(function () {});
}
self.addEventListener("activate", function (e) { e.waitUntil(reparar().then(function () { return self.clients.claim(); })); });

/* A chave no cache é o caminho sem "?…"; uma pasta vira pasta/index.html. */
function chave(url) {
  var u = new URL(url);
  var p = u.pathname;
  if (p.endsWith("/")) p += "index.html";
  return u.origin + p;
}

/* Rede primeiro; a cópia offline só quando a rede falha. */
function daRedeOuCopia(req) {
  return fetch(req).catch(function (erro) {
    // a cópia offline ou o pacote de idioma (cache "inkdoshub-idioma", de assets/idioma.js)
    var k = chave(req.url || req);
    return caches.open(CACHE).then(function (c) { return c.match(k); }).then(function (r) {
      return r || caches.open("inkdoshub-idioma").then(function (c) { return c.match(k); });
    }).then(function (r) {
      if (r) return r;
      throw erro;
    });
  });
}

/* Com o modo offline instalado (botão "Offline" da tela inicial, inicio/offline.js), tudo o que está
   na cópia abre direto dela: o site só muda quando a pessoa pede para atualizar. */
var MARCA = self.location.origin + RAIZ + "__offline__/manifesto.json";
function daCopiaOuRede(req) {
  var k = chave(req.url);
  return caches.open(CACHE).then(function (c) {
    return c.match(MARCA).then(function (instalado) {
      if (!instalado) return daRedeOuCopia(req);
      return c.match(k).then(function (r) { return r || daRedeOuCopia(req); });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (req.headers.has("range")) return; // vídeo e áudio pedem pedaços; o navegador cuida disso
  if (u.pathname === RAIZ + "inicio/manifesto.json") return; // o botão Offline sempre compara com o site
  if (u.searchParams.has("inkoff")) return; // download da cópia offline: sempre do site

  e.respondWith(daCopiaOuRede(req));
});
