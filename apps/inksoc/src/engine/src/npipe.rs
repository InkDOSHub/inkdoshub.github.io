// Named pipes (\\.\pipe\name): a server makes instances with CreateNamedPipe, a
// client opens one by name; each instance carries bytes both ways, by messages or
// as a stream. Reads and listens on an overlapped handle return STATUS_PENDING and
// finish later (iosb + event), in the process that asked. Windows Installer and
// RPC (rpcrt4's ncalrpc) talk this way between processes.

use crate::files::Handle;
use crate::Engine;
use std::collections::VecDeque;

const OK: u64 = 0;
const PENDING: u64 = 0x103;
const PIPE_BROKEN: u64 = 0xC000_014B;
const PIPE_CONNECTED: u64 = 0xC000_00B2;
const PIPE_LISTENING: u64 = 0xC000_00B3;
const PIPE_DISCONNECTED: u64 = 0xC000_00B0;
const PIPE_NOT_AVAILABLE: u64 = 0xC000_00AC;
const NAME_NOT_FOUND: u64 = 0xC000_0034;
const BUFFER_OVERFLOW: u64 = 0x8000_0005;
pub(crate) const CANCELLED: u64 = 0xC000_0120;
const IO_TIMEOUT: u64 = 0xC000_00B5;

/// One pipe instance. Side 0 = server, 1 = client; `buf[i]` holds what side i reads.
#[derive(Default)]
pub struct NPipe {
    pub name: String,
    /// 0 waiting for a client, 1 connected, 2 the client went away (server must disconnect)
    pub state: u8,
    pub listening: bool,
    pub buf: [VecDeque<u8>; 2],
    /// message lengths in `buf` (message-type pipes)
    pub msgs: [VecDeque<usize>; 2],
    pub msg_type: bool,
    /// read mode per side: true = message mode
    pub msg_read: [bool; 2],
    pub open: [bool; 2],
    pub client_pid: u32,
    pub server_pid: u32,
}

/// An I/O started on an overlapped pipe handle, finished when data (or a client) comes.
pub struct Pend { pub pid: u32, pub h: u64, pub listen: bool, pub buf: u64, pub len: u64, pub iosb: u64, pub event: u64 }

/// The pipe name in a path (\??\pipe\x, \Device\NamedPipe\x, \\.\pipe\x), lowercase.
pub fn pipe_name(path: &str) -> Option<String> {
    let l = path.replace('/', "\\").to_ascii_lowercase();
    for pre in ["\\??\\pipe\\", "\\device\\namedpipe\\", "\\\\.\\pipe\\", "\\\\?\\pipe\\"] {
        if let Some(r) = l.strip_prefix(pre) { return Some(r.to_string()); }
    }
    None
}

impl Engine {
    /// Sets or clears an event (I/O done / started).
    pub(crate) fn event_set(&mut self, h: u64, on: bool) {
        if let Some(Handle::Event { set, .. }) = self.s.fs.handles.get_mut(&h) { *set = on; }
    }
    fn np_of(&self, h: u64) -> Option<(u64, usize, bool)> {
        match self.s.fs.handles.get(&h) { Some(Handle::NPipe { id, server, sync }) => Some((*id, if *server { 0 } else { 1 }, *sync)), _ => None }
    }
    pub fn is_npipe(&self, h: u64) -> bool { self.np_of(h).is_some() }

    /// NtCreateNamedPipeFile: a new instance of the pipe, waiting for a client.
    pub fn np_create(&mut self, name: &str, msg_type: bool, msg_read: bool, sync: bool) -> u64 {
        let id = self.s.fs.np_next + 1;
        self.s.fs.np_next = id;
        let pid = self.s.wpid;
        self.s.fs.npipes.insert(id, NPipe { name: name.to_string(), msg_type, msg_read: [msg_read, false], open: [true, false], server_pid: pid, ..Default::default() });
        self.new_handle(Handle::NPipe { id, server: true, sync })
    }
    /// A pipe instance a client can take: not connected yet (one listening first).
    fn np_free(&self, name: &str) -> Option<u64> {
        let mut best = None;
        for (id, p) in &self.s.fs.npipes {
            if p.name == name && p.state == 0 && p.open[0] { if p.listening { return Some(*id); } best = best.or(Some(*id)); }
        }
        best
    }
    pub fn np_exists(&self, name: &str) -> bool { self.s.fs.npipes.values().any(|p| p.name == name && p.open[0]) }

