// PE32+ loader: maps an image (exe or DLL), applies base relocations when it
// cannot sit at its preferred base, reads its exports and binds its imports
// to other loaded images or to native (wasm) functions.

use crate::Engine;
use std::collections::HashMap;

pub struct Module {
    pub name: String, // lower case, e.g. "testdll.dll"
    pub base: u64,
    pub size: u64,
    pub entry: u64,
    pub exports: HashMap<String, u64>,
    pub native: bool,
    pub fwd: HashMap<String, String>, // forwarded exports: name -> "dll.Func"
}

fn u16_at(b: &[u8], o: usize) -> Result<u16, String> {
    b.get(o..o + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or_else(|| "truncated PE".into())
}
fn u32_at(b: &[u8], o: usize) -> Result<u32, String> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or_else(|| "truncated PE".into())
}
fn u64_at(b: &[u8], o: usize) -> Result<u64, String> {
    Ok(u32_at(b, o)? as u64 | (u32_at(b, o + 4)? as u64) << 32)
}

pub const NATIVE_DLLS: &[&str] = &["kernel32.dll", "kernelbase.dll", "ntdll.dll", "oleaut32.dll", "advapi32.dll", "vcruntime140.dll", "vcruntime140_1.dll", "shell32.dll", "shlwapi.dll", "bcrypt.dll", "bcryptprimitives.dll", "version.dll", "winmm.dll", "win32u.dll"];

pub fn find_module(e: &Engine, name: &str) -> Option<usize> {
    let n = norm(name);
    e.s.modules.iter().position(|m| m.name == n)
}

pub fn norm(name: &str) -> String {
    let n = name.rsplit(['\\', '/']).next().unwrap_or(name).to_ascii_lowercase();
    let n = if n.contains('.') { n } else { n + ".dll" };
    // the Universal CRT's API sets all live in ucrtbase.dll
    if n.starts_with("api-ms-win-crt-") { return "ucrtbase.dll".into(); }
    n
}

/// Loads a module by name: from loaded modules, from the program files, or
/// as a native module (functions implemented in wasm). Returns its index.
pub fn load_by_name(e: &mut Engine, name: &str) -> Result<usize, String> {
    let n = norm(name);
    if let Some(i) = find_module(e, &n) { return Ok(i); }
    if let Some(bytes) = e.s.files.get(&n).cloned() {
        return load_image(e, &n, &bytes, false);
    }
    // a DLL the engine does not implement at all: Wine's, as program code
    if !NATIVE_DLLS.contains(&n.as_str()) {
        if let Some(bytes) = e.s.files.get(&format!("wine-{}", n)).cloned() {
            // window-system DLLs: their DllMain needs the graphics kernel, which console programs never use
            let gui = ["shell32.dll", "ole32.dll", "combase.dll", "imm32.dll", "comctl32.dll", "winmm.dll", "setupapi.dll", "shcore.dll"].contains(&n.as_str());
            let r = load_image(e, &n, &bytes, false)?;
            // only the window DLL itself skips DllMain: the DLLs it pulled in still start normally
            if gui { let b = e.s.modules[r].base; e.s.init_queue.retain(|&(_, base)| base != b); }
            return Ok(r);
        }
    }
    // native module: a small reserved range serves as its handle
    let base = e.alloc(0x10000).ok_or("out of memory")?;
    if !NATIVE_DLLS.contains(&n.as_str()) && !n.starts_with("api-ms-win-") && !e.s.files.contains_key(&format!("wine-{}", n)) {
        crate::console(&format!("[inksoc] {} is not available yet: its functions will stop the program when called\n", n));
    }
    // a minimal PE header, for programs that read their DLLs' headers (PHP checks the
    // runtime's linker version: 14.x like Visual C++ 2015-2022)
    let mut h = [0u8; 0x150];
    h[0] = b'M'; h[1] = b'Z'; h[0x3C] = 0x40;
    h[0x40..0x44].copy_from_slice(b"PE\0\0");
    h[0x44..0x46].copy_from_slice(&0x8664u16.to_le_bytes());
    h[0x54..0x56].copy_from_slice(&0xF0u16.to_le_bytes()); // optional header size
    h[0x56..0x58].copy_from_slice(&0x2022u16.to_le_bytes()); // DLL, executable, large addresses
    h[0x58..0x5A].copy_from_slice(&0x20Bu16.to_le_bytes());
    h[0x5A] = 14; h[0x5B] = 44;
    h[0x58 + 24..0x58 + 32].copy_from_slice(&base.to_le_bytes()); // ImageBase
    h[0x58 + 32..0x58 + 36].copy_from_slice(&0x1000u32.to_le_bytes());
    h[0x58 + 36..0x58 + 40].copy_from_slice(&0x200u32.to_le_bytes());
    h[0x58 + 40] = 6; h[0x58 + 48] = 6; // OS and subsystem version 6.0
    h[0x58 + 56..0x58 + 60].copy_from_slice(&0x10000u32.to_le_bytes()); // SizeOfImage
    h[0x58 + 60..0x58 + 64].copy_from_slice(&0x1000u32.to_le_bytes());
    h[0x58 + 68] = 3; // console
    let _ = e.mmu.write_bytes(base, &h);
    e.s.modules.push(Module { name: n, base, size: 0x10000, entry: 0, exports: HashMap::new(), native: true, fwd: HashMap::new() });
    Ok(e.s.modules.len() - 1)
}

