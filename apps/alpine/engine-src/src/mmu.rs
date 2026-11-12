// 64-bit page table over a fixed pool of real RAM frames, with swap to OPFS.
// - The pool is allocated once and never grows.
// - Pages are committed lazily: real RAM only on first touch (zero-filled).
// - When the pool is full, a clock algorithm evicts a page; dirty pages are
//   written to the swap file, clean ones that already have a copy are dropped.
// - A small software TLB keeps the common case to a few instructions.

use std::collections::HashMap;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_swap_write(slot: u32, ptr: *const u8);
    fn host_swap_read(slot: u32, ptr: *mut u8);
}

pub const PAGE: u64 = 4096;

// ---- TLB shootdown (multi-core) ----
// Every core has its own TLB over the shared frames. Before a frame is given
// to another page (eviction, VirtualFree, munmap), the core doing it (holding
// the engine lock) clears that page from every core's TLB, then waits until
// each other core is at a safe point: between two blocks (the run loop), off
// guest code (waiting for the lock, idle, back in JavaScript). A core inside a
// JIT block may be between its TLB check and the access, so it is waited for.
use core::sync::atomic::{AtomicU32, Ordering::*};
const MAXC: usize = 16;
const AWAY: u32 = u32::MAX;
static EPOCH: AtomicU32 = AtomicU32::new(1);
static SEEN: [AtomicU32; MAXC] = [const { AtomicU32::new(AWAY) }; MAXC];
static TLBS: [AtomicU32; MAXC] = [const { AtomicU32::new(0) }; MAXC];
/// The core is between blocks (call at the top of the run loop).
#[inline(always)]
pub fn safe_point(core: u32) { if crate::lock::MT { SEEN[core as usize].store(EPOCH.load(Acquire), Release); } }
/// The core leaves program code (waits for the lock, sleeps, returns to JavaScript).
#[inline(always)]
pub fn away(core: u32) { if crate::lock::MT { SEEN[core as usize].store(AWAY, Release); } }

const NONE: u32 = u32::MAX;
const TLB_SIZE: usize = 8192;

#[derive(Clone, Copy)]
struct Pte { frame: u32, slot: u32 }

#[derive(Clone, Copy)]
struct Frame { vpn: u64, used: bool, referenced: bool, dirty: bool, asid: u32 }

// layout read by JIT code: tag @0, off @8, writable @12 (16 bytes)
#[derive(Clone, Copy)]
#[repr(C)]
struct TlbEntry { tag: u64, off: usize, writable: bool }

pub struct Fault;

/// What every core shares: the frames of real RAM and the page table.
pub struct MmuShared {
    pool: Vec<u8>,
    frames: Vec<Frame>,
    free: Vec<u32>,
    hand: usize,
    table: HashMap<u64, Pte>,
    regions: Vec<(u64, u64)>,
    pub committed: u64,
    pub target_bytes: u64,
    pub faults: u64,
    pub swap_ins: u64,
    pub swap_outs: u64,
    pub swap_slots: u32,
    /// several address spaces (Linux processes): frames of the others must not be evicted
    pub no_evict: bool,
    /// Linux processes: the running one is `cur`; the others keep their page tables here, so the
    /// swap can move their pages out too (each frame knows its owner)
    cur: u32,
    next_asid: u32,
    saved: HashMap<u32, Saved>,
    free_slots: Vec<u32>,
}

struct Saved { table: HashMap<u64, Pte>, regions: Vec<(u64, u64)>, committed: u64 }

/// A saved address space (a Linux process that is not running): its tables stay in the MMU.
#[derive(Default)]
pub struct Space { id: u32 }

/// One core's view: its own TLB over the shared page table.
pub struct Mmu {
    tlb: Vec<TlbEntry>,
    core: u32,
    pub sh: &'static mut MmuShared,
    /// locked instruction in progress (several cores): 0 none, 1 armed, 2 its read
    /// was recorded, 3 its write lost the race (the instruction is run again), 4 written
    pub lk: u8,
    lk_at: (u64, u64, usize),
    /// the CPU state before the locked instruction (to run it again)
    pub lk_snap: Option<Box<crate::cpu::Cpu>>,
}

