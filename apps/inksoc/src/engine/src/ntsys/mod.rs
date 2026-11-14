// NT system calls for Wine's ntdll (the part Wine runs on its Unix side):
// files, memory, process/thread/system information, registry (registry.rs) and
// tokens. Waits, events, timers and the like are in sched.rs.

use crate::files::Handle;
use crate::status::*;
use crate::Engine;

mod file;
mod loader;
mod memory;
mod process;
mod section;
mod security;

/// The byte offset an NtReadFile/NtWriteFile call names, or None for "the current position"
/// (no offset, or FILE_USE_FILE_POINTER_POSITION / FILE_WRITE_TO_END_OF_FILE style negatives).
fn file_offset(e: &mut Engine, offp: u64) -> Option<u64> {
    if offp == 0 {
        return None;
    }
    let o = e.mmu.read64(offp).unwrap_or(u64::MAX);
    if o as i64 >= 0 {
        Some(o)
    } else {
        None
    }
}

impl Engine {
    pub(crate) fn iosb(&mut self, p: u64, status: u64, info: u64) {
        if p != 0 {
            self.w64(p, status);
            self.w64(p + 8, info);
        }
    }
    pub(crate) fn zero_n(&mut self, a: u64, n: u64) {
        for i in 0..n {
            self.w8(a + i, 0);
        }
    }
    /// Name of an OBJECT_ATTRIBUTES (its UNICODE_STRING ObjectName).
    pub(crate) fn oa_name(&mut self, oa: u64) -> String {
        let us = self.r64(oa + 16);
        if us == 0 {
            return String::new();
        }
        let len = self.r16(us) as usize / 2;
        let buf = self.r64(us + 8);
        let v: Vec<u16> = (0..len).map(|i| self.r16(buf + 2 * i as u64)).collect();
        String::from_utf16_lossy(&v)
    }
    /// Text of a UNICODE_STRING.
    pub(crate) fn us_read(&mut self, us: u64) -> String {
        if us == 0 {
            return String::new();
        }
        let len = self.r16(us) as usize / 2;
        let buf = self.r64(us + 8);
        let v: Vec<u16> = (0..len).map(|i| self.r16(buf + 2 * i as u64)).collect();
        String::from_utf16_lossy(&v)
    }
    /// An LDR_DATA_TABLE_ENTRY for a module (made once, on demand).
    fn ldr_entry(&mut self, base: u64) -> u64 {
        if let Some(&a) = self.s.ldr_entries.get(&base) {
            return a;
        }
        let Some(m) = self.s.modules.iter().find(|m| m.base == base) else { return 0 };
        let (name, size, entry) = (m.name.clone(), m.size, m.entry);
        let a = self.heap_alloc(0x140, true);
        self.w64(a + 0x30, base);
        self.w64(a + 0x38, entry);
        self.w32(a + 0x40, size as u32);
        for (off, text) in [(0x48u64, format!("C:\\Windows\\System32\\{}", name)), (0x58, name)] {
            let w: Vec<u16> = text.encode_utf16().collect();
            let b = self.heap_alloc(2 * w.len() as u64 + 2, true);
            for (k, c) in w.iter().enumerate() {
                self.w16(b + 2 * k as u64, *c);
            }
            self.w16(a + off, 2 * w.len() as u16);
            self.w16(a + off + 2, 2 * w.len() as u16 + 2);
            self.w64(a + off + 8, b);
        }
        self.w16(a + 0x6C, 1); // ObsoleteLoadCount
        self.s.ldr_entries.insert(base, a);
        a
    }
    /// Loads the CPU from a CONTEXT (registers, flags, rip, XMM).
    pub fn load_context(&mut self, c: u64) {
        let flags = self.r32(c + 0x30);
        for i in 0..16 {
            self.cpu.regs[i] = self.r64(c + 0x78 + 8 * i as u64);
        }
        let f = self.mmu.read32(c + 0x44).unwrap_or(0x202) as u64;
        self.set_flags(f);
        if flags & 8 != 0 || flags == 0 {
            for i in 0..16u64 {
                let lo = self.r64(c + 0x1A0 + 16 * i) as u128;
                let hi = self.r64(c + 0x1A8 + 16 * i) as u128;
                self.cpu.xmm[i as usize] = lo | hi << 64;
            }
        }
        self.cpu.rip = self.r64(c + 0xF8);
    }
    fn file_info(&mut self, h: u64) -> Option<(bool, u64, u64)> {
        // (is directory, size, position)
        match self.s.fs.handles.get(&h) {
            Some(Handle::File { name, pos }) => {
                let p = *pos;
                let n = name.clone();
                Some((false, self.s.files.size(&n).unwrap_or(0), p))
            }
            Some(Handle::Dir) => Some((true, 0, 0)),
            _ => None,
        }
    }
}

/// Each family of calls lives in its own file; the first one that knows the name answers.
pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    const FAMILIES: [fn(&mut Engine, &str) -> Option<u64>; 6] =
        [loader::call, file::call, memory::call, process::call, security::call, section::call];
    for family in FAMILIES {
        e.not_mine = false;
        let r = family(e, name);
        if !e.not_mine {
            return r;
        }
    }
    None // e.not_mine stays set: no family has this name
}
