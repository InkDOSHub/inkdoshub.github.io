// msvcrt.dll for programs: string and formatting functions come from Wine's
// msvcrt compiled to wasm (wine.wasm, see src/wine/); memory, heap and
// streams are native here. Wine's code reads and writes program memory
// through the page table via the wine_load_ptr / wine_store_ptr hooks.

use crate::{console, Engine, RET_INITTERM, TEB};
use std::collections::HashMap;

#[link(wasm_import_module = "env")]
extern "C" {
    /// Calls ink_call in wine.wasm (forwarded by the page).
    fn wine_call(id: i32, a: u64, b: u64, c: u64, d: u64) -> u64;
}

/// Wine's own data and stack sit below this address in wasm memory; any
/// higher address Wine uses is a program address.
const WINE_PRIVATE_END: u64 = 0x40_0000;
const FILE_SIZE: u64 = 48;

pub struct Stream { data: Vec<u8>, pos: usize, name: String, write: bool, eof: bool }

#[derive(Default)]
pub struct Crt {
    iob: u64,
    lconv: u64,
    strerror: u64,
    data: HashMap<String, u64>,
    initterm: Vec<(Vec<u64>, u64)>, // pending constructors, caller rsp
    pub streams: HashMap<u64, Stream>,
    pending: Option<(u64, u32)>, // a store that crosses a page, done through BOUNCE
}

static mut BOUNCE: [u8; 64] = [0; 64];

#[allow(static_mut_refs)]
fn bounce() -> u64 { unsafe { BOUNCE.as_ptr() as u64 } }

impl Engine {
    fn flush_pending(&mut self) {
        if let Some((a, n)) = self.crt.pending.take() {
            for i in 0..n as u64 {
                let v = unsafe { *(bounce() as *const u8).add(i as usize) };
                if self.mmu.write8(a + i, v).is_err() { self.fault(a + i); }
            }
        }
    }

    fn xlate(&mut self, addr: u64, bytes: u32, write: bool) -> u64 {
        self.flush_pending();
        if addr < WINE_PRIVATE_END { return addr; }
        if (addr & 0xFFF) + bytes as u64 <= 4096 {
            return match self.mmu.host_addr(addr, write) { Ok(h) => h, Err(_) => { self.fault(addr); bounce() } };
        }
        // crosses a page: go through the bounce buffer
        if write {
            self.crt.pending = Some((addr, bytes));
        } else {
            for i in 0..bytes as u64 {
                let v = match self.mmu.read8(addr + i) { Ok(v) => v, Err(_) => { self.fault(addr + i); 0 } };
                unsafe { *(bounce() as *mut u8).add(i as usize) = v; }
            }
        }
        bounce()
    }

    /// Byte access that works for program and Wine-private addresses.
    fn any_read(&mut self, a: u64) -> u8 {
        if a < WINE_PRIVATE_END { unsafe { *(a as *const u8) } } else { self.mmu.read8(a).unwrap_or(0) }
    }
    fn any_write(&mut self, a: u64, v: u8) {
        if a < WINE_PRIVATE_END { unsafe { *(a as *mut u8) = v; } } else if self.mmu.write8(a, v).is_err() { self.fault(a); }
    }

    fn wine(&mut self, id: i32, a: u64, b: u64, c: u64, d: u64) -> u64 {
        self.bridge_calls += 1;
        let r = unsafe { wine_call(id, a, b, c, d) };
        self.flush_pending();
        r
    }

    fn iob(&mut self) -> u64 {
        if self.crt.iob == 0 { self.crt.iob = self.heap_alloc(3 * FILE_SIZE, true); }
        self.crt.iob
    }

    /// Writes to a FILE*: stdout/stderr go to the console, others to their file.
    fn stream_write(&mut self, f: u64, data: &[u8]) -> bool {
        let iob = self.iob();
        if f == iob + FILE_SIZE || f == iob + 2 * FILE_SIZE || f == 1 {
            console(&String::from_utf8_lossy(data));
            return true;
        }
        match self.crt.streams.get_mut(&f) {
            Some(s) if s.write => {
                let end = s.pos + data.len();
                if s.data.len() < end { s.data.resize(end, 0); }
                s.data[s.pos..end].copy_from_slice(data);
                s.pos = end;
                true
            }
            _ => false,
        }
    }

    fn read_guest(&mut self, a: u64, n: u64) -> Vec<u8> {
        let mut v = vec![0u8; n as usize];
        if self.mmu.read_bytes(a, &mut v).is_err() { self.fault(a); }
        v
    }

