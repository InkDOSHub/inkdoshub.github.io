// Our own kernel32: the functions a normal program needs to start and run,
// implemented natively (wasm) against the engine. Single thread for now.

use crate::{console, pe, Engine, PEB, RET_LOADLIB, TEB};

/// Returned by functions that already set rip themselves (no `ret`).
pub const NO_RETURN: u64 = u64::MAX - 0x5A5A;

const PROCESS_HEAP: u64 = 0x0000_0000_00AA_0000;
const ERROR_ENVVAR_NOT_FOUND: u32 = 203;

impl Engine {
    fn set_last_error(&mut self, v: u32) { let _ = self.mmu.write32(TEB + 0x68, v); }
    fn w32(&mut self, a: u64, v: u32) { if a != 0 { let _ = self.mmu.write32(a, v); } }
    fn w64(&mut self, a: u64, v: u64) { if a != 0 { let _ = self.mmu.write64(a, v); } }
    fn zero(&mut self, a: u64, n: u64) { for i in 0..n { let _ = self.mmu.write8(a + i, 0); } }

    fn module_by_handle(&self, h: u64) -> Option<usize> {
        if h == 0 { return self.modules.iter().position(|m| m.base == self.exe_base); }
        self.modules.iter().position(|m| m.base == h)
    }

    fn load_library(&mut self, name: &str) -> u64 {
        let before = self.init_queue.len();
        match pe::load_by_name(self, name) {
            Ok(i) => {
                let h = self.modules[i].base;
                if self.init_queue.len() > before {
                    // run the new DllMain(s), then return h to the caller
                    let pending: Vec<(u64, u64)> = self.init_queue.drain(before..).collect();
                    let caller_sp = self.cpu.regs[4];
                    // simple case: one new DLL (dependencies' DllMains are skipped for now)
                    let (entry, base) = pending[pending.len() - 1];
                    self.loadlib.push((h, caller_sp));
                    self.call_guest(entry, [base, 1, 0], RET_LOADLIB);
                    return NO_RETURN;
                }
                h
            }
            Err(m) => { console(&format!("[inksoc] LoadLibrary {}: {}\n", name, m)); self.set_last_error(126); 0 }
        }
    }

    fn write_out(&mut self, h: u64, p: u64, n: u64) -> bool {
        if h != 1 && h != 2 { return false; }
        let mut v = vec![0u8; n.min(1 << 20) as usize];
        if self.mmu.read_bytes(p, &mut v).is_err() { return false; }
        console(&String::from_utf8_lossy(&v));
        true
    }

