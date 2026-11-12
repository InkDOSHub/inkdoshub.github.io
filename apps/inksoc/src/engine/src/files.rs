// Windows file system for programs: one folder, C:\InkSoC\, holding the
// files the page gave the engine (the .exe, its DLLs, data) and the files the
// program creates. Paths are reduced to the file name.

use crate::{pe, Engine, TEB};
use std::collections::HashMap;

pub const DIR: &str = "C:\\InkSoC";
const INVALID: u64 = u64::MAX;
const ATTR_DIR: u32 = 0x10;
const ATTR_NORMAL: u32 = 0x80;
const FIRST_HANDLE: u64 = 0x1000;

pub enum Handle {
    File { name: String, pos: u64 },
    Dir,
    Find { names: Vec<String>, next: usize },
    Event { set: bool },
}

#[derive(Default)]
pub struct Files {
    pub handles: HashMap<u64, Handle>,
    /// files the program created or changed (offered for download)
    pub written: std::collections::BTreeSet<String>,
    next: u64,
}

/// File name (key in the engine's file table) of a Windows path; None for the folder itself.
fn key_of(path: &str) -> Option<String> {
    let p = path.trim_end_matches(['\\', '/']);
    let base = p.rsplit(['\\', '/']).next().unwrap_or(p).to_ascii_lowercase();
    if base.is_empty() || base == "." || base == "inksoc" || base.ends_with(':') || p.is_empty() { None } else { Some(base) }
}

fn wild(p: &[u8], s: &[u8]) -> bool {
    match (p.first(), s.first()) {
        (None, None) => true,
        (Some(b'*'), _) => wild(&p[1..], s) || (!s.is_empty() && wild(p, &s[1..])),
        (Some(b'?'), Some(_)) => wild(&p[1..], &s[1..]),
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b) && wild(&p[1..], &s[1..]),
        _ => false,
    }
}

impl Engine {
    fn set_err(&mut self, v: u32) { let _ = self.mmu.write32(TEB + 0x68, v); }

    pub fn new_handle(&mut self, h: Handle) -> u64 {
        if self.fs.next == 0 { self.fs.next = FIRST_HANDLE; }
        let id = self.fs.next;
        self.fs.next += 4;
        self.fs.handles.insert(id, h);
        id
    }

    fn path_arg(&mut self, i: usize, wide: bool) -> String {
        let a = self.arg(i);
        if wide { self.read_wstr(a, 32768) } else { self.read_cstr(a, 32768) }
    }

    fn put_wstr(&mut self, a: u64, s: &str, max: u64) -> u64 {
        let w: Vec<u16> = s.encode_utf16().collect();
        let k = (w.len() as u64).min(max.saturating_sub(1));
        for i in 0..k { let _ = self.mmu.write16(a + 2 * i, w[i as usize]); }
        let _ = self.mmu.write16(a + 2 * k, 0);
        k
    }

    /// WIN32_FIND_DATAW for one entry.
    fn find_data(&mut self, a: u64, name: &str) {
        for i in 0..592 / 8 { let _ = self.mmu.write64(a + 8 * i, 0); }
        let (attr, size) = match self.files.get(name) { Some(d) => (ATTR_NORMAL, d.len() as u64), None => (ATTR_DIR, 0) };
        let ft = file_time_now();
        let _ = self.mmu.write32(a, attr);
        for o in [4, 12, 20] { let _ = self.mmu.write64(a + o, ft); }
        let _ = self.mmu.write32(a + 28, (size >> 32) as u32);
        let _ = self.mmu.write32(a + 32, size as u32);
        self.put_wstr(a + 44, name, 260);
    }

    fn file_mut(&mut self, h: u64) -> Option<(String, u64)> {
        match self.fs.handles.get(&h) { Some(Handle::File { name, pos }) => Some((name.clone(), *pos)), _ => None }
    }
    fn set_pos(&mut self, h: u64, p: u64) {
        if let Some(Handle::File { pos, .. }) = self.fs.handles.get_mut(&h) { *pos = p; }
    }
}

fn file_time_now() -> u64 { (unsafe { crate::host_epoch_ms() } as u64 + 11_644_473_600_000) * 10_000 }

/// Days since 1601-01-01 -> (year, month, day, weekday).
fn civil(days: i64) -> (i64, u32, u32, u32) {
    let z = days - 134_774 + 719_468; // to days since 1970, then the usual algorithm
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + (m <= 2) as i64;
    (y, m, d, ((days + 1).rem_euclid(7)) as u32)
}

