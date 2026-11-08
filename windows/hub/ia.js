// AI Chat on Windows: every model, from the lightest to the heaviest, with native llama.cpp on the graphics card
// (CUDA build on NVIDIA, Vulkan on other brands) or, with no graphics card, on the processor (CPU build).
// The llama.cpp release (github.com/ggml-org/llama.cpp, MIT) and the model are downloaded once, when the person
// picks a PC model, into %LOCALAPPDATA%\InkDOS Hub\ia. llama-server listens only on 127.0.0.1; the page talks to it
// through here (IPC), never directly.
'use strict';
const { app, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const cp = require('child_process');
const http = require('http');
const net = require('net');

// from the lightest to the heaviest (Q4_K_M); the size is also the minimum free memory (graphics card + RAM)
const HF = 'https://huggingface.co/';
const MODELOS = [
  { id: 'qwen05b', nome: 'Qwen 2.5 0.5B', gb: 0.49, url: HF + 'Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf' },
  { id: 'llama1b', nome: 'Llama 3.2 1B', gb: 0.81, url: HF + 'bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf' },
  { id: 'qwen15b', nome: 'Qwen 2.5 1.5B', gb: 1.1, url: HF + 'Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' },
  { id: 'qwen3b', nome: 'Qwen 2.5 3B', gb: 1.9, url: HF + 'bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf' },
  { id: 'qwen7b', nome: 'Qwen 2.5 7B', gb: 4.7, url: HF + 'bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf' },
  { id: 'llama8b', nome: 'Llama 3.1 8B', gb: 4.9, url: HF + 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf' },
  { id: 'qwen14b', nome: 'Qwen 2.5 14B', gb: 9.0, url: HF + 'bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf' },
  { id: 'qwen32b', nome: 'Qwen 2.5 32B', gb: 19.9, url: HF + 'bartowski/Qwen2.5-32B-Instruct-GGUF/resolve/main/Qwen2.5-32B-Instruct-Q4_K_M.gguf' }
];
const PASTA = () => path.join(app.getPath('userData'), 'ia');
let servidor = null, modeloAtual = null, porta = 0, iniciando = null;
const conversas = new Map();

function curl(args, ms) {
  return new Promise((ok, falha) => cp.execFile('curl.exe', args, { windowsHide: true, timeout: ms, maxBuffer: 1 << 26 },
    (e, out) => (e ? falha(new Error((e.message || '').split('\n')[0])) : ok(out))));
}
function acharServer(pasta) {
  if (!fs.existsSync(pasta)) return null;
  for (const n of fs.readdirSync(pasta, { withFileTypes: true })) {
    const f = path.join(pasta, n.name);
    if (n.isFile() && n.name.toLowerCase() === 'llama-server.exe') return f;
    if (n.isDirectory()) { const r = acharServer(f); if (r) return r; }
  }
  return null;
}
const temNvidia = () => new Promise(ok => cp.execFile('nvidia-smi.exe', ['-L'], { windowsHide: true, timeout: 8000 }, (e, out) => ok(!e && /GPU/.test(out || ''))));
// latest llama.cpp release for Windows x64: CUDA build (+ its runtime) on NVIDIA cards, Vulkan build on any other card
async function garantirLlama(avisar) {
  const pasta = path.join(PASTA(), 'llama');
  let exe = acharServer(pasta);
  if (exe) return exe;
  avisar('Downloading llama.cpp…');
  const rel = JSON.parse(await curl(['-fsSL', '-H', 'User-Agent: InkDOS-Hub', 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'], 60000));
  // NVIDIA → CUDA build (+ its runtime); other graphics card (Vulkan driver present) → Vulkan; no graphics card → CPU build
  const lista = rel.assets || [], nv = await temNvidia();
  const cudart = c => lista.find(x => x.name === 'cudart-' + c.name.replace(/^llama-b\d+-/, 'llama-'));
  const cudas = nv ? lista.filter(x => /^llama-.*bin-win-cuda-[\d.]+-x64\.zip$/.test(x.name) && cudart(x)) : [];
  const cuda = cudas.find(x => /cuda-12/.test(x.name)) || cudas[0];
  const runtime = cuda && cudart(cuda);
  const vulkan = fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'vulkan-1.dll'));
  const a = cuda || (vulkan && lista.find(x => /^llama-.*bin-win-vulkan-x64\.zip$/.test(x.name))) || lista.find(x => /^llama-.*bin-win-cpu-x64\.zip$/.test(x.name));
  if (!a) throw new Error('llama.cpp Windows build not found in ' + rel.tag_name);
  await fsp.mkdir(PASTA(), { recursive: true });
  const novo = pasta + '.novo';
  await fsp.rm(novo, { recursive: true, force: true });
  for (const x of [a, runtime].filter(Boolean)) {
    const zip = path.join(PASTA(), 'baixando.zip');
    await curl(['-fsSL', '--retry', '2', '-o', zip, x.browser_download_url], 30 * 60000);
    await new Promise((ok, falha) => cp.execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:INK_ZIP -DestinationPath $env:INK_DEST -Force'],
      { env: Object.assign({}, process.env, { INK_ZIP: zip, INK_DEST: novo }), windowsHide: true }, e => (e ? falha(e) : ok())));
    await fsp.rm(zip, { force: true });
  }
  await fsp.rm(pasta, { recursive: true, force: true });
  await fsp.rename(novo, pasta);
  await fsp.writeFile(path.join(pasta, 'VERSION.txt'), 'llama.cpp ' + rel.tag_name + ' (' + a.name + (runtime ? ' + ' + runtime.name : '') + ')\nhttps://github.com/ggml-org/llama.cpp\nLicense: MIT\n');
  exe = acharServer(pasta);
  if (!exe) throw new Error('llama-server.exe not found in the package');
  return exe;
}
// model: downloaded straight to disk by curl (resumes with -C -); progress = file size / expected size
async function garantirModelo(m, avisar) {
  const f = path.join(PASTA(), m.id + '.gguf');
  if (fs.existsSync(f + '.ok')) return f;
  await fsp.mkdir(PASTA(), { recursive: true });
  const total = m.gb * 1e9;
  const t = setInterval(() => { try { avisar('Downloading the model (only the first time)… ' + Math.min(99, Math.round(fs.statSync(f).size / total * 100)) + '%'); } catch (_) {} }, 1000);
  try { await curl(['-fSL', '--retry', '3', '-C', '-', '-o', f, m.url], 6 * 3600e3); } finally { clearInterval(t); }
  await fsp.writeFile(f + '.ok', '');
  return f;
}
const portaLivre = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
function pronto(p) {
  return new Promise(ok => { const r = http.get({ host: '127.0.0.1', port: p, path: '/health', timeout: 2000 }, res => { res.resume(); ok(res.statusCode === 200); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });
}
function parar() { if (servidor) { try { servidor.kill(); } catch (_) {} } servidor = null; modeloAtual = null; }

async function iniciar(id, avisar) {
  const m = MODELOS.find(x => x.id === id);
  if (!m) throw new Error('unknown model');
  if (servidor && modeloAtual === id) return true;
  const exe = await garantirLlama(avisar);
  const arq = await garantirModelo(m, avisar);
  parar();
  avisar('Loading the model…');
  porta = await portaLivre();
  let saida = '';
  servidor = cp.spawn(exe, ['-m', arq, '--host', '127.0.0.1', '--port', String(porta), '-c', '8192', '-ngl', '99'], { windowsHide: true, cwd: path.dirname(exe) });
  servidor.stderr.on('data', d => { saida = (saida + d).slice(-600); });
  servidor.on('exit', () => { servidor = null; modeloAtual = null; });
  for (let i = 0; i < 600; i++) {
    if (!servidor) throw new Error('llama-server stopped: ' + saida.split('\n').filter(Boolean).slice(-2).join(' '));
    if (await pronto(porta)) { modeloAtual = id; return true; }
    await new Promise(r => setTimeout(r, 500));
  }
  parar();
  throw new Error('llama-server did not start in time');
}

// one chat answer, streamed (OpenAI-compatible endpoint of llama-server)
function conversar(e, mensagens) {
  return new Promise((ok, falha) => {
    const corpo = JSON.stringify({ messages: mensagens, stream: true, max_tokens: 1024, temperature: 0.7, top_p: 0.9 });
    let texto = '', resto = '';
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } }, res => {
      res.setEncoding('utf8');
      res.on('data', d => {
        resto += d;
        const linhas = resto.split('\n'); resto = linhas.pop();
        for (const l of linhas) {
          if (!l.startsWith('data: ') || l === 'data: [DONE]') continue;
          try { const c = JSON.parse(l.slice(6)).choices[0].delta.content; if (c) { texto += c; if (!e.sender.isDestroyed()) e.sender.send('hub:ia-texto', texto); } } catch (_) {}
        }
      });
      res.on('end', () => { conversas.delete(e.sender.id); ok(texto); });
    });
    req.on('error', err => { conversas.delete(e.sender.id); if (req.destroyed && texto) ok(texto); else falha(err); });
    conversas.set(e.sender.id, req);
    req.end(corpo);
  });
}

function registrar(doSite) {
  ipcMain.handle('hub:ia-modelos', () => MODELOS.map(({ id, nome, gb }) => ({ id, nome, gb })));
  ipcMain.handle('hub:ia-iniciar', async (e, id) => {
    if (!doSite(e.senderFrame ? e.senderFrame.url : '')) throw new Error('forbidden');
    const avisar = t => { if (!e.sender.isDestroyed()) e.sender.send('hub:ia-estado', t); };
    if (iniciando) await iniciando.catch(() => {});
    iniciando = iniciar(id, avisar);
    try { return await iniciando; } finally { iniciando = null; }
  });
  ipcMain.handle('hub:ia-conversar', (e, mensagens) => {
    if (!doSite(e.senderFrame ? e.senderFrame.url : '')) throw new Error('forbidden');
    return conversar(e, mensagens);
  });
  ipcMain.handle('hub:ia-parar', e => { const r = conversas.get(e.sender.id); if (r) r.destroy(); return true; });
  app.on('will-quit', parar);
}
module.exports = { registrar };
