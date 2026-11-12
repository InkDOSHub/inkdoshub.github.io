// SSE / SSE2 (the vector unit every x86-64 program uses for floating point,
// copies and string code). XMM registers are u128 values; lanes are read and
// written through little-endian casts.

use crate::cpu::{ea, modrm, reg_loc, Dec, Loc, ModRm};
use crate::Engine;

#[inline(always)] fn u8s(v: u128) -> [u8; 16] { v.to_le_bytes() }
#[inline(always)] fn from_u8s(a: [u8; 16]) -> u128 { u128::from_le_bytes(a) }
#[inline(always)] fn u16s(v: u128) -> [u16; 8] { let b = u8s(v); core::array::from_fn(|i| u16::from_le_bytes([b[2 * i], b[2 * i + 1]])) }
#[inline(always)] fn from_u16s(a: [u16; 8]) -> u128 { let mut b = [0u8; 16]; for i in 0..8 { b[2 * i..2 * i + 2].copy_from_slice(&a[i].to_le_bytes()); } from_u8s(b) }
#[inline(always)] fn u32s(v: u128) -> [u32; 4] { core::array::from_fn(|i| (v >> (32 * i)) as u32) }
#[inline(always)] fn from_u32s(a: [u32; 4]) -> u128 { a.iter().enumerate().fold(0u128, |acc, (i, &x)| acc | (x as u128) << (32 * i)) }
#[inline(always)] fn u64s(v: u128) -> [u64; 2] { [v as u64, (v >> 64) as u64] }
#[inline(always)] fn from_u64s(a: [u64; 2]) -> u128 { a[0] as u128 | (a[1] as u128) << 64 }
#[inline(always)] fn f32s(v: u128) -> [f32; 4] { u32s(v).map(f32::from_bits) }
#[inline(always)] fn from_f32s(a: [f32; 4]) -> u128 { from_u32s(a.map(f32::to_bits)) }
#[inline(always)] fn f64s(v: u128) -> [f64; 2] { u64s(v).map(f64::from_bits) }
#[inline(always)] fn from_f64s(a: [f64; 2]) -> u128 { from_u64s(a.map(f64::to_bits)) }

fn map_u8(a: u128, b: u128, f: impl Fn(u8, u8) -> u8) -> u128 { let (x, y) = (u8s(a), u8s(b)); from_u8s(core::array::from_fn(|i| f(x[i], y[i]))) }
fn map_u16(a: u128, b: u128, f: impl Fn(u16, u16) -> u16) -> u128 { let (x, y) = (u16s(a), u16s(b)); from_u16s(core::array::from_fn(|i| f(x[i], y[i]))) }
fn map_u32(a: u128, b: u128, f: impl Fn(u32, u32) -> u32) -> u128 { let (x, y) = (u32s(a), u32s(b)); from_u32s(core::array::from_fn(|i| f(x[i], y[i]))) }
fn map_u64(a: u128, b: u128, f: impl Fn(u64, u64) -> u64) -> u128 { let (x, y) = (u64s(a), u64s(b)); from_u64s(core::array::from_fn(|i| f(x[i], y[i]))) }

fn sat_i8(v: i32) -> u8 { v.clamp(-128, 127) as i8 as u8 }
fn sat_u8(v: i32) -> u8 { v.clamp(0, 255) as u8 }
fn sat_i16(v: i32) -> u16 { v.clamp(-32768, 32767) as i16 as u16 }

fn cvt_i32(v: f64, trunc: bool) -> u32 {
    let r = if trunc { v.trunc() } else { v.round_ties_even() };
    if r.is_nan() || r < -2147483648.0 || r > 2147483647.0 { 0x8000_0000 } else { r as i32 as u32 }
}
fn cvt_i64(v: f64, trunc: bool) -> u64 {
    let r = if trunc { v.trunc() } else { v.round_ties_even() };
    if r.is_nan() || r < -9.223372036854775808e18 || r >= 9.223372036854775808e18 { 0x8000_0000_0000_0000 } else { r as i64 as u64 }
}

