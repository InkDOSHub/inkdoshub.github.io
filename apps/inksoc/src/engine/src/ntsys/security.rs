// Tokens and security, and the registry entry points (registry.rs).

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    Some(match name {
        // ---- tokens and security: no accounts ----
        "NtOpenProcessToken" | "NtOpenProcessTokenEx" | "NtOpenThreadToken" | "NtOpenThreadTokenEx" => {
            if name.starts_with("NtOpenThread") {
                NO_TOKEN
            }
            // STATUS_NO_TOKEN
            else {
                let p = e.arg(if name.ends_with("Ex") { 3 } else { 2 });
                e.w64(p, 0x7FF0);
                OK
            }
        }
        "NtDuplicateToken" => {
            let p = e.arg(5);
            e.w64(p, 0x7FF0);
            OK
        } // the one token
        "NtSetInformationToken" => OK,
        "NtQueryInformationToken" => {
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            match class {
                18 | 20 => {
                    if ret != 0 {
                        e.w32(ret, 4);
                    }
                    if len < 4 {
                        return Some(BUFFER_TOO_SMALL);
                    }
                    e.w32(buf, if class == 18 { 1 } else { 0 });
                    OK
                }
                1 | 25 => {
                    // TokenUser / TokenIntegrityLevel: SID_AND_ATTRIBUTES + SID
                    let sid: Vec<u8> = if class == 1 {
                        vec![1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0xE8, 3, 0, 0]
                    } else {
                        vec![1, 1, 0, 0, 0, 0, 0, 16, 0, 0x30, 0, 0]
                    };
                    let need = 16 + sid.len() as u64;
                    if ret != 0 {
                        e.w32(ret, need as u32);
                    }
                    if len < need {
                        return Some(BUFFER_TOO_SMALL);
                    }
                    e.w64(buf, buf + 16);
                    e.w32(buf + 8, if class == 25 { 0x20 } else { 0 });
                    let _ = e.mmu.write_bytes(buf + 16, &sid);
                    OK
                }
                2 => {
                    // TokenGroups: Everyone, Users, Administrators (enabled), Interactive
                    let sids: [&[u8]; 4] = [
                        &[1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
                        &[1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x21, 2, 0, 0],
                        &[1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x20, 2, 0, 0],
                        &[1, 1, 0, 0, 0, 0, 0, 5, 4, 0, 0, 0],
                    ];
                    let n = sids.len() as u64;
                    let need = 8 + 16 * n + sids.iter().map(|s| s.len() as u64).sum::<u64>();
                    if ret != 0 {
                        e.w32(ret, need as u32);
                    }
                    if len < need {
                        return Some(BUFFER_TOO_SMALL);
                    }
                    e.w32(buf, n as u32);
                    let mut at = buf + 8 + 16 * n;
                    for (i, s) in sids.iter().enumerate() {
                        e.w64(buf + 8 + 16 * i as u64, at);
                        e.w32(buf + 16 + 16 * i as u64, 7); // mandatory, enabled by default, enabled
                        let _ = e.mmu.write_bytes(at, s);
                        at += s.len() as u64;
                    }
                    OK
                }
                _ => INVALID_INFO_CLASS,
            }
        }
        "NtAccessCheck" | "NtPrivilegeCheck" | "NtAdjustPrivilegesToken" => ACCESS_DENIED,

        // ---- registry: empty ----
        "NtOpenKey"
        | "NtOpenKeyEx"
        | "NtCreateKey"
        | "NtOpenKeyTransacted"
        | "NtOpenKeyTransactedEx"
        | "NtQueryValueKey"
        | "NtQueryKey"
        | "NtEnumerateKey"
        | "NtEnumerateValueKey"
        | "NtDeleteKey"
        | "NtDeleteValueKey"
        | "NtSetValueKey"
        | "NtNotifyChangeKey"
        | "NtNotifyChangeMultipleKeys"
        | "NtFlushKey" => return crate::registry::call(e, name),
        _ => return e.not_mine(),
    })
}
