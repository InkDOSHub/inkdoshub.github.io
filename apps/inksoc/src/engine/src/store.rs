// The program's files. Files of the saved drive C: start as a map entry only
// (their id on the browser's storage and their size); their bytes are read the
// first time the program needs them, in 1 MB pieces, and stay in memory after.
// A size or a folder listing never reads a file.

use std::cell::UnsafeCell;
use std::collections::HashMap;

#[link(wasm_import_module = "env")]
extern "C" {
    /// Reads len bytes at off of drive file id into ptr; returns the bytes read.
    fn host_drive_read(id: u32, off: f64, ptr: *mut u8, len: u32) -> u32;
    /// Writes len bytes from ptr at off of file id (only the spill file); returns the bytes written.
    fn host_drive_write(id: u32, off: f64, ptr: *const u8, len: u32) -> u32;
}

/// The host's spill file: closed program files too big to keep in memory.
pub const SPILL: u32 = 0x7FFF_FFF0;
/// closed files from this size go to the spill file
const SPILL_MIN: usize = 64 << 10;

const PIECE: usize = 1 << 20;
/// files above this size are read piece by piece where they are, never whole
const BIG: u64 = 16 << 20;

/// A file's contents: bytes in memory, or (id, size) of one still on disk.
pub enum Entry { Data(Vec<u8>), Disk(u32, u64, u64) }
impl From<Vec<u8>> for Entry { fn from(v: Vec<u8>) -> Self { Entry::Data(v) } }

#[derive(Default)]
pub struct Store {
    // boxed so a file's bytes stay put while other files are read in
    data: UnsafeCell<HashMap<String, Box<Vec<u8>>>>,
    /// on disk: (file id, offset in it, size)
    lazy: UnsafeCell<HashMap<String, (u32, u64, u64)>>,
    /// files read in and not changed since: where their bytes still are on disk
    clean: UnsafeCell<HashMap<String, (u32, u64, u64)>>,
    pub loaded_bytes: u64,
    /// where the next spilled file goes in the spill file
    spill_at: u64,
}

// all use is under the engine lock (one core at a time)
unsafe impl Sync for Store {}

impl Store {
    fn data(&self) -> &mut HashMap<String, Box<Vec<u8>>> { unsafe { &mut *self.data.get() } }
    fn lazy(&self) -> &mut HashMap<String, (u32, u64, u64)> { unsafe { &mut *self.lazy.get() } }
    fn clean(&self) -> &mut HashMap<String, (u32, u64, u64)> { unsafe { &mut *self.clean.get() } }

    /// A drive file known by id and size; read when first used.
    pub fn add_lazy(&mut self, k: String, id: u32, size: u64) { self.data().remove(&k); self.clean().remove(&k); self.lazy().insert(k, (id, 0, size)); }

    /// A file no handle holds any more: its bytes leave memory when they are still on disk
    /// (unchanged), or go to the spill file when big.
    pub fn release(&mut self, k: &str) {
        if let Some(v) = self.clean().remove(k) { self.data().remove(k); self.lazy().insert(k.to_string(), v); return; }
        let Some(d) = self.data().get(k) else { return };
        if d.len() < SPILL_MIN { return; }
        let n = d.len() as u64;
        let got = unsafe { host_drive_write(SPILL, self.spill_at as f64, d.as_ptr(), n as u32) } as u64;
        if got != n || n >= 1 << 32 { return; } // no spill file here: it stays in memory
        self.data().remove(k);
        self.lazy().insert(k.to_string(), (SPILL, self.spill_at, n));
        self.spill_at += n;
    }

    fn fill(&self, k: &str) {
        let Some((id, base, size)) = self.lazy().remove(k) else { return };
        let mut v = vec![0u8; size as usize];
        let mut at = 0usize;
        while at < v.len() {
            let n = PIECE.min(v.len() - at);
            let got = unsafe { host_drive_read(id, (base + at as u64) as f64, v.as_mut_ptr().add(at), n as u32) } as usize;
            if got == 0 { break; }
            at += got;
        }
        unsafe { (*(self as *const Store as *mut Store)).loaded_bytes += size; }
        self.clean().insert(k.to_string(), (id, base, size));
        self.data().insert(k.to_string(), Box::new(v));
    }

