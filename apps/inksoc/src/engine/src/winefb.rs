// Wine as the rest of Windows: any function the engine does not implement
// natively comes from Wine's own DLLs (Wine 9.0, x86-64 PE builds, shipped
// as wine-<name>.dll), run as program code. Wine's ntdll is the bottom
// layer: its system calls (Nt*/Zw*) and the functions that must share the
// engine's state (heap, locks, last error, loader) are patched to jump to the
// engine's native versions, which play the part of Wine's Unix side.

use crate::{pe, Engine};

/// Native function that takes the place of a Wine ntdll export, if any.
pub fn redirect(name: &str) -> Option<String> {
    if let Some(r) = name.strip_prefix("Zw") { return Some(format!("Nt{}", r)); }
    if name.starts_with("Nt") && name.len() > 2 && name.as_bytes()[2].is_ascii_uppercase() { return Some(name.to_string()); }
    const KEEP: &[&str] = &[
        "RtlAllocateHeap", "RtlFreeHeap", "RtlReAllocateHeap", "RtlSizeHeap", "RtlCreateHeap", "RtlDestroyHeap", "RtlGetProcessHeaps",
        "RtlValidateHeap", "RtlCompactHeap", "RtlGetUserInfoHeap", "RtlSetUserValueHeap", "RtlSetUserFlagsHeap", "RtlLockHeap", "RtlUnlockHeap", "RtlWalkHeap", "RtlSetHeapInformation", "RtlQueryHeapInformation",
        "RtlEnterCriticalSection", "RtlLeaveCriticalSection", "RtlTryEnterCriticalSection", "RtlInitializeCriticalSection",
        "RtlInitializeCriticalSectionEx", "RtlInitializeCriticalSectionAndSpinCount", "RtlDeleteCriticalSection",
        "RtlIsCriticalSectionLocked", "RtlIsCriticalSectionLockedByThread",
        "RtlInitializeSRWLock", "RtlAcquireSRWLockExclusive", "RtlAcquireSRWLockShared", "RtlReleaseSRWLockExclusive",
        "RtlReleaseSRWLockShared", "RtlTryAcquireSRWLockExclusive", "RtlTryAcquireSRWLockShared",
        "RtlGetLastWin32Error", "RtlSetLastWin32Error", "RtlRestoreLastWin32Error",
        "RtlPcToFileHeader",
        "LdrGetProcedureAddress", "LdrLoadDll", "LdrGetDllHandle", "LdrGetDllHandleEx", "LdrUnloadDll", "LdrAddRefDll",
        "LdrFindEntryForAddress", "LdrLockLoaderLock", "LdrUnlockLoaderLock", "LdrDisableThreadCalloutsForDll",
        "RtlExitUserThread", "RtlExitUserProcess", "RtlQueryPerformanceCounter", "RtlQueryPerformanceFrequency",
        "RtlGetCurrentPeb", "RtlGetCurrentProcessorNumber", "RtlGetCurrentProcessorNumberEx",
        "RtlWaitOnAddress", "RtlWakeAddressAll", "RtlWakeAddressSingle",
        "RtlFlsAlloc", "RtlFlsFree", "RtlFlsGetValue", "RtlFlsSetValue",
        "DbgPrint", "DbgPrintEx", "DbgBreakPoint", "DbgUserBreakPoint",
        "__wine_dbg_header", "__wine_dbg_output", "__wine_dbg_strdup", "__wine_dbg_get_channel_flags",
    ];
    if KEEP.contains(&name) { return Some(name.to_string()); }
    None
}

