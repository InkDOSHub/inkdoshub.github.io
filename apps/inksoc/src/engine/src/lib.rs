// InkSoC engine: PE32+ loader, x86-64 interpreter (integer + SSE/SSE2),
// 64-bit page table over a fixed pool of real RAM with swap to OPFS, our own
// kernel32, and a bridge to "Wine side" C code compiled to wasm.
// License: GPL-3.0-or-later.
#![cfg_attr(target_feature = "atomics", feature(thread_local, stdarch_wasm_atomic_wait))]

mod cpu;
mod eh;
mod files;
mod heap;
mod jit;
mod kernel32;
mod lock;
mod linux;
mod x87;
mod f80;
mod mmu;
mod msvcrt;
mod oleaut;
mod pe;
mod sched;
mod sse;
mod winapi;
mod winefb;
mod ntsys;
mod winsys;
mod wingdi;
mod proc;
mod registry;
mod npipe;
mod hash;
mod status;
mod store;
mod wow64;
mod opengl;
mod unixlib;

use cpu::Cpu;
use mmu::Mmu;
use std::collections::HashMap;
use std::rc::Rc;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_console(ptr: *const u8, len: u32);
    pub fn host_now_ms() -> f64;
    pub fn host_epoch_ms() -> f64;
}

/// The host's clock: milliseconds since the page started (monotonic), and since 1970.
pub(crate) fn now_ms() -> f64 { unsafe { host_now_ms() } }
pub(crate) fn epoch_ms() -> f64 { unsafe { host_epoch_ms() } }

/// Seconds between 1601-01-01 (the FILETIME origin) and 1970-01-01.
pub(crate) const UNIX_TO_FILETIME_SECS: u64 = 11_644_473_600;

/// The current time as a Windows FILETIME (100 ns ticks since 1601).
pub(crate) fn filetime_now() -> u64 { (epoch_ms() as u64 + UNIX_TO_FILETIME_SECS * 1000) * 10_000 }

extern "C" {
    fn wine_RtlComputeCrc32(init: u32, data: u64, len: i32) -> u32;
    fn wine_lstrlenA(s: u64) -> i32;
}

pub const THUNK_BASE: u64 = 0x7FFE_0000_0000;
pub const RET_EXIT: u64 = THUNK_BASE + 0xFFF0;
pub const RET_INIT: u64 = THUNK_BASE + 0xFFE0;
pub const RET_LOADLIB: u64 = THUNK_BASE + 0xFFD0;
pub const RET_INITTERM: u64 = THUNK_BASE + 0xFFC0;
pub const RET_EH: u64 = THUNK_BASE + 0xFFB0;
pub const RET_THREAD: u64 = THUNK_BASE + 0xFFA0;
pub const RET_FBINIT: u64 = THUNK_BASE + 0xFF90;
// Below 4 GB (like Windows does for WoW64 processes): 32-bit code reaches its
// TEB32 (TEB + 0x2000) and PEB32 through 32-bit pointers.
pub const TEB: u64 = 0x7FF8_0000;
pub const PEB: u64 = 0x7FF9_0000;
pub const TEB32_OFF: u64 = 0x2000;
pub const PEB32: u64 = 0x7FF9_1000;
pub(crate) const STACK_SIZE: u64 = 1 << 20;

/// One core: the program thread it is running and its private caches.
pub struct Engine {
    pub mmu: Mmu,
    pub cpu: Cpu,
    pub eh: eh::Eh,
    pub jit: jit::Jit,
    pub core: u32,
    pub cur: usize,        // index of the program thread on this core
    pub want_switch: bool, // pick another thread at the next chance
    pub slice: u64,        // instructions left in this thread's turn
    pub idle_ms: f64,
    pub(crate) not_mine: bool,      // set by a native module that has no case for the called name
    pub s: &'static mut Shared,
}

