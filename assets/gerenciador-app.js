/* Lado do app do gerenciador de memória da tela inicial (inicio/gerenciador.js).

   Um app que inclui este arquivo avisa a tela inicial que sabe guardar o próprio estado.
   Quando ela precisar de memória (ou o app for fechado), chama a função registrada:
     - a função guarda o que precisar e devolve "pronto" (ou nada): o app pode ser descarregado;
     - ou devolve "manter" ou {manter: "motivo"}: o app fica aberto (por exemplo, uma edição
       que não dá para salvar agora). O motivo aparece para a pessoa se ela tentar fechar.
   A tela inicial espera até 20 s. Fora dela (app aberto direto), este arquivo não faz nada.

   Uso no app:
     <script src="../../assets/gerenciador-app.js"></script>
     inkGerenciador.aoGuardar(async () => { await salvarNoIndexedDB(); return "pronto"; });
   Também aceita inkGerenciador({ salvar: async () => "pronto" | "manter" }). */
(function () {
  "use strict";
  var guardar = null;
  var dentro = window.parent !== window;
  try { dentro = dentro && window.parent.location.origin === location.origin; } catch (_) { dentro = false; }

  function registrar(fn) {
    guardar = fn;
    if (dentro) window.parent.postMessage({ tipo: "inkterminal:suporta" }, location.origin);
  }
  var api = function (opcoes) { registrar(opcoes && opcoes.salvar); };
  api.naMesa = dentro;
  api.aoGuardar = registrar;
  window.inkGerenciador = api;

  if (!dentro) return;
  addEventListener("message", function (e) {
    if (e.source !== window.parent || e.origin !== location.origin || !e.data || e.data.tipo !== "inkterminal:suspender") return;
    Promise.resolve().then(function () { return guardar && guardar(); }).catch(function () { return "pronto"; }).then(function (r) {
      var manter = r === "manter" || (r && typeof r === "object" && r.manter);
      window.parent.postMessage(manter ?
        { tipo: "inkterminal:manter", motivo: typeof r.manter === "string" ? r.manter : (r && r.motivo) || "" } :
        { tipo: "inkterminal:pronto" }, location.origin);
    });
  });
})();
