// x86-64 interpreter (general-purpose integer subset). Registers live in a
// plain struct in memory (never on the native stack), so a thread can be
// parked and resumed at any instruction boundary.

use crate::Engine;

pub struct Cpu {
    pub regs: [u64; 16],
    pub rip: u64,
    pub cf: bool, pub zf: bool, pub sf: bool, pub of: bool, pub pf: bool, pub df: bool,
    pub icount: u64,
    pub xmm: [u128; 16],
    pub gs_base: u64,
    pub fs_base: u64,
    pub seg: u64, // segment base of the current instruction (fs:/gs: prefix)
}

impl Cpu {
    pub fn new() -> Cpu {
        Cpu { regs: [0; 16], rip: 0, cf: false, zf: false, sf: false, of: false, pf: false, df: false, icount: 0, xmm: [0; 16], gs_base: 0, fs_base: 0, seg: 0 }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Loc { Reg(u8, bool), Mem(u64) }

pub(crate) struct ModRm { pub md: u8, pub reg: u8, pub rm: u8, base: Option<u8>, index: Option<u8>, scale: u8, disp: i64, riprel: bool }

pub(crate) struct Dec<'a> { pub b: &'a [u8; 16], pub p: usize }
impl<'a> Dec<'a> {
    pub fn u8(&mut self) -> u8 { let v = self.b[self.p.min(15)]; self.p += 1; v }
    pub fn i8(&mut self) -> i64 { self.u8() as i8 as i64 }
    fn i16(&mut self) -> i64 { let v = u16::from_le_bytes([self.u8(), self.u8()]); v as i16 as i64 }
    pub fn i32(&mut self) -> i64 { let v = u32::from_le_bytes([self.u8(), self.u8(), self.u8(), self.u8()]); v as i32 as i64 }
    pub fn u64_full(&mut self) -> u64 { self.u64() }
    fn u64(&mut self) -> u64 { let lo = self.i32() as u32 as u64; let hi = self.i32() as u32 as u64; lo | hi << 32 }
    pub fn imm(&mut self, size: u32) -> u64 {
        match size { 8 => self.i8() as u64, 16 => self.i16() as u64, _ => self.i32() as u64 }
    }
}

#[inline(always)]
pub(crate) fn mask(size: u32) -> u64 { if size == 64 { u64::MAX } else { (1u64 << size) - 1 } }
#[inline(always)]
fn sign(size: u32) -> u64 { 1u64 << (size - 1) }
#[inline(always)]
pub(crate) fn sx(v: u64, size: u32) -> i64 { let s = 64 - size; ((v << s) as i64) >> s }

macro_rules! tryf {
    ($e:expr, $x:expr, $addr:expr) => {
        match $x { Ok(v) => v, Err(_) => { $e.fault($addr); return; } }
    };
}

/// Executes up to `n` instructions; returns how many ran.
pub fn step_block(e: &mut Engine, n: u64) -> u64 {
    let mut done = 0;
    while done < n && !e.exited && e.error.is_none() {
        if e.cpu.rip >= crate::THUNK_BASE { break; }
        step(e);
        done += 1;
    }
    e.cpu.icount += done;
    done
}

impl Engine {
    pub(crate) fn get(&mut self, l: Loc, size: u32) -> Result<u64, ()> {
        match l {
            Loc::Reg(r, hi) => {
                let v = self.cpu.regs[r as usize];
                Ok(if hi { (v >> 8) & 0xFF } else { v & mask(size) })
            }
            Loc::Mem(a) => self.mmu.read_sized(a, size).map_err(|_| self.fault(a)),
        }
    }
    pub(crate) fn set(&mut self, l: Loc, size: u32, v: u64) -> Result<(), ()> {
        match l {
            Loc::Reg(r, hi) => {
                let r = &mut self.cpu.regs[r as usize];
                *r = match (size, hi) {
                    (8, true) => (*r & !0xFF00) | ((v & 0xFF) << 8),
                    (8, false) => (*r & !0xFF) | (v & 0xFF),
                    (16, _) => (*r & !0xFFFF) | (v & 0xFFFF),
                    (32, _) => v & 0xFFFF_FFFF,
                    _ => v,
                };
                Ok(())
            }
            Loc::Mem(a) => self.mmu.write_sized(a, size, v).map_err(|_| self.fault(a)),
        }
    }
    pub(crate) fn push(&mut self, v: u64) -> Result<(), ()> {
        let sp = self.cpu.regs[4].wrapping_sub(8);
        self.mmu.write64(sp, v).map_err(|_| self.fault(sp))?;
        self.cpu.regs[4] = sp;
        Ok(())
    }
    pub(crate) fn pop(&mut self) -> Result<u64, ()> {
        let sp = self.cpu.regs[4];
        let v = self.mmu.read64(sp).map_err(|_| self.fault(sp))?;
        self.cpu.regs[4] = sp + 8;
        Ok(v)
    }

