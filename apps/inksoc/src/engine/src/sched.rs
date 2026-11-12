// Threads: every program thread is a saved CPU state; the engine runs one at a
// time and switches after a time slice, or when the thread waits. Waits
// (WaitFor*, Sleep, critical sections, SRW locks) leave the thread parked on
// the native function's address; when the wait is satisfied the scheduler
// finishes the call (the return value goes in rax) and the thread runs on.

use crate::cpu::Cpu;
use crate::files::Handle;
use crate::{eh, kernel32::NO_RETURN, Engine, PEB, RET_THREAD, TEB};

const SLICE: u64 = 200_000; // instructions per turn
const STILL_ACTIVE: u64 = 259;
const WAIT_TIMEOUT: u64 = 258;
const WAIT_FAILED: u64 = 0xFFFF_FFFF;
pub const BLOCK: u64 = u64::MAX - 0x5A5B;
/// pending value of a parked call that runs again when the thread wakes
pub const RETRY: u64 = u64::MAX - 0x5A5C;
const SRW_EX: u64 = u64::MAX;
const MAIN_TID: u32 = 8;

#[derive(Clone)]
pub enum W {
    Sleep,
    Objs { hs: Vec<u64>, all: bool },
    Cs(u64),
    SrwEx(u64),
    SrwSh(u64),
    /// a Linux system call waiting (pipe, child, terminal input, sleep)
    Lx(crate::linux::Cond),
    /// WaitOnAddress: until the value changes or the address is woken
    Addr { addr: u64, val: u64, size: u32, seq: u64, win: bool },
    /// a pipe read: until there is data or no writer (then the call runs again)
    Pipe(u64),
    /// keyed event: until a release with the same key
    Keyed(u64),
    /// completion port: until packets arrive (out = key*, apc*, iosb* or entries*, count, written*)
    Port { h: u64, ex: bool, out: [u64; 3], count: u32 },
    /// GetMessage: until a message for the thread (written to `out`)
    Msg { out: u64, hwnd: u64, first: u32, last: u32 },
    /// MsgWaitForMultipleObjects: an object or any message
    MsgOrObjs { hs: Vec<u64> },
}

#[derive(Clone, Copy, PartialEq)]
pub enum St { Ready, Running, Wait, Suspended, Done }

pub struct Thread {
    pub id: u32,
    pub teb: u64,
    cpu: Box<Cpu>,
    eh: eh::Eh,
    pub st: St,
    wait: Option<W>,
    deadline: f64, // ms (host clock); infinity = no timeout
    pending: Option<u64>, // return value of the native call it was parked in
    pub exit: u32,
    suspend: u32,
    on_core: u32, // core whose registers hold this thread (NO_CORE = saved in cpu)
    pub pid: u32, // Linux process (0 = Windows program)
    pub wpid: u32, // Windows process (0 = the first program)
    cpu_ms: f64, // time spent on a core (ms), for GetThreadTimes
    ran: f64,    // when it last went on a core (that core's clock)
}
const NO_CORE: u32 = u32::MAX;

#[derive(Default)]
pub struct Sched {
    pub th: Vec<Thread>,
    pub switches: u64,
    pub addr_seq: std::collections::HashMap<u64, u64>,
    pub keyed: std::collections::HashMap<u64, u32>,
}

fn now() -> f64 { unsafe { crate::host_now_ms() } }

impl Sched {
    pub fn multi(&self) -> bool { self.th.len() > 1 }
}

impl Engine {
    pub fn sched_init(&mut self) {
        self.s.sched.th.push(Thread {
            id: MAIN_TID, teb: TEB, cpu: Box::new(Cpu::new()), eh: Default::default(), st: St::Running,
            wait: None, deadline: f64::INFINITY, pending: None, exit: 0, suspend: 0, on_core: 0, pid: 0, wpid: 0, cpu_ms: 0.0, ran: now(),
        });
        self.cur = 0;
        self.slice = SLICE;
    }

    pub(crate) fn cur_tid(&self) -> u32 { self.s.sched.th.get(self.cur).map_or(MAIN_TID, |t| t.id) }

    /// Counts executed instructions; asks for a switch when the slice is used.
    #[inline(always)]
    pub fn sched_tick(&mut self, n: u64) {
        if self.s.sched.th.len() > 1 {
            if self.slice <= n { self.want_switch = true; } else { self.slice -= n; }
        }
    }
    /// How many instructions the current thread may still run in its slice.
    pub fn slice_left(&self) -> u64 { if self.s.sched.th.len() > 1 { self.slice.max(1) } else { u64::MAX } }

    fn off_core(&mut self, c: usize) {
        let t = &mut self.s.sched.th[c];
        t.cpu_ms += (now() - t.ran).max(0.0);
    }
    fn cpu_ms_of(&self, i: usize) -> f64 {
        let t = &self.s.sched.th[i];
        t.cpu_ms + if i == self.cur && t.on_core == self.core { (now() - t.ran).max(0.0) } else { 0.0 }
    }
    /// GetThreadTimes / GetProcessTimes: (creation FILETIME, user time in 100 ns); all time counts as user time.
    pub(crate) fn cpu_times(&self, h: u64, process: bool) -> Option<(u64, u64)> {
        let ms = if process {
            let id = if h == u64::MAX { self.s.wpid } else { match self.s.fs.handles.get(&h) { Some(crate::files::Handle::Process { pid }) => *pid, _ => return None } };
            (0..self.s.sched.th.len()).filter(|&i| self.s.sched.th[i].wpid == id && self.s.sched.th[i].pid == 0).map(|i| self.cpu_ms_of(i)).sum()
        } else { self.cpu_ms_of(self.thread_of(h)?) };
        let created = ((unsafe { crate::host_epoch_ms() } - now()) as i64 + 11_644_473_600_000) as u64 * 10_000;
        Some((created, (ms * 10_000.0) as u64))
    }

