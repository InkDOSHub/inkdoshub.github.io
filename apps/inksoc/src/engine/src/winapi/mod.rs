// More of the Windows API, written so that real programs start: what Wine's
// ucrtbase.dll / msvcp140.dll (loaded as program code) and typical console
// programs (Rust, Go, MSVC C/C++) ask kernel32, ntdll and friends for.
// Locale: one fixed locale (en-US, UTF-8). Time: UTC.

use crate::{console, Engine};

mod locale;
mod misc;
mod module;
mod process;
mod rtl;
mod system;

const ERROR_INVALID_PARAMETER: u32 = 87;
const ERROR_NO_MORE_ITEMS: u32 = 259;
const ERROR_FILE_NOT_FOUND: u32 = 2;
const ERROR_NOT_SUPPORTED: u32 = 50;

impl Engine {
    /// Writes s (wide, NUL-terminated) into a buffer of n chars; returns the length
    /// without the NUL, or the size needed (with the NUL) when it does not fit.
    fn out_w(&mut self, buf: u64, n: u64, s: &str) -> u64 {
        let w: Vec<u16> = s.encode_utf16().collect();
        if buf == 0 || n <= w.len() as u64 {
            return w.len() as u64 + 1;
        }
        for (i, c) in w.iter().enumerate() {
            self.w16(buf + 2 * i as u64, *c);
        }
        self.w16(buf + 2 * w.len() as u64, 0);
        w.len() as u64
    }
    fn out_a(&mut self, buf: u64, n: u64, s: &str) -> u64 {
        if buf == 0 || n <= s.len() as u64 {
            return s.len() as u64 + 1;
        }
        let _ = self.mmu.write_bytes(buf, s.as_bytes());
        self.w8(buf + s.len() as u64, 0);
        s.len() as u64
    }
    /// Counted wide string (n < 0: NUL-terminated).
    fn wstr_n(&mut self, a: u64, n: i64) -> Vec<u16> {
        let mut v = Vec::new();
        let mut i = 0u64;
        loop {
            if n >= 0 && i >= n as u64 {
                break;
            }
            let c = self.r16(a + 2 * i);
            if n < 0 && c == 0 {
                break;
            }
            v.push(c);
            i += 1;
            if i > 1 << 24 {
                break;
            }
        }
        v
    }
    fn astr_n(&mut self, a: u64, n: i64) -> Vec<u8> {
        let mut v = Vec::new();
        let mut i = 0u64;
        loop {
            if n >= 0 && i >= n as u64 {
                break;
            }
            let c = self.r8(a + i);
            if n < 0 && c == 0 {
                break;
            }
            v.push(c);
            i += 1;
            if i > 1 << 24 {
                break;
            }
        }
        v
    }

    fn system_time(&mut self, a: u64) {
        let ms = crate::epoch_ms() as i64;
        let days = ms.div_euclid(86_400_000);
        let rem = ms.rem_euclid(86_400_000);
        let (y, m, d, dow) = civil_1970(days);
        for (i, v) in [
            y as u16,
            m as u16,
            dow as u16,
            d as u16,
            (rem / 3_600_000) as u16,
            (rem / 60_000 % 60) as u16,
            (rem / 1000 % 60) as u16,
            (rem % 1000) as u16,
        ]
        .iter()
        .enumerate()
        {
            self.w16(a + 2 * i as u64, *v);
        }
    }

    fn module_at(&self, pc: u64) -> Option<u64> {
        self.s.modules.iter().find(|m| pc >= m.base && pc < m.base + m.size).map(|m| m.base)
    }

    fn env_block(&mut self, wide: bool) -> u64 {
        let a = self.heap_alloc(16, true);
        let _ = wide;
        a
    }
}

/// Days since 1970-01-01 -> (year, month, day, weekday 0 = Sunday).
fn civil_1970(z: i64) -> (i64, u32, u32, u32) {
    let dow = (z + 4).rem_euclid(7) as u32;
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + (m <= 2) as i64, m, d, dow)
}

/// CT_CTYPE1 bits of one character.
fn ctype1(c: u32) -> u16 {
    let ch = char::from_u32(c).unwrap_or('\u{FFFD}');
    let mut t = 0x200u16; // C1_DEFINED
    if ch.is_uppercase() {
        t |= 0x1 | 0x100;
    }
    if ch.is_lowercase() {
        t |= 0x2 | 0x100;
    }
    if ch.is_ascii_digit() {
        t |= 0x4;
    }
    if ch.is_whitespace() {
        t |= 0x8;
    }
    if ch.is_ascii_punctuation() {
        t |= 0x10;
    }
    if ch.is_control() {
        t |= 0x20;
    }
    if ch == ' ' || ch == '\t' {
        t |= 0x40;
    }
    if ch.is_ascii_hexdigit() {
        t |= 0x80;
    }
    if ch.is_alphabetic() {
        t |= 0x100;
    }
    t
}

fn fold(c: u16, ignore_case: bool) -> u32 {
    if !ignore_case {
        return c as u32;
    }
    char::from_u32(c as u32).map(|ch| ch.to_lowercase().next().unwrap_or(ch) as u32).unwrap_or(c as u32)
}

