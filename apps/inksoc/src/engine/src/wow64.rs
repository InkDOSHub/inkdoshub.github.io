// 32-bit Windows programs (WoW64), the way Windows and Wine run them: the
// program and Wine's 32-bit DLLs (ntdll, kernel32, user32...) run as 32-bit
// code; their system calls reach Wine's 64-bit wow64.dll through
// wow64cpu.dll (a far jump to 64-bit code), which converts the arguments
// and calls the 64-bit ntdll functions the engine implements.
//
// What the engine does here is what Wine's Unix side does at process start:
// map the 32-bit ntdll and the program, fill the 32-bit PEB/TEB, the CPU
// area with the initial 32-bit context, and start the main thread in
// wow64.dll's Wow64LdrpInitialize.

use crate::{pe, Engine, PEB, PEB32, TEB, TEB32_OFF};

/// Is this a 32-bit x86 PE image?
pub fn is_pe32(b: &[u8]) -> bool {
    if b.len() < 0x40 || &b[..2] != b"MZ" { return false; }
    let pe = u32::from_le_bytes([b[0x3C], b[0x3D], b[0x3E], b[0x3F]]) as usize;
    b.len() > pe + 6 && &b[pe..pe + 4] == b"PE\0\0" && u16::from_le_bytes([b[pe + 4], b[pe + 5]]) == 0x14C
}

/// Lowest address of the 32-bit program's allocations.
pub const LOW_ALLOC: u64 = 0x0100_0000;

impl Engine {

    /// A 32-bit UNICODE_STRING at `at` (buffer on the heap, below 4 GB here).
    fn us32(&mut self, at: u64, s: &str) {
        let w: Vec<u16> = s.encode_utf16().collect();
        let b = self.heap_alloc(2 * w.len() as u64 + 2, true);
        for (k, c) in w.iter().enumerate() { let _ = self.mmu.write16(b + 2 * k as u64, *c); }
        let _ = self.mmu.write16(at, 2 * w.len() as u16);
        let _ = self.mmu.write16(at + 2, 2 * w.len() as u16 + 2);
        self.w32(at + 4, b as u32);
    }

    /// Fills the 32-bit TEB of a thread (TEB64 + 0x2000) and links it to the 64-bit one.
    pub fn init_teb32(&mut self, teb: u64, stack_lo: u64, stack_hi: u64, tid: u32) {
        let t = teb + TEB32_OFF;
        if !self.mmu.overlaps(t, t + 0x2000) { self.mmu.add_region(t, 0x2000); }
        self.w32(t, 0xFFFF_FFFF);            // no SEH frame yet
        self.w32(t + 4, stack_hi as u32);
        self.w32(t + 8, stack_lo as u32);
        self.w32(t + 0x18, t as u32);        // Self
        self.w32(t + 0x20, 4);               // process id
        self.w32(t + 0x24, tid);
        self.w32(t + 0x30, PEB32 as u32);
        self.w32(t + 0x188, (t + 0x188) as u32); // activation context frame list (empty)
        self.w32(t + 0x18C, (t + 0x188) as u32);
        self.w32(t + 0x1A8, (t + 0x184) as u32);
        let _ = self.mmu.write16(t + 0xBFA, 522);
        self.w32(t + 0xBFC, (t + 0xC00) as u32);
        self.w32(t + 0xE0C, stack_lo as u32);
        self.w32(t + 0xF70, teb as u32);     // GdiBatchCount: the 64-bit TEB
        self.w32(t + 0xFDC, (-(TEB32_OFF as i64)) as u32);
        // the 64-bit TEB: WowTebOffset, and its exception list points at the 32-bit TEB
        self.w32(teb + 0x180C, TEB32_OFF as u32);
        self.w64(teb, t);
    }

    /// The CPU area (TEB64 TlsSlots[WOW64_TLS_CPURESERVED]) with the first 32-bit context:
    /// RtlUserThreadStart(entry = eax, arg = ebx) on the 32-bit stack.
    pub fn init_cpu_area(&mut self, teb: u64, eip: u64, eax: u64, ebx: u64, esp: u64) {
        let cpu = self.heap_alloc(0x400, true);
        let _ = self.mmu.write16(cpu + 2, 0x14C); // Machine
        let c = cpu + 4;                          // I386_CONTEXT
        self.w32(c, 0x1003F);                     // CONTEXT_I386_ALL
        let _ = self.mmu.write16(c + 0x1C, 0x27F);
        for (o, v) in [(0x8C, 0x2B), (0x90, 0x53), (0x94, 0x2B), (0x98, 0x2B), (0xBC, 0x23), (0xC8, 0x2B)] { self.w32(c + o, v); }
        self.w32(c + 0xB0, eax as u32);
        self.w32(c + 0xA4, ebx as u32);
        self.w32(c + 0xB8, eip as u32);
        self.w32(c + 0xC0, 0x202);
        self.w32(c + 0xC4, esp as u32);
        let _ = self.mmu.write16(c + 0xCC, 0x27F);  // ExtendedRegisters (FXSAVE): control word, MXCSR
        self.w32(c + 0xCC + 24, 0x1F80);
        self.w64(teb + 0x1488, cpu);
    }

    /// The 32-bit context in the CPU area of thread handle `h` (-2 = current thread).
    pub fn wow_ctx_of(&mut self, h: u64) -> Option<u64> {
        let teb = if h == u64::MAX - 1 { self.cpu.gs_base } else {
            match self.s.fs.handles.get(&h) {
                Some(crate::files::Handle::Thread { tid }) => { let tid = *tid; self.s.sched.th.iter().find(|t| t.id == tid)?.teb }
                _ => return None,
            }
        };
        let cpu = self.mmu.read64(teb + 0x1488).ok()?;
        if cpu == 0 { None } else { Some(cpu + 4) }
    }