fn cmp_pred(a: f64, b: f64, p: u8) -> bool {
    let un = a.is_nan() || b.is_nan();
    match p & 7 { 0 => a == b, 1 => a < b, 2 => a <= b, 3 => un, 4 => !(a == b), 5 => !(a < b), 6 => !(a <= b), _ => !un }
}

impl Engine {
    fn read128(&mut self, a: u64) -> Result<u128, ()> {
        let lo = self.mmu.read64(a).map_err(|_| self.fault(a))?;
        let hi = self.mmu.read64(a + 8).map_err(|_| self.fault(a + 8))?;
        Ok(lo as u128 | (hi as u128) << 64)
    }
    fn write128(&mut self, a: u64, v: u128) -> Result<(), ()> {
        self.mmu.write64(a, v as u64).map_err(|_| self.fault(a))?;
        self.mmu.write64(a + 8, (v >> 64) as u64).map_err(|_| self.fault(a + 8))
    }
    /// Source operand of `bytes` size (4, 8 or 16): xmm register or memory (zero-extended).
    fn xsrc(&mut self, m: &ModRm, next: u64, bytes: u32) -> Result<u128, ()> {
        if m.md == 3 { return Ok(self.cpu.xmm[m.rm as usize]); }
        let a = ea(self, m, next);
        match bytes {
            4 => self.mmu.read32(a).map(|v| v as u128).map_err(|_| self.fault(a)),
            8 => self.mmu.read64(a).map(|v| v as u128).map_err(|_| self.fault(a)),
            _ => self.read128(a),
        }
    }
    fn xstore(&mut self, m: &ModRm, next: u64, bytes: u32, v: u128) -> Result<(), ()> {
        if m.md == 3 {
            let r = &mut self.cpu.xmm[m.rm as usize];
            *r = match bytes { 4 => (*r & !0xFFFF_FFFF) | (v & 0xFFFF_FFFF), 8 => (*r & !(u64::MAX as u128)) | (v & u64::MAX as u128), _ => v };
            return Ok(());
        }
        let a = ea(self, m, next);
        match bytes {
            4 => self.mmu.write32(a, v as u32).map_err(|_| self.fault(a)),
            8 => self.mmu.write64(a, v as u64).map_err(|_| self.fault(a)),
            _ => self.write128(a, v),
        }
    }
}

macro_rules! g { ($e:expr, $x:expr) => { match $x { Ok(v) => v, Err(_) => return true } } }

