// Files: open, read, write, information and directories.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- files ----
        "NtReadFile" => {
            let (iosb, buf, n, offp) = (e.arg(4), e.arg(5), e.arg(6) as u32 as u64, e.arg(7));
            if e.is_npipe(a0) {
                let ev = e.arg(1);
                return Some(e.np_read(a0, ev, iosb, buf, n));
            }
            if a0 == 3 || matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) {
                e.iosb(iosb, END_OF_FILE, 0);
                return Some(END_OF_FILE);
            }
            if let Some(id) = e.pipe_id(a0) {
                return Some(match e.pipe_read(a0, buf, n) {
                    Ok(k) => {
                        e.iosb(iosb, OK, k);
                        OK
                    }
                    Err(true) => {
                        e.iosb(iosb, PIPE_BROKEN, 0);
                        PIPE_BROKEN
                    } // STATUS_PIPE_BROKEN
                    Err(false) => e.wait_on(crate::sched::W::Pipe(id), u64::MAX),
                });
            }
            let at = file_offset(e, offp);
            let Some(got) = e.file_read(a0, at, buf, n) else { return Some(INVALID_HANDLE) };
            if got == 0 && n > 0 {
                e.iosb(iosb, END_OF_FILE, 0);
                return Some(END_OF_FILE);
            }
            e.iosb(iosb, OK, got as u64);
            OK
        }
        "NtWriteFile" => {
            let (iosb, buf, n, offp) = (e.arg(4), e.arg(5), e.arg(6) as u32 as u64, e.arg(7));
            if e.is_npipe(a0) {
                let ev = e.arg(1);
                return Some(e.np_write(a0, ev, iosb, buf, n));
            }
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(buf, &mut v).is_err() {
                return Some(INVALID_PARAMETER);
            }
            if a0 == 1 || a0 == 2 {
                crate::console(&String::from_utf8_lossy(&v));
                e.iosb(iosb, OK, n);
                return Some(OK);
            }
            if matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) {
                e.iosb(iosb, OK, n);
                return Some(OK);
            }
            if e.pipe_write(a0, buf, n) {
                e.iosb(iosb, OK, n);
                return Some(OK);
            }
            let at = file_offset(e, offp);
            if !e.file_write(a0, at, &v) {
                return Some(INVALID_HANDLE);
            }
            e.iosb(iosb, OK, n);
            OK
        }
        "NtFlushBuffersFile" | "NtFlushBuffersFileEx" => {
            let p = e.arg(1);
            e.iosb(p, OK, 0);
            OK
        }
        "NtQueryInformationFile" => {
            let (iosb, buf, len, class) = (e.arg(1), e.arg(2), e.arg(3) as u32 as u64, e.arg(4) as u32);
            if let Some((st, n)) = e.np_info(a0, class, buf, len, false) {
                e.iosb(iosb, st, n);
                return Some(st);
            }
            if e.pipe_id(a0).is_some() {
                // pipe: synchronous mode (16), local pipe info (24): connected, byte mode
                let need = match class {
                    8 => 4,
                    16 => 4,
                    24 => 40,
                    5 => 24,
                    4 => 40,
                    _ => return Some(INVALID_INFO_CLASS),
                };
                if len < need {
                    return Some(INFO_LENGTH_MISMATCH);
                }
                e.zero_n(buf, need);
                let wr = matches!(e.s.fs.handles.get(&a0), Some(Handle::Pipe { write: true, .. }));
                match class {
                    8 => {
                        e.w32(buf, if wr { 0x120116 } else { 0x120089 });
                    }
                    16 => {
                        e.w32(buf, 0x20);
                    }
                    24 => {
                        e.w32(buf + 16, 1);
                        e.w32(buf + 20, 4096);
                        e.w32(buf + 24, 4096);
                        e.w32(buf + 32, 3);
                    }
                    5 => {
                        e.w32(buf + 16, 1);
                    }
                    4 => {
                        e.w32(buf + 32, 0x80);
                    }
                    _ => {}
                }
                e.iosb(iosb, OK, need);
                return Some(OK);
            }
            let con = a0 <= 3;
            let (dir, size, pos) = if con {
                (false, 0, 0)
            } else {
                match e.file_info(a0) {
                    Some(x) => x,
                    None => return Some(INVALID_HANDLE),
                }
            };
            let attr: u32 = if dir { 0x10 } else { 0x80 };
            let need = match class {
                4 => 40,
                5 => 24,
                14 => 8,
                35 => 8,
                18 => 104,
                6 => 8,
                7 => 4,
                8 => 4,
                16 => 4,
                34 => 56,
                59 => 24,
                _ => 0,
            };
            if need == 0 {
                return Some(INVALID_INFO_CLASS);
            }
            if len < need {
                return Some(INFO_LENGTH_MISMATCH);
            }
            e.zero_n(buf, need);
            let ft = crate::filetime_now();
            let basic = |e: &mut Engine, b: u64| {
                for o in [0, 8, 16, 24] {
                    e.w64(b + o, ft);
                }
                e.w32(b + 32, attr);
            };
            let std_ = |e: &mut Engine, b: u64| {
                e.w64(b, (size + 4095) & !4095);
                e.w64(b + 8, size);
                e.w32(b + 16, 1);
                e.w8(b + 21, dir as u8);
            };
            match class {
                4 => basic(e, buf),
                5 => std_(e, buf),
                14 => {
                    e.w64(buf, pos);
                }
                35 => {
                    e.w32(buf, attr);
                }
                18 => {
                    basic(e, buf);
                    std_(e, buf + 40);
                    e.w64(buf + 64, a0);
                    e.w64(buf + 80, pos);
                }
                6 => {
                    e.w64(buf, a0);
                }
                8 => {
                    e.w32(buf, 0x12019F);
                }
                34 => {
                    for o in [0, 8, 16, 24] {
                        e.w64(buf + o, ft);
                    }
                    e.w64(buf + 32, (size + 4095) & !4095);
                    e.w64(buf + 40, size);
                    e.w32(buf + 48, attr);
                }
                _ => {}
            }
            e.iosb(iosb, OK, need);
            OK
        }
        "NtSetInformationFile" => {
            let (iosb, buf, class) = (e.arg(1), e.arg(2), e.arg(4) as u32);
            if let Some((st, n)) = {
                let l = e.arg(3) as u32 as u64;
                e.np_info(a0, class, buf, l, true)
            } {
                e.iosb(iosb, st, n);
                return Some(st);
            }
            match class {
                // FileDispositionInformation(Ex): delete when the last handle closes
                13 => {
                    let d = e.r8(buf) != 0;
                    if let Some(p) = e.s.fs.paths.get_mut(&a0) {
                        p.1 = d;
                    }
                }
                64 => {
                    let f = e.r32(buf);
                    if let Some(p) = e.s.fs.paths.get_mut(&a0) {
                        p.1 = f & 1 != 0;
                    }
                }
                // FileRenameInformation(Ex): { replace/flags u32, root u64, name length u32, name }
                10 | 65 => {
                    let n = e.r32(buf + 16) as u64 / 2;
                    let v: Vec<u16> = (0..n).map(|i| e.r16(buf + 20 + 2 * i)).collect();
                    let to = String::from_utf16_lossy(&v);
                    let replace = e.r8(buf) != 0 || (class == 65 && e.r32(buf) & 1 != 0);
                    let (Some((from, _)), Some(tk)) = (e.s.fs.paths.get(&a0).cloned(), crate::files::key_of(&to)) else {
                        e.iosb(iosb, OK, 0);
                        return Some(OK);
                    };
                    if from == tk {
                        e.iosb(iosb, OK, 0);
                        return Some(OK);
                    }
                    if (e.s.files.contains_key(&tk) || e.is_dir(&tk)) && !replace {
                        return Some(OBJECT_NAME_COLLISION);
                    } // OBJECT_NAME_COLLISION
                    if let Some(d) = e.s.files.remove(&from) {
                        e.s.fs.written.remove(&from);
                        e.s.files.insert(tk.clone(), d);
                        e.s.fs.written.insert(tk.clone());
                        e.note_case(&tk, &to);
                        if let Some(Handle::File { name, .. }) = e.s.fs.handles.get_mut(&a0) {
                            *name = tk.clone();
                        }
                    } else if e.s.fs.dirs.remove(&from) {
                        // a folder: everything under it moves too
                        let pre = from.clone() + "\\";
                        let fs: Vec<String> = e.s.files.keys().filter(|f| f.starts_with(&pre)).cloned().collect();
                        for f in fs {
                            let d = e.s.files.remove(&f).unwrap();
                            let nk = format!("{}{}", tk, &f[from.len()..]);
                            e.s.fs.written.remove(&f);
                            e.s.fs.written.insert(nk.clone());
                            e.s.files.insert(nk, d);
                        }
                        let ds: Vec<String> = e.s.fs.dirs.iter().filter(|f| f.starts_with(&pre)).cloned().collect();
                        for f in ds {
                            e.s.fs.dirs.remove(&f);
                            e.s.fs.dirs.insert(format!("{}{}", tk, &f[from.len()..]));
                        }
                        e.s.fs.dirs.insert(tk.clone());
                        e.note_case(&tk, &to);
                    }
                    if let Some(p) = e.s.fs.paths.get_mut(&a0) {
                        p.0 = tk;
                    }
                }
                14 => {
                    let p = e.r64(buf);
                    if let Some(Handle::File { pos, .. }) = e.s.fs.handles.get_mut(&a0) {
                        *pos = p;
                    }
                }
                20 | 19 => {
                    // end of file / allocation
                    let n = e.r64(buf) as usize;
                    if let Some(Handle::File { name, .. }) = e.s.fs.handles.get(&a0) {
                        let k = name.clone();
                        if let Some(d) = e.s.files.get_mut(&k) {
                            d.resize(n, 0);
                        }
                        e.s.fs.written.insert(k);
                    }
                }
                _ => {}
            }
            e.iosb(iosb, OK, 0);
            OK
        }
        "NtQueryVolumeInformationFile" => {
            let (iosb, buf, len, class) = (e.arg(1), e.arg(2), e.arg(3) as u32 as u64, e.arg(4) as u32);
            match class {
                4 => {
                    if len < 8 {
                        return Some(INFO_LENGTH_MISMATCH);
                    }
                    e.w32(buf, if a0 <= 3 { 0x50 } else { 7 });
                    e.w32(buf + 4, 0);
                    e.iosb(iosb, OK, 8);
                    OK
                }
                1 => {
                    e.zero_n(buf, len.min(24));
                    e.iosb(iosb, OK, len.min(24));
                    OK
                }
                5 => {
                    // FileFsAttributeInformation: NTFS-like
                    if len < 20 {
                        return Some(BUFFER_TOO_SMALL);
                    }
                    e.w32(buf, 0x0000_00FF);
                    e.w32(buf + 4, 255);
                    e.w32(buf + 8, 8);
                    for (i, c) in "NTFS".encode_utf16().enumerate() {
                        e.w16(buf + 12 + 2 * i as u64, c);
                    }
                    e.iosb(iosb, OK, 20);
                    OK
                }
                3 | 7 => {
                    e.zero_n(buf, len.min(32));
                    e.w64(buf, 1 << 24);
                    e.w64(buf + 8, 1 << 23);
                    e.w32(buf + 16, 8);
                    e.w32(buf + 20, 512);
                    e.iosb(iosb, OK, 24);
                    OK
                }
                _ => INVALID_INFO_CLASS,
            }
        }
        "NtQueryAttributesFile" | "NtQueryFullAttributesFile" => {
            let nm = e.oa_name(a0);
            let out = e.arg(1);
            let found = match crate::files::key_of(&nm) {
                None => Some((0x10u32, 0u64)),
                Some(k) => {
                    if e.is_dir(&k) {
                        Some((0x10u32, 0u64))
                    } else {
                        e.s.files.size(&k).map(|d| (0x80u32, d))
                    }
                }
            };
            match found {
                Some((attr, size)) => {
                    let ft = crate::filetime_now();
                    for o in [0, 8, 16, 24] {
                        e.w64(out + o, ft);
                    }
                    if name == "NtQueryAttributesFile" {
                        e.w32(out + 32, attr);
                    } else {
                        e.w64(out + 32, (size + 4095) & !4095);
                        e.w64(out + 40, size);
                        e.w32(out + 48, attr);
                    }
                    OK
                }
                None => OBJECT_NAME_NOT_FOUND,
            }
        }
        "NtCreateFile" | "NtOpenFile" => {
            // (handle*, access, attributes, iosb, [alloc size, file attributes, share, disposition, options])
            let oa = e.arg(2);
            let nm = e.oa_name(oa);
            let iosb = e.arg(3);
            let disp = if name == "NtCreateFile" { e.arg(7) as u32 } else { 1 }; // FILE_OPEN
            if nm.len() >= 11 && nm[..11].eq_ignore_ascii_case("\\Device\\Afd") {
                let h = e.afd_open();
                e.w64(a0, h);
                e.iosb(iosb, OK, 1);
                return Some(OK);
            }
            // a named pipe: the client end of a free instance (\??\pipe\ alone = the pipe device)
            if let Some(pn) = crate::npipe::pipe_name(&nm) {
                if pn.is_empty() {
                    let h = e.new_handle(Handle::Dir);
                    e.w64(a0, h);
                    e.iosb(iosb, OK, 1);
                    return Some(OK);
                }
                let opts = if name == "NtCreateFile" { e.arg(8) as u32 } else { e.arg(5) as u32 };
                return Some(match e.np_connect(&pn, opts & 0x30 != 0) {
                    Ok(h) => {
                        e.w64(a0, h);
                        e.iosb(iosb, OK, 1);
                        OK
                    }
                    Err(st) => st,
                });
            }
            let kk = crate::files::key_of(&nm);
            let k = kk.clone().unwrap_or_default();
            if kk.is_none() || k == "??" {
                let h = e.new_handle(Handle::Dir);
                e.w64(a0, h);
                e.iosb(iosb, OK, 1);
                return Some(OK);
            }
            if k == "conin$" {
                e.w64(a0, 3);
                e.iosb(iosb, OK, 1);
                return Some(OK);
            }
            if nm.starts_with("\\??\\CON") || nm.eq_ignore_ascii_case("CONOUT$") {
                e.w64(a0, 1);
                e.iosb(iosb, OK, 1);
                return Some(OK);
            }
            if k == "nul" {
                let h = e.new_handle(Handle::Null);
                e.w64(a0, h);
                e.iosb(iosb, OK, 1);
                return Some(OK);
            }
            let opts = if name == "NtCreateFile" { e.arg(8) as u32 } else { e.arg(5) as u32 };
            let is_dir = e.is_dir(&k);
            if is_dir || opts & 1 != 0 {
                // FILE_DIRECTORY_FILE
                if !is_dir && matches!(disp, 2 | 3) && !e.s.files.contains_key(&k) {
                    e.note_case(&k, &nm);
                    e.s.fs.dirs.insert(k.clone());
                } else if !is_dir {
                    return Some(OBJECT_NAME_NOT_FOUND);
                } else if disp == 2 {
                    return Some(OBJECT_NAME_COLLISION);
                }
                let h = e.new_handle(Handle::Dir);
                e.w64(a0, h);
                e.iosb(iosb, OK, if is_dir { 1 } else { 2 });
                e.s.fs.paths.insert(h, (k.clone(), opts & 0x1000 != 0));
                return Some(OK);
            }
            let exists = e.s.files.contains_key(&k);
            // FILE_SUPERSEDE 0, OPEN 1, CREATE 2, OPEN_IF 3, OVERWRITE 4, OVERWRITE_IF 5
            match disp {
                1 | 4 if !exists => return Some(OBJECT_NAME_NOT_FOUND),
                2 if exists => return Some(OBJECT_NAME_COLLISION), // OBJECT_NAME_COLLISION
                _ => {}
            }
            if !exists || matches!(disp, 0 | 4 | 5) {
                e.s.files.insert(k.clone(), Vec::new());
                e.s.fs.written.insert(k.clone());
                e.note_case(&k, &nm);
            }
            let h = e.new_handle(Handle::File { name: k.clone(), pos: 0 });
            e.s.fs.paths.insert(h, (k, opts & 0x1000 != 0)); // FILE_DELETE_ON_CLOSE
            e.w64(a0, h);
            e.iosb(iosb, OK, if exists { 1 } else { 2 });
            OK
        }
        "NtDeleteFile" => {
            let nm = e.oa_name(a0);
            let k = crate::files::key_of(&nm).unwrap_or_default();
            if e.s.files.remove(&k).is_some() {
                e.s.fs.written.remove(&k);
                OK
            } else {
                OBJECT_NAME_NOT_FOUND
            }
        }
        "NtQueryDirectoryFile" | "NtQueryDirectoryFileEx" => NO_MORE_FILES, // STATUS_NO_MORE_FILES
        "NtDeviceIoControlFile" | "NtFsControlFile" => {
            if name == "NtFsControlFile" {
                let (ev, iosb, code, inp, inl, out, outl) =
                    (e.arg(1), e.arg(4), e.arg(5) as u32, e.arg(6), e.arg(7) as u32 as u64, e.arg(8), e.arg(9) as u32 as u64);
                if let Some(r) = e.np_fsctl(a0, ev, iosb, code, inp, inl, out, outl) {
                    return Some(r);
                }
            }
            // sockets (see net.rs)
            if name == "NtDeviceIoControlFile" {
                if let Some(r) = e.afd_ioctl(a0) {
                    return Some(r);
                }
            }
            INVALID_DEVICE_REQUEST // STATUS_INVALID_DEVICE_REQUEST
        }
        "NtCancelIoFile" | "NtCancelIoFileEx" | "NtCancelSynchronousIoFile" => {
            let p = if name == "NtCancelIoFileEx" { e.arg(2) } else { e.arg(1) };
            if e.is_npipe(a0) {
                let any = e.np_cancel(Some(a0), None, CANCELLED);
                e.iosb(p, OK, 0);
                return Some(if any || name != "NtCancelIoFileEx" { OK } else { NOT_FOUND });
            } // NOT_FOUND
            e.iosb(p, OK, 0);
            OK
        }
        "NtCreateNamedPipeFile" => {
            // (handle*, access, attributes, iosb, share, disposition, options, type, read mode, completion, max instances, ...)
            let nm = {
                let oa = e.arg(2);
                e.oa_name(oa)
            };
            let Some(pn) = crate::npipe::pipe_name(&nm).filter(|n| !n.is_empty()) else { return Some(OBJECT_NAME_INVALID) }; // OBJECT_NAME_INVALID
            let (iosb, opts, ty, rm) = (e.arg(3), e.arg(6) as u32, e.arg(7) as u32, e.arg(8) as u32);
            let h = e.np_create(&pn, ty & 1 != 0, rm & 1 != 0, opts & 0x30 != 0);
            e.w64(a0, h);
            e.iosb(iosb, OK, 2); // FILE_CREATED
            OK
        }
        "NtCreateMailslotFile" => NOT_IMPLEMENTED,
        _ => return e.not_mine(),
    })
}
