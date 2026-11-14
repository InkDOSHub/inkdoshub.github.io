// Processes, threads and system information.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- processes, threads, system ----
        "NtQueryInformationProcess" | "NtWow64QueryInformationProcess64" => {
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            let need: u64 = match class {
                0 => 48,
                7 | 26 | 30 | 31 => 8,
                12 | 34 | 36 | 31_000 => 4,
                20 => 4,
                2 | 3 | 4 => 112.min(len),
                _ => 0,
            };
            if need == 0 {
                return Some(INVALID_INFO_CLASS);
            }
            if len < need {
                return Some(INFO_LENGTH_MISMATCH);
            }
            e.zero_n(buf, need);
            match class {
                0 => {
                    e.w64(buf + 8, crate::PEB);
                    e.w64(buf + 16, (1u64 << e.s.cores) - 1);
                    e.w32(buf + 24, 8);
                    e.w64(buf + 32, 4);
                }
                31 => {
                    e.w32(buf, 1);
                } // ProcessDebugFlags: no debugger
                26 => {
                    if e.s.wow64 {
                        e.w64(buf, crate::PEB32);
                    }
                } // ProcessWow64Information: the 32-bit PEB
                4 => {
                    if let Some((c, u)) = e.cpu_times(a0, true) {
                        e.w64(buf, c);
                        e.w64(buf + 24, u);
                    }
                } // ProcessTimes
                36 => {
                    e.w32(buf, 0x1234_5678);
                } // ProcessCookie
                _ => {}
            }
            if ret != 0 {
                e.w32(ret, need as u32);
            }
            if class == 30 {
                return Some(PORT_NOT_SET);
            } // ProcessDebugObjectHandle: STATUS_PORT_NOT_SET
            OK
        }
        // ThreadWow64Context: the 32-bit registers live in the thread's CPU area (TEB TlsSlots[1] + 4)
        "NtSetInformationThread" if e.arg(1) == 0x1D => {
            let Some(area) = e.wow_ctx_of(a0) else { return Some(INVALID_HANDLE) };
            let mut b = vec![0u8; 0x2CC];
            let src = e.arg(2);
            if e.mmu.read_bytes(src, &mut b).is_err() {
                return Some(ACCESS_VIOLATION);
            }
            // WOW64_CPURESERVED_FLAG_RESET_STATE: wow64cpu reloads every register on its way back
            let fl = e.r16(area - 4);
            e.w16(area - 4, fl | 1);
            let _ = e.mmu.write_bytes(area, &b);
            OK
        }
        "NtQueryInformationThread" if e.arg(1) == 0x1D => {
            let Some(area) = e.wow_ctx_of(a0) else { return Some(INVALID_HANDLE) };
            let mut b = vec![0u8; 0x2CC];
            let _ = e.mmu.read_bytes(area, &mut b);
            let (dst, rl) = (e.arg(2), e.arg(4));
            let flags = e.mmu.read32(dst).unwrap_or(0x1003F);
            let _ = e.mmu.write_bytes(dst, &b);
            e.w32(dst, flags);
            if rl != 0 {
                e.w32(rl, 0x2CC);
            }
            OK
        }
        "NtSetInformationProcess" | "NtSetInformationThread" | "NtSetInformationObject" => OK,
        "NtQueryInformationThread" => {
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            match class {
                0 => {
                    if len < 48 {
                        return Some(INFO_LENGTH_MISMATCH);
                    }
                    e.zero_n(buf, 48);
                    let teb = e.cpu.gs_base;
                    e.w32(buf, 0x103);
                    e.w64(buf + 8, teb);
                    e.w64(buf + 16, 4);
                    let tid = e.cur_tid() as u64;
                    e.w64(buf + 24, tid);
                    e.w64(buf + 32, 1);
                    if ret != 0 {
                        e.w32(ret, 48);
                    }
                    OK
                }
                1 => {
                    // ThreadTimes
                    if len < 32 {
                        return Some(INFO_LENGTH_MISMATCH);
                    }
                    e.zero_n(buf, 32);
                    if let Some((c, u)) = e.cpu_times(a0, false) {
                        e.w64(buf, c);
                        e.w64(buf + 24, u);
                    }
                    if ret != 0 {
                        e.w32(ret, 32);
                    }
                    OK
                }
                _ => {
                    e.zero_n(buf, len.min(64));
                    if ret != 0 {
                        e.w32(ret, len.min(64) as u32);
                    }
                    OK
                }
            }
        }
        "NtQuerySystemInformation" | "NtQuerySystemInformationEx" => {
            let (class, buf, len, ret) = if name == "NtQuerySystemInformation" {
                (a0 as u32, e.arg(1), e.arg(2) as u32 as u64, e.arg(3))
            } else {
                (a0 as u32, e.arg(3), e.arg(4) as u32 as u64, e.arg(5))
            };
            let need: u64 = match class {
                0 | 0x3E => 64,
                1 | 0x3F => 12,
                3 => 48,
                8 => 48 * e.s.cores as u64,
                2 => 0x150,
                0x67 => 8,
                0xB5 => {
                    if e.s.wow64 {
                        12
                    } else {
                        8
                    }
                }
                _ => 0,
            };
            if need == 0 {
                return Some(INVALID_INFO_CLASS);
            }
            if ret != 0 {
                e.w32(ret, need as u32);
            }
            if len < need {
                return Some(INFO_LENGTH_MISMATCH);
            }
            e.zero_n(buf, need);
            match class {
                // SystemSupportedProcessorArchitectures: x86-64 native, i386 for this (WoW64) process
                // (a 64-bit process: x86-64 is native and the process's own machine)
                0xB5 if !e.s.wow64 => {
                    e.w32(buf, 0x8664 | 0xF << 16);
                }
                0xB5 => {
                    e.w32(buf, 0x8664 | 7 << 16);
                    e.w32(buf + 4, 0x14C | 2 << 16 | 1 << 19 | 1 << 20);
                }
                0 | 0x3E => {
                    let w32 = |e: &mut Engine, o: u64, v: u32| {
                        e.w32(buf + o, v);
                    };
                    w32(e, 4, 156_250);
                    w32(e, 8, 4096);
                    w32(e, 12, 2 << 20);
                    w32(e, 16, 1);
                    w32(e, 20, 2 << 20);
                    w32(e, 24, 0x10000);
                    e.w64(buf + 0x20, 0x10000);
                    e.w64(buf + 0x28, if class == 0x3E { 0x7FFE_FFFF } else { 0x7FFF_FFFE_FFFF });
                    e.w64(buf + 0x30, (1u64 << e.s.cores) - 1);
                    e.w8(buf + 0x38, e.s.cores as u8);
                }
                1 | 0x3F => {
                    e.w16(buf, if class == 0x3F { 0 } else { 9 });
                    e.w16(buf + 2, 6);
                    e.w16(buf + 4, 0x9E00);
                    e.w16(buf + 6, e.s.cores as u16);
                    e.w32(buf + 8, 0x0000_3FFF);
                }
                3 => {
                    e.w64(buf, crate::filetime_now());
                    e.w64(buf + 8, crate::filetime_now());
                }
                _ => {}
            }
            OK
        }
        "NtGetTickCount" => crate::now_ms() as u64 & 0xFFFF_FFFF,
        "NtQueryPerformanceCounter" => {
            let v = (crate::now_ms() * 10_000.0) as u64;
            e.w64(a0, v);
            let f = e.arg(1);
            if f != 0 {
                e.w64(f, 10_000_000);
            }
            OK
        }
        "NtQueryTimerResolution" => {
            let (b, c) = (e.arg(1), e.arg(2));
            e.w32(a0, 156_250);
            e.w32(b, 5000);
            e.w32(c, 156_250);
            OK
        }
        "NtSetTimerResolution" => {
            let p = e.arg(2);
            e.w32(p, 10_000);
            OK
        }
        "NtGetCurrentProcessorNumber" => 0,
        "NtTerminateProcess" => {
            let code = e.arg(1) as u32;
            if a0 == 0 || a0 == u64::MAX {
                e.exit_process(code);
                return Some(crate::kernel32::NO_RETURN);
            }
            if let Some(Handle::Process { pid }) = e.s.fs.handles.get(&a0) {
                let p = *pid;
                if let Some(i) = e.s.pinfo.get_mut(&p) {
                    if i.exit.is_none() {
                        i.exit = Some(code);
                    }
                }
                for t in e.s.sched.th.iter_mut() {
                    if t.wpid == p {
                        t.st = crate::sched::St::Done;
                    }
                }
            }
            OK
        }
        "NtQueryDefaultLocale" => {
            let p = e.arg(1);
            e.w32(p, 0x409);
            OK
        }
        "NtQueryDefaultUILanguage" | "NtQueryInstallUILanguage" => {
            e.w16(a0, 0x409);
            OK
        }
        "NtQueryLicenseValue" => OBJECT_NAME_NOT_FOUND,
        "NtTraceControl" | "NtTraceEvent" => OK,
        "NtDuplicateObject" => {
            let (h, out) = (e.arg(1), e.arg(3));
            let h = e.dup_handle(h);
            if out != 0 {
                e.w64(out, h);
            }
            OK
        }
        "NtQueryObject" => INVALID_INFO_CLASS,
        "NtDisplayString" => OK,
        _ => return e.not_mine(),
    })
}
