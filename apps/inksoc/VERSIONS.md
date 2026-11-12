# InkSoC engine versions

Stable points of the Windows engine (apps/inksoc/src/engine). Other engines built on it sync to these.

- 0.1 = cd8c4ed: Wine 11 DLLs, 49/56 on the compat list.
- 0.2 = c88fdf3: window layer (Wine's win32u: NtUser window manager, NtGdi drawing, screen composer); WineMine runs. Shared files touched: lib.rs, sched.rs, pe.rs, ntsys.rs, kernel32.rs (no change to mmu.rs or linux.rs).
- 0.3 = 80e6b47: 54/56; pipes, file mappings (sections), DuplicateHandle refcounts, WaitOnAddress fix, multi-core window fix (lib.rs run loop). Shared files touched: lib.rs, sched.rs, files.rs, ntsys.rs, winapi.rs, pe.rs; no change to mmu.rs or linux.rs.
- 0.4 = (this commit, see git log "56/56"): 56/56; Windows child processes (proc.rs: per-process address space and loader state, CreateProcess, process handles), real folder tree (files.rs case_of/key_of), DLL search folders, minimal socket device, environment variables. Shared files touched: mmu.rs (frames carry an address-space id; eviction only takes the running process's pages), sched.rs, lib.rs, pe.rs, files.rs, ntsys.rs, kernel32.rs, winapi.rs, msvcrt.rs. linux.rs unchanged.
