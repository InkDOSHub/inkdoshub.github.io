/* InkSoC desktop: each program runs in its own engine worker. Its screen is a
   full-desktop canvas, transparent outside its windows, stacked with the others;
   console output goes to a console window. */
'use strict';
const $ = (id) => document.getElementById(id);
const desk = $('desk');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const W = 1024, H = 768;
const progs = [];
let zTop = 10, nextId = 1;

// fixed real RAM: the same rule as the tests page (half the lowest tab limit seen)
function poolMb() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('inksoc-limits')) || {}; } catch (e) {}
  const lim = s.minLimit || (s.calib && !s.calib.running && s.calib.mb) || 0;
  return lim ? Math.max(128, Math.min(2048, Math.floor(lim * 0.5 / 64) * 64)) : 256;
}

// the program screens are scaled to fit the desktop
let scale = 1;
function fit() {
  scale = Math.min(desk.clientWidth / W, desk.clientHeight / H);
  for (const p of progs) if (p.cv) { p.cv.style.width = W * scale + 'px'; p.cv.style.height = H * scale + 'px'; }
}
addEventListener('resize', fit);

function raise(p) {
  p.z = ++zTop;
  if (p.cv) p.cv.style.zIndex = p.z;
  if (p.con) p.con.style.zIndex = p.z + (p.cv ? 0.5 : 0);
  for (const q of progs) q.btn.classList.toggle('on', q === p);
}
function setHidden(p, h) {
  p.hidden = h;
  if (p.cv) p.cv.hidden = h;
  if (p.con) p.con.hidden = h || p.conAway;
}

function consoleWindow(p, title) {
  const c = document.createElement('div');
  c.className = 'con';
  const n = progs.length;
  c.style.left = 12 + (n % 5) * 28 + 'px';
  c.style.top = 12 + (n % 5) * 28 + 'px';
  c.innerHTML = '<div class="t"><span></span><button title="Hide">–</button><button title="Stop">✕</button></div><table></table><pre></pre>';
  c.querySelector('span').textContent = title + ' — Console';
  const [hide, stop] = c.querySelectorAll('button');
  hide.onclick = () => setHidden(p, true);
  stop.onclick = () => close(p);
  // drag by the title bar
  const t = c.querySelector('.t');
  t.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    raise(p);
    t.setPointerCapture(e.pointerId);
    const x0 = e.clientX - c.offsetLeft, y0 = e.clientY - c.offsetTop;
    t.onpointermove = (m) => {
      c.style.left = Math.max(-c.offsetWidth + 60, Math.min(desk.clientWidth - 60, m.clientX - x0)) + 'px';
      c.style.top = Math.max(0, Math.min(desk.clientHeight - 30, m.clientY - y0)) + 'px';
    };
    t.onpointerup = () => { t.onpointermove = null; };
  });
  c.addEventListener('pointerdown', () => raise(p));
  desk.append(c);
  return c;
}

function close(p) {
  // ask the program to stop so its files are kept on drive C:; force it after 5 s
  if (p.w) { const w = p.w; w.onmessage = (ev) => { if (ev.data.type === 'done') { w.terminate(); listDrive(); } }; w.postMessage({ type: 'stop' }); setTimeout(() => w.terminate(), 5000); }
  p.w = null;
  if (p.cv) p.cv.remove();
  if (p.con) p.con.remove();
  p.btn.remove();
  progs.splice(progs.indexOf(p), 1);
  if (focus === p) focus = null;
}

