/* Alpine Linux terminal: the engine (engine.wasm, a fixed copy of InkSoC kept for this app)
   runs Alpine's programs; this worker feeds it keys, saves the files in OPFS and carries
   the sockets over a wisp tunnel (our server or a public one). */
'use strict';
const NETS = { hub: 'wss://hub.inkdos.workers.dev/net/wisp/', wisp: 'wss://wisp.mercurywork.shop/v86/', off: null };
const SAVE = 'alpine-fs.tar';
const out = (t) => postMessage({ type: 'out', text: t });
let x, mem, lx = null, keys = [], net = 'hub';
const enc = new TextEncoder(), dec = new TextDecoder();
const put = (b) => { const p = x.buffer(b.length); new Uint8Array(mem.buffer, p, b.length).set(b); };

async function opfs() { try { return await navigator.storage.getDirectory(); } catch (e) { return null; } }
async function loadSaved() {
  const root = await opfs(); if (!root) return null;
  try { const f = await (await root.getFileHandle(SAVE)).getFile(); return f.size ? await f.arrayBuffer() : null; } catch (e) { return null; }
}
let saving = false;
async function save() {
  if (saving) return; saving = true;
  try {
    const n = x.linux_save_tar();
    const data = new Uint8Array(mem.buffer, x.out_ptr(), n).slice();
    const root = await opfs();
    if (root) {
      const fh = await root.getFileHandle(SAVE, { create: true });
      if (fh.createWritable) { const w = await fh.createWritable(); await w.write(data); await w.close(); }
      else { const h = await fh.createSyncAccessHandle(); h.truncate(0); h.write(data, { at: 0 }); h.flush(); h.close(); }
    }
  } catch (e) { out('\r\n\x1b[2m[could not save the files: ' + e.message + ']\x1b[0m\r\n'); }
  saving = false;
}

/* ---- network: wisp v1 ([type][stream u32 LE][payload]; 1 CONNECT, 2 DATA, 3 CONTINUE, 4 CLOSE) ---- */
let ws = null, wsq = [], got = new Set();
function wsSend(b) { if (ws && ws.readyState === 1) ws.send(b); else wsq.push(b); }
function packet(t, id, body) { const b = new Uint8Array(5 + body.length); b[0] = t; new DataView(b.buffer).setUint32(1, id, true); b.set(body, 5); return b; }
function netIn(id, kind, d) { put(d || new Uint8Array(0)); x.linux_net_in(id, kind); }
function openWs() {
  ws = new WebSocket(NETS[net]); ws.binaryType = 'arraybuffer';
  ws.onopen = () => { for (const b of wsq) ws.send(b); wsq = []; };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') return;
    const b = new Uint8Array(ev.data); if (b.length < 5) return;
    const id = new DataView(b.buffer).getUint32(1, true);
    if (b[0] === 2) { got.add(id); netIn(id, 1, b.subarray(5)); }
    else if (b[0] === 4) netIn(id, got.has(id) || b[5] === 2 ? 2 : 3);
  };
  const lost = () => { ws = null; wsq = []; };
  ws.onclose = lost; ws.onerror = lost;
}
function pumpNet() {
  const n = x.linux_net_poll(); if (!n) return;
  const b = new Uint8Array(mem.buffer, x.out_ptr(), n).slice(), v = new DataView(b.buffer);
  for (let o = 0; o < n;) {
    const op = b[o], id = v.getUint32(o + 1, true), len = v.getUint32(o + 5, true), d = b.subarray(o + 9, o + 9 + len); o += 9 + len;
    if (op === 1) {
      if (!NETS[net]) { netIn(id, 3); continue; }
      if (!ws) openWs();
      const s = dec.decode(d), k = s.lastIndexOf(':'), host = enc.encode(s.slice(0, k)), body = new Uint8Array(3 + host.length);
      body[0] = 1; new DataView(body.buffer).setUint16(1, +s.slice(k + 1), true); body.set(host, 3);
      wsSend(packet(1, id, body));
    } else if (op === 2) wsSend(packet(2, id, d));
    else if (op === 3) { got.delete(id); wsSend(packet(4, id, new Uint8Array([2]))); }
  }
}

const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