/// Returns true when the opcode was handled here.
pub fn sse(e: &mut Engine, d: &mut Dec, buf: &[u8; 16], rip: u64, rex: u8, p66: bool, rep: u8, op: u8) -> bool {
    let w = rex & 8 != 0;
    let is_sse = matches!(op, 0x10..=0x17 | 0x28..=0x2F | 0x50..=0x7F | 0xC2 | 0xC4 | 0xC5 | 0xC6 | 0xD0..=0xFE | 0x2B);
    if !is_sse { return false; }
    // 0x60..0x7F and 0xD1..0xFE without 66/F3/F2 are MMX: not supported
    if (matches!(op, 0x60..=0x7F) || op >= 0xD0) && !p66 && rep == 0 { e.unsupported(buf); return true; }
    let m = modrm(d, e, rex);
    let imm_ops = matches!(op, 0x70..=0x73 | 0xC2 | 0xC4 | 0xC5 | 0xC6);
    let imm = if imm_ops { d.u8() } else { 0 };
    let next = rip + d.p as u64;
    let r = m.reg as usize;
    let dst = e.cpu.xmm[r];
    // scalar kind: 0 = packed single, 1 = packed double (66), 2 = scalar single (F3), 3 = scalar double (F2)
    let kind = if rep == 0xF3 { 2 } else if rep == 0xF2 { 3 } else if p66 { 1 } else { 0 };
    let mut out: Option<u128> = None;
    match op {
        0x10 => out = Some(match kind {
            2 => { let s = g!(e, e.xsrc(&m, next, 4)); if m.md == 3 { (dst & !0xFFFF_FFFF) | (s & 0xFFFF_FFFF) } else { s } }
            3 => { let s = g!(e, e.xsrc(&m, next, 8)); if m.md == 3 { (dst & !(u64::MAX as u128)) | (s & u64::MAX as u128) } else { s } }
            _ => g!(e, e.xsrc(&m, next, 16)),
        }),
        0x11 | 0x29 | 0x2B | 0x7F | 0xE7 => { let b = if op == 0x11 && kind == 2 { 4 } else if op == 0x11 && kind == 3 { 8 } else { 16 }; g!(e, e.xstore(&m, next, b, dst)); }
        0x12 => { let s = g!(e, e.xsrc(&m, next, if m.md == 3 { 16 } else { 8 })); let lo = if m.md == 3 && !p66 { s >> 64 } else { s }; out = Some((dst & !(u64::MAX as u128)) | (lo & u64::MAX as u128)); }
        0x13 => { g!(e, e.xstore(&m, next, 8, dst)); }
        0x16 => { let s = g!(e, e.xsrc(&m, next, if m.md == 3 { 16 } else { 8 })); out = Some((dst & u64::MAX as u128) | (s << 64)); }
        0x17 => { g!(e, e.xstore(&m, next, 8, dst >> 64)); }
        0x14 | 0x15 => {
            let s = g!(e, e.xsrc(&m, next, 16));
            out = Some(if p66 {
                let (a, b) = (u64s(dst), u64s(s));
                if op == 0x14 { from_u64s([a[0], b[0]]) } else { from_u64s([a[1], b[1]]) }
            } else {
                let (a, b) = (u32s(dst), u32s(s));
                if op == 0x14 { from_u32s([a[0], b[0], a[1], b[1]]) } else { from_u32s([a[2], b[2], a[3], b[3]]) }
            });
        }
        0x28 => out = Some(g!(e, e.xsrc(&m, next, 16))),
        0xD0 if kind == 1 || kind == 3 => {
            // addsubpd / addsubps: even lanes subtract, odd lanes add
            let sv = g!(e, e.xsrc(&m, next, 16));
            out = Some(if kind == 1 { let (a, b) = (f64s(dst), f64s(sv)); from_f64s([a[0] - b[0], a[1] + b[1]]) }
                       else { let (a, b) = (f32s(dst), f32s(sv)); from_f32s([a[0] - b[0], a[1] + b[1], a[2] - b[2], a[3] + b[3]]) });
        }
        0x2A => {
            if kind < 2 { e.unsupported(buf); return true; }
            let sz = if w { 64 } else { 32 };
            let v = g!(e, e.get(crate::cpu::rm_loc(e, &m, next, sz, rex), sz));
            let f = if w { v as i64 as f64 } else { v as u32 as i32 as f64 };
            out = Some(if kind == 2 { (dst & !0xFFFF_FFFF) | (if w { v as i64 as f32 } else { v as u32 as i32 as f32 }).to_bits() as u128 }
                       else { (dst & !(u64::MAX as u128)) | f.to_bits() as u128 });
        }
        0x2C | 0x2D => {
            if kind < 2 { e.unsupported(buf); return true; }
            let s = g!(e, e.xsrc(&m, next, if kind == 2 { 4 } else { 8 }));
            let f = if kind == 2 { f32::from_bits(s as u32) as f64 } else { f64::from_bits(s as u64) };
            let trunc = op == 0x2C;
            let v = if w { cvt_i64(f, trunc) } else { cvt_i32(f, trunc) as u64 };
            let _ = e.set(Loc::Reg(m.reg, false), if w { 64 } else { 32 }, v);
        }
        0x2E | 0x2F => {
            let s = g!(e, e.xsrc(&m, next, if p66 { 8 } else { 4 }));
            let (a, b) = if p66 { (f64::from_bits(dst as u64), f64::from_bits(s as u64)) } else { (f32::from_bits(dst as u32) as f64, f32::from_bits(s as u32) as f64) };
            let c = &mut e.cpu;
            c.of = false; c.sf = false;
            if a.is_nan() || b.is_nan() { c.zf = true; c.pf = true; c.cf = true; }
            else { c.pf = false; c.zf = a == b; c.cf = a < b; }
        }
        0x50 => {
            let v = if p66 { let a = u64s(dst_of(e, &m)); (a[0] >> 63) | ((a[1] >> 63) << 1) } else { let a = u32s(dst_of(e, &m)); (0..4).fold(0, |acc, i| acc | (((a[i] >> 31) as u64) << i)) };
            let _ = e.set(Loc::Reg(m.reg, false), 32, v);
        }
        0x51 | 0x58 | 0x59 | 0x5C | 0x5D | 0x5E | 0x5F => {
            let s = g!(e, e.xsrc(&m, next, match kind { 2 => 4, 3 => 8, _ => 16 }));
            let f64op = |a: f64, b: f64| -> f64 { match op { 0x51 => b.sqrt(), 0x58 => a + b, 0x59 => a * b, 0x5C => a - b, 0x5D => if a < b { a } else { b }, 0x5E => a / b, _ => if a > b { a } else { b } } };
            let f32op = |a: f32, b: f32| -> f32 { match op { 0x51 => b.sqrt(), 0x58 => a + b, 0x59 => a * b, 0x5C => a - b, 0x5D => if a < b { a } else { b }, 0x5E => a / b, _ => if a > b { a } else { b } } };
            out = Some(match kind {
                0 => { let (a, b) = (f32s(dst), f32s(s)); from_f32s(core::array::from_fn(|i| f32op(a[i], b[i]))) }
                1 => { let (a, b) = (f64s(dst), f64s(s)); from_f64s(core::array::from_fn(|i| f64op(a[i], b[i]))) }
                2 => (dst & !0xFFFF_FFFF) | f32op(f32::from_bits(dst as u32), f32::from_bits(s as u32)).to_bits() as u128,
                _ => (dst & !(u64::MAX as u128)) | f64op(f64::from_bits(dst as u64), f64::from_bits(s as u64)).to_bits() as u128,
            });
        }
        0x54..=0x57 => {
            let s = g!(e, e.xsrc(&m, next, 16));
            out = Some(match op { 0x54 => dst & s, 0x55 => !dst & s, 0x56 => dst | s, _ => dst ^ s });
        }
        0x5A => {
            let s = g!(e, e.xsrc(&m, next, match kind { 0 => 8, 2 => 4, 3 => 8, _ => 16 }));
            out = Some(match kind {
                0 => { let a = f32s(s); from_f64s([a[0] as f64, a[1] as f64]) }
                1 => { let a = f64s(s); from_f32s([a[0] as f32, a[1] as f32, 0.0, 0.0]) & u64::MAX as u128 }
                2 => (dst & !(u64::MAX as u128)) | (f32::from_bits(s as u32) as f64).to_bits() as u128,
                _ => (dst & !0xFFFF_FFFF) | (f64::from_bits(s as u64) as f32).to_bits() as u128,
            });
        }
        0x5B => {
            let s = g!(e, e.xsrc(&m, next, 16));
            out = Some(match kind {
                0 => { let a = u32s(s); from_f32s(a.map(|x| x as i32 as f32)) }
                1 => { let a = f32s(s); from_u32s(a.map(|x| cvt_i32(x as f64, false))) }
                2 => { let a = f32s(s); from_u32s(a.map(|x| cvt_i32(x as f64, true))) }
                _ => { e.unsupported(buf); return true; }
            });
        }
        0xC2 => {
            let s = g!(e, e.xsrc(&m, next, match kind { 2 => 4, 3 => 8, _ => 16 }));
            out = Some(match kind {
                0 => { let (a, b) = (f32s(dst), f32s(s)); from_u32s(core::array::from_fn(|i| if cmp_pred(a[i] as f64, b[i] as f64, imm) { u32::MAX } else { 0 })) }
                1 => { let (a, b) = (f64s(dst), f64s(s)); from_u64s(core::array::from_fn(|i| if cmp_pred(a[i], b[i], imm) { u64::MAX } else { 0 })) }
                2 => (dst & !0xFFFF_FFFF) | if cmp_pred(f32::from_bits(dst as u32) as f64, f32::from_bits(s as u32) as f64, imm) { 0xFFFF_FFFF } else { 0 },
                _ => (dst & !(u64::MAX as u128)) | if cmp_pred(f64::from_bits(dst as u64), f64::from_bits(s as u64), imm) { u64::MAX as u128 } else { 0 },
            });
        }
        0xC4 if p66 => {
            // pinsrw xmm, r32/m16, imm8
            let v = g!(e, e.get(crate::cpu::rm_loc(e, &m, next, 16, rex), 16)) as u16;
            let mut a = u16s(dst); a[(imm & 7) as usize] = v; out = Some(from_u16s(a));
        }
        0xC5 if p66 && m.md == 3 => {
            // pextrw r32, xmm, imm8
            let v = u16s(e.cpu.xmm[m.rm as usize])[(imm & 7) as usize] as u64;
            let _ = e.set(Loc::Reg(m.reg, false), 32, v);
        }
        0xC6 => {
            let s = g!(e, e.xsrc(&m, next, 16));
            out = Some(if p66 {
                let (a, b) = (u64s(dst), u64s(s)); from_u64s([a[(imm & 1) as usize], b[((imm >> 1) & 1) as usize]])
            } else {
                let (a, b) = (u32s(dst), u32s(s));
                from_u32s([a[(imm & 3) as usize], a[((imm >> 2) & 3) as usize], b[((imm >> 4) & 3) as usize], b[((imm >> 6) & 3) as usize]])
            });
        }
        0x6E => {
            let sz = if w { 64 } else { 32 };
            let v = g!(e, e.get(crate::cpu::rm_loc(e, &m, next, sz, rex), sz));
            out = Some(v as u128);
        }
        0x6F => out = Some(g!(e, e.xsrc(&m, next, 16))),
        0x7E => {
            if rep == 0xF3 { out = Some(g!(e, e.xsrc(&m, next, 8)) & u64::MAX as u128); }
            else { let sz = if w { 64 } else { 32 }; let l = crate::cpu::rm_loc(e, &m, next, sz, rex); g!(e, e.set(l, sz, dst as u64)); }
        }
        0xD6 => {
            if m.md == 3 { e.cpu.xmm[m.rm as usize] = dst & u64::MAX as u128; } else { g!(e, e.xstore(&m, next, 8, dst)); }
        }
        0xD7 => { let b = u8s(dst_of(e, &m)); let v = (0..16).fold(0u64, |acc, i| acc | (((b[i] >> 7) as u64) << i)); let _ = e.set(Loc::Reg(m.reg, false), 32, v); }
        0x70 => {
            let s = g!(e, e.xsrc(&m, next, 16));
            out = Some(match rep {
                0 => { let a = u32s(s); from_u32s(core::array::from_fn(|i| a[((imm >> (2 * i)) & 3) as usize])) }
                0xF2 => { let a = u16s(s); let mut o = a; for i in 0..4 { o[i] = a[((imm >> (2 * i)) & 3) as usize]; } from_u16s(o) }
                _ => { let a = u16s(s); let mut o = a; for i in 0..4 { o[4 + i] = a[4 + ((imm >> (2 * i)) & 3) as usize]; } from_u16s(o) }
            });
        }
        0x71..=0x73 => {
            let t = m.rm as usize;
            let v = e.cpu.xmm[t];
            let n = imm as u32;
            e.cpu.xmm[t] = shift(v, op, m.reg & 7, n);
        }
        0xD1..=0xD3 | 0xE1 | 0xE2 | 0xF1..=0xF3 => {
            let s = g!(e, e.xsrc(&m, next, 16));
            let n = if (s >> 64) != 0 || (s as u64) > 255 { 255 } else { s as u32 };
            let (grp, sub) = match op { 0xD1 => (0x71, 2), 0xD2 => (0x72, 2), 0xD3 => (0x73, 2), 0xE1 => (0x71, 4), 0xE2 => (0x72, 4), 0xF1 => (0x71, 6), 0xF2 => (0x72, 6), _ => (0x73, 6) };
            out = Some(shift(dst, grp, sub, n));
        }
        0xE6 => {
            let s = g!(e, e.xsrc(&m, next, if rep == 0xF3 { 8 } else { 16 }));
            out = Some(match rep {
                0xF3 => { let a = u32s(s); from_f64s([a[0] as i32 as f64, a[1] as i32 as f64]) }
                0xF2 => { let a = f64s(s); from_u32s([cvt_i32(a[0], false), cvt_i32(a[1], false), 0, 0]) }
                _ => { let a = f64s(s); from_u32s([cvt_i32(a[0], true), cvt_i32(a[1], true), 0, 0]) }
            });
        }
        _ => {
            // 66-prefixed integer ops on full registers
            let s = g!(e, e.xsrc(&m, next, 16));
            out = Some(match op {
                0x60 => { let (a, b) = (u8s(dst), u8s(s)); from_u8s(core::array::from_fn(|i| if i % 2 == 0 { a[i / 2] } else { b[i / 2] })) }
                0x61 => { let (a, b) = (u16s(dst), u16s(s)); from_u16s(core::array::from_fn(|i| if i % 2 == 0 { a[i / 2] } else { b[i / 2] })) }
                0x62 => { let (a, b) = (u32s(dst), u32s(s)); from_u32s([a[0], b[0], a[1], b[1]]) }
                0x68 => { let (a, b) = (u8s(dst), u8s(s)); from_u8s(core::array::from_fn(|i| if i % 2 == 0 { a[8 + i / 2] } else { b[8 + i / 2] })) }
                0x69 => { let (a, b) = (u16s(dst), u16s(s)); from_u16s(core::array::from_fn(|i| if i % 2 == 0 { a[4 + i / 2] } else { b[4 + i / 2] })) }
                0x6A => { let (a, b) = (u32s(dst), u32s(s)); from_u32s([a[2], b[2], a[3], b[3]]) }
                0x6C => { let (a, b) = (u64s(dst), u64s(s)); from_u64s([a[0], b[0]]) }
                0x6D => { let (a, b) = (u64s(dst), u64s(s)); from_u64s([a[1], b[1]]) }
                0x63 => { let (a, b) = (u16s(dst), u16s(s)); from_u8s(core::array::from_fn(|i| sat_i8(if i < 8 { a[i] } else { b[i - 8] } as i16 as i32))) }
                0x67 => { let (a, b) = (u16s(dst), u16s(s)); from_u8s(core::array::from_fn(|i| sat_u8(if i < 8 { a[i] } else { b[i - 8] } as i16 as i32))) }
                0x6B => { let (a, b) = (u32s(dst), u32s(s)); from_u16s(core::array::from_fn(|i| sat_i16(if i < 4 { a[i] } else { b[i - 4] } as i32))) }
                0x64 => map_u8(dst, s, |a, b| if (a as i8) > (b as i8) { 0xFF } else { 0 }),
                0x65 => map_u16(dst, s, |a, b| if (a as i16) > (b as i16) { 0xFFFF } else { 0 }),
                0x66 => map_u32(dst, s, |a, b| if (a as i32) > (b as i32) { u32::MAX } else { 0 }),
                0x74 => map_u8(dst, s, |a, b| if a == b { 0xFF } else { 0 }),
                0x75 => map_u16(dst, s, |a, b| if a == b { 0xFFFF } else { 0 }),
                0x76 => map_u32(dst, s, |a, b| if a == b { u32::MAX } else { 0 }),
                0xD4 => map_u64(dst, s, |a, b| a.wrapping_add(b)),
                0xD5 => map_u16(dst, s, |a, b| a.wrapping_mul(b)),
                0xD8 => map_u8(dst, s, |a, b| a.saturating_sub(b)),
                0xD9 => map_u16(dst, s, |a, b| a.saturating_sub(b)),
                0xDA => map_u8(dst, s, |a, b| a.min(b)),
                0xDB => dst & s,
                0xDC => map_u8(dst, s, |a, b| a.saturating_add(b)),
                0xDD => map_u16(dst, s, |a, b| a.saturating_add(b)),
                0xDE => map_u8(dst, s, |a, b| a.max(b)),
                0xDF => !dst & s,
                0xE0 => map_u8(dst, s, |a, b| ((a as u16 + b as u16 + 1) >> 1) as u8),
                0xE3 => map_u16(dst, s, |a, b| ((a as u32 + b as u32 + 1) >> 1) as u16),
                0xE4 => map_u16(dst, s, |a, b| ((a as u32 * b as u32) >> 16) as u16),
                0xE5 => map_u16(dst, s, |a, b| ((a as i16 as i32 * b as i16 as i32) >> 16) as u16),
                0xE8 => map_u8(dst, s, |a, b| sat_i8(a as i8 as i32 - b as i8 as i32)),
                0xE9 => map_u16(dst, s, |a, b| sat_i16(a as i16 as i32 - b as i16 as i32)),
                0xEA => map_u16(dst, s, |a, b| (a as i16).min(b as i16) as u16),
                0xEB => dst | s,
                0xEC => map_u8(dst, s, |a, b| sat_i8(a as i8 as i32 + b as i8 as i32)),
                0xED => map_u16(dst, s, |a, b| sat_i16(a as i16 as i32 + b as i16 as i32)),
                0xEE => map_u16(dst, s, |a, b| (a as i16).max(b as i16) as u16),
                0xEF => dst ^ s,
                0xF4 => { let (a, b) = (u64s(dst), u64s(s)); from_u64s([(a[0] as u32 as u64) * (b[0] as u32 as u64), (a[1] as u32 as u64) * (b[1] as u32 as u64)]) }
                0xF5 => { let (a, b) = (u16s(dst), u16s(s)); from_u32s(core::array::from_fn(|i| (a[2 * i] as i16 as i32 * b[2 * i] as i16 as i32).wrapping_add(a[2 * i + 1] as i16 as i32 * b[2 * i + 1] as i16 as i32) as u32)) }
                0xF6 => { let (a, b) = (u8s(dst), u8s(s)); let lo: u64 = (0..8).map(|i| (a[i] as i32 - b[i] as i32).unsigned_abs() as u64).sum(); let hi: u64 = (8..16).map(|i| (a[i] as i32 - b[i] as i32).unsigned_abs() as u64).sum(); from_u64s([lo, hi]) }
                0xF8 => map_u8(dst, s, |a, b| a.wrapping_sub(b)),
                0xF9 => map_u16(dst, s, |a, b| a.wrapping_sub(b)),
                0xFA => map_u32(dst, s, |a, b| a.wrapping_sub(b)),
                0xFB => map_u64(dst, s, |a, b| a.wrapping_sub(b)),
                0xFC => map_u8(dst, s, |a, b| a.wrapping_add(b)),
                0xFD => map_u16(dst, s, |a, b| a.wrapping_add(b)),
                0xFE => map_u32(dst, s, |a, b| a.wrapping_add(b)),
                _ => { e.unsupported(buf); return true; }
            });
        }
    }
    if e.s.error.is_some() { return true; }
    if let Some(v) = out { e.cpu.xmm[r] = v; }
    e.cpu.rip = next;
    let _ = reg_loc;
    true
}

