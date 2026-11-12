// 80-bit extended floats in software (the x87 format): 64-bit mantissa,
// correctly rounded + - * / sqrt. musl's printf/strtod rely on this precision.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct F80 { pub neg: bool, pub exp: i32, pub man: u64 } // value = man * 2^(exp - 63)

const SPECIAL: i32 = i32::MAX; // inf (man 0) or NaN
const QNAN: u64 = 0xC000_0000_0000_0000;

impl F80 {
    pub const ZERO: F80 = F80 { neg: false, exp: 0, man: 0 };
    pub const NAN: F80 = F80 { neg: false, exp: SPECIAL, man: QNAN };
    pub fn inf(neg: bool) -> F80 { F80 { neg, exp: SPECIAL, man: 0 } }
    pub fn is_nan(self) -> bool { self.exp == SPECIAL && self.man != 0 }
    pub fn is_inf(self) -> bool { self.exp == SPECIAL && self.man == 0 }
    pub fn is_zero(self) -> bool { self.man == 0 && self.exp != SPECIAL }
    pub fn neg(self) -> F80 { F80 { neg: !self.neg, ..self } }
    pub fn abs(self) -> F80 { F80 { neg: false, ..self } }

    /// Rounds m * 2^(e - 127) to 64 bits (rc: 0 nearest, 1 down, 2 up, 3 toward zero).
    fn round(neg: bool, e: i32, m: u128, rc: u16) -> F80 {
        if m == 0 { return F80 { neg, exp: 0, man: 0 }; }
        let lz = m.leading_zeros() as i32;
        let m = m << lz;
        let mut e = e - lz;
        let (mut hi, lo) = ((m >> 64) as u64, m as u64);
        let up = match rc { 0 => lo > 1 << 63 || (lo == 1 << 63 && hi & 1 == 1), 1 => neg && lo != 0, 2 => !neg && lo != 0, _ => false };
        if up { hi = hi.wrapping_add(1); if hi == 0 { hi = 1 << 63; e += 1; } }
        if e > 16383 { return F80::inf(neg); }
        if e < -16382 - 64 { return F80 { neg, exp: 0, man: 0 }; }
        F80 { neg, exp: e, man: hi }
    }

    pub fn from_f64(v: f64) -> F80 {
        let b = v.to_bits();
        let neg = b >> 63 != 0;
        let ex = ((b >> 52) & 0x7FF) as i32;
        let fr = b & ((1 << 52) - 1);
        if ex == 0x7FF { return if fr == 0 { F80::inf(neg) } else { F80 { neg, ..F80::NAN } }; }
        if ex == 0 { if fr == 0 { return F80 { neg, exp: 0, man: 0 }; } return F80::round(neg, -1074 + 127, fr as u128, 0); }
        F80 { neg, exp: ex - 1023, man: (1 << 63) | (fr << 11) }
    }
    pub fn to_f64(self) -> f64 {
        if self.is_nan() { return f64::NAN; }
        if self.is_inf() { return if self.neg { f64::NEG_INFINITY } else { f64::INFINITY }; }
        if self.man == 0 { return if self.neg { -0.0 } else { 0.0 }; }
        let s = if self.neg { 1u64 << 63 } else { 0 };
        if self.exp >= -1022 {
            let mut m = self.man >> 11;
            let rest = self.man & 0x7FF;
            let mut e = self.exp;
            if rest > 0x400 || (rest == 0x400 && m & 1 == 1) { m += 1; if m == 1 << 53 { m >>= 1; e += 1; } }
            if e > 1023 { return f64::from_bits(s | 0x7FF0_0000_0000_0000); }
            return f64::from_bits(s | ((e + 1023) as u64) << 52 | (m & ((1 << 52) - 1)));
        }
        // subnormal result
        let sh = (-1022 - self.exp) as u32 + 11;
        if sh >= 64 { return f64::from_bits(s); }
        let mut m = self.man >> sh;
        let rest = self.man & ((1u64 << sh) - 1);
        let half = 1u64 << (sh - 1);
        if rest > half || (rest == half && m & 1 == 1) { m += 1; }
        f64::from_bits(s | m)
    }
    pub fn from_i64(v: i64) -> F80 { F80::round(v < 0, 127, v.unsigned_abs() as u128, 0) }