    /// Process start for a 32-bit program (the 64-bit TEB/PEB, stack and shared data exist already).
    pub fn wow64_boot(&mut self, name: &str, cmd: &str, bytes: &[u8]) -> Result<(), String> {
        // 64-bit side: Wine's ntdll (for its exported data) and the WoW64 layer
        self.wine_module_pub("wine-ntdll.dll").ok_or("wine-ntdll.dll is missing")?;
        let wow64 = pe::load_by_name(self, "wow64.dll")?;
        pe::load_by_name(self, "wow64win.dll")?;
        pe::load_by_name(self, "wow64cpu.dll")?;
        let init_thunk = pe::proc_address(self, wow64, "Wow64LdrpInitialize").ok_or("Wow64LdrpInitialize missing")?;

        // 32-bit ntdll and the program
        let nt32 = self.s.files.get("wine32-ntdll.dll").cloned().ok_or("wine32-ntdll.dll is missing")?;
        let (ntdll32, _, _) = pe::map_image(self, &nt32)?;
        let (exe, _, _) = pe::map_image(self, bytes)?;
        self.s.exe_base = exe;
        self.s.wow64_ntdll = ntdll32;

        // LdrSystemDllInitBlock of both ntdlls (what Wine's Unix side fills)
        let nt64 = pe::find_module(self, "wine-ntdll.dll").map(|i| self.s.modules[i].base).unwrap_or(0);
        let blk64 = pe::export_addr(self, nt64, "LdrSystemDllInitBlock").ok_or("no LdrSystemDllInitBlock")?;
        let blk32 = pe::export_addr(self, ntdll32, "LdrSystemDllInitBlock").ok_or("no 32-bit LdrSystemDllInitBlock")?;
        let f = |e: &mut Engine, n: &str| pe::export_addr(e, ntdll32, n).unwrap_or(0);
        let fields = [(0x18, f(self, "LdrInitializeThunk")), (0x20, f(self, "KiUserExceptionDispatcher")), (0x28, f(self, "KiUserApcDispatcher")),
                      (0x30, f(self, "KiUserCallbackDispatcher")), (0x38, f(self, "RtlUserThreadStart")), (0x40, f(self, "RtlpQueryProcessDebugInformationRemote")),
                      (0x48, ntdll32), (0x50, blk32), (0x58, f(self, "RtlpFreezeTimeBias"))];
        for blk in [blk64, blk32] {
            self.w32(blk, 0x30); // version
            for (o, v) in fields { self.w64(blk + o, v); }
        }
        let start32 = f(self, "RtlUserThreadStart");

        // 32-bit PEB and process parameters
        self.mmu.add_region(PEB32, 0x3000);
        self.w32(PEB32 + 8, exe as u32);
        let p = self.heap_alloc(0x400, true);
        self.w32(p, 0x400); self.w32(p + 4, 0x400); self.w32(p + 8, 1); // normalized
        let std = self.s.std;
        for (k, h) in std.iter().enumerate() { self.w32(p + 0x18 + 4 * k as u64, *h as u32); }
        self.us32(p + 0x24, &format!("{}\\", crate::files::home_win()));
        self.us32(p + 0x30, &format!("{};C:\\Windows\\SysWOW64", crate::files::home_win()));
        self.us32(p + 0x38, &format!("{}\\{}", crate::files::home_win(), name));
        self.us32(p + 0x40, cmd);
        let env = self.s.env_block;
        let pp = self.mmu.read64(PEB + 0x20).unwrap_or(0);
        let env_len = self.mmu.read64(pp + 0x3F0).unwrap_or(0);
        self.w32(p + 0x48, env as u32);
        self.us32(p + 0x70, "");
        self.us32(p + 0x78, "WinSta0\\Default");
        self.w32(p + 0x290, env_len as u32);
        self.w32(PEB32 + 0x10, p as u32);
        self.w32(PEB32 + 0x64, self.s.cores.max(1));
        self.w32(PEB32 + 0x70, 0xDC3C_BA00); self.w32(PEB32 + 0x74, 0xFFFF_FFFD); // CriticalSectionTimeout: -2592000 s
        self.w32(PEB32 + 0x78, 0x10_0000); self.w32(PEB32 + 0x7C, 0x2000);
        self.w32(PEB32 + 0x80, 0x1_0000); self.w32(PEB32 + 0x84, 0x1000);
        self.w32(PEB32 + 0xA4, 10); self.w32(PEB32 + 0xA8, 0); self.w32(PEB32 + 0xAC, 19045); self.w32(PEB32 + 0xB0, 2);
        let sub = pe::subsystem(bytes).unwrap_or(3);
        self.w32(PEB32 + 0xB4, sub as u32); self.w32(PEB32 + 0xB8, 6);
        // the 64-bit PEB points at the same program
        self.w64(PEB + 0x10, exe);

        // main thread: 32-bit stack, TEB32, CPU area
        let st = self.alloc(crate::STACK_SIZE).ok_or("out of memory")?;
        self.init_teb32(TEB, st, st + crate::STACK_SIZE, 8);
        let exe_entry = exe + pe::entry_rva(bytes).unwrap_or(0);
        self.init_cpu_area(TEB, start32, exe_entry, PEB32, st + crate::STACK_SIZE - 16);

        // 64-bit start: the DllMains of the 64-bit DLLs, then Wow64LdrpInitialize(context)
        let ctx = self.heap_alloc(0x500, true);
        self.s.exe_entry = init_thunk;
        self.s.wow64_ctx = ctx;
        Ok(())
    }
}
