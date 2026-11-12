// InkSoC engine: PE32+ loader, x86-64 interpreter (integer + SSE/SSE2),
// 64-bit page table over a fixed pool of real RAM with swap to OPFS, our own
// kernel32, and a bridge to "Wine side" C code compiled to wasm.
// License: GPL-3.0-or-later.

mod cpu;
mod files;
mod heap;
mod kernel32;
mod mmu;
mod msvcrt;
mod oleaut;
mod pe;
mod sse;

use cpu::Cpu;
use mmu::Mmu;
use std::collections::HashMap;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_console(ptr: *const u8, len: u32);
    pub fn host_now_ms() -> f64;
    pub fn host_epoch_ms() -> f64;
}

extern "C" {
    fn wine_RtlComputeCrc32(init: u32, data: u64, len: i32) -> u32;
    fn wine_lstrlenA(s: u64) -> i32;
}

pub const THUNK_BASE: u64 = 0x7FFE_0000_0000;
pub const RET_EXIT: u64 = THUNK_BASE + 0xFFF0;
pub const RET_INIT: u64 = THUNK_BASE + 0xFFE0;
pub const RET_LOADLIB: u64 = THUNK_BASE + 0xFFD0;
pub const RET_INITTERM: u64 = THUNK_BASE + 0xFFC0;
pub const TEB: u64 = 0x7FFD_0000_0000;
pub const PEB: u64 = 0x7FFD_0001_0000;
const STACK_SIZE: u64 = 1 << 20;

pub struct Engine {
    pub mmu: Mmu,
    pub cpu: Cpu,
    pub exited: bool,
    pub exit_code: u32,
    pub error: Option<String>,
    pub next_alloc: u64,
    pub next_dll: u64,
    pub bridge_calls: u64,
    pub files: HashMap<String, Vec<u8>>,
    pub modules: Vec<pe::Module>,
    pub thunks: Vec<(String, String)>,
    thunk_ids: HashMap<String, u64>,
    pub heap: heap::Heap,
    pub tls_used: u64,
    pub init_queue: Vec<(u64, u64)>,
    pub loadlib: Vec<(u64, u64)>, // (module handle, caller rsp) while a DllMain runs
    pub stack_top: u64,
    pub exe_entry: u64,
    pub exe_base: u64,
    pub cmdline: (u64, u64),
    pub unknown_calls: u64,
    pub crt: msvcrt::Crt,
    pub fs: files::Files,
}

static mut ENGINE: Option<Engine> = None;
static mut BUF: Vec<u8> = Vec::new();
static mut MSG: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
pub(crate) fn eng() -> &'static mut Engine { unsafe { ENGINE.as_mut().unwrap() } }

pub fn console(s: &str) { unsafe { host_console(s.as_ptr(), s.len() as u32) } }

// ---- exports to JS ----

/// Scratch buffer the page fills before `add_file` / `start`.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn buffer(len: u32) -> *mut u8 {
    unsafe { BUF = vec![0u8; len as usize]; BUF.as_mut_ptr() }
}

/// Creates the machine: `pool_mb` of real RAM (fixed, never grows) and a
/// memory target of `target_mb` that the program sees (the rest is swap).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn init(pool_mb: u32, target_mb: u32) {
    unsafe {
        ENGINE = Some(Engine {
            mmu: Mmu::new(pool_mb as usize, target_mb as u64),
            cpu: Cpu::new(),
            exited: false, exit_code: 0, error: None,
            next_alloc: 0x0000_0200_0000_0000, // 2 TB: far above 4 GB on purpose
            next_dll: 0x0000_7FF0_0000_0000,
            bridge_calls: 0,
            files: HashMap::new(), modules: Vec::new(),
            thunks: Vec::new(), thunk_ids: HashMap::new(),
            heap: heap::Heap::default(), tls_used: 0,
            init_queue: Vec::new(), loadlib: Vec::new(),
            stack_top: 0, exe_entry: 0, exe_base: 0, cmdline: (0, 0), unknown_calls: 0, crt: Default::default(), fs: Default::default(),
        });
    }
}

