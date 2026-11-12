# Wine 11.0 DLLs

These are the x86-64 PE builds of Wine 11.0's DLLs, taken unchanged except for
stripped debug symbols (`x86_64-w64-mingw32-strip`) from WineHQ's package
`wine-stable-amd64 11.0.0.0~noble-1`, plus `l_intl.nls` (the case tables).
Each file is renamed `wine-<name>.dll`.

InkSoC runs them as program code: any Windows function the engine does not
implement itself comes from these DLLs. Wine's ntdll system calls are answered
by the engine (`src/engine/src/ntsys.rs`, `sched.rs`), playing the part of
Wine's Unix side.

Wine is free software under the GNU Lesser General Public License 2.1 or later
(https://www.winehq.org/license). The source for this exact version is the
Wine
11.0 release (https://dl.winehq.org/wine/source/11.0/).