    pub fn from_bytes(b: &[u8; 10]) -> F80 {
        let man = u64::from_le_bytes(b[0..8].try_into().unwrap());
        let se = u16::from_le_bytes([b[8], b[9]]);
        let neg = se & 0x8000 != 0;
        let ex = (se & 0x7FFF) as i32;
        if ex == 0x7FFF { return if man << 1 == 0 { F80::inf(neg) } else { F80 { neg, exp: SPECIAL, man: man | QNAN } }; }
        if man == 0 { return F80 { neg, exp: 0, man: 0 }; }
        // value = man * 2^(ex - 16383 - 63) (ex 0: denormal, exponent 1 - 16383)
        let e = if ex == 0 { 1 - 16383 } else { ex - 16383 };
        F80::round(neg, e + 64, man as u128, 0) // man * 2^(e-63) = man * 2^((e+64) - 127)
    }
    pub fn to_bytes(self) -> [u8; 10] {
        let mut b = [0u8; 10];
        let (se, man) = if self.exp == SPECIAL { (0x7FFFu16, if self.man == 0 { 1 << 63 } else { self.man | QNAN }) }
            else if self.man == 0 { (0, 0) }
            else if self.exp < -16382 { (0, self.man >> ((-16382 - self.exp) as u32).min(63)) }
            else { ((self.exp + 16383) as u16, self.man) };
        b[0..8].copy_from_slice(&man.to_le_bytes());
        b[8..10].copy_from_slice(&(se | if self.neg { 0x8000 } else { 0 }).to_le_bytes());
        b
    }

    fn mag_lt(a: F80, b: F80) -> bool { if a.man == 0 { return b.man != 0; } if b.man == 0 { return false; } (a.exp, a.man) < (b.exp, b.man) }

    pub fn add(a: F80, b: F80, rc: u16) -> F80 {
        if a.is_nan() || b.is_nan() { return F80::NAN; }
        if a.is_inf() || b.is_inf() {
            if a.is_inf() && b.is_inf() && a.neg != b.neg { return F80::NAN; }
            return if a.is_inf() { a } else { b };
        }
        if a.man == 0 && b.man == 0 { return F80 { neg: if a.neg == b.neg { a.neg } else { rc == 1 }, exp: 0, man: 0 }; }
        if a.man == 0 { return b; }
        if b.man == 0 { return a; }
        let (x, y) = if F80::mag_lt(a, b) { (b, a) } else { (a, b) };
        let mx = (x.man as u128) << 63; // one bit of headroom
        let d = (x.exp - y.exp) as u32;
        let mut my = (y.man as u128) << 63;
        if d >= 127 { my = 1; } else if d > 0 { let st = my & ((1u128 << d) - 1) != 0; my >>= d; my |= st as u128; }
        if x.neg == y.neg { F80::round(x.neg, x.exp + 1, mx + my, rc) } else {
            let m = mx - my;
            if m == 0 { return F80 { neg: rc == 1, exp: 0, man: 0 }; }
            F80::round(x.neg, x.exp + 1, m, rc)
        }
    }
    pub fn sub(a: F80, b: F80, rc: u16) -> F80 { F80::add(a, b.neg(), rc) }
    pub fn mul(a: F80, b: F80, rc: u16) -> F80 {
        let neg = a.neg != b.neg;
        if a.is_nan() || b.is_nan() { return F80::NAN; }
        if a.is_inf() || b.is_inf() { return if a.is_zero() || b.is_zero() { F80::NAN } else { F80::inf(neg) }; }
        if a.man == 0 || b.man == 0 { return F80 { neg, exp: 0, man: 0 }; }
        F80::round(neg, a.exp + b.exp + 1, a.man as u128 * b.man as u128, rc)
    }
    pub fn div(a: F80, b: F80, rc: u16) -> F80 {
        let neg = a.neg != b.neg;
        if a.is_nan() || b.is_nan() { return F80::NAN; }
        if a.is_inf() { return if b.is_inf() { F80::NAN } else { F80::inf(neg) }; }
        if b.is_inf() { return F80 { neg, exp: 0, man: 0 }; }
        if b.man == 0 { return if a.man == 0 { F80::NAN } else { F80::inf(neg) }; }
        if a.man == 0 { return F80 { neg, exp: 0, man: 0 }; }
        let num = (a.man as u128) << 63;
        let d = b.man as u128;
        let (q, r) = (num / d, num % d);
        let (q2, r2) = ((r << 64) / d, (r << 64) % d);
        let m = (q << 64) | q2 | (r2 != 0) as u128;
        F80::round(neg, a.exp - b.exp, m, rc)
    }
    pub fn sqrt(a: F80, rc: u16) -> F80 {
        if a.is_nan() || (a.neg && a.man != 0) { return F80::NAN; }
        if a.man == 0 || a.is_inf() { return a; }
        let mut k = a.exp - 63 - 64;
        let mut m = (a.man as u128) << 64;
        if k & 1 != 0 { m >>= 1; k += 1; }
        let mut r = ((m as f64).sqrt() as u128).max(1);
        for _ in 0..3 { r = (r + m / r) / 2; }
        while r.checked_mul(r).map_or(true, |x| x > m) { r -= 1; }
        while (r + 1).checked_mul(r + 1).map_or(false, |x| x <= m) { r += 1; }
        let rem = m - r * r;
        let up = match rc { 0 => rem > r, 2 => rem != 0, _ => false };
        let r = r + up as u128;
        F80::round(false, k / 2 + 127, r, 0)
    }