    /// Up to n bytes at pos. A big drive file still on disk is read there, without
    /// bringing the whole file in (a 400 MB installer package).
    pub fn read_at(&self, k: &str, pos: u64, n: u64) -> Option<Vec<u8>> {
        if let Some(&(id, base, size)) = self.lazy().get(k) {
            if size > BIG {
                let n = n.min(size.saturating_sub(pos)) as usize;
                let mut v = vec![0u8; n];
                let mut at = 0usize;
                while at < n {
                    let got = unsafe { host_drive_read(id, (base + pos + at as u64) as f64, v.as_mut_ptr().add(at), (n - at).min(PIECE) as u32) } as usize;
                    if got == 0 { break; }
                    at += got;
                }
                v.truncate(at);
                unsafe { (*(self as *const Store as *mut Store)).loaded_bytes += at as u64; }
                return Some(v);
            }
        }
        let d = self.get(k)?;
        let s = (pos as usize).min(d.len());
        Some(d[s..(s + n as usize).min(d.len())].to_vec())
    }
    /// dst becomes a copy of src without reading it, when src is still on disk.
    pub fn alias(&mut self, dst: String, src: &str) -> bool {
        let Some(v) = self.lazy().get(src).or_else(|| self.clean().get(src)).copied() else { return false };
        self.data().remove(&dst);
        self.clean().remove(&dst);
        self.lazy().insert(dst, v);
        true
    }
    /// The disk id of a file not read yet.
    pub fn lazy_id(&self, k: &str) -> Option<u32> { self.lazy().get(k).map(|v| v.0) }
    /// (file id, offset, size) of a file still on disk.
    pub fn disk_of(&self, k: &str) -> Option<(u32, u64, u64)> { self.lazy().get(k).copied() }

    pub fn get(&self, k: &str) -> Option<&Vec<u8>> {
        if self.lazy().contains_key(k) { self.fill(k); }
        self.data().get(k).map(|b| &**b)
    }
    pub fn get_mut(&mut self, k: &str) -> Option<&mut Vec<u8>> {
        if self.lazy().contains_key(k) { self.fill(k); }
        self.clean().remove(k);
        self.data().get_mut(k).map(|b| &mut **b)
    }
    /// The file's size without reading it.
    pub fn size(&self, k: &str) -> Option<u64> {
        if let Some(&(_, _, s)) = self.lazy().get(k) { return Some(s); }
        self.data().get(k).map(|d| d.len() as u64)
    }
    pub fn contains_key(&self, k: &str) -> bool { self.data().contains_key(k) || self.lazy().contains_key(k) }
    pub fn insert(&mut self, k: String, v: impl Into<Entry>) {
        self.lazy().remove(&k);
        self.data().remove(&k);
        self.clean().remove(&k);
        match v.into() { Entry::Data(v) => { self.data().insert(k, Box::new(v)); } Entry::Disk(id, at, size) => { self.lazy().insert(k, (id, at, size)); } }
    }
    /// Takes a file out (a rename puts it back under its new name; one on disk stays there).
    pub fn remove(&mut self, k: &str) -> Option<Entry> {
        if let Some((id, at, size)) = self.lazy().remove(k) { return Some(Entry::Disk(id, at, size)); }
        if let Some(v) = self.clean().remove(k) { self.data().remove(k); return Some(Entry::Disk(v.0, v.1, v.2)); }
        self.data().remove(k).map(|b| Entry::Data(*b))
    }
    /// The file's bytes, made empty if it is new.
    pub fn entry_or_default(&mut self, k: String) -> &mut Vec<u8> {
        if self.lazy().contains_key(&k) { self.fill(&k); }
        self.clean().remove(&k);
        &mut **self.data().entry(k).or_default()
    }
    pub fn keys(&self) -> impl Iterator<Item = &String> { self.data().keys().chain(self.lazy().keys()) }
    /// Every file with its bytes (reads all drive files).
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Vec<u8>)> {
        let ks: Vec<String> = self.lazy().keys().cloned().collect();
        for k in ks { self.fill(&k); }
        self.data().iter().map(|(k, v)| (k, &**v))
    }
}

impl std::ops::Index<&String> for Store {
    type Output = Vec<u8>;
    fn index(&self, k: &String) -> &Vec<u8> { self.get(k).expect("file") }
}
