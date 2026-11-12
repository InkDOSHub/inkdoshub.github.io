// JIT: translates hot x86-64 blocks into small WebAssembly modules.
//
// - A block starts where the dispatcher saw a hot address and runs straight
//   on: conditional jumps leave it (side exits), a jump back to its start
//   becomes a real wasm loop, and calls, returns and other jumps end it.
// - Registers are kept in wasm locals while the block runs and written back
//   at every exit. Flags are lazy: compares and arithmetic keep their inputs
//   and result, and a jcc right after a cmp becomes one wasm compare.
// - Memory goes through the same software TLB as the interpreter; the fast
//   path is inline, misses and page-crossing accesses call back into Rust.
// - Anything the translator does not know runs through the interpreter for
//   that one instruction (registers are flushed first), so every program
//   still works while the translator grows.

use crate::cpu::{mask, modrm, Dec, ModRm};
use crate::Engine;
use std::collections::HashMap;

#[link(wasm_import_module = "env")]
extern "C" {
    /// Compiles a module (exports "f"), puts f in the function table, returns its index or -1.
    fn host_jit(ptr: *const u8, len: u32) -> i32;
}

const HOT: u32 = 40; // visits before a block is compiled
const MAX_INS: usize = 80;
const NONE: u32 = u32::MAX;

// lazy flag kinds (see Engine::materialize)
const LZ_ADD: u32 = 1;
const LZ_SUB: u32 = 2;
const LZ_LOGIC: u32 = 3;
const LZ_INC: u32 = 4;
const LZ_DEC: u32 = 5;
const LZ_SHL: u32 = 6;
const LZ_SHR: u32 = 7;
const LZ_SAR: u32 = 8;
const LZ_ADC: u32 = 9;
const LZ_SBB: u32 = 10;

pub struct Jit {
    pub on: bool,
    map: HashMap<u64, u32>,
    hits: HashMap<u64, u32>,
    l1: Vec<(u64, u32)>,
    pub blocks: u64,
    pub failed: u64,
    pub bytes: u64,
    pub ms: f64,
}

impl Default for Jit {
    fn default() -> Jit {
        Jit { on: true, map: HashMap::new(), hits: HashMap::new(), l1: vec![(u64::MAX, NONE); 4096], blocks: 0, failed: 0, bytes: 0, ms: 0.0 }
    }
}

impl Jit {
    /// Compiled function for `rip`, compiling it once it is hot.
    #[inline(always)]
    pub fn lookup(e: &mut Engine, rip: u64) -> Option<u32> {
        let k = ((rip ^ (rip >> 12)) & 4095) as usize;
        let (t, f) = e.jit.l1[k];
        if t == rip { return if f == NONE { None } else { Some(f) }; }
        Self::lookup_slow(e, rip, k)
    }
    #[cold]
    fn lookup_slow(e: &mut Engine, rip: u64, k: usize) -> Option<u32> {
        if let Some(&f) = e.jit.map.get(&rip) {
            e.jit.l1[k] = (rip, f);
            return if f == NONE { None } else { Some(f) };
        }
        let h = e.jit.hits.entry(rip).or_insert(0);
        *h += 1;
        if *h < HOT { return None; }
        e.jit.hits.remove(&rip);
        let t0 = unsafe { crate::host_now_ms() };
        let f = match compile(e, rip) {
            Some(code) => {
                e.jit.bytes += code.len() as u64;
                let i = unsafe { host_jit(code.as_ptr(), code.len() as u32) };
                if i < 0 { e.jit.failed += 1; NONE } else { e.jit.blocks += 1; i as u32 }
            }
            None => NONE,
        };
        e.jit.ms += unsafe { crate::host_now_ms() } - t0;
        e.jit.map.insert(rip, f);
        e.jit.l1[k] = (rip, f);
        if f == NONE { None } else { Some(f) }
    }

    /// Forgets every block (code was overwritten).
    pub fn flush(&mut self) {
        self.map.clear();
        self.hits.clear();
        for x in self.l1.iter_mut() { *x = (u64::MAX, NONE); }
    }
}

#[inline(always)]
pub fn call(f: u32) {
    let func: extern "C" fn() = unsafe { core::mem::transmute(f as usize) };
    func();
}

// ---- callbacks from JIT code (imported by every block module) ----

#[no_mangle]
pub extern "C" fn jit_rd(a: u64, size: u32) -> u64 {
    let e = crate::eng();
    match e.mmu.read_sized(a, size) {
        Ok(v) => v,
        Err(_) => { e.fault(a); e.cpu.jit_limit = 0; 0 }
    }
}

#[no_mangle]
pub extern "C" fn jit_wr(a: u64, v: u64, size: u32) {
    let e = crate::eng();
    if e.mmu.write_sized(a, size, v).is_err() { e.fault(a); e.cpu.jit_limit = 0; }
}

/// Runs one instruction in the interpreter; 1 = the block must stop.
#[no_mangle]
pub extern "C" fn jit_step(next: u64) -> u32 {
    let e = crate::eng();
    e.materialize();
    crate::cpu::step_one(e);
    if e.error.is_some() { e.cpu.jit_limit = 0; }
    (e.error.is_some() || e.exited || e.cpu.rip != next) as u32
}

#[no_mangle]
pub extern "C" fn jit_cond(cc: u32) -> u32 {
    let e = crate::eng();
    e.materialize();
    e.cond(cc as u8) as u32
}

// ---- decoding ----

#[derive(Clone, Copy)]
struct Ins {
    rip: u64,
    next: u64,
    op: u32, // 0xXX, 0x0FXX, 0x0F38XX, 0x0F3AXX
    rex: u8,
    osz: u32,
    rep: u8,
    seg: bool,
    a67: bool,
    m: Option<ModRm>,
    imm: u64,
}

fn has_modrm1(op: u8) -> bool {
    match op {
        0x00..=0x3F => op & 7 < 4 && !matches!(op, 0x26 | 0x2E | 0x36 | 0x3E),
        0x62 | 0x63 | 0x69 | 0x6B | 0x80..=0x8F | 0xC0 | 0xC1 | 0xC4..=0xC7 | 0xD0..=0xD3 | 0xD8..=0xDF | 0xF6 | 0xF7 | 0xFE | 0xFF => true,
        _ => false,
    }
}

fn has_modrm2(op: u8) -> bool {
    !matches!(op, 0x05..=0x09 | 0x0B | 0x0E | 0x30..=0x37 | 0x77 | 0x80..=0x8F | 0xA0..=0xA2 | 0xA8..=0xAA | 0xC8..=0xCF)
}

