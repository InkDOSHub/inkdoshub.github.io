// x87 floating point (the old FPU stack). Programs built with musl or glibc
// use it for `long double` (printf of numbers, strtod, awk...). Values are
// exact 80-bit numbers (f80.rs); sin, log and friends go through f64.

use crate::cpu::{ea, modrm, Dec};
use crate::Engine;
use crate::f80::F80;

const C0: u16 = 1 << 8; const C1: u16 = 1 << 9; const C2: u16 = 1 << 10; const C3: u16 = 1 << 14;

impl Engine {
    fn st(&self, i: u8) -> F80 { self.cpu.fpu[((self.cpu.ftop + i) & 7) as usize] }
    fn set_st(&mut self, i: u8, v: F80) { self.cpu.fpu[((self.cpu.ftop + i) & 7) as usize] = v; }
    fn fpush(&mut self, v: F80) { self.cpu.ftop = (self.cpu.ftop + 7) & 7; self.set_st(0, v); }
    fn fpop(&mut self) -> F80 { let v = self.st(0); self.cpu.ftop = (self.cpu.ftop + 1) & 7; v }
    fn rc(&self) -> u16 { (self.cpu.fcw >> 10) & 3 }
    fn fsw(&self) -> u16 { (self.cpu.fsw & !(7 << 11)) | ((self.cpu.ftop as u16) << 11) }
    fn fcompare(&mut self, a: F80, b: F80, eflags: bool) {
        use core::cmp::Ordering::*;
        let (c0, c2, c3) = match F80::cmp(a, b) { None => (true, true, true), Some(Less) => (true, false, false), Some(Equal) => (false, false, true), Some(Greater) => (false, false, false) };
        if eflags {
            self.cpu.cf = c0; self.cpu.pf = c2; self.cpu.zf = c3;
            self.cpu.of = false; self.cpu.sf = false;
        } else {
            self.cpu.fsw = (self.cpu.fsw & !(C0 | C1 | C2 | C3)) | if c0 { C0 } else { 0 } | if c2 { C2 } else { 0 } | if c3 { C3 } else { 0 };
        }
    }
    fn fist(&mut self, v: F80, bytes: u32, trunc: bool) -> u64 {
        let bad = match bytes { 2 => 0x8000, 4 => 0x8000_0000, _ => 1u64 << 63 };
        let Some(r) = v.to_i64(if trunc { 3 } else { self.rc() }) else { return bad };
        let ok = match bytes { 2 => (-32768..=32767).contains(&r), 4 => (-2147483648..=2147483647).contains(&r), _ => true };
        if ok { r as u64 } else { bad }
    }
    fn fenv_write(&mut self, a: u64) -> Result<(), ()> {
        let mut b = [0u8; 28];
        b[0..2].copy_from_slice(&self.cpu.fcw.to_le_bytes());
        b[4..6].copy_from_slice(&self.fsw().to_le_bytes());
        b[8..10].copy_from_slice(&0xFFFFu16.to_le_bytes());
        self.mmu.write_bytes(a, &b).map_err(|_| self.fault(a))
    }
    fn fenv_read(&mut self, a: u64) -> Result<(), ()> {
        let mut b = [0u8; 28];
        self.mmu.read_bytes(a, &mut b).map_err(|_| self.fault(a))?;
        self.cpu.fcw = u16::from_le_bytes([b[0], b[1]]);
        let sw = u16::from_le_bytes([b[4], b[5]]);
        self.cpu.fsw = sw; self.cpu.ftop = ((sw >> 11) & 7) as u8;
        Ok(())
    }
}

fn arith(op: u8, a: F80, b: F80, rc: u16) -> F80 {
    match op { 0 => F80::add(a, b, rc), 1 => F80::mul(a, b, rc), 4 => F80::sub(a, b, rc), 5 => F80::sub(b, a, rc), 6 => F80::div(a, b, rc), _ => F80::div(b, a, rc) }
}
fn f(v: f64) -> F80 { F80::from_f64(v) }

