/* Service worker do portal offline do InkTerminal.

   Ele só é registrado pela área de trabalho (desktop/). A cópia offline é baixada pela própria
   página (desktop/offline.js) para o cache "inkterminal-offline"; este arquivo apenas serve essa
   cópia quando não há rede. Com rede, tudo vem do site normalmente, então uma versão nova do site
   nunca se mistura com arquivos antigos da cópia.

   As pastas com service worker próprio (o editor de vídeo, que usa coi-serviceworker) continuam
   com o delas, porque o navegador dá preferência ao escopo mais específico. */
"use strict";
var CACHE = "inkterminal-offline";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

/* A chave no cache é o caminho sem "?…"; uma pasta vira pasta/index.html. */
function chave(url) {
  var u = new URL(url);
  var p = u.pathname;
  if (p.endsWith("/")) p += "index.html";
  return u.origin + p;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (req.headers.has("range")) return; // vídeo e áudio pedem pedaços; o navegador cuida disso
  e.respondWith(
    fetch(req).catch(function (erro) {
      return caches.open(CACHE).then(function (c) { return c.match(chave(req.url)); }).then(function (r) {
        if (r) return r;
        throw erro;
      });
    })
  );
});
