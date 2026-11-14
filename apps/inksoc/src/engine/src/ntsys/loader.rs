// The loader (ntdll's Ldr* on the engine's module list), exceptions and atoms.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- loader (ntdll's Ldr*, on the engine's module list) ----
        "LdrAddRefDll" | "LdrUnloadDll" | "LdrDisableThreadCalloutsForDll" | "LdrUnlockLoaderLock" => OK,
        "LdrLockLoaderLock" => {
            let (r, c) = (e.arg(1), e.arg(2));
            if r != 0 {
                e.w32(r, 1);
            }
            if c != 0 {
                e.w64(c, 1);
            }
            OK
        }
        "LdrGetDllHandle" | "LdrGetDllHandleEx" | "LdrLoadDll" => {
            let (us, out) = if name == "LdrGetDllHandleEx" { (e.arg(3), e.arg(4)) } else { (e.arg(2), e.arg(3)) };
            let n = e.us_read(us);
            let n = n.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
            let n = if n.contains('.') { n } else { format!("{}.dll", n) };
            if name != "LdrLoadDll" {
                let n = if e.s.wow64 && n == "ntdll.dll" { "wine-ntdll.dll".to_string() } else { n };
                let Some(i) = crate::pe::find_module(e, &n) else { return Some(DLL_NOT_FOUND) };
                let b = e.s.modules[i].base;
                if out != 0 {
                    e.w64(out, b);
                }
                return Some(OK);
            }
            let before = e.s.init_queue.len();
            match crate::pe::load_by_name(e, &n) {
                Ok(i) => {
                    let b = e.s.modules[i].base;
                    if out != 0 {
                        e.w64(out, b);
                    }
                    if e.s.init_queue.len() > before {
                        let pending: Vec<(u64, u64)> = e.s.init_queue.drain(before..).collect();
                        e.run_inits(pending, 0, Some(OK));
                        return Some(crate::kernel32::NO_RETURN);
                    }
                    OK
                }
                Err(_) => DLL_NOT_FOUND,
            }
        }
        "LdrGetProcedureAddress" => {
            let (ans, ord, out) = (e.arg(1), e.arg(2), e.arg(3));
            let Some(i) = e.s.modules.iter().position(|m| m.base == a0) else { return Some(DLL_NOT_FOUND) };
            let n = if ans != 0 {
                let len = e.r16(ans) as u64;
                let b = e.r64(ans + 8);
                (0..len).map(|k| e.r8(b + k) as char).collect::<String>()
            } else {
                format!("#{}", ord)
            };
            if e.s.modules[i].native
                && !{
                    let d = e.s.modules[i].name.clone();
                    e.wine_has(&d, &n)
                }
            {
                return Some(ENTRYPOINT_NOT_FOUND);
            }
            match crate::pe::proc_address(e, i, &n) {
                Some(a) => {
                    if out != 0 {
                        e.w64(out, a);
                    }
                    OK
                }
                None => ENTRYPOINT_NOT_FOUND, // STATUS_ENTRYPOINT_NOT_FOUND
            }
        }
        "LdrFindEntryForAddress" => {
            let out = e.arg(1);
            let Some(b) = e.s.modules.iter().find(|m| a0 >= m.base && a0 < m.base + m.size).map(|m| m.base) else { return Some(DLL_NOT_FOUND) };
            let ent = e.ldr_entry(b);
            if out != 0 {
                e.w64(out, ent);
            }
            OK
        }
        "RtlGetCurrentPeb" => crate::PEB,
        "RtlIsCriticalSectionLocked" => (e.r32(a0 + 12) > 0) as u64,
        "RtlIsCriticalSectionLockedByThread" => {
            let me = e.cur_tid() as u64;
            (e.r32(a0 + 12) > 0 && e.r64(a0 + 16) == me) as u64
        }
        "DbgPrint" | "DbgPrintEx" | "DbgBreakPoint" | "DbgUserBreakPoint" => 0,
        // ---- exceptions: Wine's ntdll dispatches them; these are its kernel side ----
        "NtCallbackReturn" => {
            e.callback_return();
            return Some(crate::kernel32::NO_RETURN);
        }
        "NtContinue" => {
            e.load_context(a0);
            return Some(crate::kernel32::NO_RETURN);
        }
        "NtRaiseException" => {
            let code = e.r32(a0) as u64;
            let at = e.r64(a0 + 16);
            let info = e.r64(a0 + 32);
            let msg = match code {
                ACCESS_VIOLATION => format!("access violation at 0x{:x}", info),
                0xE06D_7363 => "unhandled C++ exception".to_string(),
                0x8000_0100 => {
                    // EXCEPTION_WINE_STUB: (dll, function)
                    let f = e.r64(a0 + 40);
                    format!("unimplemented function {}!{}", e.read_cstr(info, 64), e.read_cstr(f, 64))
                }
                c => format!("unhandled exception 0x{:x}", c),
            };
            e.set_error(format!("{} (at 0x{:x})", msg, at));
            return Some(crate::kernel32::NO_RETURN);
        }
        // ---- atoms ----
        "NtAddAtom" | "NtFindAtom" | "NtAddAtomEx" => {
            // (name, length in bytes, atom*)
            let (len, out) = (e.arg(1) as u32 as u64, e.arg(2));
            let v: Vec<u16> = (0..len / 2).map(|i| e.r16(a0 + 2 * i)).collect();
            let n = String::from_utf16_lossy(&v);
            let atom = if let Some(num) = n.strip_prefix('#').and_then(|d| d.parse::<u16>().ok()) {
                num as u64
            } else if let Some(i) = e.s.atoms.iter().position(|a| a.eq_ignore_ascii_case(&n)) {
                0xC000 + i as u64
            } else if name == "NtFindAtom" {
                return Some(OBJECT_NAME_NOT_FOUND);
            } else {
                e.s.atoms.push(n);
                0xBFFF + e.s.atoms.len() as u64
            };
            if out != 0 {
                e.w16(out, atom as u16);
            }
            OK
        }
        "NtDeleteAtom" => OK,
        "NtQueryInformationAtom" => {
            // (atom, class, info*, length, return length*): AtomBasicInformation
            let (buf, len, ret) = (e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            let name = if a0 >= 0xC000 { e.s.atoms.get((a0 - 0xC000) as usize).cloned() } else { Some(format!("#{}", a0)) };
            let Some(n) = name else { return Some(INVALID_HANDLE) };
            let w: Vec<u16> = n.encode_utf16().collect();
            let need = 6 + 2 * w.len() as u64 + 2;
            if len < need {
                return Some(BUFFER_OVERFLOW);
            } // STATUS_BUFFER_OVERFLOW
            e.w16(buf, 1);
            e.w16(buf + 2, 0);
            e.w16(buf + 4, 2 * w.len() as u16);
            for (k, c) in w.iter().chain([0u16].iter()).enumerate() {
                e.w16(buf + 6 + 2 * k as u64, *c);
            }
            if ret != 0 {
                e.w32(ret, need as u32);
            }
            OK
        }
        "NtQueryInformationJobObject" => {
            let (b, n, r) = (e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            e.zero_n(b, n);
            if r != 0 {
                e.w32(r, n as u32);
            }
            OK
        }
        "NtIsProcessInJob" => 0x0000_0123, // STATUS_PROCESS_NOT_IN_JOB
        "RtlGetUserInfoHeap" => {
            for k in [3, 4] {
                let p = e.arg(k);
                if p != 0 {
                    e.w64(p, 0);
                }
            }
            1
        }
        "RtlSetUserValueHeap" | "RtlSetUserFlagsHeap" => 1,
        // other processes: only our own exists
        "NtOpenProcess" => {
            let cid = e.arg(3);
            let pid = if cid != 0 { e.r64(cid) } else { 0 };
            if pid == 4 {
                e.w64(a0, u64::MAX);
                OK
            } else {
                INVALID_CID
            } // STATUS_INVALID_CID
        }
        "NtOpenThread" => {
            let cid = e.arg(3);
            let tid = if cid != 0 { e.r64(cid + 8) as u32 } else { 0 };
            if e.s.sched.th.iter().any(|t| t.id == tid) {
                let h = e.new_handle(Handle::Thread { tid });
                e.w64(a0, h);
                OK
            } else {
                INVALID_CID
            }
        }
        "NtOpenDirectoryObject" | "NtCreateDirectoryObject" | "NtOpenSymbolicLinkObject" => {
            let h = e.new_handle(Handle::Dir);
            e.w64(a0, h);
            OK
        }
        "NtQueryDirectoryObject" => NO_MORE_ENTRIES,
        "NtQuerySymbolicLinkObject" => OBJECT_NAME_NOT_FOUND,
        _ => return e.not_mine(),
    })
}