    /// NtCreateFile on a pipe name: the client end of a free instance.
    pub fn np_connect(&mut self, name: &str, sync: bool) -> Result<u64, u64> {
        let Some(id) = self.np_free(name) else { return Err(if self.np_exists(name) { PIPE_NOT_AVAILABLE } else { NAME_NOT_FOUND }) };
        let pid = self.s.wpid;
        if let Some(p) = self.s.fs.npipes.get_mut(&id) { p.state = 1; p.open[1] = true; p.client_pid = pid; p.listening = false; }
        let h = self.new_handle(Handle::NPipe { id, server: false, sync });
        self.np_poll();
        Ok(h)
    }

    /// Takes what side `me` can read now: Ok((bytes, status)) or Err(status) (nothing yet = PENDING).
    fn np_take(&mut self, id: u64, me: usize, len: u64) -> Result<(Vec<u8>, u64), u64> {
        let Some(p) = self.s.fs.npipes.get_mut(&id) else { return Err(PIPE_BROKEN) };
        if p.buf[me].is_empty() {
            if me == 0 && p.state == 0 { return Err(if p.listening { PIPE_LISTENING } else { PIPE_LISTENING }); }
            if p.state != 1 || !p.open[1 - me] { return Err(if me == 0 && p.state == 2 { PIPE_BROKEN } else { PIPE_BROKEN }); }
            return Err(PENDING);
        }
        if p.msg_type && p.msg_read[me] {
            // one message; a part of it when the buffer is smaller
            let m = p.msgs[me].front().copied().unwrap_or(p.buf[me].len());
            let k = (len as usize).min(m);
            let v: Vec<u8> = p.buf[me].drain(..k).collect();
            if k < m { if let Some(f) = p.msgs[me].front_mut() { *f -= k; } return Ok((v, BUFFER_OVERFLOW)); }
            p.msgs[me].pop_front();
            return Ok((v, OK));
        }
        let k = (len as usize).min(p.buf[me].len());
        let v: Vec<u8> = p.buf[me].drain(..k).collect();
        // whole messages read as a stream: drop their lengths
        let mut left = k;
        while left > 0 { match p.msgs[me].front_mut() { Some(f) if *f <= left => { left -= *f; p.msgs[me].pop_front(); } Some(f) => { *f -= left; left = 0; } None => break } }
        Ok((v, OK))
    }

    /// NtReadFile on a pipe end.
    pub fn np_read(&mut self, h: u64, event: u64, iosb: u64, buf: u64, len: u64) -> u64 {
        let Some((id, me, sync)) = self.np_of(h) else { return 0xC000_0008 };
        if event != 0 { self.event_set(event, false); }
        match self.np_take(id, me, len) {
            Ok((v, st)) => {
                if self.mmu.write_bytes(buf, &v).is_err() { self.fault(buf); }
                self.iosb(iosb, st, v.len() as u64);
                self.s.fs.np_last = v.len() as u64;
                if event != 0 { self.event_set(event, true); }
                st
            }
            Err(PENDING) if sync => self.wait_on(crate::sched::W::NPipe { h, listen: false }, u64::MAX),
            Err(PENDING) => {
                self.iosb(iosb, PENDING, 0);
                let pid = self.s.wpid;
                self.s.fs.npend.push(Pend { pid, h, listen: false, buf, len, iosb, event });
                PENDING
            }
            Err(st) => { self.iosb(iosb, st, 0); if event != 0 { self.event_set(event, true); } st }
        }
    }

