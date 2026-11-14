// Sections (file mappings) and the remaining calls.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- sections: no file mapping yet ----
        "NtCreateSection" => {
            // (handle*, access, attributes, size*, protection, allocation, file)
            let (sp, file) = (e.arg(3), e.arg(6));
            if file != 0 && e.arg(5) & 0x100_0000 != 0 {
                // SEC_IMAGE: must be a PE file
                let Some(Handle::File { name, .. }) = e.s.fs.handles.get(&file) else { return Some(INVALID_HANDLE) };
                let name = name.clone();
                let ok = e.s.files.get(&name).map_or(false, |d| d.len() > 0x40 && &d[..2] == b"MZ");
                if !ok {
                    return Some(INVALID_IMAGE_FORMAT);
                } // STATUS_INVALID_IMAGE_FORMAT
                let h = e.new_handle(Handle::ImageSection { file: name });
                e.w64(a0, h);
                return Some(OK);
            }
            let want = if sp != 0 { e.r64(sp) } else { 0 };
            let s = if file != 0 {
                let Some(Handle::File { name, .. }) = e.s.fs.handles.get(&file) else { return Some(INVALID_HANDLE) };
                let name = name.clone();
                let len = e.s.files.size(&name).unwrap_or(0);
                if want > len {
                    if let Some(d) = e.s.files.get_mut(&name) {
                        d.resize(want as usize, 0);
                    }
                }
                let size = want.max(len);
                if size == 0 {
                    return Some(MAPPED_FILE_SIZE_ZERO);
                } // STATUS_MAPPED_FILE_SIZE_ZERO
                Handle::Section { file: Some(name), size, base: 0 }
            } else {
                if want == 0 {
                    return Some(INVALID_PARAMETER);
                }
                Handle::Section { file: None, size: want, base: 0 }
            };
            let h = e.new_handle(s);
            e.w64(a0, h);
            OK
        }
        "NtMapViewOfSection" | "NtMapViewOfSectionEx" => {
            // (section, process, base*, zero bits, commit, offset*, view size*, ...) / Ex: (section, process, base*, offset*, view size*, ...)
            let ex = name == "NtMapViewOfSectionEx";
            let (bp, op, vp) = if ex { (e.arg(2), e.arg(3), e.arg(4)) } else { (e.arg(2), e.arg(5), e.arg(6)) };
            let off = if op != 0 { e.r64(op) } else { 0 };
            let want = if vp != 0 { e.r64(vp) } else { 0 };
            if let Some(Handle::ImageSection { file }) = e.s.fs.handles.get(&a0) {
                if file == "wine32-ntdll.dll" && e.s.wow64_ntdll != 0 {
                    // the 32-bit ntdll the engine mapped at process start
                    let a = e.s.wow64_ntdll;
                    let sz = e.s.images.get(&a).copied().unwrap_or(0);
                    e.w64(bp, a);
                    if vp != 0 {
                        e.w64(vp, sz);
                    }
                    return Some(OK);
                }
                let Some(b) = e.s.files.get(file).cloned() else { return Some(INVALID_HANDLE) };
                let (a, sz, moved) = match crate::pe::map_image(e, &b) {
                    Ok(v) => v,
                    Err(_) => return Some(INVALID_IMAGE_FORMAT),
                };
                e.w64(bp, a);
                if vp != 0 {
                    e.w64(vp, sz);
                }
                return Some(if moved { 0x4000_0003 } else { OK }); // STATUS_IMAGE_NOT_AT_BASE
            }
            let (file, size, base) = match e.s.fs.handles.get(&a0) {
                Some(Handle::Section { file, size, base }) => (file.clone(), *size, *base),
                _ => return Some(INVALID_HANDLE),
            };
            if off > size {
                return Some(INVALID_PARAMETER);
            }
            let len = if want == 0 { size - off } else { want.min(size - off) };
            let addr = match &file {
                Some(f) => {
                    let Some(a) = e.alloc((len + 0xFFF) & !0xFFF) else { return Some(NO_MEMORY) };
                    let data = e.s.files.read_at(f, off, len).unwrap_or_default();
                    let _ = e.mmu.write_bytes(a, &data);
                    e.s.fs.views.insert(a, (f.clone(), off, len));
                    a
                }
                None if base != 0 => base + off,
                None => {
                    let Some(a) = e.alloc((size + 0xFFF) & !0xFFF) else { return Some(NO_MEMORY) };
                    if let Some(Handle::Section { base, .. }) = e.s.fs.handles.get_mut(&a0) {
                        *base = a;
                    }
                    a + off
                }
            };
            e.w64(bp, addr);
            if vp != 0 {
                e.w64(vp, (len + 0xFFF) & !0xFFF);
            }
            OK
        }
        "NtUnmapViewOfSection" | "NtUnmapViewOfSectionEx" => {
            // a file view: its bytes go back to the file
            let a = e.arg(1);
            if e.s.images.remove(&a).is_some() {
                e.mmu.release_region(a);
                return Some(OK);
            }
            if let Some((f, off, len)) = e.s.fs.views.remove(&a) {
                let mut v = vec![0u8; len as usize];
                if e.mmu.read_bytes(a, &mut v).is_ok() {
                    if let Some(d) = e.s.files.get_mut(&f) {
                        let end = ((off + len) as usize).min(d.len());
                        let o = (off as usize).min(end);
                        if d[o..end] != v[..end - o] {
                            d[o..end].copy_from_slice(&v[..end - o]);
                            e.s.fs.written.insert(f);
                        }
                    }
                }
                e.mmu.release_region(a);
            }
            OK
        }
        "NtOpenSection" => {
            // (handle*, access, attributes): only \KnownDlls32\<dll> (32-bit system DLLs)
            let oa = e.arg(2);
            let nm = e.oa_name(oa);
            let low = nm.to_ascii_lowercase();
            let Some(dll) = low.strip_prefix("\\knowndlls32\\") else { return Some(OBJECT_NAME_NOT_FOUND) };
            let file = format!("wine32-{}", dll);
            if !e.s.files.contains_key(&file) {
                return Some(OBJECT_NAME_NOT_FOUND);
            }
            let h = e.new_handle(Handle::ImageSection { file });
            e.w64(a0, h);
            OK
        }
        "NtQuerySection" => {
            // (section, class, info*, length, return length*)
            let (cls, out, ret) = (e.arg(1), e.arg(2), e.arg(4));
            let (img, size) = match e.s.fs.handles.get(&a0) {
                Some(Handle::ImageSection { file }) => (e.s.files.get(file).cloned(), 0),
                Some(Handle::Section { size, .. }) => (None, *size),
                _ => return Some(INVALID_HANDLE),
            };
            let zero = [0u8; 0x40];
            match (cls, img) {
                (0, img) => {
                    // SECTION_BASIC_INFORMATION
                    let _ = e.mmu.write_bytes(out, &zero[..0x18]);
                    let size = match &img {
                        Some(b) => crate::pe::image_size(b).unwrap_or(0),
                        None => size,
                    };
                    e.w32(out + 8, if img.is_some() { 0x0100_0000 } else { 0x0800_0000 });
                    e.w64(out + 0x10, size);
                    if ret != 0 {
                        e.w64(ret, 0x18);
                    }
                    OK
                }
                (1, Some(b)) => {
                    // SECTION_IMAGE_INFORMATION
                    let Some(i) = crate::pe::image_info(&b) else { return Some(INVALID_IMAGE_FORMAT) };
                    let _ = e.mmu.write_bytes(out, &zero);
                    e.w64(out, i.entry);
                    e.w64(out + 0x10, i.stack_reserve);
                    e.w64(out + 0x18, i.stack_commit);
                    e.w32(out + 0x20, i.subsystem as u32);
                    e.w16(out + 0x24, i.subsys_minor);
                    e.w16(out + 0x26, i.subsys_major);
                    e.w16(out + 0x2C, i.characteristics);
                    e.w16(out + 0x2E, i.dll_characteristics);
                    e.w16(out + 0x30, i.machine);
                    e.w8(out + 0x32, 1);
                    e.w32(out + 0x38, b.len() as u32);
                    if ret != 0 {
                        e.w64(ret, 0x40);
                    }
                    OK
                }
                _ => INVALID_PARAMETER,
            }
        }
        "NtInitializeNlsFiles" | "NtGetNlsSectionPtr" => {
            // Wine's .nls tables (only the 32-bit DLLs ask): mapped read-only copies
            let (file, pp, sp) = if name == "NtInitializeNlsFiles" {
                let lp = e.arg(1);
                if lp != 0 {
                    e.w32(lp, 0x409);
                }
                ("locale.nls".to_string(), a0, e.arg(2))
            } else {
                let id = e.arg(1);
                let f = match a0 {
                    9 => "sortdefault.nls".into(),
                    10 => "l_intl.nls".into(),
                    11 => format!("c_{:03}.nls", id),
                    12 => match id {
                        1 => "normnfc.nls",
                        2 => "normnfd.nls",
                        5 => "normnfkc.nls",
                        6 => "normnfkd.nls",
                        13 => "normidna.nls",
                        _ => "",
                    }
                    .into(),
                    _ => String::new(),
                };
                (f, e.arg(3), e.arg(4))
            };
            let Some(d) = e.s.files.get(&file).cloned() else { return Some(OBJECT_NAME_NOT_FOUND) };
            let Some(a) = e.alloc((d.len() as u64 + 0xFFF) & !0xFFF) else { return Some(NO_MEMORY) };
            let _ = e.mmu.write_bytes(a, &d);
            e.w64(pp, a);
            if sp != 0 {
                e.w64(sp, d.len() as u64);
            }
            OK
        }
        "NtAreMappedFilesTheSame" => NOT_SAME_DEVICE, // STATUS_NOT_SAME_DEVICE: each image is its own
        "NtCreateIoCompletion" => {
            let h = e.new_handle(Handle::Event { set: false, manual: false });
            e.w64(a0, h);
            OK
        }
        "NtSetIoCompletion" | "NtRemoveIoCompletion" | "NtRemoveIoCompletionEx" => NOT_IMPLEMENTED,
        "NtCreateKeyedEvent" | "NtOpenKeyedEvent" => {
            e.w64(a0, 0x7FF4);
            OK
        }
        _ => return e.not_mine(),
    })
}