fn decode(e: &mut Engine, rip: u64) -> Option<Ins> {
    let mut b = [0u8; 16];
    e.mmu.fetch16(rip, &mut b).ok()?;
    let mut d = Dec { b: &b, p: 0 };
    let (mut p66, mut rep, mut seg, mut a67) = (false, 0u8, false, false);
    let mut op;
    loop {
        op = d.u8();
        match op {
            0x66 => p66 = true,
            0xF2 | 0xF3 => rep = op,
            0x64 | 0x65 => seg = true,
            0x67 => a67 = true,
            0x2E | 0x3E | 0x26 | 0x36 | 0xF0 => {}
            _ => break,
        }
        if d.p > 14 { return None; }
    }
    let mut rex = 0;
    if (0x40..0x50).contains(&op) { rex = op; op = d.u8(); }
    let w = rex & 8 != 0;
    let osz: u32 = if w { 64 } else if p66 { 16 } else { 32 };
    let immz = if osz == 16 { 2 } else { 4 };
    let mut ins = Ins { rip, next: 0, op: op as u32, rex, osz, rep, seg, a67, m: None, imm: 0 };
    let mut imm_n = 0; // bytes of immediate
    if op == 0x0F {
        let op2 = d.u8();
        if op2 == 0x38 || op2 == 0x3A {
            let op3 = d.u8();
            ins.op = (0x0F0000 | (op2 as u32) << 8) | op3 as u32;
            ins.m = Some(modrm(&mut d, e, rex));
            if op2 == 0x3A { imm_n = 1; }
        } else {
            ins.op = 0x0F00 | op2 as u32;
            if has_modrm2(op2) { ins.m = Some(modrm(&mut d, e, rex)); }
            match op2 {
                0x70..=0x73 | 0xA4 | 0xAC | 0xBA | 0xC2 | 0xC4..=0xC6 => imm_n = 1,
                0x80..=0x8F => imm_n = 4,
                _ => {}
            }
        }
    } else {
        if has_modrm1(op) { ins.m = Some(modrm(&mut d, e, rex)); }
        imm_n = match op {
            0x00..=0x3F if op & 7 == 4 => 1,
            0x00..=0x3F if op & 7 == 5 => immz,
            0x68 | 0x69 | 0x81 | 0xA9 | 0xC7 => immz,
            0x6A | 0x6B | 0x70..=0x7F | 0x80 | 0x83 | 0xA8 | 0xB0..=0xB7 | 0xC0 | 0xC1 | 0xC6 | 0xCD | 0xE0..=0xE7 | 0xEB => 1,
            0xB8..=0xBF => if w { 8 } else { immz },
            0xA0..=0xA3 => if a67 { 4 } else { 8 },
            0xC2 | 0xCA => 2,
            0xC8 => 3,
            0xE8 | 0xE9 => 4,
            0xF6 => if ins.m.map_or(false, |m| m.reg & 7 < 2) { 1 } else { 0 },
            0xF7 => if ins.m.map_or(false, |m| m.reg & 7 < 2) { immz } else { 0 },
            _ => 0,
        };
    }
    ins.imm = match imm_n {
        0 => 0,
        1 => d.i8() as u64,
        2 => { let lo = d.u8() as u64; let hi = d.u8() as u64; ((lo | hi << 8) as u16 as i16) as i64 as u64 }
        3 => { let lo = d.u8() as u64; let hi = d.u8() as u64; let z = d.u8() as u64; lo | hi << 8 | z << 16 }
        4 => d.i32() as u64,
        _ => d.u64_full(),
    };
    if d.p > 15 { return None; }
    ins.next = rip + d.p as u64;
    Some(ins)
}

/// Instruction that changes rip (other than falling through).
fn is_branch(i: &Ins) -> bool {
    match i.op {
        0x70..=0x7F | 0xE0..=0xE3 | 0xE8 | 0xE9 | 0xEB | 0xC2 | 0xC3 | 0xCA | 0xCB | 0xCC | 0xCD | 0xCF | 0xF1 | 0xF4 | 0x9A | 0xEA => true,
        0xFF => matches!(i.m.unwrap().reg & 7, 2..=5),
        0x0F80..=0x0F8F | 0x0F05 | 0x0F0B | 0x0F34 | 0x0F07 => true,
        _ => false,
    }
}

/// (reads flags, writes all of them) for liveness.
fn flag_use(i: &Ins) -> (bool, bool) {
    let sub = i.m.map_or(0, |m| m.reg & 7);
    match i.op {
        0x00..=0x3F if i.op & 7 < 6 => { let a = i.op >> 3; (a == 2 || a == 3, true) }
        0x80 | 0x81 | 0x83 => (sub == 2 || sub == 3, true),
        0x84 | 0x85 | 0xA8 | 0xA9 => (false, true),
        0xF6 | 0xF7 => (false, sub != 2),
        0xFE | 0xFF if sub < 2 => (true, true),
        0xC0 | 0xC1 | 0xD0 | 0xD1 => (sub < 4 || i.imm & 31 == 0 && i.op < 0xD0, true),
        0x0FAF | 0x69 | 0x6B => (false, true),
        0x50..=0x5F | 0x63 | 0x68 | 0x6A | 0x88..=0x8B | 0x8D | 0x90 | 0x98 | 0x99 | 0xB0..=0xBF | 0xC6 | 0xC7
        | 0xE8 | 0xE9 | 0xEB | 0xC2 | 0xC3 | 0x0F1F | 0x0FB6 | 0x0FB7 | 0x0FBE | 0x0FBF | 0x0FC8..=0x0FCF => (false, false),
        0xFF => (false, false),
        _ => (true, false), // unknown: assume it reads and keeps them
    }
}

// ---- wasm encoding ----

fn leb_u(v: &mut Vec<u8>, mut x: u64) {
    loop {
        let b = (x & 0x7F) as u8;
        x >>= 7;
        if x == 0 { v.push(b); return; }
        v.push(b | 0x80);
    }
}
fn leb_s(v: &mut Vec<u8>, mut x: i64) {
    loop {
        let b = (x & 0x7F) as u8;
        x >>= 7;
        if (x == 0 && b & 0x40 == 0) || (x == -1 && b & 0x40 != 0) { v.push(b); return; }
        v.push(b | 0x80);
    }
}