fn compare(a: &[u16], b: &[u16], flags: u32) -> u64 {
    let ic = flags & 0x1 != 0 || flags & 0x1000_0000 != 0; // NORM_IGNORECASE, LINGUISTIC_IGNORECASE
    let x: Vec<u32> = a.iter().map(|&c| fold(c, ic)).collect();
    let y: Vec<u32> = b.iter().map(|&c| fold(c, ic)).collect();
    match x.cmp(&y) {
        std::cmp::Ordering::Less => 1,
        std::cmp::Ordering::Equal => 2,
        _ => 3,
    }
}

fn map_case(v: &[u16], flags: u32) -> Vec<u16> {
    let s = String::from_utf16_lossy(v);
    let s = if flags & 0x100 != 0 {
        s.to_lowercase()
    } else if flags & 0x200 != 0 {
        s.to_uppercase()
    } else {
        s
    };
    s.encode_utf16().collect()
}

/// GetLocaleInfo answers for the fixed en-US locale.
fn locale_info(t: u32) -> Option<String> {
    Some(match t & 0x0FFF_FFFF & !0x8000_0000 {
        0x01 => "0409".into(), // LOCALE_ILANGUAGE
        0x02 | 0x1001 => "English (United States)".into(),
        0x03 | 0x59 => "en".into(), // LOCALE_SABBREVLANGNAME (ENU in reality), SISO639LANGNAME
        0x5A => "US".into(),        // SISO3166CTRYNAME
        0x5C => "en-US".into(),     // SNAME
        0x06 | 0x1002 => "United States".into(),
        0x07 => "USA".into(),
        0x0B => "437".into(),     // IDEFAULTCODEPAGE (OEM)
        0x1004 => "65001".into(), // IDEFAULTANSICODEPAGE
        0x0C => ",".into(),       // SLIST
        0x0E => ".".into(),       // SDECIMAL
        0x0F => ",".into(),       // STHOUSAND
        0x10 => "3;0".into(),     // SGROUPING
        0x11 => "2".into(),       // IDIGITS
        0x12 => "1".into(),       // ILZERO
        0x14 => "$".into(),       // SCURRENCY
        0x16 => ".".into(),
        0x17 => ",".into(),
        0x18 => "3;0".into(),
        0x50 => "".into(),         // SPOSITIVESIGN
        0x51 => "-".into(),        // SNEGATIVESIGN
        0x1D => "/".into(),        // SDATE
        0x1E => ":".into(),        // STIME
        0x1F => "M/d/yyyy".into(), // SSHORTDATE
        0x20 => "dddd, MMMM d, yyyy".into(),
        0x1003 => "h:mm:ss tt".into(), // STIMEFORMAT
        0x28 => "AM".into(),
        0x29 => "PM".into(),
        0x2A..=0x30 => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(t - 0x2A) as usize].into(),
        0x31..=0x37 => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(t - 0x31) as usize].into(),
        0x38..=0x43 => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
            [(t - 0x38) as usize]
            .into(),
        0x44..=0x4F => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(t - 0x44) as usize].into(),
        _ => return None,
    })
}

/// Each family of calls lives in its own file; the first one that knows the name answers.
pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    const FAMILIES: [fn(&mut Engine, &str) -> Option<u64>; 6] = [locale::call, system::call, module::call, process::call, rtl::call, misc::call];
    for family in FAMILIES {
        e.not_mine = false;
        let r = family(e, name);
        if !e.not_mine {
            return r;
        }
    }
    None // e.not_mine stays set: no family has this name
}

/// Windows command-line rules (CommandLineToArgvW).
pub fn split_cmdline(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let c: Vec<char> = s.chars().collect();
    let mut i = 0;
    // program name: up to the next space, or quoted
    let mut cur = String::new();
    if i < c.len() && c[i] == '"' {
        i += 1;
        while i < c.len() && c[i] != '"' {
            cur.push(c[i]);
            i += 1;
        }
        i += 1;
    } else {
        while i < c.len() && c[i] != ' ' && c[i] != '\t' {
            cur.push(c[i]);
            i += 1;
        }
    }
    out.push(cur);
    loop {
        while i < c.len() && (c[i] == ' ' || c[i] == '\t') {
            i += 1;
        }
        if i >= c.len() {
            break;
        }
        let mut cur = String::new();
        let mut q = false;
        while i < c.len() {
            let ch = c[i];
            if ch == '\\' {
                let mut n = 0;
                while i < c.len() && c[i] == '\\' {
                    n += 1;
                    i += 1;
                }
                if i < c.len() && c[i] == '"' {
                    for _ in 0..n / 2 {
                        cur.push('\\');
                    }
                    if n % 2 == 1 {
                        cur.push('"');
                        i += 1;
                    }
                } else {
                    for _ in 0..n {
                        cur.push('\\');
                    }
                }
                continue;
            }
            if ch == '"' {
                if q && i + 1 < c.len() && c[i + 1] == '"' {
                    cur.push('"');
                    i += 2;
                    continue;
                }
                q = !q;
                i += 1;
                continue;
            }
            if !q && (ch == ' ' || ch == '\t') {
                break;
            }
            cur.push(ch);
            i += 1;
        }
        out.push(cur);
    }
    out
}
