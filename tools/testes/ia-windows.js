// Runs windows/hub/ia.js outside Electron (GitHub Windows runner, no graphics card): downloads llama.cpp
// and Qwen 0.5B, starts llama-server and asks one question. Workflow: .github/workflows/ia-windows.yml
'use strict';
const Module = require('module');
const os = require('os'), path = require('path');
const handlers = {};
const stub = {
  app: { getPath: () => path.join(os.tmpdir(), 'inkhub-teste'), on: () => {} },
  ipcMain: { handle: (n, f) => { handlers[n] = f; } },
  session: {}
};
const carregar = Module._load;
Module._load = function (req, ...r) { return req === 'electron' ? stub : carregar.call(this, req, ...r); };
require('../../windows/hub/ia.js').registrar(() => true);
const e = { sender: { id: 1, isDestroyed: () => false, send: (c, t) => { if (c === 'hub:ia-estado') console.log('estado:', t); } }, senderFrame: { url: 'https://inkdoshub.github.io/apps/ia/' } };
(async () => {
  console.log(await handlers['hub:ia-modelos']());
  const t0 = Date.now();
  await handlers['hub:ia-iniciar'](e, 'qwen05b');
  console.log('started in', Math.round((Date.now() - t0) / 1000), 's');
  const r = await handlers['hub:ia-conversar'](e, [{ role: 'user', content: 'Say hello in Portuguese.' }]);
  console.log('ANSWER:', JSON.stringify(r));
  if (!r) process.exit(1);
  // the processor-only fallback (used when the graphics card fails) must also start
  const t = require('../../windows/hub/ia.js')._teste;
  t.parar();
  const cpu = await t.subir(t.acharServer(path.join(t.PASTA(), 'llama')), path.join(t.PASTA(), 'qwen05b.gguf'), ['-c', '4096', '-ngl', '0', '--device', 'none']);
  console.log('CPU fallback:', cpu);
  t.parar();
  process.exit(cpu === true ? 0 : 1);
})().catch(err => { console.error('FAIL', err); process.exit(1); });