/// Address of an exported function (creates a native thunk when needed).
pub fn proc_address(e: &mut Engine, idx: usize, func: &str) -> Option<u64> {
    if e.s.modules[idx].native {
        let dll = e.s.modules[idx].name.clone();
        if let Some(a) = crate::msvcrt::data_export(e, &dll, func) { return Some(a); }
        return Some(e.thunk(&dll, func));
    }
    let a = *e.s.modules[idx].exports.get(func)?;
    if a == 0 {
        // forwarded export: "dll.Func" (or "dll.#ord")
        let f = e.s.modules[idx].fwd.get(func)?.clone();
        let (dll, name) = f.split_once('.')?;
        let m = load_by_name(e, dll).ok()?;
        return proc_address(e, m, name);
    }
    Some(a)
}

pub fn load_image(e: &mut Engine, name: &str, b: &[u8], is_exe: bool) -> Result<usize, String> {
    if u16_at(b, 0)? != 0x5A4D { return Err(format!("{}: not an MZ file", name)); }
    let pe = u32_at(b, 0x3C)? as usize;
    if u32_at(b, pe)? != 0x4550 { return Err(format!("{}: not a PE file", name)); }
    let machine = u16_at(b, pe + 4)?;
    if machine != 0x8664 {
        return Err(format!("{}: machine 0x{:x} is not supported yet (only 64-bit x86-64 for now)", name, machine));
    }
    let nsec = u16_at(b, pe + 6)? as usize;
    let opt = pe + 24;
    let opt_size = u16_at(b, pe + 20)? as usize;
    if u16_at(b, opt)? != 0x20B { return Err(format!("{}: not PE32+", name)); }
    let entry_rva = u32_at(b, opt + 16)? as u64;
    let pref = u64_at(b, opt + 24)?;
    let image_size = (u32_at(b, opt + 56)? as u64 + 0xFFFF) & !0xFFFF;
    let headers_size = u32_at(b, opt + 60)? as usize;
    let dirs = opt + 112;
    let dir = |i: usize| -> Result<(u64, u64), String> { Ok((u32_at(b, dirs + 8 * i)? as u64, u32_at(b, dirs + 8 * i + 4)? as u64)) };

    // Executables sit at their preferred base; DLLs go to our own range and
    // get relocated (this also exercises relocations on every run).
    let base = if is_exe && !e.mmu.overlaps(pref, pref + image_size) {
        e.mmu.add_region(pref, image_size);
        pref
    } else {
        let a = e.s.next_dll;
        e.s.next_dll += image_size + 0x10000;
        e.mmu.add_region(a, image_size);
        a
    };
    let delta = base.wrapping_sub(pref);
    let map_err = |_| format!("{}: mapping failed", name);
    e.mmu.write_bytes(base, &b[..headers_size.min(b.len())]).map_err(map_err)?;
    let sec0 = opt + opt_size;
    for i in 0..nsec {
        let s = sec0 + i * 40;
        let va = u32_at(b, s + 12)? as u64;
        let raw_size = u32_at(b, s + 16)? as usize;
        let raw_ptr = u32_at(b, s + 20)? as usize;
        if raw_size > 0 && raw_ptr < b.len() {
            let end = (raw_ptr + raw_size).min(b.len());
            e.mmu.write_bytes(base + va, &b[raw_ptr..end]).map_err(map_err)?;
        }
    }
    let rd32 = |e: &mut Engine, a: u64| e.mmu.read32(a).map_err(|_| format!("{}: bad table", name));
    let rd64 = |e: &mut Engine, a: u64| e.mmu.read64(a).map_err(|_| format!("{}: bad table", name));

    // Relocations
    let (rel_rva, rel_size) = dir(5)?;
    if delta != 0 && rel_rva != 0 {
        let mut p = base + rel_rva;
        let end = p + rel_size;
        while p + 8 <= end {
            let page = rd32(e, p)? as u64;
            let bsize = rd32(e, p + 4)? as u64;
            if bsize < 8 { break; }
            for k in 0..(bsize - 8) / 2 {
                let ent = e.mmu.read16(p + 8 + 2 * k).map_err(|_| "reloc")?;
                let at = base + page + (ent & 0xFFF) as u64;
                match ent >> 12 {
                    10 => { let v = rd64(e, at)?; e.mmu.write64(at, v.wrapping_add(delta)).map_err(|_| "reloc")?; }
                    3 => { let v = rd32(e, at)?; e.mmu.write32(at, v.wrapping_add(delta as u32)).map_err(|_| "reloc")?; }
                    _ => {}
                }
            }
            p += bsize;
        }
    } else if delta != 0 {
        return Err(format!("{}: cannot be moved (no relocations)", name));
    }

    // Exports
    let mut exports = HashMap::new();
    let mut fwd = HashMap::new();
    let (exp_rva, exp_size) = dir(0)?;
    if exp_rva != 0 {
        let d = base + exp_rva;
        let ord_base = rd32(e, d + 16)? as u64;
        let nfun = rd32(e, d + 20)? as u64;
        let nnames = rd32(e, d + 24)? as u64;
        let (funcs, names, ords) = (base + rd32(e, d + 28)? as u64, base + rd32(e, d + 32)? as u64, base + rd32(e, d + 36)? as u64);
        let target = |e: &mut Engine, i: u64| -> Result<u64, String> {
            let rva = rd32(e, funcs + 4 * i)? as u64;
            // forwarders ("DLL.Func") point inside the export directory: resolved when imported
            Ok(if rva >= exp_rva && rva < exp_rva + exp_size { 0 } else { base + rva })
        };
        for i in 0..nnames {
            let nrva = rd32(e, names + 4 * i)? as u64;
            let ord = e.mmu.read16(ords + 2 * i).map_err(|_| "exports")? as u64;
            let fname = e.read_cstr(base + nrva, 256);
            let t = target(e, ord)?;
            if t == 0 {
                let rva = rd32(e, funcs + 4 * ord)? as u64;
                let f = e.read_cstr(base + rva, 256);
                fwd.insert(fname.clone(), f);
            }
            exports.insert(fname, t);
        }
        for i in 0..nfun { let t = target(e, i)?; exports.insert(format!("#{}", ord_base + i), t); }
    }

    // gdi32 reads the GDI handle table straight from the PEB
    if name == "gdi32.dll" || name == "wine-gdi32.dll" { e.gdi_init(); }
    let idx = e.s.modules.len();
    e.s.modules.push(Module { name: name.to_string(), base, size: image_size, entry: if entry_rva != 0 { base + entry_rva } else { 0 }, exports, native: false, fwd });

    // Imports (load dependencies first, then bind)
    let (imp_rva, _) = dir(1)?;
    if imp_rva != 0 {
        let mut d = base + imp_rva;
        loop {
            let ilt = rd32(e, d)? as u64;
            let name_rva = rd32(e, d + 12)? as u64;
            let iat = rd32(e, d + 16)? as u64;
            if name_rva == 0 { break; }
            let dll = e.read_cstr(base + name_rva, 256);
            let m = load_by_name(e, &dll)?;
            let lookup = if ilt != 0 { ilt } else { iat };
            let mut k = 0u64;
            loop {
                let ent = rd64(e, base + lookup + 8 * k)?;
                if ent == 0 { break; }
                let fname = if ent >> 63 == 1 { format!("#{}", ent & 0xFFFF) } else { e.read_cstr(base + (ent & 0x7FFF_FFFF) + 2, 256) };
                let addr = match proc_address(e, m, &fname) {
                    Some(a) => a,
                    None => { let dn = e.s.modules[m].name.clone(); e.thunk(&dn, &format!("{} (missing export)", fname)) }
                };
                e.mmu.write64(base + iat + 8 * k, addr).map_err(|_| "iat")?;
                k += 1;
            }
            d += 20;
        }
    }
    // Static TLS (__declspec(thread)): one slot per image in the TEB's TLS array
    let (tls_rva, _) = dir(9)?;
    if tls_rva != 0 {
        let t = base + tls_rva;
        let (start, end, index_at) = (rd64(e, t)?, rd64(e, t + 8)?, rd64(e, t + 16)?);
        let zero = rd32(e, t + 32)? as u64;
        let i = e.s.tls_tmpl.len();
        e.s.tls_tmpl.push((start, end.saturating_sub(start), zero));
        if index_at != 0 { e.mmu.write32(index_at, i as u32).map_err(|_| "tls")?; }
        e.tls_block(crate::TEB, i);
    }
    if !is_exe && !e.s.no_init && e.s.modules[idx].entry != 0 { e.s.init_queue.push((e.s.modules[idx].entry, base)); }
    Ok(idx)
}