    pub(crate) fn szp(&mut self, r: u64, size: u32) {
        let c = &mut self.cpu;
        c.zf = r & mask(size) == 0;
        c.sf = r & sign(size) != 0;
        c.pf = (r as u8).count_ones() % 2 == 0;
    }

    pub(crate) fn alu(&mut self, op: u8, a: u64, b: u64, size: u32) -> u64 {
        let m = mask(size);
        let (a, b) = (a & m, b & m);
        let r = match op {
            0 => { let r = a.wrapping_add(b) & m; self.cpu.cf = r < a; self.cpu.of = (a ^ r) & (b ^ r) & sign(size) != 0; r }
            1 => { self.cpu.cf = false; self.cpu.of = false; a | b }
            2 => {
                let c = self.cpu.cf as u128;
                let w = a as u128 + b as u128 + c;
                let r = (w as u64) & m;
                self.cpu.cf = w > m as u128;
                self.cpu.of = (a ^ r) & (b ^ r) & sign(size) != 0; r
            }
            3 => {
                let c = self.cpu.cf as u128;
                let r = (a.wrapping_sub(b).wrapping_sub(c as u64)) & m;
                self.cpu.cf = (a as u128) < b as u128 + c;
                self.cpu.of = (a ^ b) & (a ^ r) & sign(size) != 0; r
            }
            4 => { self.cpu.cf = false; self.cpu.of = false; a & b }
            5 | 7 => { let r = a.wrapping_sub(b) & m; self.cpu.cf = a < b; self.cpu.of = (a ^ b) & (a ^ r) & sign(size) != 0; r }
            _ => { self.cpu.cf = false; self.cpu.of = false; a ^ b }
        };
        self.szp(r, size);
        r
    }

    pub(crate) fn cond(&self, cc: u8) -> bool {
        let c = &self.cpu;
        let r = match cc >> 1 {
            0 => c.of, 1 => c.cf, 2 => c.zf, 3 => c.cf || c.zf,
            4 => c.sf, 5 => c.pf, 6 => c.sf != c.of, _ => c.zf || (c.sf != c.of),
        };
        if cc & 1 == 1 { !r } else { r }
    }

