// x86-64 interpreter (general-purpose integer subset). Registers live in a
// plain struct in memory (never on the native stack), so a thread can be
// parked and resumed at any instruction boundary.

use crate::Engine;

pub struct Cpu {
    pub regs: [u64; 16],
    pub rip: u64,
    cf: bool, zf: bool, sf: bool, of: bool, pf: bool, df: bool,
    pub icount: u64,
}

impl Cpu {
    pub fn new() -> Cpu {
        Cpu { regs: [0; 16], rip: 0, cf: false, zf: false, sf: false, of: false, pf: false, df: false, icount: 0 }
    }
}

#[derive(Clone, Copy)]
enum Loc { Reg(u8, bool), Mem(u64) }

struct ModRm { md: u8, reg: u8, rm: u8, base: Option<u8>, index: Option<u8>, scale: u8, disp: i64, riprel: bool }

struct Dec<'a> { b: &'a [u8; 16], p: usize }
impl<'a> Dec<'a> {
    fn u8(&mut self) -> u8 { let v = self.b[self.p.min(15)]; self.p += 1; v }
    fn i8(&mut self) -> i64 { self.u8() as i8 as i64 }
    fn i16(&mut self) -> i64 { let v = u16::from_le_bytes([self.u8(), self.u8()]); v as i16 as i64 }
    fn i32(&mut self) -> i64 { let v = u32::from_le_bytes([self.u8(), self.u8(), self.u8(), self.u8()]); v as i32 as i64 }
    fn u64(&mut self) -> u64 { let lo = self.i32() as u32 as u64; let hi = self.i32() as u32 as u64; lo | hi << 32 }
    fn imm(&mut self, size: u32) -> u64 {
        match size { 8 => self.i8() as u64, 16 => self.i16() as u64, _ => self.i32() as u64 }
    }
}

#[inline(always)]
fn mask(size: u32) -> u64 { if size == 64 { u64::MAX } else { (1u64 << size) - 1 } }
#[inline(always)]
fn sign(size: u32) -> u64 { 1u64 << (size - 1) }
#[inline(always)]
fn sx(v: u64, size: u32) -> i64 { let s = 64 - size; ((v << s) as i64) >> s }

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
    fn get(&mut self, l: Loc, size: u32) -> Result<u64, ()> {
        match l {
            Loc::Reg(r, hi) => {
                let v = self.cpu.regs[r as usize];
                Ok(if hi { (v >> 8) & 0xFF } else { v & mask(size) })
            }
            Loc::Mem(a) => self.mmu.read_sized(a, size).map_err(|_| self.fault(a)),
        }
    }
    fn set(&mut self, l: Loc, size: u32, v: u64) -> Result<(), ()> {
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
    fn push(&mut self, v: u64) -> Result<(), ()> {
        let sp = self.cpu.regs[4].wrapping_sub(8);
        self.mmu.write64(sp, v).map_err(|_| self.fault(sp))?;
        self.cpu.regs[4] = sp;
        Ok(())
    }
    fn pop(&mut self) -> Result<u64, ()> {
        let sp = self.cpu.regs[4];
        let v = self.mmu.read64(sp).map_err(|_| self.fault(sp))?;
        self.cpu.regs[4] = sp + 8;
        Ok(v)
    }

    fn szp(&mut self, r: u64, size: u32) {
        let c = &mut self.cpu;
        c.zf = r & mask(size) == 0;
        c.sf = r & sign(size) != 0;
        c.pf = (r as u8).count_ones() % 2 == 0;
    }

    fn alu(&mut self, op: u8, a: u64, b: u64, size: u32) -> u64 {
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

    fn cond(&self, cc: u8) -> bool {
        let c = &self.cpu;
        let r = match cc >> 1 {
            0 => c.of, 1 => c.cf, 2 => c.zf, 3 => c.cf || c.zf,
            4 => c.sf, 5 => c.pf, 6 => c.sf != c.of, _ => c.zf || (c.sf != c.of),
        };
        if cc & 1 == 1 { !r } else { r }
    }

    fn unsupported(&mut self, b: &[u8; 16]) {
        self.error = Some(format!("unsupported instruction at 0x{:x}: {:02x?}", self.cpu.rip, &b[..8]));
    }
}

fn modrm(d: &mut Dec, e: &Engine, rex: u8) -> ModRm {
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

fn ea(e: &Engine, m: &ModRm, next: u64) -> u64 {
    if m.riprel { return next.wrapping_add(m.disp as u64); }
    let mut a = m.disp as u64;
    if let Some(b) = m.base { a = a.wrapping_add(e.cpu.regs[b as usize]); }
    if let Some(i) = m.index { a = a.wrapping_add(e.cpu.regs[i as usize] << m.scale); }
    a
}

fn rm_loc(e: &Engine, m: &ModRm, next: u64, size: u32, rex: u8) -> Loc {
    if m.md == 3 { reg_loc(m.rm, size, rex) } else { Loc::Mem(ea(e, m, next)) }
}
fn reg_loc(r: u8, size: u32, rex: u8) -> Loc {
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
    loop {
        op = d.u8();
        match op {
            0x66 => opsize16 = true,
            0xF2 | 0xF3 => rep = op,
            0x2E | 0x3E | 0x26 | 0x36 | 0x64 | 0x65 | 0x67 | 0xF0 => {}
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
        0x0F => two_byte(e, &mut d, &buf, rip, rex, osz, rep),
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

fn two_byte(e: &mut Engine, d: &mut Dec, buf: &[u8; 16], rip: u64, rex: u8, osz: u32, _rep: u8) {
    let op = d.u8();
    match op {
        0x1F => { let m = modrm(d, e, rex); let _ = m; e.cpu.rip = rip + d.p as u64; }
        0x0B => { e.error = Some(format!("ud2 at 0x{:x}", rip)); }
        0x31 => {
            let t = (unsafe { crate::host_now_ms() } * 1e6) as u64;
            e.cpu.regs[0] = t & 0xFFFF_FFFF; e.cpu.regs[2] = t >> 32;
            e.cpu.rip = rip + d.p as u64;
        }
        0xA2 => {
            for r in [0usize, 1, 2, 3] { e.cpu.regs[r] = 0; }
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