async function run({ rows, cols, network }) {
  if (network in NETS) net = network;
  const env = {
    host_console: (p, n) => out(dec.decode(new Uint8Array(mem.buffer, p, n).slice(), { stream: true })),
    host_now_ms: () => performance.now(),
    host_epoch_ms: () => Date.now(),
    host_swap_write: () => { throw new Error('swap'); },
    host_swap_read: () => { throw new Error('swap'); },
    wine_call: () => 0,
    host_jit: (p, n) => {
      try {
        const m = new WebAssembly.Module(new Uint8Array(mem.buffer, p, n).slice());
        const i = new WebAssembly.Instance(m, { env: { memory: mem, rd: x.jit_rd, wr: x.jit_wr, step: x.jit_step, cond: x.jit_cond } });
        const t = x.__indirect_function_table, k = t.grow(1);
        t.set(k, i.exports.f);
        return k;
      } catch (e) { return -1; }
    },
  };
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ': ' + r.status); return r; });
  const [wasm, busybox, overlay, saved] = await Promise.all([
    get('engine.wasm?v=2').then((r) => r.arrayBuffer()), get('busybox?v=1').then((r) => r.arrayBuffer()),
    get('overlay.tar?v=2').then((r) => r.arrayBuffer()), loadSaved()]);
  let rootfs = saved;
  if (!rootfs) {
    out('\x1b[2mDownloading Alpine Linux 3.21 (3.5 MB)…\x1b[0m\r\n');
    const r = await get('alpine-rootfs.tar.gz?v=1');
    rootfs = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  x = (await WebAssembly.instantiate(wasm, { env })).instance.exports;
  mem = x.memory;
  const addFile = (name, data) => {
    const nm = enc.encode(name), d = new Uint8Array(data), b = new Uint8Array(nm.length + 1 + d.length);
    b.set(nm); b.set(d, nm.length + 1); put(b); x.add_file();
  };
  x.init(768, 4096);
  addFile('busybox', busybox); addFile('rootfs.tar', rootfs); addFile('zoverlay.tar', overlay);
  put(enc.encode('busybox\0sh /etc/inksoc/start'));
  if (x.start() !== 0) { postMessage({ type: 'done', error: dec.decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice()) }); return; }
  x.linux_winsize(rows || 30, cols || 100);
  x.linux_dirty(); // unpacking is not a change; the first save happens after the first real one
  let line = '', lastCr = false;
  const send = (t) => { const b = enc.encode(t); put(b); x.linux_stdin(b.length); };
  lx = {
    resize(r, c) { x.linux_winsize(r, c); },
    put(name, data) { const nm = enc.encode(name), d = new Uint8Array(data), b = new Uint8Array(nm.length + 1 + d.length); b.set(nm); b.set(d, nm.length + 1); put(b); x.linux_put_file(); },
    get(path) { put(enc.encode(path)); const n = x.linux_get_file(); return n < 0 ? null : new Uint8Array(mem.buffer, x.out_ptr(), n).slice(); },
  };
  const feed = () => {
    while (keys.length) {
      const s = keys.shift();
      const lf = x.linux_lflag(), canon = lf & 2, echo = lf & 8;
      if (!canon) { send(s); continue; }
      if (s.startsWith('\x1b[') && /R$/.test(s)) continue; // a cursor-position answer nobody asked for in line mode
      for (const ch of s) {
        const afterCr = lastCr; lastCr = ch === '\r';
        if (ch === '\n' && afterCr) continue; // \r\n from some keyboards is one Enter, not two
        if (ch === '\x03') { x.linux_interrupt(); line = ''; out('^C\r\n'); }
        else if (ch === '\r' || ch === '\n') { if (echo) out('\r\n'); send(line + '\n'); line = ''; }
        else if (ch === '\x7f' || ch === '\b') { if (line) { line = [...line].slice(0, -1).join(''); if (echo) out('\b \b'); } }
        else if (ch === '\x04') { if (line) { send(line); line = ''; } else x.linux_eof(); }
        else if (ch === '\x15') { if (echo) out('\b \b'.repeat([...line].length)); line = ''; }
        else if (ch >= ' ' || ch === '\t') { line += ch; if (echo) out(ch); }
      }
    }
  };
  let st, lastSave = performance.now();
  while (true) {
    feed();
    st = x.run(2000000);
    pumpNet();
    if (st === 1 || st === 2) break;
    if (st === 3) {
      const t = performance.now();
      if (t - lastSave > 3000 && x.linux_dirty()) { lastSave = t; await save(); }
      await new Promise((r) => setTimeout(r, Math.min(30, Math.max(0, x.stat(17)))));
    } else await yieldNow();
  }
  if (x.linux_dirty()) await save();
  lx = null;
  postMessage({ type: 'done', error: st === 2 ? dec.decode(new Uint8Array(mem.buffer, x.msg_ptr(), x.msg_len()).slice()) : '' });
}

onmessage = async (ev) => {
  const d = ev.data;
  if (d.type === 'key') { keys.push(d.data); return; }
  if (d.type === 'resize') { if (lx) lx.resize(d.rows, d.cols); return; }
  if (d.type === 'put') { if (lx) lx.put(d.name, d.data); return; }
  if (d.type === 'get') { postMessage({ type: 'file', path: d.path, data: lx ? lx.get(d.path) : null }); return; }
  if (d.type === 'net') { net = d.network; if (ws) { try { ws.close(); } catch (e) {} ws = null; } return; }
  if (d.type === 'save') { if (lx) { await save(); } postMessage({ type: 'saved' }); return; }
  if (d.type === 'reset') { const root = await opfs(); if (root) { try { await root.removeEntry(SAVE); } catch (e) {} } postMessage({ type: 'reset' }); return; }
  if (d.type === 'start') { try { await run(d); } catch (e) { postMessage({ type: 'done', error: e.message }); } }
};
