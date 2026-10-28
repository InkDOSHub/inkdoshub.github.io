/* Service worker do portal offline do InkDOS Hub.

   Ele é registrado pela tela inicial (inicio/offline.js). Sem o modo offline, tudo vem do site e o cache
   só serve quando não há rede. Com o modo offline instalado, a cópia inteira vem primeiro. */
"use strict";
var CACHE = "inkdoshub-offline";
var RAIZ = self.INK_RAIZ || new URL("./", self.location.href).pathname; // "/" no GitHub Pages (o editor do OnlyOffice informa a raiz)

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

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

  e.respondWith(daCopiaOuRede(req));
});