    /// NtWriteFile on a pipe end: the bytes go to the other side (one message).
    pub fn np_write(&mut self, h: u64, event: u64, iosb: u64, buf: u64, len: u64) -> u64 {
        let Some((id, me, _)) = self.np_of(h) else { return 0xC000_0008 };
        let mut v = vec![0u8; len as usize];
        if self.mmu.read_bytes(buf, &mut v).is_err() { self.fault(buf); }
        let st = match self.s.fs.npipes.get_mut(&id) {
            Some(p) if p.state == 1 && p.open[1 - me] => {
                let to = 1 - me;
                p.buf[to].extend(v);
                if p.msg_type { p.msgs[to].push_back(len as usize); }
                OK
            }
            Some(p) if p.state == 0 => PIPE_LISTENING,
            Some(_) => PIPE_DISCONNECTED,
            None => PIPE_BROKEN,
        };
        self.iosb(iosb, st, if st == OK { len } else { 0 });
        self.s.fs.np_last = if st == OK { len } else { 0 };
        if event != 0 { self.event_set(event, true); }
        if st == OK { self.np_poll(); }
        if st == PIPE_DISCONNECTED { PIPE_BROKEN } else { st }
    }

    /// ReadFile / WriteFile (kernel32) on a pipe end: OVERLAPPED = { Internal, InternalHigh, offset, hEvent }.
    pub fn np_win32(&mut self, read: bool, h: u64, buf: u64, n: u64, done: u64, ov: u64) -> u64 {
        let event = if ov != 0 { self.mmu.read64(ov + 16).unwrap_or(0) } else { 0 };
        let st = if read { self.np_read(h, event, ov, buf, n) } else { self.np_write(h, event, ov, buf, n) };
        if st == crate::sched::BLOCK || st == crate::sched::RETRY { return st; }
        let got = self.s.fs.np_last;
        if done != 0 { let _ = self.mmu.write32(done, if st == OK || st == BUFFER_OVERFLOW { got as u32 } else { 0 }); }
        let err = match st { OK => return 1, PENDING => 997, BUFFER_OVERFLOW => 234, PIPE_LISTENING => 536, PIPE_DISCONNECTED => 233, _ => 109 };
        self.set_err(err);
        0
    }