    fn thread_of(&self, h: u64) -> Option<usize> {
        if h == u64::MAX - 1 { return Some(self.cur); }
        match self.s.fs.handles.get(&h) {
            Some(Handle::Thread { tid }) => self.s.sched.th.iter().position(|t| t.id == *tid),
            _ => None,
        }
    }

    /// Is handle h signaled for thread `me`?
    fn signaled(&self, h: u64, me: u32) -> bool {
        match self.s.fs.handles.get(&h) {
            Some(Handle::Event { set, .. }) => *set,
            Some(Handle::Mutex { owner, .. }) => *owner == 0 || *owner == me,
            Some(Handle::Semaphore { count, .. }) => *count > 0,
            Some(Handle::Thread { tid }) => self.s.sched.th.iter().find(|t| t.id == *tid).map_or(true, |t| t.st == St::Done),
            Some(Handle::Timer { due, .. }) => now() >= *due,
            Some(Handle::Process { pid }) => self.s.pinfo.get(pid).map_or(true, |i| i.exit.is_some()),
            _ => true,
        }
    }
    fn acquire(&mut self, h: u64, me: u32) {
        match self.s.fs.handles.get_mut(&h) {
            Some(Handle::Event { set, manual }) => { if !*manual { *set = false; } }
            Some(Handle::Mutex { owner, count }) => { *owner = me; *count += 1; }
            Some(Handle::Semaphore { count, .. }) => { *count -= 1; }
            Some(Handle::Timer { due, manual, period }) => { if !*manual { *due = if *period > 0.0 { *due + *period } else { f64::INFINITY }; } }
            _ => {}
        }
    }

    /// Tries to finish a wait for thread index i; Some(return value) when done.
    fn try_wait(&mut self, w: &W, me: u32) -> Option<u64> {
        match w {
            W::Sleep => None,
            W::Objs { hs, all } => {
                if *all {
                    if hs.iter().all(|&h| self.signaled(h, me)) {
                        for &h in hs { self.acquire(h, me); }
                        return Some(0);
                    }
                    None
                } else {
                    let i = hs.iter().position(|&h| self.signaled(h, me))?;
                    self.acquire(hs[i], me);
                    Some(i as u64)
                }
            }
            W::Cs(cs) => {
                let owner = self.mmu.read64(cs + 16).unwrap_or(0);
                if owner == 0 || owner == me as u64 {
                    let rc = self.mmu.read32(cs + 12).unwrap_or(0);
                    let _ = self.mmu.write64(cs + 16, me as u64);
                    let _ = self.mmu.write32(cs + 12, rc + 1);
                    Some(0)
                } else { None }
            }
            W::SrwEx(l) => {
                if self.mmu.read64(*l).unwrap_or(0) == 0 { let _ = self.mmu.write64(*l, SRW_EX); Some(0) } else { None }
            }
            W::Lx(_) => None,
            W::Port { h, ex, out, count } => {
                let mut got = Vec::new();
                if let Some(Handle::Port { q }) = self.s.fs.handles.get_mut(h) {
                    while (got.len() as u32) < (*count).max(1) { match q.pop_front() { Some(p) => got.push(p), None => break } }
                }
                if got.is_empty() { return None; }
                if *ex {
                    for (i, p) in got.iter().enumerate() { for k in 0..4 { let _ = self.mmu.write64(out[0] + 32 * i as u64 + 8 * k as u64, p[k]); } }
                    if out[2] != 0 { let _ = self.mmu.write32(out[2], got.len() as u32); }
                } else {
                    let p = got[0];
                    let _ = self.mmu.write64(out[0], p[0]);
                    let _ = self.mmu.write64(out[1], p[1]);
                    let _ = self.mmu.write64(out[2], p[2]);
                    let _ = self.mmu.write64(out[2] + 8, p[3]);
                }
                Some(0)
            }
            W::Pipe(id) => match self.s.fs.pipes.get(id) { Some(p) if p.buf.is_empty() && p.writers > 0 => None, _ => Some(RETRY) },
            W::Keyed(k) => match self.s.sched.keyed.get_mut(k) { Some(n) if *n > 0 => { *n -= 1; Some(0) } _ => None },
            W::Addr { addr, val, size, seq, win } => {
                let cur = match size { 1 => self.mmu.read8(*addr).map(|v| v as u64), 2 => self.mmu.read16(*addr).map(|v| v as u64), 4 => self.mmu.read32(*addr).map(|v| v as u64), _ => self.mmu.read64(*addr) }.unwrap_or(0);
                if cur != *val || self.s.sched.addr_seq.get(addr).copied().unwrap_or(0) != *seq { Some(*win as u64) } else { None }
            }
            W::Msg { out, hwnd, first, last } => self.peek_tid(me, *out, *hwnd, *first, *last, true).map(|more| more as u64),
            W::MsgOrObjs { hs } => {
                if let Some(i) = hs.iter().position(|&h| self.signaled(h, me)) { self.acquire(hs[i], me); return Some(i as u64); }
                if self.has_msgs(me) { Some(hs.len() as u64) } else { None }
            }
            W::SrwSh(l) => {
                let v = self.mmu.read64(*l).unwrap_or(0);
                if v != SRW_EX { let _ = self.mmu.write64(*l, v + 1); Some(0) } else { None }
            }
        }
    }

