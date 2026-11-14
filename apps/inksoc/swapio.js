/* InkSoC swap I/O worker (several cores): the only holder of the OPFS swap file.
   Any core asks it for one 4 KB page through a shared mailbox and waits:
   ctl[0] state (0 idle, 1 request, 2 done, 3 quit), ctl[1] op (1 write, 2 read),
   ctl[2] slot, ctl[3] address in the engine's memory, ctl[4] mailbox lock.
   It also holds the drive C: files open for reading: op 3 reads ctl[5] bytes of file ctl[2]
   at ctl[6] + ctl[7] * 2^32 into ctl[3], and leaves the count read in ctl[5]; op 4 writes them.
   File SPILL is the spill file: closed program files too big to keep in memory. */
'use strict';
const PAGE = 4096, SPILL = 0x7FFFFFF0;
onmessage = async (ev) => {
  const { memory, ctl: sab, name, drive = [], spill: spillName } = ev.data;
  const ctl = new Int32Array(sab);
  let swap = null;
  const ram = new Map();
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(name, { create: true });
    swap = await fh.createSyncAccessHandle();
    swap.truncate(0);
  } catch (e) { swap = null; }
  let spill = null;
  if (spillName) try { spill = await (await (await navigator.storage.getDirectory()).getFileHandle(spillName, { create: true })).createSyncAccessHandle(); spill.truncate(0); } catch (e) { spill = null; }
  // drive files come as OPFS paths (Safari cannot send file handles between workers)
  const root = await navigator.storage.getDirectory();
  const handleAt = async (at) => { let d = root; for (const n of at.slice(0, -1)) d = await d.getDirectoryHandle(n); return d.getFileHandle(at[at.length - 1]); };
  const files = await Promise.all(drive.map(async (at) => { let h; try { h = await handleAt(at); } catch (e) { return null; } try { return await h.createSyncAccessHandle({ mode: 'read-only' }); } catch (e) { try { return await h.createSyncAccessHandle(); } catch (e2) { return null; } } }));
  postMessage({ ready: true, spill: !!spill, opfs: !!swap, drive: files.map((f) => !!f) });
  const buf = new Uint8Array(PAGE);
  for (;;) {
    const s = Atomics.load(ctl, 0);
    if (s === 3) break;
    if (s !== 1) { Atomics.wait(ctl, 0, s); continue; }
    const op = ctl[1], slot = ctl[2];
    if (op === 3 || op === 4) {
      const f = slot === SPILL ? spill : files[slot], n = ctl[5], at = (ctl[6] >>> 0) + ctl[7] * 4294967296;
      if (op === 4) ctl[5] = f ? f.write(new Uint8Array(memory.buffer, ctl[3] >>> 0, n).slice(), { at }) : 0;
      else {
        const b = new Uint8Array(n), got = f ? f.read(b, { at }) : 0;
        new Uint8Array(memory.buffer, ctl[3] >>> 0, got).set(b.subarray(0, got));
        ctl[5] = got;
      }
      Atomics.store(ctl, 0, 2);
      Atomics.notify(ctl, 0);
      continue;
    }
    const page = new Uint8Array(memory.buffer, ctl[3], PAGE);
    if (op === 1) { buf.set(page); if (swap) swap.write(buf, { at: slot * PAGE }); else ram.set(slot, buf.slice()); }
    else { if (swap) swap.read(buf, { at: slot * PAGE }); else buf.set(ram.get(slot) || new Uint8Array(PAGE)); page.set(buf); }
    Atomics.store(ctl, 0, 2);
    Atomics.notify(ctl, 0);
  }
  if (swap) { swap.flush(); swap.truncate(0); swap.close(); }
  for (const f of files) if (f) f.close();
  if (spill) { spill.flush(); spill.close(); }
  postMessage({ closed: true });
};