fn dst_of(e: &Engine, m: &ModRm) -> u128 { e.cpu.xmm[m.rm as usize] }

/// Shift groups 0x71 (words), 0x72 (dwords), 0x73 (qwords / whole-register bytes).
fn shift(v: u128, grp: u8, sub: u8, n: u32) -> u128 {
    match (grp, sub) {
        (0x71, 2) => from_u16s(u16s(v).map(|x| if n > 15 { 0 } else { x >> n })),
        (0x71, 4) => from_u16s(u16s(v).map(|x| ((x as i16) >> n.min(15)) as u16)),
        (0x71, 6) => from_u16s(u16s(v).map(|x| if n > 15 { 0 } else { x << n })),
        (0x72, 2) => from_u32s(u32s(v).map(|x| if n > 31 { 0 } else { x >> n })),
        (0x72, 4) => from_u32s(u32s(v).map(|x| ((x as i32) >> n.min(31)) as u32)),
        (0x72, 6) => from_u32s(u32s(v).map(|x| if n > 31 { 0 } else { x << n })),
        (0x73, 2) => from_u64s(u64s(v).map(|x| if n > 63 { 0 } else { x >> n })),
        (0x73, 6) => from_u64s(u64s(v).map(|x| if n > 63 { 0 } else { x << n })),
        (0x73, 3) => if n > 15 { 0 } else { v >> (8 * n) },
        (0x73, 7) => if n > 15 { 0 } else { v << (8 * n) },
        _ => v,
    }
}
