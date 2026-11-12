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
const NONE: u32 = u32::MAX;
const TLB_SIZE: usize = 1024;

#[derive(Clone, Copy)]
struct Pte { frame: u32, slot: u32 }

#[derive(Clone, Copy)]
struct Frame { vpn: u64, used: bool, referenced: bool, dirty: bool }

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
}

/// One core's view: its own TLB over the shared page table.
pub struct Mmu {
    tlb: Vec<TlbEntry>,
    pub sh: &'static mut MmuShared,
}

impl Mmu {
    pub fn new(pool_mb: usize, target_mb: u64) -> Mmu {
        let n = pool_mb * 256;
        let sh = Box::leak(Box::new(MmuShared {
            pool: vec![0u8; n * PAGE as usize],
            frames: vec![Frame { vpn: 0, used: false, referenced: false, dirty: false }; n],
            free: (0..n as u32).rev().collect(),
            hand: 0,
            table: HashMap::new(),
            regions: Vec::new(),
            committed: 0,
            target_bytes: target_mb << 20,
            faults: 0, swap_ins: 0, swap_outs: 0, swap_slots: 0,
        }));
        Mmu { tlb: vec![TlbEntry { tag: u64::MAX, off: 0, writable: false }; TLB_SIZE], sh }
    }

    /// Another core's view of the same memory (empty TLB).
    pub fn new_core(&self) -> Mmu {
        let sh = unsafe { &mut *(self.sh as *const MmuShared as *mut MmuShared) };
        Mmu { tlb: vec![TlbEntry { tag: u64::MAX, off: 0, writable: false }; TLB_SIZE], sh }
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
        for vpn in vpns {
            let pte = self.sh.table.remove(&vpn).unwrap();
            let t = (vpn as usize) & (TLB_SIZE - 1);
            if self.tlb[t].tag == vpn { self.tlb[t].tag = u64::MAX; }
            if pte.frame != NONE {
                self.sh.frames[pte.frame as usize].used = false;
                self.sh.free.push(pte.frame);
            }
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
            if self.tlb[t].tag == f.vpn { self.tlb[t].tag = u64::MAX; }
            let pte = self.sh.table.get_mut(&f.vpn).unwrap();
            if f.dirty || pte.slot == NONE {
                if pte.slot == NONE { pte.slot = self.sh.swap_slots; self.sh.swap_slots += 1; }
                unsafe { host_swap_write(pte.slot, self.sh.pool.as_ptr().add(i * PAGE as usize)); }
                self.sh.swap_outs += 1;
            }
            pte.frame = NONE;
            self.sh.frames[i].used = false;
            return i as u32;
        }
    }

    fn get_frame(&mut self) -> Option<u32> {
        match self.sh.free.pop() {
            Some(f) => Some(f),
            // other cores may hold this frame in their TLB: no swap with several cores (yet)
            None if crate::lock::MT => None,
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
            self.sh.frames[f as usize] = Frame { vpn, used: true, referenced: false, dirty: false };
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

    #[inline(always)]
    fn rd<const N: usize>(&mut self, addr: u64) -> Result<u64, Fault> {
        if (addr & 0xFFF) as usize <= 4096 - N {
            let o = self.tr(addr, false)?;
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
            self.sh.pool[o..o + N].copy_from_slice(&v.to_le_bytes()[..N]);
            Ok(())
        } else {
            for i in 0..N { self.write8(addr + i as u64, (v >> (8 * i)) as u8)?; }
            Ok(())
        }
    }

    #[inline(always)]
    pub fn read8(&mut self, a: u64) -> Result<u8, Fault> { let o = self.tr(a, false)?; Ok(self.sh.pool[o]) }
    #[inline(always)]
    pub fn write8(&mut self, a: u64, v: u8) -> Result<(), Fault> { let o = self.tr(a, true)?; self.sh.pool[o] = v; Ok(()) }
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