/// Native name that implements an ntdll function (same arguments).
pub fn alias(name: &str) -> Option<&'static str> {
    Some(match name {
        "RtlAllocateHeap" => "HeapAlloc",
        "RtlFreeHeap" => "HeapFree",
        "RtlReAllocateHeap" => "HeapReAlloc",
        "RtlSizeHeap" => "HeapSize",
        "RtlCreateHeap" => "HeapCreate",
        "RtlDestroyHeap" => "HeapDestroy",
        "RtlValidateHeap" => "HeapValidate",
        "RtlCompactHeap" => "HeapCompact",
        "RtlLockHeap" => "HeapLock",
        "RtlUnlockHeap" => "HeapUnlock",
        "RtlWalkHeap" => "HeapWalk",
        "RtlGetProcessHeaps" => "GetProcessHeaps",
        "RtlSetHeapInformation" => "HeapSetInformation",
        "RtlQueryHeapInformation" => "HeapQueryInformation",
        "RtlEnterCriticalSection" => "EnterCriticalSection",
        "RtlLeaveCriticalSection" => "LeaveCriticalSection",
        "RtlTryEnterCriticalSection" => "TryEnterCriticalSection",
        "RtlInitializeCriticalSection" => "InitializeCriticalSection",
        "RtlInitializeCriticalSectionEx" => "InitializeCriticalSectionEx",
        "RtlInitializeCriticalSectionAndSpinCount" => "InitializeCriticalSectionAndSpinCount",
        "RtlDeleteCriticalSection" => "DeleteCriticalSection",
        "RtlInitializeSRWLock" => "InitializeSRWLock",
        "RtlAcquireSRWLockExclusive" => "AcquireSRWLockExclusive",
        "RtlAcquireSRWLockShared" => "AcquireSRWLockShared",
        "RtlReleaseSRWLockExclusive" => "ReleaseSRWLockExclusive",
        "RtlReleaseSRWLockShared" => "ReleaseSRWLockShared",
        "RtlTryAcquireSRWLockExclusive" => "TryAcquireSRWLockExclusive",
        "RtlTryAcquireSRWLockShared" => "TryAcquireSRWLockShared",
        "RtlGetLastWin32Error" => "GetLastError",
        "RtlSetLastWin32Error" | "RtlRestoreLastWin32Error" => "SetLastError",
        "RtlQueryPerformanceCounter" => "QueryPerformanceCounter",
        "RtlQueryPerformanceFrequency" => "QueryPerformanceFrequency",
        "RtlGetCurrentProcessorNumber" => "GetCurrentProcessorNumber",
        "RtlGetCurrentProcessorNumberEx" => "GetCurrentProcessorNumberEx",
        "RtlExitUserThread" => "ExitThread",
        "RtlExitUserProcess" => "ExitProcess",
        "RtlFlsAlloc" => "FlsAlloc",
        "RtlFlsFree" => "FlsFree",
        "RtlFlsGetValue" => "FlsGetValue",
        "RtlFlsSetValue" => "FlsSetValue",
        "RtlPcToFileHeader" => "RtlPcToFileHeader",
        _ => return None,
    })
}

/// Export names of a PE file (read from its bytes, without loading it).
fn export_names(b: &[u8]) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let r16 = |o: usize| b.get(o..o + 2).map(|x| u16::from_le_bytes([x[0], x[1]]) as usize);
    let r32 = |o: usize| b.get(o..o + 4).map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]) as usize);
    let Some(pe) = r32(0x3C) else { return out };
    let (Some(nsec), Some(opt)) = (r16(pe + 6), r16(pe + 20)) else { return out };
    let secs = pe + 24 + opt;
    let off = |rva: usize| -> Option<usize> {
        (0..nsec).find_map(|i| {
            let s = secs + 40 * i;
            let (va, size, raw) = (r32(s + 12)?, r32(s + 8)?.max(r32(s + 16)?), r32(s + 20)?);
            if rva >= va && rva < va + size { Some(rva - va + raw) } else { None }
        })
    };
    let Some(dir) = r32(pe + 24 + 112).and_then(off) else { return out };
    let (Some(n), Some(names)) = (r32(dir + 24), r32(dir + 32).and_then(off)) else { return out };
    for i in 0..n {
        let Some(p) = r32(names + 4 * i).and_then(off) else { continue };
        let end = b[p..].iter().position(|&c| c == 0).unwrap_or(0);
        out.insert(String::from_utf8_lossy(&b[p..p + end]).into_owned());
    }
    out
}

/// Functions programs must not find: newer Windows features that have a
/// fallback, which the engine does not offer yet.
const HIDDEN: &[&str] = &["NtCreateWaitCompletionPacket", "NtAssociateWaitCompletionPacket", "NtCancelWaitCompletionPacket"];

/// Wine modules to try for a function of `dll`.
fn candidates(dll: &str) -> Vec<String> {
    match dll {
        "ntdll.dll" => vec!["wine-ntdll.dll".into()],
        "kernel32.dll" | "kernelbase.dll" => vec!["wine-kernelbase.dll".into(), "wine-kernel32.dll".into(), "wine-ntdll.dll".into()],
        d if d.starts_with("api-ms-win-") || d.starts_with("ext-ms-win-") => vec!["wine-kernelbase.dll".into(), "wine-kernel32.dll".into(), "wine-ntdll.dll".into()],
        d => vec![format!("wine-{}", d)],
    }
}

/// Where to go once the DllMains of DLLs loaded in the middle of a call have run.
pub struct Resume { pub target: u64, pub regs: [u64; 4], pub rsp: u64, pub ret: Option<u64>, pub pending: Vec<(u64, u64)> }

