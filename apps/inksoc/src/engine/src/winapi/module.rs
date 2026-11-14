// Modules: loading, names and resources.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- modules ----
        "GetModuleHandleExW" | "GetModuleHandleExA" => {
            let (f, nm, out) = (a0 as u32, e.arg(1), e.arg(2));
            let h = if f & 4 != 0 {
                e.module_at(nm)
            } else if nm == 0 {
                Some(e.s.exe_base)
            } else {
                let n = if name.ends_with('W') { e.read_wstr(nm, 260) } else { e.read_cstr(nm, 260) };
                crate::pe::find_module(e, &n).map(|i| e.s.modules[i].base)
            };
            match h {
                Some(h) => {
                    e.w64(out, h);
                    1
                }
                None => {
                    e.w64(out, 0);
                    e.set_last_error(126);
                    0
                }
            }
        }
        "DisableThreadLibraryCalls" => 1,
        "RtlPcToFileHeader" => {
            let b = e.module_at(a0).unwrap_or(0);
            let o = e.arg(1);
            e.w64(o, b);
            b
        }
        "SetThreadStackGuarantee" => {
            e.w32(a0, 0);
            1
        }
        "GetCurrentThreadStackLimits" => {
            let (lo, hi) = (e.r64(e.cpu.gs_base + 0x10), e.r64(e.cpu.gs_base + 0x08));
            let b = e.arg(1);
            e.w64(a0, lo);
            e.w64(b, hi);
            0
        }
        "DelayLoadFailureHook" => 0,
        "ResolveDelayLoadedAPI" => {
            // IMAGE_DELAYLOAD_DESCRIPTOR: attributes, dll name, module handle, IAT, INT (RVAs)
            let (base, d, slot) = (a0, e.arg(1), e.arg(4));
            let rd = |e: &mut Engine, a: u64| e.r32(a) as u64;
            let (name_rva, hmod_rva, iat_rva, int_rva) = (rd(e, d + 4), rd(e, d + 8), rd(e, d + 12), rd(e, d + 16));
            let dll = e.read_cstr(base + name_rva, 256);
            let k = (slot - (base + iat_rva)) / 8;
            let ent = e.r64(base + int_rva + 8 * k);
            let func = if ent >> 63 == 1 { format!("#{}", ent & 0xFFFF) } else { e.read_cstr(base + (ent & 0x7FFF_FFFF) + 2, 256) };
            let addr = match crate::pe::load_by_name(e, &dll) {
                Ok(m) => {
                    if hmod_rva != 0 {
                        let h = e.s.modules[m].base;
                        e.w64(base + hmod_rva, h);
                    }
                    crate::pe::proc_address(e, m, &func).unwrap_or_else(|| e.thunk(&dll, &func))
                }
                Err(_) => e.thunk(&dll, &func),
            };
            e.w64(slot, addr);
            addr
        }
        "AddDllDirectory" => {
            let p = e.read_wstr(a0, 32767);
            if let Some(k) = crate::files::key_of(&p) {
                if !e.s.dll_dirs.contains(&k) {
                    e.s.dll_dirs.push(k);
                }
            }
            0x0D11_0000 + e.s.dll_dirs.len() as u64
        }
        "SetProcessDEPPolicy" | "SetSearchPathMode" | "RemoveDllDirectory" => 1,
        "SetProcessMitigationPolicy"
        | "SetProcessPriorityBoost"
        | "SetPriorityClass"
        | "SetThreadPriority"
        | "SetThreadPriorityBoost"
        | "SetThreadIdealProcessor" => 1,
        "GetPriorityClass" => 0x20,
        "GetThreadPriority" => 0,
        "SetThreadDescription" => 0,
        "GetThreadDescription" => {
            let p = e.arg(1);
            let a = e.heap_alloc(2, true);
            e.w64(p, a);
            0
        }
        "SetConsoleTitleW" | "SetConsoleTitleA" | "SetConsoleTextAttribute" | "SetConsoleCursorPosition" | "FlushConsoleInputBuffer" => 1,
        "GetConsoleTitleW" | "GetConsoleTitleA" => 0,
        "GetConsoleWindow" => 0,
        _ => return e.not_mine(),
    })
}
