// Cópia no InkDOS Hub: o service worker do editor (cache próprio, caminhos da raiz do site original)
// foi trocado pelo do InkDOS Hub, que usa a rede primeiro e a cópia offline da tela inicial.

// Os arquivos do OnlyOffice (motor, telas, fontes) não mudam entre versões do site: ficam guardados
// no aparelho e abrem direto daqui. Ao atualizar o OnlyOffice, troque a versão abaixo.
var OO_CACHE = "inkdoshub-onlyoffice-v1";
var OO_BASE = new URL("./", self.location.href).pathname;
var OO_FIXOS = /^(sdkjs|web-apps|fonts|ran-fonts|libs|img|assets)\/|^(themes|plugins)\.json$|^ran-tokens\.[0-9a-f]+\.css$/;

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("inkdoshub-onlyoffice-") === 0 && k !== OO_CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin || u.pathname.indexOf(OO_BASE) !== 0) return;
  if (!OO_FIXOS.test(u.pathname.slice(OO_BASE.length))) return;
  var chave = u.origin + u.pathname;
  e.stopImmediatePropagation();
  e.respondWith(caches.open(OO_CACHE).then(function (c) {
    return c.match(chave).then(function (r) {
      if (r) return r;
      return fetch(req).then(function (resp) {
        if (resp && resp.status === 200 && resp.type === "basic") c.put(chave, resp.clone());
        return resp;
      });
    });
  }));
});

importScripts("../sw-portal.js");
