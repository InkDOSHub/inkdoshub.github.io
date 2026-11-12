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

#[derive(Clone, Copy)]
struct TlbEntry { tag: u64, off: usize, writable: bool }

pub struct Fault;

pub struct Mmu {
    pool: Vec<u8>,
    frames: Vec<Frame>,
    free: Vec<u32>,
    hand: usize,
    table: HashMap<u64, Pte>,
    regions: Vec<(u64, u64)>,
    tlb: Vec<TlbEntry>,
    pub committed: u64,
    pub target_bytes: u64,
    pub faults: u64,
    pub swap_ins: u64,
    pub swap_outs: u64,
    pub swap_slots: u32,
}

impl Mmu {
    pub fn new(pool_mb: usize, target_mb: u64) -> Mmu {
        let n = pool_mb * 256;
        Mmu {
            pool: vec![0u8; n * PAGE as usize],
            frames: vec![Frame { vpn: 0, used: false, referenced: false, dirty: false }; n],
            free: (0..n as u32).rev().collect(),
            hand: 0,
            table: HashMap::new(),
            regions: Vec::new(),
            tlb: vec![TlbEntry { tag: u64::MAX, off: 0, writable: false }; TLB_SIZE],
            committed: 0,
            target_bytes: target_mb << 20,
            faults: 0, swap_ins: 0, swap_outs: 0, swap_slots: 0,
        }
    }

    pub fn frames_total(&self) -> usize { self.frames.len() }
    pub fn resident(&self) -> usize { self.frames.len() - self.free.len() }

    pub fn add_region(&mut self, start: u64, size: u64) {
        self.regions.push((start, start + size));
        self.committed += size;
    }

    fn in_region(&self, addr: u64) -> bool {
        self.regions.iter().any(|&(s, e)| addr >= s && addr < e)
    }

    fn evict_one(&mut self) -> u32 {
        loop {
            let i = self.hand;
            self.hand = (self.hand + 1) % self.frames.len();
            let f = self.frames[i];
            if !f.used { return i as u32; }
            let t = (f.vpn as usize) & (TLB_SIZE - 1);
            if f.referenced {
                // second chance; drop the TLB entry so the next access marks it again
                self.frames[i].referenced = false;
                if self.tlb[t].tag == f.vpn { self.tlb[t].tag = u64::MAX; }
                continue;
            }
            if self.tlb[t].tag == f.vpn { self.tlb[t].tag = u64::MAX; }
            let pte = self.table.get_mut(&f.vpn).unwrap();
            if f.dirty || pte.slot == NONE {
                if pte.slot == NONE { pte.slot = self.swap_slots; self.swap_slots += 1; }
                unsafe { host_swap_write(pte.slot, self.pool.as_ptr().add(i * PAGE as usize)); }
                self.swap_outs += 1;
            }
            pte.frame = NONE;
            self.frames[i].used = false;
            return i as u32;
        }
    }

    fn get_frame(&mut self) -> u32 {
        match self.free.pop() { Some(f) => f, None => self.evict_one() }
    }

    #[cold]
    fn fill(&mut self, vpn: u64, write: bool) -> Result<usize, Fault> {
        self.faults += 1;
        let pte = match self.table.get(&vpn) {
            Some(p) => *p,
            None => {
                if !self.in_region(vpn * PAGE) { return Err(Fault); }
                let p = Pte { frame: NONE, slot: NONE };
                self.table.insert(vpn, p);
                p
            }
        };
        let frame = if pte.frame != NONE {
            pte.frame
        } else {
            let f = self.get_frame();
            let off = f as usize * PAGE as usize;
            if pte.slot != NONE {
                unsafe { host_swap_read(pte.slot, self.pool.as_mut_ptr().add(off)); }
                self.swap_ins += 1;
            } else {
                self.pool[off..off + PAGE as usize].fill(0);
            }
            self.frames[f as usize] = Frame { vpn, used: true, referenced: false, dirty: false };
            self.table.get_mut(&vpn).unwrap().frame = f;
            f
        };
        let fr = &mut self.frames[frame as usize];
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
            b[..N].copy_from_slice(&self.pool[o..o + N]);
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
            self.pool[o..o + N].copy_from_slice(&v.to_le_bytes()[..N]);
            Ok(())
        } else {
            for i in 0..N { self.write8(addr + i as u64, (v >> (8 * i)) as u8)?; }
            Ok(())
        }
    }

    #[inline(always)]
    pub fn read8(&mut self, a: u64) -> Result<u8, Fault> { let o = self.tr(a, false)?; Ok(self.pool[o]) }
    #[inline(always)]
    pub fn write8(&mut self, a: u64, v: u8) -> Result<(), Fault> { let o = self.tr(a, true)?; self.pool[o] = v; Ok(()) }
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

    /// Copies up to 16 instruction bytes starting at `a` (stops at a bad page).
    pub fn fetch16(&mut self, a: u64, out: &mut [u8; 16]) -> Result<(), Fault> {
        let room = 4096 - (a & 0xFFF) as usize;
        let o = self.tr(a, false)?;
        if room >= 16 {
            out.copy_from_slice(&self.pool[o..o + 16]);
        } else {
            out[..room].copy_from_slice(&self.pool[o..o + room]);
            if let Ok(o2) = self.tr(a + room as u64, false) {
                out[room..].copy_from_slice(&self.pool[o2..o2 + 16 - room]);
            }
        }
        Ok(())
    }
}
