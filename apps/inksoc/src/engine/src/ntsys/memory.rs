// Virtual memory.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    Some(match name {
        // ---- memory ----
        "NtAllocateVirtualMemory" | "NtAllocateVirtualMemoryEx" => {
            let (bp, sp) = (e.arg(1), if name == "NtAllocateVirtualMemory" { e.arg(3) } else { e.arg(2) });
            let (want, size) = (e.r64(bp), e.r64(sp));
            let kind = e.arg(if name == "NtAllocateVirtualMemory" { 4 } else { 3 }) as u32;
            let a = if want == 0 {
                if kind & 0x1000 == 0 {
                    e.reserve(size)
                } else {
                    e.alloc(size)
                }
            } else if e.mmu.region_of(want).is_some() {
                Some(want & !0xFFF)
            } else {
                let s = want & !0xFFFF;
                let end = (want + size + 0xFFFF) & !0xFFFF;
                if e.mmu.overlaps(s, end) {
                    None
                } else {
                    e.mmu.add_region(s, end - s);
                    Some(s)
                }
            };
            match a {
                Some(a) => {
                    e.w64(bp, a);
                    e.w64(sp, (size + 0xFFF) & !0xFFF);
                    OK
                }
                None => NO_MEMORY, // NO_MEMORY
            }
        }
        "NtFreeVirtualMemory" => {
            let (bp, sp, kind) = (e.arg(1), e.arg(2), e.arg(3) as u32);
            let (a, size) = (e.r64(bp), e.r64(sp));
            if kind & 0x8000 != 0 {
                e.mmu.release_region(a);
            } else {
                e.mmu.drop_pages(a & !0xFFF, a + size);
            }
            OK
        }
        "NtProtectVirtualMemory" => {
            let old = e.arg(4);
            e.w32(old, 4);
            OK
        }
        "NtFlushInstructionCache" | "NtLockVirtualMemory" | "NtUnlockVirtualMemory" => OK,
        "NtQueryVirtualMemory" => {
            let (addr, class, buf, len, ret) = (e.arg(1), e.arg(2) as u32, e.arg(3), e.arg(4), e.arg(5));
            if class != 0 {
                return Some(INVALID_INFO_CLASS);
            }
            if len < 48 {
                return Some(INFO_LENGTH_MISMATCH);
            }
            e.zero_n(buf, 48);
            let page = addr & !0xFFF;
            e.w64(buf, page);
            match e.mmu.region_of(addr) {
                Some((s, end)) => {
                    e.w64(buf + 8, s);
                    e.w32(buf + 16, 4);
                    e.w64(buf + 24, end - page);
                    e.w32(buf + 32, 0x1000);
                    e.w32(buf + 36, 4);
                    e.w32(buf + 40, 0x20000);
                }
                None => {
                    // inside a loaded image?
                    match e.s.modules.iter().find(|m| !m.native && addr >= m.base && addr < m.base + m.size).map(|m| (m.base, m.size)) {
                        Some((b, sz)) => {
                            e.w64(buf + 8, b);
                            e.w32(buf + 16, 0x80);
                            e.w64(buf + 24, b + sz - page);
                            e.w32(buf + 32, 0x1000);
                            e.w32(buf + 36, 0x20);
                            e.w32(buf + 40, 0x100_0000);
                        }
                        None => {
                            e.w64(buf + 24, 0x1000);
                            e.w32(buf + 32, 0x10000);
                            e.w32(buf + 36, 1);
                        }
                    }
                }
            }
            if ret != 0 {
                e.w64(ret, 48);
            }
            OK
        }
        "NtReadVirtualMemory" => {
            let (src, dst, n, ret) = (e.arg(1), e.arg(2), e.arg(3), e.arg(4));
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(src, &mut v).is_err() || e.mmu.write_bytes(dst, &v).is_err() {
                return Some(BUFFER_OVERFLOW + 0x4000_0000);
            }
            if ret != 0 {
                e.w64(ret, n);
            }
            OK
        }
        "NtWriteVirtualMemory" => {
            let (dst, src, n, ret) = (e.arg(1), e.arg(2), e.arg(3), e.arg(4));
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(src, &mut v).is_err() || e.mmu.write_bytes(dst, &v).is_err() {
                return Some(ACCESS_DENIED);
            }
            if ret != 0 {
                e.w64(ret, n);
            }
            OK
        }
        _ => return e.not_mine(),
    })
}