// opcodes
const IF: u8 = 0x04; const ELSE: u8 = 0x05; const END: u8 = 0x0B; const BR: u8 = 0x0C; const RET: u8 = 0x0F;
const CALL: u8 = 0x10; const SELECT: u8 = 0x1B;
const LGET: u8 = 0x20; const LSET: u8 = 0x21; const LTEE: u8 = 0x22;
const I32LOAD: u8 = 0x28; const I64LOAD: u8 = 0x29; const I32LOAD8U: u8 = 0x2D;
const I32STORE: u8 = 0x36; const I64STORE: u8 = 0x37;
const I32C: u8 = 0x41; const I64C: u8 = 0x42;
const I32EQZ: u8 = 0x45; const I32NE: u8 = 0x47; const I32LEU: u8 = 0x4D;
const I64EQZ: u8 = 0x50; const I64EQ: u8 = 0x51; const I64LTS: u8 = 0x53; const I64LTU: u8 = 0x54; const I64LES: u8 = 0x57; const I64LEU: u8 = 0x58; const I64GEU: u8 = 0x5A;
const I32POPCNT: u8 = 0x69; const I32ADD: u8 = 0x6A; const I32AND: u8 = 0x71; const I32OR: u8 = 0x72; const I32XOR: u8 = 0x73; const I32SHL: u8 = 0x74;
const I64ADD: u8 = 0x7C; const I64SUB: u8 = 0x7D; const I64MUL: u8 = 0x7E; const I64AND: u8 = 0x83; const I64OR: u8 = 0x84; const I64XOR: u8 = 0x85;
const I64SHL: u8 = 0x86; const I64SHRS: u8 = 0x87; const I64SHRU: u8 = 0x88; const I64ROTL: u8 = 0x89; const I64ROTR: u8 = 0x8A;
const I32ROTL: u8 = 0x77; const I32ROTR: u8 = 0x78;
const I32WRAP: u8 = 0xA7; const I64EXTU: u8 = 0xAD; const I64EXT8S: u8 = 0xC2; const I64EXT16S: u8 = 0xC3; const I64EXT32S: u8 = 0xC4;
const VOID: u8 = 0x40; const T_I64: u8 = 0x7E;

// imported functions
const F_RD: u32 = 0; const F_WR: u32 = 1; const F_STEP: u32 = 2; const F_COND: u32 = 3;

// locals: i32 first, then i64
const L_E: u32 = 0; // TLB entry address
const L_C: u32 = 1; // i32 scratch (conditions)
const N_I32: u32 = 2;
const R0: u32 = N_I32; // 16 guest registers
const L_A: u32 = R0 + 16; // address of the memory operand
const L_A2: u32 = R0 + 17; // second address (stack)
const L_V: u32 = R0 + 18; // page number scratch
const L_T: u32 = R0 + 19; // value scratch
const FIRST_TMP: u32 = R0 + 20;
const MAX_LOCALS: u32 = 900;

#[derive(Clone, Copy, PartialEq)]
enum Prod {
    Unknown,
    Known { op: u32, size: u32, a: u32, b: u32, r: u32, cf: u32 },
}

#[derive(Clone, Copy)]
enum Opd { Reg(u8, bool), Mem(u32), Imm(u64) }

struct G {
    c: Vec<u8>,
    ntmp: u32,
    valid: u16,
    dirty: u16,
    prod: Prod,
    cpu: u32,
    tlb: u32,
    pool: u32,
    head: u64,
}

macro_rules! off { ($f:ident) => { core::mem::offset_of!(crate::cpu::Cpu, $f) as u32 } }

impl G {
    fn b(&mut self, x: u8) { self.c.push(x); }
    fn bs(&mut self, xs: &[u8]) { self.c.extend_from_slice(xs); }
    fn u(&mut self, x: u64) { leb_u(&mut self.c, x); }
    fn i32c(&mut self, v: i32) { self.b(I32C); leb_s(&mut self.c, v as i64); }
    fn i64c(&mut self, v: u64) { self.b(I64C); leb_s(&mut self.c, v as i64); }
    fn get(&mut self, l: u32) { self.b(LGET); self.u(l as u64); }
    fn set(&mut self, l: u32) { self.b(LSET); self.u(l as u64); }
    fn tee(&mut self, l: u32) { self.b(LTEE); self.u(l as u64); }
    fn mem(&mut self, op: u8, align: u32, offset: u32) { self.b(op); self.u(align as u64); self.u(offset as u64); }
    fn tmp(&mut self) -> u32 { let t = self.ntmp; self.ntmp += 1; t }
    fn call(&mut self, f: u32) { self.b(CALL); self.u(f as u64); }

    // cpu struct fields (absolute addresses as load/store offsets from 0)
    fn cpu_ld64(&mut self, off: u32) { self.i32c(0); self.mem(I64LOAD, 3, self.cpu + off); }
    /// value must be pushed after the base: call st_base first.
    fn st_base(&mut self) { self.i32c(0); }

    fn reg_addr(&self, r: u8) -> u32 { self.cpu + off!(regs) + 8 * r as u32 }

    fn ensure(&mut self, r: u8) {
        if self.valid & (1 << r) == 0 {
            self.i32c(0);
            let a = self.reg_addr(r);
            self.mem(I64LOAD, 3, a);
            self.set(R0 + r as u32);
            self.valid |= 1 << r;
        }
    }

    fn mask(&mut self, size: u32) {
        if size < 64 { self.i64c(mask(size)); self.b(I64AND); }
    }

    /// Pushes register r (size bits, zero-extended).
    fn rd_reg(&mut self, r: u8, hi: bool, size: u32) {
        self.ensure(r);
        self.get(R0 + r as u32);
        if hi { self.i64c(8); self.b(I64SHRU); self.i64c(0xFF); self.b(I64AND); } else { self.mask(size); }
    }

    /// Register r (size bits) = local v.
    fn wr_reg(&mut self, r: u8, hi: bool, size: u32, v: u32) {
        let rl = R0 + r as u32;
        match (size, hi) {
            (64, _) => { self.get(v); self.set(rl); self.valid |= 1 << r; }
            (32, _) => { self.get(v); self.i64c(0xFFFF_FFFF); self.b(I64AND); self.set(rl); self.valid |= 1 << r; }
            _ => {
                self.ensure(r);
                let (m, sh) = if hi { (0xFFu64 << 8, 8) } else { (mask(size), 0) };
                self.get(rl); self.i64c(!m); self.b(I64AND);
                self.get(v);
                if sh != 0 { self.i64c(0xFF); self.b(I64AND); self.i64c(sh); self.b(I64SHL); } else { self.mask(size); }
                self.b(I64OR); self.set(rl);
            }
        }
        self.dirty |= 1 << r;
    }

    /// TLB check for the access of n bytes at local `a`; leaves i32 "fast path ok".
    fn tlb_check(&mut self, a: u32, n: u32, write: bool) {
        self.get(a); self.i64c(12); self.b(I64SHRU); self.tee(L_V);
        self.b(I32WRAP); self.i32c(crate::mmu::Mmu::TLB_MASK as i32); self.b(I32AND); self.i32c(4); self.b(I32SHL); self.tee(L_E);
        self.mem(I64LOAD, 3, self.tlb);
        self.get(L_V); self.b(I64EQ);
        if n > 1 {
            self.get(a); self.b(I32WRAP); self.i32c(0xFFF); self.b(I32AND); self.i32c(4096 - n as i32); self.b(I32LEU);
            self.b(I32AND);
        }
        if write { self.get(L_E); self.mem(I32LOAD8U, 0, self.tlb + 12); self.b(I32AND); }
    }
    /// Host address of local `a` (after tlb_check).
    fn host(&mut self, a: u32) {
        self.get(L_E); self.mem(I32LOAD, 2, self.tlb + 8);
        self.get(a); self.b(I32WRAP); self.i32c(0xFFF); self.b(I32AND); self.b(I32ADD);
    }

