#!/bin/sh
# Builds wine.wasm: a slice of Wine's msvcrt compiled to wasm, with every
# memory access routed through the InkSoC page table.
#   clang (as x86-64 Windows, the guest ABI) -> retarget.py -> llc wasm64
#   -> wasm-ld -> wasm-opt --instrument-memory -> identity value hooks
#   -> wasm-opt --memory64-lowering -> ../../wine.wasm
# Needs clang/llc/wasm-ld 18, binaryen (wasm-opt, wasm-dis, wasm-as) and git.
set -e
cd "$(dirname "$0")"
TAG=wine-10.0
W=.cache/wine
if [ ! -d $W ]; then
  git clone -q --depth 1 --filter=blob:none --sparse -b $TAG https://github.com/wine-mirror/wine.git $W
  (cd $W && git sparse-checkout set dlls/msvcrt include)
fi
B=.cache/build; mkdir -p $B
CF="--target=x86_64-w64-windows-gnu -O2 -Istub -I$W/include -I$W/include/msvcrt -I$W/dlls/msvcrt \
 -D__WINESRC__ -D__WINE_PE_BUILD -D_MSVCR_VER=0 -D_CRTIMP= -nostdinc \
 -isystem $(clang -print-resource-dir)/include -fno-builtin -ffreestanding -w"
OBJS=""
for f in $W/dlls/msvcrt/string.c $W/dlls/msvcrt/wcs.c $W/dlls/msvcrt/ctype.c glue.c; do
  n=$(basename $f .c)
  clang $CF -S -emit-llvm $f -o $B/$n.x64.ll
  python3 retarget.py $B/$n.x64.ll $B/$n.ll
  llc -mtriple=wasm64-unknown-unknown -mattr=-bulk-memory -O2 -filetype=obj $B/$n.ll -o $B/$n.o
  OBJS="$OBJS $B/$n.o"
done
# Wine's own data and stack live at 1-4 MB of the engine's memory (the engine
# keeps that range free); everything above is reached through the page table.
wasm-ld -mwasm64 --no-entry --import-memory --allow-undefined-file=imports.txt --gc-sections \
  --export=ink_call --global-base=1048576 -z stack-size=262144 $OBJS -o $B/wine64.wasm
wasm-opt --enable-memory64 --enable-sign-ext --enable-mutable-globals --instrument-memory $B/wine64.wasm -o $B/inst.wasm
wasm-dis $B/inst.wasm -o $B/inst.wat
python3 - $B/inst.wat <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
defs = []
def repl(m):
    name, ty = m.group(1), m.group(2)
    defs.append(f' (func {name} (param i32 {ty}) (result {ty}) (local.get 1))\n')
    return ''
s = re.sub(r' \(import "env" "(?:load|store)_val_\w+" \(func (\$\S+) \(param i32 (\w+)\) \(result \w+\)\)\)\n', repl, s)
i = s.rindex(')')
open(p, 'w').write(s[:i] + ''.join(defs) + s[i:])
PY
wasm-as --enable-memory64 --enable-sign-ext --enable-mutable-globals $B/inst.wat -o $B/inst2.wasm
wasm-opt --enable-memory64 --enable-sign-ext --enable-mutable-globals --memory64-lowering -O3 $B/inst2.wasm -o ../../wine.wasm
wasm-dis ../../wine.wasm | grep '(import' 
ls -l ../../wine.wasm