    /// Native call that waits: finishes now when possible, else parks the thread.
    pub(crate) fn wait_on(&mut self, w: W, ms: u64) -> u64 {
        let me = self.cur_tid();
        if let Some(v) = self.try_wait(&w, me) { return v; }
        if ms == 0 { return WAIT_TIMEOUT; }
        let t = &mut self.s.sched.th[self.cur];
        t.st = St::Wait;
        t.wait = Some(w);
        t.deadline = if ms >= 0xFFFF_FFFF { f64::INFINITY } else { now() + ms as f64 };
        self.want_switch = true;
        BLOCK
    }

    fn new_thread(&mut self, stack: u64, start: u64, param: u64, flags: u64) -> Option<(u64, u32)> {
        let size = stack.max(1 << 20);
        let st = self.alloc(size)?;
        let teb = self.alloc(0x2000)?;
        let id = MAIN_TID + 4 * self.s.sched.th.len() as u32;
        let w = |e: &mut Engine, a: u64, v: u64| { let _ = e.mmu.write64(a, v); };
        w(self, teb + 0x08, st + size);
        w(self, teb + 0x10, st);
        w(self, teb + 0x30, teb);
        w(self, teb + 0x40, 4);
        w(self, teb + 0x48, id as u64);
        w(self, teb + 0x58, teb + 0x1800);
        w(self, teb + 0x60, PEB);
        self.tls_blocks(teb);
        self.teb_extras(teb);
        let mut cpu = Box::new(Cpu::new());
        let sp = st + size - 0x100;
        w(self, sp, RET_THREAD);
        cpu.regs[4] = sp;
        cpu.regs[1] = param;
        cpu.rip = start;
        cpu.gs_base = teb;
        cpu.xmm = self.cpu.xmm; // MXCSR-like state is not modeled; start clean otherwise
        let suspended = flags & 4 != 0;
        self.s.sched.th.push(Thread {
            id, teb, cpu, eh: Default::default(), st: if suspended { St::Suspended } else { St::Ready },
            wait: None, deadline: f64::INFINITY, pending: None, exit: STILL_ACTIVE as u32, suspend: suspended as u32, on_core: NO_CORE, pid: 0, wpid: self.s.wpid, cpu_ms: 0.0, ran: 0.0,
        });
        if self.s.sched.th.len() == 2 { self.slice = SLICE; }
        crate::lock::kick();
        let h = self.new_handle(Handle::Thread { tid: id });
        Some((h, id))
    }

    /// The main thread of a new Windows process.
    pub fn add_thread(&mut self, cpu: Cpu, teb: u64, wpid: u32, suspended: bool) -> u32 {
        let id = MAIN_TID + 4 * self.s.sched.th.len() as u32;
        self.s.sched.th.push(Thread {
            id, teb, cpu: Box::new(cpu), eh: Default::default(), st: if suspended { St::Suspended } else { St::Ready },
            wait: None, deadline: f64::INFINITY, pending: None, exit: STILL_ACTIVE as u32, suspend: suspended as u32, on_core: NO_CORE, pid: 0, wpid, cpu_ms: 0.0, ran: 0.0,
        });
        if self.s.sched.th.len() == 2 { self.slice = SLICE; }
        crate::lock::kick();
        id
    }
    /// A new Linux thread (fork's child), ready to run.
    pub fn spawn_linux(&mut self, cpu: Cpu, pid: u32) {
        let id = MAIN_TID + 4 * self.s.sched.th.len() as u32;
        self.s.sched.th.push(Thread {
            id, teb: 0, cpu: Box::new(cpu), eh: Default::default(), st: St::Ready,
            wait: None, deadline: f64::INFINITY, pending: None, exit: 0, suspend: 0, on_core: NO_CORE, pid, wpid: 0, cpu_ms: 0.0, ran: 0.0,
        });
        if self.s.sched.th.len() == 2 { self.slice = SLICE; }
    }
    /// The current Linux thread waits (its rip is back on the syscall instruction).
    pub fn block_linux(&mut self, c: crate::linux::Cond, ms: Option<f64>) {
        let t = &mut self.s.sched.th[self.cur];
        t.st = St::Wait;
        t.wait = Some(W::Lx(c));
        t.deadline = ms.map_or(f64::INFINITY, |m| now() + m);
        self.want_switch = true;
    }
    /// Every thread of Linux process `pid` ends.
    pub fn end_linux(&mut self, pid: u32) {
        for t in self.s.sched.th.iter_mut() { if t.pid == pid { t.st = St::Done; t.wait = None; } }
        self.want_switch = true;
    }
    pub fn cur_pid(&self) -> u32 { self.s.sched.th.get(self.cur).map_or(0, |t| t.pid) }

