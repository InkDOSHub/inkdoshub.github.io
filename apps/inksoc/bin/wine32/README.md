# Wine 11.0 32-bit DLLs (WoW64)

The i386 PE builds of Wine 11.0's DLLs, taken unchanged except for stripped
debug symbols (`x86_64-w64-mingw32-strip`) from WineHQ's package
`wine-stable-i386 11.0.0.0~noble-1`, each renamed `wine32-<name>.dll`, plus
Wine's `.nls` tables (locale, sorting, code pages 1252/437/20127, NFC) and
`winemine32.exe` (Wine's Minesweeper, 32-bit build) as a test program.

A 32-bit program runs the way 64-bit Windows runs it: these DLLs execute as
32-bit code; their system calls go through Wine's 64-bit WoW64 layer
(`../wine/wine-wow64.dll`, `wine-wow64win.dll`, `wine-wow64cpu.dll`, from the
`wine-stable-amd64` package of the same version), which converts them for the
engine. The page downloads this folder only for 32-bit programs.

Wine is free software under the GNU Lesser General Public License 2.1 or later
(https://www.winehq.org/license). Source: https://dl.winehq.org/wine/source/11.0/