    /// Pushes the size-bit value at address local `a`.
    fn load(&mut self, a: u32, size: u32) {
        self.tlb_check(a, size / 8, false);
        self.b(IF); self.b(T_I64);
        self.host(a);
        let (op, al) = match size { 8 => (0x31, 0), 16 => (0x33, 1), 32 => (0x35, 2), _ => (I64LOAD, 3) };
        self.mem(op, al, self.pool);
        self.b(ELSE);
        self.get(a); self.i32c(size as i32); self.call(F_RD);
        self.b(END);
    }

    /// Stores local v (size bits) at address local `a`.
    fn store(&mut self, a: u32, v: u32, size: u32) {
        self.tlb_check(a, size / 8, true);
        self.b(IF); self.b(VOID);
        self.host(a);
        self.get(v);
        let (op, al) = match size { 8 => (0x3C, 0), 16 => (0x3D, 1), 32 => (0x3E, 2), _ => (I64STORE, 3) };
        self.mem(op, al, self.pool);
        self.b(ELSE);
        self.get(a); self.get(v); self.i32c(size as i32); self.call(F_WR);
        self.b(END);
    }

    /// Pushes the effective address of a memory operand (no segment prefix).
    fn ea(&mut self, m: &ModRm, next: u64) {
        if m.riprel { self.i64c(next.wrapping_add(m.disp as u64)); return; }
        let mut any = false;
        if let Some(b) = m.base { self.ensure(b); self.get(R0 + b as u32); any = true; }
        if let Some(i) = m.index {
            self.ensure(i);
            self.get(R0 + i as u32);
            if m.scale > 0 { self.i64c(m.scale as u64); self.b(I64SHL); }
            if any { self.b(I64ADD); }
            any = true;
        }
        if !any { self.i64c(m.disp as u64); }
        else if m.disp != 0 { self.i64c(m.disp as u64); self.b(I64ADD); }
    }

    fn opd_get(&mut self, o: Opd, size: u32) {
        match o {
            Opd::Reg(r, hi) => self.rd_reg(r, hi, size),
            Opd::Mem(a) => self.load(a, size),
            Opd::Imm(v) => self.i64c(v & mask(size)),
        }
    }
    fn opd_put(&mut self, o: Opd, size: u32, v: u32) {
        match o {
            Opd::Reg(r, hi) => self.wr_reg(r, hi, size, v),
            Opd::Mem(a) => self.store(a, v, size),
            Opd::Imm(_) => {}
        }
    }
    /// Value of operand into a new local.
    fn val(&mut self, o: Opd, size: u32) -> u32 { let t = self.tmp(); self.opd_get(o, size); self.set(t); t }

    // ---- flags ----

    /// Pushes one flag (i32 0/1) from a known producer, or None if not expressible.
    fn flag(&mut self, f: u8) -> bool {
        let Prod::Known { op, size, a, b, r, cf } = self.prod else { return false };
        let top = (size - 1) as u64;
        match f {
            b'Z' => { self.get(r); self.b(I64EQZ); }
            b'S' => { self.get(r); self.i64c(top); self.b(I64SHRU); self.b(I32WRAP); self.i32c(1); self.b(I32AND); }
            b'P' => { self.get(r); self.b(I32WRAP); self.i32c(0xFF); self.b(I32AND); self.b(I32POPCNT); self.i32c(1); self.b(I32AND); self.b(I32EQZ); }
            b'C' => match op {
                LZ_ADD => { self.get(r); self.get(a); self.b(I64LTU); }
                LZ_SUB => { self.get(a); self.get(b); self.b(I64LTU); }
                LZ_LOGIC => self.i32c(0),
                LZ_INC | LZ_DEC => { if cf == NONE { self.i32c(0) } else { self.get(cf); self.b(I32WRAP); } }
                LZ_ADC => { self.get(r); self.get(a); self.b(I64LTU); self.get(cf); self.b(I32WRAP); self.get(r); self.get(a); self.b(I64EQ); self.b(I32AND); self.b(I32OR); }
                LZ_SBB => { self.get(a); self.get(b); self.b(I64LTU); self.get(cf); self.b(I32WRAP); self.get(a); self.get(b); self.b(I64EQ); self.b(I32AND); self.b(I32OR); }
                _ => return false,
            },
            _ => match op { // O
                LZ_ADD | LZ_ADC => { self.get(a); self.get(r); self.b(I64XOR); self.get(b); self.get(r); self.b(I64XOR); self.b(I64AND); self.i64c(top); self.b(I64SHRU); self.b(I32WRAP); self.i32c(1); self.b(I32AND); }
                LZ_SUB | LZ_SBB => { self.get(a); self.get(b); self.b(I64XOR); self.get(a); self.get(r); self.b(I64XOR); self.b(I64AND); self.i64c(top); self.b(I64SHRU); self.b(I32WRAP); self.i32c(1); self.b(I32AND); }
                LZ_LOGIC => self.i32c(0),
                LZ_INC => { self.get(r); self.i64c(1 << top); self.b(I64EQ); }
                LZ_DEC => { self.get(a); self.i64c(1 << top); self.b(I64EQ); }
                _ => return false,
            },
        }
        true
    }

    /// Writes a known producer to the cpu struct (lazy flags) and forgets it.
    fn spill_flags(&mut self) {
        if let Prod::Known { op, size, a, b, r, cf } = self.prod {
            self.store_lazy(op, size, a, b, r, cf);
            self.prod = Prod::Unknown;
        }
    }
    fn store_lazy(&mut self, op: u32, size: u32, a: u32, b: u32, r: u32, cf: u32) {
        let c = self.cpu;
        self.st_base(); self.i32c(op as i32); self.mem(I32STORE, 2, c + off!(lz_op));
        self.st_base(); self.i32c(size as i32); self.mem(I32STORE, 2, c + off!(lz_size));
        self.st_base(); self.get(a); self.mem(I64STORE, 3, c + off!(lz_a));
        self.st_base(); self.get(b); self.mem(I64STORE, 3, c + off!(lz_b));
        self.st_base(); self.get(r); self.mem(I64STORE, 3, c + off!(lz_r));
        if matches!(op, LZ_INC | LZ_DEC | LZ_ADC | LZ_SBB) {
            self.st_base();
            if cf == NONE { self.i32c(0); } else { self.get(cf); self.b(I32WRAP); }
            self.mem(I32STORE, 2, c + off!(lz_cf));
        }
    }
    /// Lazy-flag stores for an exit, without changing the compile state.
    fn exit_flags(&mut self) {
        if let Prod::Known { op, size, a, b, r, cf } = self.prod { self.store_lazy(op, size, a, b, r, cf); }
    }

