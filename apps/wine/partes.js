/* O sistema do Wine (TinyCore15Wine11.0.zip, 206 MB) passa do limite de 100 MB por arquivo do
   GitHub, então ele fica em pedaços em fs/. Quando o Boxedwine pede o .zip, este arquivo baixa os
   pedaços e entrega tudo junto, como se fosse um arquivo só. */
(function () {
  "use strict";
  var PARTES = {
    "TinyCore15Wine11.0.zip": ["TinyCore15Wine11.0.zip.part00", "TinyCore15Wine11.0.zip.part01", "TinyCore15Wine11.0.zip.part02"]
  };
  var TAMANHO = 215081931;
  var original = window.fetch.bind(window);
  window.fetch = function (entrada, opcoes) {
    var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
    var nome = url.split("?")[0].split("/").pop();
    var lista = PARTES[nome];
    if (!lista) return original(entrada, opcoes);
    var base = new URL(url, location.href);
    var recebido = 0;
    var status = document.getElementById("status");
    function avisar() {
      if (status) status.textContent = "Baixando o Wine… " + Math.round(recebido / 1e6) + " de " + Math.round(TAMANHO / 1e6) + " MB";
      if (window.parent !== window) window.parent.postMessage({ tipo: "wine:progresso", recebido: recebido, total: TAMANHO }, location.origin);
    }
    function baixar(parte) {
      return original(new URL(parte, base).href).then(function (r) {
        if (!r.ok) throw new Error(parte + ": " + r.status);
        var leitor = r.body.getReader(), pedacos = [];
        function ler() {
          return leitor.read().then(function (p) {
            if (p.done) return new Blob(pedacos);
            pedacos.push(p.value); recebido += p.value.length; avisar();
            return ler();
          });
        }
        return ler();
      });
    }
    var blobs = [];
    var cadeia = Promise.resolve();
    lista.forEach(function (parte) { cadeia = cadeia.then(function () { return baixar(parte); }).then(function (b) { blobs.push(b); }); });
    return cadeia.then(function () {
      return new Response(new Blob(blobs), { status: 200, headers: { "Content-Type": "application/zip" } });
    });
  };
})();