    /// Homes the register arguments into the shadow space so the variadic
    /// part is one contiguous 8-byte-slot list (a Windows x64 va_list).
    fn va_from(&mut self, first: usize) -> u64 {
        let rsp = self.cpu.regs[4];
        for i in first..4 {
            let v = self.arg(i);
            let _ = self.mmu.write64(rsp + 8 + 8 * i as u64, v);
        }
        rsp + 8 + 8 * first as u64
    }
}

// ---- hooks used by wine.wasm (exported to the page, which passes them in) ----

#[no_mangle]
pub extern "C" fn wine_load_ptr(_id: i32, bytes: i32, off: u64, addr: u64) -> u64 {
    // the load keeps its constant offset, so return the translated base
    crate::eng().xlate(addr.wrapping_add(off), bytes as u32, false).wrapping_sub(off)
}
#[no_mangle]
pub extern "C" fn wine_store_ptr(_id: i32, bytes: i32, off: u64, addr: u64) -> u64 {
    crate::eng().xlate(addr.wrapping_add(off), bytes as u32, true).wrapping_sub(off)
}
#[no_mangle]
pub extern "C" fn wine_malloc(n: u64) -> u64 { crate::eng().heap_alloc(n, false) }
#[no_mangle]
pub extern "C" fn wine_free(p: u64) { if p != 0 { crate::eng().heap_free(p); } }
#[no_mangle]
pub extern "C" fn wine_teb() -> u64 { TEB }
#[no_mangle]
pub extern "C" fn wine_memmove(dst: u64, src: u64, n: u64) -> u64 {
    let e = crate::eng();
    e.flush_pending();
    if dst >= WINE_PRIVATE_END && src >= WINE_PRIVATE_END {
        let v = e.read_guest(src, n);
        if e.mmu.write_bytes(dst, &v).is_err() { e.fault(dst); }
    } else {
        let v: Vec<u8> = (0..n).map(|i| e.any_read(src + i)).collect();
        for (i, b) in v.into_iter().enumerate() { e.any_write(dst + i as u64, b); }
    }
    dst
}
#[no_mangle]
pub extern "C" fn wine_output(stream: u64, buf: u64, len: i32) {
    let e = crate::eng();
    let v: Vec<u8> = (0..len.max(0) as u64).map(|i| e.any_read(buf + i)).collect();
    e.stream_write(stream, &v);
}

/// Variables msvcrt exports as data (the program reads them through its import table).
pub fn data_export(e: &mut Engine, dll: &str, name: &str) -> Option<u64> {
    if dll != "msvcrt.dll" { return None; }
    if !["_fmode", "_commode", "__initenv", "_environ", "__argc", "__argv", "_iob", "__mb_cur_max", "_acmdln"].contains(&name) { return None; }
    if let Some(&a) = e.crt.data.get(name) { return Some(a); }
    let a = if name == "_iob" { e.iob() } else { e.heap_alloc(16, true) };
    if name == "__mb_cur_max" { let _ = e.mmu.write32(a, 1); }
    if name == "_acmdln" { let c = e.cmdline.0; let _ = e.mmu.write64(a, c); }
    e.crt.data.insert(name.to_string(), a);
    Some(a)
}

/// Runs the next constructor of an _initterm list, or returns to its caller.
pub fn initterm_next(e: &mut Engine) {
    let Some((list, sp)) = e.crt.initterm.last_mut() else { e.error = Some("bad _initterm return".into()); return };
    if let Some(f) = list.pop() {
        e.call_guest(f, [0, 0, 0], RET_INITTERM);
    } else {
        let sp = *sp;
        e.crt.initterm.pop();
        e.cpu.regs[4] = sp;
        e.do_ret(0);
    }
}

fn split_cmdline(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut quoted, mut any) = (Vec::new(), String::new(), false, false);
    for c in s.chars() {
        match c {
            '"' => { quoted = !quoted; any = true; }
            ' ' | '\t' if !quoted => { if any { out.push(std::mem::take(&mut cur)); any = false; } }
            _ => { cur.push(c); any = true; }
        }
    }
    if any { out.push(cur); }
    out
}