/// Everything the cores share (used under the engine lock with several cores).
pub struct Shared {
    pub exited: bool,
    pub exit_code: u32,
    pub error: Option<String>,
    pub next_alloc: u64,
    pub next_dll: u64,
    pub bridge_calls: u64,
    pub files: store::Store,
    pub modules: Vec<pe::Module>,
    /// (dll, function) of each thunk, by index; shared strings so a call costs no copies.
    pub thunks: Vec<(Rc<str>, Rc<str>)>,
    thunk_ids: HashMap<String, u64>,
    pub heap: heap::Heap,
    pub tls_used: u64,
    pub no_init: bool,
    pub thunk_fb: HashMap<usize, u64>,
    /// For each thunk, which of the native modules know its name (see `native_chain`).
    routes: Vec<u8>,
    pub wine_fb: HashMap<String, u64>,
    pub env_block: u64,
    pub tls_tmpl: Vec<(u64, u64, u64)>, // static TLS of the images: (template, size, zero fill)
    pub init_queue: Vec<(u64, u64)>,
    pub resume: Vec<winefb::Resume>,
    pub user_shared: bool,
    pub win: winsys::Win,
    pub gdi: wingdi::Gdi,
    pub gl: opengl::Gl,
    /// ntdll's __wine_unix_call_dispatcher variable (see unixlib.rs).
    pub unix_dispatcher: u64,
    pub next_luid: u64,
    pub win_ki: u64,
    pub recent: [(u32, u64); 16], // last native calls (thunk, return address), for error reports
    pub recent_n: usize,
    pub wine_exports: HashMap<String, std::collections::HashSet<String>>,
    pub ldr_entries: HashMap<u64, u64>,
    pub loadlib: Vec<(u64, u64)>, // (module handle, caller rsp) while a DllMain runs
    pub stack_top: u64,
    pub exe_entry: u64,
    pub exe_base: u64,
    pub cmdline: (u64, u64),
    pub unknown_calls: u64,
    pub crt: msvcrt::Crt,
    pub fs: files::Files,
    pub sched: sched::Sched,
    pub cores: u32,
    pub insns: u64, // instructions of every core, added after each run
    pub jit_on: bool,
    pub lx: Option<Box<linux::Lx>>,
    pub names: HashMap<String, String>, // file key -> name as given (Linux keeps case, no .dll)
    /// Windows processes: the running one, the parked ones, and what is known of each child
    pub wpid: u32,
    pub procs: HashMap<u32, proc::ProcSave>,
    pub pinfo: HashMap<u32, proc::ProcInfo>,
    /// GetStdHandle: input, output, error
    pub std: [u64; 3],
    /// folders searched for DLLs after C:\InkSoC (SetDllDirectory, AddDllDirectory, folders DLLs were loaded from)
    pub dll_dirs: Vec<String>,
    /// 32-bit program (WoW64): its ntdll, and the CONTEXT passed to Wow64LdrpInitialize
    pub wow64: bool,
    pub wow64_ntdll: u64,
    pub wow64_ctx: u64,
    /// images mapped by map_image (base -> size)
    pub images: HashMap<u64, u64>,
    /// global atom table (NtAddAtom): atom 0xC000 + index
    pub atoms: Vec<String>,
}

#[cfg_attr(target_feature = "atomics", thread_local)]
static mut ENGINE: Option<Engine> = None;
static mut SHARED: Option<Shared> = None;
static mut BUF: Vec<u8> = Vec::new();
static mut MSG: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
#[allow(static_mut_refs)]
pub(crate) fn set_out(v: Vec<u8>) -> u32 { unsafe { OUT = v; OUT.len() as u32 } }

#[allow(static_mut_refs)]
pub(crate) unsafe fn take_buf() -> Vec<u8> { std::mem::take(&mut BUF) }

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
        SHARED = Some(Shared {
            exited: false, exit_code: 0, error: None,
            next_alloc: 0x0000_0200_0000_0000, // 2 TB: far above 4 GB on purpose
            next_dll: 0x0000_7FF0_0000_0000,
            bridge_calls: 0,
            files: Default::default(), modules: Vec::new(),
            thunks: Vec::new(), thunk_ids: HashMap::new(),
            heap: heap::Heap::default(), tls_used: 0, no_init: false, thunk_fb: HashMap::new(), routes: Vec::new(), wine_fb: HashMap::new(), env_block: 0, tls_tmpl: Vec::new(),
            init_queue: Vec::new(), resume: Vec::new(), user_shared: false, win: Default::default(), gdi: Default::default(), gl: Default::default(), unix_dispatcher: 0, next_luid: 0, win_ki: 0, recent: [(0, 0); 16], recent_n: 0, wine_exports: HashMap::new(), ldr_entries: HashMap::new(), loadlib: Vec::new(),
            stack_top: 0, exe_entry: 0, exe_base: 0, cmdline: (0, 0), unknown_calls: 0, crt: Default::default(), fs: Default::default(),
            sched: Default::default(), cores: 1, insns: 0, jit_on: true, lx: None, names: HashMap::new(),
            wpid: 0, procs: HashMap::new(), pinfo: HashMap::new(), std: [3, 1, 2], dll_dirs: Vec::new(), wow64: false, wow64_ntdll: 0, wow64_ctx: 0, images: HashMap::new(), atoms: Vec::new(),
        });
        ENGINE = Some(Engine {
            mmu: Mmu::new(pool_mb as usize, target_mb as u64),
            cpu: Cpu::new(), eh: Default::default(), jit: Default::default(),
            core: 0, cur: 0, want_switch: false, slice: 0, idle_ms: 0.0, not_mine: false,
            s: SHARED.as_mut().unwrap(),
        });
    }
}

// ---- several cores (multi-core build only) ----

