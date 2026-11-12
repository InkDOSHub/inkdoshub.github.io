// Minimal PE32+ loader: maps headers and sections at the preferred image
// base (always free in our address space, so no relocation is needed) and
// points every import at a
// native thunk (THUNK_BASE + 16 * index).

use crate::{Engine, THUNK_BASE};

fn u16_at(b: &[u8], o: usize) -> Result<u16, String> {
    b.get(o..o + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or_else(|| "truncated PE".into())
}
fn u32_at(b: &[u8], o: usize) -> Result<u32, String> {
    b.get(o..o + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or_else(|| "truncated PE".into())
}
fn u64_at(b: &[u8], o: usize) -> Result<u64, String> {
    Ok(u32_at(b, o)? as u64 | (u32_at(b, o + 4)? as u64) << 32)
}

pub fn load(e: &mut Engine, b: &[u8]) -> Result<u64, String> {
    if u16_at(b, 0)? != 0x5A4D { return Err("not an MZ file".into()); }
    let pe = u32_at(b, 0x3C)? as usize;
    if u32_at(b, pe)? != 0x4550 { return Err("not a PE file".into()); }
    let machine = u16_at(b, pe + 4)?;
    if machine != 0x8664 { return Err(format!("machine 0x{:x} not supported yet (x86-64 only)", machine)); }
    let nsec = u16_at(b, pe + 6)? as usize;
    let opt = pe + 24;
    let opt_size = u16_at(b, pe + 20)? as usize;
    if u16_at(b, opt)? != 0x20B { return Err("not PE32+".into()); }
    let entry_rva = u32_at(b, opt + 16)? as u64;
    let base = u64_at(b, opt + 24)?;
    let image_size = u32_at(b, opt + 56)? as u64;
    let headers_size = u32_at(b, opt + 60)? as usize;
    let dirs = opt + 112;

    e.mmu.add_region(base, (image_size + 0xFFF) & !0xFFF);
    let mut put = |e: &mut Engine, addr: u64, data: &[u8]| -> Result<(), String> {
        for (i, &v) in data.iter().enumerate() {
            e.mmu.write8(addr + i as u64, v).map_err(|_| "map failed".to_string())?;
        }
        Ok(())
    };
    put(e, base, &b[..headers_size.min(b.len())])?;
    let sec0 = opt + opt_size;
    for i in 0..nsec {
        let s = sec0 + i * 40;
        let va = u32_at(b, s + 12)? as u64;
        let raw_size = u32_at(b, s + 16)? as usize;
        let raw_ptr = u32_at(b, s + 20)? as usize;
        if raw_size > 0 && raw_ptr < b.len() {
            let end = (raw_ptr + raw_size).min(b.len());
            put(e, base + va, &b[raw_ptr..end])?;
        }
    }

    // Imports
    let imp_rva = u32_at(b, dirs + 8)? as u64;
    if imp_rva != 0 {
        let mut d = base + imp_rva;
        loop {
            let ilt = rd32(e, d)? as u64;
            let name_rva = rd32(e, d + 12)? as u64;
            let iat = rd32(e, d + 16)? as u64;
            if name_rva == 0 { break; }
            let lookup = if ilt != 0 { ilt } else { iat };
            let mut k = 0u64;
            loop {
                let ent = rd64(e, base + lookup + 8 * k)?;
                if ent == 0 { break; }
                let name = if ent >> 63 == 1 {
                    format!("#{}", ent & 0xFFFF)
                } else {
                    read_cstr(e, base + (ent & 0x7FFF_FFFF) + 2)?
                };
                let idx = e.imports.len() as u64;
                e.imports.push(name);
                e.mmu.write64(base + iat + 8 * k, THUNK_BASE + 16 * idx).map_err(|_| "iat")?;
                k += 1;
            }
            d += 20;
        }
    }
    Ok(base + entry_rva)
}

fn rd32(e: &mut Engine, a: u64) -> Result<u32, String> { e.mmu.read32(a).map_err(|_| "bad import table".to_string()) }
fn rd64(e: &mut Engine, a: u64) -> Result<u64, String> { e.mmu.read64(a).map_err(|_| "bad import table".to_string()) }
fn read_cstr(e: &mut Engine, a: u64) -> Result<String, String> {
    let mut s = Vec::new();
    for i in 0..256 {
        let c = e.mmu.read8(a + i).map_err(|_| "bad name")?;
        if c == 0 { break; }
        s.push(c);
    }
    Ok(String::from_utf8_lossy(&s).into_owned())
}