    /// Partial ordering: None = unordered (NaN).
    pub fn cmp(a: F80, b: F80) -> Option<core::cmp::Ordering> {
        use core::cmp::Ordering::*;
        if a.is_nan() || b.is_nan() { return None; }
        if a.man == 0 && b.man == 0 && !a.is_inf() && !b.is_inf() { return Some(Equal); }
        if a.neg != b.neg { return Some(if a.neg { Less } else { Greater }); }
        let key = |x: F80| if x.is_inf() { (i32::MAX, u64::MAX) } else if x.man == 0 { (i32::MIN, 0) } else { (x.exp, x.man) };
        let o = key(a).cmp(&key(b));
        Some(if a.neg { o.reverse() } else { o })
    }

    /// Rounds to an integer value (frndint).
    pub fn round_int(self, rc: u16) -> F80 {
        if self.exp == SPECIAL || self.man == 0 || self.exp >= 63 { return self; }
        if self.exp < -1 {
            let up = match rc { 1 => self.neg, 2 => !self.neg, _ => false };
            return if up { F80 { neg: self.neg, exp: 0, man: 1 << 63 } } else { F80 { neg: self.neg, exp: 0, man: 0 } };
        }
        let fb = (63 - self.exp) as u32; // fraction bits (1..=64)
        let ip = if fb == 64 { 0 } else { self.man >> fb };
        let frac = if fb == 64 { self.man } else { self.man & ((1u64 << fb) - 1) };
        let half = 1u64 << (fb - 1);
        let up = match rc { 0 => frac > half || (frac == half && ip & 1 == 1), 1 => self.neg && frac != 0, 2 => !self.neg && frac != 0, _ => false };
        let v = ip as u128 + up as u128;
        if v == 0 { return F80 { neg: self.neg, exp: 0, man: 0 }; }
        F80::round(self.neg, 127, v, 0)
    }
    /// Integer value (after rounding with rc); None = does not fit in i64.
    pub fn to_i64(self, rc: u16) -> Option<i64> {
        let r = self.round_int(rc);
        if r.exp == SPECIAL { return None; }
        if r.man == 0 { return Some(0); }
        if r.exp > 63 { return None; }
        let v = (r.man >> (63 - r.exp)) as u128;
        if r.neg { if v > 1 << 63 { None } else { Some((v as i128).wrapping_neg() as i64) } } else if v >= 1 << 63 { None } else { Some(v as i64) }
    }
    /// Exact remainder with truncated quotient (fprem) or nearest quotient (fprem1).
    pub fn rem(a: F80, b: F80, nearest: bool) -> F80 {
        if a.exp == SPECIAL || b.is_nan() || b.man == 0 { return if b.is_inf() && !a.is_inf() { a } else { F80::NAN }; }
        if a.man == 0 { return a; }
        if a.exp < b.exp {
            // |a| < |b| (mostly): fprem keeps a, fprem1 subtracts b when a is past half of it
            if F80::mag_lt(a, b) {
                if nearest && F80::mag_lt(F80 { exp: b.exp - 1, ..b }, a.abs()) { return F80::sub(a, F80 { neg: a.neg, ..b }, 0); }
                return a;
            }
        }
        let mut rm = a.man as u128;
        let bm = b.man as u128;
        let mut q = 0u128;
        let d = a.exp - b.exp;
        let mut k = d;
        loop {
            q <<= 1;
            if rm >= bm { rm -= bm; q |= 1; }
            if k <= 0 { break; }
            rm <<= 1;
            k -= 1;
        }
        // rm * 2^(b.exp - 63) with |rm| < bm
        let mut r = F80::round(a.neg, b.exp + 64, rm, 0);
        if nearest && rm != 0 {
            let twice = rm * 2;
            if twice > bm || (twice == bm && q & 1 == 1) { r = F80::sub(r, F80 { neg: a.neg, ..b }, 0); }
        }
        r
    }
}
