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
}

const PIECE: usize = 1 << 20;
/// files above this size are read piece by piece where they are, never whole
const BIG: u64 = 16 << 20;

/// A file's contents: bytes in memory, or (id, size) of one still on disk.
pub enum Entry { Data(Vec<u8>), Disk(u32, u64) }
impl From<Vec<u8>> for Entry { fn from(v: Vec<u8>) -> Self { Entry::Data(v) } }

#[derive(Default)]
pub struct Store {
    // boxed so a file's bytes stay put while other files are read in
    data: UnsafeCell<HashMap<String, Box<Vec<u8>>>>,
    lazy: UnsafeCell<HashMap<String, (u32, u64)>>,
    pub loaded_bytes: u64,
}

// all use is under the engine lock (one core at a time)
unsafe impl Sync for Store {}

impl Store {
    fn data(&self) -> &mut HashMap<String, Box<Vec<u8>>> { unsafe { &mut *self.data.get() } }
    fn lazy(&self) -> &mut HashMap<String, (u32, u64)> { unsafe { &mut *self.lazy.get() } }

    /// A drive file known by id and size; read when first used.
    pub fn add_lazy(&mut self, k: String, id: u32, size: u64) { self.data().remove(&k); self.lazy().insert(k, (id, size)); }

    fn fill(&self, k: &str) {
        let Some((id, size)) = self.lazy().remove(k) else { return };
        let mut v = vec![0u8; size as usize];
        let mut at = 0usize;
        while at < v.len() {
            let n = PIECE.min(v.len() - at);
            let got = unsafe { host_drive_read(id, at as f64, v.as_mut_ptr().add(at), n as u32) } as usize;
            if got == 0 { break; }
            at += got;
        }
        unsafe { (*(self as *const Store as *mut Store)).loaded_bytes += size; }
        self.data().insert(k.to_string(), Box::new(v));
    }

    /// Up to n bytes at pos. A big drive file still on disk is read there, without
    /// bringing the whole file in (a 400 MB installer package).
    pub fn read_at(&self, k: &str, pos: u64, n: u64) -> Option<Vec<u8>> {
        if let Some(&(id, size)) = self.lazy().get(k) {
            if size > BIG {
                let n = n.min(size.saturating_sub(pos)) as usize;
                let mut v = vec![0u8; n];
                let mut at = 0usize;
                while at < n {
                    let got = unsafe { host_drive_read(id, (pos + at as u64) as f64, v.as_mut_ptr().add(at), (n - at).min(PIECE) as u32) } as usize;
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
        let Some(&v) = self.lazy().get(src) else { return false };
        self.data().remove(&dst);
        self.lazy().insert(dst, v);
        true
    }
    /// The disk id of a file not read yet.
    pub fn lazy_id(&self, k: &str) -> Option<u32> { self.lazy().get(k).map(|v| v.0) }

    pub fn get(&self, k: &str) -> Option<&Vec<u8>> {
        if self.lazy().contains_key(k) { self.fill(k); }
        self.data().get(k).map(|b| &**b)
    }
    pub fn get_mut(&mut self, k: &str) -> Option<&mut Vec<u8>> {
        if self.lazy().contains_key(k) { self.fill(k); }
        self.data().get_mut(k).map(|b| &mut **b)
    }
    /// The file's size without reading it.
    pub fn size(&self, k: &str) -> Option<u64> {
        if let Some(&(_, s)) = self.lazy().get(k) { return Some(s); }
        self.data().get(k).map(|d| d.len() as u64)
    }
    pub fn contains_key(&self, k: &str) -> bool { self.data().contains_key(k) || self.lazy().contains_key(k) }
    pub fn insert(&mut self, k: String, v: impl Into<Entry>) {
        self.lazy().remove(&k);
        self.data().remove(&k);
        match v.into() { Entry::Data(v) => { self.data().insert(k, Box::new(v)); } Entry::Disk(id, size) => { self.lazy().insert(k, (id, size)); } }
    }
    /// Takes a file out (a rename puts it back under its new name; one on disk stays there).
    pub fn remove(&mut self, k: &str) -> Option<Entry> {
        if let Some((id, size)) = self.lazy().remove(k) { return Some(Entry::Disk(id, size)); }
        self.data().remove(k).map(|b| Entry::Data(*b))
    }
    /// The file's bytes, made empty if it is new.
    pub fn entry_or_default(&mut self, k: String) -> &mut Vec<u8> {
        if self.lazy().contains_key(&k) { self.fill(&k); }
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
