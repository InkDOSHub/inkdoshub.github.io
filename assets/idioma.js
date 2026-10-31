/* Idioma do InkDOS Hub.

   Só o inglês vem no site. Cada outro idioma é um pacote opcional, baixado quando a pessoa escolhe:
   a tradução da tela inicial e dos apps (idiomas/<código>.json), mais os arquivos de idioma dos
   apps do Quadro e do InkDOS. Fica um pacote por vez: escolher outro apaga
   o anterior do aparelho.

   - Os textos da casca ficam em localStorage "inkdoshub-idioma-textos" (só o idioma escolhido),
     para a página já abrir traduzida.
   - Os arquivos do pacote ficam no cache "inkdoshub-idioma"; o service worker (sw-portal.js)
     serve esse cache quando não há rede.
   - A lista de arquivos e tamanhos de cada pacote vem de inicio/manifesto.json (chave "idiomas"),
     gerada por tools/portal_manifesto.py.

   Nas páginas: <body data-idioma> traduz o texto fixo do HTML (e os atributos title, aria-label,
   placeholder e alt). Textos montados no JavaScript usam InkIdioma.t("English text {x}", {x: 1}).
   Elementos com data-idioma-nao (nomes de arquivos, conteúdo da pessoa) nunca são traduzidos. */