/// Adds a file (from BUF) that the program can load, e.g. a DLL.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn add_file() {
    unsafe {
        let b = std::mem::take(&mut BUF);
        let nl = b.iter().position(|&c| c == 0).unwrap_or(0);
        let name = pe::norm(&String::from_utf8_lossy(&b[..nl]));
        eng().files.insert(name, b[nl + 1..].to_vec());
    }
}

/// Starts the program named in BUF ("name\0command line"). 0 = ok.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn start() -> i32 {
    let b = unsafe { std::mem::take(&mut BUF) };
    let nl = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    let name = pe::norm(&String::from_utf8_lossy(&b[..nl]));
    let cmd = String::from_utf8_lossy(b.get(nl + 1..).unwrap_or(&[])).into_owned();
    let e = eng();
    match e.boot(&name, &cmd) { Ok(()) => 0, Err(m) => { e.error = Some(m); -1 } }
}

#[no_mangle]
pub extern "C" fn poke32(addr: f64, v: u32) -> i32 {
    match eng().mmu.write32(addr as u64, v) { Ok(_) => 0, Err(_) => -1 }
}

/// Runs up to `budget` instructions. 0 = still running, 1 = exited, 2 = error.
#[no_mangle]
pub extern "C" fn run(budget: u32) -> i32 {
    let e = eng();
    let mut left = budget as u64;
    while left > 0 && !e.exited && e.error.is_none() {
        if e.cpu.rip >= THUNK_BASE && e.cpu.rip < THUNK_BASE + 0x10000 {
            e.call_native();
            continue;
        }
        let n = cpu::step_block(e, left.min(4096));
        left = left.saturating_sub(n);
    }
    if e.error.is_some() { 2 } else if e.exited { 1 } else { 0 }
}

static mut OUT: Vec<u8> = Vec::new();

/// The i-th file the program wrote: fills out_ptr() with "name\0data" and
/// returns its length, or 0 when there are no more.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn out_file(i: u32) -> u32 {
    let e = eng();
    let Some(name) = e.fs.written.iter().nth(i as usize).cloned() else { return 0 };
    let data = e.files.get(&name).cloned().unwrap_or_default();
    unsafe { OUT = name.into_bytes(); OUT.push(0); OUT.extend_from_slice(&data); OUT.len() as u32 }
}
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn out_ptr() -> *const u8 { unsafe { OUT.as_ptr() } }

