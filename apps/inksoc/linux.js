/* Linux terminal page: xterm.js in front, the engine (worker.js) behind. */
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
  const cw = probe.getBoundingClientRect().width / 50, ch = term.options.fontSize * 1.2;
  probe.remove();
  const cols = Math.max(20, Math.floor(box.width / cw)), rows = Math.max(5, Math.floor(box.height / ch));
  if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
  if (w) w.postMessage({ type: 'resize', rows: term.rows, cols: term.cols });
}

let w = null, starting = false;
let ctrl = false;
const send = (t) => { if (w) w.postMessage({ type: 'key', data: t }); };

async function start() {
  if (starting || w) return;
  starting = true;
  term.write('\x1b[2mStarting Alpine Linux on InkSoC…\x1b[0m\r\n');
  const data = await fetch('bin/busybox?v=1').then((r) => r.arrayBuffer());
  // Alpine's minirootfs (musl, apk): unpacked at / by the engine; its programs use the shared libraries
  const files = [{ name: 'busybox', data }];
  try {
    const r = await fetch('bin/alpine-rootfs.tar.gz?v=1');
    const tar = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    files.push({ name: 'rootfs.tar', data: tar });
  } catch (e) { term.write('\x1b[2m(Alpine files unavailable: BusyBox only)\x1b[0m\r\n'); }
  w = new Worker('worker.js?v=21');
  starting = false;
  fit();
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
    } else if (m.type === 'done') {
      term.write('\r\n\x1b[2m[' + (m.error ? 'stopped: ' + m.error : 'shell ended') + ' · tap to start again]\x1b[0m\r\n');
      if (w) w.terminate();
      w = null;
    }
  };
  w.postMessage({ type: 'linux', files, cmd: 'sh -l', poolMb: 512, jit: true, rows: term.rows, cols: term.cols }, files.map((f) => f.data));
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
$('up').onclick = () => $('file').click();
$('file').onchange = async () => {
  for (const f of $('file').files) {
    const data = await f.arrayBuffer();
    if (w) w.postMessage({ type: 'put', name: f.name, data }, [data]);
    term.write('\r\n\x1b[2m[' + f.name + ' → /root/' + f.name + ']\x1b[0m\r\n');
  }
  $('file').value = '';
  send('');
};
$('down').onclick = () => {
  const p = prompt('File to download (path, e.g. /root/notes.txt):', '/root/');
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
