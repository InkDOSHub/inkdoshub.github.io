// Unpacks a .zip onto drive C: (OPFS folder "inksoc-c/C"), one file at a time, so a big
// game never sits whole in memory. Message in: { file: File }. Messages out:
// { progress: done, total }, then { done: folder } or { error }.
// A zip whose entries all sit in one top folder lands as C:\<that folder>, any other as C:\<zip name>.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const read = async (file, at, n) => new DataView(await file.slice(at, at + n).arrayBuffer());

async function entries(file) {
  // end of central directory: in the last 64 KB (after an optional comment)
  const tailAt = Math.max(0, file.size - 65558);
  const tail = await read(file, tailAt, file.size - tailAt);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = u16(tail, eocd + 10), size = u32(tail, eocd + 12), at = u32(tail, eocd + 16);
  const cd = await read(file, at, size);
  const names = new TextDecoder();
  const list = [];
  for (let i = 0, p = 0; i < count; i++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = u16(cd, p + 10), csize = u32(cd, p + 20), usize = u32(cd, p + 24);
    const nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32), local = u32(cd, p + 42);
    const name = names.decode(new Uint8Array(cd.buffer, p + 46, nlen)).replace(/\\/g, '/');
    if (!name.endsWith('/')) list.push({ name, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return list;
}

async function unpack(file) {
  const list = await entries(file);
  const tops = new Set(list.map((f) => (f.name.includes('/') ? f.name.split('/')[0] : '')));
  const one = tops.size === 1 && !tops.has('');
  const folder = one ? [...tops][0] : file.name.replace(/\.zip$/i, '');
  const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('inksoc-c', { create: true })).getDirectoryHandle('C', { create: true });
  const total = list.reduce((s, f) => s + f.usize, 0);
  let done = 0;
  for (const f of list) {
    const parts = (one ? f.name : folder + '/' + f.name).split('/').filter((s) => s && s !== '.' && s !== '..');
    let dir = root;
    for (const c of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(c, { create: true });
    const head = await read(file, f.local, 30);
    const start = f.local + 30 + u16(head, 26) + u16(head, 28);
    let data = file.slice(start, start + f.csize).stream();
    if (f.method === 8) data = data.pipeThrough(new DecompressionStream('deflate-raw'));
    else if (f.method !== 0) throw new Error(f.name + ': unsupported compression (' + f.method + ')');
    const h = await (await dir.getFileHandle(parts[parts.length - 1], { create: true })).createSyncAccessHandle();
    h.truncate(0);
    let at = 0;
    const r = data.getReader(); // (Safari streams have no for-await)
    for (let c; !(c = await r.read()).done; ) { h.write(c.value, { at }); at += c.value.byteLength; }
    h.flush();
    h.close();
    done += f.usize;
    postMessage({ progress: done, total });
  }
  return folder;
}

onmessage = async (ev) => {
  try { postMessage({ done: await unpack(ev.data.file) }); } catch (e) { postMessage({ error: e.message || String(e) }); }
};