// ---- x86 memory order (TSO) with several cores ----
// Plain wasm loads/stores on ARM64 may be reordered (a store seen before an
// earlier one), which x86 programs never see. With more than one core, the JIT
// and the interpreter use atomic (sequentially consistent) accesses for
// aligned data: ldar/stlr on ARM64, which keeps x86's order.
static STRONG: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
pub fn set_strong(on: bool) { STRONG.store(on, Relaxed); }
#[inline(always)]
pub fn strong() -> bool { STRONG.load(Relaxed) }

impl Mmu {
    pub fn new(pool_mb: usize, target_mb: u64) -> Mmu {
        let n = pool_mb * 256;
        let sh = Box::leak(Box::new(MmuShared {
            pool: vec![0u8; n * PAGE as usize],
            frames: vec![Frame { vpn: 0, used: false, referenced: false, dirty: false, asid: 0 }; n],
            free: (0..n as u32).rev().collect(),
            hand: 0,
            table: HashMap::new(),
            regions: Vec::new(),
            committed: 0,
            target_bytes: target_mb << 20,
            faults: 0, swap_ins: 0, swap_outs: 0, swap_slots: 0, no_evict: false,
            cur: 0, next_asid: 1, saved: HashMap::new(), free_slots: Vec::new(),
        }));
        let m = Mmu { tlb: vec![TlbEntry { tag: u64::MAX, off: 0, writable: false }; TLB_SIZE], core: 0, sh, lk: 0, lk_at: (0, 0, 0), lk_snap: None };
        TLBS[0].store(m.tlb.as_ptr() as u32, Release);
        m
    }

    /// Another core's view of the same memory (empty TLB).
    pub fn new_core(&self, core: u32) -> Mmu {
        let sh = unsafe { &mut *(self.sh as *const MmuShared as *mut MmuShared) };
        let m = Mmu { tlb: vec![TlbEntry { tag: u64::MAX, off: 0, writable: false }; TLB_SIZE], core, sh, lk: 0, lk_at: (0, 0, 0), lk_snap: None };
        TLBS[core as usize].store(m.tlb.as_ptr() as u32, Release);
        m
    }

    /// Removes page `vpn` from every core's TLB (engine lock held).
    fn shoot(&mut self, vpn: u64) {
        let t = (vpn as usize) & (TLB_SIZE - 1);
        if self.tlb[t].tag == vpn { self.tlb[t].tag = u64::MAX; }
        if !crate::lock::MT { return; }
        for c in 0..MAXC {
            let p = TLBS[c].load(Acquire);
            if p == 0 || c as u32 == self.core { continue; }
            unsafe {
                let e = (p as *mut TlbEntry).add(t);
                if core::ptr::read_volatile(&(*e).tag) == vpn { core::ptr::write_volatile(&mut (*e).tag, u64::MAX); }
            }
        }
    }
    /// Waits until no other core can still be using a TLB entry cleared by shoot().
    fn shoot_wait(&self) {
        if !crate::lock::MT { return; }
        let ep = EPOCH.fetch_add(1, AcqRel) + 1;
        for c in 0..MAXC {
            if c as u32 == self.core { continue; }
            while { let s = SEEN[c].load(Acquire); s != AWAY && s < ep } { core::hint::spin_loop(); }
        }
    }

    /// Addresses the JIT bakes into its code (both never move).
    pub fn tlb_addr(&self) -> u32 { self.tlb.as_ptr() as u32 }
    pub fn pool_addr(&self) -> u32 { self.sh.pool.as_ptr() as u32 }
    pub const TLB_MASK: u32 = (TLB_SIZE - 1) as u32;

    pub fn frames_total(&self) -> usize { self.sh.frames.len() }
    pub fn resident(&self) -> usize { self.sh.frames.len() - self.sh.free.len() }

    pub fn add_region(&mut self, start: u64, size: u64) {
        self.sh.regions.push((start, start + size));
        self.sh.committed += size;
    }
    /// Address space only (MEM_RESERVE): not counted against the memory target.
    pub fn add_reserved(&mut self, start: u64, size: u64) {
        self.sh.regions.push((start, start + size));
    }

    fn in_region(&self, addr: u64) -> bool {
        self.sh.regions.iter().any(|&(s, e)| addr >= s && addr < e)
    }

    /// The region (start, end) holding `addr`, if any.
    pub fn region_of(&self, addr: u64) -> Option<(u64, u64)> {
        self.sh.regions.iter().copied().find(|&(s, e)| addr >= s && addr < e)
    }
    pub fn overlaps(&self, start: u64, end: u64) -> bool {
        self.sh.regions.iter().any(|&(s, e)| start < e && end > s)
    }

