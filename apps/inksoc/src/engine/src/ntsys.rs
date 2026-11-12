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
    fn oa_name(&mut self, oa: u64) -> String {
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
        "NtContinue" => { e.load_context(a0); return Some(crate::kernel32::NO_RETURN); }
        "NtRaiseException" => {
            let code = e.mmu.read32(a0).unwrap_or(0);
            let at = e.mmu.read64(a0 + 16).unwrap_or(0);
            let info = e.mmu.read64(a0 + 32).unwrap_or(0);
            let msg = match code {
                0xC000_0005 => format!("access violation at 0x{:x}", info),
                0xE06D_7363 => "unhandled C++ exception".to_string(),
                c => format!("unhandled exception 0x{:x}", c),
            };
            e.set_error(format!("{} (at 0x{:x})", msg, at));
            return Some(crate::kernel32::NO_RETURN);
        }
        "NtQueryInformationJobObject" => { let (b, n, r) = (e.arg(2), e.arg(3) as u32 as u64, e.arg(4)); e.zero_n(b, n); if r != 0 { let _ = e.mmu.write32(r, n as u32); } OK }
        "NtIsProcessInJob" => 0x0000_0123, // STATUS_PROCESS_NOT_IN_JOB
        // ---- files ----
        "NtReadFile" => {
            let (iosb, buf, n, offp) = (e.arg(4), e.arg(5), e.arg(6) as u32 as u64, e.arg(7));
            if a0 == 3 || matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) { e.iosb(iosb, END_OF_FILE, 0); return Some(END_OF_FILE); }
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
                34 => { for o in [0, 8, 16, 24] { let _ = e.mmu.write64(buf + o, ft); } let _ = e.mmu.write64(buf + 32, (size + 4095) & !4095); let _ = e.mmu.write64(buf + 40, size); let _ = e.mmu.write32(buf + 48, attr); }
                _ => {}
            }
            e.iosb(iosb, OK, need);
            OK
        }
        "NtSetInformationFile" => {
            let (iosb, buf, class) = (e.arg(1), e.arg(2), e.arg(4) as u32);
            match class {
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
            let k = nm.rsplit(['\\', '/']).next().unwrap_or(&nm).to_ascii_lowercase();
            let out = e.arg(1);
            let found = if k.is_empty() || k == "inksoc" || k.ends_with(':') || e.s.fs.dirs.contains(&k) { Some((0x10u32, 0u64)) } else { e.s.files.get(&k).map(|d| (0x80u32, d.len() as u64)) };
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
            let k = nm.rsplit(['\\', '/']).next().unwrap_or(&nm).to_ascii_lowercase();
            let disp = if name == "NtCreateFile" { e.arg(7) as u32 } else { 1 }; // FILE_OPEN
            if k.is_empty() || k == "inksoc" || k.ends_with(':') || k == "??" {
                let h = e.new_handle(Handle::Dir); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, 1); return Some(OK);
            }
            if nm.starts_with("\\??\\CON") || nm.eq_ignore_ascii_case("CONOUT$") { let _ = e.mmu.write64(a0, 1); e.iosb(iosb, OK, 1); return Some(OK); }
            if k == "nul" { let h = e.new_handle(Handle::Null); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, 1); return Some(OK); }
            let opts = if name == "NtCreateFile" { e.arg(8) as u32 } else { e.arg(5) as u32 };
            let is_dir = e.s.fs.dirs.contains(&k);
            if is_dir || opts & 1 != 0 { // FILE_DIRECTORY_FILE
                if !is_dir && matches!(disp, 2 | 3) && !e.s.files.contains_key(&k) { e.s.fs.dirs.insert(k.clone()); }
                else if !is_dir { return Some(OBJECT_NAME_NOT_FOUND); }
                else if disp == 2 { return Some(0xC000_0035); }
                let h = e.new_handle(Handle::Dir); let _ = e.mmu.write64(a0, h); e.iosb(iosb, OK, if is_dir { 1 } else { 2 }); return Some(OK);
            }
            let exists = e.s.files.contains_key(&k);
            // FILE_SUPERSEDE 0, OPEN 1, CREATE 2, OPEN_IF 3, OVERWRITE 4, OVERWRITE_IF 5
            match disp {
                1 | 4 if !exists => return Some(OBJECT_NAME_NOT_FOUND),
                2 if exists => return Some(0xC000_0035), // OBJECT_NAME_COLLISION
                _ => {}
            }
            if !exists || matches!(disp, 0 | 4 | 5) { e.s.files.insert(k.clone(), Vec::new()); e.s.fs.written.insert(k.clone()); }
            let h = e.new_handle(Handle::File { name: k, pos: 0 });
            let _ = e.mmu.write64(a0, h);
            e.iosb(iosb, OK, if exists { 1 } else { 2 });
            OK
        }
        "NtDeleteFile" => {
            let nm = e.oa_name(a0);
            let k = nm.rsplit(['\\', '/']).next().unwrap_or(&nm).to_ascii_lowercase();
            if e.s.files.remove(&k).is_some() { e.s.fs.written.remove(&k); OK } else { OBJECT_NAME_NOT_FOUND }
        }
        "NtQueryDirectoryFile" | "NtQueryDirectoryFileEx" => 0x8000_0006, // STATUS_NO_MORE_FILES
        "NtDeviceIoControlFile" | "NtFsControlFile" => 0xC000_0010, // STATUS_INVALID_DEVICE_REQUEST
        "NtCancelIoFile" | "NtCancelIoFileEx" | "NtCancelSynchronousIoFile" => { let p = e.arg(1); e.iosb(p, OK, 0); OK }
        "NtCreateNamedPipeFile" | "NtCreateMailslotFile" => NOT_IMPLEMENTED,

        // ---- memory ----
        "NtAllocateVirtualMemory" | "NtAllocateVirtualMemoryEx" => {
            let (bp, sp) = (e.arg(1), if name == "NtAllocateVirtualMemory" { e.arg(3) } else { e.arg(2) });
            let (want, size) = (e.mmu.read64(bp).unwrap_or(0), e.mmu.read64(sp).unwrap_or(0));
            let a = if want == 0 { e.alloc(size) } else if e.mmu.region_of(want).is_some() { Some(want & !0xFFF) } else {
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
                36 => { let _ = e.mmu.write32(buf, 0x1234_5678); } // ProcessCookie
                _ => {}
            }
            if ret != 0 { let _ = e.mmu.write32(ret, need as u32); }
            if class == 30 { return Some(0xC000_0353); } // ProcessDebugObjectHandle: STATUS_PORT_NOT_SET
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
                _ => { e.zero_n(buf, len.min(64)); if ret != 0 { let _ = e.mmu.write32(ret, len.min(64) as u32); } OK }
            }
        }
        "NtQuerySystemInformation" | "NtQuerySystemInformationEx" => {
            let (class, buf, len, ret) = if name == "NtQuerySystemInformation" { (a0 as u32, e.arg(1), e.arg(2) as u32 as u64, e.arg(3)) } else { (a0 as u32, e.arg(3), e.arg(4) as u32 as u64, e.arg(5)) };
            let need: u64 = match class { 0 => 64, 1 => 12, 3 => 48, 8 => 48 * e.s.cores as u64, 2 => 0x150, 0x67 => 8, _ => 0 };
            if need == 0 { return Some(INVALID_INFO_CLASS); }
            if ret != 0 { let _ = e.mmu.write32(ret, need as u32); }
            if len < need { return Some(INFO_LENGTH_MISMATCH); }
            e.zero_n(buf, need);
            match class {
                0 => {
                    let w32 = |e: &mut Engine, o: u64, v: u32| { let _ = e.mmu.write32(buf + o, v); };
                    w32(e, 4, 156_250); w32(e, 8, 4096); w32(e, 12, 2 << 20); w32(e, 16, 1); w32(e, 20, 2 << 20); w32(e, 24, 0x10000);
                    let _ = e.mmu.write64(buf + 0x20, 0x10000);
                    let _ = e.mmu.write64(buf + 0x28, 0x7FFF_FFFE_FFFF);
                    let _ = e.mmu.write64(buf + 0x30, (1u64 << e.s.cores) - 1);
                    let _ = e.mmu.write8(buf + 0x38, e.s.cores as u8);
                }
                1 => { let _ = e.mmu.write16(buf, 9); let _ = e.mmu.write16(buf + 2, 6); let _ = e.mmu.write16(buf + 4, 0x9E00); let _ = e.mmu.write16(buf + 6, e.s.cores as u16); let _ = e.mmu.write32(buf + 8, 0x0000_3FFF); }
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
        "NtTerminateProcess" => { if a0 == 0 || a0 == u64::MAX { e.s.exited = true; e.s.exit_code = e.arg(1) as u32; return Some(crate::kernel32::NO_RETURN); } OK }
        "NtQueryDefaultLocale" => { let p = e.arg(1); let _ = e.mmu.write32(p, 0x409); OK }
        "NtQueryDefaultUILanguage" | "NtQueryInstallUILanguage" => { let _ = e.mmu.write16(a0, 0x409); OK }
        "NtQueryLicenseValue" => OBJECT_NAME_NOT_FOUND,
        "NtTraceControl" | "NtTraceEvent" => OK,
        "NtDuplicateObject" => { let (h, out) = (e.arg(1), e.arg(3)); if out != 0 { let _ = e.mmu.write64(out, h); } OK }
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
        "NtCreateSection" | "NtOpenSection" | "NtMapViewOfSection" | "NtMapViewOfSectionEx" => NOT_IMPLEMENTED,
        "NtUnmapViewOfSection" | "NtUnmapViewOfSectionEx" => OK,
        "NtGetNlsSectionPtr" | "NtInitializeNlsFiles" => NOT_IMPLEMENTED,
        "NtCreateIoCompletion" => { let h = e.new_handle(Handle::Event { set: false, manual: false }); let _ = e.mmu.write64(a0, h); OK }
        "NtSetIoCompletion" | "NtRemoveIoCompletion" | "NtRemoveIoCompletionEx" => NOT_IMPLEMENTED,
        "NtCreateKeyedEvent" | "NtOpenKeyedEvent" => { let _ = e.mmu.write64(a0, 0x7FF4); OK }
        _ => return None,
    };
    Some(r)
}
