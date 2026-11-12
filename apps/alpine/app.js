/* Alpine Linux terminal page: xterm.js in front, the engine (worker.js) behind. */
'use strict';
const $ = (id) => document.getElementById(id);
const term = new Terminal({
  convertEol: true, cursorBlink: true, fontSize: 14, scrollback: 5000,
  fontFamily: 'ui-monospace, Menlo, "SF Mono", Consolas, monospace',
  theme: { background: '#0b0b0d' },
});
term.open($('term'));

// size the terminal to its box (no fit add-on: measure one character)
function fit() {
  const box = $('term').getBoundingClientRect();
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-family:' + term.options.fontFamily + ';font-size:' + term.options.fontSize + 'px;line-height:normal';
  probe.textContent = 'W'.repeat(50);
  document.body.appendChild(probe);
  let cw = probe.getBoundingClientRect().width / 50, ch = term.options.fontSize * 1.2;
  probe.remove();
  // xterm's own cell size when it has one (Safari's line height differs from the estimate, and too many rows covered the key bar)
  try { const c = term._core._renderService.dimensions.css.cell; if (c.width > 0 && c.height > 0) { cw = c.width; ch = c.height; } } catch (e) {}
  const cols = Math.max(20, Math.floor(box.width / cw)), rows = Math.max(5, Math.floor(box.height / ch));
  if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
  if (w) w.postMessage({ type: 'resize', rows: term.rows, cols: term.cols });
}

// network: wisp (public wisp server, the one the v86 Linux terminals use) or off
const NET_NAMES = { wisp: 'wisp', off: 'No network' };
let network = 'wisp';
try { network = localStorage.getItem('alpine-net') || 'wisp'; } catch (e) {}
if (!(network in NET_NAMES)) network = 'wisp';
const showNet = () => { $('net').textContent = NET_NAMES[network]; };
showNet();
$('net').onclick = () => {
  const order = ['wisp', 'off'];
  network = order[(order.indexOf(network) + 1) % order.length];
  try { localStorage.setItem('alpine-net', network); } catch (e) {}
  showNet();
  if (w) w.postMessage({ type: 'net', network });
};

let w = null, starting = false;
let ctrl = false;
const send = (t) => { if (w) w.postMessage({ type: 'key', data: t }); };

function start() {
  if (starting || w) return;
  starting = true;
  term.write('\x1b[2mStarting Alpine Linux on InkSoC…\x1b[0m\r\n');
  w = new Worker('worker.js?v=4');
  starting = false;
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'out') term.write(m.text);
    else if (m.type === 'file') {
      if (!m.data) { term.write('\r\n\x1b[31m' + m.path + ': not found\x1b[0m\r\n'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([m.data]));
      a.download = m.path.split('/').pop() || 'file';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } else if (m.type === 'saved') term.write('\r\n\x1b[2m[files saved]\x1b[0m\r\n');
    else if (m.type === 'reset') location.reload();
    else if (m.type === 'done') {
      term.write('\r\n\x1b[2m[' + (m.error ? 'stopped: ' + m.error : 'Linux ended') + ' · tap to start again]\x1b[0m\r\n');
      if (w) w.terminate();
      w = null;
    }
  };
  fit();
  w.postMessage({ type: 'start', rows: term.rows, cols: term.cols, network });
}

term.onData((d) => {
  if (!w) { if (!starting) { term.reset(); start(); } return; }
  if (ctrl && d.length === 1) {
    const c = d.toUpperCase().charCodeAt(0);
    if (c >= 64 && c < 96) d = String.fromCharCode(c - 64);
    ctrl = false; $('ctrl').classList.remove('on');
  }
  send(d);
});

const K = { esc: '\x1b', tab: '\t', '^C': '\x03', '^D': '\x04', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D' };
$('keys').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const k = b.dataset.k;
  if (k === 'ctrl') { ctrl = !ctrl; b.classList.toggle('on', ctrl); }
  else send(K[k] || k);
  term.focus();
});

$('i').onclick = () => $('info').classList.toggle('show');
$('menu').onclick = () => $('menubox').classList.toggle('show');
$('save').onclick = () => { $('menubox').classList.remove('show'); if (w) w.postMessage({ type: 'save' }); };
$('reset').onclick = () => {
  if (!confirm('Erase your Linux user, files and installed programs, and start again from a clean Alpine?')) return;
  const go = () => { const r = new Worker('worker.js?v=4'); r.onmessage = () => location.reload(); r.postMessage({ type: 'reset' }); };
  if (w) { w.terminate(); w = null; }
  go();
};
$('up').onclick = () => $('file').click();
$('file').onchange = async () => {
  for (const f of $('file').files) {
    const data = await f.arrayBuffer();
    if (w) w.postMessage({ type: 'put', name: f.name, data }, [data]);
    term.write('\r\n\x1b[2m[' + f.name + ' → your home folder]\x1b[0m\r\n');
  }
  $('file').value = '';
  send('');
};
$('down').onclick = () => {
  const p = prompt('File to download (path, e.g. /home/you/notes.txt):', '/home/');
  if (p && w) w.postMessage({ type: 'get', path: p });
};

addEventListener('resize', () => fit());
// iPhone/iPad: the on-screen keyboard covers the page; shrink it to the visible area so the key bar stays above the keyboard
const vv = window.visualViewport;
if (vv) {
  const fitView = () => { document.body.style.height = vv.height + 'px'; window.scrollTo(0, 0); fit(); };
  vv.addEventListener('resize', fitView);
  vv.addEventListener('scroll', () => window.scrollTo(0, 0));
  fitView();
}
// no auto-capitals or auto-correct in the terminal
const ta = document.querySelector('.xterm-helper-textarea');
if (ta) { ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocorrect', 'off'); ta.setAttribute('spellcheck', 'false'); ta.setAttribute('autocomplete', 'off'); }
start();
term.focus();
