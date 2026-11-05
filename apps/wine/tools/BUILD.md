# cputest.exe

Small 32-bit Windows CPU test (source: bench.c). Same loop as apps/xeos-tests/emu.js, so results compare with the browser test.

    llvm-dlltool -m i386 -d k32.def -l k32.lib -k
    llvm-dlltool -m i386 -d u32.def -l u32.lib -k
    clang --target=i686-pc-windows-msvc -O2 -ffreestanding -fno-builtin -fno-stack-protector -c bench.c -o bench.obj
    lld-link /subsystem:windows /entry:start /nodefaultlib bench.obj k32.lib u32.lib /out:../apps/cputest.exe
