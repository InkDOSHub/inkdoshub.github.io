// Cópia no InkTerminal (onlyoffice/). O app do InkDOS copiado (inkdos/) guarda o documento no IndexedDB
// deste site ("inkdos-tool-handoff") e a tela inicial abre editor.html?embed=1&inkdos-handoff=<id>.
// Como tudo está no mesmo site, este arquivo lê o documento direto e o entrega ao editor pelo
// protocolo de embed que ele já fala (document:ready -> document:open-file).
(function () {
  'use strict';
  // sem o cartão "Instalar o app" do próprio editor
  var hide = document.createElement('style');
  hide.textContent = 'pwa-install{display:none!important}';
  (document.head || document.documentElement).appendChild(hide);
  var id = new URLSearchParams(location.search).get('inkdos-handoff');
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return;
  // o editor fala com window.parent (protocolo de embed); aqui ele é o topo da própria conversa, então
  // as respostas dele voltam para esta página e não para a tela inicial
  try { Object.defineProperty(window, 'parent', { value: window, configurable: true }); } catch (_) {}
  var file = null, ready = false, sent = false;
  function send() {
    if (sent || !file || !ready) return;
    sent = true;
    window.postMessage({ id: 'inkdos-launch', type: 'document:open-file', payload: { file: file, fileName: file.name } }, location.origin);
  }
  addEventListener('message', function (event) {
    var data = event.data || {};
    if (event.origin === location.origin && event.source === window && data.type === 'document:ready') { ready = true; send(); }
  });
  // A entrada continua guardada enquanto o editor está aberto, para um recarregamento (o app sair da
  // memória e voltar) abrir o mesmo documento; a tela inicial a apaga quando o editor é fechado.
  var req = indexedDB.open('inkdos-tool-handoff', 1);
  req.onupgradeneeded = function () { req.result.createObjectStore('files'); };
  req.onsuccess = function () {
    var db = req.result, get = db.transaction('files', 'readonly').objectStore('files').get(id);
    get.onsuccess = function () {
      var v = get.result;
      db.close();
      if (!v) return;
      file = new File([v.bytes], String(v.name || 'documento'), { type: v.type || '' });
      send();
    };
  };
})();