/// Functions taken from Wine's msvcrt: name -> ink_call number (see glue.c).
const WINE_FUNCS: &[(&str, i32)] = &[
    ("strlen", 0), ("strcmp", 1), ("strncmp", 2), ("strcpy", 3), ("strncpy", 4), ("strcat", 5),
    ("strncat", 6), ("strchr", 7), ("strrchr", 8), ("strstr", 9), ("strtol", 10), ("strtoul", 11),
    ("atoi", 12), ("atol", 13), ("_strdup", 14), ("toupper", 15), ("tolower", 16), ("isspace", 17),
    ("isdigit", 18), ("isalpha", 19), ("isalnum", 20), ("isupper", 21), ("islower", 22),
    ("_stricmp", 23), ("_strnicmp", 24), ("strspn", 25), ("strcspn", 26), ("strpbrk", 27),
    ("strtok", 28), ("memchr", 29), ("_vsnprintf", 32), ("vsnprintf", 32), ("vsprintf", 33),
    ("memcmp", 35), ("_itoa", 36),
];

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    if let Some(&(_, id)) = WINE_FUNCS.iter().find(|(n, _)| *n == name) {
        let (a, b, c, d) = (e.arg(0), e.arg(1), e.arg(2), e.arg(3));
        return Some(e.wine(id, a, b, c, d));
    }
    let a0 = e.arg(0);
    Some(match name {
        // floating-point results go in xmm0
        "strtod" | "atof" => {
            let a1 = e.arg(1);
            let bits = e.wine(if name == "strtod" { 30 } else { 31 }, a0, a1, 0, 0);
            e.cpu.xmm[0] = bits as u128;
            0
        }
        // formatting (Wine's printf engine); variadic arguments read in place
        "printf" => { let va = e.va_from(1); e.wine(34, 1, a0, va, 0) }
        "vprintf" => { let a1 = e.arg(1); e.wine(34, 1, a0, a1, 0) }
        "fprintf" => { let va = e.va_from(2); let a1 = e.arg(1); e.wine(34, a0, a1, va, 0) }
        "vfprintf" => { let (a1, a2) = (e.arg(1), e.arg(2)); e.wine(34, a0, a1, a2, 0) }
        "sprintf" => { let va = e.va_from(2); let a1 = e.arg(1); e.wine(33, a0, a1, va, 0) }
        "_snprintf" | "snprintf" => { let va = e.va_from(3); let (a1, a2) = (e.arg(1), e.arg(2)); e.wine(32, a0, a1, a2, va) }
        // memory
        "malloc" => e.heap_alloc(a0, false),
        "calloc" => { let a1 = e.arg(1); e.heap_alloc(a0.saturating_mul(a1), true) }
        "realloc" => { let a1 = e.arg(1); if a0 == 0 { e.heap_alloc(a1, false) } else { e.heap_realloc(a0, a1, false) } }
        "free" => { if a0 != 0 { e.heap_free(a0); } 0 }
        "memcpy" | "memmove" => { let (a1, a2) = (e.arg(1), e.arg(2)); wine_memmove(a0, a1, a2) }
        "memset" => {
            let (c, n) = (e.arg(1) as u8, e.arg(2));
            if e.mmu.write_bytes(a0, &vec![c; n as usize]).is_err() { e.fault(a0); }
            a0
        }
        // process
        "exit" | "_exit" | "abort" => {
            e.exited = true;
            e.exit_code = if name == "abort" { 3 } else { a0 as u32 };
            crate::kernel32::NO_RETURN
        }
        "_errno" => { e.iob(); TEB + 0x68 }
        // streams
        "__iob_func" => e.iob(),
        "puts" => { let s = e.read_cstr(a0, 1 << 20); e.stream_write(1, format!("{}\n", s).as_bytes()); 0 }
        "putchar" => { e.stream_write(1, &[a0 as u8]); a0 & 0xFF }
        "fputc" | "putc" => { let f = e.arg(1); if e.stream_write(f, &[a0 as u8]) { a0 & 0xFF } else { u32::MAX as u64 } }
        "fputs" => { let s = e.read_cstr(a0, 1 << 20); let f = e.arg(1); if e.stream_write(f, s.as_bytes()) { 0 } else { u32::MAX as u64 } }
        "fwrite" => {
            let (size, count, f) = (e.arg(1), e.arg(2), e.arg(3));
            let v = e.read_guest(a0, size * count);
            if e.stream_write(f, &v) { count } else { 0 }
        }
        "fflush" => 0,
        // program startup (mingw and MSVC startup code)
        "__set_app_type" | "__setusermatherr" | "_cexit" | "_lock" | "_unlock" | "_c_exit" | "_setmode" => 0,
        "__getmainargs" => {
            let cmd = { let c = e.cmdline.0; e.read_cstr(c, 32768) };
            let args = split_cmdline(&cmd);
            let argv = e.heap_alloc(8 * (args.len() as u64 + 1), true);
            for (i, a) in args.iter().enumerate() { let s = e.put_str(a, false); let _ = e.mmu.write64(argv + 8 * i as u64, s); }
            let env = e.heap_alloc(16, true);
            let (pargv, penv) = (e.arg(1), e.arg(2));
            let _ = e.mmu.write32(a0, args.len() as u32);
            let _ = e.mmu.write64(pargv, argv);
            let _ = e.mmu.write64(penv, env);
            if let Some(&v) = e.crt.data.get("__initenv") { let _ = e.mmu.write64(v, env); }
            0
        }
        "_initterm" => {
            let end = e.arg(1);
            let mut list = Vec::new();
            let mut p = a0;
            while p < end { let f = e.mmu.read64(p).unwrap_or(0); if f != 0 && f != u64::MAX { list.push(f); } p += 8; }
            list.reverse();
            let sp = e.cpu.regs[4];
            e.crt.initterm.push((list, sp));
            initterm_next(e);
            crate::kernel32::NO_RETURN
        }
        "_onexit" => a0,
        "_amsg_exit" => { e.exited = true; e.exit_code = 255; crate::kernel32::NO_RETURN }
        "signal" => 0,
        "___lc_codepage_func" => 0,
        "___mb_cur_max_func" => 1,
        "strerror" => { if e.crt.strerror == 0 { e.crt.strerror = e.put_str("error", false); } e.crt.strerror }
        "wcslen" => { let mut n = 0; while e.mmu.read16(a0 + 2 * n).unwrap_or(0) != 0 { n += 1; } n }
        "atexit" => 0,
        "localeconv" => {
            // a "C" locale lconv: decimal point "."
            if e.crt.lconv == 0 {
                let l = e.heap_alloc(0x60, true);
                let dot = e.put_str(".", false);
                let empty = e.put_str("", false);
                let _ = e.mmu.write64(l, dot);
                for i in 1..10 { let _ = e.mmu.write64(l + 8 * i, empty); }
                e.crt.lconv = l;
            }
            e.crt.lconv
        }
        "fopen" => {
            let path = e.read_cstr(a0, 260);
            let mode = { let a1 = e.arg(1); e.read_cstr(a1, 8) };
            let key = crate::pe::norm(&path);
            let write = mode.contains('w') || mode.contains('a');
            let data = match e.files.get(&key) {
                Some(d) if !mode.contains('w') => d.clone(),
                None if !write => { let _ = e.mmu.write32(TEB + 0x68, 2); return Some(0); } // ENOENT
                _ => Vec::new(),
            };
            let f = e.heap_alloc(FILE_SIZE, true);
            let pos = if mode.contains('a') { data.len() } else { 0 };
            e.crt.streams.insert(f, Stream { data, pos, name: key, write, eof: false });
            f
        }
        "fclose" => {
            match e.crt.streams.remove(&a0) {
                Some(s) => { if s.write { e.files.insert(s.name, s.data); } e.heap_free(a0); 0 }
                None => u32::MAX as u64,
            }
        }
        "fread" => {
            let (size, count, f) = (e.arg(1), e.arg(2), e.arg(3));
            let Some(s) = e.crt.streams.get_mut(&f) else { return Some(0) };
            let want = (size * count) as usize;
            let n = want.min(s.data.len().saturating_sub(s.pos));
            let chunk = s.data[s.pos..s.pos + n].to_vec();
            s.pos += n;
            if n < want { s.eof = true; }
            if e.mmu.write_bytes(a0, &chunk).is_err() { e.fault(a0); }
            if size == 0 { 0 } else { n as u64 / size }
        }
        "fgets" => {
            let (n, f) = (e.arg(1) as usize, e.arg(2));
            let Some(s) = e.crt.streams.get_mut(&f) else { return Some(0) };
            if s.pos >= s.data.len() || n == 0 { s.eof = true; return Some(0); }
            let mut line = Vec::new();
            while s.pos < s.data.len() && line.len() + 1 < n {
                let c = s.data[s.pos]; s.pos += 1; line.push(c);
                if c == b'\n' { break; }
            }
            line.push(0);
            if e.mmu.write_bytes(a0, &line).is_err() { e.fault(a0); }
            a0
        }
        "fgetc" | "getc" => {
            let Some(s) = e.crt.streams.get_mut(&a0) else { return Some(u32::MAX as u64) };
            if s.pos < s.data.len() { s.pos += 1; s.data[s.pos - 1] as u64 } else { s.eof = true; u32::MAX as u64 }
        }
        "feof" => e.crt.streams.get(&a0).map(|s| s.eof as u64).unwrap_or(0),
        "ftell" => e.crt.streams.get(&a0).map(|s| s.pos as u64).unwrap_or(u32::MAX as u64),
        "fseek" => {
            let (off, whence) = (e.arg(1) as i32 as i64, e.arg(2));
            let Some(s) = e.crt.streams.get_mut(&a0) else { return Some(u32::MAX as u64) };
            let base = match whence { 1 => s.pos as i64, 2 => s.data.len() as i64, _ => 0 };
            s.pos = (base + off).max(0) as usize;
            s.eof = false;
            0
        }
        _ => return None,
    })
}