#[no_mangle]
pub extern "C" fn stat(i: u32) -> f64 {
    let e = eng();
    match i {
        0 => e.cpu.icount as f64,
        1 => e.mmu.faults as f64,
        2 => e.mmu.swap_ins as f64,
        3 => e.mmu.swap_outs as f64,
        4 => e.mmu.resident() as f64,
        5 => e.mmu.frames_total() as f64,
        6 => e.exit_code as f64,
        7 => e.bridge_calls as f64,
        8 => e.mmu.swap_slots as f64,
        9 => e.modules.len() as f64,
        10 => e.thunks.len() as f64,
        11 => e.cpu.rip as f64,
        12 => e.cpu.regs[4] as f64,
        _ => 0.0,
    }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn msg_ptr() -> *const u8 {
    unsafe { MSG = eng().error.clone().unwrap_or_default().into_bytes(); MSG.as_ptr() }
}
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn msg_len() -> u32 { unsafe { MSG.len() as u32 } }

// ---- bridge: Wine-side wasm code reads program memory through the MMU ----

#[no_mangle]
pub extern "C" fn guest_read8(addr: u64) -> u8 {
    let e = eng();
    match e.mmu.read8(addr) { Ok(v) => v, Err(_) => { e.fault(addr); 0 } }
}
#[no_mangle]
pub extern "C" fn guest_read32(addr: u64) -> u32 {
    let e = eng();
    match e.mmu.read32(addr) { Ok(v) => v, Err(_) => { e.fault(addr); 0 } }
}

impl Engine {
    pub fn fault(&mut self, addr: u64) {
        if self.error.is_none() {
            self.error = Some(format!("access violation at 0x{:x} (rip 0x{:x})", addr, self.cpu.rip));
        }
    }

    /// VirtualAlloc-style reservation: 64 KB aligned, committed lazily.
    pub fn alloc(&mut self, size: u64) -> Option<u64> {
        let size = (size.max(1) + 0xFFFF) & !0xFFFF;
        if self.mmu.committed + size > self.mmu.target_bytes { return None; }
        let a = self.next_alloc;
        self.next_alloc += size + 0x10000;
        self.mmu.add_region(a, size);
        Some(a)
    }

    pub fn thunk(&mut self, dll: &str, func: &str) -> u64 {
        let key = format!("{}!{}", dll, func);
        if let Some(&a) = self.thunk_ids.get(&key) { return a; }
        let a = THUNK_BASE + 16 * self.thunks.len() as u64;
        self.thunks.push((dll.to_string(), func.to_string()));
        self.thunk_ids.insert(key, a);
        a
    }

    pub fn read_cstr(&mut self, a: u64, max: usize) -> String {
        let mut s = Vec::new();
        for i in 0..max as u64 {
            match self.mmu.read8(a + i) { Ok(0) | Err(_) => break, Ok(c) => s.push(c) }
        }
        String::from_utf8_lossy(&s).into_owned()
    }
    pub fn read_wstr(&mut self, a: u64, max: usize) -> String {
        let mut s = Vec::new();
        for i in 0..max as u64 {
            match self.mmu.read16(a + 2 * i) { Ok(0) | Err(_) => break, Ok(c) => s.push(c) }
        }
        String::from_utf16_lossy(&s)
    }
    pub fn put_str(&mut self, s: &str, wide: bool) -> u64 {
        if wide {
            let w: Vec<u16> = s.encode_utf16().chain([0]).collect();
            let a = self.heap_alloc(w.len() as u64 * 2, false);
            for (i, c) in w.iter().enumerate() { let _ = self.mmu.write16(a + 2 * i as u64, *c); }
            a
        } else {
            let a = self.heap_alloc(s.len() as u64 + 1, false);
            let _ = self.mmu.write_bytes(a, s.as_bytes());
            let _ = self.mmu.write8(a + s.len() as u64, 0);
            a
        }
    }

    fn boot(&mut self, name: &str, cmd: &str) -> Result<(), String> {
        // Thread and process blocks (reached by the program through gs:)
        self.mmu.add_region(TEB, 0x2000);
        self.mmu.add_region(PEB, 0x1000);
        let stack = self.alloc(STACK_SIZE).ok_or("out of memory")?;
        self.stack_top = stack + STACK_SIZE - 0x100;
        let w = |e: &mut Engine, a: u64, v: u64| { let _ = e.mmu.write64(a, v); };
        w(self, TEB + 0x08, stack + STACK_SIZE);
        w(self, TEB + 0x10, stack);
        w(self, TEB + 0x30, TEB);
        w(self, TEB + 0x40, 4);
        w(self, TEB + 0x48, 8);
        w(self, TEB + 0x58, TEB + 0x1800); // ThreadLocalStoragePointer (static TLS array)
        w(self, TEB + 0x60, PEB);
        self.cpu.gs_base = TEB;
        let bytes = self.files.get(name).cloned().ok_or_else(|| format!("{} not found", name))?;
        // before the imports are bound: msvcrt's _acmdln points at it
        self.cmdline = (self.put_str(cmd, false), self.put_str(cmd, true));
        let idx = pe::load_image(self, name, &bytes, true)?;
        self.exe_base = self.modules[idx].base;
        self.exe_entry = self.modules[idx].entry;
        w(self, PEB + 0x10, self.exe_base);
        w(self, PEB + 0x30, 0x0000_0000_00AA_0000); // ProcessHeap handle
        self.cpu.regs[4] = self.stack_top;
        self.next_init();
        Ok(())
    }

    /// Calls a program function from native code, returning to `ret`.
    pub fn call_guest(&mut self, f: u64, args: [u64; 3], ret: u64) {
        let sp = (self.cpu.regs[4] - 0x60) & !0xF;
        let sp = sp - 8;
        let _ = self.mmu.write64(sp, ret);
        self.cpu.regs[4] = sp;
        self.cpu.regs[1] = args[0];
        self.cpu.regs[2] = args[1];
        self.cpu.regs[8] = args[2];
        self.cpu.rip = f;
    }

    /// Runs the next pending DllMain, or the program entry when none is left.
    fn next_init(&mut self) {
        self.cpu.regs[4] = self.stack_top;
        if !self.init_queue.is_empty() {
            let (entry, base) = self.init_queue.remove(0);
            self.call_guest(entry, [base, 1, 0], RET_INIT);
        } else {
            self.call_guest(self.exe_entry, [PEB, 0, 0], RET_EXIT);
        }
    }

    pub fn arg(&mut self, i: usize) -> u64 {
        match i {
            0 => self.cpu.regs[1],
            1 => self.cpu.regs[2],
            2 => self.cpu.regs[8],
            3 => self.cpu.regs[9],
            // stack args: [rsp] = return address, then 32 bytes of shadow space
            _ => self.mmu.read64(self.cpu.regs[4] + 8 + 8 * i as u64).unwrap_or(0),
        }
    }

    pub fn do_ret(&mut self, v: u64) {
        self.cpu.regs[0] = v;
        let rsp = self.cpu.regs[4];
        match self.mmu.read64(rsp) {
            Ok(r) => { self.cpu.rip = r; self.cpu.regs[4] = rsp + 8; }
            Err(_) => self.fault(rsp),
        }
    }

    fn call_native(&mut self) {
        match self.cpu.rip {
            RET_EXIT => { self.exited = true; self.exit_code = self.cpu.regs[0] as u32; return; }
            RET_INIT => { self.next_init(); return; }
            RET_INITTERM => { msvcrt::initterm_next(self); return; }
            RET_LOADLIB => {
                let (h, sp) = self.loadlib.pop().unwrap_or((0, self.cpu.regs[4]));
                self.cpu.regs[4] = sp;
                self.do_ret(h);
                return;
            }
            _ => {}
        }
        let idx = ((self.cpu.rip - THUNK_BASE) / 16) as usize;
        let Some((dll, name)) = self.thunks.get(idx).cloned() else {
            self.error = Some(format!("jump into the native area at 0x{:x}", self.cpu.rip));
            return;
        };
        let r = match name.as_str() {
            // Wine-side functions compiled from C to wasm
            "lstrlenA" => { self.bridge_calls += 1; Some(unsafe { wine_lstrlenA(self.arg(0)) } as u32 as u64) }
            "RtlComputeCrc32" => {
                self.bridge_calls += 1;
                let (a, b, c) = (self.arg(0) as u32, self.arg(1), self.arg(2) as i32);
                Some(unsafe { wine_RtlComputeCrc32(a, b, c) } as u64)
            }
            _ if dll == "msvcrt.dll" => msvcrt::call(self, &name),
            _ if dll == "oleaut32.dll" => oleaut::call(self, &name),
            _ => files::call(self, &name).or_else(|| kernel32::call(self, &name)),
        };
        if self.error.is_some() || self.exited { return; }
        match r {
            Some(kernel32::NO_RETURN) => {}
            Some(v) => self.do_ret(v),
            None => self.error = Some(format!("not implemented yet: {}!{}", dll, name)),
        }
    }
}