    /// Drops the pages of [start, end): their frames go back to the pool and
    /// their swap copies are forgotten, so they read as zero next time.
    pub fn drop_pages(&mut self, start: u64, end: u64) {
        let (first, last) = (start >> 12, (end + PAGE - 1) >> 12);
        let vpns: Vec<u64> = if last - first > self.sh.table.len() as u64 {
            self.sh.table.keys().copied().filter(|v| *v >= first && *v < last).collect()
        } else {
            (first..last).filter(|v| self.sh.table.contains_key(v)).collect()
        };
        let mut freed = Vec::new();
        for vpn in vpns {
            let pte = self.sh.table.remove(&vpn).unwrap();
            self.shoot(vpn);
            if pte.frame != NONE { freed.push(pte.frame); }
            if pte.slot != NONE { self.sh.free_slots.push(pte.slot); }
        }
        if !freed.is_empty() { self.shoot_wait(); }
        for f in freed {
            self.sh.frames[f as usize].used = false;
            self.sh.free.push(f);
        }
    }

    /// Releases a whole region (VirtualFree MEM_RELEASE).
    pub fn release_region(&mut self, start: u64) -> bool {
        if let Some(i) = self.sh.regions.iter().position(|&(s, _)| s == start) {
            let (s, e) = self.sh.regions.swap_remove(i);
            self.drop_pages(s, e);
            self.sh.committed = self.sh.committed.saturating_sub(e - s);
            true
        } else { false }
    }

    pub fn flush_tlb(&mut self) { for t in self.tlb.iter_mut() { t.tag = u64::MAX; } }

    /// Moves the current address space out (another process is going to run).
    pub fn take_space(&mut self) -> Space {
        self.flush_tlb();
        let id = self.sh.cur;
        let sv = Saved { table: std::mem::take(&mut self.sh.table), regions: std::mem::take(&mut self.sh.regions), committed: std::mem::replace(&mut self.sh.committed, 0) };
        self.sh.saved.insert(id, sv);
        Space { id }
    }
    pub fn put_space(&mut self, sp: Space) {
        self.flush_tlb();
        let sv = self.sh.saved.remove(&sp.id).unwrap_or(Saved { table: HashMap::new(), regions: Vec::new(), committed: 0 });
        self.sh.table = sv.table; self.sh.regions = sv.regions; self.sh.committed = sv.committed;
        self.sh.cur = sp.id;
    }
    /// Windows child processes name the running space by their id. Here spaces get their own
    /// asid: a fresh one when the current space was just parked, nothing otherwise.
    pub fn set_asid(&mut self, _a: u32) {
        if self.sh.saved.contains_key(&self.sh.cur) { self.sh.cur = self.sh.next_asid; self.sh.next_asid += 1; }
    }
    fn alloc_slot(&mut self) -> u32 {
        self.sh.free_slots.pop().unwrap_or_else(|| { let s = self.sh.swap_slots; self.sh.swap_slots += 1; s })
    }
    /// A full copy of the current address space (fork). Pages go to free frames while there are
    /// some, then straight to swap; pages already in swap are copied slot to slot.
    pub fn clone_space(&mut self) -> Option<Space> {
        let id = self.sh.next_asid;
        self.sh.next_asid += 1;
        let mut table = HashMap::with_capacity(self.sh.table.len());
        let mut buf = vec![0u8; PAGE as usize];
        let entries: Vec<(u64, Pte)> = self.sh.table.iter().map(|(k, v)| (*k, *v)).collect();
        for (vpn, pte) in entries {
            if pte.frame != NONE {
                let src = pte.frame as usize * PAGE as usize;
                if let Some(f) = self.sh.free.pop() {
                    let dst = f as usize * PAGE as usize;
                    self.sh.pool.copy_within(src..src + PAGE as usize, dst);
                    self.sh.frames[f as usize] = Frame { vpn, used: true, referenced: false, dirty: true, asid: id };
                    table.insert(vpn, Pte { frame: f, slot: NONE });
                    continue;
                }
                buf.copy_from_slice(&self.sh.pool[src..src + PAGE as usize]);
            } else if pte.slot != NONE {
                unsafe { host_swap_read(pte.slot, buf.as_mut_ptr()); }
                self.sh.swap_ins += 1;
            } else { continue; }
            let slot = self.alloc_slot();
            unsafe { host_swap_write(slot, buf.as_ptr()); }
            self.sh.swap_outs += 1;
            table.insert(vpn, Pte { frame: NONE, slot });
        }
        self.sh.saved.insert(id, Saved { table, regions: self.sh.regions.clone(), committed: self.sh.committed });
        Some(Space { id })
    }
    fn release_table(&mut self, table: HashMap<u64, Pte>) {
        for (_, p) in table {
            if p.frame != NONE { self.sh.frames[p.frame as usize].used = false; self.sh.free.push(p.frame); }
            if p.slot != NONE { self.sh.free_slots.push(p.slot); }
        }
    }
    /// Frees every page of the current address space (exec, exit).
    pub fn free_space(&mut self) {
        self.flush_tlb();
        let t = std::mem::take(&mut self.sh.table);
        self.release_table(t);
        self.sh.regions.clear();
        self.sh.committed = 0;
    }
    /// Frees a saved address space (a process that ended while not running).
    pub fn free_saved(&mut self, sp: Space) {
        if let Some(sv) = self.sh.saved.remove(&sp.id) { self.release_table(sv.table); }
    }