(function () {
  "use strict";
  if (window.InkIdioma) return;

  var CHAVE = "inkdoshub-idioma";
  var CHAVE_TEXTOS = "inkdoshub-idioma-textos";
  var CACHE = "inkdoshub-idioma";
  var script = document.currentScript;
  var RAIZ = new URL("../", script ? script.src : location.href);

  var IDIOMAS = [
    { codigo: "en", nome: "English" },
    { codigo: "pt-BR", nome: "Português" },
    { codigo: "es", nome: "Español" },
    { codigo: "de", nome: "Deutsch" },
    { codigo: "fr", nome: "Français" },
    { codigo: "zh-CN", nome: "中文（简体）" },
    { codigo: "ja", nome: "日本語" },
    { codigo: "ru", nome: "Русский" },
  ];
  // o mesmo idioma no nome que cada ferramenta usa
  var EXCALIDRAW = { en: "en", "pt-BR": "pt-BR", es: "es-ES", de: "de-DE", fr: "fr-FR", "zh-CN": "zh-CN", ja: "ja-JP", ru: "ru-RU" };

  function ler(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function valido(c) { return IDIOMAS.some(function (i) { return i.codigo === c; }); }
  function nomeDe(c) { var i = IDIOMAS.filter(function (x) { return x.codigo === c; })[0]; return i ? i.nome : c; }

  var atual = "en", textos = {}, info = null;
  function carregar() {
    atual = "en"; textos = {}; info = null;
    var c = ler(CHAVE);
    if (!c || c === "en" || !valido(c)) return;
    try {
      var p = JSON.parse(ler(CHAVE_TEXTOS) || "null");
      if (p && p.codigo === c && p.textos) { atual = c; textos = p.textos; info = p; }
    } catch (_) {}
  }
  carregar();
  document.documentElement.lang = atual;

  function t(s, p) {
    var v = Object.prototype.hasOwnProperty.call(textos, s) ? textos[s] : s;
    if (p) v = String(v).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m; });
    return v;
  }

  /* Texto fixo das páginas: guarda o original em inglês para poder trocar de idioma de novo. */
  var ATRIBUTOS = ["title", "aria-label", "placeholder", "alt"];
  var originais = new WeakMap();
  var PULAR = "script,style,textarea,[data-idioma-nao]";
  function traduzirTexto(orig) {
    var m = orig.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m || !m[2]) return orig;
    return m[1] + t(m[2]) + m[3];
  }
  function aplicar(raiz) {
    raiz = raiz || document.body;
    if (!raiz) return;
    var lista = raiz.matches && raiz.matches("[data-idioma]") ? [raiz] : [];
    Array.prototype.push.apply(lista, raiz.querySelectorAll ? raiz.querySelectorAll("[data-idioma]") : []);
    lista.forEach(function (r) {
      var w = document.createTreeWalker(r, 4), n;
      while ((n = w.nextNode())) {
        var pai = n.parentElement;
        if (!pai || pai.closest(PULAR)) continue;
        if (!originais.has(n)) originais.set(n, n.nodeValue);
        var novo = traduzirTexto(originais.get(n));
        if (n.nodeValue !== novo) n.nodeValue = novo;
      }
      ATRIBUTOS.forEach(function (a) {
        var els = Array.prototype.slice.call(r.querySelectorAll("[" + a + "]"));
        if (r.hasAttribute(a)) els.push(r);
        els.forEach(function (el) {
          if (el.closest("[data-idioma-nao]")) return;
          var o = originais.get(el);
          if (!o) { o = {}; originais.set(el, o); }
          if (!(a in o)) o[a] = el.getAttribute(a);
          var novo = t(o[a]);
          if (el.getAttribute(a) !== novo) el.setAttribute(a, novo);
        });
      });
    });
    if (document.title && !originais.has(document)) originais.set(document, document.title);
    if (originais.has(document) && document.body && document.body.hasAttribute("data-idioma")) document.title = t(originais.get(document));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { aplicar(); });
  else aplicar();

  // outra aba trocou o idioma: o texto fixo acompanha; o resto muda quando a página for aberta de novo
  window.addEventListener("storage", function (e) {
    if (e.key !== CHAVE && e.key !== CHAVE_TEXTOS) return;
    carregar();
    document.documentElement.lang = atual;
    aplicar();
    try { window.dispatchEvent(new CustomEvent("inkidioma", { detail: { idioma: atual } })); } catch (_) {}
  });

  /* ---------- pacotes ---------- */

  function chaveCache(rel) { return new URL(rel, RAIZ).href.split("?")[0]; }
  function manifesto() {
    return fetch(new URL("inicio/manifesto.json", RAIZ).href, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("manifest");
      return r.json();
    }).then(function (m) { return m.idiomas || {}; });
  }
  function mb(b) {
    var v = b / 1e6;
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString(atual) + " MB";
  }

  /* Baixa o pacote inteiro para o cache novo e só então apaga o anterior. */
  function baixar(codigo, pacotes, progresso) {
    var p = pacotes[codigo];
    if (!p) return Promise.reject(new Error("no package"));
    var feitos = 0, total = p.bytes || 1, textosNovos = null;
    var temp = CACHE + "-novo";
    return caches.delete(temp).then(function () { return caches.open(temp); }).then(function (c) {
      var fila = p.arquivos.slice();
      function proximo() {
        var a = fila.shift();
        if (!a) return Promise.resolve();
        return fetch(new URL(a[0], RAIZ).href, { cache: "no-store" }).then(function (r) {
          if (!r.ok) throw new Error(a[0]);
          var copia = r.clone();
          var pr = /^idiomas\/[^/]+\.json$/.test(a[0]) ? r.clone().json().then(function (j) { textosNovos = j; }) : Promise.resolve();
          return pr.then(function () { return c.put(chaveCache(a[0]), copia); });
        }).then(function () {
          feitos += a[1];
          if (progresso) progresso(Math.min(1, feitos / total));
          return proximo();
        });
      }
      return Promise.all([proximo(), proximo(), proximo(), proximo()]);
    }).then(function () {
      if (!textosNovos || !textosNovos.textos) throw new Error("texts");
      // troca: o pacote novo passa a ser o único
      return caches.delete(CACHE).then(function () { return caches.open(CACHE); }).then(function (destino) {
        return caches.open(temp).then(function (origem) {
          return origem.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return origem.match(k).then(function (r) { return destino.put(k, r); }); }));
          });
        });
      }).then(function () { return caches.delete(temp); });
    }).then(function () {
      localStorage.setItem(CHAVE_TEXTOS, JSON.stringify({ codigo: codigo, versao: p.versao, bytes: p.bytes, textos: textosNovos.textos }));
      localStorage.setItem(CHAVE, codigo);
      sincronizarInkdos(codigo);
    }, function (e) { caches.delete(temp); throw e; });
  }

  function voltarIngles() {
    var fim = function () {
      try { localStorage.removeItem(CHAVE_TEXTOS); localStorage.setItem(CHAVE, "en"); } catch (_) {}
      sincronizarInkdos("en");
    };
    return ("caches" in window ? caches.delete(CACHE) : Promise.resolve()).then(fim, fim);
  }

  /* A cópia dos apps do InkDOS (inkdos/) guarda o idioma nas chaves dela; aqui elas seguem o pacote. */
  function sincronizarInkdos(codigo) {
    try {
      var agora = String(Date.now());
      Object.keys(localStorage).forEach(function (k) {
        if (/^inkdos2:([a-z]+:)?language$/.test(k)) { localStorage.setItem(k, codigo); localStorage.setItem(k + ":changedAt", agora); }
      });
      localStorage.setItem("inkdos2:language", codigo);
      localStorage.setItem("inkdos2:language:changedAt", agora);
    } catch (_) {}
  }

  /* Com rede, confere se o pacote guardado mudou no site e baixa a versão nova (tela inicial). */
  function conferirAtualizacao() {
    if (atual === "en" || !info || !navigator.onLine || !("caches" in window)) return;
    manifesto().then(function (ps) {
      var p = ps[atual];
      if (p && p.versao && p.versao !== info.versao) return baixar(atual, ps).then(function () { carregar(); aplicar(); });
    }).catch(function () {});
  }

  /* ---------- aviso (o mesmo em todas as páginas) ---------- */

  // o que cada pacote traduz e o que continua em inglês (igual para todos os idiomas)
  function traduz() {
    return [t("Home screen"), t("Documents, Spreadsheets, Presentations, PDF, Plain text and EPUB reader"),
      t("Photos"), t("Video"), t("Music"), t("Whiteboard"), t("The top bar of Code, Linux terminal and Wine")];
  }
  function ingles() {
    return [t("Code (the VS Code editor itself)"), t("Linux terminal (the Linux system itself)"), t("Wine (the Windows programs themselves)")];
  }

  var CSS = ".ink-idioma-fundo{position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,20,.45);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}" +
    ".ink-idioma{--c:#fff;--tx:#192235;--mu:#697486;--bd:#e3e8ef;--bt:#f0f2f5;background:var(--c);color:var(--tx);border:1px solid var(--bd);border-radius:14px;width:min(420px,100%);max-height:calc(100dvh - 32px);overflow:auto;padding:16px;box-sizing:border-box;font-size:14px;line-height:1.4}" +
    ".ink-idioma.escuro{--c:#1c222a;--tx:#edf2f7;--mu:#aab5c3;--bd:#323c49;--bt:#252d37}" +
    ".ink-idioma h2{margin:0 0 10px;font-size:17px}.ink-idioma h3{margin:12px 0 4px;font-size:14px}" +
    ".ink-idioma ul{margin:0;padding:0 0 0 18px}.ink-idioma p{margin:8px 0}.ink-idioma small,.ink-idioma .mu{color:var(--mu)}" +
    ".ink-idioma .lista{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 4px;padding:0}" +
    ".ink-idioma button{font:inherit;color:var(--tx);background:var(--bt);border:1px solid var(--bd);border-radius:9px;padding:8px 10px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
    ".ink-idioma button.on{border-color:#3fb950;box-shadow:inset 0 0 0 1px #3fb950}" +
    ".ink-idioma button.principal{background:#3fb950;border-color:#3fb950;color:#0d1117;font-weight:600}" +
    ".ink-idioma button:disabled{opacity:.5}" +
    ".ink-idioma .acoes{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}" +
    ".ink-idioma .barra{height:6px;border-radius:3px;background:var(--bt);overflow:hidden;margin-top:10px}.ink-idioma .barra i{display:block;height:100%;width:0;background:#3fb950}";

  function el(tag, cls, texto) { var e = document.createElement(tag); if (cls) e.className = cls; if (texto != null) e.textContent = texto; return e; }

  var aberto = null;
  function fechar() { if (aberto) { aberto.remove(); aberto = null; document.removeEventListener("keydown", tecla); } }
  function tecla(e) { if (e.key === "Escape") fechar(); }

  function escolher() {
    fechar();
    if (!document.getElementById("ink-idioma-css")) { var s = el("style"); s.id = "ink-idioma-css"; s.textContent = CSS; document.head.appendChild(s); }
    var tema = ler("inkdoshub-tema");
    if (tema !== "light" && tema !== "dark") tema = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var fundo = el("div", "ink-idioma-fundo");
    var caixa = el("div", "ink-idioma" + (tema === "dark" ? " escuro" : ""));
    caixa.setAttribute("role", "dialog"); caixa.setAttribute("aria-modal", "true");
    fundo.appendChild(caixa);
    fundo.addEventListener("click", function (e) { if (e.target === fundo) fechar(); });
    document.addEventListener("keydown", tecla);
    document.body.appendChild(fundo);
    aberto = fundo;

    var pacotes = null, escolhido = atual;
    function lista() {
      caixa.innerHTML = "";
      caixa.appendChild(el("h2", null, t("Language")));
      caixa.appendChild(el("p", "mu", t("English is built in. Other languages are optional packages: only one is kept on this device at a time.")));
      var l = el("div", "lista");
      IDIOMAS.forEach(function (i) {
        var b = el("button", i.codigo === escolhido ? "on" : "", i.nome);
        b.type = "button"; b.lang = i.codigo;
        b.addEventListener("click", function () { escolhido = i.codigo; detalhe(); });
        l.appendChild(b);
      });
      caixa.appendChild(l);
      var a = el("div", "acoes"), fecharB = el("button", null, t("Close"));
      fecharB.type = "button"; fecharB.addEventListener("click", fechar);
      a.appendChild(fecharB); caixa.appendChild(a);
    }

    function detalhe() {
      if (escolhido === atual) { lista(); return; }
      caixa.innerHTML = "";
      caixa.appendChild(el("h2", null, nomeDe(escolhido)));
      var corpo = el("div"); caixa.appendChild(corpo);
      var acoes = el("div", "acoes"); caixa.appendChild(acoes);
      var voltar = el("button", null, t("Back")); voltar.type = "button";
      voltar.addEventListener("click", function () { escolhido = atual; lista(); });
      var ok = el("button", "principal"); ok.type = "button"; ok.disabled = true;
      acoes.appendChild(voltar); acoes.appendChild(ok);
      var tamAtual = info && info.bytes || 0;

      if (escolhido === "en") {
        corpo.appendChild(el("p", null, t("English is built into the site, so nothing is downloaded.")));
        corpo.appendChild(el("p", null, t("The {name} package will be removed from this device, freeing {size}.", { name: nomeDe(atual), size: mb(tamAtual) })));
        ok.textContent = t("Switch to English"); ok.disabled = false;
        ok.addEventListener("click", function () {
          ok.disabled = voltar.disabled = true;
          voltarIngles().then(function () { location.reload(); });
        });
        return;
      }

      corpo.appendChild(el("p", "mu", t("Checking the package…")));
      (pacotes ? Promise.resolve(pacotes) : manifesto()).then(function (ps) {
        pacotes = ps;
        var p = ps[escolhido];
        if (!p) throw new Error("none");
        corpo.innerHTML = "";
        corpo.appendChild(el("h3", null, t("Translated")));
        var u1 = el("ul"); traduz().forEach(function (x) { u1.appendChild(el("li", null, x)); }); corpo.appendChild(u1);
        corpo.appendChild(el("h3", null, t("Stays in English")));
        var u2 = el("ul"); ingles().forEach(function (x) { u2.appendChild(el("li", null, x)); });
        corpo.appendChild(u2);
        corpo.appendChild(el("h3", null, t("Space")));
        corpo.appendChild(el("p", null, t("Download: {size}.", { size: mb(p.bytes) })));
        var dif = p.bytes - tamAtual;
        corpo.appendChild(el("p", null, dif >= 0 ? t("This device will use {size} more than now.", { size: mb(dif) }) : t("This device will use {size} less than now.", { size: mb(-dif) })));
        if (atual !== "en") corpo.appendChild(el("p", "mu", t("The {name} package will be removed. Only one language package is kept at a time.", { name: nomeDe(atual) })));
        if (!("caches" in window)) throw new Error("caches");
        ok.textContent = t("Download and switch"); ok.disabled = false;
        ok.onclick = function () {
          ok.disabled = voltar.disabled = true;
          var barra = el("div", "barra"), i = el("i"); barra.appendChild(i); corpo.appendChild(barra);
          baixar(escolhido, ps, function (f) { i.style.width = Math.round(f * 100) + "%"; }).then(function () {
            location.reload();
          }, function () {
            barra.remove(); voltar.disabled = false; ok.disabled = false;
            corpo.appendChild(el("p", null, t("The download failed. Check the internet connection and try again. Nothing was changed.")));
          });
        };
      }).catch(function () {
        corpo.innerHTML = "";
        corpo.appendChild(el("p", null, t("The package could not be checked. Language packages need an internet connection to download.")));
      });
    }

    if (escolhido !== atual) detalhe(); else lista();
  }

  /* Botão de idioma: qualquer elemento com data-idioma-botao abre o aviso. */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-idioma-botao]");
    if (!b) return;
    e.preventDefault();
    escolher();
  });

  window.InkIdioma = {
    get atual() { return atual; },
    idiomas: IDIOMAS,
    t: t,
    aplicar: aplicar,
    escolher: escolher,
    nome: function () { return nomeDe(atual); },
    excalidraw: function () { return EXCALIDRAW[atual] || "en"; },
    conferirAtualizacao: conferirAtualizacao,
  };
})();
