/* Cópia offline: baixa todos os arquivos listados em manifesto.json para o cache do site.
   O download é feito pela página (e não pelo service worker), porque o Safari pode parar um
   service worker no meio de um download longo. Só os arquivos novos ou alterados são baixados. */
(function () {
  "use strict";
  var CACHE = "inkterminal-offline";
  var RAIZ = new URL("../", location.href);
  var CHAVE_MANIFESTO = RAIZ.origin + RAIZ.pathname + "__offline/manifesto.json";
  var estado = document.getElementById("offline-estado");
  var listaEl = document.getElementById("lista-offline");
  var btnBaixar = document.getElementById("baixar-tudo");
  var btnApagar = document.getElementById("apagar-offline");
  var rotulo = document.getElementById("offline-texto");
  var baixando = false;

  function mb(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(2).replace(".", ",") + " GB";
    if (b >= 1e6) return Math.round(b / 1e6) + " MB";
    return Math.max(1, Math.round(b / 1e3)) + " KB";
  }
  function urlDe(rel) { return new URL(rel, RAIZ).href; }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("../sw-portal.js", { scope: "../" }).catch(function () {});
  }

  function lerManifesto() {
    return fetch("manifesto.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("manifesto");
      return r.json();
    });
  }
  function instalado() {
    if (!("caches" in window)) return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match(CHAVE_MANIFESTO); })
      .then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
  }

  function mapa(m) {
    var o = {};
    if (m) m.grupos.forEach(function (g) { g.arquivos.forEach(function (a) { o[a[0]] = a[2]; }); });
    return o;
  }

  function desenhar(novo, velho) {
    var tem = mapa(velho);
    listaEl.innerHTML = "";
    var faltaTotal = 0;
    novo.grupos.forEach(function (g) {
      var falta = g.arquivos.filter(function (a) { return tem[a[0]] !== a[2]; });
      var bytes = falta.reduce(function (s, a) { return s + a[1]; }, 0);
      faltaTotal += bytes;
      var li = document.createElement("li");
      li.innerHTML = "<span></span><small></small>";
      li.firstChild.textContent = g.nome;
      li.lastChild.textContent = !falta.length ? "guardado (" + mb(g.bytes) + ")" :
        falta.length === g.arquivos.length ? "falta baixar " + mb(g.bytes) : "atualizar " + mb(bytes);
      li.className = falta.length ? "" : "ok";
      listaEl.appendChild(li);
    });
    var completo = faltaTotal === 0;
    rotulo.textContent = completo ? "Offline pronto" : velho ? "Atualizar" : "Offline";
    document.getElementById("btn-offline").classList.toggle("pronto", completo);
    btnBaixar.textContent = completo ? "Tudo guardado" : velho ? "Atualizar cópia (" + mb(faltaTotal) + ")" : "Baixar tudo (" + mb(faltaTotal) + ")";
    btnBaixar.disabled = completo || baixando;
    btnApagar.disabled = !velho || baixando;
    if (!baixando) {
      estado.textContent = completo ? "A cópia completa está neste aparelho. Tudo abre sem internet." :
        velho ? "Há uma versão nova do InkTerminal. Atualize a cópia para usá-la sem internet." :
        "Ainda não há cópia neste aparelho.";
    }
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (e) {
        if (!baixando && e && e.quota) estado.textContent += " Espaço usado pelo site: " + mb(e.usage || 0) + ".";
      });
    }
  }

  function atualizarTela() {
    return Promise.all([lerManifesto(), instalado()]).then(function (r) { desenhar(r[0], r[1]); return r; })
      .catch(function () { estado.textContent = "Sem internet e sem cópia neste aparelho."; });
  }

  function baixarTudo() {
    if (baixando || !("caches" in window)) return;
    baixando = true;
    btnBaixar.disabled = btnApagar.disabled = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    Promise.all([lerManifesto(), instalado(), caches.open(CACHE)]).then(function (r) {
      var novo = r[0], tem = mapa(r[1]), cache = r[2];
      var fila = [];
      var validos = {};
      novo.grupos.forEach(function (g) { g.arquivos.forEach(function (a) {
        validos[urlDe(a[0])] = 1;
        if (tem[a[0]] !== a[2]) fila.push(a);
      }); });
      var total = fila.reduce(function (s, a) { return s + a[1]; }, 0), feito = 0, erros = 0, i = 0;
      function mostrar() { estado.textContent = "Baixando… " + mb(feito) + " de " + mb(total) + (erros ? " (" + erros + " falhas)" : ""); }
      function proximo() {
        if (i >= fila.length) return Promise.resolve();
        var a = fila[i++];
        // "reload" pula o cache HTTP do navegador, para não guardar uma versão velha do arquivo
        return fetch(urlDe(a[0]), { cache: "reload" }).then(function (resp) {
          if (!resp.ok) throw new Error(resp.status);
          return cache.put(urlDe(a[0]), resp);
        }).then(function () { feito += a[1]; mostrar(); }, function () { erros++; mostrar(); }).then(proximo);
      }
      mostrar();
      var trabalhadores = [];
      for (var k = 0; k < 6; k++) trabalhadores.push(proximo());
      return Promise.all(trabalhadores).then(function () {
        // apaga arquivos que saíram do site
        return cache.keys().then(function (ks) {
          return Promise.all(ks.map(function (req) {
            if (req.url !== CHAVE_MANIFESTO && !validos[req.url]) return cache.delete(req);
          }));
        });
      }).then(function () {
        if (erros) {
          estado.textContent = erros + " arquivos não foram baixados. Toque em Baixar de novo para tentar só eles.";
          // guarda o manifesto só com o que deu certo, para a próxima vez baixar o resto
          return Promise.all(fila.map(function (a) { return cache.match(urlDe(a[0])).then(function (r) { if (!r) a[2] = "falta"; }); }))
            .then(function () { return cache.put(CHAVE_MANIFESTO, new Response(JSON.stringify(novo), { headers: { "content-type": "application/json" } })); });
        }
        return cache.put(CHAVE_MANIFESTO, new Response(JSON.stringify(novo), { headers: { "content-type": "application/json" } }));
      });
    }).catch(function () {
      estado.textContent = "Não deu para baixar agora. Confira a internet e tente de novo.";
    }).then(function () {
      var msg = estado.textContent;
      baixando = false;
      return atualizarTela().then(function () { if (/não|falha/i.test(msg)) estado.textContent = msg; });
    });
  }

  function apagar() {
    if (baixando) return;
    caches.delete(CACHE).then(atualizarTela);
  }

  btnBaixar.addEventListener("click", baixarTudo);
  btnApagar.addEventListener("click", apagar);
  window.InkOffline = { atualizar: atualizarTela };
  atualizarTela();
})();
