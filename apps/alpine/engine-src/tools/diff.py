#!/usr/bin/env python3
"""Checks the engine's x86-64 interpreter against a reference CPU (Unicorn).

Build the engine with the "diff" feature, then:
  cargo build --release --target wasm32-unknown-unknown --features diff --target-dir target-diff
  python3 tools/diff.py target-diff/.../inksoc.wasm ../../wine.wasm EXE "ARGS" FILE...

Every instruction (outside the native area) is run a second time on Unicorn
from the same registers and memory, up to K times per address; differences
in registers, flags (the ones the instruction defines), XMM registers and
memory writes are printed, grouped by instruction.
pip install wasmtime unicorn capstone
"""
import sys, os, time, collections
import wasmtime
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_MEM_WRITE, UC_HOOK_MEM_UNMAPPED, UcError
from unicorn.x86_const import *
import capstone

K = int(os.environ.get('K', '3'))
LIMIT = float(os.environ.get('LIMIT', '120'))
wasm_path, wine_path, exe, args = sys.argv[1:5]
files = sys.argv[5:]

store = wasmtime.Store()
eng_mod = wasmtime.Module.from_file(store.engine, wasm_path)
X = {}            # engine exports
out = []
t0 = time.time()
GPR = [UC_X86_REG_RAX, UC_X86_REG_RCX, UC_X86_REG_RDX, UC_X86_REG_RBX, UC_X86_REG_RSP, UC_X86_REG_RBP, UC_X86_REG_RSI, UC_X86_REG_RDI,
       UC_X86_REG_R8, UC_X86_REG_R9, UC_X86_REG_R10, UC_X86_REG_R11, UC_X86_REG_R12, UC_X86_REG_R13, UC_X86_REG_R14, UC_X86_REG_R15]
XMM = [getattr(sys.modules['unicorn.x86_const'], 'UC_X86_REG_XMM%d' % i) for i in range(16)]
NAMES = 'rax rcx rdx rbx rsp rbp rsi rdi r8 r9 r10 r11 r12 r13 r14 r15'.split()
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
seen = collections.Counter()
bad = collections.defaultdict(list)
pre = None
checked = 0

def g(i): return X['diff_get'](store, i) & 0xFFFFFFFFFFFFFFFF
def rd(a, n):
    b = bytearray()
    for i in range(a & ~3, a + n, 4):
        v = X['diff_read'](store, i)
        b += (v if v >= 0 else 0).to_bytes(4, 'little')
    o = a & 3
    return bytes(b[o:o + n])
def page(a):
    a &= ~0xFFF
    if X['diff_read'](store, a) < 0: return None
    return rd(a, 4096)

# flags each instruction leaves defined (others are not compared); CF=1 PF=4 ZF=0x40 SF=0x80 OF=0x800
ALL = 0x8C5
DEFINED = {'mul': 0x801, 'imul': 0x801, 'div': 0, 'idiv': 0, 'bsf': 0x40, 'bsr': 0x40, 'bt': 1, 'bts': 1, 'btr': 1, 'btc': 1,
           'shl': 0xC5, 'sal': 0xC5, 'shr': 0xC5, 'sar': 0xC5, 'rol': 1, 'ror': 1, 'rcl': 1, 'rcr': 1, 'shld': 0xC5, 'shrd': 0xC5,
           'lzcnt': 0x41, 'tzcnt': 0x41, 'popcnt': ALL, 'aaa': 1, 'daa': 0xC5}

def mapper(uc, access, addr, size, value, data):
    try:
        p = page(addr)
        if p is None: return False
        uc.mem_map(addr & ~0xFFF, 0x1000)
        uc.mem_write(addr & ~0xFFF, p)
        return True
    except UcError:
        return False

