/* InkDOS Hub offline portal service worker.

   It is registered by the home screen (inicio/offline.js). Without offline mode, everything comes from the site and the cache
   is only used when there is no network. With offline mode installed, the whole copy comes first. */
"use strict";
var CACHE = "inkdoshub-offline";
var RAIZ = self.INK_RAIZ || new URL("./", self.location.href).pathname; // "/" no GitHub Pages

self.addEventListener("install", function () { self.skipWaiting(); });
/* Repair (2026-10-29): an update of the copy may have stored old files from the GitHub CDN with the
   new number. These files leave the copy (open from the site) and the home screen offers to update again. */
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

/* The cache key is the path without "?…"; a folder becomes folder/index.html. */
function chave(url) {
  var u = new URL(url);
  var p = u.pathname;
  if (p.endsWith("/")) p += "index.html";
  return u.origin + p;
}

/* Network first; the offline copy only when the network fails. */
function daRedeOuCopia(req) {
  return fetch(req).catch(function (erro) {
    // the offline copy or the language pack ("inkdoshub-idioma" cache, from assets/idioma.js)
    var k = chave(req.url || req);
    return caches.open(CACHE).then(function (c) { return c.match(k); }).then(function (r) {
      return r || caches.open("inkdoshub-idioma").then(function (c) { return c.match(k); });
    }).then(function (r) {
      if (r) return r;
      throw erro;
    });
  });
}

/* With offline mode installed (home screen "Offline" button, inicio/offline.js), what is stored
   opens straight from the copy (the site only changes when the person asks to update); what is not comes from the site. */
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
  if (req.headers.has("range")) return; // video and audio request ranges; the browser handles it
  if (u.pathname === RAIZ + "inicio/manifesto.json") return; // the Offline button always compares with the site
  if (u.searchParams.has("inkoff")) return; // offline copy download: always from the site

  // the home screen (inicio/offline.js) offers to store the last opened app, if not stored yet
  if (req.mode === "navigate") {
    var caminho = chave(req.url).slice((self.location.origin + RAIZ).length);
    if (caminho !== "index.html") e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(self.location.origin + RAIZ + "__uso__", new Response(caminho)); }).catch(function () {}));
  }
  e.respondWith(daCopiaOuRede(req).then(isolar));
});

/* Compatibility layer for GitHub Pages, which cannot send headers: adds the same isolation headers as the
   fast address (_headers), so the page gets SharedArrayBuffer and the multithread builds turn on. */
function isolar(r) {
  if (!r || !r.status || r.type === "opaque" || r.type === "opaqueredirect") return r;
  var h = new Headers(r.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