    /// Pushes condition cc (i32 0/1).
    fn cond(&mut self, cc: u8) {
        if let Prod::Known { op: LZ_SUB, size, a, b, .. } = self.prod {
            let base = cc >> 1;
            let (cmp, signed) = match base { 1 => (I64LTU, false), 3 => (I64LEU, false), 6 => (I64LTS, true), 7 => (I64LES, true), _ => (0, false) };
            if cmp != 0 {
                let sh = 64 - size as u64;
                self.get(a); if signed && sh > 0 { self.i64c(sh); self.b(I64SHL); }
                self.get(b); if signed && sh > 0 { self.i64c(sh); self.b(I64SHL); }
                self.b(cmp);
                if cc & 1 == 1 { self.b(I32EQZ); }
                return;
            }
        }
        let save = self.c.len();
        let ok = match cc >> 1 {
            0 => self.flag(b'O'),
            1 => self.flag(b'C'),
            2 => self.flag(b'Z'),
            3 => self.flag(b'C') && { self.flag(b'Z') && { self.b(I32OR); true } },
            4 => self.flag(b'S'),
            5 => self.flag(b'P'),
            6 => self.flag(b'S') && { self.flag(b'O') && { self.b(I32XOR); true } },
            _ => self.flag(b'Z') && { self.flag(b'S') && { self.flag(b'O') && { self.b(I32XOR); self.b(I32OR); true } } },
        };
        if ok {
            if cc & 1 == 1 { self.b(I32EQZ); }
            return;
        }
        self.c.truncate(save);
        self.spill_flags();
        self.i32c(cc as i32);
        self.call(F_COND);
    }

    fn set_prod(&mut self, op: u32, size: u32, a: u32, b: u32, r: u32) {
        self.prod = Prod::Known { op, size, a, b, r, cf: NONE };
    }

    // ---- exits ----

    fn flush(&mut self) {
        for r in 0..16u8 {
            if self.dirty & (1 << r) != 0 {
                self.st_base(); self.get(R0 + r as u32);
                let a = self.reg_addr(r);
                self.mem(I64STORE, 3, a);
            }
        }
    }
    fn add_icount(&mut self, n: u32) {
        let a = self.cpu + off!(icount);
        self.st_base(); self.cpu_ld64(off!(icount)); self.i64c(n as u64); self.b(I64ADD); self.mem(I64STORE, 3, a);
    }
    fn set_rip_const(&mut self, rip: u64) {
        let a = self.cpu + off!(rip);
        self.st_base(); self.i64c(rip); self.mem(I64STORE, 3, a);
    }
    /// Leaves the block for `rip` (constant) after n instructions.
    fn exit(&mut self, rip: u64, n: u32) {
        self.flush();
        self.exit_flags();
        self.set_rip_const(rip);
        self.add_icount(n);
        self.b(RET);
    }
    /// Leaves the block for the address in local t.
    fn exit_dyn(&mut self, t: u32, n: u32) {
        self.flush();
        self.exit_flags();
        let a = self.cpu + off!(rip);
        self.st_base(); self.get(t); self.mem(I64STORE, 3, a);
        self.add_icount(n);
        self.b(RET);
    }
    /// Jumps back to the block start (`depth` = blocks open inside the loop).
    fn backedge(&mut self, n: u32, depth: u32) {
        self.flush();
        self.exit_flags();
        self.add_icount(n);
        self.cpu_ld64(off!(icount)); self.cpu_ld64(off!(jit_limit)); self.b(I64GEU);
        self.b(IF); self.b(VOID);
        let h = self.head;
        self.set_rip_const(h);
        self.b(RET);
        self.b(END);
        self.b(BR); self.u(depth as u64);
    }
    /// Jump to a constant target: a loop when it is the block start.
    fn jump(&mut self, target: u64, n: u32, depth: u32) {
        if target == self.head { self.backedge(n, depth); } else { self.exit(target, n); }
    }

    /// Runs one instruction in the interpreter.
    fn fallback(&mut self, i: &Ins, n: u32) {
        self.flush();
        self.spill_flags();
        self.set_rip_const(i.rip);
        self.i64c(i.next); self.call(F_STEP);
        self.b(IF); self.b(VOID);
        self.add_icount(n);
        self.b(RET);
        self.b(END);
        self.valid = 0;
        self.dirty = 0;
    }

    fn push(&mut self, v: u32) {
        self.ensure(4);
        self.get(R0 + 4); self.i64c(8); self.b(I64SUB); self.set(L_A2);
        self.store(L_A2, v, 64);
        self.get(L_A2); self.set(R0 + 4);
        self.dirty |= 1 << 4;
    }
}

fn reg_opd(r: u8, size: u32, rex: u8) -> Opd {
    if size == 8 && rex == 0 && (4..8).contains(&r) { Opd::Reg(r - 4, true) } else { Opd::Reg(r, false) }
}