/// (year, month, day) -> days since 1601-01-01.
fn days_from(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468 + 134_774
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    let wide = name.ends_with('W');
    Some(match name {
        "GetCurrentDirectoryW" | "GetCurrentDirectoryA" => {
            let (n, buf) = (a0, e.arg(1));
            if wide { if n <= DIR.len() as u64 { return Some(DIR.len() as u64 + 1); } e.put_wstr(buf, DIR, n) }
            else { let _ = e.mmu.write_bytes(buf, DIR.as_bytes()); let _ = e.mmu.write8(buf + DIR.len() as u64, 0); DIR.len() as u64 }
        }
        "SetCurrentDirectoryW" | "SetCurrentDirectoryA" => 1,
        "GetTempPathW" => { let b = e.arg(1); e.put_wstr(b, "C:\\InkSoC\\", a0) }
        "GetFullPathNameW" => {
            let p = e.path_arg(0, true);
            let full = match key_of(&p) { Some(k) => format!("{}\\{}", DIR, k), None => DIR.to_string() };
            let (n, buf, fp) = (e.arg(1), e.arg(2), e.arg(3));
            if n <= full.encode_utf16().count() as u64 { return Some(full.encode_utf16().count() as u64 + 1); }
            let k = e.put_wstr(buf, &full, n);
            if fp != 0 { let off = full.rfind('\\').map(|i| i + 1).unwrap_or(0) as u64; let _ = e.mmu.write64(fp, buf + 2 * off); }
            k
        }
        "GetLogicalDriveStringsW" => { let b = e.arg(1); let _ = e.put_wstr(b, "C:\\", a0); let _ = e.mmu.write16(b + 8, 0); 4 }
        "GetDiskFreeSpaceExW" => {
            let (f, t, tf) = (e.arg(1), e.arg(2), e.arg(3));
            for p in [f, t, tf] { if p != 0 { let _ = e.mmu.write64(p, 8 << 30); } }
            1
        }
        "GetDiskFreeSpaceW" => {
            let v = [8u32, 512, 2 << 20, 2 << 20];
            for (i, x) in v.iter().enumerate() { let p = e.arg(i + 1); if p != 0 { let _ = e.mmu.write32(p, *x); } }
            1
        }
        "GetFileAttributesW" | "GetFileAttributesA" => {
            let p = e.path_arg(0, wide);
            match key_of(&p) {
                None => ATTR_DIR as u64,
                Some(k) if e.files.contains_key(&k) || e.files.contains_key(&pe::norm(&k)) => ATTR_NORMAL as u64,
                _ => { e.set_err(2); 0xFFFF_FFFF }
            }
        }
        "SetFileAttributesW" | "SetFileTime" | "SetFileAttributesA" => 1,
        "FindFirstFileW" | "FindFirstFileExW" => {
            let p = e.path_arg(0, true);
            let out = e.arg(if name == "FindFirstFileW" { 1 } else { 2 });
            let names: Vec<String> = match key_of(&p) {
                None => vec!["inksoc".into()],
                Some(pat) if pat.contains(['*', '?']) => {
                    let mut v: Vec<String> = e.files.keys().filter(|n| wild(pat.as_bytes(), n.as_bytes())).cloned().collect();
                    v.sort();
                    v
                }
                Some(k) => if e.files.contains_key(&k) { vec![k] } else { vec![] },
            };
            if names.is_empty() { e.set_err(2); return Some(INVALID); }
            let first = names[0].clone();
            e.find_data(out, &first);
            e.new_handle(Handle::Find { names, next: 1 })
        }
        "FindNextFileW" => {
            let out = e.arg(1);
            let n = match e.fs.handles.get_mut(&a0) {
                Some(Handle::Find { names, next }) if *next < names.len() => { *next += 1; names[*next - 1].clone() }
                _ => { e.set_err(18); return Some(0); }
            };
            e.find_data(out, &n);
            1
        }
        "FindClose" => { e.fs.handles.remove(&a0); 1 }
        "FindFirstStreamW" => { e.set_err(38); INVALID }
        "FindNextStreamW" => { e.set_err(38); 0 }
        "CreateFileW" | "CreateFileA" => {
            let p = e.path_arg(0, wide);
            let (access, disp, flags) = (e.arg(1) as u32, e.arg(4) as u32, e.arg(5) as u32);
            let Some(k) = key_of(&p) else {
                if flags & 0x0200_0000 != 0 { return Some(e.new_handle(Handle::Dir)); }
                e.set_err(5); return Some(INVALID);
            };
            let exists = e.files.contains_key(&k);
            match disp {
                1 if exists => { e.set_err(80); return Some(INVALID); }            // CREATE_NEW
                3 | 5 if !exists => { e.set_err(2); return Some(INVALID); }        // OPEN_EXISTING, TRUNCATE_EXISTING
                2 | 5 => { e.files.insert(k.clone(), Vec::new()); e.fs.written.insert(k.clone()); } // CREATE_ALWAYS
                _ => { if !exists { e.files.insert(k.clone(), Vec::new()); e.fs.written.insert(k.clone()); } }
            }
            if disp == 2 || disp == 4 { e.set_err(if exists { 183 } else { 0 }); } else { e.set_err(0); }
            let _ = access;
            e.new_handle(Handle::File { name: k, pos: 0 })
        }
        "CloseHandle" => { e.fs.handles.remove(&a0); 1 }
        "ReadFile" => {
            let (buf, n, done) = (e.arg(1), e.arg(2) as u32 as u64, e.arg(3));
            // no keyboard yet: reading the console fails like a closed pipe
            if a0 == 3 { if done != 0 { let _ = e.mmu.write32(done, 0); } e.set_err(109); return Some(0); }
            let Some((k, pos)) = e.file_mut(a0) else { return None };
            let data = e.files.get(&k).map(|d| { let s = (pos as usize).min(d.len()); d[s..(s + n as usize).min(d.len())].to_vec() }).unwrap_or_default();
            if e.mmu.write_bytes(buf, &data).is_err() { e.fault(buf); }
            e.set_pos(a0, pos + data.len() as u64);
            if done != 0 { let _ = e.mmu.write32(done, data.len() as u32); }
            1
        }
        "WriteFile" => {
            let (buf, n, done) = (e.arg(1), e.arg(2) as u32 as u64, e.arg(3));
            let Some((k, pos)) = e.file_mut(a0) else { return None }; // console: kernel32
            let mut v = vec![0u8; n as usize];
            if e.mmu.read_bytes(buf, &mut v).is_err() { e.fault(buf); }
            e.fs.written.insert(k.clone());
            let d = e.files.entry(k).or_default();
            let end = pos as usize + v.len();
            if d.len() < end { d.resize(end, 0); }
            d[pos as usize..end].copy_from_slice(&v);
            e.set_pos(a0, end as u64);
            if done != 0 { let _ = e.mmu.write32(done, n as u32); }
            1
        }
        "GetFileType" => match e.fs.handles.get(&a0) { Some(_) => 1, None => return None },
        "GetFileSize" | "GetFileSizeEx" => {
            let Some((k, _)) = e.file_mut(a0) else { e.set_err(6); return Some(if name == "GetFileSize" { 0xFFFF_FFFF } else { 0 }) };
            let size = e.files.get(&k).map(|d| d.len() as u64).unwrap_or(0);
            let p = e.arg(1);
            if name == "GetFileSizeEx" { let _ = e.mmu.write64(p, size); 1 }
            else { if p != 0 { let _ = e.mmu.write32(p, (size >> 32) as u32); } size & 0xFFFF_FFFF }
        }
        "SetFilePointer" | "SetFilePointerEx" => {
            let Some((k, pos)) = e.file_mut(a0) else { e.set_err(6); return Some(if name == "SetFilePointer" { 0xFFFF_FFFF } else { 0 }) };
            let size = e.files.get(&k).map(|d| d.len() as i64).unwrap_or(0);
            let (dist, hi_ptr, method) = if name == "SetFilePointer" {
                let hp = e.arg(2);
                let hi = if hp != 0 { e.mmu.read32(hp).unwrap_or(0) as i64 } else { (e.arg(1) as i32 as i64) >> 32 };
                ((hi << 32) | (e.arg(1) as u32 as i64), hp, e.arg(3))
            } else { (e.arg(1) as i64, e.arg(2), e.arg(3)) };
            let base = match method { 1 => pos as i64, 2 => size, _ => 0 };
            let np = (base + dist).max(0) as u64;
            e.set_pos(a0, np);
            if name == "SetFilePointerEx" { if hi_ptr != 0 { let _ = e.mmu.write64(hi_ptr, np); } 1 }
            else { if hi_ptr != 0 { let _ = e.mmu.write32(hi_ptr, (np >> 32) as u32); } e.set_err(0); np & 0xFFFF_FFFF }
        }
        "SetEndOfFile" => {
            let Some((k, pos)) = e.file_mut(a0) else { return Some(0) };
            if let Some(d) = e.files.get_mut(&k) { d.resize(pos as usize, 0); }
            1
        }
        "FlushFileBuffers" => 1,
        "GetFileInformationByHandle" => {
            let out = e.arg(1);
            for i in 0..52 / 4 { let _ = e.mmu.write32(out + 4 * i, 0); }
            let (attr, size) = match e.file_mut(a0) {
                Some((k, _)) => (ATTR_NORMAL, e.files.get(&k).map(|d| d.len() as u64).unwrap_or(0)),
                None => (ATTR_DIR, 0),
            };
            let ft = file_time_now();
            let _ = e.mmu.write32(out, attr);
            for o in [4, 12, 20] { let _ = e.mmu.write64(out + o, ft); }
            let _ = e.mmu.write32(out + 28, 0x1A2B3C4D);
            let _ = e.mmu.write32(out + 32, (size >> 32) as u32);
            let _ = e.mmu.write32(out + 36, size as u32);
            let _ = e.mmu.write32(out + 40, 1);
            let _ = e.mmu.write32(out + 48, a0 as u32);
            1
        }
        "DeleteFileW" | "DeleteFileA" => {
            let p = e.path_arg(0, wide);
            match key_of(&p) { Some(k) if e.files.remove(&k).is_some() => { e.fs.written.remove(&k); 1 } _ => { e.set_err(2); 0 } }
        }
        "CreateDirectoryW" | "CreateDirectoryA" => { e.set_err(183); 0 }
        "RemoveDirectoryW" => 1,
        "MoveFileW" | "MoveFileWithProgressW" | "MoveFileExW" => {
            let (from, to) = (e.path_arg(0, true), e.path_arg(1, true));
            match (key_of(&from), key_of(&to)) {
                (Some(f), Some(t)) => match e.files.remove(&f) { Some(d) => { e.fs.written.remove(&f); e.fs.written.insert(t.clone()); e.files.insert(t, d); 1 } None => { e.set_err(2); 0 } },
                _ => { e.set_err(5); 0 }
            }
        }
        "CreateHardLinkW" => { e.set_err(1); 0 }
        "DeviceIoControl" => { e.set_err(1); 0 }
        // ---- file times ----
        "CompareFileTime" => {
            let (x, y) = (e.mmu.read64(a0).unwrap_or(0), { let b = e.arg(1); e.mmu.read64(b).unwrap_or(0) });
            (x.cmp(&y) as i32) as i64 as u64
        }
        "DosDateTimeToFileTime" => {
            let (dd, tt, out) = (a0 as u32, e.arg(1) as u32, e.arg(2));
            let days = days_from(1980 + (dd >> 9) as i64, (dd >> 5) & 15, dd & 31);
            let secs = days as u64 * 86400 + ((tt >> 11) as u64) * 3600 + (((tt >> 5) & 63) as u64) * 60 + ((tt & 31) * 2) as u64;
            let _ = e.mmu.write64(out, secs * 10_000_000);
            1
        }
        "SystemTimeToFileTime" => {
            let r = |e: &mut Engine, i: u64| e.mmu.read16(a0 + 2 * i).unwrap_or(0) as u64;
            let (y, m, d, hh, mm, ss, ms) = (r(e, 0), r(e, 1), r(e, 3), r(e, 4), r(e, 5), r(e, 6), r(e, 7));
            let days = days_from(y as i64, m as u32, d as u32) as u64;
            let out = e.arg(1);
            let _ = e.mmu.write64(out, ((days * 86400 + hh * 3600 + mm * 60 + ss) * 1000 + ms) * 10_000);
            1
        }
        "LocalFileTimeToFileTime" | "FileTimeToLocalFileTime" => { let v = e.mmu.read64(a0).unwrap_or(0); let o = e.arg(1); let _ = e.mmu.write64(o, v); 1 }
        "FileTimeToSystemTime" | "FileTimeToDosDateTime" => {
            let ft = e.mmu.read64(a0).unwrap_or(0);
            let secs = ft / 10_000_000;
            let (y, m, d, wd) = civil((secs / 86400) as i64);
            let s = secs % 86400;
            let (hh, mm, ss) = ((s / 3600) as u32, (s % 3600 / 60) as u32, (s % 60) as u32);
            if name == "FileTimeToSystemTime" {
                let o = e.arg(1);
                let v = [y as u32, m, wd, d, hh, mm, ss, ((ft / 10_000) % 1000) as u32];
                for (i, x) in v.iter().enumerate() { let _ = e.mmu.write16(o + 2 * i as u64, *x as u16); }
            } else {
                let (pd, pt) = (e.arg(1), e.arg(2));
                let _ = e.mmu.write16(pd, ((((y - 1980).max(0) as u32) << 9) | (m << 5) | d) as u16);
                let _ = e.mmu.write16(pt, ((hh << 11) | (mm << 5) | (ss / 2)) as u16);
            }
            1
        }
        // ---- text conversion (UTF-8 / ASCII) ----
        "MultiByteToWideChar" => {
            let (src, n, dst, max) = (e.arg(2), e.arg(3) as u32 as i32, e.arg(4), e.arg(5) as u32 as u64);
            let bytes = if n < 0 { let mut v = e.read_cstr(src, 1 << 20).into_bytes(); v.push(0); v } else { let mut v = vec![0u8; n as usize]; let _ = e.mmu.read_bytes(src, &mut v); v };
            let w: Vec<u16> = String::from_utf8_lossy(&bytes).encode_utf16().collect();
            if max == 0 { return Some(w.len() as u64); }
            if (w.len() as u64) > max { e.set_err(122); return Some(0); }
            for (i, c) in w.iter().enumerate() { let _ = e.mmu.write16(dst + 2 * i as u64, *c); }
            w.len() as u64
        }
        "WideCharToMultiByte" => {
            let (src, n, dst, max) = (e.arg(2), e.arg(3) as u32 as i32, e.arg(4), e.arg(5) as u32 as u64);
            let mut w = Vec::new();
            let mut i = 0u64;
            loop {
                if n >= 0 && i >= n as u64 { break; }
                let c = e.mmu.read16(src + 2 * i).unwrap_or(0);
                w.push(c);
                i += 1;
                if n < 0 && c == 0 { break; }
            }
            let b = String::from_utf16_lossy(&w).into_bytes();
            if max == 0 { return Some(b.len() as u64); }
            if (b.len() as u64) > max { e.set_err(122); return Some(0); }
            let _ = e.mmu.write_bytes(dst, &b);
            b.len() as u64
        }
        // ---- events (one thread: an event is just a flag) ----
        "CreateEventW" | "CreateEventA" => { let set = e.arg(2) != 0; e.new_handle(Handle::Event { set }) }
        "SetEvent" => { if let Some(Handle::Event { set }) = e.fs.handles.get_mut(&a0) { *set = true; } 1 }
        "ResetEvent" => { if let Some(Handle::Event { set }) = e.fs.handles.get_mut(&a0) { *set = false; } 1 }
        "OpenEventW" | "OpenFileMappingW" => { e.set_err(2); 0 }
        "FormatMessageW" | "FormatMessageA" => {
            // system messages only (FORMAT_MESSAGE_FROM_SYSTEM)
            let (flags, id, buf, size) = (a0 as u32, e.arg(2) as u32 & 0xFFFF, e.arg(4), e.arg(5));
            let text = match id {
                2 => "The system cannot find the file specified.", 3 => "The system cannot find the path specified.",
                5 => "Access is denied.", 8 | 14 => "Not enough memory resources are available to process this command.",
                32 => "The process cannot access the file because it is being used by another process.",
                80 | 183 => "Cannot create a file when that file already exists.", 87 => "The parameter is incorrect.",
                112 => "There is not enough space on the disk.", 1 => "Incorrect function.",
                _ => { e.set_err(317); return Some(0); }
            };
            let text = format!("{}\r\n", text);
            let n = text.encode_utf16().count() as u64;
            let dst = if flags & 0x100 != 0 {
                let p = e.heap_alloc(if wide { 2 * (n + 1) } else { n + 1 }, true);
                let _ = e.mmu.write64(buf, p);
                p
            } else { if size <= n { e.set_err(122); return Some(0); } buf };
            if wide { e.put_wstr(dst, &text, n + 1); } else { let _ = e.mmu.write_bytes(dst, text.as_bytes()); let _ = e.mmu.write8(dst + n, 0); }
            n
        }
        _ => return None,
    })
}