/// Memory for another core's stack and thread-local area (called on core 0).
#[no_mangle]
pub extern "C" fn core_alloc(size: u32) -> u32 {
    let v: Vec<u8> = vec![0u8; size as usize + 64];
    let p = Box::leak(v.into_boxed_slice()).as_mut_ptr() as u32;
    (p + 63) & !63
}

static mut CORE0_MMU: usize = 0;

/// How many cores will run (set on core 0 before start: the program sees this many processors).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn set_cores(n: u32) {
    let e = eng();
    e.s.cores = n.max(1);
    mmu::set_strong(lock::MT && n > 1 && e.mmu.pool_addr() % 8 == 0);
    unsafe { CORE0_MMU = &e.mmu as *const Mmu as usize; }
}

/// Turns the strict x86 memory order between cores on or off (measuring its cost).
#[no_mangle]
pub extern "C" fn set_strong_order(on: u32) { mmu::set_strong(on != 0 && lock::MT && eng().s.cores > 1); }

/// Turns the newer JIT code improvements on or off (?opt=0 on the page: A/B on a device).
#[no_mangle]
pub extern "C" fn set_jit_opt(on: u32) { jit::set_opt(on != 0); }

/// Sets up this worker as core `id` (after its stack and thread-local area are set).
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn core_init(id: u32) {
    unsafe {
        let mmu0 = &*(CORE0_MMU as *const Mmu);
        let mut jit: jit::Jit = Default::default();
        jit.on = SHARED.as_ref().unwrap().jit_on;
        ENGINE = Some(Engine {
            mmu: mmu0.new_core(id),
            cpu: Cpu::new(), eh: Default::default(), jit,
            core: id, cur: usize::MAX, want_switch: true, slice: 0, idle_ms: 0.0, not_mine: false,
            s: SHARED.as_mut().unwrap(),
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
        let raw = String::from_utf8_lossy(&b[..nl]).into_owned();
        // a file of the saved drive C: comes with its Windows path; the others are plain names
        if raw.contains('\\') || raw.contains(':') {
            let e = eng();
            let Some(k) = files::key_of(&raw) else { return };
            if raw.ends_with('\\') { e.s.fs.dirs.insert(k.clone()); } else { e.s.files.insert(k.clone(), b[nl + 1..].to_vec()); e.s.fs.drive.insert(k.clone()); }
            e.note_case(&k, &raw);
            return;
        }
        let name = pe::norm(&raw);
        eng().s.names.insert(name.clone(), raw.rsplit(['\\', '/']).next().unwrap_or(&raw).to_string());
        eng().s.files.insert(name, b[nl + 1..].to_vec());
    }
}

/// A file of the saved drive C: known only by its Windows path (in BUF), its id on
/// the browser's storage and its size: read when the program first uses it.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn add_drive_file(id: u32, size: f64) {
    let b = unsafe { std::mem::take(&mut BUF) };
    let raw = String::from_utf8_lossy(&b).into_owned();
    let e = eng();
    let Some(k) = files::key_of(&raw) else { return };
    e.s.files.add_lazy(k.clone(), id, size as u64);
    e.s.fs.drive.insert(k.clone());
    e.note_case(&k, &raw);
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
    match e.boot(&name, &cmd) { Ok(()) => 0, Err(m) => { e.set_error(m); -1 } }
}

#[no_mangle]
pub extern "C" fn poke32(addr: f64, v: u32) -> i32 {
    match eng().mmu.write32(addr as u64, v) { Ok(_) => 0, Err(_) => -1 }
}

/// Runs up to `budget` instructions. 0 = still running, 1 = exited, 2 = error,
/// 3 = every thread is waiting (call again after stat(17) ms).
#[no_mangle]
pub extern "C" fn run(budget: u32) -> i32 {
    let e = eng();
    let mut left = budget as u64;
    let mut idle = false;
    let start = e.cpu.icount;
    let mut done_other = 0u64; // instructions of threads this core switched away from
    mmu::safe_point(e.core);
    if e.s.lx.is_none() && e.s.user_shared { e.shared_time(); }
    let mut tick = 0u32;
    while left > 0 && !e.s.exited && e.s.error.is_none() {
        // a safe point every 64 blocks: frees and evictions wait a little longer, the loop pays less
        tick = tick.wrapping_add(1);
        if tick & 63 == 0 { mmu::safe_point(e.core); }
        if e.want_switch {
            let before = e.cpu.icount;
            let ok = { let _g = lock::lock(); e.sched_switch() };
            done_other += before.wrapping_sub(start).min(u64::MAX / 2);
            let _ = done_other;
            if !ok {
                idle = e.s.error.is_none();
                // the page's core goes back to JavaScript when there are windows (screen updates, input)
                if lock::MT && idle && !(e.core == 0 && { let _g = lock::lock(); !e.s.win.tops.is_empty() }) { let g = lock::gen(); lock::idle(g, e.idle_ms); idle = false; left = left.saturating_sub(1000); continue; }
                break;
            }
        }
        if e.s.exited || e.s.error.is_some() { break; }
        let rip = e.cpu.rip;
        if rip >= THUNK_BASE && rip < THUNK_BASE + 0x10000 {
            e.materialize();
            { let _g = lock::lock(); e.call_native(); }
            if lock::MT { lock::kick(); }
            continue;
        }
        if e.jit.on {
            let lim = left.min(e.slice_left());
            if let Some(f) = jit::Jit::lookup(e, rip) {
                let before = e.cpu.icount;
                e.cpu.jit_limit = before + lim;
                jit::call(f);
                let n = e.cpu.icount - before;
                #[cfg(feature = "prof")]
                { jit::prof::add(0xB0000000, 1); jit::prof::add(0xB0000001, n); jit::prof::add(f, n); }
                left = left.saturating_sub(n);
                e.sched_tick(n);
                continue;
            }
            let n = cpu::step_trace(e, lim.min(4096));
            #[cfg(feature = "prof")]
            { jit::prof::add(0xC0000000, 1); jit::prof::add(0xC0000001, n); }
            left = left.saturating_sub(n);
            e.sched_tick(n);
            continue;
        }
        let n = cpu::step_block(e, left.min(e.slice_left()).min(4096));
        left = left.saturating_sub(n);
        e.sched_tick(n);
    }
    { let _g = lock::lock(); e.s.insns += budget as u64 - left; }
    mmu::away(e.core);
    if e.s.error.is_some() { 2 } else if e.s.exited { 1 } else if idle { 3 } else { 0 }
}

static mut TRACE: bool = false;
/// Prints every native call (debugging).
#[no_mangle]
pub extern "C" fn set_trace(on: u32) { unsafe { TRACE = on != 0; } }

/// Wine's own messages (FIXME and ERR lines of its DLLs) on the console: on or off.
pub(crate) static mut WINE_DEBUG: u32 = 0;
#[no_mangle]
pub extern "C" fn set_wine_debug(level: u32) { unsafe { WINE_DEBUG = level; } }
/// The channels whose TRACE lines are printed (comma-separated, from the buffer; empty = all).
pub(crate) static mut WINE_TRACE: Vec<String> = Vec::new();
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn set_wine_trace() {
    unsafe { WINE_TRACE = String::from_utf8_lossy(&BUF).split(',').filter(|c| !c.is_empty()).map(String::from).collect(); }
}

/// Turns the JIT on or off (call before start).
#[no_mangle]
pub extern "C" fn set_jit(on: u32) { let e = eng(); e.jit.on = on != 0; e.s.jit_on = on != 0; }

static mut OUT: Vec<u8> = Vec::new();

/// The i-th file the program wrote: fills out_ptr() with "name\0data" and
/// returns its length, or 0 when there are no more.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn out_file(i: u32) -> u32 {
    let e = eng();
    let (name, data) = if e.s.lx.is_some() {
        let Some(x) = linux::written(e).into_iter().nth(i as usize) else { return 0 };
        x
    } else {
        let Some(name) = e.s.fs.written.iter().nth(i as usize).cloned() else { return 0 };
        // a copy of a file still on disk is copied there (out_disk), not read in
        let data = if e.s.files.lazy_id(&name).is_some() { Vec::new() } else { e.s.files.get(&name).cloned().unwrap_or_default() };
        (name, data)
    };
    unsafe { OUT = name.into_bytes(); OUT.push(0); OUT.extend_from_slice(&data); OUT.len() as u32 }
}
/// Offset and size of the i-th written file in the file out_disk names.
#[no_mangle]
pub extern "C" fn out_disk_at(i: u32) -> f64 { let e = eng(); e.s.fs.written.iter().nth(i as usize).and_then(|k| e.s.files.disk_of(k)).map_or(0.0, |v| v.1 as f64) }
#[no_mangle]
pub extern "C" fn out_disk_size(i: u32) -> f64 { let e = eng(); e.s.fs.written.iter().nth(i as usize).and_then(|k| e.s.files.disk_of(k)).map_or(0.0, |v| v.2 as f64) }
/// The disk id the i-th written file is a copy of (a renamed or copied drive file), or -1.
#[no_mangle]
pub extern "C" fn out_disk(i: u32) -> i32 {
    let e = eng();
    e.s.fs.written.iter().nth(i as usize).and_then(|k| e.s.files.lazy_id(k)).map_or(-1, |v| v as i32)
}
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn out_ptr() -> *const u8 { unsafe { OUT.as_ptr() } }