/// Emits an instruction natively; false = not supported (nothing usable emitted).
fn native(g: &mut G, i: &Ins, live: bool) -> bool {
    if i.a67 && !(i.op == 0x8D && !i.m.unwrap().riprel) { return false; }
    let rex = i.rex;
    let osz = i.osz;
    let m = i.m;
    let has_mem = m.map_or(false, |m| m.md != 3);
    if i.seg && has_mem { return false; }
    if i.rep != 0 && !(i.op == 0x90) { return false; }
    // memory operand address into L_A
    let rm = |g: &mut G, size: u32| -> Opd {
        let m = m.unwrap();
        if m.md == 3 { reg_opd(m.rm, size, rex) } else { g.ea(&m, i.next); g.set(L_A); Opd::Mem(L_A) }
    };
    let alu = |g: &mut G, aop: u32, dst: Opd, src: Opd, size: u32, write: bool| {
        let cf = if aop == 2 || aop == 3 {
            let t = g.tmp();
            if !g.flag(b'C') { g.spill_flags(); g.i32c(2); g.call(F_COND); }
            g.b(I64EXTU); g.set(t);
            t
        } else { NONE };
        let a = g.val(dst, size);
        let b = g.val(src, size);
        let r = g.tmp();
        g.get(a); g.get(b);
        let kind = match aop {
            2 => { g.b(I64ADD); g.get(cf); g.b(I64ADD); g.mask(size); LZ_ADC }
            3 => { g.b(I64SUB); g.get(cf); g.b(I64SUB); g.mask(size); LZ_SBB }
            0 => { g.b(I64ADD); g.mask(size); LZ_ADD }
            1 => { g.b(I64OR); LZ_LOGIC }
            4 => { g.b(I64AND); LZ_LOGIC }
            6 => { g.b(I64XOR); LZ_LOGIC }
            _ => { g.b(I64SUB); g.mask(size); LZ_SUB }
        };
        g.set(r);
        if write { g.opd_put(dst, size, r); }
        g.prod = Prod::Known { op: kind, size, a, b, r, cf };
    };
    match i.op {
        0x00..=0x3F if i.op & 7 < 6 => {
            let aop = i.op >> 3;
            let size = if i.op & 1 == 0 { 8 } else { osz };
            match i.op & 7 {
                0..=3 => {
                    let mm = m.unwrap();
                    let r = rm(g, size);
                    let rg = reg_opd(mm.reg, size, rex);
                    if i.op & 2 == 0 { alu(g, aop, r, rg, size, aop != 7) } else { alu(g, aop, rg, r, size, aop != 7) }
                }
                _ => alu(g, aop, Opd::Reg(0, false), Opd::Imm(i.imm), size, aop != 7),
            }
        }
        0x80 | 0x81 | 0x83 => {
            let mm = m.unwrap();
            let aop = (mm.reg & 7) as u32;
            let size = if i.op == 0x80 { 8 } else { osz };
            let r = rm(g, size);
            alu(g, aop, r, Opd::Imm(i.imm), size, aop != 7);
        }
        0x84 | 0x85 => {
            let size = if i.op == 0x84 { 8 } else { osz };
            let mm = m.unwrap();
            let r = rm(g, size);
            alu(g, 4, r, reg_opd(mm.reg, size, rex), size, false);
        }
        0xA8 | 0xA9 => {
            let size = if i.op == 0xA8 { 8 } else { osz };
            let a = g.val(Opd::Reg(0, false), size);
            let b = g.val(Opd::Imm(i.imm), size);
            let r = g.tmp();
            g.get(a); g.get(b); g.b(I64AND); g.set(r);
            g.set_prod(LZ_LOGIC, size, a, b, r);
        }
        0x50..=0x57 => {
            if osz == 16 { return false; }
            let r = ((i.op & 7) as u8) | ((rex & 1) << 3);
            let v = g.val(Opd::Reg(r, false), 64);
            g.push(v);
        }
        0x58..=0x5F => {
            if osz == 16 { return false; }
            let r = ((i.op & 7) as u8) | ((rex & 1) << 3);
            g.ensure(4);
            g.get(R0 + 4); g.set(L_A2);
            let v = g.tmp();
            g.load(L_A2, 64); g.set(v);
            g.get(L_A2); g.i64c(8); g.b(I64ADD); g.set(R0 + 4); g.dirty |= 1 << 4;
            g.wr_reg(r, false, 64, v);
        }
        0x68 | 0x6A => {
            if osz == 16 { return false; }
            let v = g.tmp();
            g.i64c(i.imm); g.set(v);
            g.push(v);
        }
        0x63 => {
            let mm = m.unwrap();
            let r = rm(g, 32);
            g.opd_get(r, 32);
            if osz == 64 { g.b(I32WRAP); g.b(0xAC); } // i64.extend_i32_s
            g.set(L_T);
            g.wr_reg(mm.reg, false, osz, L_T);
        }
        0x69 | 0x6B | 0x0FAF => {
            if live { return false; }
            let mm = m.unwrap();
            let r = rm(g, osz);
            g.opd_get(r, osz);
            if i.op == 0x0FAF { g.rd_reg(mm.reg, false, osz); } else { g.i64c(i.imm); }
            g.b(I64MUL); g.mask(osz); g.set(L_T);
            g.wr_reg(mm.reg, false, osz, L_T);
        }
        0x88..=0x8B => {
            let size = if i.op & 1 == 0 { 8 } else { osz };
            let mm = m.unwrap();
            let r = rm(g, size);
            let rg = reg_opd(mm.reg, size, rex);
            let (dst, src) = if i.op & 2 == 0 { (r, rg) } else { (rg, r) };
            g.opd_get(src, size); g.set(L_T);
            g.opd_put(dst, size, L_T);
        }
        0x8D => {
            let mm = m.unwrap();
            if mm.md == 3 { return false; }
            g.ea(&mm, i.next);
            if i.a67 { g.mask(32); }
            g.set(L_T);
            g.wr_reg(mm.reg, false, osz, L_T);
        }
        0x90 => { if rex & 1 != 0 { return false; } }
        0x98 => {
            g.rd_reg(0, false, 64);
            match osz { 64 => { g.b(I32WRAP); g.b(0xAC); } 32 => { g.b(I64EXT16S); } _ => { g.b(I64EXT8S); } }
            g.set(L_T);
            g.wr_reg(0, false, osz, L_T);
        }
        0x99 => {
            g.rd_reg(0, false, 64);
            match osz { 64 => {} 32 => { g.b(I32WRAP); g.b(0xAC); } _ => { g.b(I64EXT16S); } }
            g.i64c(63); g.b(I64SHRS); g.set(L_T);
            g.wr_reg(2, false, osz, L_T);
        }
        0xB0..=0xB7 => {
            let r = reg_opd(((i.op & 7) as u8) | ((rex & 1) << 3), 8, rex);
            g.i64c(i.imm & 0xFF); g.set(L_T);
            g.opd_put(r, 8, L_T);
        }
        0xB8..=0xBF => {
            let r = ((i.op & 7) as u8) | ((rex & 1) << 3);
            g.i64c(if osz == 64 { i.imm } else { i.imm & mask(osz) }); g.set(L_T);
            g.wr_reg(r, false, osz, L_T);
        }
        0xC6 | 0xC7 => {
            let size = if i.op == 0xC6 { 8 } else { osz };
            if m.unwrap().reg & 7 != 0 { return false; }
            let r = rm(g, size);
            g.i64c(i.imm & mask(size)); g.set(L_T);
            g.opd_put(r, size, L_T);
        }
        0xC0 | 0xC1 | 0xD0 | 0xD1 | 0xD2 | 0xD3 => {
            let size = if i.op & 1 == 0 { 8 } else { osz };
            let sub = m.unwrap().reg & 7;
            let cl = i.op >= 0xD2;
            let cmask = if size == 64 { 63 } else { 31 };
            if cl {
                // count from cl: only when the flags are not needed (a zero count keeps them)
                if live || size < 32 || sub == 2 || sub == 3 || sub == 6 { return false; }
                let r = rm(g, size);
                let a = g.val(r, size);
                let c = g.tmp();
                g.rd_reg(1, false, 64); g.i64c(cmask); g.b(I64AND); g.set(c);
                let res = g.tmp();
                match sub {
                    0 | 1 => {
                        if size == 64 { g.get(a); g.get(c); g.b(if sub == 0 { I64ROTL } else { I64ROTR }); }
                        else { g.get(a); g.b(I32WRAP); g.get(c); g.b(I32WRAP); g.b(if sub == 0 { I32ROTL } else { I32ROTR }); g.b(I64EXTU); }
                    }
                    4 => { g.get(a); g.get(c); g.b(I64SHL); g.mask(size); }
                    5 => { g.get(a); g.get(c); g.b(I64SHRU); }
                    _ => { g.get(a); if size == 32 { g.b(I32WRAP); g.b(0xAC); } g.get(c); g.b(I64SHRS); g.mask(size); }
                }
                g.set(res);
                g.opd_put(r, size, res);
                return true;
            }
            let cnt = (if i.op >= 0xD0 { 1 } else { i.imm } & cmask) as u32;
            if cnt == 0 { return sub != 2 && sub != 3; } // no-op
            if sub == 2 || sub == 3 { return false; }
            if (sub == 0 || sub == 1) && (live || size < 32) { return false; }
            let r = rm(g, size);
            let a = g.val(r, size);
            let res = g.tmp();
            let kind = match sub {
                0 | 1 => {
                    if size == 64 { g.get(a); g.i64c(cnt as u64); g.b(if sub == 0 { I64ROTL } else { I64ROTR }); }
                    else { g.get(a); g.b(I32WRAP); g.i32c(cnt as i32); g.b(if sub == 0 { I32ROTL } else { I32ROTR }); g.b(I64EXTU); }
                    0
                }
                4 | 6 => { if cnt >= size { g.i64c(0); } else { g.get(a); g.i64c(cnt as u64); g.b(I64SHL); g.mask(size); } LZ_SHL }
                5 => { g.get(a); g.i64c(cnt as u64); g.b(I64SHRU); LZ_SHR }
                _ => {
                    g.get(a);
                    if size < 64 { g.i64c(64 - size as u64); g.b(I64SHL); g.i64c(64 - size as u64); g.b(I64SHRS); }
                    g.i64c(cnt as u64); g.b(I64SHRS); g.mask(size);
                    LZ_SAR
                }
            };
            g.set(res);
            g.opd_put(r, size, res);
            if kind != 0 {
                let b = g.tmp();
                g.i64c(cnt as u64); g.set(b);
                g.set_prod(kind, size, a, b, res);
            }
        }
        0xF6 | 0xF7 => {
            let size = if i.op == 0xF6 { 8 } else { osz };
            let sub = m.unwrap().reg & 7;
            match sub {
                0 | 1 => {
                    let r = rm(g, size);
                    let a = g.val(r, size);
                    let b = g.val(Opd::Imm(i.imm), size);
                    let res = g.tmp();
                    g.get(a); g.get(b); g.b(I64AND); g.set(res);
                    g.set_prod(LZ_LOGIC, size, a, b, res);
                }
                2 => {
                    let r = rm(g, size);
                    g.opd_get(r, size); g.i64c(mask(size)); g.b(I64XOR); g.set(L_T);
                    g.opd_put(r, size, L_T);
                }
                3 => {
                    let r = rm(g, size);
                    let a = g.tmp();
                    g.i64c(0); g.set(a);
                    let b = g.val(r, size);
                    let res = g.tmp();
                    g.i64c(0); g.get(b); g.b(I64SUB); g.mask(size); g.set(res);
                    g.opd_put(r, size, res);
                    g.set_prod(LZ_SUB, size, a, b, res);
                }
                _ => return false,
            }
        }
        0xFE | 0xFF => {
            let size = if i.op == 0xFE { 8 } else { osz };
            let sub = m.unwrap().reg & 7;
            match sub {
                0 | 1 => {
                    // inc/dec keep CF
                    let cf = if live {
                        let t = g.tmp();
                        if !g.flag(b'C') { g.spill_flags(); g.i32c(2); g.call(F_COND); }
                        g.b(I64EXTU); g.set(t);
                        t
                    } else { NONE };
                    let r = rm(g, size);
                    let a = g.val(r, size);
                    let b = g.tmp();
                    g.i64c(1); g.set(b);
                    let res = g.tmp();
                    g.get(a); g.get(b); g.b(if sub == 0 { I64ADD } else { I64SUB }); g.mask(size); g.set(res);
                    g.opd_put(r, size, res);
                    g.prod = Prod::Known { op: if sub == 0 { LZ_INC } else { LZ_DEC }, size, a, b, r: res, cf };
                }
                6 => {
                    if osz == 16 { return false; }
                    let r = rm(g, 64);
                    let v = g.val(r, 64);
                    g.push(v);
                }
                _ => return false,
            }
        }
        0x0F1F => {}
        0x0FA3 | 0x0FAB | 0x0FB3 | 0x0FBB | 0x0FBA => {
            let mm = m.unwrap();
            if live || mm.md != 3 || osz == 16 { return false; }
            let kind = if i.op == 0x0FBA { mm.reg & 7 } else { match i.op { 0x0FA3 => 4, 0x0FAB => 5, 0x0FB3 => 6, _ => 7 } };
            if kind < 4 { return false; }
            if kind == 4 { return true; } // bt only sets CF, which nobody reads
            let r = Opd::Reg(mm.rm, false);
            let bit = g.tmp();
            if i.op == 0x0FBA { g.i64c(i.imm & (osz as u64 - 1)); } else { g.rd_reg(mm.reg, false, 64); g.i64c(osz as u64 - 1); g.b(I64AND); }
            g.set(bit);
            g.i64c(1); g.get(bit); g.b(I64SHL); g.set(L_V);
            g.opd_get(r, osz);
            match kind {
                5 => { g.get(L_V); g.b(I64OR); }
                6 => { g.get(L_V); g.i64c(u64::MAX); g.b(I64XOR); g.b(I64AND); }
                _ => { g.get(L_V); g.b(I64XOR); }
            }
            g.set(L_T);
            g.wr_reg(mm.rm, false, osz, L_T);
        }
        0x0F40..=0x0F4F => {
            let mm = m.unwrap();
            let r = rm(g, osz);
            let v = g.val(r, osz);
            let cur = g.val(Opd::Reg(mm.reg, false), osz);
            g.cond((i.op & 15) as u8); g.set(L_C);
            g.get(v); g.get(cur); g.get(L_C); g.b(SELECT); g.set(L_T);
            g.wr_reg(mm.reg, false, osz, L_T);
        }
        0x0F90..=0x0F9F => {
            let r = rm(g, 8);
            g.cond((i.op & 15) as u8); g.b(I64EXTU); g.set(L_T);
            g.opd_put(r, 8, L_T);
        }
        0x0FB6 | 0x0FB7 | 0x0FBE | 0x0FBF => {
            let mm = m.unwrap();
            let ssz = if i.op & 1 == 0 { 8 } else { 16 };
            let r = rm(g, ssz);
            g.opd_get(r, ssz);
            if i.op >= 0x0FBE { g.b(if ssz == 8 { I64EXT8S } else { I64EXT16S }); g.mask(osz); }
            g.set(L_T);
            g.wr_reg(mm.reg, false, osz, L_T);
        }
        0x0FC8..=0x0FCF => {
            if osz == 16 { return false; }
            let r = ((i.op & 7) as u8) | ((rex & 1) << 3);
            // byte swap with shifts and masks
            g.rd_reg(r, false, osz); g.set(L_V);
            let n = osz / 8;
            g.i64c(0);
            for k in 0..n {
                g.get(L_V); g.i64c(8 * k as u64); g.b(I64SHRU); g.i64c(0xFF); g.b(I64AND);
                g.i64c(8 * (n - 1 - k) as u64); g.b(I64SHL); g.b(I64OR);
            }
            g.set(L_T);
            g.wr_reg(r, false, osz, L_T);
        }
        _ => return false,
    }
    true
}

