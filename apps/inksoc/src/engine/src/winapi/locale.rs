// Wine's debug channels, code pages and the locale (one fixed locale: en-US, UTF-8).

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- Wine's debug channels (always off) ----
        "__wine_dbg_header" => u64::MAX,
        "__wine_dbg_output" | "__wine_dbg_get_channel_flags" => 0,
        "__wine_dbg_strdup" => a0,

        // ---- code pages and locale ----
        "GetACP" | "GetOEMCP" => 65001,
        "IsValidCodePage" => 1,
        "GetCPInfo" => {
            let p = e.arg(1);
            e.w32(p, if a0 as u32 == 65001 { 4 } else { 1 });
            e.w16(p + 4, b'?' as u16);
            for i in 0..12 {
                e.w8(p + 6 + i, 0);
            }
            1
        }
        "GetCPInfoExW" => {
            let p = e.arg(2);
            e.w32(p, if a0 as u32 == 65001 { 4 } else { 1 });
            e.w16(p + 4, b'?' as u16);
            for i in 0..12 {
                e.w8(p + 6 + i, 0);
            }
            e.w16(p + 18, b'?' as u16);
            e.w32(p + 20, a0 as u32);
            e.out_w(p + 24, 260, "65001 (UTF-8)");
            1
        }
        "IsDBCSLeadByte" | "IsDBCSLeadByteEx" => 0,
        "GetUserDefaultLCID"
        | "GetSystemDefaultLCID"
        | "GetThreadLocale"
        | "GetUserDefaultLangID"
        | "GetSystemDefaultLangID"
        | "GetUserDefaultUILanguage"
        | "GetSystemDefaultUILanguage"
        | "LocaleNameToLCID" => 0x409,
        "SetThreadLocale" | "IsValidLocale" | "IsValidLocaleName" | "EnumSystemLocalesW" | "EnumSystemLocalesA" | "EnumSystemLocalesEx" => 1,
        "EnumUILanguagesA" | "EnumUILanguagesW" => {
            // one UI language, en-US: proc(name, param) runs in place of this call, its BOOL is the result
            let (proc, flags, param) = (a0, e.arg(1) as u32, e.arg(2));
            if proc == 0 {
                e.set_last_error(87);
                return Some(0);
            }
            let txt = if flags & 8 != 0 { "en-US" } else { "0409" };
            let Some(p) = e.alloc(0x1000) else { return Some(0) };
            if name.ends_with('A') {
                let _ = e.mmu.write_bytes(p, txt.as_bytes());
            } else {
                for (i, c) in txt.encode_utf16().enumerate() {
                    e.w16(p + 2 * i as u64, c);
                }
            }
            e.cpu.regs[1] = p;
            e.cpu.regs[2] = param;
            e.cpu.rip = proc;
            return Some(crate::kernel32::NO_RETURN);
        }
        "GetUserDefaultLocaleName" | "GetSystemDefaultLocaleName" => {
            let (buf, n) = if name == "GetUserDefaultLocaleName" { (a0, e.arg(1)) } else { (a0, e.arg(1)) };
            let r = e.out_w(buf, n, "en-US");
            if r > 5 {
                0
            } else {
                r + 1
            }
        }
        "LCIDToLocaleName" => {
            let (buf, n) = (e.arg(1), e.arg(2));
            let r = e.out_w(buf, n, "en-US");
            if r > 5 {
                0
            } else {
                r + 1
            }
        }
        "ResolveLocaleName" => {
            let (buf, n) = (e.arg(1), e.arg(2));
            let r = e.out_w(buf, n, "en-US");
            if r > 5 {
                0
            } else {
                r + 1
            }
        }
        "GetLocaleInfoW" | "GetLocaleInfoA" | "GetLocaleInfoEx" => {
            let (t, buf, n) = (e.arg(1) as u32, e.arg(2), e.arg(3));
            if t & 0x2000_0000 != 0 {
                // LOCALE_RETURN_NUMBER: a DWORD
                let v: u32 = match t & 0xFFFF {
                    0x1004 => 65001,
                    0x0B => 437,
                    0x01 => 0x409,
                    0x11 => 2,
                    0x12 => 1,
                    _ => 0,
                };
                if name == "GetLocaleInfoA" {
                    e.w32(buf, v);
                    4
                } else {
                    e.w32(buf, v);
                    2
                }
            } else {
                match locale_info(t) {
                    Some(s) => {
                        if n == 0 {
                            if name == "GetLocaleInfoA" {
                                s.len() as u64 + 1
                            } else {
                                s.encode_utf16().count() as u64 + 1
                            }
                        } else if name == "GetLocaleInfoA" {
                            let k = e.out_a(buf, n, &s);
                            if k > s.len() as u64 {
                                e.set_last_error(122);
                                0
                            } else {
                                k + 1
                            }
                        } else {
                            let k = e.out_w(buf, n, &s);
                            if k > s.encode_utf16().count() as u64 {
                                e.set_last_error(122);
                                0
                            } else {
                                k + 1
                            }
                        }
                    }
                    None => {
                        e.set_last_error(ERROR_INVALID_PARAMETER);
                        0
                    }
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
        "lstrcmpW" | "lstrcmpiW" | "lstrcmpA" | "lstrcmpiA" => {
            // NULL sorts first; otherwise CompareString(...) - 2
            let (s1, s2) = (a0, e.arg(1));
            if s1 == 0 || s2 == 0 {
                return Some(if s1 == s2 {
                    0
                } else if s1 == 0 {
                    (-1i64) as u64
                } else {
                    1
                });
            }
            let f = if name.starts_with("lstrcmpi") { 1 } else { 0 };
            let (a, b): (Vec<u16>, Vec<u16>) = if name.ends_with('A') {
                (e.astr_n(s1, -1).iter().map(|&c| c as u16).collect(), e.astr_n(s2, -1).iter().map(|&c| c as u16).collect())
            } else {
                (e.wstr_n(s1, -1), e.wstr_n(s2, -1))
            };
            (compare(&a, &b, f) as i64 - 2) as i32 as i64 as u64
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
                if dn == 0 {
                    out.len() as u64
                } else {
                    for (i, c) in out.iter().take(dn as usize).enumerate() {
                        e.w8(dst + i as u64, *c as u8);
                    }
                    out.len().min(dn as usize) as u64
                }
            } else {
                let v = e.wstr_n(src, n);
                let out = map_case(&v, f);
                if f & 0x400 != 0 {
                    // LCMAP_SORTKEY: bytes that sort like the string
                    let bytes: Vec<u8> = out.iter().flat_map(|c| c.to_be_bytes()).chain([0u8]).collect();
                    if dn == 0 {
                        bytes.len() as u64
                    } else {
                        let k = bytes.len().min(dn as usize);
                        let _ = e.mmu.write_bytes(dst, &bytes[..k]);
                        k as u64
                    }
                } else if dn == 0 {
                    out.len() as u64
                } else {
                    for (i, c) in out.iter().take(dn as usize).enumerate() {
                        e.w16(dst + 2 * i as u64, *c);
                    }
                    out.len().min(dn as usize) as u64
                }
            }
        }
        "GetStringTypeW" | "GetStringTypeExW" => {
            let (t, src, n, out) = if name == "GetStringTypeW" {
                (a0 as u32, e.arg(1), e.arg(2) as i32 as i64, e.arg(3))
            } else {
                (e.arg(1) as u32, e.arg(2), e.arg(3) as i32 as i64, e.arg(4))
            };
            let v = e.wstr_n(src, n);
            for (i, c) in v.iter().enumerate() {
                let x = if t == 1 { ctype1(*c as u32) } else { 0 };
                e.w16(out + 2 * i as u64, x);
            }
            1
        }
        "GetStringTypeA" | "GetStringTypeExA" => {
            let (t, src, n, out) = (e.arg(1) as u32, e.arg(2), e.arg(3) as i32 as i64, e.arg(4));
            let v = e.astr_n(src, n);
            for (i, c) in v.iter().enumerate() {
                let x = if t == 1 { ctype1(*c as u32) } else { 0 };
                e.w16(out + 2 * i as u64, x);
            }
            1
        }
        "IsBadStringPtrA" | "IsBadStringPtrW" | "IsBadReadPtr" | "IsBadWritePtr" | "IsBadCodePtr" => 0,
        "GetDateFormatW" | "GetTimeFormatW" | "GetDateFormatEx" | "GetTimeFormatEx" | "GetDateFormatA" | "GetTimeFormatA" => {
            e.set_last_error(ERROR_NOT_SUPPORTED);
            0
        }
        _ => return e.not_mine(),
    })
}