/// Sets the program's home folder from BUF (a Windows path, before any add_file): an
/// installed program runs from its own folder, picked files from C:\InkSoC.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn set_home() {
    let b = unsafe { std::mem::take(&mut BUF) };
    files::set_home(&String::from_utf8_lossy(&b));
}

/// The saved drive C:, step by step: OUT = the Windows path of the i-th file the program
/// wrote (data: out_file(i)), or of a drive file it deleted (i past the written ones, "-"
/// prefix), or of a folder it made ("\\" suffix). 0 = no more.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn drive_entry(i: u32) -> u32 {
    let e = eng();
    let shown = |e: &Engine, k: &str| files::win_path(&e.s.names.get(k).cloned().unwrap_or_else(|| k.to_string()));
    let mut i = i as usize;
    let s = if let Some(k) = e.s.fs.written.iter().nth(i) { shown(e, k) } else {
        i -= e.s.fs.written.len();
        let gone: Vec<&String> = e.s.fs.drive.iter().filter(|k| !e.s.files.contains_key(*k)).collect();
        if let Some(k) = gone.get(i) { format!("-{}", shown(e, k)) } else {
            i -= gone.len();
            match e.s.fs.dirs.iter().nth(i) { Some(k) => format!("{}\\", shown(e, k)), None => return 0 }
        }
    };
    unsafe { OUT = s.into_bytes(); OUT.len() as u32 }
}

