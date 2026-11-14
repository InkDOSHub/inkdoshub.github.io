/* InkSoC tools: "Files" (a folder browser for drive C:) and "Console" (a few cmd-style
   commands). Both are plain page code over the drive's storage (OPFS folder "inksoc-c/C"):
   this file loads the first time one is opened, and they use no CPU while they wait, so a
   program keeps the whole engine. They step aside (hide) when a program starts. */
'use strict';

/* ---------- drive C: paths ---------- */
const driveRoot = async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle('inksoc-c', { create: true })).getDirectoryHandle('C', { create: true });
// "C:\a\b" or "a\b" (from cwd) -> ['a', 'b']; ".." and "." work
function pathParts(cwd, p) {
  p = (p || '').replace(/\//g, '\\').trim().replace(/^"|"$/g, '');
  let parts = /^[a-z]:/i.test(p) ? [] : cwd.slice();
  p = p.replace(/^[a-z]:/i, '');
  if (p.startsWith('\\')) parts = [];
  for (const s of p.split('\\')) {
    if (!s || s === '.') continue;
    if (s === '..') parts.pop();
    else parts.push(s);
  }
  return parts;
}
const showPath = (parts) => 'C:\\' + parts.join('\\');
// the folder at parts (null when it is not there); names match whatever their case
async function dirAt(parts, create) {
  let d = await driveRoot();
  for (const s of parts) {
    const n = await realName(d, s);
    try { d = await d.getDirectoryHandle(n || s, { create: !!create }); } catch (e) { return null; }
  }
  return d;
}
async function realName(dir, name) {
  const low = name.toLowerCase();
  for await (const k of dir.keys()) if (k.toLowerCase() === low) return k;
  return null;
}
// the entry at parts: { dir (its folder), name, h (handle) } or null
async function entryAt(parts) {
  if (!parts.length) return null;
  const dir = await dirAt(parts.slice(0, -1));
  if (!dir) return null;
  const name = await realName(dir, parts[parts.length - 1]);
  if (!name) return null;
  let h;
  try { h = await dir.getFileHandle(name); } catch (e) { h = await dir.getDirectoryHandle(name); }
  return { dir, name, h };
}
async function listDir(dir) {
  const out = [];
  for await (const [name, h] of dir.entries()) out.push({ name, h, dir: h.kind === 'directory', size: h.kind === 'file' ? (await h.getFile()).size : 0 });
  return out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
async function copyFile(h, toDir, name) {
  const w = await (await toDir.getFileHandle(name, { create: true })).createWritable();
  await (await h.getFile()).stream().pipeTo(w);
}
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.ceil(n / 1024) + ' KB' : n + ' B');
const runExe = (parts) => { const path = showPath(parts), name = parts[parts.length - 1].replace(/\.exe$/i, ''); run([], path, '', '🪟 ' + name, showPath(parts.slice(0, -1))); };

/* ---------- a tool window (looks like a console window, has a bar button) ---------- */
function toolWindow(label, cls) {
  const p = { id: nextId++, z: 0, hidden: false, conAway: false, tool: true };
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
  p.con.classList.add(cls);
  p.con.querySelector('span').textContent = label;
  p.con.querySelector('table').remove();
  raise(p);
  return p;
}

/* ---------- Files ---------- */
function openFiles() {
  const old = progs.find((q) => q.tool === 'files');
  if (old) { setHidden(old, false); raise(old); return; }
  const p = toolWindow('📁 Files', 'files');
  p.tool = 'files';
  const pre = p.con.querySelector('pre');
  const head = document.createElement('div');
  head.className = 'fbar';
  head.innerHTML = '<button title="Up">↑</button><span></span><label title="Add files here">＋<input type="file" multiple hidden></label>';
  pre.before(head);
  const list = document.createElement('div');
  list.className = 'flist';
  pre.replaceWith(list);
  let cwd = [];
  const [up] = head.querySelectorAll('button');
  up.onclick = () => { cwd.pop(); show(); };
  head.querySelector('input').onchange = async (ev) => {
    const dir = await dirAt(cwd, true);
    for (const f of ev.target.files) { const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable(); await f.stream().pipeTo(w); }
    ev.target.value = '';
    show();
    listDrive();
  };
  let ask = null;
  async function show() {
    head.querySelector('span').textContent = showPath(cwd);
    up.disabled = !cwd.length;
    const dir = await dirAt(cwd);
    if (!dir) { cwd = []; return show(); }
    const items = await listDir(dir);
    list.replaceChildren(...items.map((it) => {
      const row = document.createElement('div');
      row.className = 'frow';
      const exe = !it.dir && /\.exe$/i.test(it.name);
      row.innerHTML = '<span class="n"></span><span class="z"></span><button title="Download">⬇</button><button title="Delete">🗑</button>';
      row.querySelector('.n').textContent = (it.dir ? '📁 ' : exe ? '🪟 ' : '📄 ') + it.name;
      row.querySelector('.z').textContent = it.dir ? '' : size(it.size);
      const [dl, del] = row.querySelectorAll('button');
      if (it.dir) dl.remove();
      else dl.onclick = async () => { const a = document.createElement('a'); a.href = URL.createObjectURL(await it.h.getFile()); a.download = it.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); };
      // delete: a second tap within 4 seconds confirms
      del.onclick = async () => {
        if (ask !== del) { ask = del; del.textContent = 'Sure?'; setTimeout(() => { if (ask === del) { ask = null; del.textContent = '🗑'; } }, 4000); return; }
        ask = null;
        try { await dir.removeEntry(it.name, { recursive: true }); } catch (e) { del.textContent = '⚠'; del.title = 'In use by a running program'; return; }
        show();
        listDrive();
      };
      row.querySelector('.n').onclick = () => {
        if (it.dir) { cwd.push(it.name); show(); }
        else if (exe) runExe([...cwd, it.name]);
        else dl.click();
      };
      return row;
    }));
    if (!items.length) list.innerHTML = '<div class="empty">Empty folder</div>';
  }
  p.refresh = show;
  show();
}

