# InkSoC engine versions

Stable points of the Windows engine (apps/inksoc/src/engine). Other engines built on it sync to these.

- 0.1 = cd8c4ed: Wine 11 DLLs, 49/56 on the compat list.
- 0.2 = c88fdf3: window layer (Wine's win32u: NtUser window manager, NtGdi drawing, screen composer); WineMine runs. Shared files touched: lib.rs, sched.rs, pe.rs, ntsys.rs, kernel32.rs (no change to mmu.rs or linux.rs).