    /// The current thread ends.
    pub fn exit_thread(&mut self, code: u32) {
        let c = self.cur;
        self.s.sched.th[c].st = St::Done;
        self.s.sched.th[c].exit = code;
        let wp = self.s.sched.th[c].wpid;
        if self.s.sched.th.iter().filter(|t| t.wpid == wp).all(|t| t.st == St::Done) {
            self.exit_process(code);
        }
        self.want_switch = true;
        crate::lock::kick();
    }

    /// Picks the next thread for this core (call with the engine lock held).
    /// false = nothing to run now: idle_ms says how long to wait.
    pub fn sched_switch(&mut self) -> bool {
        self.want_switch = false;
        self.slice = SLICE;
        let n = self.s.sched.th.len();
        let c = self.cur;
        let running = c != usize::MAX && self.s.sched.th[c].st == St::Running;
        let t_now = now();
        let mut soonest = f64::INFINITY;
        let mut held = false;
        let orig = self.s.wpid;
        for k in 1..=n {
            let i = if c == usize::MAX { k - 1 } else { (c + k) % n };
            if i == c && running { return true; } // nobody else: keep going
            let t = &self.s.sched.th[i];
            if t.on_core != NO_CORE && t.on_core != self.core { // still on another core
                if t.st != St::Done { held = true; }
                if t.st == St::Wait { soonest = soonest.min(t.deadline); }
                continue;
            }
            if self.core != 0 && t.pid != 0 { continue; } // Linux processes run on core 0 (one address space at a time)
            // several Windows processes: one address space at a time, so only core 0 runs, and it
            // changes process only when no other core still holds a thread
            if t.wpid != self.s.wpid || (self.core != 0 && self.children_alive()) {
                if self.core != 0 { continue; }
                if self.s.sched.th.iter().any(|x| x.on_core != NO_CORE && x.on_core != self.core && x.st != St::Done) { held = true; continue; }
            }
            match t.st {
                St::Ready => return self.switch_to(i),
                St::Wait if matches!(t.wait, Some(W::Lx(_))) => {
                    let Some(W::Lx(c)) = t.wait.clone() else { unreachable!() };
                    let dl = t.deadline;
                    let ready = crate::linux::ready(self, &c);
                    if ready || t_now >= dl {
                        let t = &mut self.s.sched.th[i];
                        t.st = St::Ready;
                        t.wait = None;
                        t.pending = if ready { None } else { Some(0) };
                        return self.switch_to(i);
                    }
                    soonest = soonest.min(if matches!(c, crate::linux::Cond::Stdin) { t_now + 30.0 } else { dl });
                }
                St::Wait => {
                    let w = t.wait.clone().unwrap();
                    let id = t.id;
                    let dl = t.deadline;
                    // a thread of another process: its wait reads that process's memory
                    let other = t.wpid != self.s.wpid;
                    if other { let wp = t.wpid; self.enter_proc(wp); }
                    let r = self.try_wait(&w, id).or_else(|| if t_now >= dl { Some(if matches!(w, W::Sleep | W::Addr { win: true, .. }) { 0 } else { WAIT_TIMEOUT }) } else { None });
                    if let Some(v) = r {
                        let t = &mut self.s.sched.th[i];
                        t.st = St::Ready;
                        t.wait = None;
                        t.pending = Some(v);
                        return self.switch_to(i);
                    }
                    if other { self.enter_proc(orig); }
                    soonest = soonest.min(dl);
                    // a window thread: page input can come at any time, timers are due later
                    if matches!(w, W::Msg { .. } | W::MsgOrObjs { .. }) { soonest = soonest.min((t_now + 30.0).min(self.next_timer(id))); }
                    // a waitable timer in the wait: wake up when it is due
                    if let W::Objs { hs, .. } = &w {
                        for h in hs { if let Some(Handle::Timer { due, .. }) = self.s.fs.handles.get(h) { soonest = soonest.min(*due); } }
                    }
                }
                _ => {}
            }
        }
        // nothing to run here: park the current thread (another core may pick it up later)
        if c != usize::MAX {
            self.materialize();
            core::mem::swap(&mut self.cpu, &mut *self.s.sched.th[c].cpu);
            core::mem::swap(&mut self.eh, &mut self.s.sched.th[c].eh);
            self.s.sched.th[c].on_core = NO_CORE;
            self.off_core(c);
            self.cur = usize::MAX;
        }
        self.want_switch = true;
        let busy = held || self.s.sched.th.iter().any(|t| t.st == St::Running || (t.on_core != NO_CORE && t.st != St::Done));
        if soonest.is_finite() || busy {
            self.idle_ms = if soonest.is_finite() { (soonest - t_now).max(0.0).min(50.0) } else { 50.0 };
        } else if !self.s.exited {
            self.set_error("all threads are waiting for each other (deadlock)".into());
        }
        false
    }

