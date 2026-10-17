/* Gerenciador de memória da área de trabalho.

   O Safari não deixa uma página mover a própria memória para o disco, e o iPadOS fecha a aba
   quando ela passa do limite. Então o gerenciador trabalha no nível das janelas, como o iPadOS faz
   com os apps: cada app tem um peso estimado, e a soma dos apps carregados fica abaixo do limite.
   Quando falta espaço, a janela parada há mais tempo é guardada e descarregada (o iframe sai da
   página, que é o único jeito garantido de o Safari devolver a memória). Ela volta ao ser tocada.

   Antes de descarregar, o app recebe {tipo:"inkterminal:suspender"} e tem até 20 s para guardar o
   estado e responder {tipo:"inkterminal:pronto"} (veja assets/gerenciador-app.js). Apps que não
   usam esse aviso e não salvam sozinhos só são descarregados depois de você confirmar. */
(function () {
  "use strict";
  var CHAVE = "inkterminal-desktop-memoria"; // "inkterminal-memoria" é do terminal (modo normal/limitada)
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
    emUso: function () { return G.carregadas().reduce(function (s, j) { return s + G.peso(j.app); }, 0); },

    peso: function (a) { return typeof a.peso === "function" ? a.peso() : a.peso; },

    podeSairSemPerguntar: function (j) { return !!(j.app.salvaSozinho || j.suportaAviso); },

    /* Pede ao app para guardar o estado. Resposta: "pronto" (pode descarregar), "manter" (o app pede
       para ficar aberto; motivo em j.motivoManter) ou "sem-resposta" (não usa o aviso ou passou do prazo).
       O prazo é de 20 s porque o terminal grava a máquina inteira (20 a 100 MB). */
    avisar: function (j) {
      if (!j.suportaAviso || !j.iframe || !j.iframe.contentWindow) return Promise.resolve("sem-resposta");
      return new Promise(function (ok) {
        var feito = false;
        function fim(v) { if (feito) return; feito = true; removeEventListener("message", ouvir); ok(v); }
        function ouvir(e) {
          if (!j.iframe || e.source !== j.iframe.contentWindow || !e.data) return;
          if (e.data.tipo === "inkterminal:pronto") fim("pronto");
          else if (e.data.tipo === "inkterminal:manter") { j.motivoManter = e.data.motivo || ""; fim("manter"); }
        }
        addEventListener("message", ouvir);
        try { j.iframe.contentWindow.postMessage({ tipo: "inkterminal:suspender" }, location.origin); } catch (_) { fim("sem-resposta"); }
        setTimeout(function () { fim("sem-resposta"); }, 20000);
      });
    },

    /* Descarrega uma janela. explicito=true quando a própria pessoa tocou em "Guardar". */
    suspender: function (j, explicito) {
      if (!j.carregada) return Promise.resolve(true);
      var pergunta = Promise.resolve("sim");
      if (!G.podeSairSemPerguntar(j) && G.perguntar) {
        pergunta = G.perguntar(explicito ? "Guardar " + j.app.nome + "?" : "Liberar memória?",
          (explicito ? "" : "Para abrir mais um app, preciso fechar \"" + j.app.nome + "\", que não salva sozinho. ") +
          "Se houver algo não salvo nele, salve antes. A janela continua na área de trabalho e volta ao ser tocada.",
          [{ id: "sim", texto: (explicito ? "Guardar " : "Fechar ") + j.app.nome }, { id: "nao", texto: "Manter aberto", secundario: true }]);
      }
      return pergunta.then(function (r) {
        if (r !== "sim") return false;
        j.guardando = true; G.aoMudar();
        return G.avisar(j).then(function (resp) {
          j.guardando = false;
          if (resp === "manter") {
            G.aoMudar();
            if (explicito && G.perguntar) {
              G.perguntar(j.app.nome + " precisa ficar aberto", j.motivoManter || "O app pediu para não ser fechado agora.",
                [{ id: "ok", texto: "OK" }]);
            }
            return false;
          }
          j.descarregar(); G.aoMudar(); return true;
        });
      });
    },

    /* Abre espaço para a janela nova, descarregando as mais antigas que não estão em foco. */
    abrirEspaco: function (nova) {
      var self = this;
      function falta() {
        var carregadas = G.carregadas().filter(function (j) { return j !== nova; });
        var total = carregadas.reduce(function (s, j) { return s + G.peso(j.app); }, 0) + G.peso(nova.app);
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