    fn evict_one(&mut self) -> u32 {
        loop {
            let i = self.sh.hand;
            self.sh.hand = (self.sh.hand + 1) % self.sh.frames.len();
            let f = self.sh.frames[i];
            if !f.used { return i as u32; }
            let t = (f.vpn as usize) & (TLB_SIZE - 1);
            if f.referenced {
                // second chance; drop the TLB entry so the next access marks it again
                self.sh.frames[i].referenced = false;
                if self.tlb[t].tag == f.vpn { self.tlb[t].tag = u64::MAX; }
                continue;
            }
            let mine = f.asid == self.sh.cur;
            // pages of a parked space are in no TLB (every switch flushes)
            if mine { self.shoot(f.vpn); self.shoot_wait(); }
            let pool = self.sh.pool.as_ptr();
            let slot = {
                let table = if mine { Some(&mut self.sh.table) } else { self.sh.saved.get_mut(&f.asid).map(|s| &mut s.table) };
                match table.and_then(|t| t.get_mut(&f.vpn)) { Some(p) => p.slot, None => { self.sh.frames[i].used = false; return i as u32; } }
            };
            let need = f.dirty || slot == NONE;
            let slot = if slot == NONE { self.alloc_slot() } else { slot };
            if need {
                unsafe { host_swap_write(slot, pool.add(i * PAGE as usize)); }
                self.sh.swap_outs += 1;
            }
            let table = if mine { &mut self.sh.table } else { &mut self.sh.saved.get_mut(&f.asid).unwrap().table };
            let pte = table.get_mut(&f.vpn).unwrap();
            pte.slot = slot;
            pte.frame = NONE;
            self.sh.frames[i].used = false;
            return i as u32;
        }
    }

    fn get_frame(&mut self) -> Option<u32> {
        match self.sh.free.pop() {
            Some(f) => Some(f),
            // swap I/O needs the OPFS file, which only core 0's worker holds
            None if self.sh.no_evict || self.core != 0 => None,
            None => Some(self.evict_one()),
        }
    }

    #[cold]
    fn fill(&mut self, vpn: u64, write: bool) -> Result<usize, Fault> {
        let _g = crate::lock::lock();
        self.sh.faults += 1;
        let pte = match self.sh.table.get(&vpn) {
            Some(p) => *p,
            None => {
                if !self.in_region(vpn * PAGE) { return Err(Fault); }
                let p = Pte { frame: NONE, slot: NONE };
                self.sh.table.insert(vpn, p);
                p
            }
        };
        let frame = if pte.frame != NONE {
            pte.frame
        } else {
            let Some(f) = self.get_frame() else { return Err(Fault) };
            let off = f as usize * PAGE as usize;
            if pte.slot != NONE {
                unsafe { host_swap_read(pte.slot, self.sh.pool.as_mut_ptr().add(off)); }
                self.sh.swap_ins += 1;
            } else {
                self.sh.pool[off..off + PAGE as usize].fill(0);
            }
            self.sh.frames[f as usize] = Frame { vpn, used: true, referenced: false, dirty: false, asid: self.sh.cur };
            self.sh.table.get_mut(&vpn).unwrap().frame = f;
            f
        };
        let fr = &mut self.sh.frames[frame as usize];
        fr.referenced = true;
        if write { fr.dirty = true; }
        let off = frame as usize * PAGE as usize;
        self.tlb[(vpn as usize) & (TLB_SIZE - 1)] = TlbEntry { tag: vpn, off, writable: write || fr.dirty };
        Ok(off)
    }

