/* O sistema do Wine (TinyCore15Wine11.0.zip, 215 MB) passa do limite de 100 MB por arquivo do
   GitHub, então ele fica em pedaços em fs/. Quando o Boxedwine pede o .zip, este arquivo entrega os
   pedaços juntos, como se fosse um arquivo só.

   Os pedaços ficam guardados no disco do aparelho (Cache Storage "inkterminal-wine"), então só a
   primeira abertura baixa os 215 MB; as outras leem do disco. A cópia offline da tela inicial
   ("inkterminal-offline") também serve. O sha256 de cada pedaço faz parte da chave, então uma
   versão nova do sistema é baixada de novo e a velha é apagada. */
(function () {
  "use strict";
  var CACHE = "inkterminal-wine";
  var PARTES = {
    "TinyCore15Wine11.0.zip": [
      ["TinyCore15Wine11.0.zip.part00", 94371840, "4c7cb6764f5080fa"],
      ["TinyCore15Wine11.0.zip.part01", 94371840, "e2239a9f92e97a83"],
      ["TinyCore15Wine11.0.zip.part02", 26338251, "a1537b1a084a4ea9"]
    ]
  };
  var original = window.fetch.bind(window);
  var status = document.getElementById("status");
  /* Textos: traduzidos pelo assets/idioma.js da página de fora (mesma origem). */
  var t = function (s, p) {
    try { var I = window.parent.InkIdioma; if (I) return I.t(s, p); } catch (_) {}
    return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m; }) : s;
  };
  function locale() { try { return window.parent.InkIdioma.atual; } catch (_) { return undefined; } }

  function avisar(recebido, total, doDisco) {
    var mb = { done: Math.round(recebido / 1e6).toLocaleString(locale()), total: Math.round(total / 1e6).toLocaleString(locale()) };
    var texto = doDisco ? t("Opening the Wine saved on this device… {done} of {total} MB", mb) : t("Downloading Wine… {done} of {total} MB", mb);
    if (status) status.textContent = texto;
    if (window.parent !== window) window.parent.postMessage({ tipo: "wine:progresso", recebido: recebido, total: total, disco: !!doDisco }, location.origin);
  }

  /* Procura o pedaço guardado: primeiro no cache do Wine, depois na cópia offline da tela inicial
     (que guarda pelo caminho sem "?"). Só aceita se o tamanho bate. */
  function guardado(url, chave, tamanho) {
    if (!("caches" in window)) return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(chave); })
      .then(function (r) { return r || caches.open("inkterminal-offline").then(function (c) { return c.match(url); }); })
      .then(function (r) { return r ? r.blob() : null; })
      .then(function (b) { return b && b.size === tamanho ? b : null; })
      .catch(function () { return null; });
  }

  /* Apaga do cache do Wine o que não é desta versão. */
  function limpar(validas) {
    if (!("caches" in window)) return;
    caches.open(CACHE).then(function (c) {
      return c.keys().then(function (ks) { ks.forEach(function (k) { if (validas.indexOf(k.url) < 0) c.delete(k); }); });
    }).catch(function () {});
  }

  window.fetch = function (entrada, opcoes) {
    var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
    var nome = url.split("?")[0].split("/").pop();
    var lista = PARTES[nome];
    if (!lista) return original(entrada, opcoes);
    var base = new URL(url, location.href);
    var total = lista.reduce(function (s, p) { return s + p[1]; }, 0);
    var feito = 0, baixou = false;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

    function pegar(p) {
      var u = new URL(p[0], base).href, chave = u + "?sha=" + p[2];
      return guardado(u, chave, p[1]).then(function (b) {
        if (b) { feito += p[1]; avisar(feito, total, !baixou); return { blob: b, chave: chave }; }
        baixou = true;
        return original(u, { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error(p[0] + ": " + r.status);
          var leitor = r.body.getReader(), pedacos = [];
          function ler() {
            return leitor.read().then(function (x) {
              if (x.done) return new Blob(pedacos);
              pedacos.push(x.value); feito += x.value.length; avisar(feito, total, false);
              return ler();
            });
          }
          return ler();
        }).then(function (blob) {
          if (blob.size !== p[1]) throw new Error(t("{file}: wrong size", { file: p[0] }));
          var guardar = "caches" in window ? caches.open(CACHE).then(function (c) {
            return c.put(chave, new Response(blob, { headers: { "Content-Type": "application/octet-stream" } }));
          }).catch(function () {}) : Promise.resolve();
          return guardar.then(function () { return { blob: blob, chave: chave }; });
        });
      });
    }

    var partes = [];
    var cadeia = Promise.resolve();
    lista.forEach(function (p) { cadeia = cadeia.then(function () { return pegar(p); }).then(function (x) { partes.push(x); }); });
    return cadeia.then(function () {
      limpar(partes.map(function (x) { return x.chave; }));
      return new Response(new Blob(partes.map(function (x) { return x.blob; })), { status: 200, headers: { "Content-Type": "application/zip" } });
    });
  };
})();
