// Compatibility runner: runs every program of list.json on the engine (Node, same V8 as Chromium)
// and writes results.json for the page.
//   node run.mjs <packages dir> [id ...]      packages dir: <id>/... unpacked official downloads
// Each program runs in its own process with a time limit.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = process.env.ENGINE_DIR || path.join(HERE, '..');
const LIMIT_S = +(process.env.LIMIT || 60);

if (process.argv[2] === '--one') { await runOne(JSON.parse(process.argv[3])); process.exit(0); }

const pkgs = process.argv[2];
const only = process.argv.slice(3);
const list = JSON.parse(fs.readFileSync(path.join(HERE, 'list.json'), 'utf8'));
const resFile = path.join(HERE, 'results.json');
const prev = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { results: {} };
for (const p of list) {
  if (only.length && !only.includes(p.id)) continue;
  const exe = path.join(pkgs, p.pkg, p.exe);
  const dir = path.dirname(exe);
  // the exe, the DLLs and data next to it, and the test data
  const files = [exe];
  for (const f of fs.readdirSync(dir)) if (/\.(dll|pyd|zip|_pth)$/i.test(f)) files.push(path.join(dir, f));
  for (const f of fs.readdirSync(path.join(HERE, 'data'))) files.push(path.join(HERE, 'data', f));
  // Wine 9.0's DLLs: the engine takes from them every function it does not implement itself
  const have = new Set(files.map((f) => path.basename(f).toLowerCase()));
  for (const f of fs.readdirSync(path.join(ENGINE, 'bin', 'wine'))) if (!have.has(f)) files.push(path.join(ENGINE, 'bin', 'wine', f));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--one', JSON.stringify({ files, exe: path.basename(exe), args: p.args })], { encoding: 'utf8', timeout: (LIMIT_S + 30) * 1000, maxBuffer: 64 << 20 });
  let o;
  try { o = JSON.parse(r.stdout.slice(r.stdout.lastIndexOf('\n{"status"') + 1)); }
  catch { o = { status: 'crash', error: (r.error ? 'runner: ' + r.error.code : (r.stderr || '').split('\n').slice(-3).join(' ')).slice(0, 300), out: '' }; }
  const text = (o.out || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const found = text.includes(p.expect) || (o.files || []).includes(p.expect);
  const ok = o.status === 'exit' && o.exitCode === 0 && found;
  const res = { ok, status: o.status, exitCode: o.exitCode, error: o.error || (o.status === 'exit' && !found ? 'expected output not found' : ''), missing: o.missing || [], mips: o.mips, ms: Date.now() - t0, out: text.slice(-600) };
  prev.results[p.id] = res;
  console.log((ok ? 'OK   ' : 'FAIL ') + p.id.padEnd(12) + ' ' + (ok ? '' : (res.error || res.status)).slice(0, 110));
  prev.date = new Date().toISOString();
  fs.writeFileSync(resFile, JSON.stringify(prev, null, 1));
}

async function runOne({ files, exe, args }) {
  const PAGE = 4096, pool = 256; const ram = new Map(); let mem, wine, x, out = '', traceFd = null, spillFd = null;
  const view = (p) => new Uint8Array(mem.buffer, p, PAGE);
  const env = {
    // with TRACE the call log goes straight to its file (it can pass node's string limit)
    host_console: (p, n) => { const t = new TextDecoder().decode(new Uint8Array(mem.buffer, p, n).slice()); if (traceFd !== null && t.startsWith('[call]')) fs.writeSync(traceFd, t); else out += t; },
    host_now_ms: () => performance.now(), host_epoch_ms: () => Date.now(),
    host_swap_write: (s, p) => ram.set(s, view(p).slice()), host_swap_read: (s, p) => view(p).set(ram.get(s)), // the spill file (closed big files) in a temporary file, as OPFS holds it in the browser
    host_drive_write: (id, off, p, n) => { spillFd ??= fs.openSync(path.join(os.tmpdir(), 'inksoc-spill-' + process.pid), 'w+'); return fs.writeSync(spillFd, new Uint8Array(mem.buffer, p >>> 0, n), 0, n, off); },
    host_drive_read: (id, off, p, n) => spillFd === null ? 0 : fs.readSync(spillFd, new Uint8Array(mem.buffer, p >>> 0, n), 0, n, off),
    wine_call: (id, a, b, c, d) => wine.ink_call(id, a, b, c, d),
    host_audio: () => {}, // no sound in Node
    host_gl: () => NaN, // no WebGL in Node
    host_jit: (p, n) => {
      try {
        const m = new WebAssembly.Module(new Uint8Array(mem.buffer, p, n).slice());
        const i = new WebAssembly.Instance(m, { env: { memory: mem, rd: x.jit_rd, wr: x.jit_wr, step: x.jit_step, cond: x.jit_cond } });
        const t = x.__indirect_function_table; const k = t.grow(1); t.set(k, i.exports.f); if (process.env.DUMPJIT) fs.writeFileSync(path.join(process.env.DUMPJIT, k + '.wasm'), new Uint8Array(mem.buffer, p, n).slice()); return k;
      } catch { return -1; }
    },
  };
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(process.env.WASM || path.join(ENGINE, 'inksoc.wasm')), { env });
  x = instance.exports; mem = x.memory;
  const put = (b) => { const p = x.buffer(b.length); new Uint8Array(mem.buffer, p, b.length).set(b); };
  x.init(pool, 8192);
  wine = (await WebAssembly.instantiate(fs.readFileSync(path.join(ENGINE, 'wine.wasm')), { env: { memory: mem, load_ptr: x.wine_load_ptr, store_ptr: x.wine_store_ptr, malloc: x.wine_malloc, free: x.wine_free, sse2_memmove: x.wine_memmove, __inksoc_teb: x.wine_teb, ink_output: x.wine_output } })).instance.exports;
  const enc = (t) => new TextEncoder().encode(t);
  for (const f of files) { const nm = enc(path.basename(f)), d = fs.readFileSync(f), b = new Uint8Array(nm.length + 1 + d.length); b.set(nm); b.set(d, nm.length + 1); put(b); x.add_file(); }
  // DRIVE=<local folder>=<Windows folder>: the folder's files as installed on drive C:, the program starts there
  if (process.env.DRIVE) {
    const [local, win] = process.env.DRIVE.split('=');
    const walk = (d, w) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const lp = path.join(d, e.name), wp = w + '\\' + e.name; if (e.isDirectory()) walk(lp, wp); else { const nm = enc(wp), dt = fs.readFileSync(lp), b = new Uint8Array(nm.length + 1 + dt.length); b.set(nm); b.set(dt, nm.length + 1); put(b); x.add_file(); } } };
    if (x.set_home) { put(enc(win)); x.set_home(); }
    walk(local, win);
  }
  if (process.env.WINETRACE && x.set_wine_trace) { put(enc(process.env.WINETRACE)); x.set_wine_trace(); }
  if (process.env.WINEDEBUG && x.set_wine_debug) x.set_wine_debug(+process.env.WINEDEBUG || 1);
  if (process.env.TRACE) { traceFd = fs.openSync(process.env.TRACE, 'w'); if (!process.env.TRACE_AT) x.set_trace(1); } // TRACE_AT=s: start the log only then
  if (process.env.NOJIT) x.set_jit(0);
  put(enc(exe + '\0' + exe + (args ? ' ' + args : '')));
  const msg = () => new TextDecoder().decode(new Uint8Array(mem.buffer, (x.msg_ptr() >>> 0), x.msg_len()));
  const t0 = performance.now();
  let st = x.start() !== 0 ? 2 : 0, status = 'exit';
  // window tests: SHOT=file.ppm saves the last screen, INPUT=[[ms, kind, x, y, data], ...] plays input
  let frame = null; const input = JSON.parse(process.env.INPUT || '[]');
  let lastShot = 0;
  const saveShot = () => { if (!frame) return; const rgb = Buffer.alloc(1024 * 768 * 3); for (let i = 0; i < 1024 * 768; i++) { rgb[3 * i] = frame[4 * i]; rgb[3 * i + 1] = frame[4 * i + 1]; rgb[3 * i + 2] = frame[4 * i + 2]; } fs.writeFileSync(process.env.SHOT, Buffer.concat([Buffer.from('P6 1024 768 255\n'), rgb])); };
  const grab = () => { const p = x.win_frame ? x.win_frame() : 0; if (p) frame = new Uint8Array(mem.buffer, p, 1024 * 768 * 4).slice(); };
  // sockets: plain TCP from Node stands in for the page's wisp tunnel (see worker.js)
  const socks = new Map();
  const netIn = (id, kind, d) => { put(d || new Uint8Array(0)); x.win_net_in(id, kind); };
  const pumpNet = async () => {
    const n = x.win_net_poll ? x.win_net_poll() : 0; if (!n) return;
    const net = await import('net');
    const b = new Uint8Array(mem.buffer, (x.out_ptr() >>> 0), n).slice(), v = new DataView(b.buffer);
    for (let o = 0; o < n;) {
      const op = b[o], id = v.getUint32(o + 1, true), len = v.getUint32(o + 5, true), d = b.slice(o + 9, o + 9 + len); o += 9 + len;
      if (op === 1) { const s = new TextDecoder().decode(d), k = s.lastIndexOf(':'); const c = net.connect(+s.slice(k + 1), s.slice(0, k)); let any = false; socks.set(id, c); c.on('data', (q) => { any = true; netIn(id, 1, q); }); c.on('close', () => { if (socks.delete(id)) netIn(id, any ? 2 : 2); }); c.on('error', () => { if (socks.delete(id)) netIn(id, 3); }); }
      else if (op === 2) socks.get(id)?.write(d);
      else if (op === 3) { const c = socks.get(id); socks.delete(id); c?.end(); }
    }
  };
  while (st === 0 || st === 3) {
    await pumpNet();
    if (performance.now() - t0 > LIMIT_S * 1000) { status = 'timeout'; break; }
    if (process.env.SHOT) grab();
    if (process.env.SHOT && frame && performance.now() - lastShot > 30000) { lastShot = performance.now(); saveShot(); }
    while (input.length && performance.now() - t0 >= input[0][0]) { const [, k, ix, iy, d] = input.shift(); x.win_input(k, ix, iy, d); }
    if (process.env.TRACE_AT && traceFd !== null && performance.now() - t0 >= +process.env.TRACE_AT * 1000) { x.set_trace(1); delete process.env.TRACE_AT; }
    st = x.run(2000000);
    if (st === 3) await new Promise((r) => setTimeout(r, Math.min(50, Math.max(0, x.stat(17)))));
  }
  if (st === 2) status = "stopped";
  if (process.env.DBG) console.log("insns", x.stat(0), "rip", x.stat(11).toString(16), "threads", x.stat(18), "wins", x.win_count ? x.win_count() : -1);
  if (process.env.SHOT) { grab(); saveShot(); }
  if (traceFd !== null) { fs.writeSync(traceFd, out); fs.closeSync(traceFd); }
  const outFiles = [];
  for (let i = 0, n; (n = x.out_file(i)); i++) { const b = new Uint8Array(mem.buffer, (x.out_ptr() >>> 0), n); const nm = new TextDecoder().decode(b.subarray(0, b.indexOf(0))); outFiles.push(nm); let data = b.slice(b.indexOf(0) + 1); if (x.out_disk && x.out_disk(i) === 0x7FFFFFF0) { data = new Uint8Array(x.out_disk_size(i)); fs.readSync(spillFd, data, 0, data.length, x.out_disk_at(i)); } if (process.env.OUTDIR) fs.writeFileSync(path.join(process.env.OUTDIR, path.basename(nm.replace(/\\/g, '/'))), data); }
  if (spillFd !== null) { fs.closeSync(spillFd); fs.rmSync(path.join(os.tmpdir(), 'inksoc-spill-' + process.pid), { force: true }); spillFd = null; }
  const missing = [...new Set((out.match(/\[inksoc\] \S+ is not available yet/g) || []).map((s) => s.split(' ')[1]))];
  const ms = performance.now() - t0;
  if (process.env.PROF && x.prof_dump) { x.prof_dump(); console.error('PROF\n' + msg()); }
  console.log('\n' + JSON.stringify({ status, exitCode: x.stat(6), error: st === 2 ? msg() : (status === 'timeout' ? 'still running after ' + LIMIT_S + ' s' : ''), missing, out: out.slice(-4000), files: outFiles, mips: Math.round(x.stat(0) / ms / 1000) }));
}