/* ---------- Console ---------- */
function openConsole() {
  const p = toolWindow('⌨️ Console', 'cmd');
  p.tool = 'console';
  const out = p.con.querySelector('pre');
  const line = document.createElement('input');
  line.className = 'cline';
  line.autocapitalize = 'off';
  line.autocomplete = 'off';
  line.spellcheck = false;
  out.after(line);
  let cwd = [];
  const say = (t) => { out.textContent += t; out.scrollTop = out.scrollHeight; };
  const prompt = () => { line.placeholder = showPath(cwd) + '>'; };
  say('InkSoC console. Type "help" for the commands.\n\n');
  prompt();
  const history = [];
  let hi = 0;
  p.con.addEventListener('pointerup', () => { if (!getSelection().toString()) line.focus(); });
  line.onkeydown = async (e) => {
    if (e.key === 'ArrowUp' && hi > 0) { line.value = history[--hi]; e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { line.value = history[++hi] || ''; hi = Math.min(hi, history.length); e.preventDefault(); return; }
    if (e.key !== 'Enter') return;
    const cmd = line.value.trim();
    line.value = '';
    say(showPath(cwd) + '>' + cmd + '\n');
    if (cmd) { history.push(cmd); hi = history.length; }
    try { await exec(cmd); } catch (err) { say((err.message || String(err)) + '\n'); }
    prompt();
    say('\n');
  };
  // "a b" "c d" e -> ['a b', 'c d', 'e']
  const words = (s) => (s.match(/"[^"]*"|\S+/g) || []).map((w) => w.replace(/^"|"$/g, ''));
  async function need(parts, what) { const e = await entryAt(parts); if (!e) throw new Error(what + ': not found'); return e; }
  async function exec(cmd) {
    if (!cmd) return;
    const [c0, ...args] = words(cmd), c = c0.toLowerCase();
    if (/^[a-z]:$/i.test(c)) { cwd = []; return; }
    if (c === 'help') {
      return say('dir [folder]     list a folder\ncd <folder>      change folder (cd .. goes up)\ntype <file>      show a text file\ncopy <from> <to> copy a file\nmove <from> <to> move or rename (ren too)\ndel <file>       delete a file\nmkdir <name>     make a folder (md too)\nrmdir <name>     delete a folder and what is in it (rd too)\nstart <x.exe>    run a program (or just type its name)\ncls              clear the screen\nfiles            open this folder in Files\n');
    }
    if (c === 'cls') { out.textContent = ''; return; }
    if (c === 'cd' || c === 'chdir') {
      if (!args.length) return say(showPath(cwd) + '\n');
      const parts = pathParts(cwd, args.join(' '));
      if (!(await dirAt(parts))) throw new Error('The system cannot find the path specified.');
      const fixed = [];
      for (const s of parts) { const d = await dirAt(fixed); fixed.push((await realName(d, s)) || s); }
      cwd = fixed;
      return;
    }
    if (c === 'dir' || c === 'ls') {
      const parts = pathParts(cwd, args.join(' '));
      const dir = await dirAt(parts);
      if (!dir) throw new Error('File Not Found');
      const items = await listDir(dir);
      let total = 0;
      say(' Directory of ' + showPath(parts) + '\n\n');
      for (const it of items) { total += it.size; say((it.dir ? '<DIR>          ' : size(it.size).padStart(14) + ' ') + ' ' + it.name + '\n'); }
      return say(`${String(items.filter((i) => !i.dir).length).padStart(16)} File(s) ${size(total)}\n${String(items.filter((i) => i.dir).length).padStart(16)} Dir(s)\n`);
    }
    if (c === 'type' || c === 'cat') {
      const e = await need(pathParts(cwd, args.join(' ')), args.join(' '));
      if (e.h.kind !== 'file') throw new Error('Access is denied.');
      const f = await e.h.getFile();
      return say(new TextDecoder().decode(await f.slice(0, 256 * 1024).arrayBuffer()) + (f.size > 256 * 1024 ? '\n[… first 256 KB of ' + size(f.size) + ']' : '') + '\n');
    }
    if (c === 'del' || c === 'erase' || c === 'rm') {
      const e = await need(pathParts(cwd, args.join(' ')), args.join(' '));
      if (e.h.kind !== 'file') throw new Error('Use rmdir for folders.');
      await e.dir.removeEntry(e.name);
      return listDrive();
    }
    if (c === 'mkdir' || c === 'md') { await dirAt(pathParts(cwd, args.join(' ')), true); return; }
    if (c === 'rmdir' || c === 'rd') {
      const e = await need(pathParts(cwd, args.filter((a) => !/^\/[sq]$/i.test(a)).join(' ')), 'folder');
      if (e.h.kind !== 'directory') throw new Error('The directory name is invalid.');
      await e.dir.removeEntry(e.name, { recursive: true });
      return listDrive();
    }
    if (c === 'copy' || c === 'move' || c === 'ren' || c === 'rename' || c === 'mv' || c === 'cp') {
      if (args.length !== 2) throw new Error('Usage: ' + c + ' <from> <to>');
      const from = await need(pathParts(cwd, args[0]), args[0]);
      if (from.h.kind !== 'file') throw new Error('Only files can be copied or moved.');
      let to = pathParts(cwd, (c === 'ren' || c === 'rename') ? args[0].replace(/[^\\/]*$/, '') + args[1] : args[1]);
      const target = await dirAt(to);
      let dir, name;
      if (target) { dir = target; name = from.name; } else { dir = await dirAt(to.slice(0, -1)); name = to[to.length - 1]; }
      if (!dir) throw new Error('The system cannot find the path specified.');
      await copyFile(from.h, dir, name);
      if (!/^(copy|cp)$/.test(c)) await from.dir.removeEntry(from.name);
      say('        1 file(s) ' + (/^(copy|cp)$/.test(c) ? 'copied' : 'moved') + '.\n');
      return listDrive();
    }
    if (c === 'files' || c === 'explorer') { openFiles(); return; }
    if (c === 'exit') { close(p); return; }
    // a program: "start x.exe", "x.exe" or "x"
    const name = c === 'start' ? args.join(' ') : c0;
    for (const n of [name, name + '.exe']) {
      const e = await entryAt(pathParts(cwd, n));
      if (e && e.h.kind === 'file' && /\.exe$/i.test(e.name)) { runExe([...pathParts(cwd, n).slice(0, -1), e.name]); return say('Started ' + e.name + '.\n'); }
    }
    throw new Error(`'${c0}' is not recognized as a command or a program here. Type "help".`);
  }
  setTimeout(() => line.focus(), 0);
}