function run(files, exe, args, label, home) {
  const p = { id: nextId++, z: 0, hidden: false, conAway: false };
  progs.push(p);
  p.btn = document.createElement('button');
  p.btn.className = 'task';
  p.btn.textContent = label;
  p.btn.onclick = () => {
    if (p.hidden) { setHidden(p, false); raise(p); }
    else if (p.z === zTop) setHidden(p, true);
    else raise(p);
  };
  $('tasks').append(p.btn);
  p.con = consoleWindow(p, label);
  const out = p.con.querySelector('pre');
  raise(p);
  const w = p.w = new Worker('worker.js?v=48');
  w.onmessage = (ev) => {
    const d = ev.data;
    if (d.type === 'log') { out.textContent += d.text; out.scrollTop = out.scrollHeight; }
    else if (d.type === 'stats') {
      const gips = d.insns / d.ms / 1e6;
      p.con.querySelector('table').innerHTML = '<tr><td>' + fmt(d.insns / d.ms / 1000) + ' MIPS · ' + (d.jit ? 'JIT' : 'interpreter') + ' · ' + d.cores + (d.cores > 1 ? ' cores' : ' core') + (d.threads > 1 ? ' · ' + d.threads + ' threads' : '') + ' · RAM ' + fmt(d.resident * 4 / 1024) + '/' + fmt(d.frames * 4 / 1024) + ' MB' + (d.swapOut || d.swapIn ? ' · swap ' + fmt(d.swapOut * 4 / 1024) + ' MB out, ' + fmt(d.swapIn * 4 / 1024) + ' MB in, ' + fmt(d.swapMs) + ' ms on ' + (d.opfs ? 'OPFS' : 'RAM') : '') + '</td></tr>';
      $('speed').textContent = d.cores + (d.cores > 1 ? ' cores' : ' core') + ' · ' + (gips >= 1 ? gips.toFixed(1) + ' GIPS' : fmt(gips * 1000) + ' MIPS');
    } else if (d.type === 'frame') frame(p, d);
    else if (d.type === 'done') {
      listDrive();
      // a program with windows that printed nothing: no console to show at the end either
      const quiet = p.cv && !out.textContent.trim();
      out.innerHTML += d.ok ? '<b class="ok">\nFinished (exit code 0).</b>' : '<b class="bad">\n' + (d.error ? 'Stopped: ' + d.error : 'Exit code ' + d.exitCode) + '</b>';
      for (const f of d.out || []) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([f.data]));
        a.download = f.name;
        a.textContent = `\nDownload ${f.name} (${fmt(f.data.length)} bytes)`;
        out.append(a);
      }
      out.scrollTop = out.scrollHeight;
      w.terminate();
      p.w = null;
      if (p.cv) { p.cv.remove(); p.cv = null; }
      if (quiet && d.ok) { close(p); return; }
      p.conAway = false;
      setHidden(p, false);
      raise(p);
    }
  };
  w.postMessage({ type: 'exec', files, exe, cmd: (/\s/.test(exe) ? '"' + exe + '"' : exe) + (args ? ' ' + args : ''), drive: true, home, poolMb: poolMb(), targetMb: 8192,
    jit: $('jit').checked, cores: +$('cores').value, strong: new URLSearchParams(location.search).get('strong') !== '0', opt: new URLSearchParams(location.search).get('opt') !== '0' },
  files ? files.map((f) => f.data) : []);
}

// a program's screen: shown the first time it draws a window; its console steps aside
function frame(p, d) {
  if (!p.cv) {
    p.cv = document.createElement('canvas');
    p.cv.width = W; p.cv.height = H;
    desk.append(p.cv);
    p.ctx = p.cv.getContext('2d');
    p.conAway = true; p.con.hidden = true; // its log returns if it stops with an error
    fit();
    raise(p);
    focus = p;
  }
  p.px = new Uint8ClampedArray(d.data);
  p.ctx.putImageData(new ImageData(p.px, d.w, d.h), 0, 0);
}

/* ---------- mouse and keyboard: the topmost program with a window under the pointer ---------- */
let focus = null, held = null;
const at = (e) => { const r = desk.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / scale), Math.round((e.clientY - r.top) / scale)]; };
const send = (p, k, x, y, d) => { if (p && p.w) p.w.postMessage({ type: 'win', k, x, y, d }); };
function hit(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  const list = progs.filter((p) => p.cv && !p.hidden && p.px).sort((a, b) => b.z - a.z);
  for (const p of list) if (p.px[(y * W + x) * 4 + 3]) return p;
  return null;
}
desk.addEventListener('pointerdown', (e) => {
  if (e.target !== desk) return;
  const [x, y] = at(e);
  const p = hit(x, y);
  closePops();
  if (!p) return;
  held = p; focus = p;
  raise(p);
  desk.setPointerCapture(e.pointerId);
  send(p, 1, x, y, 0); send(p, 2, x, y, e.button);
  e.preventDefault();
});
desk.addEventListener('pointermove', (e) => {
  const [x, y] = at(e);
  const p = held || hit(x, y);
  if (p) send(p, 1, x, y, 0);
});
desk.addEventListener('pointerup', (e) => {
  if (!held) return;
  const [x, y] = at(e);
  send(held, 3, x, y, e.button);
  held = null;
});
desk.addEventListener('contextmenu', (e) => e.preventDefault());
const key = (kind) => (e) => {
  if (!focus || !focus.cv || e.target.tagName === 'INPUT') return;
  const special = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27 };
  const ch = kind === 4 ? (e.key.length === 1 ? e.key.codePointAt(0) : special[e.key] || 0) : 0;
  send(focus, kind, 0, 0, (e.keyCode & 0xFF) | (ch << 16));
  e.preventDefault();
};
addEventListener('keydown', key(4));
addEventListener('keyup', key(5));

/* ---------- menu and info ---------- */
function closePops() { $('menu').hidden = true; $('infop').hidden = true; }
$('start').onclick = (e) => { e.stopPropagation(); const h = $('menu').hidden; closePops(); $('menu').hidden = !h; if (h) listDrive(); };
$('info').onclick = (e) => { e.stopPropagation(); const h = $('infop').hidden; closePops(); $('infop').hidden = !h; };
document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });

const builtins = {
  mine: { url: 'bin/winemine.exe?v=1', name: 'winemine.exe', label: '💣 WineMine' },
  mine32: { url: 'bin/wine32/winemine32.exe?v=1', name: 'winemine32.exe', label: '💣 WineMine 32' },
  '7z': { url: 'bin/7za.exe?v=1', name: '7za.exe', label: '🗜 7-Zip', args: () => 'b -md18 -mmt' + $('cores').value },
  // 64 MB dictionary: about 1.5 GB of program memory, more than the real RAM, so pages go to swap
  '7zswap': { url: 'bin/7za.exe?v=1', name: '7za.exe', label: '💾 7-Zip swap', args: () => 'b 1 -md26 -mmt' + $('cores').value },
};
for (const b of document.querySelectorAll('[data-run]')) {
  b.onclick = async () => {
    closePops();
    const k = builtins[b.dataset.run];
    const data = await fetch(k.url).then((r) => r.arrayBuffer());
    run([{ name: k.name, data }], k.name, $('args').value.trim() || (k.args ? k.args() : ''), k.label);
  };
}

