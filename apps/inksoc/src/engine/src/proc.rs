// Windows child processes (CreateProcess). Each process has its own address
// space and its own loader state (modules, heap, TLS, environment...); the
// handle table, the files and the window system stay shared, like one kernel.
// Only the running process's state lives in `Shared`; the others are parked
// in `Shared::procs` and swapped in when one of their threads runs.

use crate::files::Handle;
use crate::mmu::Space;
use crate::{pe, Engine, PEB, TEB};
use std::collections::HashMap;

/// The per-process part of the engine state while the process is not running.
#[derive(Default)]
pub struct ProcSave {
    space: Option<Space>,
    jit: Option<crate::jit::Jit>,
    modules: Vec<pe::Module>,
    heap: crate::heap::Heap,
    next_alloc: u64,
    next_dll: u64,
    tls_used: u64,
    tls_tmpl: Vec<(u64, u64, u64)>,
    thunk_fb: HashMap<usize, u64>,
    wine_fb: HashMap<String, u64>,
    env_block: u64,
    init_queue: Vec<(u64, u64)>,
    resume: Vec<crate::winefb::Resume>,
    ldr_entries: HashMap<u64, u64>,
    loadlib: Vec<(u64, u64)>,
    stack_top: u64,
    exe_entry: u64,
    exe_base: u64,
    cmdline: (u64, u64),
    crt: crate::msvcrt::Crt,
    std: [u64; 3],
    user_shared: bool,
    dll_dirs: Vec<String>,
}

/// What other processes see of a process.
pub struct ProcInfo { pub exit: Option<u32>, pub name: String }

impl Engine {
    fn swap_state(&mut self, p: &mut ProcSave) {
        use std::mem::swap;
        let s = &mut *self.s;
        swap(&mut s.modules, &mut p.modules);
        swap(&mut s.heap, &mut p.heap);
        swap(&mut s.next_alloc, &mut p.next_alloc);
        swap(&mut s.next_dll, &mut p.next_dll);
        swap(&mut s.tls_used, &mut p.tls_used);
        swap(&mut s.tls_tmpl, &mut p.tls_tmpl);
        swap(&mut s.thunk_fb, &mut p.thunk_fb);
        swap(&mut s.wine_fb, &mut p.wine_fb);
        swap(&mut s.env_block, &mut p.env_block);
        swap(&mut s.init_queue, &mut p.init_queue);
        swap(&mut s.resume, &mut p.resume);
        swap(&mut s.ldr_entries, &mut p.ldr_entries);
        swap(&mut s.loadlib, &mut p.loadlib);
        swap(&mut s.stack_top, &mut p.stack_top);
        swap(&mut s.exe_entry, &mut p.exe_entry);
        swap(&mut s.exe_base, &mut p.exe_base);
        swap(&mut s.cmdline, &mut p.cmdline);
        swap(&mut s.crt, &mut p.crt);
        swap(&mut s.std, &mut p.std);
        swap(&mut s.user_shared, &mut p.user_shared);
        swap(&mut s.dll_dirs, &mut p.dll_dirs);
    }

    /// Parks the running process (its memory and state) under its id.
    fn park(&mut self) {
        let id = self.s.wpid;
        let mut p = ProcSave::default();
        self.swap_state(&mut p);
        p.jit = Some(std::mem::take(&mut self.jit));
        let space = self.mmu.take_space();
        if self.s.pinfo.get(&id).map_or(false, |i| i.exit.is_some()) {
            self.mmu.free_saved(space); // it ended: nothing to keep
        } else {
            p.space = Some(space);
            self.s.procs.insert(id, p);
        }
    }

    /// Makes process `id` the running one (called with the engine lock held).
    pub fn enter_proc(&mut self, id: u32) {
        if id == self.s.wpid || !self.s.procs.contains_key(&id) { return; }
        let on = self.jit.on;
        self.park();
        let Some(mut p) = self.s.procs.remove(&id) else { return };
        self.swap_state(&mut p);
        if let Some(sp) = p.space.take() { self.mmu.put_space(sp); }
        self.jit = p.jit.take().unwrap_or_default();
        self.jit.on = on;
        self.s.wpid = id;
        self.mmu.set_asid(id);
    }

    /// Ends the running process: the main one stops the engine, a child only its threads.
    pub fn exit_process(&mut self, code: u32) {
        let id = self.s.wpid;
        if id == 0 { self.s.exited = true; self.s.exit_code = code; return; }
        if let Some(i) = self.s.pinfo.get_mut(&id) { if i.exit.is_none() { i.exit = Some(code); } }
        for t in self.s.sched.th.iter_mut() { if t.wpid == id { t.st = crate::sched::St::Done; } }
        self.want_switch = true;
        crate::lock::kick();
    }

    pub fn children_alive(&self) -> bool { self.s.pinfo.values().any(|i| i.exit.is_none()) }

