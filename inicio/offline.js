/* Home screen Offline mode: choose app by app what stays stored on this device.

   - "Offline" in ☰ opens an in-page panel (no pop-up) with each app, its size and a green check.
     Tapping an unchecked item downloads that app; tapping a checked one asks, on the page, whether it can be deleted.
   - The home screen and the light apps (under 1 MB each) are always stored along with the first app.
   - "Update" downloads only what changed in the stored items. With a new version, the home screen shows a notice at the bottom.
   - After using a heavy app that is not stored, the home screen offers to store it, with its size.
   Files live in the "inkdoshub-offline" cache (list in inicio/manifesto.json, groups from
   tools/portal_manifesto.py); the __offline__/manifesto.json marker keeps the version and the chosen groups.
   sw-portal.js opens what is stored from the copy, and the rest from the site. */
(function () {
  "use strict";
  var CACHE = "inkdoshub-offline";
  var BASE = new URL("./", location.href);
  // Isolation (SharedArrayBuffer, multithreading): sw-portal.js adds the headers to the apps on github.io (not to this page). Browsers without a
  // service worker (XeOS) cannot get it here, so ☰ shows the "Fast version" address, which sends the headers itself.
  var rapida = document.getElementById("linha-rapida");
  if (rapida && !self.crossOriginIsolated && !("serviceWorker" in navigator) && /github\.io$/.test(location.hostname)) rapida.hidden = false;
  var MARCA = new URL("__offline__/manifesto.json", BASE).href;
  var USO = new URL("__uso__", BASE).href;
  var LEVE = 1e6; // groups smaller than this always go along with the home screen
  var t = function (s, p) { return window.InkIdioma ? InkIdioma.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); };
  var btn = document.getElementById("btn-offline");
  // In the Windows app (windows/hub) apps live on the PC disk, checked by SHA-256: inkHubNativo does the work.
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

  /* Downloads one manifest entry and checks its SHA-256 (4th field) before it is stored, like the Windows app does.
  A file that does not match (stale CDN copy, broken download, changed in transit) is never stored.
  Files over 16 MB are checked one at a time, to keep memory low on iPhone. */
  var filaGrande = Promise.resolve();
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function baixarConferido(a) {
    function tarefa() {
      return fetch(chave(a[0]) + "?inkoff=" + a[2], { cache: "reload" }).then(function (r) {
        if (!r.ok) throw new Error(a[0]);
        var tipo = r.headers.get("Content-Type");
        return r.arrayBuffer().then(function (buf) {
          if (!a[3] || !(crypto.subtle && crypto.subtle.digest)) return buf;
          return crypto.subtle.digest("SHA-256", buf).then(function (h) {
            if (hex(h) !== a[3]) throw new Error(a[0] + ": SHA-256 mismatch");
            return buf;
          });
        }).then(function (buf) { return new Response(buf, { headers: tipo ? { "Content-Type": tipo } : {} }); });
      });
    }
    if (a[1] <= 16e6) return tarefa();
    var p = filaGrande.then(tarefa);
    filaGrande = p.catch(function () {});
    return p;
  }

  /* Leaves exactly the "ids" groups (plus the base) in the cache, at the site version. Downloads only what changed. */
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
      var i = 0, parou = false;
      function proximo() {
        if (parou || i >= fila.length) return Promise.resolve();
        var a = fila[i++];
        // "?inkoff=" + file number: a new address for each version, so the GitHub CDN does not serve the old one
        return baixarConferido(a).then(function (r) {
          return c.put(chave(a[0]), r);
        }).then(function () {
          if (parou) return;
          feito += a[1];
          if (progresso) progresso(Math.min(99, Math.floor(feito * 100 / Math.max(1, total))));
          return proximo();
        }, function (e) { parou = true; throw e; });
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
    // status line: says what is happening after each tap
    var status = el("p", "off-status", ""); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    caixa.appendChild(status);
    var dizer = function (txt, tipo) { status.textContent = txt; status.className = "off-status" + (tipo ? " " + tipo : ""); };
    // Windows app: button to update the app itself (the shell), besides the stored apps
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
            // confirm on the page itself (XeOS blocks pop-ups)
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

  /* ---------- new version notice ---------- */
  // only when something the person keeps changed (a change in an app that is not stored does not count)
  function mudou(m, n) {
    var tem = guardados(m), velho = {}, novo = {};
    m.grupos.forEach(function (g) { (g.arquivos || []).forEach(function (a) { velho[a[0]] = a[2]; }); });
    n.grupos.forEach(function (g) { if (tem[g.id] || base(g)) g.arquivos.forEach(function (a) { novo[a[0]] = a[2]; }); });
    var k;
    for (k in novo) if (velho[k] !== novo[k]) return true;
    for (k in velho) if (!(k in novo)) return true;
    return false;
  }
  var aviso = null;
  estado().then(function (m) {
    btn.setAttribute("aria-pressed", m ? "true" : "false");
    if (!m) return;
    site().then(function (n) {
      if (n.versao === m.versao || !mudou(m, n)) return;
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

  /* ---------- after using a heavy app that is not stored: offer to store it ---------- */
  var RECUSOU = "inkdoshub-offline-recusou";
  // "?guardar=<group>&volta=<page>": an app asks to store a group (e.g. Edit PDF › Expand)
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
