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

pub const NATIVE_DLLS: &[&str] = &["kernel32.dll", "kernelbase.dll", "ntdll.dll", "msvcrt.dll"];

pub fn find_module(e: &Engine, name: &str) -> Option<usize> {
    let n = norm(name);
    e.modules.iter().position(|m| m.name == n)
}

pub fn norm(name: &str) -> String {
    let n = name.rsplit(['\\', '/']).next().unwrap_or(name).to_ascii_lowercase();
    if n.contains('.') { n } else { n + ".dll" }
}

/// Loads a module by name: from loaded modules, from the program files, or
/// as a native module (functions implemented in wasm). Returns its index.
pub fn load_by_name(e: &mut Engine, name: &str) -> Result<usize, String> {
    let n = norm(name);
    if let Some(i) = find_module(e, &n) { return Ok(i); }
    if let Some(bytes) = e.files.get(&n).cloned() {
        return load_image(e, &n, &bytes, false);
    }
    // native module: a small reserved range serves as its handle
    let base = e.alloc(0x10000).ok_or("out of memory")?;
    if !NATIVE_DLLS.contains(&n.as_str()) && !n.starts_with("api-ms-win-") {
        crate::console(&format!("[inksoc] {} is not available yet: its functions will stop the program when called\n", n));
    }
    e.modules.push(Module { name: n, base, size: 0x10000, entry: 0, exports: HashMap::new(), native: true });
    Ok(e.modules.len() - 1)
}

/// Address of an exported function (creates a native thunk when needed).
pub fn proc_address(e: &mut Engine, idx: usize, func: &str) -> Option<u64> {
    if e.modules[idx].native {
        let dll = e.modules[idx].name.clone();
        if let Some(a) = crate::msvcrt::data_export(e, &dll, func) { return Some(a); }
        return Some(e.thunk(&dll, func));
    }
    let a = *e.modules[idx].exports.get(func)?;
    if a == 0 { return None; }
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
        let a = e.next_dll;
        e.next_dll += image_size + 0x10000;
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
    let (exp_rva, exp_size) = dir(0)?;
    if exp_rva != 0 {
        let d = base + exp_rva;
        let ord_base = rd32(e, d + 16)? as u64;
        let nfun = rd32(e, d + 20)? as u64;
        let nnames = rd32(e, d + 24)? as u64;
        let (funcs, names, ords) = (base + rd32(e, d + 28)? as u64, base + rd32(e, d + 32)? as u64, base + rd32(e, d + 36)? as u64);
        let target = |e: &mut Engine, i: u64| -> Result<u64, String> {
            let rva = rd32(e, funcs + 4 * i)? as u64;
            // forwarders ("DLL.Func") point inside the export directory: resolved lazily as 0
            Ok(if rva >= exp_rva && rva < exp_rva + exp_size { 0 } else { base + rva })
        };
        for i in 0..nnames {
            let nrva = rd32(e, names + 4 * i)? as u64;
            let ord = e.mmu.read16(ords + 2 * i).map_err(|_| "exports")? as u64;
            let fname = e.read_cstr(base + nrva, 256);
            let t = target(e, ord)?;
            exports.insert(fname, t);
        }
        for i in 0..nfun { let t = target(e, i)?; exports.insert(format!("#{}", ord_base + i), t); }
    }

    let idx = e.modules.len();
    e.modules.push(Module { name: name.to_string(), base, size: image_size, entry: if entry_rva != 0 { base + entry_rva } else { 0 }, exports, native: false });

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
                    None => { let dn = e.modules[m].name.clone(); e.thunk(&dn, &format!("{} (missing export)", fname)) }
                };
                e.mmu.write64(base + iat + 8 * k, addr).map_err(|_| "iat")?;
                k += 1;
            }
            d += 20;
        }
    }
    if !is_exe && e.modules[idx].entry != 0 { e.init_queue.push((e.modules[idx].entry, base)); }
    Ok(idx)
}