    /// CreateProcess: loads `exe` in a new address space with its own PEB and
    /// main thread. Returns (process id, thread id, thread handle).
    pub fn create_process(&mut self, exe: &str, cmd: &str, env: Vec<u16>, std: [u64; 3], suspended: bool) -> Result<(u32, u32, u64), String> {
        let bytes = self.s.files.get(exe).cloned().ok_or_else(|| format!("{} not found", exe))?;
        let parent = self.s.wpid;
        let id = 4 * (self.s.pinfo.len() as u32 + 2);
        self.s.pinfo.insert(id, ProcInfo { exit: None, name: exe.to_string() });
        // a fresh state and an empty address space
        self.park();
        self.s.next_alloc = 0x0000_0200_0000_0000;
        self.s.next_dll = 0x0000_7FF0_0000_0000;
        self.s.std = std;
        self.s.wpid = id;
        self.mmu.set_asid(id);
        let saved_cpu = std::mem::replace(&mut self.cpu, crate::cpu::Cpu::new());
        let r = self.boot_child(exe, cmd, &bytes, &env);
        let cpu = std::mem::replace(&mut self.cpu, saved_cpu);
        if let Err(m) = r {
            self.s.pinfo.get_mut(&id).unwrap().exit = Some(1);
            self.park();
            let p = self.s.procs.remove(&parent);
            if let Some(mut p) = p { self.swap_state(&mut p); if let Some(sp) = p.space.take() { self.mmu.put_space(sp); } self.jit = p.jit.take().unwrap_or_default(); }
            self.s.wpid = parent;
            self.mmu.set_asid(parent);
            return Err(m);
        }
        // back to the parent; the child waits as a ready thread
        let on = self.jit.on;
        self.park();
        let mut p = self.s.procs.remove(&parent).unwrap();
        self.swap_state(&mut p);
        if let Some(sp) = p.space.take() { self.mmu.put_space(sp); }
        self.jit = p.jit.take().unwrap_or_default();
        self.jit.on = on;
        self.s.wpid = parent;
        self.mmu.set_asid(parent);
        let tid = self.add_thread(cpu, TEB, id, suspended);
        let th = self.new_handle(Handle::Thread { tid });
        Ok((id, tid, th))
    }

    fn boot_child(&mut self, name: &str, cmd: &str, bytes: &[u8], env: &[u16]) -> Result<(), String> {
        self.mmu.add_region(TEB, 0x2000);
        self.mmu.add_region(PEB, 0x1000);
        let stack = self.alloc(crate::STACK_SIZE).ok_or("out of memory")?;
        self.s.stack_top = stack + crate::STACK_SIZE - 0x100;
        let w = |e: &mut Engine, a: u64, v: u64| { let _ = e.mmu.write64(a, v); };
        w(self, TEB + 0x08, stack + crate::STACK_SIZE);
        w(self, TEB + 0x10, stack);
        w(self, TEB + 0x30, TEB);
        w(self, TEB + 0x40, self.s.wpid as u64);
        w(self, TEB + 0x48, 0);
        w(self, TEB + 0x58, TEB + 0x1800);
        w(self, TEB + 0x60, PEB);
        // StaticUnicodeString (ANSI functions convert names into it): 522 bytes at +0x1268
        let _ = self.mmu.write16(TEB + 0x125A, 522); w(self, TEB + 0x1260, TEB + 0x1268);
        self.cpu.gs_base = TEB;
        self.s.cmdline = (self.put_str(cmd, false), self.put_str(cmd, true));
        self.process_parameters(name);
        if !env.is_empty() { self.set_env_block(env); }
        self.teb_extras(TEB);
        self.shared_data();
        let idx = pe::load_image(self, name, bytes, true)?;
        self.s.exe_base = self.s.modules[idx].base;
        self.s.exe_entry = self.s.modules[idx].entry;
        w(self, PEB + 0x10, self.s.exe_base);
        w(self, PEB + 0x30, 0x0000_0000_00AA_0000);
        self.cpu.regs[4] = self.s.stack_top;
        self.next_init();
        Ok(())
    }

    // ---- environment: the block in the process parameters, as Wine's ntdll reads it ----

    pub fn env_vec(&mut self) -> Vec<u16> {
        let p = self.mmu.read64(PEB + 0x20).unwrap_or(0);
        let b = self.mmu.read64(p + 0x80).unwrap_or(0);
        let mut v = Vec::new();
        if b == 0 { return vec![0, 0]; }
        for i in 0..0x40000u64 {
            let c = self.mmu.read16(b + 2 * i).unwrap_or(0);
            v.push(c);
            if c == 0 && v.len() >= 2 && v[v.len() - 2] == 0 { break; }
            if c == 0 && v.len() == 1 { v.push(0); break; }
        }
        v
    }
    pub fn set_env_block(&mut self, env: &[u16]) {
        let p = self.mmu.read64(PEB + 0x20).unwrap_or(0);
        let eb = self.heap_alloc(2 * env.len() as u64 + 4, true);
        for (k, c) in env.iter().enumerate() { let _ = self.mmu.write16(eb + 2 * k as u64, *c); }
        let _ = self.mmu.write64(p + 0x80, eb);
        let _ = self.mmu.write64(p + 0x3F0, 2 * env.len() as u64);
        self.s.env_block = eb;
    }
    fn env_vars(&mut self) -> Vec<String> {
        let v = self.env_vec();
        String::from_utf16_lossy(&v).split('\0').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect()
    }
    pub fn env_get(&mut self, name: &str) -> Option<String> {
        let n = name.to_ascii_lowercase();
        self.env_vars().into_iter().find_map(|s| { let (k, v) = s.split_once('=')?; if k.to_ascii_lowercase() == n && !k.is_empty() { Some(v.to_string()) } else { None } })
    }
    pub fn env_set(&mut self, name: &str, val: Option<&str>) {
        let n = name.to_ascii_lowercase();
        let mut vars: Vec<String> = self.env_vars().into_iter().filter(|s| s.split_once('=').map_or(true, |(k, _)| k.to_ascii_lowercase() != n || k.is_empty())).collect();
        if let Some(v) = val { vars.push(format!("{}={}", name, v)); }
        let mut w: Vec<u16> = Vec::new();
        for s in vars { w.extend(s.encode_utf16()); w.push(0); }
        w.push(0);
        if w.len() == 1 { w.push(0); }
        self.set_env_block(&w);
    }
}
