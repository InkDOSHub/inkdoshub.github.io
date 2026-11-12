#!/usr/bin/env python3
"""Turns LLVM IR compiled for x86-64 Windows (the guest ABI: LLP64, 8-byte
va_list slots, Windows struct layouts) into IR for wasm64, so Wine's C code
keeps the exact guest data layout while running as wasm.
Usage: retarget.py in.ll out.ll"""
import re, sys

src = open(sys.argv[1]).read().split('\n')
out = []
for line in src:
    if line.startswith('module asm'):
        continue
    if line.startswith('target datalayout'):
        line = 'target datalayout = "e-m:e-p:64:64-p10:8:8-p20:8:8-i64:64-i128:128-n32:64-S128-ni:1:10:20"'
    elif line.startswith('target triple'):
        line = 'target triple = "wasm64-unknown-unknown"'
    # NtCurrentTeb(): "movq %gs:0x30" becomes a call into the engine
    line = re.sub(r'call ptr asm "movq %gs:0x30,\$0", "[^"]*"\(\)', 'call ptr @__inksoc_teb()', line)
    if ' asm ' in line and 'call' in line:
        sys.exit('unsupported inline asm: ' + line.strip()[:120])
    line = line.replace(' dllimport ', ' ').replace(' dllexport ', ' ')
    line = re.sub(r'"(target-cpu|target-features|tune-cpu|min-legal-vector-width|stack-protector-buffer-size)"="[^"]*"', '', line)
    line = re.sub(r'\bx86_64_sysvcc |\bwin64cc ', '', line)
    out.append(line)
text = '\n'.join(out)
if '@__inksoc_teb()' in text and 'declare ptr @__inksoc_teb()' not in text:
    text += '\ndeclare ptr @__inksoc_teb()\n'
open(sys.argv[2], 'w').write(text)