    /// NtFsControlFile on a pipe end or on \??\pipe\ itself.
    pub fn np_fsctl(&mut self, h: u64, event: u64, iosb: u64, code: u32, inp: u64, inl: u64, out: u64, outl: u64) -> Option<u64> {
        if code == 0x11_0018 && !self.is_npipe(h) {
            // FSCTL_PIPE_WAIT: until an instance is free (or the timeout)
            let timeout = self.mmu.read64(inp).unwrap_or(0) as i64;
            let nlen = self.mmu.read32(inp + 8).unwrap_or(0) as u64;
            let given = self.mmu.read8(inp + 12).unwrap_or(0) != 0;
            let mut w = vec![0u16; (nlen / 2) as usize];
            for (i, c) in w.iter_mut().enumerate() { *c = self.mmu.read16(inp + 14 + 2 * i as u64).unwrap_or(0); }
            let name = String::from_utf16_lossy(&w).to_ascii_lowercase();
            if self.np_free(&name).is_some() { self.iosb(iosb, OK, 0); return Some(OK); }
            if !self.np_exists(&name) && !given { return Some(NAME_NOT_FOUND); }
            let ms = if !given { 5000 } else if timeout < 0 { ((-timeout) / 10_000) as u64 } else { 0xFFFF_FFFF };
            let r = self.wait_on(crate::sched::W::NpWait(name), ms.max(1));
            return Some(if r == crate::sched::WAIT_TIMEOUT { IO_TIMEOUT } else { r });
        }
        let (id, me, sync) = self.np_of(h)?;
        Some(match code {
            0x11_0008 => { // FSCTL_PIPE_LISTEN
                if event != 0 { self.event_set(event, false); }
                let st = match self.s.fs.npipes.get_mut(&id) {
                    Some(p) if p.state == 1 => PIPE_CONNECTED,
                    Some(p) if p.state == 2 => PIPE_BROKEN,
                    Some(p) => { p.listening = true; PENDING }
                    None => PIPE_BROKEN,
                };
                if st != PENDING { self.iosb(iosb, st, 0); if event != 0 { self.event_set(event, true); } return Some(st); }
                if sync { return Some(self.wait_on(crate::sched::W::NPipe { h, listen: true }, u64::MAX)); }
                self.iosb(iosb, PENDING, 0);
                let pid = self.s.wpid;
                self.s.fs.npend.push(Pend { pid, h, listen: true, buf: 0, len: 0, iosb, event });
                PENDING
            }
            0x11_0004 => { // FSCTL_PIPE_DISCONNECT: the instance waits for a new client
                if let Some(p) = self.s.fs.npipes.get_mut(&id) { p.state = 0; p.listening = false; p.buf = Default::default(); p.msgs = Default::default(); p.open[1] = false; }
                self.np_cancel(None, Some(id), PIPE_BROKEN);
                self.iosb(iosb, OK, 0); OK
            }
            0x11_400C => { // FSCTL_PIPE_PEEK: FILE_PIPE_PEEK_BUFFER { state, available, messages, message length, data }
                let Some(p) = self.s.fs.npipes.get(&id) else { return Some(PIPE_BROKEN) };
                let avail = p.buf[me].len();
                let mlen = if p.msg_type { p.msgs[me].front().copied().unwrap_or(0) } else { 0 };
                let nmsg = p.msgs[me].len();
                let state = if p.state == 1 { 3 } else { 4 }; // FILE_PIPE_CONNECTED_STATE / CLOSING
                let room = outl.saturating_sub(16) as usize;
                let data: Vec<u8> = p.buf[me].iter().take(room.min(avail)).copied().collect();
                if outl < 16 { return Some(0xC000_0023); }
                let _ = self.mmu.write32(out, state);
                let _ = self.mmu.write32(out + 4, avail as u32);
                let _ = self.mmu.write32(out + 8, nmsg as u32);
                let _ = self.mmu.write32(out + 12, mlen as u32);
                let _ = self.mmu.write_bytes(out + 16, &data);
                self.iosb(iosb, OK, 16 + data.len() as u64);
                if state == 4 && avail == 0 { PIPE_BROKEN } else { OK }
            }
            0x11_C017 => { // FSCTL_PIPE_TRANSCEIVE: write, then read one message
                if !self.s.fs.np_tx.contains(&h) {
                    let st = self.np_write(h, 0, 0, inp, inl);
                    if st != OK { return Some(st); }
                    self.s.fs.np_tx.insert(h);
                }
                let st = self.np_read(h, event, iosb, out, outl);
                if st != crate::sched::BLOCK && st != crate::sched::RETRY { self.s.fs.np_tx.remove(&h); }
                st
            }
            0x11_0038 | 0x11_0034 => { self.iosb(iosb, OK, 0); 0xC000_0010 } // attributes: not kept
            _ => 0xC000_0010,
        })
    }

    /// Finishes waiting reads and listens of the running process that can finish now.
    pub fn np_poll(&mut self) {
        if self.s.fs.npend.is_empty() { return; }
        let pid = self.s.wpid;
        let mut i = 0;
        while i < self.s.fs.npend.len() {
            let p = &self.s.fs.npend[i];
            if p.pid != pid { i += 1; continue; }
            let (h, listen, buf, len, iosb, event) = (p.h, p.listen, p.buf, p.len, p.iosb, p.event);
            let Some((id, me, _)) = self.np_of(h) else { self.s.fs.npend.remove(i); continue };
            let done = if listen {
                match self.s.fs.npipes.get(&id).map(|p| p.state) { Some(1) => Some((OK, 0)), Some(0) => None, _ => Some((PIPE_BROKEN, 0)) }
            } else {
                match self.np_take(id, me, len) {
                    Ok((v, st)) => { if self.mmu.write_bytes(buf, &v).is_err() { self.fault(buf); } Some((st, v.len() as u64)) }
                    Err(PENDING) | Err(PIPE_LISTENING) => None,
                    Err(st) => Some((st, 0)),
                }
            };
            match done {
                Some((st, n)) => {
                    self.s.fs.npend.remove(i);
                    self.iosb(iosb, st, n);
                    if event != 0 { self.event_set(event, true); }
                }
                None => i += 1,
            }
        }
    }
    /// Is an overlapped handle done (no I/O of it waiting)? (the handle itself is waitable)
    pub fn np_idle(&self, h: u64) -> bool { !self.s.fs.npend.iter().any(|p| p.h == h) }