/// The registry as bytes (OUT), to keep with the drive; reg_load reads them back from BUF.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn reg_save() -> u32 { let v = eng().s.fs.reg.save(); unsafe { OUT = v; OUT.len() as u32 } }
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn reg_load() { let b = unsafe { std::mem::take(&mut BUF) }; eng().s.fs.reg.load(&b); }

#[no_mangle]
pub extern "C" fn stat(i: u32) -> f64 {
    let e = eng();
    match i {
        0 => e.s.insns as f64,
        1 => e.mmu.sh.faults as f64,
        2 => e.mmu.sh.swap_ins as f64,
        3 => e.mmu.sh.swap_outs as f64,
        4 => e.mmu.resident() as f64,
        5 => e.mmu.frames_total() as f64,
        6 => e.s.exit_code as f64,
        7 => e.s.bridge_calls as f64,
        8 => e.mmu.sh.swap_slots as f64,
        9 => e.s.modules.len() as f64,
        10 => e.s.thunks.len() as f64,
        11 => e.cpu.rip as f64,
        12 => e.cpu.regs[4] as f64,
        13 => e.jit.blocks as f64,
        14 => e.jit.ms,
        15 => e.jit.bytes as f64,
        16 => e.jit.failed as f64,
        17 => e.idle_ms,
        18 => e.s.sched.th.len() as f64,
        19 => e.s.sched.switches as f64,
        20 => lock::counter(0),
        21 => lock::counter(1),
        22 => lock::counter(2),
        23 => lock::counter(3),
        24 => e.s.files.loaded_bytes as f64,
        _ => 0.0,
    }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn msg_ptr() -> *const u8 {
    unsafe { MSG = eng().s.error.clone().unwrap_or_default().into_bytes(); MSG.as_ptr() }
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
        let mut m = format!("access violation at 0x{:x} (rip 0x{:x})", addr, self.cpu.rip);
        // a jump to a null function pointer: say who called it
        if self.cpu.rip < 0x10000 {
            if let Ok(r) = self.mmu.read64(self.cpu.regs[4]) {
                match self.s.modules.iter().find(|x| !x.native && r >= x.base && r < x.base + x.size) {
                    Some(x) => m += &format!(" called from {}+0x{:x}", x.name, r - x.base),
                    None => m += &format!(" [rsp]=0x{:x}", r),
                }
            }
        }
        self.set_error(m);
    }
    /// Stops the program with a message (the first error wins).
    pub fn set_error(&mut self, m: String) {
        // a Linux child process that crashes ends alone (like a signal), the shell goes on
        if self.s.lx.is_some() && linux::crash(self, &m) { return; }
        let _g = lock::lock();
        if self.s.error.is_none() {
            // where it happened: module + offset (Windows programs)
            let rip = self.cpu.rip;
            let at = if self.s.lx.is_none() { self.s.modules.iter().find(|x| !x.native && rip >= x.base && rip < x.base + x.size).map(|x| format!(" [in {}+0x{:x}]", x.name, rip - x.base)) } else { None };
            let mut calls = String::new();
            if self.s.lx.is_none() && self.s.recent_n > 0 {
                calls += "\nlast calls:";
                for j in (self.s.recent_n.saturating_sub(16)..self.s.recent_n).rev() {
                    let (t, ra) = self.s.recent[j % 16];
                    let f = self.s.thunks.get(t as usize).map_or(String::from("?"), |(d, n)| format!("{}!{}", d, n));
                    let at = self.s.modules.iter().find(|x| !x.native && ra >= x.base && ra < x.base + x.size).map_or(format!("0x{:x}", ra), |x| format!("{}+0x{:x}", x.name, ra - x.base));
                    calls += &format!("\n  {} from {}", f, at);
                }
            }
            self.s.error = Some(m + &at.unwrap_or_default() + &calls);
        }
    }

    /// Reserves address space only (pages are backed when first touched).
    pub fn reserve(&mut self, size: u64) -> Option<u64> {
        let size = (size.max(1) + 0xFFFF) & !0xFFFF;
        if self.s.next_alloc + size > 0x7F00_0000_0000 { return None; }
        let a = self.s.next_alloc;
        self.s.next_alloc += size + 0x10000;
        self.mmu.add_reserved(a, size);
        Some(a)
    }

    /// VirtualAlloc-style reservation: 64 KB aligned, committed lazily.
    pub fn alloc(&mut self, size: u64) -> Option<u64> {
        let size = (size.max(1) + 0xFFFF) & !0xFFFF;
        if self.mmu.sh.committed + size > self.mmu.sh.target_bytes { return None; }
        let a = self.s.next_alloc;
        self.s.next_alloc += size + 0x10000;
        self.mmu.add_region(a, size);
        Some(a)
    }

    /// Static TLS blocks of every image for the thread whose TEB is `teb`.
    pub fn tls_blocks(&mut self, teb: u64) {
        for i in 0..self.s.tls_tmpl.len() { self.tls_block(teb, i); }
    }
    pub fn tls_block(&mut self, teb: u64, i: usize) {
        let (t, n, z) = self.s.tls_tmpl[i];
        let b = self.heap_alloc((n + z).max(16), true);
        let mut v = vec![0u8; n as usize];
        if self.mmu.read_bytes(t, &mut v).is_ok() { let _ = self.mmu.write_bytes(b, &v); }
        self.w64(teb + 0x1800 + 8 * i as u64, b);
    }

    pub fn thunk_lookup(&self, dll: &str, func: &str) -> Option<u64> { self.s.thunk_ids.get(&format!("{}!{}", dll, func)).copied() }

    pub fn thunk(&mut self, dll: &str, func: &str) -> u64 {
        let key = format!("{}!{}", dll, func);
        if let Some(&a) = self.s.thunk_ids.get(&key) { return a; }
        let a = THUNK_BASE + 16 * self.s.thunks.len() as u64;
        self.s.thunks.push((Rc::from(dll), Rc::from(func)));
        self.s.routes.push(0);
        self.s.thunk_ids.insert(key, a);
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
            for (i, c) in w.iter().enumerate() { self.w16(a + 2 * i as u64, *c); }
            a
        } else {
            let a = self.heap_alloc(s.len() as u64 + 1, false);
            let _ = self.mmu.write_bytes(a, s.as_bytes());
            self.w8(a + s.len() as u64, 0);
            a
        }
    }

    fn boot(&mut self, name: &str, cmd: &str) -> Result<(), String> {
        // the usual folders of drive C: exist from the start
        for d in ["C:\\Program Files", "C:\\Program Files\\Common Files", "C:\\Program Files (x86)", "C:\\ProgramData", "C:\\Users\\Public",
            "C:\\InkSoC\\AppData\\Roaming", "C:\\InkSoC\\AppData\\Local", "C:\\InkSoC\\Documents", "C:\\InkSoC\\Desktop"] {
            let mut p = String::new();
            for part in d.split('\\') { if !p.is_empty() { p.push('\\'); } p.push_str(part); if let Some(k) = files::key_of(&p) { if !self.s.files.contains_key(&k) { self.note_case(&k, &p); self.s.fs.dirs.insert(k); } } }
        }
        // Thread and process blocks (reached by the program through gs:)
        self.mmu.add_region(TEB, 0x2000);
        self.mmu.add_region(PEB, 0x1000);
        // a 32-bit program needs its memory below 2 GB: allocations start low
        if self.s.files.get(name).map_or(false, |b| wow64::is_pe32(b)) { self.s.wow64 = true; self.s.next_alloc = wow64::LOW_ALLOC; }
        let stack = self.alloc(STACK_SIZE).ok_or("out of memory")?;
        self.s.stack_top = stack + STACK_SIZE - 0x100;
        let w = |e: &mut Engine, a: u64, v: u64| { e.w64(a, v); };
        w(self, TEB + 0x08, stack + STACK_SIZE);
        w(self, TEB + 0x10, stack);
        w(self, TEB + 0x30, TEB);
        w(self, TEB + 0x40, 4);
        w(self, TEB + 0x48, 8);
        w(self, TEB + 0x58, TEB + 0x1800); // ThreadLocalStoragePointer (static TLS array)
        w(self, TEB + 0x60, PEB);
        // StaticUnicodeString (ANSI functions convert names into it): 522 bytes at +0x1268
        self.w16(TEB + 0x125A, 522); w(self, TEB + 0x1260, TEB + 0x1268);
        self.cpu.gs_base = TEB;
        self.sched_init();
        let bytes = self.s.files.get(name).cloned().ok_or_else(|| format!("{} not found", name))?;
        if bytes.starts_with(b"\x7fELF") { return self.linux_boot(name, cmd); }
        let wow = wow64::is_pe32(&bytes);
        // before the imports are bound: msvcrt's _acmdln points at it
        self.s.cmdline = (self.put_str(cmd, false), self.put_str(cmd, true));
        self.process_parameters(name);
        self.teb_extras(TEB);
        self.shared_data();
        if wow {
            self.wow64_boot(name, cmd, &bytes)?;
        } else {
            let idx = pe::load_image(self, name, &bytes, true)?;
            self.s.exe_base = self.s.modules[idx].base;
            self.s.exe_entry = self.s.modules[idx].entry;
        }
        w(self, PEB + 0x10, self.s.exe_base);
        w(self, PEB + 0x30, 0x0000_0000_00AA_0000); // ProcessHeap handle
        self.cpu.regs[4] = self.s.stack_top;
        self.next_init();
        Ok(())
    }

    /// Calls a program function from native code, returning to `ret`.
    pub fn call_guest(&mut self, f: u64, args: [u64; 3], ret: u64) {
        let sp = (self.cpu.regs[4] - 0x60) & !0xF;
        let sp = sp - 8;
        self.w64(sp, ret);
        self.cpu.regs[4] = sp;
        self.cpu.regs[1] = args[0];
        self.cpu.regs[2] = args[1];
        self.cpu.regs[8] = args[2];
        self.cpu.rip = f;
    }

    /// Runs the next pending DllMain, or the program entry when none is left.
    pub(crate) fn next_init(&mut self) {
        self.cpu.regs[4] = self.s.stack_top;
        if !self.s.init_queue.is_empty() {
            let (entry, base) = self.s.init_queue.remove(0);
            self.call_guest(entry, [base, 1, 0], RET_INIT);
        } else {
            let a0 = if self.s.wow64 { self.s.wow64_ctx } else { PEB };
            self.call_guest(self.s.exe_entry, [a0, 0, 0], RET_EXIT);
        }
    }

    // Program memory where a failure needs no handling: a read gives 0, a write to
    // address 0 (an optional out-parameter left out) is skipped.
    pub(crate) fn r8(&mut self, a: u64) -> u8 { self.mmu.read8(a).unwrap_or(0) }
    pub(crate) fn r16(&mut self, a: u64) -> u16 { self.mmu.read16(a).unwrap_or(0) }
    pub(crate) fn r32(&mut self, a: u64) -> u32 { self.mmu.read32(a).unwrap_or(0) }
    pub(crate) fn r64(&mut self, a: u64) -> u64 { self.mmu.read64(a).unwrap_or(0) }
    pub(crate) fn w8(&mut self, a: u64, v: u8) { if a != 0 { let _ = self.mmu.write8(a, v); } }
    pub(crate) fn w16(&mut self, a: u64, v: u16) { if a != 0 { let _ = self.mmu.write16(a, v); } }
    pub(crate) fn w32(&mut self, a: u64, v: u32) { if a != 0 { let _ = self.mmu.write32(a, v); } }
    pub(crate) fn w64(&mut self, a: u64, v: u64) { if a != 0 { let _ = self.mmu.write64(a, v); } }
    /// The thread's Windows "last error" (TEB.LastErrorValue).
    pub(crate) fn set_last_error(&mut self, v: u32) { let a = self.cpu.gs_base + 0x68; self.w32(a, v); }

    pub fn arg(&mut self, i: usize) -> u64 {
        match i {
            0 => self.cpu.regs[1],
            1 => self.cpu.regs[2],
            2 => self.cpu.regs[8],
            3 => self.cpu.regs[9],
            // stack args: [rsp] = return address, then 32 bytes of shadow space
            _ => self.r64(self.cpu.regs[4] + 8 + 8 * i as u64),
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

    /// A native module's answer for a name it has no case for.
    pub(crate) fn not_mine(&mut self) -> Option<u64> { self.not_mine = true; None }

    /// Asks the engine's own Windows modules in order: scheduler, files, kernel32, the rest
    /// of the Win32 API, ntdll. A module may also pass on a name it knows (a handle that is
    /// not its kind), so the next one gets the call. The first call of each thunk learns
    /// which modules have no case for its name at all; later calls skip those.
    fn native_chain(&mut self, idx: usize, name: &str) -> Option<u64> {
        const MODULES: [fn(&mut Engine, &str) -> Option<u64>; 6] = [sched::call, files::call, kernel32::call, winapi::call, ntsys::call, unixlib::call];
        const LEARNED: u8 = 0x80;
        let route = self.s.routes.get(idx).copied().unwrap_or(0);
        if route & LEARNED != 0 {
            for (i, module) in MODULES.iter().enumerate() {
                if route & (1 << i) != 0 { if let Some(v) = module(self, name) { return Some(v); } }
            }
            return None;
        }
        // first call: every module counts as knowing the name until it says otherwise
        let mut route = LEARNED | 0x3F;
        let mut answer = None;
        for (i, module) in MODULES.iter().enumerate() {
            self.not_mine = false;
            answer = module(self, name);
            if self.not_mine { route &= !(1 << i); }
            if answer.is_some() { break; }
        }
        if let Some(r) = self.s.routes.get_mut(idx) { *r = route; }
        answer
    }

    fn call_native(&mut self) {
        match self.cpu.rip {
            RET_EXIT => { let c = self.cpu.regs[0] as u32; self.exit_process(c); return; }
            RET_INIT => { self.next_init(); return; }
            RET_FBINIT => { self.init_next(); return; }
            RET_INITTERM => { msvcrt::initterm_next(self); return; }
            RET_EH => { self.eh_next(); return; }
            RET_THREAD => { let c = self.cpu.regs[0] as u32; self.exit_thread(c); return; }
            RET_LOADLIB => {
                let (h, sp) = self.s.loadlib.pop().unwrap_or((0, self.cpu.regs[4]));
                self.cpu.regs[4] = sp;
                self.do_ret(h);
                return;
            }
            _ => {}
        }
        let idx = ((self.cpu.rip - THUNK_BASE) / 16) as usize;
        if let Some(&a) = self.s.thunk_fb.get(&idx) { self.cpu.rip = a; return; }
        let ra = self.r64(self.cpu.regs[4]);
        let k = self.s.recent_n % 16; self.s.recent[k] = (idx as u32, ra); self.s.recent_n += 1;
        if unsafe { TRACE } { if let Some((d, n)) = self.s.thunks.get(idx).cloned() {
            let t = self.cur_tid(); let p = self.cpu.regs[1];
            // first argument shown as text when it reads like a string
            let mut txt = String::new();
            if n.ends_with('W') { for i in 0..80 { match self.mmu.read16(p + 2 * i) { Ok(c) if c >= 32 && c < 0x7F => txt.push(c as u8 as char), _ => break } } }
            else if n.contains("OpenFile") || n.contains("CreateFile") || n.contains("Key") { let oa = self.cpu.regs[8]; txt = self.oa_name(oa); }
            else if n.ends_with('A') { for i in 0..80 { match self.mmu.read8(p + i) { Ok(c) if c >= 32 && c < 0x7F => txt.push(c as char), _ => break } } }
            console(&format!("[call] t{} {}!{} rcx={:x} rdx={:x} r8={:x} ra={:x} {}\n", t, d, n, p, self.cpu.regs[2], self.cpu.regs[8], ra, txt));
        } }
        let Some((dll, func)) = self.s.thunks.get(idx).cloned() else {
            self.set_error(format!("jump into the native area at 0x{:x}", self.cpu.rip));
            return;
        };
        let dll: &str = &dll;
        // ntdll's Rtl heap functions are answered by their kernel32 twins
        let name: &str = match winefb::alias(&func) { Some(n) if dll == "ntdll.dll" => n, _ => &func };
        let r = match name {
            // Wine-side functions compiled from C to wasm
            "lstrlenA" => { self.s.bridge_calls += 1; Some(unsafe { wine_lstrlenA(self.arg(0)) } as u32 as u64) }
            "RtlComputeCrc32" => {
                self.s.bridge_calls += 1;
                let (a, b, c) = (self.arg(0) as u32, self.arg(1), self.arg(2) as i32);
                Some(unsafe { wine_RtlComputeCrc32(a, b, c) } as u64)
            }
            _ if name.starts_with("_beginthread") || name.starts_with("_endthread") => sched::call(self, name),
            _ if dll == "msvcrt.dll" => msvcrt::call(self, name),
            _ if dll == "oleaut32.dll" => oleaut::call(self, name),
            _ if dll.starts_with("vcruntime140") => msvcrt::call(self, name),
            // the window system's kernel side: console programs get "nothing there"
            _ if dll == "win32u.dll" => winsys::call(self, name),
            _ => self.native_chain(idx, name),
        };
        if self.s.error.is_some() || self.s.exited { return; }
        match r {
            Some(kernel32::NO_RETURN) | Some(sched::BLOCK) => {}
            Some(v) => self.do_ret(v),
            None => {
                // not native: Wine's own version, run as program code
                let before = self.s.init_queue.len();
                match self.wine_fallback(dll, name, self.cpu.rip) {
                    Some(a) => {
                        self.s.thunk_fb.insert(idx, a);
                        // DLLs that came in for it start first
                        if self.s.init_queue.len() > before {
                            let pending: Vec<(u64, u64)> = self.s.init_queue.drain(before..).collect();
                            self.run_inits(pending, a, None);
                        } else { self.cpu.rip = a }
                    }
                    None => self.set_error(format!("not implemented yet: {}!{}", dll, name)),
                }
            }
        }
    }
}