    #[inline(always)]
    fn tr(&mut self, addr: u64, write: bool) -> Result<usize, Fault> {
        let vpn = addr >> 12;
        let e = self.tlb[(vpn as usize) & (TLB_SIZE - 1)];
        if e.tag == vpn && (!write || e.writable) {
            return Ok(e.off + (addr & 0xFFF) as usize);
        }
        Ok(self.fill(vpn, write)? + (addr & 0xFFF) as usize)
    }

    /// Aligned atomic load of N bytes at pool offset o.
    #[inline(always)]
    fn ld_atomic<const N: usize>(&self, o: usize) -> u64 {
        use core::sync::atomic::*;
        let p = unsafe { self.sh.pool.as_ptr().add(o) };
        unsafe { match N {
            1 => (*(p as *const AtomicU8)).load(SeqCst) as u64,
            2 => (*(p as *const AtomicU16)).load(SeqCst) as u64,
            4 => (*(p as *const AtomicU32)).load(SeqCst) as u64,
            _ => (*(p as *const AtomicU64)).load(SeqCst),
        } }
    }
    #[inline(always)]
    fn st_atomic<const N: usize>(&self, o: usize, v: u64) {
        use core::sync::atomic::*;
        let p = unsafe { self.sh.pool.as_ptr().add(o) };
        unsafe { match N {
            1 => (*(p as *const AtomicU8)).store(v as u8, SeqCst),
            2 => (*(p as *const AtomicU16)).store(v as u16, SeqCst),
            4 => (*(p as *const AtomicU32)).store(v as u32, SeqCst),
            _ => (*(p as *const AtomicU64)).store(v, SeqCst),
        } }
    }
    /// Compare-and-swap of N bytes at pool offset o; true = it was `old` and is now `new`.
    fn cas<const N: usize>(&self, o: usize, old: u64, new: u64) -> bool {
        use core::sync::atomic::*;
        let p = unsafe { self.sh.pool.as_ptr().add(o) };
        unsafe { match N {
            1 => (*(p as *const AtomicU8)).compare_exchange(old as u8, new as u8, SeqCst, SeqCst).is_ok(),
            2 => (*(p as *const AtomicU16)).compare_exchange(old as u16, new as u16, SeqCst, SeqCst).is_ok(),
            4 => (*(p as *const AtomicU32)).compare_exchange(old as u32, new as u32, SeqCst, SeqCst).is_ok(),
            _ => (*(p as *const AtomicU64)).compare_exchange(old, new, SeqCst, SeqCst).is_ok(),
        } }
    }

    #[inline(always)]
    fn rd<const N: usize>(&mut self, addr: u64) -> Result<u64, Fault> {
        if (addr & 0xFFF) as usize <= 4096 - N {
            let o = self.tr(addr, false)?;
            if crate::lock::MT && (self.lk != 0 || strong()) && o % N == 0 {
                let v = self.ld_atomic::<N>(o);
                if self.lk == 1 { self.lk = 2; self.lk_at = (addr, v, N); }
                return Ok(v);
            }
            let mut b = [0u8; 8];
            b[..N].copy_from_slice(&self.sh.pool[o..o + N]);
            Ok(u64::from_le_bytes(b))
        } else {
            let mut v = 0u64;
            for i in 0..N { v |= (self.read8(addr + i as u64)? as u64) << (8 * i); }
            Ok(v)
        }
    }

    #[inline(always)]
    fn wr<const N: usize>(&mut self, addr: u64, v: u64) -> Result<(), Fault> {
        if (addr & 0xFFF) as usize <= 4096 - N {
            let o = self.tr(addr, true)?;
            if crate::lock::MT && (self.lk != 0 || strong()) && o % N == 0 {
                match self.lk {
                    3 => return Ok(()), // lost the race: nothing more is written
                    2 if self.lk_at.0 == addr && self.lk_at.2 == N => {
                        // the locked read-modify-write: only if no other core changed it meanwhile
                        self.lk = if self.cas::<N>(o, self.lk_at.1, v) { 4 } else { 3 };
                        return Ok(());
                    }
                    _ => { self.st_atomic::<N>(o, v); return Ok(()); }
                }
            }
            self.sh.pool[o..o + N].copy_from_slice(&v.to_le_bytes()[..N]);
            Ok(())
        } else {
            for i in 0..N { self.write8(addr + i as u64, (v >> (8 * i)) as u8)?; }
            Ok(())
        }
    }