/// Translates the block at `rip`; None = nothing to compile there.
fn compile(e: &mut Engine, rip: u64) -> Option<Vec<u8>> {
    // decode the straight-line run
    let mut list: Vec<Ins> = Vec::new();
    let mut pc = rip;
    let mut end_rip = None; // where the block stops when it does not end in a jump
    while list.len() < MAX_INS {
        let Some(i) = decode(e, pc) else { end_rip = Some(pc); break };
        if is_branch(&i) {
            let native_term = match i.op {
                0x70..=0x7F | 0x0F80..=0x0F8F => true,
                0xE8 | 0xE9 | 0xEB | 0xC3 => true,
                0xC2 => true,
                0xFF => { let m = i.m.unwrap(); !(i.seg && m.md != 3) && !i.a67 && matches!(m.reg & 7, 2 | 4) && i.osz != 16 }
                _ => false,
            };
            if !native_term { end_rip = Some(pc); break; }
            list.push(i);
            if matches!(i.op, 0x70..=0x7F | 0x0F80..=0x0F8F) { pc = i.next; continue; }
            break;
        }
        list.push(i);
        pc = i.next;
    }
    if list.is_empty() { return None; }
    if end_rip.is_none() && !is_branch(list.last().unwrap()) { end_rip = Some(pc); }

    // flag liveness after each instruction (exits count as reads)
    let mut live = vec![true; list.len()];
    let mut l = true;
    for k in (0..list.len()).rev() {
        live[k] = l;
        let i = &list[k];
        if is_branch(i) { l = true; continue; }
        let (r, w) = flag_use(i);
        if r { l = true; } else if w { l = false; }
    }

    let cpu = &e.cpu as *const _ as u32;
    let mut g = G { c: Vec::with_capacity(4096), ntmp: FIRST_TMP, valid: 0, dirty: 0, prod: Prod::Unknown, cpu, tlb: e.mmu.tlb_addr(), pool: e.mmu.pool_addr(), head: rip };
    g.b(0x03); g.b(VOID); // loop (block start = label 0 at top level)
    let mut done_all = false;
    for (k, i) in list.iter().enumerate() {
        let n = k as u32 + 1;
        if g.ntmp > MAX_LOCALS - 40 { end_rip = Some(i.rip); break; }
        match i.op {
            0x70..=0x7F | 0x0F80..=0x0F8F => {
                let target = i.next.wrapping_add(i.imm);
                g.cond((i.op & 15) as u8);
                g.b(IF); g.b(VOID);
                g.jump(target, n, 1);
                g.b(END);
                continue;
            }
            0xEB | 0xE9 => { g.jump(i.next.wrapping_add(i.imm), n, 0); done_all = true; break; }
            0xE8 => {
                g.i64c(i.next); g.set(L_T);
                g.push(L_T);
                g.exit(i.next.wrapping_add(i.imm), n);
                done_all = true; break;
            }
            0xC3 | 0xC2 => {
                g.ensure(4);
                g.get(R0 + 4); g.set(L_A2);
                let t = g.tmp();
                g.load(L_A2, 64); g.set(t);
                g.get(L_A2); g.i64c(8 + if i.op == 0xC2 { i.imm & 0xFFFF } else { 0 }); g.b(I64ADD); g.set(R0 + 4); g.dirty |= 1 << 4;
                g.exit_dyn(t, n);
                done_all = true; break;
            }
            0xFF if is_branch(i) => {
                let m = i.m.unwrap();
                let opd = if m.md == 3 { Opd::Reg(m.rm, false) } else { g.ea(&m, i.next); g.set(L_A); Opd::Mem(L_A) };
                let t = g.val(opd, 64);
                if m.reg & 7 == 2 { g.i64c(i.next); g.set(L_T); g.push(L_T); }
                g.exit_dyn(t, n);
                done_all = true; break;
            }
            _ => {}
        }
        let snap = (g.c.len(), g.ntmp, g.valid, g.dirty, g.prod);
        if !native(&mut g, i, live[k]) {
            g.c.truncate(snap.0);
            (g.ntmp, g.valid, g.dirty, g.prod) = (snap.1, snap.2, snap.3, snap.4);
            g.fallback(i, n);
        }
    }
    if !done_all {
        let n = list.iter().take_while(|i| Some(i.rip) != end_rip).count() as u32;
        g.exit(end_rip.unwrap_or(pc), n);
    }
    g.b(END); // loop
    g.b(END); // function

    // module
    let mut body = Vec::with_capacity(g.c.len() + 16);
    leb_u(&mut body, 2);
    leb_u(&mut body, N_I32 as u64); body.push(0x7F);
    leb_u(&mut body, (g.ntmp - R0) as u64); body.push(0x7E);
    body.extend_from_slice(&g.c);

    let mut m = Vec::with_capacity(body.len() + 128);
    m.extend_from_slice(&[0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);
    let types: &[u8] = &[5,
        0x60, 0, 0,
        0x60, 2, 0x7E, 0x7F, 1, 0x7E,
        0x60, 3, 0x7E, 0x7E, 0x7F, 0,
        0x60, 1, 0x7E, 1, 0x7F,
        0x60, 1, 0x7F, 1, 0x7F];
    section(&mut m, 1, types);
    let mut imp = vec![5u8];
    let name = |v: &mut Vec<u8>, s: &str| { leb_u(v, s.len() as u64); v.extend_from_slice(s.as_bytes()); };
    name(&mut imp, "env"); name(&mut imp, "memory"); imp.extend_from_slice(&[0x02, 0x00, 0x00]);
    for (k, f) in ["rd", "wr", "step", "cond"].iter().enumerate() {
        name(&mut imp, "env"); name(&mut imp, f); imp.push(0x00); imp.push(k as u8 + 1);
    }
    section(&mut m, 2, &imp);
    section(&mut m, 3, &[1, 0]);
    section(&mut m, 7, &[1, 1, b'f', 0x00, 4]);
    let mut code = vec![1u8];
    leb_u(&mut code, body.len() as u64);
    code.extend_from_slice(&body);
    section(&mut m, 10, &code);
    Some(m)
}

fn section(m: &mut Vec<u8>, id: u8, data: &[u8]) {
    m.push(id);
    leb_u(m, data.len() as u64);
    m.extend_from_slice(data);
}
