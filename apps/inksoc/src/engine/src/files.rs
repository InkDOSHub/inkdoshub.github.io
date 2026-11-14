// Windows file system for programs: one folder, C:\InkSoC\, holding the
// files the page gave the engine (the .exe, its DLLs, data) and the files the
// program creates. Paths are reduced to the file name.

use crate::{pe, Engine};
use std::collections::HashMap;

const INVALID: u64 = u64::MAX;
const ATTR_DIR: u32 = 0x10;
const ATTR_NORMAL: u32 = 0x80;
const FIRST_HANDLE: u64 = 0x1000;

pub enum Handle {
    File {
        name: String,
        pos: u64,
    },
    Dir,
    Find {
        names: Vec<String>,
        next: usize,
    },
    Event {
        set: bool,
        manual: bool,
    },
    Mutex {
        owner: u32,
        count: u32,
    },
    Semaphore {
        count: i32,
        max: i32,
    },
    /// waitable timer: signaled from `due` (host ms) on
    Timer {
        due: f64,
        manual: bool,
        period: f64,
    },
    Thread {
        tid: u32,
    },
    /// the NUL device: reads end at once, writes vanish
    Null,
    /// I/O completion port: queued packets (key, apc context, status, information)
    Port {
        q: std::collections::VecDeque<[u64; 4]>,
    },
    /// one end of an anonymous pipe (`Files::pipes`)
    Pipe {
        id: u64,
        write: bool,
    },
    /// a section (file mapping): a file's contents or plain shared memory (`base` once mapped)
    Section {
        file: Option<String>,
        size: u64,
        base: u64,
    },
    /// SEC_IMAGE section of a PE file (mapped as an image)
    ImageSection {
        file: String,
    },
    /// a Windows child process
    Process {
        pid: u32,
    },
    /// a socket (\\Device\\Afd): it can be made, not used yet (no network)
    Afd,
    /// a registry key (`registry.rs`), by its full lowercase path
    Key {
        path: String,
    },
    /// one end of a named pipe instance (`Files::npipes`); sync = synchronous I/O
    NPipe {
        id: u64,
        server: bool,
        sync: bool,
    },
}

/// Anonymous pipe: bytes in flight and how many write ends are open.
#[derive(Default)]
pub struct Pipe {
    pub buf: std::collections::VecDeque<u8>,
    pub writers: u32,
}

#[derive(Default)]
pub struct Files {
    pub handles: HashMap<u64, Handle>,
    /// files the program created or changed (offered for download)
    pub written: std::collections::BTreeSet<String>,
    /// folders the program made (by name, like files)
    pub dirs: std::collections::BTreeSet<String>,
    next: u64,
    pub pipes: HashMap<u64, Pipe>,
    /// named pipe instances, and overlapped pipe I/O still waiting
    pub npipes: HashMap<u64, crate::npipe::NPipe>,
    pub npend: Vec<crate::npipe::Pend>,
    pub np_next: u64,
    /// bytes moved by the last finished named pipe read or write
    pub np_last: u64,
    /// handles whose transceive already wrote its request (the read is re-run)
    pub np_tx: std::collections::HashSet<u64>,
    /// CryptoAPI hashes: algorithm and the data hashed so far
    pub hashes: HashMap<u64, (u32, Vec<u8>)>,
    pub hash_next: u64,
    /// extra references made by DuplicateHandle (closed only when this reaches 0)
    pub refs: HashMap<u64, u32>,
    /// mapped views of files: base -> (file, offset, length); written back when unmapped
    pub views: HashMap<u64, (String, u64, u64)>,
    /// file and folder handles by name (key), and whether each is deleted when closed
    pub paths: HashMap<u64, (String, bool)>,
    /// named events, mutexes and semaphores (lowercase name -> handle)
    pub named: HashMap<String, u64>,
    /// the registry (in memory)
    pub reg: crate::registry::Registry,
    /// files that came from the saved drive C: (to notice the ones a program deletes)
    pub drive: std::collections::BTreeSet<String>,
}

/// The program's home folder (lowercase parts, default C:\InkSoC): files there are keyed
/// by their path under it, like the files handed to the engine. Set once before the start.
static mut HOME: Vec<String> = Vec::new();
/// The home folder as a Windows path ("C:\InkSoC" unless an installed program runs from its own folder).
static mut HOME_WIN: String = String::new();

#[allow(static_mut_refs)]
pub fn set_home(win: &str) {
    let w = win.trim_end_matches('\\').replace('/', "\\");
    unsafe {
        HOME = w.get(2..).unwrap_or("").split('\\').filter(|c| !c.is_empty()).map(|c| c.to_ascii_lowercase()).collect();
        HOME_WIN = w;
    }
}
#[allow(static_mut_refs)]
pub fn home_win() -> String {
    unsafe {
        if HOME_WIN.is_empty() {
            "C:\\InkSoC".into()
        } else {
            HOME_WIN.clone()
        }
    }
}
#[allow(static_mut_refs)]
fn home_parts() -> Vec<String> {
    unsafe {
        if HOME.is_empty() {
            vec!["inksoc".into()]
        } else {
            HOME.clone()
        }
    }
}

