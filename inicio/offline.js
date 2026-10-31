/* Modo Offline da tela inicial: escolher app por app o que fica guardado neste aparelho.

   - "Offline" no ☰ abre um painel na página (sem pop-up) com cada app, o tamanho e um check verde.
     Tocar num item não marcado baixa aquele app; tocar num marcado pergunta, na própria página, se pode apagar.
   - A tela inicial e os apps leves (menos de 1 MB cada) ficam sempre guardados junto com o primeiro app.
   - "Atualizar" baixa só o que mudou nos itens guardados. Com versão nova, a tela inicial avisa embaixo.
   - Depois de usar um app pesado que não está guardado, a tela inicial oferece guardá-lo, com o tamanho.
   Os arquivos ficam no cache "inkdoshub-offline" (lista em inicio/manifesto.json, grupos de
   tools/portal_manifesto.py); a marca __offline__/manifesto.json guarda a versão e os grupos escolhidos.
   O sw-portal.js abre da cópia o que estiver guardado e o resto do site. */
(function () {
  "use strict";
  var CACHE = "inkdoshub-offline";
  var BASE = new URL("./", location.href);
  var MARCA = new URL("__offline__/manifesto.json", BASE).href;
  var USO = new URL("__uso__", BASE).href;
  var LEVE = 1e6; // grupos menores que isto vão sempre junto com a tela inicial
  var t = function (s, p) { return window.InkIdioma ? InkIdioma.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  var btn = document.getElementById("btn-offline");
  // No app do Windows (windows/hub) os apps ficam no disco do PC, conferidos pelo SHA-256: inkHubNativo faz o trabalho.
  var N = window.inkHubNativo || null;
  if (!btn || (!N && (!("caches" in window) || !("serviceWorker" in navigator)))) { if (btn) btn.closest(".menu-offline").hidden = true; return; }
  var info = btn.querySelector("small");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw-portal.js", { scope: "./" }).catch(function () {});

  var chave = function (p) { return new URL(p, BASE).href; };
  var mb = function (b) { return b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.max(0.1, b / 1e6).toFixed(b < 1e7 ? 1 : 0) + " MB"; };
  var base = function (g) { return g.id === "inicio" || g.bytes < LEVE; };

  function estado() {
    if (N) return N.estado().catch(function () { return null; });
    return caches.open(CACHE).then(function (c) { return c.match(MARCA); }).then(function (r) { return r ? r.json() : null; }).catch(function () { return null; });
  }
  function site() {
    return fetch(chave("inicio/manifesto.json"), { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  }
  function guardados(m) { var s = {}; if (m) m.grupos.forEach(function (g) { s[g.id] = 1; }); return s; }

  /* Deixa no cache exatamente os grupos de "ids" (mais a base), na versão do site. Baixa só o que mudou. */
  var ocupado = false;
  function sincronizar(ids, progresso) {
    if (ocupado) return Promise.reject(new Error("ocupado"));
    ocupado = true;
    if (N) return N.sincronizar(Object.keys(ids).filter(function (k) { return k !== "__base"; }), progresso).then(site)
      .then(function (r) { ocupado = false; return r; }, function (e) { ocupado = false; throw e; });
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
    return Promise.all([site(), estado(), caches.open(CACHE)]).then(function (x) {
      var novo = x[0], velho = x[1], c = x[2], antes = {};
      if (velho) velho.grupos.forEach(function (g) { g.arquivos.forEach(function (a) { antes[a[0]] = a[2]; }); });
      var grupos = novo.grupos.filter(function (g) { return ids[g.id] || base(g); });
      if (!grupos.some(function (g) { return !base(g); }) && !ids.__base) grupos = [];
      var todos = {}, fila = [], total = 0, feito = 0;
      grupos.forEach(function (g) { g.arquivos.forEach(function (a) { todos[chave(a[0])] = 1; if (antes[a[0]] !== a[2]) { fila.push(a); total += a[1]; } }); });
      var i = 0;
      function proximo() {
        if (i >= fila.length) return Promise.resolve();
        var a = fila[i++];
        // "?inkoff=" + número do arquivo: endereço novo a cada versão, então o CDN do GitHub não entrega a antiga
        return fetch(chave(a[0]) + "?inkoff=" + a[2], { cache: "reload" }).then(function (r) {
          if (!r.ok) throw new Error(a[0]);
          return c.put(chave(a[0]), r);
        }).then(function () {
          feito += a[1];
          if (progresso) progresso(Math.min(99, Math.floor(feito * 100 / Math.max(1, total))));
          return proximo();
        });
      }
      return Promise.all([proximo(), proximo(), proximo(), proximo(), proximo(), proximo()])
        .then(function () { return c.keys(); })
        .then(function (ks) { return Promise.all(ks.filter(function (k) { return !todos[k.url] && k.url !== MARCA && k.url !== USO; }).map(function (k) { return c.delete(k); })); })
        .then(function () {
          if (!grupos.length) return c.delete(MARCA);
          var marca = { versao: novo.versao, grupos: grupos };
          return c.put(MARCA, new Response(JSON.stringify(marca), { headers: { "Content-Type": "application/json" } }));
        })
        .then(function () { return novo; });
    }).then(function (r) { ocupado = false; return r; }, function (e) { ocupado = false; throw e; });
  }

  /* ---------- painel ---------- */
  var painel = null;
  function el(tag, cls, texto) { var e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; }
  function fecharPainel() { if (painel) { painel.remove(); painel = null; } }
  function abrirPainel() {
    var menu = document.getElementById("menu-inicio"); if (menu) menu.open = false;
    fecharPainel();
    painel = el("div", "off-fundo");
    var caixa = el("div", "off-painel"); caixa.setAttribute("role", "dialog"); caixa.setAttribute("aria-label", "Offline");
    var topo = el("div", "off-topo");
    topo.appendChild(el("strong", null, "Offline"));
    var fechar = el("button", "off-x", "✕"); fechar.type = "button"; fechar.setAttribute("aria-label", t("Close")); fechar.onclick = fecharPainel;
    topo.appendChild(fechar);
    caixa.appendChild(topo);
    caixa.appendChild(el("p", "off-ajuda", t("Save apps on this device to use them without internet. Tap an item to save it; tap it again to remove it.")));
    var atualizar = el("button", "off-atualizar", t("Update")); atualizar.type = "button";
    caixa.appendChild(atualizar);
    // linha de status: diz o que está acontecendo depois de cada toque
    var status = el("p", "off-status", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    caixa.appendChild(status);
    var dizer = function (txt, tipo) { status.textContent = txt; status.className = "off-status" + (tipo ? " " + tipo : ""); };
    // app do Windows: botão para atualizar o próprio app (a carcaça), além dos apps guardados
    if (N && N.atualizarApp) {
      var app = el("button", "off-atualizar off-app", t("Update the Windows app")); app.type = "button";
      caixa.appendChild(app);
      N.versao().then(function (v) { app.textContent = t("Update the Windows app") + " · " + v; }).catch(function () {});
      app.onclick = function () {
        app.disabled = true; dizer(t("Checking for updates…"));
        N.atualizarApp(function (p) { dizer(t("Downloading the new app… {pct}%", { pct: p })); }).then(function (r) {
          if (r === "pronto") dizer(t("Installing the new app… it reopens by itself."), "ok");
          else if (r === "atual") { dizer(t("The Windows app is up to date") + " ✓", "ok"); app.disabled = false; }
          else { dizer(t("Failed, try again"), "erro"); app.disabled = false; }
        }, function () { dizer(t("Failed, try again"), "erro"); app.disabled = false; });
      };
    }
    var espaco = el("p", "off-espaco", "");
    caixa.appendChild(espaco);
    var lista = el("div", "off-lista", "…");
    caixa.appendChild(lista);
    painel.appendChild(caixa);
    painel.addEventListener("click", function (e) { if (e.target === painel) fecharPainel(); });
    document.body.appendChild(painel);

    function contar() {
      if (N) {
        N.espaco().then(function (s) { espaco.textContent = t("On this PC: {used}. Free: {free}.", { used: mb(s.usado || 0), free: mb(s.livre || 0) }); }).catch(function () {});
        return;
      }
      if (!navigator.storage || !navigator.storage.estimate) return;
      navigator.storage.estimate().then(function (s) {
        espaco.textContent = t("Used in this browser: {used}. Free: {free}.", { used: mb(s.usage || 0), free: mb(Math.max(0, (s.quota || 0) - (s.usage || 0))) });
      }).catch(function () {});
    }
    function desenhar() {
      Promise.all([site(), estado()]).then(function (x) {
        var novo = x[0], tem = guardados(x[1]);
        lista.textContent = ""; lista.classList.remove("off-travada");
        var leves = novo.grupos.filter(base), soma = leves.reduce(function (s, g) { return s + g.bytes; }, 0);
        var linhaBase = el("div", "off-item off-fixo");
        linhaBase.appendChild(el("span", "off-check" + (x[1] ? " on" : ""), "✓"));
        linhaBase.appendChild(el("span", "off-nome", t("Home screen and light apps")));
        linhaBase.appendChild(el("small", null, mb(soma) + " · " + t("always saved")));
        lista.appendChild(linhaBase);
        novo.grupos.filter(function (g) { return !base(g); }).forEach(function (g) {
          var item = el("button", "off-item"); item.type = "button";
          item.appendChild(el("span", "off-check" + (tem[g.id] ? " on" : ""), "✓"));
          item.appendChild(el("span", "off-nome", t(g.nome)));
          var tam = el("small", null, mb(g.bytes)); item.appendChild(tam);
          item.onclick = function () {
            if (ocupado) { dizer(t("Wait for the current download to finish."), "erro"); return; }
            if (!tem[g.id]) {
              var quer = Object.assign({}, tem); quer[g.id] = 1;
              var nome = t(g.nome);
              lista.classList.add("off-travada"); item.classList.add("off-baixando");
              tam.textContent = "0%"; dizer(t("Saving {name}… {pct}%", { name: nome, pct: 0 }));
              sincronizar(quer, function (p) {
                tam.textContent = p + "%"; item.style.setProperty("--p", p + "%");
                dizer(t("Saving {name}… {pct}%", { name: nome, pct: p }));
              }).then(function () { dizer(t("{name} saved ✓", { name: nome }), "ok"); desenhar(); },
                function () { lista.classList.remove("off-travada"); item.classList.remove("off-baixando"); tam.textContent = mb(g.bytes); dizer(t("Failed, try again"), "erro"); }).then(contar);
              return;
            }
            // confirmar na própria página (o XeOS bloqueia pop-ups)
            var conf = el("div", "off-conf");
            conf.appendChild(el("span", null, t("Remove {name} from this device? ({size})", { name: t(g.nome), size: mb(g.bytes) })));
            var nao = el("button", "off-nao", t("Cancel")); nao.type = "button";
            var sim = el("button", "off-sim", t("Remove")); sim.type = "button";
            nao.onclick = function () { conf.remove(); dizer(""); };
            sim.onclick = function () {
              var quer = Object.assign({}, tem); delete quer[g.id];
              sim.disabled = nao.disabled = true; sim.textContent = "…";
              dizer(t("Removing…"));
              sincronizar(quer).then(function () { dizer(t("{name} removed", { name: t(g.nome) }), "ok"); desenhar(); },
                function () { dizer(t("Failed, try again"), "erro"); desenhar(); }).then(contar);
            };
            conf.appendChild(nao); conf.appendChild(sim);
            var velha = lista.querySelector(".off-conf"); if (velha) velha.remove();
            item.after(conf);
          };
          lista.appendChild(item);
        });
      }).catch(function () { lista.textContent = t("Failed, try again"); });
    }
    atualizar.onclick = function () {
      if (ocupado) { dizer(t("Wait for the current download to finish."), "erro"); return; }
      atualizar.disabled = true; atualizar.textContent = "…"; dizer(t("Checking for updates…"));
      estado().then(function (m) {
        var quer = guardados(m); quer.__base = 1;
        return sincronizar(quer, function (p) { atualizar.textContent = t("Update") + " " + p + "%"; });
      }).then(function () { atualizar.textContent = t("Update"); dizer(t("Up to date") + " ✓", "ok"); marcarBotao(); if (aviso) { aviso.remove(); aviso = null; } desenhar(); },
        function () { atualizar.textContent = t("Update"); dizer(t("Failed, try again"), "erro"); }).then(function () { atualizar.disabled = false; contar(); });
    };
    desenhar(); contar();
  }

  function marcarBotao() { estado().then(function (m) { btn.setAttribute("aria-pressed", m ? "true" : "false"); }); }
  btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); abrirPainel(); });

  /* ---------- aviso de versão nova ---------- */
  var aviso = null;
  estado().then(function (m) {
    btn.setAttribute("aria-pressed", m ? "true" : "false");
    if (!m) return;
    site().then(function (n) {
      if (n.versao === m.versao) return;
      info.textContent = t("Update available");
      aviso = el("button", "aviso-atualizar", t("Update available") + " · " + t("Update")); aviso.type = "button";
      aviso.addEventListener("click", function () {
        aviso.disabled = true; aviso.textContent = "…";
        var quer = guardados(m); quer.__base = 1;
        sincronizar(quer, function (p) { aviso.textContent = t("Update") + " " + p + "%"; })
          .then(function () { location.reload(); }, function () { aviso.disabled = false; aviso.textContent = t("Failed, try again"); });
      });
      document.body.appendChild(aviso);
    }).catch(function () {});
  });

  /* ---------- depois de usar um app pesado não guardado: oferecer guardar ---------- */
  var RECUSOU = "inkdoshub-offline-recusou";
  // "?guardar=<grupo>&volta=<página>": um app pede para guardar um grupo (ex.: Editar PDF › Ampliar)
  var pede = new URLSearchParams(location.search), PEDIDO = pede.get("guardar"), VOLTA = pede.get("volta");
  (PEDIDO ? Promise.resolve(null) : caches.open(CACHE).then(function (c) {
    return c.match(USO).then(function (r) { if (!r) return null; c.delete(USO); return r.text(); });
  })).then(function (caminho) {
    if (!caminho && !PEDIDO) return;
    return Promise.all([site(), estado()]).then(function (x) {
      var tem = guardados(x[1]), recusou = {};
      try { recusou = JSON.parse(localStorage.getItem(RECUSOU) || "{}"); } catch (_) {}
      var g = x[0].grupos.filter(function (g) { return !base(g) && (PEDIDO ? g.id === PEDIDO : g.arquivos.some(function (a) { return a[0] === caminho; })); })[0];
      if (!g || tem[g.id] || (recusou[g.id] && !PEDIDO)) return;
      var card = el("div", "off-oferta"); card.setAttribute("role", "status");
      card.appendChild(el("strong", null, t("Keep {name} on this device?", { name: t(g.nome) })));
      card.appendChild(el("p", null, t("It takes {size}. Without saving, it is downloaded again whenever the browser clears its cache, and it does not open without internet.", { size: mb(g.bytes) })));
      var nao = el("button", "off-nao", t("Not now")); nao.type = "button";
      var sim = el("button", "off-sim", t("Keep")); sim.type = "button";
      nao.onclick = function () { recusou[g.id] = 1; try { localStorage.setItem(RECUSOU, JSON.stringify(recusou)); } catch (_) {} card.remove(); };
      sim.onclick = function () {
        sim.disabled = nao.disabled = true;
        var quer = Object.assign({}, tem); quer[g.id] = 1;
        sincronizar(quer, function (p) { sim.textContent = p + "%"; }).then(function () { card.remove(); marcarBotao(); if (VOLTA && /^apps\/[a-z-]+\/$/.test(VOLTA)) location.href = VOLTA; }, function () { sim.disabled = nao.disabled = false; sim.textContent = t("Failed, try again"); });
      };
      var botoes = el("div", "off-botoes"); botoes.appendChild(nao); botoes.appendChild(sim); card.appendChild(botoes);
      document.body.appendChild(card);
    });
  }).catch(function () {});
})();