impl Engine {
    /// Runs `pending` DllMains (in order), then either jumps to `target` with the
    /// call's registers restored, or returns `ret` to the caller.
    pub fn run_inits(&mut self, pending: Vec<(u64, u64)>, target: u64, ret: Option<u64>) {
        let c = &self.cpu;
        let r = Resume { target, regs: [c.regs[1], c.regs[2], c.regs[8], c.regs[9]], rsp: c.regs[4], ret, pending };
        self.s.resume.push(r);
        self.init_next();
    }

    pub fn init_next(&mut self) {
        let Some(r) = self.s.resume.last_mut() else { return };
        let rsp = r.rsp;
        if !r.pending.is_empty() {
            let (entry, base) = r.pending.remove(0);
            self.cpu.regs[4] = rsp;
            self.call_guest(entry, [base, 1, 0], crate::RET_FBINIT);
            return;
        }
        let r = self.s.resume.pop().unwrap();
        self.cpu.regs[4] = r.rsp;
        match r.ret {
            Some(v) => self.do_ret(v),
            None => {
                self.cpu.regs[1] = r.regs[0]; self.cpu.regs[2] = r.regs[1];
                self.cpu.regs[8] = r.regs[2]; self.cpu.regs[9] = r.regs[3];
                self.cpu.rip = r.target;
            }
        }
    }

    pub(crate) fn wine_module_pub(&mut self, file: &str) -> Option<usize> { self.wine_module(file) }
    /// Loads one of the shipped Wine DLLs (without running its DllMain).
    fn wine_module(&mut self, file: &str) -> Option<usize> {
        if let Some(i) = pe::find_module(self, file) { return Some(i); }
        let bytes = self.s.files.get(file).cloned()?;
        let i = pe::load_image(self, file, &bytes, false).ok()?;
        // the core modules share the engine's state: their own DllMain must not run
        if ["wine-ntdll.dll", "wine-kernelbase.dll", "wine-kernel32.dll"].contains(&file) {
            let b = self.s.modules[i].base;
            self.s.init_queue.retain(|&(_, base)| base != b);
        }
        if file == "wine-ntdll.dll" { self.patch_wine_ntdll(i); self.wine_nls(i); }
        Some(i)
    }

    /// Makes Wine's ntdll use the engine for system calls and shared state.
    fn patch_wine_ntdll(&mut self, i: usize) {
        let names: Vec<(String, u64)> = self.s.modules[i].exports.iter().filter(|(_, &a)| a != 0).map(|(n, &a)| (n.clone(), a)).collect();
        for (n, a) in names {
            if n.starts_with('#') { continue; }
            if let Some(native) = redirect(&n) {
                let t = self.thunk("ntdll.dll", &native);
                let mut code = vec![0x48, 0xB8];
                code.extend_from_slice(&t.to_le_bytes());
                code.extend_from_slice(&[0xFF, 0xE0]);
                let _ = self.mmu.write_bytes(a, &code);
            }
        }
    }

    /// Wine's process start (skipped here) fills ntdll's text tables: UTF-8 as
    /// the ANSI/OEM code page and the case tables from l_intl.nls.
    fn wine_nls(&mut self, i: usize) {
        let base = self.s.modules[i].base;
        // the globals' places come from the code that uses them (any Wine version):
        // RtlUpcaseUnicodeChar reads nls_info.UpperCaseTable with `mov rcx, [rip+d]`,
        // RtlResetRtlTranslations stores NlsAnsiCodePage with `mov [rip+d], eax`
        let find = |e: &mut Engine, f: &str, pat: &[u8]| -> Option<u64> {
            let a = *e.s.modules[i].exports.get(f)?;
            let mut b = [0u8; 32];
            e.mmu.read_bytes(a, &mut b).ok()?;
            let k = (0..32 - pat.len() - 4).find(|&k| &b[k..k + pat.len()] == pat)?;
            let d = i32::from_le_bytes(b[k + pat.len()..k + pat.len() + 4].try_into().ok()?) as i64;
            Some((a as i64 + (k + pat.len() + 4) as i64 + d) as u64)
        };
        let Some(upper) = find(self, "RtlUpcaseUnicodeChar", &[0x48, 0x8B, 0x0D]) else { return };
        let acp = find(self, "RtlResetRtlTranslations", &[0x89, 0x05]);
        let _ = base;
        let nls = upper - 0x80;
        for t in [nls, nls + 0x40] {
            let _ = self.mmu.write_bytes(t, &[0xE9, 0xFD, 4, 0, 0x3F, 0, 0xFD, 0xFF, 0x3F, 0, 0x3F, 0]);
        }
        if let Some(cm) = self.s.files.get("l_intl.nls").cloned() {
            let a = self.heap_alloc(cm.len() as u64, false);
            let _ = self.mmu.write_bytes(a, &cm);
            let n = u16::from_le_bytes([cm[2], cm[3]]) as u64;
            let _ = self.mmu.write64(nls + 0x80, a + 4);
            let _ = self.mmu.write64(nls + 0x88, a + 4 + 2 * n);
        }
        if let Some(a) = acp { let _ = self.mmu.write16(a, 65001); } // NlsAnsiCodePage
    }

