// Shell and shlwapi helpers, and the rest.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- shell32 / shlwapi helpers ----
        "CommandLineToArgvW" => {
            let s: Vec<u16> = e.wstr_n(a0, -1);
            let args = split_cmdline(&String::from_utf16_lossy(&s));
            let total: usize = args.iter().map(|a| a.encode_utf16().count() + 1).sum();
            let base = e.heap_alloc((8 * (args.len() + 1) + 2 * total) as u64, true);
            let mut p = base + 8 * (args.len() as u64 + 1);
            for (i, a) in args.iter().enumerate() {
                e.w64(base + 8 * i as u64, p);
                let w: Vec<u16> = a.encode_utf16().collect();
                for (k, c) in w.iter().enumerate() {
                    e.w16(p + 2 * k as u64, *c);
                }
                e.w16(p + 2 * w.len() as u64, 0);
                p += 2 * (w.len() as u64 + 1);
            }
            let np = e.arg(1);
            e.w32(np, args.len() as u32);
            base
        }
        "PathFileExistsW" | "PathFileExistsA" => {
            let p = if name.ends_with('W') { e.read_wstr(a0, 32768) } else { e.read_cstr(a0, 32768) };
            let k = p.rsplit(['\\', '/']).next().unwrap_or(&p).to_ascii_lowercase();
            e.s.files.contains_key(&k) as u64
        }

        // ---- misc ----
        "SystemFunction036" | "RtlGenRandom" | "ProcessPrng" => {
            let (p, n) = (a0, e.arg(1) as u32 as u64);
            let mut x = (crate::epoch_ms() as u64) ^ 0x9E37_79B9_7F4A_7C15 ^ e.cpu.icount;
            for i in 0..n {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                e.w8(p + i, x as u8);
            }
            1
        }
        // the old CryptoAPI: only its random numbers (Python seeds its hashes with them)
        "CryptAcquireContextW" | "CryptAcquireContextA" => {
            e.w64(a0, 0xC0FFEE);
            1
        }
        "CryptReleaseContext" => 1,
        // hashes: the data is kept and hashed when the value is asked for (hash.rs)
        "CryptCreateHash" => {
            let (alg, out) = (e.arg(1) as u32, e.arg(4));
            if crate::hash::by_algid(alg, &[]).is_none() {
                e.set_last_error(0x8009_0008);
                return Some(0);
            } // NTE_BAD_ALGID
            e.s.fs.hash_next += 1;
            let h = 0xC0DE_0000 + e.s.fs.hash_next;
            e.s.fs.hashes.insert(h, (alg, Vec::new()));
            e.w64(out, h);
            1
        }
        "CryptHashData" => {
            let (h, p, n) = (a0, e.arg(1), e.arg(2) as u32 as usize);
            let mut v = vec![0u8; n];
            if e.mmu.read_bytes(p, &mut v).is_err() {
                e.set_last_error(87);
                return Some(0);
            }
            match e.s.fs.hashes.get_mut(&h) {
                Some(x) => {
                    x.1.extend_from_slice(&v);
                    1
                }
                None => {
                    e.set_last_error(6);
                    0
                }
            }
        }
        "CryptGetHashParam" => {
            let (h, param, buf, lenp) = (a0, e.arg(1) as u32, e.arg(2), e.arg(3));
            let Some((alg, data)) = e.s.fs.hashes.get(&h).cloned() else {
                e.set_last_error(6);
                return Some(0);
            };
            let v = crate::hash::by_algid(alg, &data).unwrap_or_default();
            let out: Vec<u8> = match param {
                1 => alg.to_le_bytes().to_vec(),
                2 => v,
                4 => (v.len() as u32).to_le_bytes().to_vec(),
                _ => {
                    e.set_last_error(0x8009_0009);
                    return Some(0);
                }
            }; // NTE_BAD_TYPE
            let have = e.r32(lenp) as usize;
            e.w32(lenp, out.len() as u32);
            if buf == 0 {
                return Some(1);
            }
            if have < out.len() {
                e.set_last_error(234);
                return Some(0);
            } // ERROR_MORE_DATA
            let _ = e.mmu.write_bytes(buf, &out);
            1
        }
        "CryptDestroyHash" => {
            e.s.fs.hashes.remove(&a0);
            1
        }
        "CryptDuplicateHash" => {
            let (h, out) = (a0, e.arg(2));
            let Some(x) = e.s.fs.hashes.get(&h).cloned() else {
                e.set_last_error(6);
                return Some(0);
            };
            e.s.fs.hash_next += 1;
            let n = 0xC0DE_0000 + e.s.fs.hash_next;
            e.s.fs.hashes.insert(n, x);
            e.w64(out, n);
            1
        }
        "CryptGenRandom" => {
            let (n, p) = (e.arg(1) as u32 as u64, e.arg(2));
            let mut x = (crate::epoch_ms() as u64) ^ 0x6A09_E667_F3BC_C909 ^ e.cpu.icount;
            for i in 0..n {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                e.w8(p + i, x as u8);
            }
            1
        }
        "BCryptGenRandom" => {
            let (p, n) = (e.arg(1), e.arg(2) as u32 as u64);
            let mut x = (crate::epoch_ms() as u64) ^ 0x2545_F491_4F6C_DD1D ^ e.cpu.icount;
            for i in 0..n {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                e.w8(p + i, x as u8);
            }
            0
        }
        "FlsGetValue2" => e.r64(e.cpu.gs_base + 0x1480 + 8 * a0.min(63)),
        "TlsGetValue2" => e.r64(e.cpu.gs_base + 0x1480 + 8 * a0.min(63)),
        "EventRegister" | "EventUnregister" | "EventSetInformation" | "EventWriteTransfer" | "EventWrite" => 0,
        "OutputDebugStringW" => {
            let s = e.read_wstr(a0, 4096);
            console(&format!("[debug] {}", s));
            0
        }
        "WerSetFlags" | "WerRegisterRuntimeExceptionModule" => 0,
        "CoInitialize" | "CoInitializeEx" | "OleInitialize" => 0,
        "CoUninitialize" | "OleUninitialize" => 0,
        "CoTaskMemAlloc" => e.heap_alloc(a0.max(1), false),
        "CoTaskMemFree" => 0,
        "timeBeginPeriod" | "timeEndPeriod" => 0,
        "timeGetTime" => crate::now_ms() as u64 & 0xFFFF_FFFF,
        _ => return e.not_mine(),
    })
}
