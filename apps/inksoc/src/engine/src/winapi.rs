// More of the Windows API, written so that real programs start: what Wine's
// ucrtbase.dll / msvcp140.dll (loaded as program code) and typical console
// programs (Rust, Go, MSVC C/C++) ask kernel32, ntdll and friends for.
// Locale: one fixed locale (en-US, UTF-8). Time: UTC.

use crate::{console, Engine};

const ERROR_INVALID_PARAMETER: u32 = 87;
const ERROR_NO_MORE_ITEMS: u32 = 259;
const ERROR_FILE_NOT_FOUND: u32 = 2;
const ERROR_NOT_SUPPORTED: u32 = 50;

impl Engine {
    fn last_err(&mut self, v: u32) { let _ = self.mmu.write32(self.cpu.gs_base + 0x68, v); }
    fn wr16(&mut self, a: u64, v: u16) { if a != 0 { let _ = self.mmu.write16(a, v); } }
    fn wr32(&mut self, a: u64, v: u32) { if a != 0 { let _ = self.mmu.write32(a, v); } }
    fn wr64(&mut self, a: u64, v: u64) { if a != 0 { let _ = self.mmu.write64(a, v); } }

    /// Writes s (wide, NUL-terminated) into a buffer of n chars; returns the length
    /// without the NUL, or the size needed (with the NUL) when it does not fit.
    fn out_w(&mut self, buf: u64, n: u64, s: &str) -> u64 {
        let w: Vec<u16> = s.encode_utf16().collect();
        if buf == 0 || n <= w.len() as u64 { return w.len() as u64 + 1; }
        for (i, c) in w.iter().enumerate() { let _ = self.mmu.write16(buf + 2 * i as u64, *c); }
        let _ = self.mmu.write16(buf + 2 * w.len() as u64, 0);
        w.len() as u64
    }
    fn out_a(&mut self, buf: u64, n: u64, s: &str) -> u64 {
        if buf == 0 || n <= s.len() as u64 { return s.len() as u64 + 1; }
        let _ = self.mmu.write_bytes(buf, s.as_bytes());
        let _ = self.mmu.write8(buf + s.len() as u64, 0);
        s.len() as u64
    }
    /// Counted wide string (n < 0: NUL-terminated).
    fn wstr_n(&mut self, a: u64, n: i64) -> Vec<u16> {
        let mut v = Vec::new();
        let mut i = 0u64;
        loop {
            if n >= 0 && i >= n as u64 { break; }
            let c = self.mmu.read16(a + 2 * i).unwrap_or(0);
            if n < 0 && c == 0 { break; }
            v.push(c);
            i += 1;
            if i > 1 << 24 { break; }
        }
        v
    }
    fn astr_n(&mut self, a: u64, n: i64) -> Vec<u8> {
        let mut v = Vec::new();
        let mut i = 0u64;
        loop {
            if n >= 0 && i >= n as u64 { break; }
            let c = self.mmu.read8(a + i).unwrap_or(0);
            if n < 0 && c == 0 { break; }
            v.push(c);
            i += 1;
            if i > 1 << 24 { break; }
        }
        v
    }