    #[inline(always)]
    pub fn read8(&mut self, a: u64) -> Result<u8, Fault> {
        if crate::lock::MT && (self.lk != 0 || strong()) { return Ok(self.rd::<1>(a)? as u8); }
        let o = self.tr(a, false)?; Ok(self.sh.pool[o])
    }
    #[inline(always)]
    pub fn write8(&mut self, a: u64, v: u8) -> Result<(), Fault> {
        if crate::lock::MT && (self.lk != 0 || strong()) { return self.wr::<1>(a, v as u64); }
        let o = self.tr(a, true)?; self.sh.pool[o] = v; Ok(())
    }
    pub fn read16(&mut self, a: u64) -> Result<u16, Fault> { Ok(self.rd::<2>(a)? as u16) }
    pub fn read32(&mut self, a: u64) -> Result<u32, Fault> { Ok(self.rd::<4>(a)? as u32) }
    pub fn read64(&mut self, a: u64) -> Result<u64, Fault> { self.rd::<8>(a) }
    pub fn write16(&mut self, a: u64, v: u16) -> Result<(), Fault> { self.wr::<2>(a, v as u64) }
    pub fn write32(&mut self, a: u64, v: u32) -> Result<(), Fault> { self.wr::<4>(a, v as u64) }
    pub fn write64(&mut self, a: u64, v: u64) -> Result<(), Fault> { self.wr::<8>(a, v) }

    pub fn read_sized(&mut self, a: u64, size: u32) -> Result<u64, Fault> {
        match size { 8 => Ok(self.read8(a)? as u64), 16 => self.rd::<2>(a), 32 => self.rd::<4>(a), _ => self.rd::<8>(a) }
    }
    pub fn write_sized(&mut self, a: u64, size: u32, v: u64) -> Result<(), Fault> {
        match size { 8 => self.write8(a, v as u8), 16 => self.wr::<2>(a, v), 32 => self.wr::<4>(a, v), _ => self.wr::<8>(a, v) }
    }

    /// Address in wasm memory of a program byte (for Wine code compiled to wasm).
    #[inline(always)]
    pub fn host_addr(&mut self, a: u64, write: bool) -> Result<u64, Fault> {
        let o = self.tr(a, write)?;
        Ok(self.sh.pool.as_ptr() as u64 + o as u64)
    }

    /// Bulk copy into program memory, one page at a time.
    pub fn write_bytes(&mut self, mut a: u64, mut data: &[u8]) -> Result<(), Fault> {
        while !data.is_empty() {
            let room = (4096 - (a & 0xFFF) as usize).min(data.len());
            let o = self.tr(a, true)?;
            self.sh.pool[o..o + room].copy_from_slice(&data[..room]);
            a += room as u64;
            data = &data[room..];
        }
        Ok(())
    }
    pub fn read_bytes(&mut self, mut a: u64, out: &mut [u8]) -> Result<(), Fault> {
        let mut k = 0;
        while k < out.len() {
            let room = (4096 - (a & 0xFFF) as usize).min(out.len() - k);
            let o = self.tr(a, false)?;
            out[k..k + room].copy_from_slice(&self.sh.pool[o..o + room]);
            a += room as u64;
            k += room;
        }
        Ok(())
    }

    /// Copies up to 16 instruction bytes starting at `a` (stops at a bad page).
    pub fn fetch16(&mut self, a: u64, out: &mut [u8; 16]) -> Result<(), Fault> {
        let room = 4096 - (a & 0xFFF) as usize;
        let o = self.tr(a, false)?;
        if room >= 16 {
            out.copy_from_slice(&self.sh.pool[o..o + 16]);
        } else {
            out[..room].copy_from_slice(&self.sh.pool[o..o + room]);
            if let Ok(o2) = self.tr(a + room as u64, false) {
                out[room..].copy_from_slice(&self.sh.pool[o2..o2 + 16 - room]);
            }
        }
        Ok(())
    }
}