    fn switch_to(&mut self, i: usize) -> bool {
        let c = self.cur;
        if i != c {
            self.materialize();
            if self.s.lx.is_some() { let pid = self.s.sched.th[i].pid; crate::linux::enter(self, pid); }
            let wp = self.s.sched.th[i].wpid;
            if wp != self.s.wpid { self.enter_proc(wp); }
            if c != usize::MAX {
                core::mem::swap(&mut self.cpu, &mut *self.s.sched.th[c].cpu);
                core::mem::swap(&mut self.eh, &mut self.s.sched.th[c].eh);
                if self.s.sched.th[c].st == St::Running { self.s.sched.th[c].st = St::Ready; }
                self.s.sched.th[c].on_core = NO_CORE;
                self.off_core(c);
            }
            core::mem::swap(&mut self.cpu, &mut *self.s.sched.th[i].cpu);
            core::mem::swap(&mut self.eh, &mut self.s.sched.th[i].eh);
            self.cur = i;
            self.s.sched.th[i].on_core = self.core;
            self.s.sched.th[i].ran = now();
            self.s.sched.switches += 1;
            if c != usize::MAX { crate::lock::kick(); }
        }
        self.s.sched.th[i].st = St::Running;
        if let Some(v) = self.s.sched.th[i].pending.take() {
            // a Linux system call that finished while waiting: skip the syscall instruction
            if self.s.sched.th[i].pid != 0 { self.cpu.rip += 2; self.cpu.regs[0] = v; } else if v != RETRY { self.do_ret(v); }
        }
        true
    }

    fn handles_arg(&mut self, n: u64, p: u64) -> Vec<u64> {
        (0..n.min(64)).map(|k| self.mmu.read64(p + 8 * k).unwrap_or(0)).collect()
    }
}

/// Thread and synchronization functions; None = not ours.
/// NT timeout (LARGE_INTEGER*: null = forever, < 0 relative 100 ns, >= 0 absolute FILETIME) in ms.
fn nt_timeout(e: &mut Engine, p: u64) -> u64 {
    if p == 0 { return 0xFFFF_FFFF; }
    let v = e.mmu.read64(p).unwrap_or(0) as i64;
    if v < 0 { ((-v) as u64 / 10_000).min(0xFFFF_FFFE) } else {
        let now_ft = (unsafe { crate::host_epoch_ms() } as i64 + 11_644_473_600_000) * 10_000;
        ((v - now_ft).max(0) as u64 / 10_000).min(0xFFFF_FFFE)
    }
}

