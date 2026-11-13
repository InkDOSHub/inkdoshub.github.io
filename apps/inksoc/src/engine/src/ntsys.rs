// NT system calls for Wine's ntdll (the part Wine runs on its Unix side):
// files, memory, process/thread/system information, registry (empty) and
// tokens. Waits, events, timers and the like are in sched.rs.

use crate::files::Handle;
use crate::Engine;

pub const OK: u64 = 0;
const NOT_IMPLEMENTED: u64 = 0xC000_0002;
const INVALID_INFO_CLASS: u64 = 0xC000_0003;
const INFO_LENGTH_MISMATCH: u64 = 0xC000_0004;
const INVALID_HANDLE: u64 = 0xC000_0008;
const INVALID_PARAMETER: u64 = 0xC000_000D;
const END_OF_FILE: u64 = 0xC000_0011;
const ACCESS_DENIED: u64 = 0xC000_0022;
const OBJECT_NAME_NOT_FOUND: u64 = 0xC000_0034;
const BUFFER_TOO_SMALL: u64 = 0xC000_0023;
const NO_MORE_ENTRIES: u64 = 0x8000_001A;

fn now_ft() -> u64 { (unsafe { crate::host_epoch_ms() } as u64 + 11_644_473_600_000) * 10_000 }

impl Engine {
    fn iosb(&mut self, p: u64, status: u64, info: u64) {
        if p != 0 { let _ = self.mmu.write64(p, status); let _ = self.mmu.write64(p + 8, info); }
    }
    fn zero_n(&mut self, a: u64, n: u64) { for i in 0..n { let _ = self.mmu.write8(a + i, 0); } }
    /// Name of an OBJECT_ATTRIBUTES (its UNICODE_STRING ObjectName).
    pub(crate) fn oa_name(&mut self, oa: u64) -> String {
        let us = self.mmu.read64(oa + 16).unwrap_or(0);
        if us == 0 { return String::new(); }
        let len = self.mmu.read16(us).unwrap_or(0) as usize / 2;
        let buf = self.mmu.read64(us + 8).unwrap_or(0);
        let v: Vec<u16> = (0..len).map(|i| self.mmu.read16(buf + 2 * i as u64).unwrap_or(0)).collect();
        String::from_utf16_lossy(&v)
    }
    /// Text of a UNICODE_STRING.
    fn us_read(&mut self, us: u64) -> String {
        if us == 0 { return String::new(); }
        let len = self.mmu.read16(us).unwrap_or(0) as usize / 2;
        let buf = self.mmu.read64(us + 8).unwrap_or(0);
        let v: Vec<u16> = (0..len).map(|i| self.mmu.read16(buf + 2 * i as u64).unwrap_or(0)).collect();
        String::from_utf16_lossy(&v)
    }
    /// An LDR_DATA_TABLE_ENTRY for a module (made once, on demand).
    fn ldr_entry(&mut self, base: u64) -> u64 {
        if let Some(&a) = self.s.ldr_entries.get(&base) { return a; }
        let Some(m) = self.s.modules.iter().find(|m| m.base == base) else { return 0 };
        let (name, size, entry) = (m.name.clone(), m.size, m.entry);
        let a = self.heap_alloc(0x140, true);
        let _ = self.mmu.write64(a + 0x30, base);
        let _ = self.mmu.write64(a + 0x38, entry);
        let _ = self.mmu.write32(a + 0x40, size as u32);
        for (off, text) in [(0x48u64, format!("C:\\Windows\\System32\\{}", name)), (0x58, name)] {
            let w: Vec<u16> = text.encode_utf16().collect();
            let b = self.heap_alloc(2 * w.len() as u64 + 2, true);
            for (k, c) in w.iter().enumerate() { let _ = self.mmu.write16(b + 2 * k as u64, *c); }
            let _ = self.mmu.write16(a + off, 2 * w.len() as u16);
            let _ = self.mmu.write16(a + off + 2, 2 * w.len() as u16 + 2);
            let _ = self.mmu.write64(a + off + 8, b);
        }
        let _ = self.mmu.write16(a + 0x6C, 1); // ObsoleteLoadCount
        self.s.ldr_entries.insert(base, a);
        a
    }
    /// Loads the CPU from a CONTEXT (registers, flags, rip, XMM).
    pub fn load_context(&mut self, c: u64) {
        let flags = self.mmu.read32(c + 0x30).unwrap_or(0);
        for i in 0..16 { self.cpu.regs[i] = self.mmu.read64(c + 0x78 + 8 * i as u64).unwrap_or(0); }
        let f = self.mmu.read32(c + 0x44).unwrap_or(0x202) as u64;
        self.set_flags(f);
        if flags & 8 != 0 || flags == 0 {
            for i in 0..16u64 {
                let lo = self.mmu.read64(c + 0x1A0 + 16 * i).unwrap_or(0) as u128;
                let hi = self.mmu.read64(c + 0x1A8 + 16 * i).unwrap_or(0) as u128;
                self.cpu.xmm[i as usize] = lo | hi << 64;
            }
        }
        self.cpu.rip = self.mmu.read64(c + 0xF8).unwrap_or(0);
    }
    fn file_info(&mut self, h: u64) -> Option<(bool, u64, u64)> {
        // (is directory, size, position)
        match self.s.fs.handles.get(&h) {
            Some(Handle::File { name, pos }) => { let p = *pos; let n = name.clone(); Some((false, self.s.files.get(&n).map_or(0, |d| d.len() as u64), p)) }
            Some(Handle::Dir) => Some((true, 0, 0)),
            _ => None,
        }
    }
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    let r = match name {
        // ---- loader (ntdll's Ldr*, on the engine's module list) ----
        "LdrAddRefDll" | "LdrUnloadDll" | "LdrDisableThreadCalloutsForDll" | "LdrUnlockLoaderLock" => OK,
        "LdrLockLoaderLock" => {
            let (r, c) = (e.arg(1), e.arg(2));
            if r != 0 { let _ = e.mmu.write32(r, 1); }
            if c != 0 { let _ = e.mmu.write64(c, 1); }
            OK
        }
        "LdrGetDllHandle" | "LdrGetDllHandleEx" | "LdrLoadDll" => {
            let (us, out) = if name == "LdrGetDllHandleEx" { (e.arg(3), e.arg(4)) } else { (e.arg(2), e.arg(3)) };
            let n = e.us_read(us);
            let n = n.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
            let n = if n.contains('.') { n } else { format!("{}.dll", n) };
            if name != "LdrLoadDll" {
                let n = if e.s.wow64 && n == "ntdll.dll" { "wine-ntdll.dll".to_string() } else { n };
                let Some(i) = crate::pe::find_module(e, &n) else { return Some(0xC000_0135) };
                let b = e.s.modules[i].base;
                if out != 0 { let _ = e.mmu.write64(out, b); }
                return Some(OK);
            }
            let before = e.s.init_queue.len();
            match crate::pe::load_by_name(e, &n) {
                Ok(i) => {
                    let b = e.s.modules[i].base;
                    if out != 0 { let _ = e.mmu.write64(out, b); }
                    if e.s.init_queue.len() > before {
                        let pending: Vec<(u64, u64)> = e.s.init_queue.drain(before..).collect();
                        e.run_inits(pending, 0, Some(OK));
                        return Some(crate::kernel32::NO_RETURN);
                    }
                    OK
                }
                Err(_) => 0xC000_0135,
            }
        }
        "LdrGetProcedureAddress" => {
            let (ans, ord, out) = (e.arg(1), e.arg(2), e.arg(3));
            let Some(i) = e.s.modules.iter().position(|m| m.base == a0) else { return Some(0xC000_0135) };
            let n = if ans != 0 {
                let len = e.mmu.read16(ans).unwrap_or(0) as u64;
                let b = e.mmu.read64(ans + 8).unwrap_or(0);
                (0..len).map(|k| e.mmu.read8(b + k).unwrap_or(0) as char).collect::<String>()
            } else { format!("#{}", ord) };
            if e.s.modules[i].native && !{ let d = e.s.modules[i].name.clone(); e.wine_has(&d, &n) } { return Some(0xC000_0139); }
            match crate::pe::proc_address(e, i, &n) {
                Some(a) => { if out != 0 { let _ = e.mmu.write64(out, a); } OK }
                None => 0xC000_0139, // STATUS_ENTRYPOINT_NOT_FOUND
            }
        }
        "LdrFindEntryForAddress" => {
            let out = e.arg(1);
            let Some(b) = e.s.modules.iter().find(|m| a0 >= m.base && a0 < m.base + m.size).map(|m| m.base) else { return Some(0xC000_0135) };
            let ent = e.ldr_entry(b);
            if out != 0 { let _ = e.mmu.write64(out, ent); }
            OK
        }
        "RtlGetCurrentPeb" => crate::PEB,
        "RtlIsCriticalSectionLocked" => (e.mmu.read32(a0 + 12).unwrap_or(0) > 0) as u64,
        "RtlIsCriticalSectionLockedByThread" => {
            let me = e.cur_tid() as u64;
            (e.mmu.read32(a0 + 12).unwrap_or(0) > 0 && e.mmu.read64(a0 + 16).unwrap_or(0) == me) as u64
        }
        "DbgPrint" | "DbgPrintEx" | "DbgBreakPoint" | "DbgUserBreakPoint" => 0,
        // ---- exceptions: Wine's ntdll dispatches them; these are its kernel side ----
        "NtCallbackReturn" => { e.callback_return(); return Some(crate::kernel32::NO_RETURN); }
        "NtContinue" => { e.load_context(a0); return Some(crate::kernel32::NO_RETURN); }
        "NtRaiseException" => {
            let code = e.mmu.read32(a0).unwrap_or(0);
            let at = e.mmu.read64(a0 + 16).unwrap_or(0);
            let info = e.mmu.read64(a0 + 32).unwrap_or(0);
            let msg = match code {
                0xC000_0005 => format!("access violation at 0x{:x}", info),
                0xE06D_7363 => "unhandled C++ exception".to_string(),
                0x8000_0100 => { // EXCEPTION_WINE_STUB: (dll, function)
                    let f = e.mmu.read64(a0 + 40).unwrap_or(0);
                    format!("unimplemented function {}!{}", e.read_cstr(info, 64), e.read_cstr(f, 64))
                }
                c => format!("unhandled exception 0x{:x}", c),
            };
            e.set_error(format!("{} (at 0x{:x})", msg, at));
            return Some(crate::kernel32::NO_RETURN);
        }
        // ---- atoms ----
        "NtAddAtom" | "NtFindAtom" | "NtAddAtomEx" => {
            // (name, length in bytes, atom*)
            let (len, out) = (e.arg(1) as u32 as u64, e.arg(2));
            let v: Vec<u16> = (0..len / 2).map(|i| e.mmu.read16(a0 + 2 * i).unwrap_or(0)).collect();
            let n = String::from_utf16_lossy(&v);
            let atom = if let Some(num) = n.strip_prefix('#').and_then(|d| d.parse::<u16>().ok()) { num as u64 }
                else if let Some(i) = e.s.atoms.iter().position(|a| a.eq_ignore_ascii_case(&n)) { 0xC000 + i as u64 }
                else if name == "NtFindAtom" { return Some(OBJECT_NAME_NOT_FOUND); }
                else { e.s.atoms.push(n); 0xBFFF + e.s.atoms.len() as u64 };
            if out != 0 { let _ = e.mmu.write16(out, atom as u16); }
            OK
        }
        "NtDeleteAtom" => OK,
        "NtQueryInformationAtom" => {
            // (atom, class, info*, length, return length*): AtomBasicInformation
            let (buf, len, ret) = (e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            let name = if a0 >= 0xC000 { e.s.atoms.get((a0 - 0xC000) as usize).cloned() } else { Some(format!("#{}", a0)) };
            let Some(n) = name else { return Some(INVALID_HANDLE) };
            let w: Vec<u16> = n.encode_utf16().collect();
            let need = 6 + 2 * w.len() as u64 + 2;
            if len < need { return Some(0x8000_0005); } // STATUS_BUFFER_OVERFLOW
            let _ = e.mmu.write16(buf, 1); let _ = e.mmu.write16(buf + 2, 0); let _ = e.mmu.write16(buf + 4, 2 * w.len() as u16);
            for (k, c) in w.iter().chain([0u16].iter()).enumerate() { let _ = e.mmu.write16(buf + 6 + 2 * k as u64, *c); }
            if ret != 0 { let _ = e.mmu.write32(ret, need as u32); }
            OK
        }
        "NtQueryInformationJobObject" => { let (b, n, r) = (e.arg(2), e.arg(3) as u32 as u64, e.arg(4)); e.zero_n(b, n); if r != 0 { let _ = e.mmu.write32(r, n as u32); } OK }
        "NtIsProcessInJob" => 0x0000_0123, // STATUS_PROCESS_NOT_IN_JOB
        "RtlGetUserInfoHeap" => { for k in [3, 4] { let p = e.arg(k); if p != 0 { let _ = e.mmu.write64(p, 0); } } 1 }
        "RtlSetUserValueHeap" | "RtlSetUserFlagsHeap" => 1,
        // other processes: only our own exists
        "NtOpenProcess" => {
            let cid = e.arg(3);
            let pid = if cid != 0 { e.mmu.read64(cid).unwrap_or(0) } else { 0 };
            if pid == 4 { let _ = e.mmu.write64(a0, u64::MAX); OK } else { 0xC000_000B } // STATUS_INVALID_CID
        }
        "NtOpenThread" => {
            let cid = e.arg(3);
            let tid = if cid != 0 { e.mmu.read64(cid + 8).unwrap_or(0) as u32 } else { 0 };
            if e.s.sched.th.iter().any(|t| t.id == tid) { let h = e.new_handle(Handle::Thread { tid }); let _ = e.mmu.write64(a0, h); OK } else { 0xC000_000B }
        }
        "NtOpenDirectoryObject" | "NtCreateDirectoryObject" | "NtOpenSymbolicLinkObject" => {
            let h = e.new_handle(Handle::Dir); let _ = e.mmu.write64(a0, h); OK
        }
        "NtQueryDirectoryObject" => NO_MORE_ENTRIES,
        "NtQuerySymbolicLinkObject" => OBJECT_NAME_NOT_FOUND,
        // ---- files ----
        "NtReadFile" => {
            let (iosb, buf, n, offp) = (e.arg(4), e.arg(5), e.arg(6) as u32 as u64, e.arg(7));
            if a0 == 3 || matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) { e.iosb(iosb, END_OF_FILE, 0); return Some(END_OF_FILE); }
            if let Some(id) = e.pipe_id(a0) {
                return Some(match e.pipe_read(a0, buf, n) {
                    Ok(k) => { e.iosb(iosb, OK, k); OK }
                    Err(true) => { e.iosb(iosb, 0xC000_014B, 0); 0xC000_014B } // STATUS_PIPE_BROKEN
                    Err(false) => e.wait_on(crate::sched::W::Pipe(id), u64::MAX),
                });
            }
            let (k, pos) = match e.s.fs.handles.get(&a0) { Some(Handle::File { name, pos }) => (name.clone(), *pos), _ => return Some(INVALID_HANDLE) };
            let pos = if offp != 0 { let o = e.mmu.read64(offp).unwrap_or(u64::MAX); if o as i64 >= 0 { o } else { pos } } else { pos };
            let data = e.s.files.get(&k).map(|d| { let s = (pos as usize).min(d.len()); d[s..(s + n as usize).min(d.len())].to_vec() }).unwrap_or_default();
            if data.is_empty() && n > 0 { e.iosb(iosb, END_OF_FILE, 0); return Some(END_OF_FILE); }
            if e.mmu.write_bytes(buf, &data).is_err() { e.fault(buf); }
            if let Some(Handle::File { pos: p, .. }) = e.s.fs.handles.get_mut(&a0) { *p = pos + data.len() as u64; }
            e.iosb(iosb, OK, data.len() as u64);
            OK
        }
        "NtWriteFile" => {
            let (iosb, buf, n, offp) = (e.arg(4), e.arg(5), e.arg(6) as u32 as u64, e.arg(7));
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(buf, &mut v).is_err() { return Some(INVALID_PARAMETER); }
            if a0 == 1 || a0 == 2 { crate::console(&String::from_utf8_lossy(&v)); e.iosb(iosb, OK, n); return Some(OK); }
            if matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) { e.iosb(iosb, OK, n); return Some(OK); }
            if e.pipe_write(a0, buf, n) { e.iosb(iosb, OK, n); return Some(OK); }
            let (k, pos) = match e.s.fs.handles.get(&a0) { Some(Handle::File { name, pos }) => (name.clone(), *pos), _ => return Some(INVALID_HANDLE) };
            let pos = if offp != 0 { let o = e.mmu.read64(offp).unwrap_or(u64::MAX); if o as i64 >= 0 { o } else { pos } } else { pos };
            let d = e.s.files.entry(k.clone()).or_default();
            let end = pos as usize + v.len();
            if d.len() < end { d.resize(end, 0); }
            d[pos as usize..end].copy_from_slice(&v);
            e.s.fs.written.insert(k);
            if let Some(Handle::File { pos: p, .. }) = e.s.fs.handles.get_mut(&a0) { *p = end as u64; }
            e.iosb(iosb, OK, n);
            OK
        }
        "NtFlushBuffersFile" | "NtFlushBuffersFileEx" => { let p = e.arg(1); e.iosb(p, OK, 0); OK }
        "NtQueryInformationFile" => {
            let (iosb, buf, len, class) = (e.arg(1), e.arg(2), e.arg(3) as u32 as u64, e.arg(4) as u32);
            if e.pipe_id(a0).is_some() {
                // pipe: synchronous mode (16), local pipe info (24): connected, byte mode
                let need = match class { 8 => 4, 16 => 4, 24 => 40, 5 => 24, 4 => 40, _ => return Some(INVALID_INFO_CLASS) };
                if len < need { return Some(INFO_LENGTH_MISMATCH); }
                e.zero_n(buf, need);
                let wr = matches!(e.s.fs.handles.get(&a0), Some(Handle::Pipe { write: true, .. }));
                match class { 8 => { let _ = e.mmu.write32(buf, if wr { 0x120116 } else { 0x120089 }); } 16 => { let _ = e.mmu.write32(buf, 0x20); } 24 => { let _ = e.mmu.write32(buf + 16, 1); let _ = e.mmu.write32(buf + 20, 4096); let _ = e.mmu.write32(buf + 24, 4096); let _ = e.mmu.write32(buf + 32, 3); } 5 => { let _ = e.mmu.write32(buf + 16, 1); } 4 => { let _ = e.mmu.write32(buf + 32, 0x80); } _ => {} }
                e.iosb(iosb, OK, need);
                return Some(OK);
            }
            let con = a0 <= 3;
            let (dir, size, pos) = if con { (false, 0, 0) } else { match e.file_info(a0) { Some(x) => x, None => return Some(INVALID_HANDLE) } };
            let attr: u32 = if dir { 0x10 } else { 0x80 };
            let need = match class { 4 => 40, 5 => 24, 14 => 8, 35 => 8, 18 => 104, 6 => 8, 7 => 4, 8 => 4, 16 => 4, 34 => 56, 59 => 24, _ => 0 };
            if need == 0 { return Some(INVALID_INFO_CLASS); }
            if len < need { return Some(INFO_LENGTH_MISMATCH); }
            e.zero_n(buf, need);
            let ft = now_ft();
            let basic = |e: &mut Engine, b: u64| { for o in [0, 8, 16, 24] { let _ = e.mmu.write64(b + o, ft); } let _ = e.mmu.write32(b + 32, attr); };
            let std_ = |e: &mut Engine, b: u64| { let _ = e.mmu.write64(b, (size + 4095) & !4095); let _ = e.mmu.write64(b + 8, size); let _ = e.mmu.write32(b + 16, 1); let _ = e.mmu.write8(b + 21, dir as u8); };
            match class {
                4 => basic(e, buf),
                5 => std_(e, buf),
                14 => { let _ = e.mmu.write64(buf, pos); }
                35 => { let _ = e.mmu.write32(buf, attr); }
                18 => { basic(e, buf); std_(e, buf + 40); let _ = e.mmu.write64(buf + 64, a0); let _ = e.mmu.write64(buf + 80, pos); }
                6 => { let _ = e.mmu.write64(buf, a0); }
                8 => { let _ = e.mmu.write32(buf, 0x12019F); }
                34 => { for o in [0, 8, 16, 24] { let _ = e.mmu.write64(buf + o, ft); } let _ = e.mmu.write64(buf + 32, (size + 4095) & !4095); let _ = e.mmu.write64(buf + 40, size); let _ = e.mmu.write32(buf + 48, attr); }
                _ => {}
            }
            e.iosb(iosb, OK, need);
            OK
        }
        "NtSetInformationFile" => {
            let (iosb, buf, class) = (e.arg(1), e.arg(2), e.arg(4) as u32);
            match class {
                // FileDispositionInformation(Ex): delete when the last handle closes
                13 => { let d = e.mmu.read8(buf).unwrap_or(0) != 0; if let Some(p) = e.s.fs.paths.get_mut(&a0) { p.1 = d; } }
                64 => { let f = e.mmu.read32(buf).unwrap_or(0); if let Some(p) = e.s.fs.paths.get_mut(&a0) { p.1 = f & 1 != 0; } }
                // FileRenameInformation(Ex): { replace/flags u32, root u64, name length u32, name }
                10 | 65 => {
                    let n = e.mmu.read32(buf + 16).unwrap_or(0) as u64 / 2;
                    let v: Vec<u16> = (0..n).map(|i| e.mmu.read16(buf + 20 + 2 * i).unwrap_or(0)).collect();
                    let to = String::from_utf16_lossy(&v);
                    let replace = e.mmu.read8(buf).unwrap_or(0) != 0 || (class == 65 && e.mmu.read32(buf).unwrap_or(0) & 1 != 0);
                    let (Some((from, _)), Some(tk)) = (e.s.fs.paths.get(&a0).cloned(), crate::files::key_of(&to)) else { e.iosb(iosb, OK, 0); return Some(OK) };
                    if from == tk { e.iosb(iosb, OK, 0); return Some(OK); }
                    if (e.s.files.contains_key(&tk) || e.is_dir(&tk)) && !replace { return Some(0xC000_0035); } // OBJECT_NAME_COLLISION
                    if let Some(d) = e.s.files.remove(&from) {
                        e.s.fs.written.remove(&from); e.s.files.insert(tk.clone(), d); e.s.fs.written.insert(tk.clone()); e.note_case(&tk, &to);
                        if let Some(Handle::File { name, .. }) = e.s.fs.handles.get_mut(&a0) { *name = tk.clone(); }
                    } else if e.s.fs.dirs.remove(&from) {
                        // a folder: everything under it moves too
                        let pre = from.clone() + "\\";
                        let fs: Vec<String> = e.s.files.keys().filter(|f| f.starts_with(&pre)).cloned().collect();
                        for f in fs { let d = e.s.files.remove(&f).unwrap(); let nk = format!("{}{}", tk, &f[from.len()..]); e.s.fs.written.remove(&f); e.s.fs.written.insert(nk.clone()); e.s.files.insert(nk, d); }
                        let ds: Vec<String> = e.s.fs.dirs.iter().filter(|f| f.starts_with(&pre)).cloned().collect();
                        for f in ds { e.s.fs.dirs.remove(&f); e.s.fs.dirs.insert(format!("{}{}", tk, &f[from.len()..])); }
                        e.s.fs.dirs.insert(tk.clone()); e.note_case(&tk, &to);
                    }
                    if let Some(p) = e.s.fs.paths.get_mut(&a0) { p.0 = tk; }
                }
                14 => { let p = e.mmu.read64(buf).unwrap_or(0); if let Some(Handle::File { pos, .. }) = e.s.fs.handles.get_mut(&a0) { *pos = p; } }
                20 | 19 => {
                    // end of file / allocation
                    let n = e.mmu.read64(buf).unwrap_or(0) as usize;
                    if let Some(Handle::File { name, .. }) = e.s.fs.handles.get(&a0) { let k = name.clone(); if let Some(d) = e.s.files.get_mut(&k) { d.resize(n, 0); } e.s.fs.written.insert(k); }
                }
                _ => {}
            }
            e.iosb(iosb, OK, 0);
            OK
        }
        "NtQueryVolumeInformationFile" => {
            let (iosb, buf, len, class) = (e.arg(1), e.arg(2), e.arg(3) as u32 as u64, e.arg(4) as u32);
            match class {
                4 => { if len < 8 { return Some(INFO_LENGTH_MISMATCH); } let _ = e.mmu.write32(buf, if a0 <= 3 { 0x50 } else { 7 }); let _ = e.mmu.write32(buf + 4, 0); e.iosb(iosb, OK, 8); OK }
                1 => { e.zero_n(buf, len.min(24)); e.iosb(iosb, OK, len.min(24)); OK }
                5 => {
                    // FileFsAttributeInformation: NTFS-like
                    if len < 20 { return Some(BUFFER_TOO_SMALL); }
                    let _ = e.mmu.write32(buf, 0x0000_00FF); let _ = e.mmu.write32(buf + 4, 255); let _ = e.mmu.write32(buf + 8, 8);
                    for (i, c) in "NTFS".encode_utf16().enumerate() { let _ = e.mmu.write16(buf + 12 + 2 * i as u64, c); }
                    e.iosb(iosb, OK, 20); OK
                }
                3 | 7 => { e.zero_n(buf, len.min(32)); let _ = e.mmu.write64(buf, 1 << 24); let _ = e.mmu.write64(buf + 8, 1 << 23); let _ = e.mmu.write32(buf + 16, 8); let _ = e.mmu.write32(buf + 20, 512); e.iosb(iosb, OK, 24); OK }
                _ => INVALID_INFO_CLASS,
            }
        }
        "NtQueryAttributesFile" | "NtQueryFullAttributesFile" => {
            let nm = e.oa_name(a0);
            let out = e.arg(1);
            let found = match crate::files::key_of(&nm) { None => Some((0x10u32, 0u64)), Some(k) => if e.is_dir(&k) { Some((0x10u32, 0u64)) } else { e.s.files.get(&k).map(|d| (0x80u32, d.len() as u64)) } };
            match found {
                Some((attr, size)) => {
                    let ft = now_ft();
                    for o in [0, 8, 16, 24] { let _ = e.mmu.write64(out + o, ft); }
                    if name == "NtQueryAttributesFile" { let _ = e.mmu.write32(out + 32, attr); }
                    else { let _ = e.mmu.write64(out + 32, (size + 4095) & !4095); let _ = e.mmu.write64(out + 40, size); let _ = e.mmu.write32(out + 48, attr); }
                    OK
                }
                None => OBJECT_NAME_NOT_FOUND,
            }
        }
        "NtCreateFile" | "NtOpenFile" => {
            // (handle*, access, attributes, iosb, [alloc size, file attributes, share, disposition, options])
            let oa = e.arg(2); let nm = e.oa_name(oa);
            let iosb = e.arg(3);
            let disp = if name == "NtCreateFile" { e.arg(7) as u32 } else { 1 }; // FILE_OPEN
            if nm.len() >= 11 && nm[..11].eq_ignore_ascii_case("\\Device\\Afd") {
                let h = e.new_handle(Handle::Afd); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, 1); return Some(OK);
            }
            let kk = crate::files::key_of(&nm);
            let k = kk.clone().unwrap_or_default();
            if kk.is_none() || k == "??" {
                let h = e.new_handle(Handle::Dir); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, 1); return Some(OK);
            }
            if k == "conin$" { let _ = e.mmu.write64(a0, 3); e.iosb(iosb, OK, 1); return Some(OK); }
            if nm.starts_with("\\??\\CON") || nm.eq_ignore_ascii_case("CONOUT$") { let _ = e.mmu.write64(a0, 1); e.iosb(iosb, OK, 1); return Some(OK); }
            if k == "nul" { let h = e.new_handle(Handle::Null); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, 1); return Some(OK); }
            let opts = if name == "NtCreateFile" { e.arg(8) as u32 } else { e.arg(5) as u32 };
            let is_dir = e.is_dir(&k);
            if is_dir || opts & 1 != 0 { // FILE_DIRECTORY_FILE
                if !is_dir && matches!(disp, 2 | 3) && !e.s.files.contains_key(&k) { e.note_case(&k, &nm); e.s.fs.dirs.insert(k.clone()); }
                else if !is_dir { return Some(OBJECT_NAME_NOT_FOUND); }
                else if disp == 2 { return Some(0xC000_0035); }
                let h = e.new_handle(Handle::Dir); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, if is_dir { 1 } else { 2 });
                e.s.fs.paths.insert(h, (k.clone(), opts & 0x1000 != 0));
                return Some(OK);
            }
            let exists = e.s.files.contains_key(&k);
            // FILE_SUPERSEDE 0, OPEN 1, CREATE 2, OPEN_IF 3, OVERWRITE 4, OVERWRITE_IF 5
            match disp {
                1 | 4 if !exists => return Some(OBJECT_NAME_NOT_FOUND),
                2 if exists => return Some(0xC000_0035), // OBJECT_NAME_COLLISION
                _ => {}
            }
            if !exists || matches!(disp, 0 | 4 | 5) { e.s.files.insert(k.clone(), Vec::new()); e.s.fs.written.insert(k.clone()); e.note_case(&k, &nm); }
            let h = e.new_handle(Handle::File { name: k.clone(), pos: 0 });
            e.s.fs.paths.insert(h, (k, opts & 0x1000 != 0)); // FILE_DELETE_ON_CLOSE
            let _ = e.mmu.write64(a0, h);
            e.iosb(iosb, OK, if exists { 1 } else { 2 });
            OK
        }
        "NtDeleteFile" => {
            let nm = e.oa_name(a0);
            let k = crate::files::key_of(&nm).unwrap_or_default();
            if e.s.files.remove(&k).is_some() { e.s.fs.written.remove(&k); OK } else { OBJECT_NAME_NOT_FOUND }
        }
        "NtQueryDirectoryFile" | "NtQueryDirectoryFileEx" => 0x8000_0006, // STATUS_NO_MORE_FILES
        "NtDeviceIoControlFile" | "NtFsControlFile" => {
            // sockets: Wine's ws2_32 creates them with IOCTL_AFD_WINE_CREATE; nothing else works yet
            if name == "NtDeviceIoControlFile" && matches!(e.s.fs.handles.get(&a0), Some(Handle::Afd)) {
                let (iosb, code) = (e.arg(4), e.arg(5) as u32);
                let (inp, inl, out, outl) = (e.arg(6), e.arg(7) as u32 as u64, e.arg(8), e.arg(9) as u32 as u64);
                match code {
                    0x12_0320 => { e.iosb(iosb, OK, 0); return Some(OK); } // create
                    // bind: the address asked for is the address got
                    0x1_2003 => {
                        let n = inl.saturating_sub(4).min(outl);
                        let mut v = vec![0u8; n as usize];
                        let _ = e.mmu.read_bytes(inp + 4, &mut v);
                        let _ = e.mmu.write_bytes(out, &v);
                        e.iosb(iosb, OK, n); return Some(OK);
                    }
                    // complete an async call that user mode already finished: the status is the input
                    0x12_0348 => { let st = e.mmu.read32(inp).unwrap_or(0) as u64; e.iosb(iosb, st, 0); return Some(st); }
                    _ => {}
                }
                if unsafe { crate::TRACE } { crate::console(&format!("[afd] ioctl {:x}\n", code)); }
                return Some(0xC000_00BB); // STATUS_NOT_SUPPORTED
            }
            0xC000_0010 // STATUS_INVALID_DEVICE_REQUEST
        }
        "NtCancelIoFile" | "NtCancelIoFileEx" | "NtCancelSynchronousIoFile" => { let p = e.arg(1); e.iosb(p, OK, 0); OK }
        "NtCreateNamedPipeFile" | "NtCreateMailslotFile" => NOT_IMPLEMENTED,

        // ---- memory ----
        "NtAllocateVirtualMemory" | "NtAllocateVirtualMemoryEx" => {
            let (bp, sp) = (e.arg(1), if name == "NtAllocateVirtualMemory" { e.arg(3) } else { e.arg(2) });
            let (want, size) = (e.mmu.read64(bp).unwrap_or(0), e.mmu.read64(sp).unwrap_or(0));
            let kind = e.arg(if name == "NtAllocateVirtualMemory" { 4 } else { 3 }) as u32;
            let a = if want == 0 { if kind & 0x1000 == 0 { e.reserve(size) } else { e.alloc(size) } } else if e.mmu.region_of(want).is_some() { Some(want & !0xFFF) } else {
                let s = want & !0xFFFF; let end = (want + size + 0xFFFF) & !0xFFFF;
                if e.mmu.overlaps(s, end) { None } else { e.mmu.add_region(s, end - s); Some(s) }
            };
            match a {
                Some(a) => { let _ = e.mmu.write64(bp, a); let _ = e.mmu.write64(sp, (size + 0xFFF) & !0xFFF); OK }
                None => 0xC000_0017, // NO_MEMORY
            }
        }
        "NtFreeVirtualMemory" => {
            let (bp, sp, kind) = (e.arg(1), e.arg(2), e.arg(3) as u32);
            let (a, size) = (e.mmu.read64(bp).unwrap_or(0), e.mmu.read64(sp).unwrap_or(0));
            if kind & 0x8000 != 0 { e.mmu.release_region(a); } else { e.mmu.drop_pages(a & !0xFFF, a + size); }
            OK
        }
        "NtProtectVirtualMemory" => { let old = e.arg(4); let _ = e.mmu.write32(old, 4); OK }
        "NtFlushInstructionCache" | "NtLockVirtualMemory" | "NtUnlockVirtualMemory" => OK,
        "NtQueryVirtualMemory" => {
            let (addr, class, buf, len, ret) = (e.arg(1), e.arg(2) as u32, e.arg(3), e.arg(4), e.arg(5));
            if class != 0 { return Some(INVALID_INFO_CLASS); }
            if len < 48 { return Some(INFO_LENGTH_MISMATCH); }
            e.zero_n(buf, 48);
            let page = addr & !0xFFF;
            let _ = e.mmu.write64(buf, page);
            match e.mmu.region_of(addr) {
                Some((s, end)) => {
                    let _ = e.mmu.write64(buf + 8, s); let _ = e.mmu.write32(buf + 16, 4); let _ = e.mmu.write64(buf + 24, end - page);
                    let _ = e.mmu.write32(buf + 32, 0x1000); let _ = e.mmu.write32(buf + 36, 4); let _ = e.mmu.write32(buf + 40, 0x20000);
                }
                None => {
                    // inside a loaded image?
                    match e.s.modules.iter().find(|m| !m.native && addr >= m.base && addr < m.base + m.size).map(|m| (m.base, m.size)) {
                        Some((b, sz)) => {
                            let _ = e.mmu.write64(buf + 8, b); let _ = e.mmu.write32(buf + 16, 0x80); let _ = e.mmu.write64(buf + 24, b + sz - page);
                            let _ = e.mmu.write32(buf + 32, 0x1000); let _ = e.mmu.write32(buf + 36, 0x20); let _ = e.mmu.write32(buf + 40, 0x100_0000);
                        }
                        None => { let _ = e.mmu.write64(buf + 24, 0x1000); let _ = e.mmu.write32(buf + 32, 0x10000); let _ = e.mmu.write32(buf + 36, 1); }
                    }
                }
            }
            if ret != 0 { let _ = e.mmu.write64(ret, 48); }
            OK
        }
        "NtReadVirtualMemory" => {
            let (src, dst, n, ret) = (e.arg(1), e.arg(2), e.arg(3), e.arg(4));
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(src, &mut v).is_err() || e.mmu.write_bytes(dst, &v).is_err() { return Some(0x8000_0005 + 0x4000_0000); }
            if ret != 0 { let _ = e.mmu.write64(ret, n); }
            OK
        }
        "NtWriteVirtualMemory" => {
            let (dst, src, n, ret) = (e.arg(1), e.arg(2), e.arg(3), e.arg(4));
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(src, &mut v).is_err() || e.mmu.write_bytes(dst, &v).is_err() { return Some(ACCESS_DENIED); }
            if ret != 0 { let _ = e.mmu.write64(ret, n); }
            OK
        }

        // ---- processes, threads, system ----
        "NtQueryInformationProcess" | "NtWow64QueryInformationProcess64" => {
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            let need: u64 = match class { 0 => 48, 7 | 26 | 30 | 31 => 8, 12 | 34 | 36 | 31_000 => 4, 20 => 4, 2 | 3 | 4 => 112.min(len), _ => 0 };
            if need == 0 { return Some(INVALID_INFO_CLASS); }
            if len < need { return Some(INFO_LENGTH_MISMATCH); }
            e.zero_n(buf, need);
            match class {
                0 => { let _ = e.mmu.write64(buf + 8, crate::PEB); let _ = e.mmu.write64(buf + 16, (1u64 << e.s.cores) - 1); let _ = e.mmu.write32(buf + 24, 8); let _ = e.mmu.write64(buf + 32, 4); }
                31 => { let _ = e.mmu.write32(buf, 1); } // ProcessDebugFlags: no debugger
                26 => { if e.s.wow64 { let _ = e.mmu.write64(buf, crate::PEB32); } } // ProcessWow64Information: the 32-bit PEB
                4 => if let Some((c, u)) = e.cpu_times(a0, true) { let _ = e.mmu.write64(buf, c); let _ = e.mmu.write64(buf + 24, u); } // ProcessTimes
                36 => { let _ = e.mmu.write32(buf, 0x1234_5678); } // ProcessCookie
                _ => {}
            }
            if ret != 0 { let _ = e.mmu.write32(ret, need as u32); }
            if class == 30 { return Some(0xC000_0353); } // ProcessDebugObjectHandle: STATUS_PORT_NOT_SET
            OK
        }
        // ThreadWow64Context: the 32-bit registers live in the thread's CPU area (TEB TlsSlots[1] + 4)
        "NtSetInformationThread" if e.arg(1) == 0x1D => {
            let Some(area) = e.wow_ctx_of(a0) else { return Some(INVALID_HANDLE) };
            let mut b = vec![0u8; 0x2CC];
            let src = e.arg(2);
            if e.mmu.read_bytes(src, &mut b).is_err() { return Some(0xC000_0005); }
            // WOW64_CPURESERVED_FLAG_RESET_STATE: wow64cpu reloads every register on its way back
            let fl = e.mmu.read16(area - 4).unwrap_or(0);
            let _ = e.mmu.write16(area - 4, fl | 1);
            let _ = e.mmu.write_bytes(area, &b);
            OK
        }
        "NtQueryInformationThread" if e.arg(1) == 0x1D => {
            let Some(area) = e.wow_ctx_of(a0) else { return Some(INVALID_HANDLE) };
            let mut b = vec![0u8; 0x2CC];
            let _ = e.mmu.read_bytes(area, &mut b);
            let (dst, rl) = (e.arg(2), e.arg(4));
            let flags = e.mmu.read32(dst).unwrap_or(0x1003F);
            let _ = e.mmu.write_bytes(dst, &b);
            let _ = e.mmu.write32(dst, flags);
            if rl != 0 { let _ = e.mmu.write32(rl, 0x2CC); }
            OK
        }
        "NtSetInformationProcess" | "NtSetInformationThread" | "NtSetInformationObject" => OK,
        "NtQueryInformationThread" => {
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            match class {
                0 => {
                    if len < 48 { return Some(INFO_LENGTH_MISMATCH); }
                    e.zero_n(buf, 48);
                    let teb = e.cpu.gs_base;
                    let _ = e.mmu.write32(buf, 0x103);
                    let _ = e.mmu.write64(buf + 8, teb);
                    let _ = e.mmu.write64(buf + 16, 4);
                    let tid = e.cur_tid() as u64;
                    let _ = e.mmu.write64(buf + 24, tid);
                    let _ = e.mmu.write64(buf + 32, 1);
                    if ret != 0 { let _ = e.mmu.write32(ret, 48); }
                    OK
                }
                1 => { // ThreadTimes
                    if len < 32 { return Some(INFO_LENGTH_MISMATCH); }
                    e.zero_n(buf, 32);
                    if let Some((c, u)) = e.cpu_times(a0, false) { let _ = e.mmu.write64(buf, c); let _ = e.mmu.write64(buf + 24, u); }
                    if ret != 0 { let _ = e.mmu.write32(ret, 32); }
                    OK
                }
                _ => { e.zero_n(buf, len.min(64)); if ret != 0 { let _ = e.mmu.write32(ret, len.min(64) as u32); } OK }
            }
        }
        "NtQuerySystemInformation" | "NtQuerySystemInformationEx" => {
            let (class, buf, len, ret) = if name == "NtQuerySystemInformation" { (a0 as u32, e.arg(1), e.arg(2) as u32 as u64, e.arg(3)) } else { (a0 as u32, e.arg(3), e.arg(4) as u32 as u64, e.arg(5)) };
            let need: u64 = match class { 0 | 0x3E => 64, 1 | 0x3F => 12, 3 => 48, 8 => 48 * e.s.cores as u64, 2 => 0x150, 0x67 => 8, 0xB5 if e.s.wow64 => 12, _ => 0 };
            if need == 0 { return Some(INVALID_INFO_CLASS); }
            if ret != 0 { let _ = e.mmu.write32(ret, need as u32); }
            if len < need { return Some(INFO_LENGTH_MISMATCH); }
            e.zero_n(buf, need);
            match class {
                // SystemSupportedProcessorArchitectures: x86-64 native, i386 for this (WoW64) process
                0xB5 => { let _ = e.mmu.write32(buf, 0x8664 | 7 << 16); let _ = e.mmu.write32(buf + 4, 0x14C | 2 << 16 | 1 << 19 | 1 << 20); }
                0 | 0x3E => {
                    let w32 = |e: &mut Engine, o: u64, v: u32| { let _ = e.mmu.write32(buf + o, v); };
                    w32(e, 4, 156_250); w32(e, 8, 4096); w32(e, 12, 2 << 20); w32(e, 16, 1); w32(e, 20, 2 << 20); w32(e, 24, 0x10000);
                    let _ = e.mmu.write64(buf + 0x20, 0x10000);
                    let _ = e.mmu.write64(buf + 0x28, if class == 0x3E { 0x7FFE_FFFF } else { 0x7FFF_FFFE_FFFF });
                    let _ = e.mmu.write64(buf + 0x30, (1u64 << e.s.cores) - 1);
                    let _ = e.mmu.write8(buf + 0x38, e.s.cores as u8);
                }
                1 | 0x3F => { let _ = e.mmu.write16(buf, if class == 0x3F { 0 } else { 9 }); let _ = e.mmu.write16(buf + 2, 6); let _ = e.mmu.write16(buf + 4, 0x9E00); let _ = e.mmu.write16(buf + 6, e.s.cores as u16); let _ = e.mmu.write32(buf + 8, 0x0000_3FFF); }
                3 => { let _ = e.mmu.write64(buf, now_ft()); let _ = e.mmu.write64(buf + 8, now_ft()); }
                _ => {}
            }
            OK
        }
        "NtQuerySystemTime" => { let _ = e.mmu.write64(a0, now_ft()); OK }
        "NtGetTickCount" => unsafe { crate::host_now_ms() as u64 & 0xFFFF_FFFF },
        "NtQueryPerformanceCounter" => { let v = unsafe { crate::host_now_ms() * 10_000.0 } as u64; let _ = e.mmu.write64(a0, v); let f = e.arg(1); if f != 0 { let _ = e.mmu.write64(f, 10_000_000); } OK }
        "NtQueryTimerResolution" => { let (b, c) = (e.arg(1), e.arg(2)); let _ = e.mmu.write32(a0, 156_250); let _ = e.mmu.write32(b, 5000); let _ = e.mmu.write32(c, 156_250); OK }
        "NtSetTimerResolution" => { let p = e.arg(2); let _ = e.mmu.write32(p, 10_000); OK }
        "NtGetCurrentProcessorNumber" => 0,
        "NtTerminateProcess" => {
            let code = e.arg(1) as u32;
            if a0 == 0 || a0 == u64::MAX { e.exit_process(code); return Some(crate::kernel32::NO_RETURN); }
            if let Some(Handle::Process { pid }) = e.s.fs.handles.get(&a0) { let p = *pid; if let Some(i) = e.s.pinfo.get_mut(&p) { if i.exit.is_none() { i.exit = Some(code); } } for t in e.s.sched.th.iter_mut() { if t.wpid == p { t.st = crate::sched::St::Done; } } }
            OK
        }
        "NtQueryDefaultLocale" => { let p = e.arg(1); let _ = e.mmu.write32(p, 0x409); OK }
        "NtQueryDefaultUILanguage" | "NtQueryInstallUILanguage" => { let _ = e.mmu.write16(a0, 0x409); OK }
        "NtQueryLicenseValue" => OBJECT_NAME_NOT_FOUND,
        "NtTraceControl" | "NtTraceEvent" => OK,
        "NtDuplicateObject" => { let (h, out) = (e.arg(1), e.arg(3)); let h = e.dup_handle(h); if out != 0 { let _ = e.mmu.write64(out, h); } OK }
        "NtQueryObject" => INVALID_INFO_CLASS,
        "NtDisplayString" => OK,

        // ---- tokens and security: no accounts ----
        "NtOpenProcessToken" | "NtOpenProcessTokenEx" | "NtOpenThreadToken" | "NtOpenThreadTokenEx" => {
            if name.starts_with("NtOpenThread") { 0xC000_007C } // STATUS_NO_TOKEN
            else { let p = e.arg(if name.ends_with("Ex") { 3 } else { 2 }); let _ = e.mmu.write64(p, 0x7FF0); OK }
        }
        "NtQueryInformationToken" => {
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            match class {
                18 | 20 => { if ret != 0 { let _ = e.mmu.write32(ret, 4); } if len < 4 { return Some(BUFFER_TOO_SMALL); } let _ = e.mmu.write32(buf, if class == 18 { 1 } else { 0 }); OK }
                1 | 25 => {
                    // TokenUser / TokenIntegrityLevel: SID_AND_ATTRIBUTES + SID
                    let sid: Vec<u8> = if class == 1 { vec![1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0xE8, 3, 0, 0] } else { vec![1, 1, 0, 0, 0, 0, 0, 16, 0, 0x30, 0, 0] };
                    let need = 16 + sid.len() as u64;
                    if ret != 0 { let _ = e.mmu.write32(ret, need as u32); }
                    if len < need { return Some(BUFFER_TOO_SMALL); }
                    let _ = e.mmu.write64(buf, buf + 16);
                    let _ = e.mmu.write32(buf + 8, if class == 25 { 0x20 } else { 0 });
                    let _ = e.mmu.write_bytes(buf + 16, &sid);
                    OK
                }
                _ => INVALID_INFO_CLASS,
            }
        }
        "NtAccessCheck" | "NtPrivilegeCheck" | "NtAdjustPrivilegesToken" => ACCESS_DENIED,

        // ---- registry: empty ----
        "NtOpenKey" | "NtOpenKeyEx" | "NtCreateKey" | "NtOpenKeyTransacted" | "NtOpenKeyTransactedEx" => OBJECT_NAME_NOT_FOUND,
        "NtQueryValueKey" | "NtQueryKey" | "NtEnumerateKey" | "NtEnumerateValueKey" | "NtDeleteKey" | "NtDeleteValueKey" | "NtSetValueKey" | "NtNotifyChangeKey" | "NtFlushKey" => INVALID_HANDLE,

        // ---- sections: no file mapping yet ----
        "NtCreateSection" => {
            // (handle*, access, attributes, size*, protection, allocation, file)
            let (sp, file) = (e.arg(3), e.arg(6));
            if file != 0 && e.arg(5) & 0x100_0000 != 0 {
                // SEC_IMAGE: must be a PE file
                let Some(Handle::File { name, .. }) = e.s.fs.handles.get(&file) else { return Some(INVALID_HANDLE) };
                let name = name.clone();
                let ok = e.s.files.get(&name).map_or(false, |d| d.len() > 0x40 && &d[..2] == b"MZ");
                if !ok { return Some(0xC000_007B); } // STATUS_INVALID_IMAGE_FORMAT
                let h = e.new_handle(Handle::ImageSection { file: name });
                let _ = e.mmu.write64(a0, h);
                return Some(OK);
            }
            let want = if sp != 0 { e.mmu.read64(sp).unwrap_or(0) } else { 0 };
            let s = if file != 0 {
                let Some(Handle::File { name, .. }) = e.s.fs.handles.get(&file) else { return Some(INVALID_HANDLE) };
                let name = name.clone();
                let len = e.s.files.get(&name).map_or(0, |d| d.len() as u64);
                if want > len { if let Some(d) = e.s.files.get_mut(&name) { d.resize(want as usize, 0); } }
                let size = want.max(len);
                if size == 0 { return Some(0xC000_011E); } // STATUS_MAPPED_FILE_SIZE_ZERO
                Handle::Section { file: Some(name), size, base: 0 }
            } else {
                if want == 0 { return Some(INVALID_PARAMETER); }
                Handle::Section { file: None, size: want, base: 0 }
            };
            let h = e.new_handle(s);
            let _ = e.mmu.write64(a0, h);
            OK
        }
        "NtMapViewOfSection" | "NtMapViewOfSectionEx" => {
            // (section, process, base*, zero bits, commit, offset*, view size*, ...) / Ex: (section, process, base*, offset*, view size*, ...)
            let ex = name == "NtMapViewOfSectionEx";
            let (bp, op, vp) = if ex { (e.arg(2), e.arg(3), e.arg(4)) } else { (e.arg(2), e.arg(5), e.arg(6)) };
            let off = if op != 0 { e.mmu.read64(op).unwrap_or(0) } else { 0 };
            let want = if vp != 0 { e.mmu.read64(vp).unwrap_or(0) } else { 0 };
            if let Some(Handle::ImageSection { file }) = e.s.fs.handles.get(&a0) {
                if file == "wine32-ntdll.dll" && e.s.wow64_ntdll != 0 {
                    // the 32-bit ntdll the engine mapped at process start
                    let a = e.s.wow64_ntdll;
                    let sz = e.s.images.get(&a).copied().unwrap_or(0);
                    let _ = e.mmu.write64(bp, a);
                    if vp != 0 { let _ = e.mmu.write64(vp, sz); }
                    return Some(OK);
                }
                let Some(b) = e.s.files.get(file).cloned() else { return Some(INVALID_HANDLE) };
                let (a, sz, moved) = match crate::pe::map_image(e, &b) { Ok(v) => v, Err(_) => return Some(0xC000_007B) };
                let _ = e.mmu.write64(bp, a);
                if vp != 0 { let _ = e.mmu.write64(vp, sz); }
                return Some(if moved { 0x4000_0003 } else { OK }); // STATUS_IMAGE_NOT_AT_BASE
            }
            let (file, size, base) = match e.s.fs.handles.get(&a0) { Some(Handle::Section { file, size, base }) => (file.clone(), *size, *base), _ => return Some(INVALID_HANDLE) };
            if off > size { return Some(INVALID_PARAMETER); }
            let len = if want == 0 { size - off } else { want.min(size - off) };
            let addr = match &file {
                Some(f) => {
                    let Some(a) = e.alloc((len + 0xFFF) & !0xFFF) else { return Some(0xC000_0017) };
                    let data = e.s.files.get(f).map(|d| d[(off as usize).min(d.len())..((off + len) as usize).min(d.len())].to_vec()).unwrap_or_default();
                    let _ = e.mmu.write_bytes(a, &data);
                    e.s.fs.views.insert(a, (f.clone(), off, len));
                    a
                }
                None if base != 0 => base + off,
                None => {
                    let Some(a) = e.alloc((size + 0xFFF) & !0xFFF) else { return Some(0xC000_0017) };
                    if let Some(Handle::Section { base, .. }) = e.s.fs.handles.get_mut(&a0) { *base = a; }
                    a + off
                }
            };
            let _ = e.mmu.write64(bp, addr);
            if vp != 0 { let _ = e.mmu.write64(vp, (len + 0xFFF) & !0xFFF); }
            OK
        }
        "NtUnmapViewOfSection" | "NtUnmapViewOfSectionEx" => {
            // a file view: its bytes go back to the file
            let a = e.arg(1);
            if e.s.images.remove(&a).is_some() { e.mmu.release_region(a); return Some(OK); }
            if let Some((f, off, len)) = e.s.fs.views.remove(&a) {
                let mut v = vec![0u8; len as usize];
                if e.mmu.read_bytes(a, &mut v).is_ok() {
                    if let Some(d) = e.s.files.get_mut(&f) {
                        let end = ((off + len) as usize).min(d.len());
                        let o = (off as usize).min(end);
                        if d[o..end] != v[..end - o] { d[o..end].copy_from_slice(&v[..end - o]); e.s.fs.written.insert(f); }
                    }
                }
                e.mmu.release_region(a);
            }
            OK
        }
        "NtOpenSection" => {
            // (handle*, access, attributes): only \KnownDlls32\<dll> (32-bit system DLLs)
            let oa = e.arg(2); let nm = e.oa_name(oa);
            let low = nm.to_ascii_lowercase();
            let Some(dll) = low.strip_prefix("\\knowndlls32\\") else { return Some(OBJECT_NAME_NOT_FOUND) };
            let file = format!("wine32-{}", dll);
            if !e.s.files.contains_key(&file) { return Some(OBJECT_NAME_NOT_FOUND); }
            let h = e.new_handle(Handle::ImageSection { file });
            let _ = e.mmu.write64(a0, h);
            OK
        }
        "NtQuerySection" => {
            // (section, class, info*, length, return length*)
            let (cls, out, ret) = (e.arg(1), e.arg(2), e.arg(4));
            let (img, size) = match e.s.fs.handles.get(&a0) {
                Some(Handle::ImageSection { file }) => (e.s.files.get(file).cloned(), 0),
                Some(Handle::Section { size, .. }) => (None, *size),
                _ => return Some(INVALID_HANDLE),
            };
            let zero = [0u8; 0x40];
            match (cls, img) {
                (0, img) => {
                    // SECTION_BASIC_INFORMATION
                    let _ = e.mmu.write_bytes(out, &zero[..0x18]);
                    let size = match &img { Some(b) => crate::pe::image_size(b).unwrap_or(0), None => size };
                    let _ = e.mmu.write32(out + 8, if img.is_some() { 0x0100_0000 } else { 0x0800_0000 });
                    let _ = e.mmu.write64(out + 0x10, size);
                    if ret != 0 { let _ = e.mmu.write64(ret, 0x18); }
                    OK
                }
                (1, Some(b)) => {
                    // SECTION_IMAGE_INFORMATION
                    let Some(i) = crate::pe::image_info(&b) else { return Some(0xC000_007B) };
                    let _ = e.mmu.write_bytes(out, &zero);
                    let _ = e.mmu.write64(out, i.entry);
                    let _ = e.mmu.write64(out + 0x10, i.stack_reserve);
                    let _ = e.mmu.write64(out + 0x18, i.stack_commit);
                    let _ = e.mmu.write32(out + 0x20, i.subsystem as u32);
                    let _ = e.mmu.write16(out + 0x24, i.subsys_minor);
                    let _ = e.mmu.write16(out + 0x26, i.subsys_major);
                    let _ = e.mmu.write16(out + 0x2C, i.characteristics);
                    let _ = e.mmu.write16(out + 0x2E, i.dll_characteristics);
                    let _ = e.mmu.write16(out + 0x30, i.machine);
                    let _ = e.mmu.write8(out + 0x32, 1);
                    let _ = e.mmu.write32(out + 0x38, b.len() as u32);
                    if ret != 0 { let _ = e.mmu.write64(ret, 0x40); }
                    OK
                }
                _ => INVALID_PARAMETER,
            }
        }
        "NtInitializeNlsFiles" | "NtGetNlsSectionPtr" => {
            // Wine's .nls tables (only the 32-bit DLLs ask): mapped read-only copies
            let (file, pp, sp) = if name == "NtInitializeNlsFiles" {
                let lp = e.arg(1);
                if lp != 0 { let _ = e.mmu.write32(lp, 0x409); }
                ("locale.nls".to_string(), a0, e.arg(2))
            } else {
                let id = e.arg(1);
                let f = match a0 { 9 => "sortdefault.nls".into(), 10 => "l_intl.nls".into(), 11 => format!("c_{:03}.nls", id),
                    12 => match id { 1 => "normnfc.nls", 2 => "normnfd.nls", 5 => "normnfkc.nls", 6 => "normnfkd.nls", 13 => "normidna.nls", _ => "" }.into(),
                    _ => String::new() };
                (f, e.arg(3), e.arg(4))
            };
            let Some(d) = e.s.files.get(&file).cloned() else { return Some(OBJECT_NAME_NOT_FOUND) };
            let Some(a) = e.alloc((d.len() as u64 + 0xFFF) & !0xFFF) else { return Some(0xC000_0017) };
            let _ = e.mmu.write_bytes(a, &d);
            let _ = e.mmu.write64(pp, a);
            if sp != 0 { let _ = e.mmu.write64(sp, d.len() as u64); }
            OK
        }
        "NtAreMappedFilesTheSame" => 0xC000_00D4, // STATUS_NOT_SAME_DEVICE: each image is its own
        "NtCreateIoCompletion" => { let h = e.new_handle(Handle::Event { set: false, manual: false }); let _ = e.mmu.write64(a0, h); OK }
        "NtSetIoCompletion" | "NtRemoveIoCompletion" | "NtRemoveIoCompletionEx" => NOT_IMPLEMENTED,
        "NtCreateKeyedEvent" | "NtOpenKeyedEvent" => { let _ = e.mmu.write64(a0, 0x7FF4); OK }
        _ => return None,
    };
    Some(r)
}
