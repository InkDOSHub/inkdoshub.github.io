/* Lado do app do gerenciador de memória da área de trabalho (desktop/gerenciador.js).

   Um app que inclui este arquivo avisa a área de trabalho que sabe guardar o próprio estado.
   Quando ela precisar de memória, chama a função registrada e só descarrega a janela depois que
   a função termina (ou depois de 3 s). Fora da área de trabalho, este arquivo não faz nada.

   Uso no app:
     <script src="../../assets/gerenciador-app.js"></script>
     inkGerenciador.aoGuardar(async () => { await salvarNoIndexedDB(); });  */
(function () {
  "use strict";
  var guardar = null;
  var dentro = window.parent !== window;
  try { dentro = dentro && window.parent.location.origin === location.origin; } catch (_) { dentro = false; }

  window.inkGerenciador = {
    naMesa: dentro,
    aoGuardar: function (fn) {
      guardar = fn;
      if (dentro) window.parent.postMessage({ tipo: "inkterminal:suporta" }, location.origin);
    },
  };

  if (!dentro) return;
  addEventListener("message", function (e) {
    if (e.source !== window.parent || e.origin !== location.origin || !e.data || e.data.tipo !== "inkterminal:suspender") return;
    Promise.resolve().then(function () { return guardar && guardar(); }).catch(function () {}).then(function () {
      window.parent.postMessage({ tipo: "inkterminal:pronto" }, location.origin);
    });
  });
})();