// Picked files add up: a DLL or data file picked later joins the .exe picked before
// (some browsers hand over only one file per pick). Names like "7z (1).dll" are fixed.
const picked = new Map();
$('pick').onchange = async (ev) => {
  for (const f of ev.target.files) {
    const name = f.name.replace(/ \(\d+\)(?=\.[^.]+$)/, '');
    picked.set(name.toLowerCase(), { name, data: await f.arrayBuffer() });
  }
  ev.target.value = '';
  closePops();
  const all = [...picked.values()];
  const exes = all.filter((f) => /\.exe$/i.test(f.name));
  // a Windows Installer package: Windows' own msiexec installs it
  const msi = all.filter((f) => /\.msi$/i.test(f.name)).pop();
  if (msi && !exes.length) {
    picked.clear();
    const data = await fetch('bin/wine/wine-msiexec.exe?v=1').then((r) => r.arrayBuffer());
    run([{ name: 'msiexec.exe', data }, ...all.map((f) => ({ name: f.name, data: f.data.slice(0) }))], 'msiexec.exe', '/i "' + msi.name + '"' + ($('args').value.trim() ? ' ' + $('args').value.trim() : ''), '📦 ' + msi.name.replace(/\.msi$/i, ''));
    return;
  }
  if (!exes.length) { $('speed').textContent = 'Picked ' + all.length + ' file(s): now pick the .exe or .msi'; return; }
  const exe = exes[exes.length - 1];
  run(all.map((f) => ({ name: f.name, data: f.data.slice(0) })), exe.name, $('args').value.trim(), '🪟 ' + exe.name.replace(/\.exe$/i, ''));
};

/* ---------- drive C: (OPFS folder "inksoc-c", kept apart from the swap file) ---------- */
// installed programs: the .exe files in the folders of Program Files and other top folders
const skip = /^(unins|uninst|setup|install|update|crash)/i;
const system = /^(windows|programdata|users|inksoc|program files( \(x86\))?)$/i;
async function listDrive() {
  let root;
  try { root = await (await navigator.storage.getDirectory()).getDirectoryHandle('inksoc-c'); } catch (e) { $('csize').textContent = 'empty'; $('installed').replaceChildren(); return; }
  let bytes = 0;
  const found = [];
  const walk = async (dir, path, depth) => {
    for await (const [name, h] of dir.entries()) {
      const p = path + '\\' + name;
      if (h.kind === 'directory') await walk(h, p, depth + 1);
      else {
        bytes += (await h.getFile()).size;
        const top = p.split('\\')[1] || '';
        const deep = /^program files/i.test(top) ? 3 : 2; // C:\Program Files\App\app.exe or C:\App\app.exe
        if (depth === deep && /\.exe$/i.test(name) && !skip.test(name) && (deep === 3 || !system.test(top))) found.push(p.replace(/^C/, 'C:'));
      }
    }
  };
  try { const c = await root.getDirectoryHandle('C'); await walk(c, 'C', 1); } catch (e) { /* nothing installed yet */ }
  for await (const [, h] of root.entries()) if (h.kind === 'file') bytes += (await h.getFile()).size;
  $('csize').textContent = bytes ? fmt(bytes / 1048576) + ' MB' : 'empty';
  found.sort((a, b) => a.localeCompare(b));
  $('installed').replaceChildren(...(found.length ? [document.createElement('hr')] : []), ...found.map((path) => {
    const b = document.createElement('button');
    b.className = 'it';
    const name = path.split('\\').pop().replace(/\.exe$/i, '');
    b.textContent = '📦 ' + name;
    b.title = path;
    b.onclick = () => { closePops(); run([], path, $('args').value.trim(), '🪟 ' + name, path.slice(0, path.lastIndexOf('\\'))); };
    return b;
  }));
}
// erase: a second tap within 4 seconds confirms
let eraseAsk = 0;
$('cerase').onclick = async (e) => {
  e.stopPropagation();
  if (Date.now() - eraseAsk > 4000) { eraseAsk = Date.now(); $('cerase').textContent = 'Tap again'; setTimeout(() => { $('cerase').textContent = 'Erase'; }, 4000); return; }
  eraseAsk = 0;
  $('cerase').textContent = 'Erase';
  try { await (await navigator.storage.getDirectory()).removeEntry('inksoc-c', { recursive: true }); } catch (err) { /* already empty */ }
  listDrive();
};
// keep drive C: when the browser runs short of space
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
listDrive();

// default: up to 4 cores where the page is isolated (shared memory), 1 elsewhere
$('cores').value = String(self.crossOriginIsolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4)) : 1);
fit();