    fn system_time(&mut self, a: u64) {
        let ms = unsafe { crate::host_epoch_ms() } as i64;
        let days = ms.div_euclid(86_400_000);
        let rem = ms.rem_euclid(86_400_000);
        let (y, m, d, dow) = civil_1970(days);
        for (i, v) in [y as u16, m as u16, dow as u16, d as u16, (rem / 3_600_000) as u16, (rem / 60_000 % 60) as u16, (rem / 1000 % 60) as u16, (rem % 1000) as u16].iter().enumerate() {
            self.wr16(a + 2 * i as u64, *v);
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
    if ch.is_uppercase() { t |= 0x1 | 0x100; }
    if ch.is_lowercase() { t |= 0x2 | 0x100; }
    if ch.is_ascii_digit() { t |= 0x4; }
    if ch.is_whitespace() { t |= 0x8; }
    if ch.is_ascii_punctuation() { t |= 0x10; }
    if ch.is_control() { t |= 0x20; }
    if ch == ' ' || ch == '\t' { t |= 0x40; }
    if ch.is_ascii_hexdigit() { t |= 0x80; }
    if ch.is_alphabetic() { t |= 0x100; }
    t
}

fn fold(c: u16, ignore_case: bool) -> u32 {
    if !ignore_case { return c as u32; }
    char::from_u32(c as u32).map(|ch| ch.to_lowercase().next().unwrap_or(ch) as u32).unwrap_or(c as u32)
}

fn compare(a: &[u16], b: &[u16], flags: u32) -> u64 {
    let ic = flags & 0x1 != 0 || flags & 0x1000_0000 != 0; // NORM_IGNORECASE, LINGUISTIC_IGNORECASE
    let x: Vec<u32> = a.iter().map(|&c| fold(c, ic)).collect();
    let y: Vec<u32> = b.iter().map(|&c| fold(c, ic)).collect();
    match x.cmp(&y) { std::cmp::Ordering::Less => 1, std::cmp::Ordering::Equal => 2, _ => 3 }
}

fn map_case(v: &[u16], flags: u32) -> Vec<u16> {
    let s = String::from_utf16_lossy(v);
    let s = if flags & 0x100 != 0 { s.to_lowercase() } else if flags & 0x200 != 0 { s.to_uppercase() } else { s };
    s.encode_utf16().collect()
}

/// GetLocaleInfo answers for the fixed en-US locale.
fn locale_info(t: u32) -> Option<String> {
    Some(match t & 0x0FFF_FFFF & !0x8000_0000 {
        0x01 => "0409".into(),            // LOCALE_ILANGUAGE
        0x02 | 0x1001 => "English (United States)".into(),
        0x03 | 0x59 => "en".into(),       // LOCALE_SABBREVLANGNAME (ENU in reality), SISO639LANGNAME
        0x5A => "US".into(),              // SISO3166CTRYNAME
        0x5C => "en-US".into(),           // SNAME
        0x06 | 0x1002 => "United States".into(),
        0x07 => "USA".into(),
        0x0B => "437".into(),             // IDEFAULTCODEPAGE (OEM)
        0x1004 => "65001".into(),         // IDEFAULTANSICODEPAGE
        0x0C => ",".into(),               // SLIST
        0x0E => ".".into(),               // SDECIMAL
        0x0F => ",".into(),               // STHOUSAND
        0x10 => "3;0".into(),             // SGROUPING
        0x11 => "2".into(),               // IDIGITS
        0x12 => "1".into(),               // ILZERO
        0x14 => "$".into(),               // SCURRENCY
        0x16 => ".".into(),
        0x17 => ",".into(),
        0x18 => "3;0".into(),
        0x50 => "".into(),                // SPOSITIVESIGN
        0x51 => "-".into(),               // SNEGATIVESIGN
        0x1D => "/".into(),               // SDATE
        0x1E => ":".into(),               // STIME
        0x1F => "M/d/yyyy".into(),        // SSHORTDATE
        0x20 => "dddd, MMMM d, yyyy".into(),
        0x1003 => "h:mm:ss tt".into(),    // STIMEFORMAT
        0x28 => "AM".into(),
        0x29 => "PM".into(),
        0x2A..=0x30 => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(t - 0x2A) as usize].into(),
        0x31..=0x37 => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(t - 0x31) as usize].into(),
        0x38..=0x43 => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][(t - 0x38) as usize].into(),
        0x44..=0x4F => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(t - 0x44) as usize].into(),
        _ => return None,
    })
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    let r: u64 = match name {
        // ---- Wine's debug channels (always off) ----
        "__wine_dbg_header" => u64::MAX,
        "__wine_dbg_output" | "__wine_dbg_get_channel_flags" => 0,
        "__wine_dbg_strdup" => a0,

        // ---- code pages and locale ----
        "GetACP" | "GetOEMCP" => 65001,
        "IsValidCodePage" => 1,
        "GetCPInfo" => {
            let p = e.arg(1);
            e.wr32(p, if a0 as u32 == 65001 { 4 } else { 1 });
            e.wr16(p + 4, b'?' as u16);
            for i in 0..12 { let _ = e.mmu.write8(p + 6 + i, 0); }
            1
        }
        "GetCPInfoExW" => {
            let p = e.arg(2);
            e.wr32(p, if a0 as u32 == 65001 { 4 } else { 1 });
            e.wr16(p + 4, b'?' as u16);
            for i in 0..12 { let _ = e.mmu.write8(p + 6 + i, 0); }
            e.wr16(p + 18, b'?' as u16);
            e.wr32(p + 20, a0 as u32);
            e.out_w(p + 24, 260, "65001 (UTF-8)");
            1
        }
        "IsDBCSLeadByte" | "IsDBCSLeadByteEx" => 0,
        "GetUserDefaultLCID" | "GetSystemDefaultLCID" | "GetThreadLocale" | "GetUserDefaultLangID" | "GetSystemDefaultLangID" | "GetUserDefaultUILanguage" | "GetSystemDefaultUILanguage" | "LocaleNameToLCID" => 0x409,
        "SetThreadLocale" | "IsValidLocale" | "IsValidLocaleName" | "EnumSystemLocalesW" | "EnumSystemLocalesA" | "EnumSystemLocalesEx" => 1,
        "GetUserDefaultLocaleName" | "GetSystemDefaultLocaleName" => {
            let (buf, n) = if name == "GetUserDefaultLocaleName" { (a0, e.arg(1)) } else { (a0, e.arg(1)) };
            let r = e.out_w(buf, n, "en-US");
            if r > 5 { 0 } else { r + 1 }
        }
        "LCIDToLocaleName" => { let (buf, n) = (e.arg(1), e.arg(2)); let r = e.out_w(buf, n, "en-US"); if r > 5 { 0 } else { r + 1 } }
        "ResolveLocaleName" => { let (buf, n) = (e.arg(1), e.arg(2)); let r = e.out_w(buf, n, "en-US"); if r > 5 { 0 } else { r + 1 } }
        "GetLocaleInfoW" | "GetLocaleInfoA" | "GetLocaleInfoEx" => {
            let (t, buf, n) = (e.arg(1) as u32, e.arg(2), e.arg(3));
            if t & 0x2000_0000 != 0 {
                // LOCALE_RETURN_NUMBER: a DWORD
                let v: u32 = match t & 0xFFFF { 0x1004 => 65001, 0x0B => 437, 0x01 => 0x409, 0x11 => 2, 0x12 => 1, _ => 0 };
                if name == "GetLocaleInfoA" { e.wr32(buf, v); 4 } else { e.wr32(buf, v); 2 }
            } else {
                match locale_info(t) {
                    Some(s) => {
                        if n == 0 { if name == "GetLocaleInfoA" { s.len() as u64 + 1 } else { s.encode_utf16().count() as u64 + 1 } }
                        else if name == "GetLocaleInfoA" { let k = e.out_a(buf, n, &s); if k > s.len() as u64 { e.last_err(122); 0 } else { k + 1 } }
                        else { let k = e.out_w(buf, n, &s); if k > s.encode_utf16().count() as u64 { e.last_err(122); 0 } else { k + 1 } }
                    }
                    None => { e.last_err(ERROR_INVALID_PARAMETER); 0 }
                }
            }
        }
        "CompareStringW" | "CompareStringEx" | "CompareStringA" => {
            let (f, s1, n1, s2, n2) = (e.arg(1) as u32, e.arg(2), e.arg(3) as i32 as i64, e.arg(4), e.arg(5) as i32 as i64);
            if name == "CompareStringA" {
                let a: Vec<u16> = e.astr_n(s1, n1).iter().map(|&c| c as u16).collect();
                let b: Vec<u16> = e.astr_n(s2, n2).iter().map(|&c| c as u16).collect();
                compare(&a, &b, f)
            } else {
                let a = e.wstr_n(s1, n1);
                let b = e.wstr_n(s2, n2);
                compare(&a, &b, f)
            }
        }
        "CompareStringOrdinal" => {
            let (s1, n1, s2, n2, ic) = (a0, e.arg(1) as i32 as i64, e.arg(2), e.arg(3) as i32 as i64, e.arg(4) as u32);
            let a = e.wstr_n(s1, n1);
            let b = e.wstr_n(s2, n2);
            compare(&a, &b, if ic != 0 { 1 } else { 0 })
        }
        "LCMapStringW" | "LCMapStringEx" | "LCMapStringA" => {
            let (f, src, n, dst, dn) = (e.arg(1) as u32, e.arg(2), e.arg(3) as i32 as i64, e.arg(4), e.arg(5) as i32 as u64);
            if name == "LCMapStringA" {
                let v: Vec<u16> = e.astr_n(src, n).iter().map(|&c| c as u16).collect();
                let out = map_case(&v, f);
                if dn == 0 { out.len() as u64 } else {
                    for (i, c) in out.iter().take(dn as usize).enumerate() { let _ = e.mmu.write8(dst + i as u64, *c as u8); }
                    out.len().min(dn as usize) as u64
                }
            } else {
                let v = e.wstr_n(src, n);
                let out = map_case(&v, f);
                if f & 0x400 != 0 {
                    // LCMAP_SORTKEY: bytes that sort like the string
                    let bytes: Vec<u8> = out.iter().flat_map(|c| c.to_be_bytes()).chain([0u8]).collect();
                    if dn == 0 { bytes.len() as u64 } else { let k = bytes.len().min(dn as usize); let _ = e.mmu.write_bytes(dst, &bytes[..k]); k as u64 }
                } else if dn == 0 { out.len() as u64 } else {
                    for (i, c) in out.iter().take(dn as usize).enumerate() { let _ = e.mmu.write16(dst + 2 * i as u64, *c); }
                    out.len().min(dn as usize) as u64
                }
            }
        }
        "GetStringTypeW" | "GetStringTypeExW" => {
            let (t, src, n, out) = if name == "GetStringTypeW" { (a0 as u32, e.arg(1), e.arg(2) as i32 as i64, e.arg(3)) } else { (e.arg(1) as u32, e.arg(2), e.arg(3) as i32 as i64, e.arg(4)) };
            let v = e.wstr_n(src, n);
            for (i, c) in v.iter().enumerate() { let x = if t == 1 { ctype1(*c as u32) } else { 0 }; e.wr16(out + 2 * i as u64, x); }
            1
        }
        "GetStringTypeA" | "GetStringTypeExA" => {
            let (t, src, n, out) = (e.arg(1) as u32, e.arg(2), e.arg(3) as i32 as i64, e.arg(4));
            let v = e.astr_n(src, n);
            for (i, c) in v.iter().enumerate() { let x = if t == 1 { ctype1(*c as u32) } else { 0 }; e.wr16(out + 2 * i as u64, x); }
            1
        }
        "IsBadStringPtrA" | "IsBadStringPtrW" | "IsBadReadPtr" | "IsBadWritePtr" | "IsBadCodePtr" => 0,
        "GetDateFormatW" | "GetTimeFormatW" | "GetDateFormatEx" | "GetTimeFormatEx" | "GetDateFormatA" | "GetTimeFormatA" => { e.last_err(ERROR_NOT_SUPPORTED); 0 }

        // ---- system information ----
        "GetErrorMode" | "SetErrorMode" | "GetThreadErrorMode" => 0,
        "SetThreadErrorMode" => { let p = e.arg(1); e.wr32(p, 0); 1 }
        "GetSystemDirectoryA" | "GetSystemWindowsDirectoryA" | "GetWindowsDirectoryA" => {
            let s = if name == "GetSystemDirectoryA" { "C:\\Windows\\System32" } else { "C:\\Windows" };
            let n = e.arg(1); e.out_a(a0, n, s)
        }
        "GetSystemDirectoryW" | "GetSystemWindowsDirectoryW" | "GetWindowsDirectoryW" => {
            let s = if name == "GetSystemDirectoryW" { "C:\\Windows\\System32" } else { "C:\\Windows" };
            let n = e.arg(1); e.out_w(a0, n, s)
        }
        "GetVersionExW" | "GetVersionExA" => {
            e.wr32(a0 + 4, 10); e.wr32(a0 + 8, 0); e.wr32(a0 + 12, 19045); e.wr32(a0 + 16, 2);
            1
        }
        "RtlGetVersion" => { e.wr32(a0 + 4, 10); e.wr32(a0 + 8, 0); e.wr32(a0 + 12, 19045); e.wr32(a0 + 16, 2); 0 }
        "RtlGetNtVersionNumbers" => { let (b, c) = (e.arg(1), e.arg(2)); e.wr32(a0, 10); e.wr32(b, 0); e.wr32(c, 0xF000_0000 | 19045); 0 }
        "VerSetConditionMask" => a0,
        "VerifyVersionInfoW" | "VerifyVersionInfoA" => 1,
        "RtlVerifyVersionInfo" => 0, // we are Windows 10: every check passes
        "GetComputerNameW" | "GetComputerNameExW" => {
            let (buf, np) = if name == "GetComputerNameW" { (a0, e.arg(1)) } else { (e.arg(1), e.arg(2)) };
            let n = e.mmu.read32(np).unwrap_or(0) as u64;
            let r = e.out_w(buf, n, "INKSOC");
            if r > 6 { e.wr32(np, 7); e.last_err(234); 0 } else { e.wr32(np, r as u32); 1 }
        }
        "GetComputerNameA" => { let np = e.arg(1); let n = e.mmu.read32(np).unwrap_or(0) as u64; let r = e.out_a(a0, n, "INKSOC"); if r > 6 { e.wr32(np, 7); 0 } else { e.wr32(np, r as u32); 1 } }
        "GetUserNameW" => { let np = e.arg(1); let n = e.mmu.read32(np).unwrap_or(0) as u64; let r = e.out_w(a0, n, "user"); if r > 4 { e.wr32(np, 5); e.last_err(122); 0 } else { e.wr32(np, r as u32 + 1); 1 } }
        "GetUserNameA" => { let np = e.arg(1); let n = e.mmu.read32(np).unwrap_or(0) as u64; let r = e.out_a(a0, n, "user"); if r > 4 { e.wr32(np, 5); e.last_err(122); 0 } else { e.wr32(np, r as u32 + 1); 1 } }
        "GetDriveTypeW" | "GetDriveTypeA" => 3,
        "GetLogicalDrives" => 1 << 2,
        "GetCurrentProcessorNumber" => 0,
        "GetCurrentProcessorNumberEx" => { e.wr32(a0, 0); 0 }
        "FlushProcessWriteBuffers" | "MemoryBarrier" => 0,
        "GetNumaHighestNodeNumber" => { e.wr32(a0, 0); 1 }
        "GetPhysicallyInstalledSystemMemory" => { e.wr64(a0, 8 << 20); 1 }
        "QueryUnbiasedInterruptTime" => { let v = unsafe { crate::host_now_ms() * 10_000.0 } as u64; e.wr64(a0, v); 1 }
        "QueryInterruptTime" | "QueryInterruptTimePrecise" => { let v = unsafe { crate::host_now_ms() * 10_000.0 } as u64; e.wr64(a0, v); 0 }

        // ---- time ----
        "GetLocalTime" | "GetSystemTime" => { e.system_time(a0); 0 }
        "GetTimeZoneInformation" | "GetDynamicTimeZoneInformation" => { e.zero(a0, if name == "GetTimeZoneInformation" { 172 } else { 432 }); 0 }
        "SystemTimeToTzSpecificLocalTime" | "TzSpecificLocalTimeToSystemTime" => {
            let (src, dst) = (e.arg(1), e.arg(2));
            for i in 0..8 { let v = e.mmu.read16(src + 2 * i).unwrap_or(0); e.wr16(dst + 2 * i, v); }
            1
        }
        "NtQuerySystemTime" | "RtlQuerySystemTime" => {
            let ft = (unsafe { crate::host_epoch_ms() } as u64 + 11_644_473_600_000) * 10_000;
            e.wr64(a0, ft); 0
        }
        "RtlTimeToSecondsSince1970" => {
            let t = e.mmu.read64(a0).unwrap_or(0);
            let s = t / 10_000_000;
            if s < 11_644_473_600 || s - 11_644_473_600 > u32::MAX as u64 { 0 } else { let o = e.arg(1); e.wr32(o, (s - 11_644_473_600) as u32); 1 }
        }
        "RtlSecondsSince1970ToTime" => { let o = e.arg(1); e.wr64(o, (a0 as u32 as u64 + 11_644_473_600) * 10_000_000); 0 }

        // ---- environment ----
        "GetEnvironmentStringsW" => e.s.env_block,
        "GetEnvironmentStringsA" | "GetEnvironmentStrings" => e.env_block(false),
        "FreeEnvironmentStringsW" | "FreeEnvironmentStringsA" => 1,
        "SetEnvironmentVariableW" | "SetEnvironmentVariableA" => {
            let wide = name.ends_with('W');
            let n = if wide { e.read_wstr(a0, 32767) } else { e.read_cstr(a0, 32767) };
            let v = e.arg(1);
            let v = if v == 0 { None } else if wide { Some(e.read_wstr(v, 32767)) } else { Some(e.read_cstr(v, 32767)) };
            e.env_set(&n, v.as_deref());
            1
        }
        "ExpandEnvironmentStringsW" => {
            let s = e.read_wstr(a0, 32768);
            let (buf, n) = (e.arg(1), e.arg(2));
            let r = e.out_w(buf, n, &s);
            if r > s.encode_utf16().count() as u64 { r } else { r + 1 }
        }
        "ExpandEnvironmentStringsA" => {
            let s = e.read_cstr(a0, 32768);
            let (buf, n) = (e.arg(1), e.arg(2));
            let r = e.out_a(buf, n, &s);
            if r > s.len() as u64 { r } else { r + 1 }
        }

        // ---- modules ----
        "GetModuleHandleExW" | "GetModuleHandleExA" => {
            let (f, nm, out) = (a0 as u32, e.arg(1), e.arg(2));
            let h = if f & 4 != 0 { e.module_at(nm) } else if nm == 0 { Some(e.s.exe_base) } else {
                let n = if name.ends_with('W') { e.read_wstr(nm, 260) } else { e.read_cstr(nm, 260) };
                crate::pe::find_module(e, &n).map(|i| e.s.modules[i].base)
            };
            match h { Some(h) => { e.wr64(out, h); 1 } None => { e.wr64(out, 0); e.last_err(126); 0 } }
        }
        "DisableThreadLibraryCalls" => 1,
        "RtlPcToFileHeader" => { let b = e.module_at(a0).unwrap_or(0); let o = e.arg(1); e.wr64(o, b); b }
        "SetThreadStackGuarantee" => { e.wr32(a0, 0); 1 }
        "GetCurrentThreadStackLimits" => { let (lo, hi) = (e.mmu.read64(e.cpu.gs_base + 0x10).unwrap_or(0), e.mmu.read64(e.cpu.gs_base + 0x08).unwrap_or(0)); let b = e.arg(1); e.wr64(a0, lo); e.wr64(b, hi); 0 }
        "DelayLoadFailureHook" => 0,
        "ResolveDelayLoadedAPI" => {
            // IMAGE_DELAYLOAD_DESCRIPTOR: attributes, dll name, module handle, IAT, INT (RVAs)
            let (base, d, slot) = (a0, e.arg(1), e.arg(4));
            let rd = |e: &mut Engine, a: u64| e.mmu.read32(a).unwrap_or(0) as u64;
            let (name_rva, hmod_rva, iat_rva, int_rva) = (rd(e, d + 4), rd(e, d + 8), rd(e, d + 12), rd(e, d + 16));
            let dll = e.read_cstr(base + name_rva, 256);
            let k = (slot - (base + iat_rva)) / 8;
            let ent = e.mmu.read64(base + int_rva + 8 * k).unwrap_or(0);
            let func = if ent >> 63 == 1 { format!("#{}", ent & 0xFFFF) } else { e.read_cstr(base + (ent & 0x7FFF_FFFF) + 2, 256) };
            let addr = match crate::pe::load_by_name(e, &dll) {
                Ok(m) => { if hmod_rva != 0 { let h = e.s.modules[m].base; e.wr64(base + hmod_rva, h); } crate::pe::proc_address(e, m, &func).unwrap_or_else(|| e.thunk(&dll, &func)) }
                Err(_) => e.thunk(&dll, &func),
            };
            e.wr64(slot, addr);
            addr
        }
        "AddDllDirectory" => {
            let p = e.read_wstr(a0, 32767);
            if let Some(k) = crate::files::key_of(&p) { if !e.s.dll_dirs.contains(&k) { e.s.dll_dirs.push(k); } }
            0x0D11_0000 + e.s.dll_dirs.len() as u64
        }
        "SetProcessDEPPolicy" | "SetSearchPathMode" | "RemoveDllDirectory" => 1,
        "SetProcessMitigationPolicy" | "SetProcessPriorityBoost" | "SetPriorityClass" | "SetThreadPriority" | "SetThreadPriorityBoost" | "SetThreadIdealProcessor" => 1,
        "GetPriorityClass" => 0x20,
        "GetThreadPriority" => 0,
        "SetThreadDescription" => 0,
        "GetThreadDescription" => { let p = e.arg(1); let a = e.heap_alloc(2, true); e.wr64(p, a); 0 }
        "SetConsoleTitleW" | "SetConsoleTitleA" | "SetConsoleTextAttribute" | "SetConsoleCursorPosition" | "FlushConsoleInputBuffer" => 1,
        "GetConsoleTitleW" | "GetConsoleTitleA" => 0,
        "GetConsoleWindow" => 0,

        // ---- handles and processes ----
        "DuplicateHandle" => { let (h, out) = (e.arg(1), e.arg(3)); let h = e.dup_handle(h); e.wr64(out, h); 1 }
        "CreatePipe" => { let (pr, pw) = (e.arg(0), e.arg(1)); let (r, w) = e.new_pipe(); e.wr64(pr, r); e.wr64(pw, w); 1 }
        "CreateProcessW" | "CreateProcessA" | "CreateProcessAsUserW" => {
            // (app, cmdline, process attrs, thread attrs, inherit, flags, env, dir, startup info, process info); AsUser has a token first
            let o = if name == "CreateProcessAsUserW" { 1 } else { 0 };
            let wide = !name.ends_with('A');
            let rd = |e: &mut Engine, p: u64| if p == 0 { String::new() } else if wide { e.read_wstr(p, 32767) } else { e.read_cstr(p, 32767) };
            let (app, cmd) = (e.arg(o), e.arg(o + 1));
            let (app, cmd) = (rd(e, app), rd(e, cmd));
            let (flags, envp, si, pi) = (e.arg(o + 5) as u32, e.arg(o + 6), e.arg(o + 8), e.arg(o + 9));
            // the program: the application name, or the first word of the command line
            let first = if !app.is_empty() { app.clone() } else if let Some(r) = cmd.strip_prefix('"') { r.split('"').next().unwrap_or("").to_string() } else { cmd.split_whitespace().next().unwrap_or("").to_string() };
            let mut exe = crate::pe::norm(first.rsplit(['\\', '/']).next().unwrap_or(&first));
            if !e.s.files.contains_key(&exe) && !exe.ends_with(".exe") { exe.push_str(".exe"); }
            if !e.s.files.contains_key(&exe) { e.last_err(ERROR_FILE_NOT_FOUND); return Some(0); }
            let cmd = if cmd.is_empty() { first.clone() } else { cmd };
            // environment: the one given (Unicode with flag 0x400), else a copy of ours
            let env: Vec<u16> = if envp == 0 { e.env_vec() } else {
                let mut v = Vec::new();
                let uni = flags & 0x400 != 0;
                for k in 0..0x40000u64 {
                    let c = if uni { e.mmu.read16(envp + 2 * k).unwrap_or(0) } else { e.mmu.read8(envp + k).unwrap_or(0) as u16 };
                    v.push(c);
                    let n = v.len();
                    if c == 0 && (n >= 2 && v[n - 2] == 0 || n == 1) { break; }
                }
                if v.len() == 1 { v.push(0); }
                v
            };
            // standard handles: given ones (STARTF_USESTDHANDLES), else ours
            let mut std = e.s.std;
            if si != 0 && e.mmu.read32(si + 60).unwrap_or(0) & 0x100 != 0 {
                for k in 0..3 { std[k] = e.mmu.read64(si + 80 + 8 * k as u64).unwrap_or(0); }
            }
            match e.create_process(&exe, &cmd, env, std, flags & 4 != 0) {
                Ok((pid, tid, th)) => {
                    let ph = e.new_handle(crate::files::Handle::Process { pid });
                    e.wr64(pi, ph); e.wr64(pi + 8, th); e.wr32(pi + 16, pid); e.wr32(pi + 20, tid);
                    1
                }
                Err(m) => { crate::console(&format!("[inksoc] CreateProcess {}: {}\n", exe, m)); e.last_err(ERROR_FILE_NOT_FOUND); 0 }
            }
        }
        "ShellExecuteW" | "ShellExecuteExW" => { e.last_err(ERROR_FILE_NOT_FOUND); 0 }
        "GetExitCodeProcess" => {
            let p = e.arg(1);
            let code = match e.s.fs.handles.get(&a0) {
                Some(crate::files::Handle::Process { pid }) => e.s.pinfo.get(pid).and_then(|i| i.exit).unwrap_or(259),
                _ => if a0 == u64::MAX { 259 } else { 0 },
            };
            e.wr32(p, code); 1
        }
        "GetProcessId" => match e.s.fs.handles.get(&a0) { Some(crate::files::Handle::Process { pid }) => *pid as u64, _ => if a0 == u64::MAX { e.s.wpid.max(4) as u64 } else { 0 } },
        "SetStdHandle" => { let k = match a0 as u32 as i32 { -10 => 0, -11 => 1, -12 => 2, _ => return Some(0) }; e.s.std[k] = e.arg(1); 1 }
        "SetHandleInformation" => 1,
        "GetHandleInformation" => { let p = e.arg(1); e.wr32(p, 0); 1 }
        "LockFile" | "UnlockFile" | "LockFileEx" | "UnlockFileEx" => 1,
        "VerifyConsoleIoHandle" => (a0 <= 3) as u64,
        // only the console input handle has input events (programs tell input from output this way)
        "GetNumberOfConsoleInputEvents" => { if a0 != 3 { return Some(0); } let p = e.arg(1); e.wr32(p, 0); 1 }
        "PeekConsoleInputA" | "PeekConsoleInputW" | "ReadConsoleInputA" | "ReadConsoleInputW" => { let p = e.arg(3); e.wr32(p, 0); 1 }
        "ReadConsoleA" | "ReadConsoleW" => { let p = e.arg(3); e.wr32(p, 0); 1 }
        "GetConsoleScreenBufferInfoEx" => { e.last_err(6); 0 }
        "Beep" => 1,
        // known folders: everything lives in the program folder for now
        "SHGetKnownFolderPath" => {
            let out = e.arg(3);
            let w: Vec<u16> = "C:\\InkSoC".encode_utf16().chain([0]).collect();
            let b = e.heap_alloc(2 * w.len() as u64, false);
            for (k, c) in w.iter().enumerate() { let _ = e.mmu.write16(b + 2 * k as u64, *c); }
            let _ = e.mmu.write64(out, b);
            0
        }
        "SHGetFolderPathW" | "SHGetFolderPathA" | "SHGetSpecialFolderPathW" | "SHGetSpecialFolderPathA" => {
            let buf = if name.starts_with("SHGetSpecial") { e.arg(1) } else { e.arg(4) };
            let p = "C:\\InkSoC";
            if name.ends_with('W') { for (k, c) in p.encode_utf16().chain([0]).enumerate() { let _ = e.mmu.write16(buf + 2 * k as u64, c); } }
            else { let _ = e.mmu.write_bytes(buf, p.as_bytes()); let _ = e.mmu.write8(buf + p.len() as u64, 0); }
            if name.starts_with("SHGetSpecial") { 1 } else { 0 }
        }
        "DebugBreak" => { e.set_error("the program called DebugBreak".into()); return Some(crate::kernel32::NO_RETURN); }
        "GetTempFileNameW" | "GetTempFileNameA" => {
            let (pre, uniq, out) = (e.arg(1), e.arg(2) as u32, e.arg(3));
            let p = if name.ends_with('W') { e.read_wstr(pre, 3) } else { e.read_cstr(pre, 3) };
            let n = if uniq != 0 { uniq } else { (unsafe { crate::host_now_ms() } as u32) & 0xFFFF };
            let s = format!("C:\\InkSoC\\{}{:04X}.tmp", p, n);
            if name.ends_with('W') { e.out_w(out, 260, &s); } else { e.out_a(out, 260, &s); }
            n as u64
        }
        "GetTempPathA" => { let b = e.arg(1); e.out_a(b, a0, "C:\\InkSoC\\") }
        "GetTempPath2W" => { let b = e.arg(1); e.out_w(b, a0, "C:\\InkSoC\\") }

        // ---- heap extras ----
        "HeapValidate" | "HeapSetInformation" | "HeapLock" | "HeapUnlock" => 1,
        "HeapCompact" => 0,
        "HeapWalk" => { e.last_err(ERROR_NO_MORE_ITEMS); 0 }
        "HeapQueryInformation" => { e.last_err(ERROR_NOT_SUPPORTED); 0 }
        "GetProcessHeaps" => { if e.arg(1) != 0 && a0 > 0 { let p = e.arg(1); e.wr64(p, 0xAA_0000); } 1 }

        // ---- interlocked singly linked lists (SLIST_HEADER: depth/sequence, next) ----
        "InitializeSListHead" | "RtlInitializeSListHead" => { e.wr64(a0, 0); e.wr64(a0 + 8, 0); 0 }
        "InterlockedPushEntrySList" | "RtlInterlockedPushEntrySList" => {
            let ent = e.arg(1);
            let (lo, hi) = (e.mmu.read64(a0).unwrap_or(0), e.mmu.read64(a0 + 8).unwrap_or(0));
            let first = hi & !0xF;
            e.wr64(ent, first);
            let depth = (lo & 0xFFFF) + 1;
            let seq = ((lo >> 16) + 1) & 0xFFFF_FFFF_FFFF;
            e.wr64(a0, depth | seq << 16);
            e.wr64(a0 + 8, (ent & !0xF) | (hi & 0xF));
            first
        }
        "InterlockedPopEntrySList" | "RtlInterlockedPopEntrySList" => {
            let (lo, hi) = (e.mmu.read64(a0).unwrap_or(0), e.mmu.read64(a0 + 8).unwrap_or(0));
            let first = hi & !0xF;
            if first != 0 {
                let next = e.mmu.read64(first).unwrap_or(0);
                e.wr64(a0, (lo & 0xFFFF).saturating_sub(1) | (((lo >> 16) + 1) & 0xFFFF_FFFF_FFFF) << 16);
                e.wr64(a0 + 8, (next & !0xF) | (hi & 0xF));
            }
            first
        }
        "InterlockedFlushSList" | "RtlInterlockedFlushSList" => {
            let hi = e.mmu.read64(a0 + 8).unwrap_or(0);
            let lo = e.mmu.read64(a0).unwrap_or(0);
            e.wr64(a0, lo & !0xFFFF);
            e.wr64(a0 + 8, hi & 0xF);
            hi & !0xF
        }
        "QueryDepthSList" | "RtlQueryDepthSList" => e.mmu.read64(a0).unwrap_or(0) & 0xFFFF,

        // ---- bitmaps (RTL_BITMAP: size, buffer) ----
        "RtlInitializeBitMap" => { let (buf, n) = (e.arg(1), e.arg(2)); e.wr32(a0, n as u32); e.wr64(a0 + 8, buf); 0 }
        "RtlSetBits" | "RtlClearBits" | "RtlAreBitsSet" | "RtlAreBitsClear" => {
            let (start, n) = (e.arg(1) as u32 as u64, e.arg(2) as u32 as u64);
            let buf = e.mmu.read64(a0 + 8).unwrap_or(0);
            let mut all = true;
            for i in start..start + n {
                let a = buf + i / 8;
                let b = e.mmu.read8(a).unwrap_or(0);
                let bit = 1u8 << (i % 8);
                match name {
                    "RtlSetBits" => { let _ = e.mmu.write8(a, b | bit); }
                    "RtlClearBits" => { let _ = e.mmu.write8(a, b & !bit); }
                    "RtlAreBitsSet" => { if b & bit == 0 { all = false; } }
                    _ => { if b & bit != 0 { all = false; } }
                }
            }
            all as u64
        }

        // ---- shell32 / shlwapi helpers ----
        "CommandLineToArgvW" => {
            let s: Vec<u16> = e.wstr_n(a0, -1);
            let args = split_cmdline(&String::from_utf16_lossy(&s));
            let total: usize = args.iter().map(|a| a.encode_utf16().count() + 1).sum();
            let base = e.heap_alloc((8 * (args.len() + 1) + 2 * total) as u64, true);
            let mut p = base + 8 * (args.len() as u64 + 1);
            for (i, a) in args.iter().enumerate() {
                e.wr64(base + 8 * i as u64, p);
                let w: Vec<u16> = a.encode_utf16().collect();
                for (k, c) in w.iter().enumerate() { e.wr16(p + 2 * k as u64, *c); }
                e.wr16(p + 2 * w.len() as u64, 0);
                p += 2 * (w.len() as u64 + 1);
            }
            let np = e.arg(1);
            e.wr32(np, args.len() as u32);
            base
        }
        "PathFileExistsW" | "PathFileExistsA" => {
            let p = if name.ends_with('W') { e.read_wstr(a0, 32768) } else { e.read_cstr(a0, 32768) };
            let k = p.rsplit(['\\', '/']).next().unwrap_or(&p).to_ascii_lowercase();
            e.s.files.contains_key(&k) as u64
        }

        // ---- misc ----
        "SystemFunction036" | "RtlGenRandom" | "ProcessPrng" => {
            let (p, n) = (a0, e.arg(1) as u32 as u64);
            let mut x = (unsafe { crate::host_epoch_ms() } as u64) ^ 0x9E37_79B9_7F4A_7C15 ^ e.cpu.icount;
            for i in 0..n { x ^= x << 13; x ^= x >> 7; x ^= x << 17; let _ = e.mmu.write8(p + i, x as u8); }
            1
        }
        // the old CryptoAPI: only its random numbers (Python seeds its hashes with them)
        "CryptAcquireContextW" | "CryptAcquireContextA" => { e.wr64(a0, 0xC0FFEE); 1 }
        "CryptReleaseContext" => 1,
        "CryptGenRandom" => {
            let (n, p) = (e.arg(1) as u32 as u64, e.arg(2));
            let mut x = (unsafe { crate::host_epoch_ms() } as u64) ^ 0x6A09_E667_F3BC_C909 ^ e.cpu.icount;
            for i in 0..n { x ^= x << 13; x ^= x >> 7; x ^= x << 17; let _ = e.mmu.write8(p + i, x as u8); }
            1
        }
        "BCryptGenRandom" => {
            let (p, n) = (e.arg(1), e.arg(2) as u32 as u64);
            let mut x = (unsafe { crate::host_epoch_ms() } as u64) ^ 0x2545_F491_4F6C_DD1D ^ e.cpu.icount;
            for i in 0..n { x ^= x << 13; x ^= x >> 7; x ^= x << 17; let _ = e.mmu.write8(p + i, x as u8); }
            0
        }
        "FlsGetValue2" => { e.mmu.read64(e.cpu.gs_base + 0x1480 + 8 * a0.min(63)).unwrap_or(0) }
        "TlsGetValue2" => { e.mmu.read64(e.cpu.gs_base + 0x1480 + 8 * a0.min(63)).unwrap_or(0) }
        "EventRegister" | "EventUnregister" | "EventSetInformation" | "EventWriteTransfer" | "EventWrite" => 0,
        "OutputDebugStringW" => { let s = e.read_wstr(a0, 4096); console(&format!("[debug] {}", s)); 0 }
        "WerSetFlags" | "WerRegisterRuntimeExceptionModule" => 0,
        "CoInitialize" | "CoInitializeEx" | "OleInitialize" => 0,
        "CoUninitialize" | "OleUninitialize" => 0,
        "CoTaskMemAlloc" => e.heap_alloc(a0.max(1), false),
        "CoTaskMemFree" => 0,
        "timeBeginPeriod" | "timeEndPeriod" => 0,
        "timeGetTime" => unsafe { crate::host_now_ms() as u64 & 0xFFFF_FFFF },
        _ => return None,
    };
    Some(r)
}