def host_diff(phase):
    global pre, checked
    if phase == 0:
        rip = g(16)
        pre = None
        code = rd(rip, 15)
        ins = next(cs.disasm(code, rip), None)
        if ins is None or ins.mnemonic in ('syscall', 'cpuid', 'rdtsc', 'rdtscp', 'xgetbv', 'int3', 'int', 'ud2', 'hlt', 'rdrand', 'rdseed', 'pause', 'lfence', 'mfence', 'sfence', 'fxsave', 'fxrstor', 'xsave', 'xrstor', 'xsavec', 'stmxcsr', 'ldmxcsr', 'fnstcw', 'fldcw', 'fnstsw', 'fninit') or ins.mnemonic.startswith('rep'):
            return
        if ins.mnemonic.startswith('f'): return   # x87: engine keeps f64 (not 80-bit)
        seen[rip] += 1
        uc = Uc(UC_ARCH_X86, UC_MODE_64)
        uc.hook_add(UC_HOOK_MEM_UNMAPPED, mapper)
        writes = []
        uc.hook_add(UC_HOOK_MEM_WRITE, lambda uc, acc, a, size, v, d: writes.append((a, size)))
        for i, r in enumerate(GPR): uc.reg_write(r, g(i))
        f = g(17)
        uc.reg_write(UC_X86_REG_RFLAGS, 0x202 | f)
        uc.msr_write(0xC0000101, g(18))
        uc.msr_write(0xC0000100, g(19))
        for i in range(16): uc.reg_write(XMM[i], g(32 + 2 * i) | g(33 + 2 * i) << 64)
        uc.mem_map(rip & ~0xFFF, 0x1000); uc.mem_write(rip & ~0xFFF, page(rip))
        if (rip & 0xFFF) > 0xFF0:
            p2 = page(rip + 0x1000)
            if p2: uc.mem_map((rip + 0x1000) & ~0xFFF, 0x1000); uc.mem_write((rip + 0x1000) & ~0xFFF, p2)
        try:
            uc.emu_start(rip, 0xFFFFFFFFFFFFFFFF, count=1)
        except UcError as er:
            if 'FETCH' not in str(er): bad[ins.mnemonic].append('%x %s %s: unicorn %s' % (rip, ins.mnemonic, ins.op_str, er))
            return
        # the reference's written bytes, read now (before the engine runs)
        wv = [(a, n, bytes(uc.mem_read(a, n))) for (a, n) in writes]
        pre = (rip, ins, uc, wv, [g(i) for i in range(16)])
        return
    if pre is None: return
    rip, ins, uc, writes, before = pre
    pre = None
    checked += 1
    diffs = []
    for i, r in enumerate(GPR):
        a, b = g(i), uc.reg_read(r)
        if a != b: diffs.append('%s eng=%x ref=%x' % (NAMES[i], a, b))
    if g(16) != uc.reg_read(UC_X86_REG_RIP): diffs.append('rip eng=%x ref=%x' % (g(16), uc.reg_read(UC_X86_REG_RIP)))
    mask = DEFINED.get(ins.mnemonic, ALL)
    if ins.mnemonic.startswith(('mov', 'lea', 'push', 'pop', 'j', 'call', 'ret', 'cmov', 'set', 'nop', 'xchg', 'bswap', 'cdq', 'cqo', 'cwd', 'cdqe', 'cwde', 'not', 'lods', 'stos', 'p', 'v')) and not ins.mnemonic.startswith(('ptest', 'popcnt')):
        mask = 0
    ef = uc.reg_read(UC_X86_REG_RFLAGS) & mask
    if (g(17) & mask) != ef: diffs.append('flags eng=%x ref=%x (mask %x)' % (g(17) & mask, ef, mask))
    for i in range(16):
        a = g(32 + 2 * i) | g(33 + 2 * i) << 64
        b = uc.reg_read(XMM[i])
        if a != b: diffs.append('xmm%d eng=%032x ref=%032x' % (i, a, b))
    for (a, n, r_) in writes:
        e_ = rd(a, n)
        if e_ != r_: diffs.append('mem %x eng=%s ref=%s' % (a, e_.hex(), r_.hex()))
    if diffs:
        bad[ins.mnemonic].append('%x %s %s | in: %s | %s' % (rip, ins.mnemonic, ins.op_str, ' '.join('%s=%x' % (NAMES[i], before[i]) for i in range(16) if NAMES[i] in ins.op_str or i < 4), '; '.join(diffs)))

def imp(name, ft, fn):
    return wasmtime.Func(store, ft, fn)

types = {i.name: i.type for i in eng_mod.imports}
mem = None
def mem_bytes(p, n): return bytes(mem.read(store, p, p + n))
swap = {}
wine = {}
def host_console(p, n): out.append(mem_bytes(p, n).decode('utf8', 'replace'))
funcs = {
    'host_console': host_console,
    'host_swap_read': lambda s, p: mem.write(store, swap[s], p),
    'host_swap_write': lambda s, p: swap.__setitem__(s, mem_bytes(p, 4096)),
    'host_epoch_ms': lambda: time.time() * 1000,
    'host_now_ms': lambda: (time.time() - t0) * 1000,
    'wine_call': lambda i, a, b, c, d: wine['ink_call'](store, i, a, b, c, d),
    'host_jit': lambda p, n: -1,
    'host_diff': host_diff,
}
inst = wasmtime.Instance(store, eng_mod, [imp(i.name, i.type, funcs[i.name]) for i in eng_mod.imports])
for k, v in inst.exports(store).items(): X[k] = v
mem = X['memory']
X['init'](store, 256, 8192)
X['set_jit'](store, 0)
X['diff_k'](store, K)
wine_mod = wasmtime.Module.from_file(store.engine, wine_path)
wmap = {'memory': mem, 'load_ptr': X['wine_load_ptr'], 'store_ptr': X['wine_store_ptr'], 'malloc': X['wine_malloc'], 'free': X['wine_free'],
        'sse2_memmove': X['wine_memmove'], '__inksoc_teb': X['wine_teb'], 'ink_output': X['wine_output']}
winst = wasmtime.Instance(store, wine_mod, [wmap[i.name] for i in wine_mod.imports])
for k, v in winst.exports(store).items(): wine[k] = v
def put(b):
    p = X['buffer'](store, len(b)); mem.write(store, b, p)
for f in files:
    nm = os.path.basename(f).encode(); d = open(f, 'rb').read()
    put(nm + b'\0' + d); X['add_file'](store)
put((exe + '\0' + exe + (' ' + args if args else '')).encode())
st = 2 if X['start'](store) != 0 else 0
while st in (0, 3) and time.time() - t0 < LIMIT:
    st = X['run'](store, 2000000)
print(''.join(out)[-1500:])
print('error', mem_bytes(X['msg_ptr'](store), X['msg_len'](store)).decode('utf8','replace')[:600] if st == 2 else '')
print('status', st, 'checked', checked, 'addresses', len(seen))
for m, l in sorted(bad.items(), key=lambda x: -len(x[1])):
    print('== %s (%d)' % (m, len(l)))
    for s in l[:4]: print('  ', s[:400])
