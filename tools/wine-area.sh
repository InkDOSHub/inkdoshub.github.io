#!/bin/sh
# Compila a área de trabalho do Wine (apps/wine/area/area.c) para Windows 32 bits.
set -e
cd "$(dirname "$0")/../apps/wine/area"
i686-w64-mingw32-gcc -O2 -s -municode -mwindows -o area.exe area.c -lcomctl32 -lshell32 -lole32 -luser32 -lgdi32
ls -l area.exe