    /// Per-thread blocks Wine's ntdll expects in the TEB (activation context stack).
    pub fn teb_extras(&mut self, teb: u64) {
        let a = self.heap_alloc(0x40, true);
        let _ = self.mmu.write64(a + 0x18, a + 0x18); // FrameListCache: empty list
        let _ = self.mmu.write64(a + 0x20, a + 0x18);
        let _ = self.mmu.write64(teb + 0x2C8, a);
    }

    /// KUSER_SHARED_DATA at 0x7FFE0000: versions, processor features, clocks.
    pub fn shared_data(&mut self) {
        const K: u64 = 0x7FFE_0000;
        self.mmu.add_region(K, 0x1000);
        self.s.user_shared = true;
        let _ = self.mmu.write32(K + 0x4, 0x0FA0_0000); // TickCountMultiplier
        let _ = self.mmu.write32(K + 0x2C, 0x8664_8664);
        let root: Vec<u16> = "C:\\Windows".encode_utf16().collect();
        for (k, c) in root.iter().enumerate() { let _ = self.mmu.write16(K + 0x30 + 2 * k as u64, *c); }
        let _ = self.mmu.write32(K + 0x260, 19045); // NtBuildNumber
        let _ = self.mmu.write32(K + 0x264, 1); // NtProductType: workstation
        let _ = self.mmu.write8(K + 0x268, 1); // ProductTypeIsValid
        let _ = self.mmu.write32(K + 0x26C, 10);
        let _ = self.mmu.write32(K + 0x270, 0);
        // PF_: RDTSC 8, XMMI 6, XMMI64 10, SSE3 13, NX 12, CMPXCHG16B 14, FASTFAIL 23, SSSE3 36, SSE4_1 37, SSE4_2 38
        for f in [6u64, 8, 10, 12, 13, 14, 23, 36, 37, 38] { let _ = self.mmu.write8(K + 0x274 + f, 1); }
        let _ = self.mmu.write32(K + 0x2E8, 0x20_0000); // NumberOfPhysicalPages (8 GB)
        let _ = self.mmu.write32(K + 0x3C0, self.s.cores.max(1)); // ActiveProcessorCount
        let _ = self.mmu.write64(K + 0x3C8, 10_000_000); // QpcFrequency
        self.shared_time();
    }

    /// Refreshes the clocks of KUSER_SHARED_DATA (called every time slice).
    pub fn shared_time(&mut self) {
        const K: u64 = 0x7FFE_0000;
        let ms = unsafe { crate::host_now_ms() };
        let it = (ms * 10_000.0) as u64;
        let st = (unsafe { crate::host_epoch_ms() } as u64 + 11_644_473_600_000) * 10_000;
        let tick = (ms * 64.0 / 1000.0) as u64;
        for (o, v) in [(0x08u64, it), (0x14, st), (0x320, tick)] {
            let _ = self.mmu.write32(K + o + 8, (v >> 32) as u32);
            let _ = self.mmu.write32(K + o, v as u32);
            let _ = self.mmu.write32(K + o + 4, (v >> 32) as u32);
        }
        let _ = self.mmu.write32(K, tick as u32);
    }

    /// Whether GetProcAddress should find `name` in the native `dll`: Wine has it
    /// (or no Wine DLL covers that DLL, as before).
    pub fn wine_has(&mut self, dll: &str, name: &str) -> bool {
        if HIDDEN.contains(&name) { return false; }
        if name.starts_with('#') { return true; }
        let mut any = false;
        for c in candidates(dll) {
            if !self.s.files.contains_key(&c) { continue; }
            any = true;
            if !self.s.wine_exports.contains_key(&c) {
                let set = export_names(&self.s.files[&c]);
                self.s.wine_exports.insert(c.clone(), set);
            }
            if self.s.wine_exports[&c].contains(name) { return true; }
        }
        !any
    }