    fn get_system_info(&mut self, a: u64) {
        self.zero(a, 48);
        let _ = self.mmu.write16(a, 9); // AMD64
        self.w32(a + 4, 4096);
        self.w64(a + 8, 0x10000);
        self.w64(a + 16, 0x7FFF_FFFE_FFFF);
        self.w64(a + 24, 1);
        self.w32(a + 32, 1); // processors (one core for now)
        self.w32(a + 36, 8664);
        self.w32(a + 40, 0x10000);
        let _ = self.mmu.write16(a + 44, 6);
    }
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    let r = match name {
        // ---- console & process ----
        "GetStdHandle" => match a0 as u32 as i32 { -11 => 1, -12 => 2, -10 => 3, _ => u64::MAX },
        "WriteFile" | "WriteConsoleA" => {
            let (p, n, w) = (e.arg(1), e.arg(2) as u32 as u64, e.arg(3));
            if e.write_out(a0, p, n) { e.w32(w, n as u32); 1 } else { e.set_last_error(6); 0 }
        }
        "WriteConsoleW" => {
            let (p, n, w) = (e.arg(1), e.arg(2) as u32 as u64, e.arg(3));
            let mut v = vec![0u16; n as usize];
            for (i, c) in v.iter_mut().enumerate() { *c = e.mmu.read16(p + 2 * i as u64).unwrap_or(63); }
            console(&String::from_utf16_lossy(&v));
            e.w32(w, n as u32);
            1
        }
        "GetConsoleMode" => { let a = e.arg(1); e.w32(a, 3); 1 }
        "SetConsoleMode" | "SetConsoleCtrlHandler" | "SetConsoleOutputCP" | "SetConsoleCP" => 1,
        "GetConsoleCP" | "GetConsoleOutputCP" => 65001,
        "GetFileType" => if a0 <= 3 { 2 } else { 0 },
        "FlushFileBuffers" => 1,
        "OutputDebugStringA" => { let s = e.read_cstr(a0, 4096); console(&format!("[debug] {}", s)); 0 }
        "ExitProcess" => { e.exited = true; e.exit_code = a0 as u32; return Some(NO_RETURN); }
        "TerminateProcess" => { e.exited = true; e.exit_code = e.arg(1) as u32; return Some(NO_RETURN); }
        "GetCurrentProcessId" => 4,
        "GetCurrentThreadId" => 8,
        "GetCurrentProcess" => u64::MAX,
        "GetCurrentThread" => u64::MAX - 1,
        "GetCommandLineA" => e.cmdline.0,
        "GetCommandLineW" => e.cmdline.1,
        "GetEnvironmentVariableA" | "GetEnvironmentVariableW" => { e.set_last_error(ERROR_ENVVAR_NOT_FOUND); 0 }
        "GetStartupInfoA" | "GetStartupInfoW" => { e.zero(a0, 104); e.w32(a0, 104); 0 }
        "IsDebuggerPresent" => 0,
        "SetDefaultDllDirectories" | "SetDllDirectoryW" | "SetDllDirectoryA" => 1,
        "SetUnhandledExceptionFilter" | "UnhandledExceptionFilter" => 0,
        "RaiseException" => { e.error = Some(format!("the program raised exception 0x{:x}", a0 as u32)); return Some(NO_RETURN); }
        "GetVersion" => (19045 << 16) | 10,

        // ---- time ----
        "GetTickCount" => unsafe { crate::host_now_ms() as u64 & 0xFFFF_FFFF },
        "GetTickCount64" => unsafe { crate::host_now_ms() as u64 },
        "QueryPerformanceFrequency" => { e.w64(a0, 10_000_000); 1 }
        "QueryPerformanceCounter" => { let v = unsafe { crate::host_now_ms() * 10_000.0 } as u64; e.w64(a0, v); 1 }
        "GetSystemTimeAsFileTime" | "GetSystemTimePreciseAsFileTime" => {
            let ft = (unsafe { crate::host_epoch_ms() } as u64 + 11_644_473_600_000) * 10_000;
            e.w64(a0, ft); 0
        }
        "Sleep" | "SleepEx" => 0,
        "SwitchToThread" => 0,

        // ---- system ----
        "GetSystemInfo" | "GetNativeSystemInfo" => { e.get_system_info(a0); 0 }
        "GlobalMemoryStatusEx" => {
            // the program sees the memory target, not the real RAM pool
            let total = e.mmu.target_bytes;
            let free = total.saturating_sub(e.mmu.committed);
            e.w32(a0 + 4, (e.mmu.committed * 100 / total.max(1)) as u32);
            e.w64(a0 + 8, total); e.w64(a0 + 16, free);
            e.w64(a0 + 24, total); e.w64(a0 + 32, free);
            e.w64(a0 + 40, 0x7FFF_FFFE_0000); e.w64(a0 + 48, 0x7FFF_FFFE_0000 - e.mmu.committed);
            e.w64(a0 + 56, 0);
            1
        }
        "IsProcessorFeaturePresent" => matches!(a0, 6 | 10 | 3 | 8 | 12 | 20) as u64, // SSE, SSE2, MMX, RDTSC, NX, ...
        "GetLastError" => e.mmu.read32(TEB + 0x68).unwrap_or(0) as u64,
        "SetLastError" => { e.set_last_error(a0 as u32); 0 }

        // ---- TLS / FLS (64 slots in the TEB) ----
        "TlsAlloc" | "FlsAlloc" => {
            match (0..64).find(|i| e.tls_used & (1 << i) == 0) {
                Some(i) => { e.tls_used |= 1 << i; let _ = e.mmu.write64(TEB + 0x1480 + 8 * i, 0); i }
                None => 0xFFFF_FFFF,
            }
        }
        "TlsFree" | "FlsFree" => { if a0 < 64 { e.tls_used &= !(1 << a0); } 1 }
        "TlsGetValue" | "FlsGetValue" => { e.set_last_error(0); if a0 < 64 { e.mmu.read64(TEB + 0x1480 + 8 * a0).unwrap_or(0) } else { 0 } }
        "TlsSetValue" | "FlsSetValue" => { let v = e.arg(1); if a0 < 64 { let _ = e.mmu.write64(TEB + 0x1480 + 8 * a0, v); 1 } else { 0 } }

        // ---- locks: one thread for now, so they only need to exist ----
        "InitializeCriticalSection" | "InitializeCriticalSectionAndSpinCount" | "InitializeCriticalSectionEx" => { e.zero(a0, 40); 1 }
        "EnterCriticalSection" | "LeaveCriticalSection" | "DeleteCriticalSection" => 0,
        "TryEnterCriticalSection" => 1,
        "InitializeSRWLock" | "AcquireSRWLockExclusive" | "ReleaseSRWLockExclusive" | "AcquireSRWLockShared" | "ReleaseSRWLockShared" => 0,

        // ---- heap ----
        "GetProcessHeap" | "HeapCreate" => PROCESS_HEAP,
        "HeapDestroy" => 1,
        "HeapAlloc" => { let (f, n) = (e.arg(1), e.arg(2)); e.heap_alloc(n, f & 8 != 0) }
        "HeapFree" => { let p = e.arg(2); (p == 0 || e.heap_free(p)) as u64 }
        "HeapReAlloc" => { let (f, p, n) = (e.arg(1), e.arg(2), e.arg(3)); e.heap_realloc(p, n, f & 8 != 0) }
        "HeapSize" => { let p = e.arg(2); e.heap_size(p) }
        "LocalAlloc" | "GlobalAlloc" => { let n = e.arg(1); e.heap_alloc(n, a0 & 0x40 != 0) }
        "LocalFree" | "GlobalFree" => { if a0 != 0 { e.heap_free(a0); } 0 }

        // ---- virtual memory ----
        "VirtualAlloc" => {
            let size = e.arg(1);
            if a0 == 0 { e.alloc(size).unwrap_or(0) }
            else if e.mmu.region_of(a0).is_some() { a0 & !0xFFF }
            else {
                let start = a0 & !0xFFFF;
                let end = (a0 + size + 0xFFFF) & !0xFFFF;
                if e.mmu.overlaps(start, end) { e.set_last_error(487); 0 } else { e.mmu.add_region(start, end - start); a0 }
            }
        }
        "VirtualFree" => {
            let (size, kind) = (e.arg(1), e.arg(2));
            if kind & 0x8000 != 0 { e.mmu.release_region(a0) as u64 } else { e.mmu.drop_pages(a0 & !0xFFF, a0 + size); 1 }
        }
        "VirtualProtect" => { let old = e.arg(3); e.w32(old, 4); 1 }
        "VirtualQuery" => {
            let mbi = e.arg(1);
            e.zero(mbi, 48);
            let page = a0 & !0xFFF;
            e.w64(mbi, page);
            match e.mmu.region_of(a0) {
                Some((s, end)) => {
                    e.w64(mbi + 8, s); e.w32(mbi + 16, 4); e.w64(mbi + 24, end - page);
                    e.w32(mbi + 32, 0x1000); e.w32(mbi + 36, 4); e.w32(mbi + 40, 0x20000);
                }
                None => { e.w64(mbi + 24, 0x1000); e.w32(mbi + 32, 0x10000); e.w32(mbi + 36, 1); }
            }
            48
        }

        // ---- modules ----
        "GetModuleHandleA" | "GetModuleHandleW" => {
            if a0 == 0 { e.exe_base } else {
                let n = if name.ends_with('W') { e.read_wstr(a0, 260) } else { e.read_cstr(a0, 260) };
                match pe::find_module(e, &n) { Some(i) => e.modules[i].base, None => { e.set_last_error(126); 0 } }
            }
        }
        "GetModuleFileNameA" | "GetModuleFileNameW" => {
            let (buf, n) = (e.arg(1), e.arg(2));
            let path = match e.module_by_handle(a0) { Some(i) => format!("C:\\InkSoC\\{}", e.modules[i].name), None => { e.set_last_error(126); return Some(0); } };
            let k = (path.len() as u64).min(n.saturating_sub(1));
            if name.ends_with('W') {
                for (i, c) in path.encode_utf16().take(k as usize).enumerate() { let _ = e.mmu.write16(buf + 2 * i as u64, c); }
                let _ = e.mmu.write16(buf + 2 * k, 0);
            } else {
                let _ = e.mmu.write_bytes(buf, &path.as_bytes()[..k as usize]);
                let _ = e.mmu.write8(buf + k, 0);
            }
            k
        }
        "GetProcAddress" => {
            let f = if e.arg(1) >> 16 == 0 { format!("#{}", e.arg(1)) } else { let p = e.arg(1); e.read_cstr(p, 256) };
            match e.module_by_handle(a0) {
                Some(i) => pe::proc_address(e, i, &f).unwrap_or_else(|| { e.set_last_error(127); 0 }),
                None => { e.set_last_error(126); 0 }
            }
        }
        "LoadLibraryA" | "LoadLibraryExA" => { let n = e.read_cstr(a0, 260); return Some(e.load_library(&n)); }
        "LoadLibraryW" | "LoadLibraryExW" => { let n = e.read_wstr(a0, 260); return Some(e.load_library(&n)); }
        "FreeLibrary" => 1,
        _ => return None,
    };
    let _ = PEB;
    Some(r)
}