/// A Windows path as the file table names it, keeping its case ('\\'-separated, "." and ".."
/// resolved): under the home folder (C:\InkSoC by default) the path below it; elsewhere on
/// the drive the whole path with its "C:\\" (C:\Program Files\...); a path in C:\Windows
/// reduces to its file name (Wine's DLLs and data are stored that way).
/// None = the home folder itself.
pub fn case_of(path: &str) -> Option<String> {
    let mut p = path.replace('/', "\\");
    for pre in ["\\??\\", "\\\\?\\", "\\\\.\\"] {
        if let Some(r) = p.strip_prefix(pre) {
            p = r.to_string();
        }
    }
    let abs = p.len() >= 2 && p.as_bytes()[1] == b':';
    if abs {
        p = p[2..].to_string();
    }
    let rooted = abs || p.starts_with('\\');
    let mut parts: Vec<&str> = Vec::new();
    for c in p.split('\\') {
        match c {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(c),
        }
    }
    if rooted {
        let home = home_parts();
        if parts.len() >= home.len() && parts.iter().zip(home.iter()).all(|(a, b)| a.eq_ignore_ascii_case(b)) {
            parts.drain(..home.len());
        } else if parts.len() >= 2 && parts[parts.len() - 2].eq_ignore_ascii_case("syswow64") {
            // 32-bit system DLLs are stored as wine32-<name>
            return Some(format!("wine32-{}", parts[parts.len() - 1]));
        }
        // (Windows Installer keeps its own copies of packages in C:\Windows\Installer: real files)
        else if parts.first().map_or(false, |c| c.eq_ignore_ascii_case("windows"))
            && !parts.get(1).map_or(false, |c| c.eq_ignore_ascii_case("installer") && parts.len() > 2)
        {
            let last = parts[parts.len() - 1];
            parts = vec![last];
        } else if !parts.is_empty() {
            return Some(format!("C:\\{}", parts.join("\\")));
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\\"))
    }
}
/// The Windows path of a file table key (the reverse of `case_of`, case as noted).
pub fn win_path(cased: &str) -> String {
    if cased.len() >= 3 && cased[..3].eq_ignore_ascii_case("c:\\") {
        format!("C:{}", &cased[2..])
    } else {
        format!("{}\\{}", home_win(), cased)
    }
}
/// File table key of a path (lowercase `case_of`).
pub fn key_of(path: &str) -> Option<String> {
    case_of(path).map(|s| s.to_ascii_lowercase())
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
    pub fn new_handle(&mut self, h: Handle) -> u64 {
        if self.s.fs.next == 0 {
            self.s.fs.next = FIRST_HANDLE;
        }
        let id = self.s.fs.next;
        self.s.fs.next += 4;
        self.s.fs.handles.insert(id, h);
        id
    }

    /// CloseHandle/NtClose: drops one reference; the object goes with the last one.
    pub fn close_handle(&mut self, h: u64) -> bool {
        if let Some(n) = self.s.fs.refs.get_mut(&h) {
            *n -= 1;
            if *n == 0 {
                self.s.fs.refs.remove(&h);
            }
            return true;
        }
        // FILE_DELETE_ON_CLOSE / FileDispositionInformation: the file or empty folder goes away now
        if let Some((k, true)) = self.s.fs.paths.remove(&h) {
            if self.s.files.remove(&k).is_some() {
                self.s.fs.written.remove(&k);
            } else {
                self.s.fs.dirs.remove(&k);
            }
        }
        match self.s.fs.handles.remove(&h) {
            Some(Handle::Pipe { id, write }) => {
                if let Some(p) = self.s.fs.pipes.get_mut(&id) {
                    if write {
                        p.writers -= 1;
                    }
                }
                if !write
                    || self.s.fs.pipes.get(&id).map_or(false, |p| p.writers == 0)
                        && !self.s.fs.handles.values().any(|x| matches!(x, Handle::Pipe { id: i, .. } if *i == id))
                {
                    self.s.fs.pipes.remove(&id);
                }
                true
            }
            Some(Handle::File { name, .. }) => {
                // the last handle of a file: its bytes may leave memory (see Store::release)
                let held = self.s.fs.handles.values().any(|x| matches!(x, Handle::File { name: n, .. } if *n == name))
                    || self.s.fs.views.values().any(|v| v.0 == name)
                    || self.s.fs.handles.values().any(|x| matches!(x, Handle::Section { file: Some(f), .. } if *f == name));
                if !held {
                    self.s.files.release(&name);
                }
                true
            }
            Some(Handle::NPipe { id, server, .. }) => {
                self.s.fs.np_tx.remove(&h);
                self.np_cancel(Some(h), None, crate::status::CANCELLED);
                self.np_close(id, server);
                true
            }
            Some(_) => true,
            None => false,
        }
    }
    /// DuplicateHandle: the same handle, one more reference.
    pub fn dup_handle(&mut self, h: u64) -> u64 {
        if self.s.fs.handles.contains_key(&h) {
            *self.s.fs.refs.entry(h).or_insert(0) += 1;
        }
        h
    }
    pub fn new_pipe(&mut self) -> (u64, u64) {
        let id = self.s.fs.next + 1;
        self.s.fs.pipes.insert(id, Pipe { buf: Default::default(), writers: 1 });
        (self.new_handle(Handle::Pipe { id, write: false }), self.new_handle(Handle::Pipe { id, write: true }))
    }
    /// Reads a pipe: Ok(bytes), Err(true) when every write end is closed, Err(false) when it must wait.
    pub fn pipe_read(&mut self, h: u64, buf: u64, n: u64) -> Result<u64, bool> {
        let Some(Handle::Pipe { id, .. }) = self.s.fs.handles.get(&h) else { return Err(true) };
        let id = *id;
        let Some(p) = self.s.fs.pipes.get_mut(&id) else { return Err(true) };
        if p.buf.is_empty() {
            return Err(p.writers == 0);
        }
        let k = (n as usize).min(p.buf.len());
        let v: Vec<u8> = p.buf.drain(..k).collect();
        if self.mmu.write_bytes(buf, &v).is_err() {
            self.fault(buf);
        }
        Ok(k as u64)
    }
    pub fn pipe_write(&mut self, h: u64, buf: u64, n: u64) -> bool {
        let Some(Handle::Pipe { id, .. }) = self.s.fs.handles.get(&h) else { return false };
        let id = *id;
        let mut v = vec![0u8; n as usize];
        if self.mmu.read_bytes(buf, &mut v).is_err() {
            self.fault(buf);
        }
        if let Some(p) = self.s.fs.pipes.get_mut(&id) {
            p.buf.extend(v);
        }
        true
    }
    pub fn pipe_id(&self, h: u64) -> Option<u64> {
        match self.s.fs.handles.get(&h) {
            Some(Handle::Pipe { id, .. }) => Some(*id),
            _ => None,
        }
    }

    fn path_arg(&mut self, i: usize, wide: bool) -> String {
        let a = self.arg(i);
        if wide {
            self.read_wstr(a, 32768)
        } else {
            self.read_cstr(a, 32768)
        }
    }

    fn put_wstr(&mut self, a: u64, s: &str, max: u64) -> u64 {
        let w: Vec<u16> = s.encode_utf16().collect();
        let k = (w.len() as u64).min(max.saturating_sub(1));
        for i in 0..k {
            self.w16(a + 2 * i, w[i as usize]);
        }
        self.w16(a + 2 * k, 0);
        k
    }

    /// WIN32_FIND_DATAW for one entry.
    /// A folder: made by the program, or holding files.
    pub fn is_dir(&self, k: &str) -> bool {
        if self.s.fs.dirs.contains(k) {
            return true;
        }
        let pre = format!("{}\\", k);
        self.s.files.keys().any(|f| f.starts_with(&pre)) || self.s.fs.dirs.iter().any(|d| d.starts_with(&pre))
    }
    /// The file or folder name of a key, with the case it was created with.
    pub fn shown(&self, k: &str) -> String {
        let depth = k.matches('\\').count();
        let pre = format!("{}\\", k);
        let full = self.s.names.get(k).cloned().or_else(|| self.s.names.iter().find(|(f, _)| f.starts_with(&pre)).map(|(_, v)| v.clone()));
        match full {
            Some(f) if f.matches('\\').count() >= depth => f.split('\\').nth(depth).unwrap_or(k).to_string(),
            _ => k.rsplit('\\').next().unwrap_or(k).to_string(),
        }
    }
    /// Keys of what a folder holds ("" = C:\InkSoC).
    pub fn list_dir(&self, dir: &str) -> Vec<String> {
        let pre = if dir.is_empty() { String::new() } else { format!("{}\\", dir) };
        let mut v: Vec<String> = self
            .s
            .files
            .keys()
            .chain(self.s.fs.dirs.iter())
            .filter_map(|f| f.strip_prefix(&pre).map(|r| format!("{}{}", pre, r.split('\\').next().unwrap_or(r))))
            .collect();
        v.sort();
        v.dedup();
        v
    }
    pub fn note_case(&mut self, k: &str, path: &str) {
        if let Some(c) = case_of(path) {
            if c.to_ascii_lowercase() == k {
                self.s.names.insert(k.to_string(), c);
            }
        }
    }

    fn find_data(&mut self, a: u64, name: &str) {
        for i in 0..592 / 8 {
            self.w64(a + 8 * i, 0);
        }
        let (attr, size) = match self.s.files.size(name) {
            Some(d) => (ATTR_NORMAL, d),
            None => (ATTR_DIR, 0),
        };
        let name = &self.shown(name);
        let ft = crate::filetime_now();
        self.w32(a, attr);
        for o in [4, 12, 20] {
            self.w64(a + o, ft);
        }
        self.w32(a + 28, (size >> 32) as u32);
        self.w32(a + 32, size as u32);
        self.put_wstr(a + 44, name, 260);
    }

    fn file_mut(&mut self, h: u64) -> Option<(String, u64)> {
        match self.s.fs.handles.get(&h) {
            Some(Handle::File { name, pos }) => Some((name.clone(), *pos)),
            _ => None,
        }
    }
    fn set_pos(&mut self, h: u64, p: u64) {
        if let Some(Handle::File { pos, .. }) = self.s.fs.handles.get_mut(&h) {
            *pos = p;
        }
    }

    /// Reads up to `n` bytes of an open disk file into guest memory, at `at` or at the
    /// handle's position, and moves the position past them. None: `h` is not a disk file.
    pub(crate) fn file_read(&mut self, h: u64, at: Option<u64>, buf: u64, n: u64) -> Option<usize> {
        let (k, pos) = self.file_mut(h)?;
        let pos = at.unwrap_or(pos);
        let data = self.s.files.read_at(&k, pos, n).unwrap_or_default();
        if self.mmu.write_bytes(buf, &data).is_err() {
            self.fault(buf);
        }
        self.set_pos(h, pos + data.len() as u64);
        Some(data.len())
    }

    /// Writes `v` to an open disk file, at `at` or at the handle's position, growing the
    /// file as needed. False: `h` is not a disk file.
    pub(crate) fn file_write(&mut self, h: u64, at: Option<u64>, v: &[u8]) -> bool {
        let Some((k, pos)) = self.file_mut(h) else { return false };
        let pos = at.unwrap_or(pos) as usize;
        if !k.starts_with('|') {
            self.s.fs.written.insert(k.clone());
        }
        let d = self.s.files.entry_or_default(k);
        let end = pos + v.len();
        if d.len() < end {
            d.resize(end, 0);
        }
        d[pos..end].copy_from_slice(v);
        self.set_pos(h, end as u64);
        true
    }
}

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
            let dir = home_win();
            if wide {
                if n <= dir.len() as u64 {
                    return Some(dir.len() as u64 + 1);
                }
                e.put_wstr(buf, &dir, n)
            } else {
                let _ = e.mmu.write_bytes(buf, dir.as_bytes());
                e.w8(buf + dir.len() as u64, 0);
                dir.len() as u64
            }
        }
        "SetCurrentDirectoryW" | "SetCurrentDirectoryA" => 1,
        "GetTempPathW" => {
            let b = e.arg(1);
            e.put_wstr(b, "C:\\InkSoC\\", a0)
        }
        "GetFullPathNameW" => {
            let p = e.path_arg(0, true);
            let full = match case_of(&p) {
                Some(k) => win_path(&k),
                None => home_win(),
            };
            let (n, buf, fp) = (e.arg(1), e.arg(2), e.arg(3));
            if n <= full.encode_utf16().count() as u64 {
                return Some(full.encode_utf16().count() as u64 + 1);
            }
            let k = e.put_wstr(buf, &full, n);
            if fp != 0 {
                let off = full.rfind('\\').map(|i| i + 1).unwrap_or(0) as u64;
                e.w64(fp, buf + 2 * off);
            }
            k
        }
        "GetLogicalDriveStringsW" => {
            let b = e.arg(1);
            let _ = e.put_wstr(b, "C:\\", a0);
            e.w16(b + 8, 0);
            4
        }
        "GetDiskFreeSpaceExW" => {
            let (f, t, tf) = (e.arg(1), e.arg(2), e.arg(3));
            for p in [f, t, tf] {
                if p != 0 {
                    e.w64(p, 8 << 30);
                }
            }
            1
        }
        "GetDiskFreeSpaceW" => {
            let v = [8u32, 512, 2 << 20, 2 << 20];
            for (i, x) in v.iter().enumerate() {
                let p = e.arg(i + 1);
                if p != 0 {
                    e.w32(p, *x);
                }
            }
            1
        }
        "GetFileAttributesW" | "GetFileAttributesA" => {
            let p = e.path_arg(0, wide);
            match key_of(&p) {
                None => ATTR_DIR as u64,
                Some(k) if e.is_dir(&k) => ATTR_DIR as u64,
                Some(k) if e.s.files.contains_key(&k) || e.s.files.contains_key(&pe::norm(&k)) => ATTR_NORMAL as u64,
                _ => {
                    e.set_last_error(2);
                    0xFFFF_FFFF
                }
            }
        }
        "GetFileAttributesExW" | "GetFileAttributesExA" => {
            // WIN32_FILE_ATTRIBUTE_DATA: attributes, 3 file times, size high/low
            let p = e.path_arg(0, name.ends_with("ExW"));
            let out = e.arg(2);
            let found = match key_of(&p) {
                None => Some((ATTR_DIR, 0u64)),
                Some(k) if e.is_dir(&k) => Some((ATTR_DIR, 0u64)),
                Some(k) => e.s.files.size(&k).or_else(|| e.s.files.size(&pe::norm(&k))).map(|d| (ATTR_NORMAL, d)),
            };
            match found {
                Some((attr, size)) => {
                    let ft = crate::filetime_now();
                    e.w32(out, attr);
                    for o in [4, 12, 20] {
                        e.w64(out + o, ft);
                    }
                    e.w32(out + 28, (size >> 32) as u32);
                    e.w32(out + 32, size as u32);
                    1
                }
                None => {
                    e.set_last_error(2);
                    0
                }
            }
        }
        "SetFileAttributesW" | "SetFileTime" | "SetFileAttributesA" => 1,
        "FindFirstFileW" | "FindFirstFileExW" => {
            let p = e.path_arg(0, true);
            let out = e.arg(if name == "FindFirstFileW" { 1 } else { 2 });
            let names: Vec<String> = match key_of(&p) {
                None => vec!["inksoc".into()],
                Some(k) => {
                    let (dir, pat) = match k.rfind('\\') {
                        Some(i) => (k[..i].to_string(), k[i + 1..].to_string()),
                        None => (String::new(), k.clone()),
                    };
                    if pat.contains(['*', '?']) {
                        let all = pat == "*" || pat == "*.*";
                        let mut v: Vec<String> = e
                            .list_dir(&dir)
                            .into_iter()
                            .filter(|n| all || wild(pat.as_bytes(), n.rsplit('\\').next().unwrap_or(n).as_bytes()))
                            .collect();
                        if !dir.is_empty() && all {
                            v.insert(0, format!("{}\\..", dir));
                            v.insert(0, format!("{}\\.", dir));
                        }
                        v
                    } else if e.s.files.contains_key(&k) || e.is_dir(&k) {
                        vec![k]
                    } else {
                        vec![]
                    }
                }
            };
            if names.is_empty() {
                e.set_last_error(2);
                return Some(INVALID);
            }
            let first = names[0].clone();
            e.find_data(out, &first);
            e.new_handle(Handle::Find { names, next: 1 })
        }
        "FindNextFileW" => {
            let out = e.arg(1);
            let n = match e.s.fs.handles.get_mut(&a0) {
                Some(Handle::Find { names, next }) if *next < names.len() => {
                    *next += 1;
                    names[*next - 1].clone()
                }
                _ => {
                    e.set_last_error(18);
                    return Some(0);
                }
            };
            e.find_data(out, &n);
            1
        }
        "FindClose" => {
            e.s.fs.handles.remove(&a0);
            1
        }
        "FindFirstStreamW" => {
            e.set_last_error(38);
            INVALID
        }
        "FindNextStreamW" => {
            e.set_last_error(38);
            0
        }
        "CreateFileW" | "CreateFileA" => {
            let p = e.path_arg(0, wide);
            if crate::npipe::pipe_name(&p).is_some() {
                return None;
            } // named pipes: Wine's CreateFile, then NtCreateFile
            let (access, disp, flags) = (e.arg(1) as u32, e.arg(4) as u32, e.arg(5) as u32);
            let Some(k) = key_of(&p) else {
                if flags & 0x0200_0000 != 0 {
                    return Some(e.new_handle(Handle::Dir));
                }
                e.set_last_error(5);
                return Some(INVALID);
            };
            if k == "nul" {
                e.set_last_error(0);
                return Some(e.new_handle(Handle::Null));
            }
            if k == "conin$" {
                e.set_last_error(0);
                return Some(3);
            }
            if k == "conout$" {
                e.set_last_error(0);
                return Some(1);
            }
            if e.is_dir(&k) {
                if flags & 0x0200_0000 != 0 {
                    return Some(e.new_handle(Handle::Dir));
                }
                e.set_last_error(5);
                return Some(INVALID);
            }
            let exists = e.s.files.contains_key(&k);
            match disp {
                1 if exists => {
                    e.set_last_error(80);
                    return Some(INVALID);
                } // CREATE_NEW
                3 | 5 if !exists => {
                    e.set_last_error(2);
                    return Some(INVALID);
                } // OPEN_EXISTING, TRUNCATE_EXISTING
                2 | 5 => {
                    e.s.files.insert(k.clone(), Vec::new());
                    e.s.fs.written.insert(k.clone());
                    e.note_case(&k, &p);
                } // CREATE_ALWAYS
                _ => {
                    if !exists {
                        e.s.files.insert(k.clone(), Vec::new());
                        e.s.fs.written.insert(k.clone());
                        e.note_case(&k, &p);
                    }
                }
            }
            if disp == 2 || disp == 4 {
                e.set_last_error(if exists { 183 } else { 0 });
            } else {
                e.set_last_error(0);
            }
            let _ = access;
            e.new_handle(Handle::File { name: k, pos: 0 })
        }
        "CloseHandle" => {
            if e.close_handle(a0) {
                1
            } else {
                return None;
            }
        }
        "ReadFile" => {
            let (buf, n, done) = (e.arg(1), e.arg(2) as u32 as u64, e.arg(3));
            if e.is_npipe(a0) {
                let ov = e.arg(4);
                return Some(e.np_win32(true, a0, buf, n, done, ov));
            }
            // no keyboard yet: reading the console fails like a closed pipe
            if a0 == 3 {
                if done != 0 {
                    e.w32(done, 0);
                }
                e.set_last_error(109);
                return Some(0);
            }
            if matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) {
                if done != 0 {
                    e.w32(done, 0);
                }
                return Some(1);
            }
            if let Some(id) = e.pipe_id(a0) {
                return Some(match e.pipe_read(a0, buf, n) {
                    Ok(k) => {
                        if done != 0 {
                            e.w32(done, k as u32);
                        }
                        1
                    }
                    Err(true) => {
                        if done != 0 {
                            e.w32(done, 0);
                        }
                        e.set_last_error(109);
                        0
                    } // ERROR_BROKEN_PIPE
                    Err(false) if n == 0 => {
                        if done != 0 {
                            e.w32(done, 0);
                        }
                        1
                    }
                    Err(false) => e.wait_on(crate::sched::W::Pipe(id), u64::MAX),
                });
            }
            let got = e.file_read(a0, None, buf, n)?;
            if done != 0 {
                e.w32(done, got as u32);
            }
            1
        }
        "WriteFile" => {
            let (buf, n, done) = (e.arg(1), e.arg(2) as u32 as u64, e.arg(3));
            if e.is_npipe(a0) {
                let ov = e.arg(4);
                return Some(e.np_win32(false, a0, buf, n, done, ov));
            }
            if matches!(e.s.fs.handles.get(&a0), Some(Handle::Null)) {
                if done != 0 {
                    e.w32(done, n as u32);
                }
                return Some(1);
            }
            if e.pipe_write(a0, buf, n) {
                if done != 0 {
                    e.w32(done, n as u32);
                }
                return Some(1);
            }
            if e.file_mut(a0).is_some() {
                let mut v = vec![0u8; n as usize];
                if e.mmu.read_bytes(buf, &mut v).is_err() {
                    e.fault(buf);
                }
                e.file_write(a0, None, &v);
            } else if !e.write_out(a0, buf, n) {
                e.set_last_error(6); // the console, or nothing
                return Some(0);
            }
            if done != 0 {
                e.w32(done, n as u32);
            }
            1
        }
        "GetFileType" => match e.s.fs.handles.get(&a0) {
            Some(Handle::Null) => 2,
            Some(Handle::Pipe { .. } | Handle::Afd | Handle::NPipe { .. }) => 3,
            Some(_) => 1,
            None => {
                if a0 <= 3 {
                    2
                } else {
                    0
                }
            }
        },
        "PeekNamedPipe" => {
            if e.is_npipe(a0) {
                return None;
            } // named pipes: Wine's, over FSCTL_PIPE_PEEK
            let Some(id) = e.pipe_id(a0) else {
                e.set_last_error(6);
                return Some(0);
            };
            let (buf, n, read, avail, left) = (e.arg(1), e.arg(2) as u32 as usize, e.arg(3), e.arg(4), e.arg(5));
            let (data, w): (Vec<u8>, u32) = match e.s.fs.pipes.get(&id) {
                Some(p) => (p.buf.iter().take(n).copied().collect(), p.writers),
                None => (vec![], 0),
            };
            let total = e.s.fs.pipes.get(&id).map_or(0, |p| p.buf.len()) as u32;
            if total == 0 && w == 0 {
                e.set_last_error(109);
                return Some(0);
            }
            if buf != 0 {
                let _ = e.mmu.write_bytes(buf, &data);
            }
            if read != 0 {
                e.w32(read, if buf != 0 { data.len() as u32 } else { 0 });
            }
            if avail != 0 {
                e.w32(avail, total);
            }
            if left != 0 {
                e.w32(left, 0);
            }
            1
        }
        "SetNamedPipeHandleState" => {
            if e.pipe_id(a0).is_some() {
                1
            } else {
                return None;
            }
        }
        "GetFileSize" | "GetFileSizeEx" => {
            let Some((k, _)) = e.file_mut(a0) else {
                e.set_last_error(6);
                return Some(if name == "GetFileSize" { 0xFFFF_FFFF } else { 0 });
            };
            let size = e.s.files.size(&k).unwrap_or(0);
            let p = e.arg(1);
            if name == "GetFileSizeEx" {
                e.w64(p, size);
                1
            } else {
                if p != 0 {
                    e.w32(p, (size >> 32) as u32);
                }
                size & 0xFFFF_FFFF
            }
        }
        "SetFilePointer" | "SetFilePointerEx" => {
            let Some((k, pos)) = e.file_mut(a0) else {
                e.set_last_error(6);
                return Some(if name == "SetFilePointer" { 0xFFFF_FFFF } else { 0 });
            };
            let size = e.s.files.size(&k).unwrap_or(0) as i64;
            let (dist, hi_ptr, method) = if name == "SetFilePointer" {
                let hp = e.arg(2);
                let hi = if hp != 0 { e.r32(hp) as i64 } else { (e.arg(1) as i32 as i64) >> 32 };
                ((hi << 32) | (e.arg(1) as u32 as i64), hp, e.arg(3))
            } else {
                (e.arg(1) as i64, e.arg(2), e.arg(3))
            };
            let base = match method {
                1 => pos as i64,
                2 => size,
                _ => 0,
            };
            let np = (base + dist).max(0) as u64;
            e.set_pos(a0, np);
            if name == "SetFilePointerEx" {
                if hi_ptr != 0 {
                    e.w64(hi_ptr, np);
                }
                1
            } else {
                if hi_ptr != 0 {
                    e.w32(hi_ptr, (np >> 32) as u32);
                }
                e.set_last_error(0);
                np & 0xFFFF_FFFF
            }
        }
        "SetEndOfFile" => {
            let Some((k, pos)) = e.file_mut(a0) else { return Some(0) };
            if let Some(d) = e.s.files.get_mut(&k) {
                d.resize(pos as usize, 0);
            }
            1
        }
        "FlushFileBuffers" => 1,
        "GetFileInformationByHandle" => {
            let out = e.arg(1);
            for i in 0..52 / 4 {
                e.w32(out + 4 * i, 0);
            }
            let (attr, size) = match e.file_mut(a0) {
                Some((k, _)) => (ATTR_NORMAL, e.s.files.size(&k).unwrap_or(0)),
                None => (ATTR_DIR, 0),
            };
            let ft = crate::filetime_now();
            e.w32(out, attr);
            for o in [4, 12, 20] {
                e.w64(out + o, ft);
            }
            e.w32(out + 28, 0x1A2B3C4D);
            e.w32(out + 32, (size >> 32) as u32);
            e.w32(out + 36, size as u32);
            e.w32(out + 40, 1);
            e.w32(out + 48, a0 as u32);
            1
        }
        "DeleteFileW" | "DeleteFileA" => {
            let p = e.path_arg(0, wide);
            match key_of(&p) {
                Some(k) if e.s.files.remove(&k).is_some() => {
                    e.s.fs.written.remove(&k);
                    1
                }
                _ => {
                    e.set_last_error(2);
                    0
                }
            }
        }
        "CreateDirectoryW" | "CreateDirectoryA" | "CreateDirectoryExW" => {
            let p = e.path_arg(if name == "CreateDirectoryExW" { 1 } else { 0 }, wide);
            match key_of(&p) {
                Some(k) if !e.is_dir(&k) && !e.s.files.contains_key(&k) => {
                    e.note_case(&k, &p);
                    e.s.fs.dirs.insert(k);
                    1
                }
                _ => {
                    e.set_last_error(183);
                    0
                }
            }
        }
        "RemoveDirectoryW" | "RemoveDirectoryA" => {
            let p = e.path_arg(0, wide);
            if let Some(k) = key_of(&p) {
                e.s.fs.dirs.remove(&k);
            }
            1
        }
        "MoveFileW" | "MoveFileWithProgressW" | "MoveFileExW" => {
            let (from, to) = (e.path_arg(0, true), e.path_arg(1, true));
            match (key_of(&from), key_of(&to)) {
                (Some(f), Some(t)) => match e.s.files.remove(&f) {
                    Some(d) => {
                        e.s.fs.written.remove(&f);
                        e.s.fs.written.insert(t.clone());
                        e.note_case(&t, &to);
                        e.s.files.insert(t, d);
                        1
                    }
                    None => {
                        e.set_last_error(2);
                        0
                    }
                },
                _ => {
                    e.set_last_error(5);
                    0
                }
            }
        }
        "CopyFileW" | "CopyFileExW" => {
            // a big file still on disk is copied without reading it (an installer caching its package)
            let (from, to) = (e.path_arg(0, true), e.path_arg(1, true));
            let (Some(f), Some(t)) = (key_of(&from), key_of(&to)) else { return None };
            if e.s.files.lazy_id(&f).is_none() || f == t {
                return None;
            }
            let fail_if = if name == "CopyFileW" { e.arg(2) as u32 != 0 } else { e.arg(5) as u32 & 1 != 0 };
            if fail_if && e.s.files.contains_key(&t) {
                e.set_last_error(80);
                return Some(0);
            }
            e.s.files.alias(t.clone(), &f);
            e.s.fs.written.insert(t.clone());
            e.note_case(&t, &to);
            1
        }
        "CreateHardLinkW" => {
            e.set_last_error(1);
            0
        }
        "DeviceIoControl" => {
            e.set_last_error(1);
            0
        }
        // ---- file times ----
        "CompareFileTime" => {
            let (x, y) = (e.r64(a0), {
                let b = e.arg(1);
                e.r64(b)
            });
            (x.cmp(&y) as i32) as i64 as u64
        }
        "DosDateTimeToFileTime" => {
            let (dd, tt, out) = (a0 as u32, e.arg(1) as u32, e.arg(2));
            let days = days_from(1980 + (dd >> 9) as i64, (dd >> 5) & 15, dd & 31);
            let secs = days as u64 * 86400 + ((tt >> 11) as u64) * 3600 + (((tt >> 5) & 63) as u64) * 60 + ((tt & 31) * 2) as u64;
            e.w64(out, secs * 10_000_000);
            1
        }
        "SystemTimeToFileTime" => {
            let r = |e: &mut Engine, i: u64| e.r16(a0 + 2 * i) as u64;
            let (y, m, d, hh, mm, ss, ms) = (r(e, 0), r(e, 1), r(e, 3), r(e, 4), r(e, 5), r(e, 6), r(e, 7));
            let days = days_from(y as i64, m as u32, d as u32) as u64;
            let out = e.arg(1);
            e.w64(out, ((days * 86400 + hh * 3600 + mm * 60 + ss) * 1000 + ms) * 10_000);
            1
        }
        "LocalFileTimeToFileTime" | "FileTimeToLocalFileTime" => {
            let v = e.r64(a0);
            let o = e.arg(1);
            e.w64(o, v);
            1
        }
        "FileTimeToSystemTime" | "FileTimeToDosDateTime" => {
            let ft = e.r64(a0);
            let secs = ft / 10_000_000;
            let (y, m, d, wd) = civil((secs / 86400) as i64);
            let s = secs % 86400;
            let (hh, mm, ss) = ((s / 3600) as u32, (s % 3600 / 60) as u32, (s % 60) as u32);
            if name == "FileTimeToSystemTime" {
                let o = e.arg(1);
                let v = [y as u32, m, wd, d, hh, mm, ss, ((ft / 10_000) % 1000) as u32];
                for (i, x) in v.iter().enumerate() {
                    e.w16(o + 2 * i as u64, *x as u16);
                }
            } else {
                let (pd, pt) = (e.arg(1), e.arg(2));
                e.w16(pd, ((((y - 1980).max(0) as u32) << 9) | (m << 5) | d) as u16);
                e.w16(pt, ((hh << 11) | (mm << 5) | (ss / 2)) as u16);
            }
            1
        }
        // ---- text conversion (UTF-8 / ASCII) ----
        "MultiByteToWideChar" => {
            let (src, n, dst, max) = (e.arg(2), e.arg(3) as u32 as i32, e.arg(4), e.arg(5) as u32 as u64);
            let bytes = if n < 0 {
                let mut v = e.read_cstr(src, 1 << 20).into_bytes();
                v.push(0);
                v
            } else {
                let mut v = vec![0u8; n as usize];
                let _ = e.mmu.read_bytes(src, &mut v);
                v
            };
            let w: Vec<u16> = String::from_utf8_lossy(&bytes).encode_utf16().collect();
            if max == 0 {
                return Some(w.len() as u64);
            }
            if (w.len() as u64) > max {
                e.set_last_error(122);
                return Some(0);
            }
            for (i, c) in w.iter().enumerate() {
                e.w16(dst + 2 * i as u64, *c);
            }
            w.len() as u64
        }
        "WideCharToMultiByte" => {
            let (src, n, dst, max) = (e.arg(2), e.arg(3) as u32 as i32, e.arg(4), e.arg(5) as u32 as u64);
            let mut w = Vec::new();
            let mut i = 0u64;
            loop {
                if n >= 0 && i >= n as u64 {
                    break;
                }
                let c = e.r16(src + 2 * i);
                w.push(c);
                i += 1;
                if n < 0 && c == 0 {
                    break;
                }
            }
            let b = String::from_utf16_lossy(&w).into_bytes();
            if max == 0 {
                return Some(b.len() as u64);
            }
            if (b.len() as u64) > max {
                e.set_last_error(122);
                return Some(0);
            }
            let _ = e.mmu.write_bytes(dst, &b);
            b.len() as u64
        }
        // ---- events (one thread: an event is just a flag) ----
        "OpenEventW" | "OpenFileMappingW" => {
            e.set_last_error(2);
            0
        }
        "FormatMessageW" | "FormatMessageA" => {
            // system messages only (FORMAT_MESSAGE_FROM_SYSTEM)
            let (flags, full_id, buf, size) = (a0 as u32, e.arg(2) as u32, e.arg(4), e.arg(5));
            let id = if full_id >> 16 == 0x8007 || full_id >> 16 == 0 { full_id & 0xFFFF } else { full_id };
            let other;
            let text = match id {
                2 => "The system cannot find the file specified.",
                3 => "The system cannot find the path specified.",
                5 => "Access is denied.",
                8 | 14 => "Not enough memory resources are available to process this command.",
                32 => "The process cannot access the file because it is being used by another process.",
                80 | 183 => "Cannot create a file when that file already exists.",
                87 => "The parameter is incorrect.",
                112 => "There is not enough space on the disk.",
                1 => "Incorrect function.",
                0x800B_0100 => "No signature was present in the subject.",
                // every other code still gets a readable text: programs often use the buffer without checking
                _ => {
                    other = format!("Error 0x{:08X}.", full_id);
                    other.as_str()
                }
            };
            let text = format!("{}\r\n", text);
            let n = text.encode_utf16().count() as u64;
            let dst = if flags & 0x100 != 0 {
                let p = e.heap_alloc(if wide { 2 * (n + 1) } else { n + 1 }, true);
                e.w64(buf, p);
                p
            } else {
                if size <= n {
                    e.set_last_error(122);
                    return Some(0);
                }
                buf
            };
            if wide {
                e.put_wstr(dst, &text, n + 1);
            } else {
                let _ = e.mmu.write_bytes(dst, text.as_bytes());
                e.w8(dst + n, 0);
            }
            n
        }
        _ => return e.not_mine(),
    })
}
