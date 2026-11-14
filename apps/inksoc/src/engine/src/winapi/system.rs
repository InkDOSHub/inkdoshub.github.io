// System information, time and environment variables.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- system information ----
        "GetErrorMode" | "SetErrorMode" | "GetThreadErrorMode" => 0,
        "SetThreadErrorMode" => {
            let p = e.arg(1);
            e.w32(p, 0);
            1
        }
        "GetSystemDirectoryA" | "GetSystemWindowsDirectoryA" | "GetWindowsDirectoryA" => {
            let s = if name == "GetSystemDirectoryA" { "C:\\Windows\\System32" } else { "C:\\Windows" };
            let n = e.arg(1);
            e.out_a(a0, n, s)
        }
        "GetSystemDirectoryW" | "GetSystemWindowsDirectoryW" | "GetWindowsDirectoryW" => {
            let s = if name == "GetSystemDirectoryW" { "C:\\Windows\\System32" } else { "C:\\Windows" };
            let n = e.arg(1);
            e.out_w(a0, n, s)
        }
        "GetVersionExW" | "GetVersionExA" => {
            e.w32(a0 + 4, 10);
            e.w32(a0 + 8, 0);
            e.w32(a0 + 12, 19045);
            e.w32(a0 + 16, 2);
            1
        }
        "RtlGetVersion" => {
            e.w32(a0 + 4, 10);
            e.w32(a0 + 8, 0);
            e.w32(a0 + 12, 19045);
            e.w32(a0 + 16, 2);
            0
        }
        "RtlGetNtVersionNumbers" => {
            let (b, c) = (e.arg(1), e.arg(2));
            e.w32(a0, 10);
            e.w32(b, 0);
            e.w32(c, 0xF000_0000 | 19045);
            0
        }
        "VerSetConditionMask" => a0,
        "VerifyVersionInfoW" | "VerifyVersionInfoA" => 1,
        "RtlVerifyVersionInfo" => 0, // we are Windows 10: every check passes
        "GetComputerNameW" | "GetComputerNameExW" => {
            let (buf, np) = if name == "GetComputerNameW" { (a0, e.arg(1)) } else { (e.arg(1), e.arg(2)) };
            let n = e.r32(np) as u64;
            let r = e.out_w(buf, n, "INKSOC");
            if r > 6 {
                e.w32(np, 7);
                e.set_last_error(234);
                0
            } else {
                e.w32(np, r as u32);
                1
            }
        }
        "GetComputerNameA" => {
            let np = e.arg(1);
            let n = e.r32(np) as u64;
            let r = e.out_a(a0, n, "INKSOC");
            if r > 6 {
                e.w32(np, 7);
                0
            } else {
                e.w32(np, r as u32);
                1
            }
        }
        "GetUserNameW" => {
            let np = e.arg(1);
            let n = e.r32(np) as u64;
            let r = e.out_w(a0, n, "user");
            if r > 4 {
                e.w32(np, 5);
                e.set_last_error(122);
                0
            } else {
                e.w32(np, r as u32 + 1);
                1
            }
        }
        "LookupAccountNameW" => {
            // the one local user (the token's SID S-1-5-21-1-2-3-1000), as Windows Installer asks for it
            let (nm, sid, sidn, dom, domn, usep) = (e.arg(1), e.arg(2), e.arg(3), e.arg(4), e.arg(5), e.arg(6));
            let who = if nm == 0 { String::new() } else { e.read_wstr(nm, 260).to_lowercase() };
            let who = who.rsplit('\\').next().unwrap_or("").to_string();
            if who != "user" {
                e.set_last_error(1332);
                return Some(0);
            } // ERROR_NONE_MAPPED
            let s: [u8; 28] = [1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0xE8, 3, 0, 0];
            let (have_s, have_d) = (e.r32(sidn), if domn != 0 { e.r32(domn) } else { 0 });
            e.w32(sidn, 28);
            if domn != 0 {
                e.w32(domn, if (have_d as usize) < 7 { 7 } else { 6 });
            }
            if have_s < 28 || sid == 0 || (have_d as usize) < 7 || dom == 0 {
                e.set_last_error(122);
                return Some(0);
            }
            let _ = e.mmu.write_bytes(sid, &s);
            e.out_w(dom, 7, "INKSOC");
            if usep != 0 {
                e.w32(usep, 1);
            } // SidTypeUser
            1
        }
        "GetUserNameA" => {
            let np = e.arg(1);
            let n = e.r32(np) as u64;
            let r = e.out_a(a0, n, "user");
            if r > 4 {
                e.w32(np, 5);
                e.set_last_error(122);
                0
            } else {
                e.w32(np, r as u32 + 1);
                1
            }
        }
        "GetDriveTypeW" | "GetDriveTypeA" => 3,
        "GetLogicalDrives" => 1 << 2,
        "GetCurrentProcessorNumber" => 0,
        "GetCurrentProcessorNumberEx" => {
            e.w32(a0, 0);
            0
        }
        "FlushProcessWriteBuffers" | "MemoryBarrier" => 0,
        "GetNumaHighestNodeNumber" => {
            e.w32(a0, 0);
            1
        }
        "GetPhysicallyInstalledSystemMemory" => {
            e.w64(a0, 8 << 20);
            1
        }
        "QueryUnbiasedInterruptTime" => {
            let v = (crate::now_ms() * 10_000.0) as u64;
            e.w64(a0, v);
            1
        }
        "QueryInterruptTime" | "QueryInterruptTimePrecise" => {
            let v = (crate::now_ms() * 10_000.0) as u64;
            e.w64(a0, v);
            0
        }

        // ---- time ----
        "GetLocalTime" | "GetSystemTime" => {
            e.system_time(a0);
            0
        }
        "GetTimeZoneInformation" | "GetDynamicTimeZoneInformation" => {
            e.zero(a0, if name == "GetTimeZoneInformation" { 172 } else { 432 });
            0
        }
        "SystemTimeToTzSpecificLocalTime" | "TzSpecificLocalTimeToSystemTime" => {
            let (src, dst) = (e.arg(1), e.arg(2));
            for i in 0..8 {
                let v = e.r16(src + 2 * i);
                e.w16(dst + 2 * i, v);
            }
            1
        }
        // (new state, previous state*): no power management, nothing to keep awake
        "NtSetThreadExecutionState" => {
            let old = e.arg(1);
            if old != 0 {
                e.w32(old, 0);
            }
            0
        }
        "NtQuerySystemTime" | "RtlQuerySystemTime" => {
            let ft = crate::filetime_now();
            e.w64(a0, ft);
            0
        }
        "RtlTimeToSecondsSince1970" => {
            let t = e.r64(a0);
            let s = t / 10_000_000;
            if s < crate::UNIX_TO_FILETIME_SECS || s - crate::UNIX_TO_FILETIME_SECS > u32::MAX as u64 {
                0
            } else {
                let o = e.arg(1);
                e.w32(o, (s - crate::UNIX_TO_FILETIME_SECS) as u32);
                1
            }
        }
        "RtlSecondsSince1970ToTime" => {
            let o = e.arg(1);
            e.w64(o, (a0 as u32 as u64 + crate::UNIX_TO_FILETIME_SECS) * 10_000_000);
            0
        }

        // ---- environment ----
        "GetEnvironmentStringsW" => e.s.env_block,
        "GetEnvironmentStringsA" | "GetEnvironmentStrings" => e.env_block(false),
        "FreeEnvironmentStringsW" | "FreeEnvironmentStringsA" => 1,
        "SetEnvironmentVariableW" | "SetEnvironmentVariableA" => {
            let wide = name.ends_with('W');
            let n = if wide { e.read_wstr(a0, 32767) } else { e.read_cstr(a0, 32767) };
            let v = e.arg(1);
            let v = if v == 0 {
                None
            } else if wide {
                Some(e.read_wstr(v, 32767))
            } else {
                Some(e.read_cstr(v, 32767))
            };
            e.env_set(&n, v.as_deref());
            1
        }
        "ExpandEnvironmentStringsW" => {
            let s = e.read_wstr(a0, 32768);
            let (buf, n) = (e.arg(1), e.arg(2));
            let r = e.out_w(buf, n, &s);
            if r > s.encode_utf16().count() as u64 {
                r
            } else {
                r + 1
            }
        }
        "ExpandEnvironmentStringsA" => {
            let s = e.read_cstr(a0, 32768);
            let (buf, n) = (e.arg(1), e.arg(2));
            let r = e.out_a(buf, n, &s);
            if r > s.len() as u64 {
                r
            } else {
                r + 1
            }
        }
        _ => return e.not_mine(),
    })
}