macro_rules! g { ($e:expr, $x:expr) => { match $x { Ok(v) => v, Err(_) => { let _ = &$e; return; } } } }

/// Runs an x87 instruction (opcode `op` = D8..DF).
pub fn x87(e: &mut Engine, d: &mut Dec, rip: u64, rex: u8, op: u8) {
    let m = modrm(d, e, rex);
    let next = rip + d.p as u64;
    e.cpu.rip = next;
    let r = m.reg & 7;
    if m.md != 3 {
        let a = ea(e, &m, next);
        macro_rules! rd { ($f:ident) => { match e.mmu.$f(a) { Ok(v) => v, Err(_) => { e.fault(a); return; } } } }
        macro_rules! wr { ($f:ident, $v:expr) => { let v = $v; if e.mmu.$f(a, v).is_err() { e.fault(a); return; } } }
        match (op, r) {
            (0xD8, _) | (0xDA, _) | (0xDC, _) | (0xDE, _) => {
                let v = match op { 0xD8 => f(f32::from_bits(rd!(read32)) as f64), 0xDA => F80::from_i64(rd!(read32) as i32 as i64), 0xDC => f(f64::from_bits(rd!(read64))), _ => F80::from_i64(rd!(read16) as i16 as i64) };
                match r {
                    2 | 3 => { let s = e.st(0); e.fcompare(s, v, false); if r == 3 { e.fpop(); } }
                    _ => { let s = e.st(0); let rc = e.rc(); e.set_st(0, arith(r, s, v, rc)); }
                }
            }
            (0xD9, 0) => { let v = f(f32::from_bits(rd!(read32)) as f64); e.fpush(v); }
            (0xD9, 2) | (0xD9, 3) => { wr!(write32, (e.st(0).to_f64() as f32).to_bits()); if r == 3 { e.fpop(); } }
            (0xD9, 4) => { g!(e, e.fenv_read(a)); }
            (0xD9, 5) => { e.cpu.fcw = rd!(read16); }
            (0xD9, 6) => { g!(e, e.fenv_write(a)); }
            (0xD9, 7) => { wr!(write16, e.cpu.fcw); }
            (0xDB, 0) => { let v = F80::from_i64(rd!(read32) as i32 as i64); e.fpush(v); }
            (0xDB, 1) | (0xDB, 2) | (0xDB, 3) => { let v = e.fist(e.st(0), 4, r == 1); wr!(write32, v as u32); if r != 2 { e.fpop(); } }
            (0xDB, 5) => { let mut b = [0u8; 10]; if e.mmu.read_bytes(a, &mut b).is_err() { e.fault(a); return; } e.fpush(F80::from_bytes(&b)); }
            (0xDB, 7) => { let b = e.st(0).to_bytes(); if e.mmu.write_bytes(a, &b).is_err() { e.fault(a); return; } e.fpop(); }
            (0xDD, 0) => { let v = f(f64::from_bits(rd!(read64))); e.fpush(v); }
            (0xDD, 1) => { let v = e.fist(e.st(0), 8, true); wr!(write64, v); e.fpop(); }
            (0xDD, 2) | (0xDD, 3) => { wr!(write64, e.st(0).to_f64().to_bits()); if r == 3 { e.fpop(); } }
            (0xDD, 4) => { // frstor
                g!(e, e.fenv_read(a));
                for i in 0..8u8 { let mut b = [0u8; 10]; if e.mmu.read_bytes(a + 28 + 10 * i as u64, &mut b).is_err() { e.fault(a); return; } e.set_st(i, F80::from_bytes(&b)); }
            }
            (0xDD, 6) => { // fnsave
                g!(e, e.fenv_write(a));
                for i in 0..8u8 { let b = e.st(i).to_bytes(); if e.mmu.write_bytes(a + 28 + 10 * i as u64, &b).is_err() { e.fault(a); return; } }
                e.cpu.fcw = 0x37F; e.cpu.fsw = 0; e.cpu.ftop = 0;
            }
            (0xDD, 7) => { wr!(write16, e.fsw()); }
            (0xDF, 0) => { let v = F80::from_i64(rd!(read16) as i16 as i64); e.fpush(v); }
            (0xDF, 1) | (0xDF, 2) | (0xDF, 3) => { let v = e.fist(e.st(0), 2, r == 1); wr!(write16, v as u16); if r != 2 { e.fpop(); } }
            (0xDF, 5) => { let v = F80::from_i64(rd!(read64) as i64); e.fpush(v); }
            (0xDF, 7) => { let v = e.fist(e.st(0), 8, false); wr!(write64, v); e.fpop(); }
            _ => { e.cpu.rip = rip; let mut b = [0u8; 16]; let _ = e.mmu.fetch16(rip, &mut b); e.unsupported(&b); }
        }
        return;
    }
    let i = m.rm & 7;
    let (s0, si) = (e.st(0), e.st(i));
    let rc = e.rc();
    let (x0, x1) = (s0.to_f64(), e.st(1).to_f64());
    match (op, r) {
        (0xD8, 2) | (0xD8, 3) => { e.fcompare(s0, si, false); if r == 3 { e.fpop(); } }
        (0xD8, _) => e.set_st(0, arith(r, s0, si, rc)),
        (0xDC, 2) | (0xDC, 3) => { e.fcompare(s0, si, false); if r == 3 { e.fpop(); } }
        // DC/DE: the result goes to ST(i), with sub/div reversed
        (0xDC, _) | (0xDE, _) if !(op == 0xDE && r == 3) => {
            let v = match r { 0 => F80::add(si, s0, rc), 1 => F80::mul(si, s0, rc), 4 => F80::sub(s0, si, rc), 5 => F80::sub(si, s0, rc), 6 => F80::div(s0, si, rc), 7 => F80::div(si, s0, rc), _ => { e.fcompare(s0, si, false); if op == 0xDE { e.fpop(); } return; } };
            e.set_st(i, v);
            if op == 0xDE { e.fpop(); }
        }
        (0xDE, 3) => { e.fcompare(s0, e.st(1), false); e.fpop(); e.fpop(); } // fcompp
        (0xD9, 0) => e.fpush(si),
        (0xD9, 1) => { e.set_st(0, si); e.set_st(i, s0); }
        (0xD9, 2) => {} // fnop
        (0xD9, 4) => match i {
            0 => e.set_st(0, s0.neg()),
            1 => e.set_st(0, s0.abs()),
            4 => e.fcompare(s0, F80::ZERO, false),
            5 => { // fxam
                let c = if s0.is_nan() { C0 } else if s0.is_inf() { C2 | C0 } else if s0.man == 0 { C3 } else if s0.exp < -16382 { C3 | C2 } else { C2 };
                e.cpu.fsw = (e.cpu.fsw & !(C0 | C1 | C2 | C3)) | c | if s0.neg { C1 } else { 0 };
            }
            _ => { e.cpu.rip = rip; let mut b = [0u8; 16]; let _ = e.mmu.fetch16(rip, &mut b); e.unsupported(&b); }
        },
        (0xD9, 5) => {
            // constants with full 64-bit mantissas
            let k = [(0, 1u64 << 63), (1, 0xD49A_784B_CD1B_8AFE), (0, 0xB8AA_3B29_5C17_F0BC), (1, 0xC90F_DAA2_2168_C235), (-2, 0x9A20_9A84_FBCF_F799), (-1, 0xB172_17F7_D1CF_79AC), (0, 0), (0, 0)][i as usize];
            e.fpush(F80 { neg: false, exp: k.0, man: k.1 });
        }
        (0xD9, 6) => match i {
            0 => e.set_st(0, f(x0.exp2() - 1.0)),
            1 => { let s1 = e.st(1); e.fpop(); e.set_st(0, F80::mul(s1, f(x0.log2()), rc)); }
            2 => { e.set_st(0, f(x0.tan())); e.fpush(f(1.0)); e.cpu.fsw &= !C2; }
            3 => { e.fpop(); e.set_st(0, f(x1.atan2(x0))); }
            4 => { // fxtract
                if s0.man == 0 || s0.exp == i32::MAX { e.set_st(0, if s0.man == 0 { F80::inf(true) } else { s0 }); e.fpush(s0); } else {
                    e.set_st(0, F80::from_i64(s0.exp as i64)); e.fpush(F80 { exp: 0, ..s0 });
                }
            }
            5 => { let s1 = e.st(1); e.set_st(0, F80::rem(s0, s1, true)); e.cpu.fsw &= !(C0 | C1 | C2 | C3); } // fprem1
            6 => e.cpu.ftop = (e.cpu.ftop + 7) & 7,
            _ => e.cpu.ftop = (e.cpu.ftop + 1) & 7,
        },
        (0xD9, 7) => match i {
            0 => { let s1 = e.st(1); e.set_st(0, F80::rem(s0, s1, false)); e.cpu.fsw &= !(C0 | C1 | C2 | C3); } // fprem
            1 => { let s1 = e.st(1); e.fpop(); e.set_st(0, F80::mul(s1, f(x0.ln_1p() / std::f64::consts::LN_2), rc)); }
            2 => e.set_st(0, F80::sqrt(s0, rc)),
            3 => { e.set_st(0, f(x0.sin())); e.fpush(f(x0.cos())); e.cpu.fsw &= !C2; }
            4 => e.set_st(0, s0.round_int(rc)),
            5 => { // fscale
                let n = e.st(1).to_i64(3).unwrap_or(0).clamp(-40000, 40000) as i32;
                let v = if s0.man == 0 || s0.exp == i32::MAX { s0 } else if s0.exp + n > 16383 { F80::inf(s0.neg) } else if s0.exp + n < -16446 { F80 { neg: s0.neg, exp: 0, man: 0 } } else { F80 { exp: s0.exp + n, ..s0 } };
                e.set_st(0, v);
            }
            6 => { e.set_st(0, f(x0.sin())); e.cpu.fsw &= !C2; }
            _ => { e.set_st(0, f(x0.cos())); e.cpu.fsw &= !C2; }
        },
        (0xDA, 5) if i == 1 => { e.fcompare(s0, e.st(1), false); e.fpop(); e.fpop(); } // fucompp
        (0xDA, _) | (0xDB, 0..=3) => {
            e.materialize();
            let c = &e.cpu;
            let take = match r { 0 => c.cf, 1 => c.zf, 2 => c.cf || c.zf, _ => c.pf };
            let take = if op == 0xDB { !take } else { take };
            if take { e.set_st(0, si); }
        }
        (0xDB, 4) => match i { 2 => e.cpu.fsw &= !0x80FF, 3 => { e.cpu.fcw = 0x37F; e.cpu.fsw = 0; e.cpu.ftop = 0; } _ => {} },
        (0xDB, 5) | (0xDB, 6) | (0xDF, 5) | (0xDF, 6) => { e.fcompare(s0, si, true); if op == 0xDF { e.fpop(); } }
        (0xDD, 0) => {} // ffree
        (0xDD, 2) | (0xDD, 3) => { e.set_st(i, s0); if r == 3 { e.fpop(); } }
        (0xDD, 4) | (0xDD, 5) => { e.fcompare(s0, si, false); if r == 5 { e.fpop(); } }
        (0xDF, 4) if i == 0 => { let sw = e.fsw() as u64; e.cpu.regs[0] = (e.cpu.regs[0] & !0xFFFF) | sw; }
        _ => { e.cpu.rip = rip; let mut b = [0u8; 16]; let _ = e.mmu.fetch16(rip, &mut b); e.unsupported(&b); }
    }
}
