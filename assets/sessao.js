/* Arquivo de sessão do InkTerminal (.inksessao): guarda o trabalho de um app (Linux, Wine) num
   arquivo no aparelho, para recuperar mesmo se o site apagar os dados. Sempre com senha.

   Formato: "INKSESSAO" + versão (1 byte) + sal (16) + iv (12) + dados cifrados com AES-GCM
   (chave de 256 bits tirada da senha por PBKDF2-SHA256, 310 mil rodadas).
   Por dentro: tamanho do cabeçalho (4 bytes) + cabeçalho JSON {app, versao, criado, partes:[{nome, tamanho}]}
   + as partes, uma depois da outra.

   InkSessao.salvar(app, meta, partes)  partes: {nome: Uint8Array}; pede a senha e entrega o arquivo
   InkSessao.abrir(app)                 escolhe o arquivo, pede a senha e devolve {meta, partes} ou null */
(function () {
  "use strict";
  var MAGICO = "INKSESSAO", VERSAO = 1, RODADAS = 310000;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function chave(senha, sal) {
    return crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: RODADAS, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }

  function empacotar(meta, partes) {
    var nomes = Object.keys(partes), total = 0;
    var cab = Object.assign({}, meta, { formato: 1, criado: new Date().toISOString(),
      partes: nomes.map(function (n) { total += partes[n].length; return { nome: n, tamanho: partes[n].length }; }) });
    var j = enc.encode(JSON.stringify(cab));
    var out = new Uint8Array(4 + j.length + total), p = 4 + j.length;
    new DataView(out.buffer).setUint32(0, j.length, true);
    out.set(j, 4);
    nomes.forEach(function (n) { out.set(partes[n], p); p += partes[n].length; });
    return out;
  }
  function desempacotar(b) {
    var n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
    var meta = JSON.parse(dec.decode(b.subarray(4, 4 + n))), p = 4 + n, partes = {};
    (meta.partes || []).forEach(function (x) { partes[x.nome] = b.subarray(p, p + x.tamanho); p += x.tamanho; });
    return { meta: meta, partes: partes };
  }

  function cifrar(meta, partes, senha) {
    var sal = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var dados = empacotar(meta, partes);
    return chave(senha, sal).then(function (k) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, k, dados);
    }).then(function (c) {
      return new Blob([enc.encode(MAGICO), new Uint8Array([VERSAO]), sal, iv, new Uint8Array(c)], { type: "application/octet-stream" });
    });
  }
  function decifrar(bytes, senha) {
    if (dec.decode(bytes.subarray(0, MAGICO.length)) !== MAGICO) return Promise.reject(new Error("Este arquivo não é uma sessão do InkTerminal."));
    if (bytes[MAGICO.length] !== VERSAO) return Promise.reject(new Error("Sessão de uma versão mais nova do InkTerminal."));
    var i = MAGICO.length + 1, sal = bytes.slice(i, i + 16), iv = bytes.slice(i + 16, i + 28);
    return chave(senha, sal).then(function (k) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, k, bytes.subarray(i + 28));
    }).then(function (b) { return desempacotar(new Uint8Array(b)); },
      function (e) { if (e && e.name === "OperationError") throw new Error("Senha errada."); throw e; });
  }

  /* ---------- Janelas ---------- */
  var estilo = false;
  function css() {
    if (estilo) return; estilo = true;
    var s = document.createElement("style");
    s.textContent = ".ink-sessao{background:var(--card,#fff);color:var(--text,#192235);border:1px solid var(--border,#e3e8ef);border-radius:12px;" +
      "width:min(420px,calc(100% - 32px));padding:16px;box-sizing:border-box;font:15px -apple-system,BlinkMacSystemFont,sans-serif}" +
      ".ink-sessao::backdrop{background:rgba(0,0,0,.5)}.ink-sessao h2{font-size:17px;margin:0 0 8px}" +
      ".ink-sessao p{margin:0 0 12px;color:var(--muted,#697486);font-size:14px;line-height:1.4}" +
      ".ink-sessao input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:9px 10px;margin:0 0 10px;" +
      "border:1px solid var(--border,#e3e8ef);border-radius:8px;background:var(--bg,#f2f5f8);color:inherit}" +
      ".ink-sessao .erro{color:#cf222e}.ink-sessao .botoes{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}" +
      ".ink-sessao .principal{background:var(--accent,#3fb950);border-color:var(--accent,#3fb950);color:#0d1117;font-weight:600}" +
      ".ink-sessao .ink-btn{font:inherit;font-size:15px;padding:8px 14px;border-radius:8px;border:1px solid var(--border,#e3e8ef);background:var(--btn,#f0f2f5);color:inherit}";
    document.head.appendChild(s);
  }
  function janela(html) {
    css();
    var d = document.createElement("dialog");
    d.className = "ink-sessao";
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener("close", function () { setTimeout(function () { d.remove(); }, 0); });
    d.showModal();
    return d;
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* confirmar: pede a senha duas vezes (para salvar). Devolve a senha ou null. */
  function pedirSenha(titulo, texto, confirmar) {
    return new Promise(function (ok) {
      var d = janela("<form method='dialog'><h2>" + esc(titulo) + "</h2><p>" + esc(texto) + "</p>" +
        "<input type='password' name='s1' autocomplete='" + (confirmar ? "new-password" : "current-password") + "' placeholder='Senha' required>" +
        (confirmar ? "<input type='password' name='s2' autocomplete='new-password' placeholder='Repita a senha' required>" : "") +
        "<p class='erro' hidden></p><div class='botoes'><button class='ink-btn' value='nao' formnovalidate>Cancelar</button>" +
        "<button class='ink-btn principal' value='sim'>Continuar</button></div></form>");
      var f = d.querySelector("form"), erro = d.querySelector(".erro"), resposta = null;
      f.addEventListener("submit", function (e) {
        if (e.submitter && e.submitter.value === "nao") return;
        var s1 = f.s1.value, s2 = confirmar ? f.s2.value : s1;
        var falha = s1.length < 6 ? "Use pelo menos 6 caracteres." : s1 !== s2 ? "As senhas não são iguais." : "";
        if (falha) { e.preventDefault(); erro.textContent = falha; erro.hidden = false; return; }
        resposta = s1;
      });
      d.addEventListener("close", function () { ok(resposta); });
      setTimeout(function () { f.s1.focus(); }, 50);
    });
  }
  function aviso(titulo, texto) {
    var d = janela("<h2>" + esc(titulo) + "</h2><p class='texto'>" + esc(texto) + "</p><div class='botoes'></div>");
    return {
      texto: function (t) { d.querySelector(".texto").textContent = t; },
      fim: function (t, erro) {
        var p = d.querySelector(".texto"); p.textContent = t; p.classList.toggle("erro", !!erro);
        var b = document.createElement("button"); b.className = "ink-btn principal"; b.textContent = "OK";
        b.onclick = function () { d.close(); };
        d.querySelector(".botoes").appendChild(b);
      },
      fechar: function () { d.close(); },
      janela: d,
    };
  }

  function perguntar(titulo, texto, sim) {
    return new Promise(function (ok) {
      var d = janela("<form method='dialog'><h2>" + esc(titulo) + "</h2><p>" + esc(texto) + "</p><div class='botoes'>" +
        "<button class='ink-btn' value='nao'>Cancelar</button><button class='ink-btn principal' value='sim'>" + esc(sim || "Continuar") + "</button></div></form>");
      d.addEventListener("close", function () { ok(d.returnValue === "sim"); });
    });
  }

  /* Entrega o arquivo: o toque em "Guardar" abre a folha de compartilhar do iOS ("Salvar em Arquivos"),
     ou baixa o arquivo onde a folha não existe. O toque precisa ser da pessoa, por isso o botão. */
  function entregar(blob, nome, texto) {
    var arquivo = new File([blob], nome, { type: "application/octet-stream" });
    var d = janela("<h2>Sessão pronta</h2><p>" + esc(texto) + "</p><div class='botoes'>" +
      "<button class='ink-btn' value='fechar'>Fechar</button><button class='ink-btn principal' id='ink-guardar'>Guardar arquivo</button></div>");
    d.querySelector("[value=fechar]").onclick = function () { d.close(); };
    d.querySelector("#ink-guardar").onclick = function () {
      var podeCompartilhar = false;
      try { podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [arquivo] })); } catch (_) {}
      if (podeCompartilhar) {
        navigator.share({ files: [arquivo] }).then(function () { d.close(); }, function (e) {
          if (e && e.name === "AbortError") return;
          baixar();
        });
      } else baixar();
    };
    function baixar() {
      var url = URL.createObjectURL(arquivo), a = document.createElement("a");
      a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      d.close();
    }
  }

  function escolherArquivo() {
    return new Promise(function (ok) {
      var i = document.createElement("input");
      i.type = "file"; i.style.display = "none";
      document.body.appendChild(i);
      i.onchange = function () { var f = i.files[0]; i.remove(); ok(f || null); };
      i.click();
    });
  }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function data() { var d = new Date(), z = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); }

  window.InkSessao = {
    cifrar: cifrar, decifrar: decifrar, pedirSenha: pedirSenha, perguntar: perguntar, aviso: aviso, janela: janela, entregar: entregar, mb: mb,
    /* preparar(): Promise<{meta, partes}>. nomeApp: "Linux", "Wine" */
    salvar: function (app, nomeApp, preparar, avisoTexto) {
      return pedirSenha("Salvar sessão do " + nomeApp,
        "Escolha uma senha. Ela é pedida para abrir o arquivo e não dá para recuperá-la. " + (avisoTexto || ""), true).then(function (senha) {
        if (!senha) return;
        var a = aviso("Salvando a sessão", "Juntando os arquivos…");
        return Promise.resolve().then(function () { return preparar(a); }).then(function (r) {
          a.texto("Protegendo com a senha…");
          return cifrar(Object.assign({ app: app }, r.meta), r.partes, senha);
        }).then(function (blob) {
          a.fechar();
          entregar(blob, "InkTerminal " + nomeApp + " " + data() + ".inksessao",
            "O arquivo tem " + mb(blob.size) + ". Guarde em Arquivos ou no iCloud Drive. Para usar, toque em Sessão e Abrir arquivo.");
        }).catch(function (e) { a.fim("Não foi possível salvar: " + (e && e.message || e), true); });
      });
    },
    /* Devolve {meta, partes, aviso} ou null. */
    abrir: function (app, nomeApp) {
      return escolherArquivo().then(function (f) {
        if (!f) return null;
        return f.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          var tentar = function (texto) {
            return pedirSenha("Abrir sessão do " + nomeApp, texto, false).then(function (senha) {
              if (!senha) return null;
              return decifrar(bytes, senha).then(function (r) {
                if (r.meta.app !== app) throw new Error("Esta sessão é do " + (r.meta.app === "wine" ? "Wine" : r.meta.app === "linux" ? "Linux" : r.meta.app) + ". Abra no app certo.");
                return r;
              }, function (e) {
                if (/Senha errada/.test(e.message)) return tentar("Senha errada. Tente de novo.");
                throw e;
              });
            });
          };
          return tentar("Digite a senha usada ao salvar \"" + f.name + "\".");
        });
      }).catch(function (e) { aviso("Abrir sessão", "").fim(String(e && e.message || e), true); return null; });
    },
  };
})();