    pub(crate) fn flags(&self) -> u64 {
        let c = &self.cpu;
        2 | c.cf as u64 | (c.pf as u64) << 2 | (c.zf as u64) << 6 | (c.sf as u64) << 7 | 1 << 9 | (c.df as u64) << 10 | (c.of as u64) << 11
    }
    pub(crate) fn set_flags(&mut self, f: u64) {
        let c = &mut self.cpu;
        c.cf = f & 1 != 0; c.pf = f & 4 != 0; c.zf = f & 0x40 != 0; c.sf = f & 0x80 != 0; c.df = f & 0x400 != 0; c.of = f & 0x800 != 0;
    }
    pub(crate) fn unsupported(&mut self, b: &[u8; 16]) {
        self.error = Some(format!("unsupported instruction at 0x{:x}: {:02x?}", self.cpu.rip, &b[..8]));
    }
}

pub(crate) fn modrm(d: &mut Dec, e: &Engine, rex: u8) -> ModRm {
    let m = d.u8();
    let md = m >> 6;
    let reg = ((m >> 3) & 7) | ((rex & 4) << 1);
    let rm_low = m & 7;
    let mut r = ModRm { md, reg, rm: rm_low | ((rex & 1) << 3), base: None, index: None, scale: 0, disp: 0, riprel: false };
    if md == 3 { return r; }
    if rm_low == 4 {
        let s = d.u8();
        r.scale = s >> 6;
        let idx = ((s >> 3) & 7) | ((rex & 2) << 2);
        if idx != 4 { r.index = Some(idx); }
        let b = (s & 7) | ((rex & 1) << 3);
        if (s & 7) == 5 && md == 0 { r.disp = d.i32(); } else { r.base = Some(b); }
    } else if rm_low == 5 && md == 0 {
        r.riprel = true;
        r.disp = d.i32();
    } else {
        r.base = Some(r.rm);
    }
    if md == 1 { r.disp = d.i8(); } else if md == 2 { r.disp = d.i32(); }
    let _ = e;
    r
}

pub(crate) fn ea(e: &Engine, m: &ModRm, next: u64) -> u64 {
    if m.riprel { return next.wrapping_add(m.disp as u64).wrapping_add(e.cpu.seg); }
    let mut a = (m.disp as u64).wrapping_add(e.cpu.seg);
    if let Some(b) = m.base { a = a.wrapping_add(e.cpu.regs[b as usize]); }
    if let Some(i) = m.index { a = a.wrapping_add(e.cpu.regs[i as usize] << m.scale); }
    a
}

pub(crate) fn rm_loc(e: &Engine, m: &ModRm, next: u64, size: u32, rex: u8) -> Loc {
    if m.md == 3 { reg_loc(m.rm, size, rex) } else { Loc::Mem(ea(e, m, next)) }
}
pub(crate) fn reg_loc(r: u8, size: u32, rex: u8) -> Loc {
    if size == 8 && rex == 0 && (4..8).contains(&r) { Loc::Reg(r - 4, true) } else { Loc::Reg(r, false) }
}

macro_rules! g { ($e:expr, $x:expr) => { match $x { Ok(v) => v, Err(_) => return } } }

fn step(e: &mut Engine) {
    let mut buf = [0u8; 16];
    let rip = e.cpu.rip;
    tryf!(e, e.mmu.fetch16(rip, &mut buf), rip);
    let mut d = Dec { b: &buf, p: 0 };
    let mut rex = 0u8;
    let mut opsize16 = false;
    let mut rep = 0u8;
    let mut op;
    e.cpu.seg = 0;
    let mut p66 = false;
    loop {
        op = d.u8();
        match op {
            0x66 => { opsize16 = true; p66 = true; }
            0xF2 | 0xF3 => rep = op,
            0x64 => e.cpu.seg = e.cpu.fs_base,
            0x65 => e.cpu.seg = e.cpu.gs_base,
            0x2E | 0x3E | 0x26 | 0x36 | 0x67 | 0xF0 => {}
            _ => break,
        }
    }
    if (0x40..0x50).contains(&op) { rex = op; op = d.u8(); }
    let w = rex & 8 != 0;
    let osz: u32 = if w { 64 } else if opsize16 { 16 } else { 32 };

    match op {
        // ALU r/m,r ; r,r/m ; acc,imm
        0x00..=0x3F if op & 7 < 6 => {
            let aop = op >> 3;
            let size = if op & 1 == 0 { 8 } else { osz };
            match op & 7 {
                0..=3 => {
                    let m = modrm(&mut d, e, rex);
                    let next = rip + d.p as u64;
                    let rmv = rm_loc(e, &m, next, size, rex);
                    let rg = reg_loc(m.reg, size, rex);
                    let (dst, src) = if op & 2 == 0 { (rmv, rg) } else { (rg, rmv) };
                    let a = g!(e, e.get(dst, size));
                    let b = g!(e, e.get(src, size));
                    let r = e.alu(aop, a, b, size);
                    e.cpu.rip = next;
                    if aop != 7 { g!(e, e.set(dst, size, r)); }
                }
                _ => {
                    let imm = d.imm(size);
                    let next = rip + d.p as u64;
                    let a = e.cpu.regs[0];
                    let r = e.alu(aop, a, imm, size);
                    e.cpu.rip = next;
                    if aop != 7 { g!(e, e.set(Loc::Reg(0, false), size, r)); }
                }
            }
        }
        0x50..=0x57 => { let v = e.cpu.regs[((op & 7) | ((rex & 1) << 3)) as usize]; e.cpu.rip = rip + d.p as u64; g!(e, e.push(v)); }
        0x58..=0x5F => { let v = g!(e, e.pop()); e.cpu.regs[((op & 7) | ((rex & 1) << 3)) as usize] = v; e.cpu.rip = rip + d.p as u64; }
        0x63 => {
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            let v = g!(e, e.get(rm_loc(e, &m, next, 32, rex), 32));
            let v = if w { sx(v, 32) as u64 } else { v };
            e.cpu.rip = next;
            g!(e, e.set(Loc::Reg(m.reg, false), osz, v));
        }
        0x68 | 0x6A => {
            let v = if op == 0x68 { d.i32() } else { d.i8() } as u64;
            e.cpu.rip = rip + d.p as u64;
            g!(e, e.push(v));
        }
        0x69 | 0x6B => {
            let m = modrm(&mut d, e, rex);
            let imm = if op == 0x69 { d.imm(if osz == 16 { 16 } else { 32 }) } else { d.i8() as u64 };
            let next = rip + d.p as u64;
            let a = g!(e, e.get(rm_loc(e, &m, next, osz, rex), osz));
            imul_set(e, m.reg, a, imm, osz);
            e.cpu.rip = next;
        }
        0x70..=0x7F => {
            let rel = d.i8();
            let next = rip + d.p as u64;
            e.cpu.rip = if e.cond(op & 15) { next.wrapping_add(rel as u64) } else { next };
        }
        0x80 | 0x81 | 0x83 => {
            let size = if op == 0x80 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let imm = if op == 0x81 { d.imm(size) } else { d.i8() as u64 };
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let a = g!(e, e.get(l, size));
            let aop = m.reg & 7;
            let r = e.alu(aop, a, imm, size);
            e.cpu.rip = next;
            if aop != 7 { g!(e, e.set(l, size, r)); }
        }
        0x84 | 0x85 => {
            let size = if op == 0x84 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            let a = g!(e, e.get(rm_loc(e, &m, next, size, rex), size));
            let b = g!(e, e.get(reg_loc(m.reg, size, rex), size));
            e.alu(4, a, b, size);
            e.cpu.rip = next;
        }
        0x86 | 0x87 => {
            let size = if op == 0x86 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let rg = reg_loc(m.reg, size, rex);
            let a = g!(e, e.get(l, size));
            let b = g!(e, e.get(rg, size));
            g!(e, e.set(l, size, b));
            g!(e, e.set(rg, size, a));
            e.cpu.rip = next;
        }
        0x88..=0x8B => {
            let size = if op & 1 == 0 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let rg = reg_loc(m.reg, size, rex);
            if op & 2 == 0 { let v = g!(e, e.get(rg, size)); g!(e, e.set(l, size, v)); }
            else { let v = g!(e, e.get(l, size)); g!(e, e.set(rg, size, v)); }
            e.cpu.rip = next;
        }
        0x8D => {
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            e.cpu.seg = 0;
            let a = ea(e, &m, next);
            g!(e, e.set(Loc::Reg(m.reg, false), osz, a));
            e.cpu.rip = next;
        }
        0x8F => {
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            let v = g!(e, e.pop());
            g!(e, e.set(rm_loc(e, &m, next, 64, rex), 64, v));
            e.cpu.rip = next;
        }
        0x90..=0x97 => {
            let r = ((op & 7) | ((rex & 1) << 3)) as usize;
            if r != 0 {
                let a = e.cpu.regs[0]; let b = e.cpu.regs[r];
                let _ = e.set(Loc::Reg(0, false), osz, b);
                let _ = e.set(Loc::Reg(r as u8, false), osz, a);
            }
            e.cpu.rip = rip + d.p as u64;
        }
        0x98 => {
            let a = e.cpu.regs[0];
            let v = match osz { 64 => sx(a, 32) as u64, 32 => sx(a, 16) as u64 & 0xFFFF_FFFF, _ => sx(a, 8) as u64 & 0xFFFF };
            let _ = e.set(Loc::Reg(0, false), osz, v);
            e.cpu.rip = rip + d.p as u64;
        }
        0x99 => {
            let neg = e.cpu.regs[0] & sign(osz) != 0;
            let _ = e.set(Loc::Reg(2, false), osz, if neg { u64::MAX } else { 0 });
            e.cpu.rip = rip + d.p as u64;
        }
        0xA8 | 0xA9 => {
            let size = if op == 0xA8 { 8 } else { osz };
            let imm = d.imm(size);
            let a = e.cpu.regs[0];
            e.alu(4, a, imm, size);
            e.cpu.rip = rip + d.p as u64;
        }
        0xA4 | 0xA5 | 0xAA | 0xAB => {
            let size = if op & 1 == 0 { 8 } else { osz };
            let step = (size / 8) as u64;
            let step = if e.cpu.df { step.wrapping_neg() } else { step };
            loop {
                if rep != 0 && e.cpu.regs[1] == 0 { break; }
                if op >= 0xAA {
                    let v = e.cpu.regs[0]; let di = e.cpu.regs[7];
                    tryf!(e, e.mmu.write_sized(di, size, v), di);
                } else {
                    let si = e.cpu.regs[6]; let di = e.cpu.regs[7];
                    let v = tryf!(e, e.mmu.read_sized(si, size), si);
                    tryf!(e, e.mmu.write_sized(di, size, v), di);
                    e.cpu.regs[6] = si.wrapping_add(step);
                }
                e.cpu.regs[7] = e.cpu.regs[7].wrapping_add(step);
                if rep == 0 { break; }
                e.cpu.regs[1] -= 1;
            }
            e.cpu.rip = rip + d.p as u64;
        }
        0xB0..=0xB7 => {
            let v = d.u8() as u64;
            let _ = e.set(reg_loc((op & 7) | ((rex & 1) << 3), 8, rex), 8, v);
            e.cpu.rip = rip + d.p as u64;
        }
        0xB8..=0xBF => {
            let v = if w { d.u64() } else { d.imm(osz) & mask(osz) };
            let _ = e.set(Loc::Reg((op & 7) | ((rex & 1) << 3), false), osz, v);
            e.cpu.rip = rip + d.p as u64;
        }
        0xC0 | 0xC1 | 0xD0 | 0xD1 | 0xD2 | 0xD3 => {
            let size = if op & 1 == 0 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let cnt = match op { 0xC0 | 0xC1 => d.u8() as u32, 0xD0 | 0xD1 => 1, _ => e.cpu.regs[1] as u32 };
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let a = g!(e, e.get(l, size));
            let c = cnt & if size == 64 { 63 } else { 31 };
            e.cpu.rip = next;
            if c == 0 { return; }
            let msk = mask(size);
            let r = match m.reg & 7 {
                0 => { let c = c % size; let r = if c == 0 { a } else { ((a << c) | (a >> (size - c))) & msk }; e.cpu.cf = r & 1 != 0; r }
                1 => { let c = c % size; let r = if c == 0 { a } else { ((a >> c) | (a << (size - c))) & msk }; e.cpu.cf = r & sign(size) != 0; r }
                4 | 6 => {
                    let r = if c >= size { 0 } else { (a << c) & msk };
                    e.cpu.cf = if c <= size { (a >> (size - c)) & 1 != 0 } else { false };
                    e.szp(r, size);
                    e.cpu.of = (r & sign(size) != 0) != e.cpu.cf;
                    r
                }
                5 => { let r = a >> c; e.cpu.cf = (a >> (c - 1)) & 1 != 0; e.szp(r, size); e.cpu.of = a & sign(size) != 0; r }
                7 => { let s = sx(a, size); let r = (s >> c) as u64 & msk; e.cpu.cf = (s >> (c - 1)) & 1 != 0; e.szp(r, size); e.cpu.of = false; r }
                _ => { e.unsupported(&buf); return; }
            };
            g!(e, e.set(l, size, r));
        }
        0xC2 | 0xC3 => {
            let extra = if op == 0xC2 { d.i16() as u16 as u64 } else { 0 };
            let r = g!(e, e.pop());
            e.cpu.regs[4] += extra;
            e.cpu.rip = r;
        }
        0xC6 | 0xC7 => {
            let size = if op == 0xC6 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let imm = d.imm(size);
            let next = rip + d.p as u64;
            g!(e, e.set(rm_loc(e, &m, next, size, rex), size, imm & mask(size)));
            e.cpu.rip = next;
        }
        0xC9 => {
            e.cpu.regs[4] = e.cpu.regs[5];
            let v = g!(e, e.pop());
            e.cpu.regs[5] = v;
            e.cpu.rip = rip + d.p as u64;
        }
        0xE8 => {
            let rel = d.i32();
            let next = rip + d.p as u64;
            g!(e, e.push(next));
            e.cpu.rip = next.wrapping_add(rel as u64);
        }
        0xE9 => { let rel = d.i32(); e.cpu.rip = (rip + d.p as u64).wrapping_add(rel as u64); }
        0xEB => { let rel = d.i8(); e.cpu.rip = (rip + d.p as u64).wrapping_add(rel as u64); }
        0xF6 | 0xF7 => {
            let size = if op == 0xF6 { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let sub = m.reg & 7;
            let imm = if sub < 2 { d.imm(size) } else { 0 };
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let a = g!(e, e.get(l, size));
            e.cpu.rip = next;
            match sub {
                0 | 1 => { e.alu(4, a, imm, size); }
                2 => { g!(e, e.set(l, size, !a & mask(size))); }
                3 => { let r = e.alu(5, 0, a, size); g!(e, e.set(l, size, r)); }
                4..=7 => { if !muldiv(e, sub, a, size) { e.cpu.rip = rip; } }
                _ => {}
            }
        }
        0xFE | 0xFF => {
            let size = if op == 0xFE { 8 } else { osz };
            let m = modrm(&mut d, e, rex);
            let next = rip + d.p as u64;
            let sub = m.reg & 7;
            match sub {
                0 | 1 => {
                    let l = rm_loc(e, &m, next, size, rex);
                    let a = g!(e, e.get(l, size));
                    let cf = e.cpu.cf;
                    let r = e.alu(if sub == 0 { 0 } else { 5 }, a, 1, size);
                    e.cpu.cf = cf;
                    g!(e, e.set(l, size, r));
                    e.cpu.rip = next;
                }
                2 | 4 | 6 => {
                    let t = g!(e, e.get(rm_loc(e, &m, next, 64, rex), 64));
                    match sub {
                        2 => { g!(e, e.push(next)); e.cpu.rip = t; }
                        4 => e.cpu.rip = t,
                        _ => { g!(e, e.push(t)); e.cpu.rip = next; }
                    }
                }
                _ => e.unsupported(&buf),
            }
        }
        0xCC => { e.error = Some(format!("breakpoint at 0x{:x}", rip)); }
        0x9C => { let f = e.flags(); e.cpu.rip = rip + d.p as u64; g!(e, e.push(f)); }
        0x9D => { let f = g!(e, e.pop()); e.set_flags(f); e.cpu.rip = rip + d.p as u64; }
        0x9E => { let ah = (e.cpu.regs[0] >> 8) & 0xFF; let f = (e.flags() & !0xFF) | ah; e.set_flags(f); e.cpu.rip = rip + d.p as u64; }
        0x9F => { let f = e.flags() & 0xFF; e.cpu.regs[0] = (e.cpu.regs[0] & !0xFF00) | (f << 8); e.cpu.rip = rip + d.p as u64; }
        0x9B => { e.cpu.rip = rip + d.p as u64; }
        0xF5 => { e.cpu.cf = !e.cpu.cf; e.cpu.rip = rip + d.p as u64; }
        0xF8 => { e.cpu.cf = false; e.cpu.rip = rip + d.p as u64; }
        // x87: only fninit / fnclex (startup code resets the FPU; SSE2 does the math)
        0xDB if d.b[d.p] == 0xE3 || d.b[d.p] == 0xE2 => { d.p += 1; e.cpu.rip = rip + d.p as u64; }
        0x9B => { e.cpu.rip = rip + d.p as u64; } // fwait
        0xF9 => { e.cpu.cf = true; e.cpu.rip = rip + d.p as u64; }
        0xFC => { e.cpu.df = false; e.cpu.rip = rip + d.p as u64; }
        0xFD => { e.cpu.df = true; e.cpu.rip = rip + d.p as u64; }
        0xE3 => {
            let rel = d.i8(); let next = rip + d.p as u64;
            e.cpu.rip = if e.cpu.regs[1] == 0 { next.wrapping_add(rel as u64) } else { next };
        }
        0xE0..=0xE2 => {
            let rel = d.i8(); let next = rip + d.p as u64;
            e.cpu.regs[1] = e.cpu.regs[1].wrapping_sub(1);
            let go = e.cpu.regs[1] != 0 && match op { 0xE0 => !e.cpu.zf, 0xE1 => e.cpu.zf, _ => true };
            e.cpu.rip = if go { next.wrapping_add(rel as u64) } else { next };
        }
        0xA0..=0xA3 => {
            let size = if op & 1 == 0 { 8 } else { osz };
            let a = d.u64_full().wrapping_add(e.cpu.seg);
            e.cpu.rip = rip + d.p as u64;
            if op < 0xA2 { let v = g!(e, e.get(Loc::Mem(a), size)); g!(e, e.set(Loc::Reg(0, false), size, v)); }
            else { let v = e.cpu.regs[0]; g!(e, e.set(Loc::Mem(a), size, v)); }
        }
        0xA6 | 0xA7 | 0xAE | 0xAF | 0xAC | 0xAD => {
            let size = if op & 1 == 0 { 8 } else { osz };
            let st = (size / 8) as u64;
            let st = if e.cpu.df { st.wrapping_neg() } else { st };
            loop {
                if rep != 0 && e.cpu.regs[1] == 0 { break; }
                match op {
                    0xAC | 0xAD => {
                        let si = e.cpu.regs[6];
                        let v = tryf!(e, e.mmu.read_sized(si.wrapping_add(e.cpu.seg), size), si);
                        let _ = e.set(Loc::Reg(0, false), size, v);
                        e.cpu.regs[6] = si.wrapping_add(st);
                    }
                    0xAE | 0xAF => {
                        let di = e.cpu.regs[7];
                        let v = tryf!(e, e.mmu.read_sized(di, size), di);
                        let a = e.cpu.regs[0];
                        e.alu(7, a, v, size);
                        e.cpu.regs[7] = di.wrapping_add(st);
                    }
                    _ => {
                        let si = e.cpu.regs[6]; let di = e.cpu.regs[7];
                        let a = tryf!(e, e.mmu.read_sized(si.wrapping_add(e.cpu.seg), size), si);
                        let b = tryf!(e, e.mmu.read_sized(di, size), di);
                        e.alu(7, a, b, size);
                        e.cpu.regs[6] = si.wrapping_add(st); e.cpu.regs[7] = di.wrapping_add(st);
                    }
                }
                if rep == 0 { break; }
                e.cpu.regs[1] -= 1;
                if op != 0xAC && op != 0xAD && ((rep == 0xF3 && !e.cpu.zf) || (rep == 0xF2 && e.cpu.zf)) { break; }
            }
            e.cpu.rip = rip + d.p as u64;
        }
        0x0F => two_byte(e, &mut d, &buf, rip, rex, osz, rep, p66),
        _ => e.unsupported(&buf),
    }
}

fn imul_set(e: &mut Engine, reg: u8, a: u64, b: u64, size: u32) {
    let p = sx(a, size) as i128 * sx(b, size) as i128;
    let r = p as u64 & mask(size);
    let ovf = sx(r, size) as i128 != p;
    e.cpu.cf = ovf; e.cpu.of = ovf;
    e.szp(r, size);
    let _ = e.set(Loc::Reg(reg, false), size, r);
}

/// mul/imul/div/idiv with rdx:rax. Returns false on divide error.
fn muldiv(e: &mut Engine, sub: u8, src: u64, size: u32) -> bool {
    let m = mask(size);
    if size == 8 {
        let al = e.cpu.regs[0] & 0xFF;
        let ax = e.cpu.regs[0] & 0xFFFF;
        match sub {
            4 => { let r = al * src; let _ = e.set(Loc::Reg(0, false), 16, r); let o = r > 0xFF; e.cpu.cf = o; e.cpu.of = o; }
            5 => { let r = (sx(al, 8) * sx(src, 8)) as u64 & 0xFFFF; let _ = e.set(Loc::Reg(0, false), 16, r); let o = sx(r, 16) != sx(r, 8); e.cpu.cf = o; e.cpu.of = o; }
            _ => {
                if src == 0 { e.error = Some("integer divide by zero".into()); return false; }
                let (q, r) = if sub == 6 { (ax / src, ax % src) } else { let (a, b) = (sx(ax, 16), sx(src, 8)); ((a / b) as u64, (a % b) as u64) };
                let _ = e.set(Loc::Reg(0, false), 16, (q & 0xFF) | ((r & 0xFF) << 8));
            }
        }
        return true;
    }
    let a = e.cpu.regs[0] & m;
    let dhi = e.cpu.regs[2] & m;
    match sub {
        4 => {
            let p = a as u128 * src as u128;
            let _ = e.set(Loc::Reg(0, false), size, p as u64 & m);
            let hi = (p >> size) as u64 & m;
            let _ = e.set(Loc::Reg(2, false), size, hi);
            e.cpu.cf = hi != 0; e.cpu.of = hi != 0;
        }
        5 => {
            let p = sx(a, size) as i128 * sx(src, size) as i128;
            let lo = p as u64 & m;
            let _ = e.set(Loc::Reg(0, false), size, lo);
            let _ = e.set(Loc::Reg(2, false), size, (p >> size) as u64 & m);
            let o = sx(lo, size) as i128 != p; e.cpu.cf = o; e.cpu.of = o;
        }
        _ => {
            if src == 0 { e.error = Some("integer divide by zero".into()); return false; }
            let n = ((dhi as u128) << size) | a as u128;
            let (q, r) = if sub == 6 {
                (n / src as u128, n % src as u128)
            } else {
                let n = if size == 64 { n as i128 } else { ((n << (128 - 2 * size)) as i128) >> (128 - 2 * size) };
                let s = sx(src, size) as i128;
                ((n / s) as u128, (n % s) as u128)
            };
            let _ = e.set(Loc::Reg(0, false), size, q as u64 & m);
            let _ = e.set(Loc::Reg(2, false), size, r as u64 & m);
        }
    }
    true
}

fn two_byte(e: &mut Engine, d: &mut Dec, buf: &[u8; 16], rip: u64, rex: u8, osz: u32, rep: u8, p66: bool) {
    let op = d.u8();
    if crate::sse::sse(e, d, buf, rip, rex, p66, rep, op) { return; }
    match op {
        0x1F => { let m = modrm(d, e, rex); let _ = m; e.cpu.rip = rip + d.p as u64; }
        0x0B => { e.error = Some(format!("ud2 at 0x{:x}", rip)); }
        0x0D | 0x18..=0x1E => { let _ = modrm(d, e, rex); e.cpu.rip = rip + d.p as u64; }
        0xAE => {
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            e.cpu.rip = next;
            if m.md != 3 {
                let a = ea(e, &m, next);
                match m.reg & 7 {
                    2 => {}
                    3 => { tryf!(e, e.mmu.write32(a, 0x1F80), a); }
                    _ => e.unsupported(buf),
                }
            }
        }
        0xA3 | 0xAB | 0xB3 | 0xBB | 0xBA => {
            let m = modrm(d, e, rex);
            let (bit, kind) = if op == 0xBA { (d.u8() as u64, m.reg & 7) } else {
                (e.cpu.regs[m.reg as usize], match op { 0xA3 => 4, 0xAB => 5, 0xB3 => 6, _ => 7 })
            };
            let next = rip + d.p as u64;
            if kind < 4 { e.unsupported(buf); return; }
            let (l, b) = if m.md == 3 { (reg_loc(m.rm, osz, rex), bit % osz as u64) } else {
                let base = ea(e, &m, next);
                let off = if op == 0xBA { 0 } else { (sx(bit, osz) >> 3) & !((osz as i64 / 8) - 1) };
                (Loc::Mem(base.wrapping_add(off as u64)), bit % osz as u64)
            };
            let v = g!(e, e.get(l, osz));
            e.cpu.cf = (v >> b) & 1 != 0;
            let nv = match kind { 5 => v | 1 << b, 6 => v & !(1 << b), 7 => v ^ 1 << b, _ => v };
            if kind != 4 { g!(e, e.set(l, osz, nv)); }
            e.cpu.rip = next;
        }
        0xA4 | 0xA5 | 0xAC | 0xAD => {
            let m = modrm(d, e, rex);
            let cnt = if op & 1 == 0 { d.u8() as u32 } else { e.cpu.regs[1] as u32 } & if osz == 64 { 63 } else { 31 };
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, osz, rex);
            let a = g!(e, e.get(l, osz));
            let b = e.cpu.regs[m.reg as usize] & mask(osz);
            e.cpu.rip = next;
            if cnt == 0 { return; }
            let r = if op < 0xAC {
                e.cpu.cf = (a >> (osz - cnt)) & 1 != 0;
                ((a << cnt) | (b >> (osz - cnt))) & mask(osz)
            } else {
                e.cpu.cf = (a >> (cnt - 1)) & 1 != 0;
                ((a >> cnt) | (b << (osz - cnt))) & mask(osz)
            };
            e.szp(r, osz);
            g!(e, e.set(l, osz, r));
        }
        0xB0 | 0xB1 => {
            let size = if op == 0xB0 { 8 } else { osz };
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let v = g!(e, e.get(l, size));
            let a = e.cpu.regs[0];
            e.alu(7, a, v, size);
            if e.cpu.zf { let s = g!(e, e.get(reg_loc(m.reg, size, rex), size)); g!(e, e.set(l, size, s)); }
            else { g!(e, e.set(Loc::Reg(0, false), size, v)); }
            e.cpu.rip = next;
        }
        0xC0 | 0xC1 => {
            let size = if op == 0xC0 { 8 } else { osz };
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let l = rm_loc(e, &m, next, size, rex);
            let rg = reg_loc(m.reg, size, rex);
            let a = g!(e, e.get(l, size));
            let b = g!(e, e.get(rg, size));
            let r = e.alu(0, a, b, size);
            g!(e, e.set(rg, size, a));
            g!(e, e.set(l, size, r));
            e.cpu.rip = next;
        }
        0xB8 | 0xBC | 0xBD => {
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let v = g!(e, e.get(rm_loc(e, &m, next, osz, rex), osz));
            let r = match (op, rep) {
                (0xB8, 0xF3) => { let r = v.count_ones() as u64; e.cpu.zf = v == 0; e.cpu.cf = false; e.cpu.of = false; e.cpu.sf = false; e.cpu.pf = false; r }
                (0xBC, 0xF3) => { let r = if v == 0 { osz as u64 } else { v.trailing_zeros() as u64 }; e.cpu.cf = v == 0; e.cpu.zf = r == 0; r }
                (0xBD, 0xF3) => { let r = if v == 0 { osz as u64 } else { (v.leading_zeros() - (64 - osz)) as u64 }; e.cpu.cf = v == 0; e.cpu.zf = r == 0; r }
                (0xBC, _) => { e.cpu.zf = v == 0; if v == 0 { e.cpu.rip = next; return; } v.trailing_zeros() as u64 }
                (0xBD, _) => { e.cpu.zf = v == 0; if v == 0 { e.cpu.rip = next; return; } (63 - v.leading_zeros()) as u64 }
                _ => { e.unsupported(buf); return; }
            };
            let _ = e.set(Loc::Reg(m.reg, false), osz, r);
            e.cpu.rip = next;
        }
        0xC8..=0xCF => {
            let r = ((op & 7) | ((rex & 1) << 3)) as usize;
            let v = e.cpu.regs[r];
            e.cpu.regs[r] = if osz == 64 { v.swap_bytes() } else { (v as u32).swap_bytes() as u64 };
            e.cpu.rip = rip + d.p as u64;
        }
        0xC3 => {
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let v = e.cpu.regs[m.reg as usize];
            g!(e, e.set(rm_loc(e, &m, next, osz, rex), osz, v));
            e.cpu.rip = next;
        }
        0x31 => {
            let t = (unsafe { crate::host_now_ms() } * 1e6) as u64;
            e.cpu.regs[0] = t & 0xFFFF_FFFF; e.cpu.regs[2] = t >> 32;
            e.cpu.rip = rip + d.p as u64;
        }
        0xA2 => {
            let leaf = e.cpu.regs[0] as u32;
            let (a, b, c, dd): (u32, u32, u32, u32) = match leaf {
                0 => (1, 0x6B6E_4920, 0x2020_2020, 0x436F_5353), // "InkSoC" + spaces
                1 => (0x0006_06A0, 0, 1 << 23, (1 << 0) | (1 << 4) | (1 << 8) | (1 << 15) | (1 << 24) | (1 << 25) | (1 << 26)),
                0x8000_0000 => (0x8000_0001, 0, 0, 0),
                0x8000_0001 => (0, 0, 1 << 5, (1 << 11) | (1 << 20) | (1 << 29)),
                _ => (0, 0, 0, 0),
            };
            e.cpu.regs[0] = a as u64; e.cpu.regs[3] = b as u64; e.cpu.regs[1] = c as u64; e.cpu.regs[2] = dd as u64;
            e.cpu.rip = rip + d.p as u64;
        }
        0x40..=0x4F => {
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let v = g!(e, e.get(rm_loc(e, &m, next, osz, rex), osz));
            let dst = Loc::Reg(m.reg, false);
            let cur = e.cpu.regs[m.reg as usize];
            let _ = e.set(dst, osz, if e.cond(op & 15) { v } else { cur });
            e.cpu.rip = next;
        }
        0x80..=0x8F => {
            let rel = d.i32();
            let next = rip + d.p as u64;
            e.cpu.rip = if e.cond(op & 15) { next.wrapping_add(rel as u64) } else { next };
        }
        0x90..=0x9F => {
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let v = e.cond(op & 15) as u64;
            g!(e, e.set(rm_loc(e, &m, next, 8, rex), 8, v));
            e.cpu.rip = next;
        }
        0xAF => {
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let a = g!(e, e.get(rm_loc(e, &m, next, osz, rex), osz));
            let b = e.cpu.regs[m.reg as usize];
            imul_set(e, m.reg, b, a, osz);
            e.cpu.rip = next;
        }
        0xB6 | 0xB7 | 0xBE | 0xBF => {
            let ssz = if op & 1 == 0 { 8 } else { 16 };
            let m = modrm(d, e, rex);
            let next = rip + d.p as u64;
            let v = g!(e, e.get(rm_loc(e, &m, next, ssz, rex), ssz));
            let v = if op >= 0xBE { sx(v, ssz) as u64 & mask(osz) } else { v };
            let _ = e.set(Loc::Reg(m.reg, false), osz, v);
            e.cpu.rip = next;
        }
        _ => e.unsupported(buf),
    }
}
