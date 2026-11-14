// Runtime library extras: heap, interlocked singly linked lists, bitmaps.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- heap extras ----
        "HeapValidate" | "HeapSetInformation" | "HeapLock" | "HeapUnlock" => 1,
        "HeapCompact" => 0,
        "HeapWalk" => {
            e.set_last_error(ERROR_NO_MORE_ITEMS);
            0
        }
        "HeapQueryInformation" => {
            e.set_last_error(ERROR_NOT_SUPPORTED);
            0
        }
        "GetProcessHeaps" => {
            if e.arg(1) != 0 && a0 > 0 {
                let p = e.arg(1);
                e.w64(p, 0xAA_0000);
            }
            1
        }

        // ---- interlocked singly linked lists (SLIST_HEADER: depth/sequence, next) ----
        "InitializeSListHead" | "RtlInitializeSListHead" => {
            e.w64(a0, 0);
            e.w64(a0 + 8, 0);
            0
        }
        "InterlockedPushEntrySList" | "RtlInterlockedPushEntrySList" => {
            let ent = e.arg(1);
            let (lo, hi) = (e.r64(a0), e.r64(a0 + 8));
            let first = hi & !0xF;
            e.w64(ent, first);
            let depth = (lo & 0xFFFF) + 1;
            let seq = ((lo >> 16) + 1) & 0xFFFF_FFFF_FFFF;
            e.w64(a0, depth | seq << 16);
            e.w64(a0 + 8, (ent & !0xF) | (hi & 0xF));
            first
        }
        "InterlockedPopEntrySList" | "RtlInterlockedPopEntrySList" => {
            let (lo, hi) = (e.r64(a0), e.r64(a0 + 8));
            let first = hi & !0xF;
            if first != 0 {
                let next = e.r64(first);
                e.w64(a0, (lo & 0xFFFF).saturating_sub(1) | (((lo >> 16) + 1) & 0xFFFF_FFFF_FFFF) << 16);
                e.w64(a0 + 8, (next & !0xF) | (hi & 0xF));
            }
            first
        }
        "InterlockedFlushSList" | "RtlInterlockedFlushSList" => {
            let hi = e.r64(a0 + 8);
            let lo = e.r64(a0);
            e.w64(a0, lo & !0xFFFF);
            e.w64(a0 + 8, hi & 0xF);
            hi & !0xF
        }
        "QueryDepthSList" | "RtlQueryDepthSList" => e.r64(a0) & 0xFFFF,

        // ---- bitmaps (RTL_BITMAP: size, buffer) ----
        "RtlInitializeBitMap" => {
            let (buf, n) = (e.arg(1), e.arg(2));
            e.w32(a0, n as u32);
            e.w64(a0 + 8, buf);
            0
        }
        "RtlSetBits" | "RtlClearBits" | "RtlAreBitsSet" | "RtlAreBitsClear" => {
            let (start, n) = (e.arg(1) as u32 as u64, e.arg(2) as u32 as u64);
            let buf = e.r64(a0 + 8);
            let mut all = true;
            for i in start..start + n {
                let a = buf + i / 8;
                let b = e.r8(a);
                let bit = 1u8 << (i % 8);
                match name {
                    "RtlSetBits" => {
                        e.w8(a, b | bit);
                    }
                    "RtlClearBits" => {
                        e.w8(a, b & !bit);
                    }
                    "RtlAreBitsSet" => {
                        if b & bit == 0 {
                            all = false;
                        }
                    }
                    _ => {
                        if b & bit != 0 {
                            all = false;
                        }
                    }
                }
            }
            all as u64
        }
        _ => return e.not_mine(),
    })
}
