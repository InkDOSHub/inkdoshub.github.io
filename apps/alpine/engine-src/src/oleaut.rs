// oleaut32.dll: BSTR strings and VARIANTs (what console programs like 7-Zip use).

use crate::Engine;

const VT_BSTR: u16 = 8;

impl Engine {
    fn bstr_alloc(&mut self, src: u64, bytes: u64) -> u64 {
        let p = self.heap_alloc(bytes + 6, true);
        if p == 0 { return 0; }
        let _ = self.mmu.write32(p, bytes as u32);
        if src != 0 && bytes > 0 {
            let mut v = vec![0u8; bytes as usize];
            let _ = self.mmu.read_bytes(src, &mut v);
            let _ = self.mmu.write_bytes(p + 4, &v);
        }
        p + 4
    }
    fn bstr_free(&mut self, b: u64) { if b != 0 { self.heap_free(b - 4); } }
    fn bstr_len(&mut self, b: u64) -> u64 { if b == 0 { 0 } else { self.mmu.read32(b - 4).unwrap_or(0) as u64 } }
    fn variant_clear(&mut self, v: u64) {
        if self.mmu.read16(v).unwrap_or(0) == VT_BSTR { let b = self.mmu.read64(v + 8).unwrap_or(0); self.bstr_free(b); }
        let _ = self.mmu.write64(v, 0);
        let _ = self.mmu.write64(v + 8, 0);
    }
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let (a0, a1) = (e.arg(0), e.arg(1));
    Some(match name {
        "#2" | "SysAllocString" => {
            if a0 == 0 { return Some(0); }
            let mut n = 0; while e.mmu.read16(a0 + 2 * n).unwrap_or(0) != 0 { n += 1; }
            e.bstr_alloc(a0, 2 * n)
        }
        "#4" | "SysAllocStringLen" => e.bstr_alloc(a0, 2 * a1),
        "#150" | "SysAllocStringByteLen" => e.bstr_alloc(a0, a1),
        "#6" | "SysFreeString" => { e.bstr_free(a0); 0 }
        "#7" | "SysStringLen" => e.bstr_len(a0) / 2,
        "#149" | "SysStringByteLen" => e.bstr_len(a0),
        "#5" | "SysReAllocString" | "#3" => {
            let old = e.mmu.read64(a0).unwrap_or(0);
            let mut n = 0; while a1 != 0 && e.mmu.read16(a1 + 2 * n).unwrap_or(0) != 0 { n += 1; }
            let b = e.bstr_alloc(a1, 2 * n);
            e.bstr_free(old);
            let _ = e.mmu.write64(a0, b);
            1
        }
        "#8" | "VariantInit" => { let _ = e.mmu.write64(a0, 0); 0 }
        "#9" | "VariantClear" => { e.variant_clear(a0); 0 }
        "#10" | "VariantCopy" => {
            e.variant_clear(a0);
            let (h, v, w) = (e.mmu.read64(a1).unwrap_or(0), e.mmu.read64(a1 + 8).unwrap_or(0), e.mmu.read64(a1 + 16).unwrap_or(0));
            let v = if h as u16 == VT_BSTR { let n = e.bstr_len(v); e.bstr_alloc(v, n) } else { v };
            let _ = e.mmu.write64(a0, h); let _ = e.mmu.write64(a0 + 8, v); let _ = e.mmu.write64(a0 + 16, w);
            0
        }
        _ => return None,
    })
}
