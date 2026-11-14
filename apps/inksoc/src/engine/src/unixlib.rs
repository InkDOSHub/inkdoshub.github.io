// Unix libraries: the Unix-side halves of Wine DLLs.
//
// A Wine DLL with a Unix half (opengl32.dll here) asks ntdll for its "unix funcs" handle
// once (NtQueryVirtualMemory, class MemoryWineUnixFuncs), then calls
// __wine_unix_call_dispatcher(handle, code, params) for each function. The engine plays
// the Unix side: the dispatcher points at a native thunk, and each handle names one of
// the engine's modules.

use crate::status::*;
use crate::Engine;

/// NtQueryVirtualMemory's class for a module's unix funcs handle.
pub const MEMORY_WINE_UNIX_FUNCS: u32 = 1000;

const OPENGL: u64 = 1;

/// The variable ntdll exports for the dispatcher: a pointer to the native thunk.
pub fn data_export(e: &mut Engine, dll: &str, name: &str) -> Option<u64> {
    if dll != "ntdll.dll" || name != "__wine_unix_call_dispatcher" {
        return None;
    }
    if e.s.unix_dispatcher == 0 {
        let a = e.heap_alloc(8, true);
        let t = e.thunk("ntdll.dll", "__wine_unix_call");
        e.w64(a, t);
        e.s.unix_dispatcher = a;
    }
    Some(e.s.unix_dispatcher)
}

/// The unix funcs handle of the module at `base`, or None when it has no Unix side here.
pub fn handle_of(e: &Engine, base: u64) -> Option<u64> {
    let m = e.s.modules.iter().find(|m| m.base == base)?;
    match m.name.trim_start_matches("wine-") {
        "opengl32.dll" => Some(OPENGL),
        _ => None,
    }
}

/// __wine_unix_call(handle, code, params).
pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    if name != "__wine_unix_call" {
        return e.not_mine();
    }
    let (handle, code, params) = (e.arg(0), e.arg(1) as u32, e.arg(2));
    Some(match handle {
        OPENGL => e.opengl_call(code, params),
        _ => NOT_IMPLEMENTED,
    })
}
