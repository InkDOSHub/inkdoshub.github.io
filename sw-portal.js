/* Service worker do portal offline do InkTerminal.

   Ele é registrado pela área de trabalho (desktop/) e pelo Office (apps/office/). A cópia offline é
   baixada pela própria página (desktop/offline.js) para o cache "inkterminal-offline"; este arquivo
   apenas serve essa cópia quando não há rede. Com rede, tudo vem do site normalmente, então uma
   versão nova do site nunca se mistura com arquivos antigos da cópia.

   Em apps/office/ ele também:
   - acrescenta os headers COOP/COEP, que ligam o modo isolado (SharedArrayBuffer) de que o
     LibreOffice precisa e que o GitHub Pages não manda;
   - entrega soffice.wasm e soffice.data descompactados a partir dos .gz guardados no site
     (os originais passam do limite de 100 MB por arquivo do GitHub).
   Os headers não são postos em nenhuma outra pasta: o Código (VS Code) quebra com eles.

   O editor de vídeo (apps/video/editor/) tem o coi-serviceworker dele; este service worker nunca
   intercepta essa pasta. */
"use strict";
var CACHE = "inkterminal-offline";
var RAIZ = new URL("./", self.location.href).pathname; // "/" no GitHub Pages
var OFFICE = RAIZ + "apps/office/";
var COMPACTADOS = { "soffice.wasm": "application/wasm", "soffice.data": "application/octet-stream" };

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
    return caches.open(CACHE).then(function (c) { return c.match(chave(req.url || req)); }).then(function (r) {
      if (r) return r;
      throw erro;
    });
  });
}

function isolar(resp, tipo) {
  var h = new Headers(resp.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  if (tipo) { h.set("Content-Type", tipo); h.delete("Content-Length"); h.delete("Content-Encoding"); }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.indexOf(RAIZ + "apps/video/editor/") === 0) return; // tem o coi-serviceworker dele (COOP/COEP)
  if (req.headers.has("range")) return; // vídeo e áudio pedem pedaços; o navegador cuida disso

  if (u.pathname.indexOf(OFFICE) === 0) {
    var nome = u.pathname.slice(OFFICE.length);
    if (COMPACTADOS[nome]) {
      e.respondWith(daRedeOuCopia(new Request(OFFICE + nome + ".gz")).then(function (r) {
        if (!r.ok) return r;
        var corpo = r.body.pipeThrough(new DecompressionStream("gzip"));
        return isolar(new Response(corpo, { status: 200, headers: r.headers }), COMPACTADOS[nome]);
      }));
      return;
    }
    e.respondWith(daRedeOuCopia(req).then(function (r) { return isolar(r); }));
    return;
  }
  e.respondWith(daRedeOuCopia(req));
});
