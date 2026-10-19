/* Service worker do portal offline do InkTerminal.

   Ele é registrado pela tela inicial. A cópia offline é
   baixada pela própria página (inicio/offline.js) para o cache "inkterminal-offline"; este arquivo
   apenas serve essa cópia quando não há rede. Com rede, tudo vem do site normalmente, então uma
   versão nova do site nunca se mistura com arquivos antigos da cópia. */
"use strict";
var CACHE = "inkterminal-offline";
var RAIZ = new URL("./", self.location.href).pathname; // "/" no GitHub Pages

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
    // a cópia offline ou o pacote de idioma (cache "inkterminal-idioma", de assets/idioma.js)
    var k = chave(req.url || req);
    return caches.open(CACHE).then(function (c) { return c.match(k); }).then(function (r) {
      return r || caches.open("inkterminal-idioma").then(function (c) { return c.match(k); });
    }).then(function (r) {
      if (r) return r;
      throw erro;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (req.headers.has("range")) return; // vídeo e áudio pedem pedaços; o navegador cuida disso

  e.respondWith(daRedeOuCopia(req));
});
