/* Gerenciador de memória da área de trabalho.

   O Safari não deixa uma página mover a própria memória para o disco, e o iPadOS fecha a aba
   quando ela passa do limite. Então o gerenciador trabalha no nível das janelas, como o iPadOS faz
   com os apps: cada app tem um peso estimado, e a soma dos apps carregados fica abaixo do limite.
   Quando falta espaço, a janela parada há mais tempo é guardada e descarregada (o iframe sai da
   página, que é o único jeito garantido de o Safari devolver a memória). Ela volta ao ser tocada.

   Antes de descarregar, o app recebe {tipo:"inkterminal:suspender"} e tem 3 s para guardar o
   estado e responder {tipo:"inkterminal:pronto"} (veja assets/gerenciador-app.js). Apps que não
   usam esse aviso e não salvam sozinhos só são descarregados depois de você confirmar. */
(function () {
  "use strict";
  var CHAVE = "inkterminal-memoria";
  var cfg = { limite: 1000, maxJanelas: 3 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(CHAVE) || "{}")); } catch (_) {}

  function salvarCfg() { try { localStorage.setItem(CHAVE, JSON.stringify(cfg)); } catch (_) {} }

  var G = {
    cfg: cfg,
    janelas: function () { return []; }, // definido por janelas.js
    perguntar: null, // definido por desktop.js: (titulo, texto, opcoes) => Promise<id da opção>
    aoMudar: function () {},

    definir: function (nome, valor) { cfg[nome] = Number(valor); salvarCfg(); G.aoMudar(); },

    carregadas: function () { return G.janelas().filter(function (j) { return j.carregada; }); },
    emUso: function () { return G.carregadas().reduce(function (s, j) { return s + j.app.peso; }, 0); },

    podeSairSemPerguntar: function (j) { return !!(j.app.salvaSozinho || j.suportaAviso); },

    /* Pede ao app para guardar o estado e espera a resposta (até 3 s). */
    avisar: function (j) {
      if (!j.suportaAviso || !j.iframe || !j.iframe.contentWindow) return Promise.resolve(false);
      return new Promise(function (ok) {
        var feito = false;
        function fim(v) { if (feito) return; feito = true; removeEventListener("message", ouvir); ok(v); }
        function ouvir(e) {
          if (e.source === j.iframe.contentWindow && e.data && e.data.tipo === "inkterminal:pronto") fim(true);
        }
        addEventListener("message", ouvir);
        try { j.iframe.contentWindow.postMessage({ tipo: "inkterminal:suspender" }, location.origin); } catch (_) { fim(false); }
        setTimeout(function () { fim(false); }, 3000);
      });
    },

    /* Descarrega uma janela. perguntar=false só é usado quando a própria pessoa pediu. */
    suspender: function (j, perguntar) {
      if (!j.carregada) return Promise.resolve(true);
      var pergunta = Promise.resolve("sim");
      if (perguntar !== false && !G.podeSairSemPerguntar(j) && G.perguntar) {
        pergunta = G.perguntar("Liberar memória?",
          "Para abrir mais um app, preciso fechar \"" + j.app.nome + "\", que não salva sozinho. " +
          "Se houver algo não salvo nele, salve antes. A janela continua na área de trabalho e volta ao ser tocada.",
          [{ id: "sim", texto: "Fechar " + j.app.nome }, { id: "nao", texto: "Manter aberto", secundario: true }]);
      }
      return pergunta.then(function (r) {
        if (r !== "sim") return false;
        return G.avisar(j).then(function () { j.descarregar(); G.aoMudar(); return true; });
      });
    },

    /* Abre espaço para a janela nova, descarregando as mais antigas que não estão em foco. */
    abrirEspaco: function (nova) {
      var self = this;
      function falta() {
        var carregadas = G.carregadas().filter(function (j) { return j !== nova; });
        var total = carregadas.reduce(function (s, j) { return s + j.app.peso; }, 0) + nova.app.peso;
        return total > cfg.limite || carregadas.length + 1 > cfg.maxJanelas;
      }
      function candidatas(pular) {
        return G.carregadas().filter(function (j) { return j !== nova && pular.indexOf(j) < 0; })
          .sort(function (a, b) {
            // primeiro as que saem sem perguntar, depois as paradas há mais tempo
            var pa = G.podeSairSemPerguntar(a) ? 0 : 1, pb = G.podeSairSemPerguntar(b) ? 0 : 1;
            return pa - pb || a.usadoEm - b.usadoEm;
          });
      }
      var recusadas = [];
      function passo() {
        if (!falta()) return Promise.resolve(true);
        var c = candidatas(recusadas)[0];
        if (!c) return Promise.resolve(false); // nada mais para liberar: abre mesmo assim
        return self.suspender(c).then(function (feito) { if (!feito) recusadas.push(c); return passo(); });
      }
      return passo();
    },
  };

  /* Apps que incluem assets/gerenciador-app.js avisam que entendem o pedido de guardar. */
  addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data || e.data.tipo !== "inkterminal:suporta") return;
    G.janelas().forEach(function (j) { if (j.iframe && j.iframe.contentWindow === e.source) j.suportaAviso = true; });
  });

  window.InkGerenciador = G;
})();