    /// Guest address of Wine's version of dll!name, if Wine has it.
    pub fn wine_fallback(&mut self, dll: &str, name: &str, from: u64) -> Option<u64> {
        if name.ends_with("(missing export)") { return None; }
        let key = format!("{}!{}", dll, name);
        if let Some(&a) = self.s.wine_fb.get(&key) { return Some(a); }
        // functions patched to the engine have no Wine version to fall back to
        if dll == "ntdll.dll" && redirect(name).is_some() { return None; }
        for c in candidates(dll) {
            let Some(m) = self.wine_module(&c) else { continue };
            if let Some(a) = pe::proc_address(self, m, name) {
                if a == from { continue; }
                self.s.wine_fb.insert(key, a);
                return Some(a);
            }
        }
        None
    }

    /// RTL_USER_PROCESS_PARAMETERS for Wine's code (current directory, image, command line, environment).
    pub fn process_parameters(&mut self, exe: &str) {
        let p = self.heap_alloc(0x400, true);
        let us = |e: &mut Engine, at: u64, s: &str| {
            let w: Vec<u16> = s.encode_utf16().collect();
            let b = e.heap_alloc(2 * w.len() as u64 + 2, true);
            for (k, c) in w.iter().enumerate() { let _ = e.mmu.write16(b + 2 * k as u64, *c); }
            let _ = e.mmu.write16(at, 2 * w.len() as u16);
            let _ = e.mmu.write16(at + 2, 2 * w.len() as u16 + 2);
            let _ = e.mmu.write64(at + 8, b);
        };
        let _ = self.mmu.write32(p, 0x400);
        let _ = self.mmu.write32(p + 4, 0x400);
        let _ = self.mmu.write32(p + 8, 1); // normalized
        let std = self.s.std;
        let _ = self.mmu.write64(p + 0x20, std[0]);
        let _ = self.mmu.write64(p + 0x28, std[1]);
        let _ = self.mmu.write64(p + 0x30, std[2]);
        us(self, p + 0x38, "C:\\InkSoC\\");
        us(self, p + 0x50, "C:\\InkSoC;C:\\Windows\\System32");
        us(self, p + 0x60, &format!("C:\\InkSoC\\{}", exe));
        let cmd = self.read_wstr(self.s.cmdline.1, 32768);
        us(self, p + 0x70, &cmd);
        // the usual Windows variables (installers read ProgramFiles / ProgramW6432 for their default folder)
        let vars = [
            "ALLUSERSPROFILE=C:\\ProgramData", "APPDATA=C:\\InkSoC\\AppData\\Roaming", "CommonProgramFiles=C:\\Program Files\\Common Files",
            "CommonProgramFiles(x86)=C:\\Program Files (x86)\\Common Files", "CommonProgramW6432=C:\\Program Files\\Common Files",
            "COMPUTERNAME=INKSOC", "ComSpec=C:\\Windows\\System32\\cmd.exe", "HOMEDRIVE=C:", "HOMEPATH=\\InkSoC",
            "LOCALAPPDATA=C:\\InkSoC\\AppData\\Local", "NUMBER_OF_PROCESSORS=4", "OS=Windows_NT",
            "PATH=C:\\InkSoC;C:\\Windows\\System32;C:\\Windows", "PATHEXT=.COM;.EXE;.BAT;.CMD", "PROCESSOR_ARCHITECTURE=AMD64",
            "ProgramData=C:\\ProgramData", "ProgramFiles=C:\\Program Files", "ProgramFiles(x86)=C:\\Program Files (x86)",
            "ProgramW6432=C:\\Program Files", "PUBLIC=C:\\Users\\Public", "SystemDrive=C:", "SystemRoot=C:\\Windows",
            "TEMP=C:\\InkSoC", "TMP=C:\\InkSoC", "USERDOMAIN=INKSOC", "USERNAME=user", "USERPROFILE=C:\\InkSoC", "windir=C:\\Windows",
        ];
        let env: Vec<u16> = (vars.join("\0") + "\0\0").encode_utf16().collect();
        let eb = self.heap_alloc(2 * env.len() as u64, true);
        for (k, c) in env.iter().enumerate() { let _ = self.mmu.write16(eb + 2 * k as u64, *c); }
        let _ = self.mmu.write64(p + 0x80, eb);
        let _ = self.mmu.write64(p + 0x3F0, 2 * env.len() as u64);
        us(self, p + 0xB0, "WinSta0\\Default"); // DesktopInfo
        let _ = self.mmu.write64(crate::PEB + 0x20, p);
        self.s.env_block = eb;
    }
}