/// Windows command-line rules (CommandLineToArgvW).
pub fn split_cmdline(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let c: Vec<char> = s.chars().collect();
    let mut i = 0;
    // program name: up to the next space, or quoted
    let mut cur = String::new();
    if i < c.len() && c[i] == '"' { i += 1; while i < c.len() && c[i] != '"' { cur.push(c[i]); i += 1; } i += 1; }
    else { while i < c.len() && c[i] != ' ' && c[i] != '\t' { cur.push(c[i]); i += 1; } }
    out.push(cur);
    loop {
        while i < c.len() && (c[i] == ' ' || c[i] == '\t') { i += 1; }
        if i >= c.len() { break; }
        let mut cur = String::new();
        let mut q = false;
        while i < c.len() {
            let ch = c[i];
            if ch == '\\' {
                let mut n = 0; while i < c.len() && c[i] == '\\' { n += 1; i += 1; }
                if i < c.len() && c[i] == '"' { for _ in 0..n / 2 { cur.push('\\'); } if n % 2 == 1 { cur.push('"'); i += 1; } }
                else { for _ in 0..n { cur.push('\\'); } }
                continue;
            }
            if ch == '"' { if q && i + 1 < c.len() && c[i + 1] == '"' { cur.push('"'); i += 2; continue; } q = !q; i += 1; continue; }
            if !q && (ch == ' ' || ch == '\t') { break; }
            cur.push(ch); i += 1;
        }
        out.push(cur);
    }
    out
}
