// InkSoC proof engine: PE32+ loader, x86-64 interpreter, 64-bit page table
// with a fixed real-RAM frame pool and swap to OPFS, and a bridge to
// "Wine side" C code compiled to wasm.
// License: GPL-3.0-or-later.

mod mmu;
mod cpu;
mod pe;

use mmu::Mmu;
use cpu::Cpu;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_console(ptr: *const u8, len: u32);
    pub fn host_now_ms() -> f64;
}

extern "C" {
    fn wine_RtlComputeCrc32(init: u32, data: u64, len: i32) -> u32;
    fn wine_lstrlenA(s: u64) -> i32;
}

pub const THUNK_BASE: u64 = 0x7FFE_0000_0000;

pub struct Engine {
    pub mmu: Mmu,
    pub cpu: Cpu,
    pub imports: Vec<String>,
    pub exited: bool,
    pub exit_code: u32,
    pub error: Option<String>,
    pub next_alloc: u64,
    pub bridge_calls: u64,
}

static mut ENGINE: Option<Engine> = None;
static mut EXE_BUF: Vec<u8> = Vec::new();
static mut MSG: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
fn eng() -> &'static mut Engine { unsafe { ENGINE.as_mut().unwrap() } }

pub fn console(s: &str) { unsafe { host_console(s.as_ptr(), s.len() as u32) } }

// ---- exports to JS ----

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn exe_buffer(len: u32) -> *mut u8 {
    unsafe { EXE_BUF = vec![0u8; len as usize]; EXE_BUF.as_mut_ptr() }
}

/// Creates the machine: `pool_mb` of real RAM (fixed, never grows),
/// `target_mb` of memory the program may use (rest goes to swap).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn init(pool_mb: u32, target_mb: u32) -> i32 {
    unsafe {
        ENGINE = Some(Engine {
            mmu: Mmu::new(pool_mb as usize, target_mb as u64),
            cpu: Cpu::new(),
            imports: Vec::new(),
            exited: false,
            exit_code: 0,
            error: None,
            next_alloc: 0x0000_0200_0000_0000, // 2 TB: far above 4 GB on purpose
            bridge_calls: 0,
        });
        let buf = std::mem::take(&mut EXE_BUF);
        let e = eng();
        match pe::load(e, &buf) {
            Ok(entry) => {
                // 1 MB stack
                let stack = e.alloc(1 << 20).unwrap_or(0);
                e.cpu.regs[4] = stack + (1 << 20) - 0x1000;
                // return address of the entry point: ExitProcess-like sentinel
                e.cpu.regs[4] -= 8;
                let _ = e.mmu.write64(e.cpu.regs[4], THUNK_BASE + 0xFFF0);
                e.cpu.rip = entry;
                0
            }
            Err(m) => { e.error = Some(m); -1 }
        }
    }
}

/// Writes a 32-bit value into program memory (used to set the test size).
#[no_mangle]
pub extern "C" fn poke32(addr: f64, v: u32) -> i32 {
    match eng().mmu.write32(addr as u64, v) { Ok(_) => 0, Err(_) => -1 }
}

/// Runs up to `budget` instructions. 0 = still running, 1 = exited, 2 = error.
#[no_mangle]
pub extern "C" fn run(budget: u32) -> i32 {
    let e = eng();
    if e.error.is_some() { return 2; }
    if e.exited { return 1; }
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
        _ => 0.0,
    }
}

/// Returns the last error message (pointer; length via msg_len).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn msg_ptr() -> *const u8 {
    unsafe {
        MSG = eng().error.clone().unwrap_or_default().into_bytes();
        MSG.as_ptr()
    }
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

    /// VirtualAlloc-style reservation: 64 KB aligned, committed lazily
    /// (a page gets real RAM only when first touched).
    pub fn alloc(&mut self, size: u64) -> Option<u64> {
        let size = (size + 0xFFFF) & !0xFFFF;
        if self.mmu.committed + size > self.mmu.target_bytes { return None; }
        let a = self.next_alloc;
        self.next_alloc += size + 0x10000;
        self.mmu.add_region(a, size);
        Some(a)
    }

    fn arg(&mut self, i: usize) -> u64 {
        match i {
            0 => self.cpu.regs[1], // rcx
            1 => self.cpu.regs[2], // rdx
            2 => self.cpu.regs[8], // r8
            3 => self.cpu.regs[9], // r9
            // stack args: [rsp] = return address, then 32 bytes of shadow space
            _ => self.mmu.read64(self.cpu.regs[4] + 8 + 8 * i as u64).unwrap_or(0),
        }
    }

    fn read_str(&mut self, p: u64, n: usize) -> String {
        let mut v = Vec::with_capacity(n);
        for i in 0..n as u64 { v.push(self.mmu.read8(p + i).unwrap_or(b'?')); }
        String::from_utf8_lossy(&v).into_owned()
    }

    fn call_native(&mut self) {
        let idx = ((self.cpu.rip - THUNK_BASE) / 16) as usize;
        if self.cpu.rip == THUNK_BASE + 0xFFF0 {
            self.exited = true;
            self.exit_code = self.cpu.regs[0] as u32;
            return;
        }
        let name = self.imports.get(idx).cloned().unwrap_or_default();
        let ret: u64 = match name.as_str() {
            "GetStdHandle" => 1,
            "GetTickCount" => unsafe { host_now_ms() as u64 & 0xFFFF_FFFF },
            "WriteConsoleA" => {
                let (s, n, w) = (self.arg(1), self.arg(2) as usize, self.arg(3));
                let text = self.read_str(s, n.min(1 << 16));
                console(&text);
                if w != 0 { let _ = self.mmu.write32(w, n as u32); }
                1
            }
            "VirtualAlloc" => {
                let size = self.arg(1);
                self.alloc(size).unwrap_or(0)
            }
            "ExitProcess" => {
                self.exited = true;
                self.exit_code = self.arg(0) as u32;
                return;
            }
            // Wine-side functions compiled from C to wasm
            "lstrlenA" => { self.bridge_calls += 1; unsafe { wine_lstrlenA(self.arg(0)) as u32 as u64 } }
            "RtlComputeCrc32" => {
                self.bridge_calls += 1;
                let (a, b, c) = (self.arg(0) as u32, self.arg(1), self.arg(2) as i32);
                unsafe { wine_RtlComputeCrc32(a, b, c) as u64 }
            }
            _ => {
                self.error = Some(format!("unimplemented import {}", name));
                return;
            }
        };
        if self.error.is_some() { return; }
        self.cpu.regs[0] = ret;
        // emulate `ret`
        let rsp = self.cpu.regs[4];
        match self.mmu.read64(rsp) {
            Ok(r) => { self.cpu.rip = r; self.cpu.regs[4] = rsp + 8; }
            Err(_) => self.fault(rsp),
        }
    }
}