/// Due time (host ms) of an NT/Win32 timer setting (LARGE_INTEGER value).
fn timer_due(v: i64) -> f64 {
    if v < 0 { now() + (-v) as f64 / 10_000.0 } else {
        let now_ft = (unsafe { crate::host_epoch_ms() } as i64 + 11_644_473_600_000) * 10_000;
        now() + (v - now_ft).max(0) as f64 / 10_000.0
    }
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    let me = e.cur_tid();
    Some(match name {
        // ---- NT-style waits and objects (for Wine's code) ----
        "RtlWaitOnAddress" | "WaitOnAddress" => {
            let (cmp, size) = (e.arg(1), e.arg(2) as u32);
            let val = match size { 1 => e.mmu.read8(cmp).map(|v| v as u64), 2 => e.mmu.read16(cmp).map(|v| v as u64), 4 => e.mmu.read32(cmp).map(|v| v as u64), _ => e.mmu.read64(cmp) }.unwrap_or(0);
            let ms = if name == "WaitOnAddress" { e.arg(3) as u32 as u64 } else { let p = e.arg(3); nt_timeout(e, p) };
            let seq = e.s.sched.addr_seq.get(&a0).copied().unwrap_or(0);
            let win = name == "WaitOnAddress";
            let r = e.wait_on(W::Addr { addr: a0, val, size, seq, win }, ms);
            if win && r == WAIT_TIMEOUT { e.set_last_error(1460); 0 } else { r }
        }
        "NtCreateIoCompletion" => { let h = e.new_handle(Handle::Port { q: Default::default() }); let _ = e.mmu.write64(a0, h); 0 }
        "NtSetIoCompletion" => {
            let p = [e.arg(1), e.arg(2), e.arg(3), e.arg(4)];
            match e.s.fs.handles.get_mut(&a0) { Some(Handle::Port { q }) => { q.push_back(p); 0 } _ => 0xC000_0008 }
        }
        "NtRemoveIoCompletion" => {
            let (key, apc, iosb, t) = (e.arg(1), e.arg(2), e.arg(3), e.arg(4));
            let ms = nt_timeout(e, t);
            e.wait_on(W::Port { h: a0, ex: false, out: [key, apc, iosb], count: 1 }, ms)
        }
        "NtRemoveIoCompletionEx" => {
            let (info, count, written, t) = (e.arg(1), e.arg(2) as u32, e.arg(3), e.arg(4));
            let ms = nt_timeout(e, t);
            e.wait_on(W::Port { h: a0, ex: true, out: [info, 0, written], count }, ms)
        }
        "NtQueryIoCompletion" => {
            let n = match e.s.fs.handles.get(&a0) { Some(Handle::Port { q }) => q.len() as u32, _ => 0 };
            let b = e.arg(2); let _ = e.mmu.write32(b, n); 0
        }
        "NtWaitForKeyedEvent" => { let p = e.arg(3); let ms = nt_timeout(e, p); let k = e.arg(1); e.wait_on(W::Keyed(k), ms) }
        "NtReleaseKeyedEvent" => { let k = e.arg(1); *e.s.sched.keyed.entry(k).or_insert(0) += 1; 0 }
        "NtCreateKeyedEvent" | "NtOpenKeyedEvent" => { let h = e.new_handle(Handle::Event { set: false, manual: false }); let _ = e.mmu.write64(a0, h); 0 }
        "RtlWakeAddressAll" | "RtlWakeAddressSingle" | "WakeByAddressAll" | "WakeByAddressSingle" => {
            *e.s.sched.addr_seq.entry(a0).or_insert(0) += 1;
            0
        }
        "NtWaitForSingleObject" => {
            let p = e.arg(2);
            let ms = nt_timeout(e, p);
            e.wait_on(W::Objs { hs: vec![a0], all: false }, ms)
        }
        "NtWaitForMultipleObjects" => {
            let p = e.arg(1);
            let hs = e.handles_arg(a0, p);
            let all = e.arg(2) as u32 == 0; // WaitAllObject = 0
            let tp = e.arg(4);
            let ms = nt_timeout(e, tp);
            e.wait_on(W::Objs { hs, all }, ms)
        }
        "NtDelayExecution" => {
            let p = e.arg(1);
            let ms = nt_timeout(e, p);
            if ms == 0 { e.want_switch = true; 0 } else { e.wait_on(W::Sleep, ms) }
        }
        "NtYieldExecution" => { e.want_switch = true; 0 }
        "NtCreateEvent" => {
            let (kind, init) = (e.arg(3) as u32, e.arg(4) as u8 != 0);
            let h = e.new_handle(Handle::Event { set: init, manual: kind == 0 });
            let _ = e.mmu.write64(a0, h); 0
        }
        "NtSetEvent" | "NtResetEvent" | "NtPulseEvent" => {
            let set = name == "NtSetEvent";
            match e.s.fs.handles.get_mut(&a0) { Some(Handle::Event { set: s, .. }) => { *s = set; 0 } _ => 0xC000_0008 }
        }
        "NtCreateMutant" => {
            let owned = e.arg(3) as u8 != 0;
            let h = e.new_handle(Handle::Mutex { owner: if owned { me } else { 0 }, count: owned as u32 });
            let _ = e.mmu.write64(a0, h); 0
        }
        "NtReleaseMutant" => match e.s.fs.handles.get_mut(&a0) {
            Some(Handle::Mutex { owner, count }) if *owner == me => { *count -= 1; if *count == 0 { *owner = 0; } 0 }
            _ => 0xC000_0046, // STATUS_MUTANT_NOT_OWNED
        },
        "NtCreateSemaphore" => {
            let (c, m) = (e.arg(3) as i32, e.arg(4) as i32);
            let h = e.new_handle(Handle::Semaphore { count: c, max: m });
            let _ = e.mmu.write64(a0, h); 0
        }
        "NtReleaseSemaphore" => {
            let (n, p) = (e.arg(1) as i32, e.arg(2));
            match e.s.fs.handles.get_mut(&a0) {
                Some(Handle::Semaphore { count, max }) if *count + n <= *max => { let prev = *count; *count += n; if p != 0 { let _ = e.mmu.write32(p, prev as u32); } 0 }
                _ => 0xC000_0047, // STATUS_SEMAPHORE_LIMIT_EXCEEDED
            }
        }
        "NtCreateTimer" => {
            let kind = e.arg(3) as u32;
            let h = e.new_handle(Handle::Timer { due: f64::INFINITY, manual: kind == 0, period: 0.0 });
            let _ = e.mmu.write64(a0, h); 0
        }
        "CreateWaitableTimerW" | "CreateWaitableTimerA" => { let manual = e.arg(1) as u32 != 0; e.new_handle(Handle::Timer { due: f64::INFINITY, manual, period: 0.0 }) }
        "CreateWaitableTimerExW" | "CreateWaitableTimerExA" => { let manual = e.arg(2) as u32 & 1 != 0; e.new_handle(Handle::Timer { due: f64::INFINITY, manual, period: 0.0 }) }
        "NtSetTimer" | "SetWaitableTimer" | "SetWaitableTimerEx" => {
            let vp = e.arg(1); let v = e.mmu.read64(vp).unwrap_or(0) as i64;
            let period = if name == "NtSetTimer" { e.arg(5) as u32 } else { e.arg(2) as u32 } as f64;
            let ok = match e.s.fs.handles.get_mut(&a0) { Some(Handle::Timer { due, period: p, .. }) => { *due = timer_due(v); *p = period; true } _ => false };
            if name == "NtSetTimer" { if ok { 0 } else { 0xC000_0008 } } else { ok as u64 }
        }
        "NtCancelTimer" | "CancelWaitableTimer" => {
            if let Some(Handle::Timer { due, .. }) = e.s.fs.handles.get_mut(&a0) { *due = f64::INFINITY; }
            if name == "NtCancelTimer" { 0 } else { 1 }
        }
        "NtClose" => { e.close_handle(a0); 0 }
        "NtCreateThreadEx" => {
            // (handle*, access, attributes, process, start, param, flags, zero bits, stack, max stack, attribute list)
            let (start, param, flags, stack, list) = (e.arg(4), e.arg(5), e.arg(6), e.arg(8), e.arg(10));
            match e.new_thread(stack, start, param, if flags & 1 != 0 { 4 } else { 0 }) {
                Some((h, id)) => {
                    let _ = e.mmu.write64(a0, h);
                    if list != 0 {
                        let total = e.mmu.read64(list).unwrap_or(0);
                        let mut p = list + 8;
                        while p + 32 <= list + total {
                            let (attr, val) = (e.mmu.read64(p).unwrap_or(0), e.mmu.read64(p + 16).unwrap_or(0));
                            if attr & 0xFFFF == 3 && val != 0 { let _ = e.mmu.write64(val, 4); let _ = e.mmu.write64(val + 8, id as u64); }
                            if attr & 0xFFFF == 4 && val != 0 { let teb = e.thread_of(h).map_or(0, |i| e.s.sched.th[i].teb); let _ = e.mmu.write64(val, teb); }
                            p += 32;
                        }
                    }
                    0
                }
                None => 0xC000_009A, // STATUS_INSUFFICIENT_RESOURCES
            }
        }
        "CreateThread" | "_beginthreadex" | "_beginthread" => {
            let (stack, start, param, flags) = if name == "_beginthread" { (e.arg(1), a0, e.arg(2), 0) } else { (e.arg(1), e.arg(2), e.arg(3), e.arg(4)) };
            match e.new_thread(stack, start, param, flags) {
                Some((h, id)) => {
                    if name != "_beginthread" { let p = e.arg(5); if p != 0 { let _ = e.mmu.write32(p, id); } }
                    h
                }
                None => 0,
            }
        }
        "ExitThread" | "_endthreadex" | "_endthread" => { e.exit_thread(a0 as u32); NO_RETURN }
        "GetCurrentThreadId" => me as u64,
        "GetThreadId" => e.thread_of(a0).map_or(0, |i| e.s.sched.th[i].id as u64),
        "ResumeThread" => match e.thread_of(a0) {
            Some(i) => {
                let t = &mut e.s.sched.th[i];
                let prev = t.suspend;
                if t.suspend > 0 { t.suspend -= 1; if t.suspend == 0 && t.st == St::Suspended { t.st = St::Ready; } }
                prev as u64
            }
            None => u32::MAX as u64,
        },
        "NtSuspendThread" | "NtResumeThread" => {
            let Some(i) = e.thread_of(a0) else { return Some(0xC000_0008) };
            let t = &mut e.s.sched.th[i];
            let prev = t.suspend;
            if name == "NtSuspendThread" { if i != e.cur { t.suspend += 1; if t.st == St::Ready { t.st = St::Suspended; } } }
            else if t.suspend > 0 { t.suspend -= 1; if t.suspend == 0 && t.st == St::Suspended { t.st = St::Ready; } }
            let p = e.arg(1);
            if p != 0 { let _ = e.mmu.write32(p, prev); }
            0
        }
        "NtGetContextThread" | "NtSetContextThread" => {
            let Some(i) = e.thread_of(a0) else { return Some(0xC000_0008) };
            let c = e.arg(1);
            if i == e.cur { e.materialize(); }
            let get = name == "NtGetContextThread";
            let cpu: &mut Cpu = if i == e.cur { &mut e.cpu } else { &mut e.s.sched.th[i].cpu };
            if get {
                let f = 0x202 | cpu.cf as u64 | (cpu.pf as u64) << 2 | (cpu.zf as u64) << 6 | (cpu.sf as u64) << 7 | (cpu.df as u64) << 10 | (cpu.of as u64) << 11;
                let (regs, rip, xmm) = (cpu.regs, cpu.rip, cpu.xmm);
                let _ = e.mmu.write32(c + 0x34, 0x1F80);
                for (o, v) in [(0x38u64, 0x33u16), (0x3A, 0x2B), (0x3C, 0x2B), (0x3E, 0x53), (0x40, 0x2B), (0x42, 0x2B)] { let _ = e.mmu.write16(c + o, v); }
                let _ = e.mmu.write32(c + 0x44, f as u32);
                for k in 0..16 { let _ = e.mmu.write64(c + 0x78 + 8 * k as u64, regs[k]); }
                let _ = e.mmu.write64(c + 0xF8, rip);
                for k in 0..16 { let _ = e.mmu.write_bytes(c + 0x1A0 + 16 * k as u64, &xmm[k].to_le_bytes()); }
                let _ = e.mmu.write32(c + 0x100 + 24, 0x1F80);
            } else {
                let fl = e.mmu.read32(c + 0x30).unwrap_or(0);
                let mut regs = [0u64; 16];
                for k in 0..16 { regs[k] = e.mmu.read64(c + 0x78 + 8 * k as u64).unwrap_or(0); }
                let rip = e.mmu.read64(c + 0xF8).unwrap_or(0);
                let f = e.mmu.read32(c + 0x44).unwrap_or(0x202) as u64;
                let mut xmm = [0u128; 16];
                for k in 0..16 { let mut b = [0u8; 16]; let _ = e.mmu.read_bytes(c + 0x1A0 + 16 * k as u64, &mut b); xmm[k] = u128::from_le_bytes(b); }
                let cpu: &mut Cpu = if i == e.cur { &mut e.cpu } else { &mut e.s.sched.th[i].cpu };
                if fl & 1 != 0 { cpu.rip = rip; cpu.regs[4] = regs[4]; cpu.regs[5] = regs[5];
                    cpu.cf = f & 1 != 0; cpu.pf = f & 4 != 0; cpu.zf = f & 0x40 != 0; cpu.sf = f & 0x80 != 0; cpu.df = f & 0x400 != 0; cpu.of = f & 0x800 != 0; }
                if fl & 2 != 0 { for k in [0usize, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] { cpu.regs[k] = regs[k]; } }
                if fl & 8 != 0 { cpu.xmm = xmm; }
            }
            0
        }
        "SuspendThread" => match e.thread_of(a0) {
            Some(i) if i != e.cur => { let t = &mut e.s.sched.th[i]; let prev = t.suspend; t.suspend += 1; if t.st == St::Ready { t.st = St::Suspended; } prev as u64 }
            _ => 0,
        },
        "GetExitCodeThread" => {
            let p = e.arg(1);
            let v = e.thread_of(a0).map_or(0, |i| if e.s.sched.th[i].st == St::Done { e.s.sched.th[i].exit as u64 } else { STILL_ACTIVE });
            let _ = e.mmu.write32(p, v as u32);
            1
        }
        "WaitForSingleObject" | "WaitForSingleObjectEx" => {
            if a0 != u64::MAX - 1 && !e.s.fs.handles.contains_key(&a0) { WAIT_FAILED }
            else { let ms = e.arg(1) as u32 as u64; e.wait_on(W::Objs { hs: vec![a0], all: false }, ms) }
        }
        "WaitForMultipleObjects" | "WaitForMultipleObjectsEx" => {
            let p = e.arg(1);
            let hs = e.handles_arg(a0, p);
            let all = e.arg(2) as u32 != 0;
            let ms = e.arg(3) as u32 as u64;
            e.wait_on(W::Objs { hs, all }, ms)
        }
        "Sleep" | "SleepEx" => {
            let ms = a0 as u32 as u64;
            if ms == 0 { e.want_switch = e.s.sched.multi(); 0 } else { e.wait_on(W::Sleep, ms) }
        }
        "SwitchToThread" => { e.want_switch = e.s.sched.multi(); 1 }
        "CreateEventW" | "CreateEventA" | "CreateEventExW" | "CreateEventExA" => {
            let (manual, set) = if name.contains("Ex") { let f = e.arg(2); (f & 1 != 0, f & 2 != 0) } else { (e.arg(1) != 0, e.arg(2) != 0) };
            e.new_handle(Handle::Event { set, manual })
        }
        "SetEvent" => { if let Some(Handle::Event { set, .. }) = e.s.fs.handles.get_mut(&a0) { *set = true; } 1 }
        "ResetEvent" => { if let Some(Handle::Event { set, .. }) = e.s.fs.handles.get_mut(&a0) { *set = false; } 1 }
        "PulseEvent" => 1,
        "CreateMutexW" | "CreateMutexA" => { let own = e.arg(1) != 0; e.new_handle(Handle::Mutex { owner: if own { me } else { 0 }, count: own as u32 }) }
        "ReleaseMutex" => match e.s.fs.handles.get_mut(&a0) {
            Some(Handle::Mutex { owner, count }) if *owner == me => { *count -= 1; if *count == 0 { *owner = 0; } 1 }
            _ => 0,
        },
        "CreateSemaphoreW" | "CreateSemaphoreA" | "CreateSemaphoreExW" => { let (c, m) = (e.arg(1) as i32, e.arg(2) as i32); e.new_handle(Handle::Semaphore { count: c, max: m }) }
        "ReleaseSemaphore" => {
            let (n, p) = (e.arg(1) as i32, e.arg(2));
            match e.s.fs.handles.get_mut(&a0) {
                Some(Handle::Semaphore { count, max }) if *count + n <= *max => {
                    let prev = *count;
                    *count += n;
                    if p != 0 { let _ = e.mmu.write32(p, prev as u32); }
                    1
                }
                _ => 0,
            }
        }
        "InitializeCriticalSection" | "InitializeCriticalSectionAndSpinCount" | "InitializeCriticalSectionEx" => {
            // DebugInfo: some code (Wine's CRT) writes a name into it
            e.zero(a0, 40); let d = e.heap_alloc(64, true); let _ = e.mmu.write64(a0, d); 1
        }
        "DeleteCriticalSection" => 0,
        "EnterCriticalSection" => e.wait_on(W::Cs(a0), u64::MAX),
        "TryEnterCriticalSection" => (e.try_wait(&W::Cs(a0), me).is_some()) as u64,
        "LeaveCriticalSection" => {
            let rc = e.mmu.read32(a0 + 12).unwrap_or(0);
            if rc <= 1 { let _ = e.mmu.write32(a0 + 12, 0); let _ = e.mmu.write64(a0 + 16, 0); } else { let _ = e.mmu.write32(a0 + 12, rc - 1); }
            0
        }
        "InitializeSRWLock" => { let _ = e.mmu.write64(a0, 0); 0 }
        "AcquireSRWLockExclusive" => { let r = e.wait_on(W::SrwEx(a0), u64::MAX); if r == BLOCK { r } else { 0 } }
        "AcquireSRWLockShared" => { let r = e.wait_on(W::SrwSh(a0), u64::MAX); if r == BLOCK { r } else { 0 } }
        "TryAcquireSRWLockExclusive" => e.try_wait(&W::SrwEx(a0), me).is_some() as u64,
        "TryAcquireSRWLockShared" => e.try_wait(&W::SrwSh(a0), me).is_some() as u64,
        "ReleaseSRWLockExclusive" => { let _ = e.mmu.write64(a0, 0); 0 }
        "ReleaseSRWLockShared" => { let v = e.mmu.read64(a0).unwrap_or(1); let _ = e.mmu.write64(a0, v.saturating_sub(1)); 0 }
        _ => return None,
    })
}