    /// Cancels waiting I/O of a handle (or of every handle of an instance).
    pub fn np_cancel(&mut self, h: Option<u64>, inst: Option<u64>, st: u64) -> bool {
        let pid = self.s.wpid;
        let mut any = false;
        let mut i = 0;
        while i < self.s.fs.npend.len() {
            let p = &self.s.fs.npend[i];
            let hit = h.map_or(false, |x| p.h == x) || inst.map_or(false, |x| self.np_of(p.h).map_or(false, |(id, _, _)| id == x));
            if hit && p.pid == pid {
                let (iosb, event) = (p.iosb, p.event);
                self.s.fs.npend.remove(i);
                self.iosb(iosb, st, 0);
                if event != 0 { self.event_set(event, true); }
                any = true;
            } else { i += 1; }
        }
        any
    }

    /// CloseHandle of a pipe end: the other side sees a broken pipe.
    pub fn np_close(&mut self, id: u64, server: bool) {
        let me = if server { 0 } else { 1 };
        if let Some(p) = self.s.fs.npipes.get_mut(&id) {
            p.open[me] = false;
            if server { p.state = 2; } else if p.state == 1 { p.state = 2; }
            if !p.open[0] && !p.open[1] { self.s.fs.npipes.remove(&id); }
        }
        self.np_poll();
    }

    /// Query/set information of a pipe end (pipe info, local info, mode).
    pub fn np_info(&mut self, h: u64, class: u32, buf: u64, len: u64, set: bool) -> Option<(u64, u64)> {
        let (id, me, sync) = self.np_of(h)?;
        if set {
            if class == 23 { // FilePipeInformation { read mode, completion mode }
                let mode = self.mmu.read32(buf).unwrap_or(0);
                if let Some(p) = self.s.fs.npipes.get_mut(&id) { p.msg_read[me] = mode == 1; }
            }
            return Some((OK, 0));
        }
        let p = self.s.fs.npipes.get(&id)?;
        let (mt, mr, st, avail) = (p.msg_type, p.msg_read[me], p.state, p.buf[me].len());
        let need = match class { 16 => 4, 23 => 8, 24 => 40, 5 => 24, 4 => 40, 8 => 4, 25 => 8, _ => return Some((0xC000_0003, 0)) };
        if len < need { return Some((0xC000_0004, 0)); }
        self.zero_n(buf, need);
        match class {
            16 => { let _ = self.mmu.write32(buf, if sync { 0x20 } else { 0 }); }
            23 => { let _ = self.mmu.write32(buf, mr as u32); }
            24 => { // FilePipeLocalInformation
                let w = |e: &mut Engine, o: u64, v: u32| { let _ = e.mmu.write32(buf + o, v); };
                w(self, 0, mt as u32); w(self, 4, 0); w(self, 8, 255); w(self, 12, 1); w(self, 16, 0x10000); w(self, 20, avail as u32);
                w(self, 24, 0x10000); w(self, 28, 0); w(self, 32, if st == 1 { 3 } else if st == 0 { 2 } else { 4 }); w(self, 36, me as u32);
            }
            5 => { let _ = self.mmu.write32(buf + 16, 1); }
            8 => { let _ = self.mmu.write32(buf, 0x12019F); }
            _ => {}
        }
        Some((OK, need))
    }
}
