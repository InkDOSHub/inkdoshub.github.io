// The Windows registry, answered at the NT system call level (NtCreateKey, NtSetValueKey...)
// for Wine's advapi32/kernelbase. It lives in memory, starting with the root keys only:
// keys and values exist once a program (or a Wine DLL) creates them.

use crate::files::Handle;
use crate::Engine;
use std::collections::BTreeMap;

const OK: u64 = 0;
const INVALID_HANDLE: u64 = 0xC000_0008;
const INVALID_INFO_CLASS: u64 = 0xC000_0003;
const NAME_NOT_FOUND: u64 = 0xC000_0034;
const BUFFER_TOO_SMALL: u64 = 0xC000_0023;
const BUFFER_OVERFLOW: u64 = 0x8000_0005;
const NO_MORE_ENTRIES: u64 = 0x8000_001A;
const CANNOT_DELETE: u64 = 0xC000_0121;

/// The current user's key (the SID that NtQueryInformationToken(TokenUser) reports).
pub const USER_SID: &str = "S-1-5-21-1-2-3-1000";

#[derive(Default, Clone)]
pub struct Key {
    /// last path component, as first written (case kept)
    pub name: String,
    /// (name as written, type, data); looked up without case
    pub values: Vec<(String, u32, Vec<u8>)>,
}

#[derive(Default)]
pub struct Registry {
    /// full lowercase path ("\registry\machine\software\...") -> key
    pub keys: BTreeMap<String, Key>,
}

impl Registry {
    fn ensure_roots(&mut self) {
        if self.keys.contains_key("\\registry\\user") { return; }
        let user = format!("\\Registry\\User\\{}", USER_SID);
        for p in ["\\Registry", "\\Registry\\Machine", "\\Registry\\Machine\\Software", "\\Registry\\Machine\\Software\\Classes",
            "\\Registry\\Machine\\Software\\Microsoft", "\\Registry\\Machine\\Software\\Microsoft\\Windows",
            "\\Registry\\Machine\\Software\\Microsoft\\Windows\\CurrentVersion", "\\Registry\\Machine\\System",
            "\\Registry\\User", "\\Registry\\User\\.Default", user.as_str()] {
            self.create(p);
        }
        for p in ["Software", "Software\\Classes", "Software\\Microsoft", "Environment"] { self.create(&format!("{}\\{}", user, p)); }
        // where programs install (shell32 and installers read these)
        let cv = "\\Registry\\Machine\\Software\\Microsoft\\Windows\\CurrentVersion";
        for (n, v) in [("ProgramFilesDir", "C:\\Program Files"), ("ProgramFilesDir (x86)", "C:\\Program Files (x86)"), ("ProgramW6432Dir", "C:\\Program Files"),
            ("CommonFilesDir", "C:\\Program Files\\Common Files"), ("ProgramFilesPath", "%ProgramFiles%")] {
            let mut d = utf16(v); d.extend_from_slice(&[0, 0]);
            if let Some(k) = self.keys.get_mut(&cv.to_lowercase()) { k.values.push((n.to_string(), if v.contains('%') { 2 } else { 1 }, d)); }
        }
    }
    /// Every key and value as bytes: per key its path, name and values (u32 lengths, LE).
    pub fn save(&mut self) -> Vec<u8> {
        self.ensure_roots();
        let mut o = Vec::new();
        let put = |o: &mut Vec<u8>, b: &[u8]| { o.extend_from_slice(&(b.len() as u32).to_le_bytes()); o.extend_from_slice(b); };
        o.extend_from_slice(b"REG1");
        for (p, k) in &self.keys {
            put(&mut o, p.as_bytes()); put(&mut o, k.name.as_bytes());
            o.extend_from_slice(&(k.values.len() as u32).to_le_bytes());
            for (n, t, d) in &k.values { put(&mut o, n.as_bytes()); o.extend_from_slice(&t.to_le_bytes()); put(&mut o, d); }
        }
        o
    }
    pub fn load(&mut self, b: &[u8]) {
        if !b.starts_with(b"REG1") { return; }
        let mut i = 4;
        let u32_at = |b: &[u8], i: &mut usize| -> Option<u32> { let v = u32::from_le_bytes(b.get(*i..*i + 4)?.try_into().ok()?); *i += 4; Some(v) };
        let bytes = |b: &[u8], i: &mut usize| -> Option<Vec<u8>> { let n = u32_at(b, i)? as usize; let v = b.get(*i..*i + n)?.to_vec(); *i += n; Some(v) };
        let mut keys = BTreeMap::new();
        while i < b.len() {
            let Some(p) = bytes(b, &mut i) else { break };
            let Some(name) = bytes(b, &mut i) else { break };
            let Some(n) = u32_at(b, &mut i) else { break };
            let mut values = vec![];
            for _ in 0..n {
                let (Some(vn), Some(t), Some(d)) = (bytes(b, &mut i), u32_at(b, &mut i), bytes(b, &mut i)) else { return };
                values.push((String::from_utf8_lossy(&vn).into_owned(), t, d));
            }
            keys.insert(String::from_utf8_lossy(&p).into_owned(), Key { name: String::from_utf8_lossy(&name).into_owned(), values });
        }
        self.keys = keys;
        self.ensure_roots();
    }
    /// Creates a key and every missing parent; true when it is new.
    fn create(&mut self, path: &str) -> bool {
        let mut cur = String::new();
        let mut new = false;
        for part in path.split('\\').filter(|p| !p.is_empty()) {
            cur.push('\\');
            cur.push_str(&part.to_lowercase());
            if !self.keys.contains_key(&cur) { self.keys.insert(cur.clone(), Key { name: part.to_string(), values: vec![] }); new = true; }
        }
        new
    }
    /// Direct subkeys of a path, in order.
    fn children(&self, path: &str) -> Vec<String> {
        let pre = format!("{}\\", path);
        self.keys.range(pre.clone()..).take_while(|(k, _)| k.starts_with(&pre)).filter(|(k, _)| !k[pre.len()..].contains('\\')).map(|(k, _)| k.clone()).collect()
    }
}

fn utf16(s: &str) -> Vec<u8> { s.encode_utf16().flat_map(|c| c.to_le_bytes()).collect() }

impl Engine {
    /// Full lowercase key path of an OBJECT_ATTRIBUTES (root key handle + relative name).
    fn key_path(&mut self, oa: u64) -> Option<String> {
        let root = self.mmu.read64(oa + 8).unwrap_or(0);
        let name = self.oa_name(oa);
        let base = if root != 0 {
            match self.s.fs.handles.get(&root) { Some(Handle::Key { path }) => path.clone(), _ => return None }
        } else { String::new() };
        let mut p = base;
        for part in name.split('\\').filter(|x| !x.is_empty()) { p.push('\\'); p.push_str(&part.to_lowercase()); }
        Some(p)
    }
    fn key_of_handle(&self, h: u64) -> Option<String> {
        match self.s.fs.handles.get(&h) { Some(Handle::Key { path }) => Some(path.clone()), _ => None }
    }
    /// Writes `fixed` then `var` (as much as fits) to buf; the status says whether all of it fit.
    fn reg_out(&mut self, buf: u64, len: u64, retlen: u64, fixed: &[u8], var: &[u8]) -> u64 {
        let total = (fixed.len() + var.len()) as u64;
        if retlen != 0 { let _ = self.mmu.write32(retlen, total as u32); }
        if len < fixed.len() as u64 { return BUFFER_TOO_SMALL; }
        let _ = self.mmu.write_bytes(buf, fixed);
        let room = (len - fixed.len() as u64).min(var.len() as u64) as usize;
        let _ = self.mmu.write_bytes(buf + fixed.len() as u64, &var[..room]);
        if total > len { BUFFER_OVERFLOW } else { OK }
    }
    fn value_info(&mut self, class: u32, v: &(String, u32, Vec<u8>), buf: u64, len: u64, retlen: u64) -> u64 {
        let (name, ty, data) = (utf16(&v.0), v.1, v.2.clone());
        let w = |x: u32| x.to_le_bytes();
        match class {
            0 => { let f = [w(0), w(ty), w(name.len() as u32)].concat(); self.reg_out(buf, len, retlen, &f, &name) }
            1 => {
                // full: name, then the data at an 8-aligned offset
                let doff = (20 + name.len() as u32 + 7) & !7;
                let f = [w(0), w(ty), w(doff), w(data.len() as u32), w(name.len() as u32)].concat();
                let mut var = name.clone(); var.resize(doff as usize - 20, 0); var.extend_from_slice(&data);
                self.reg_out(buf, len, retlen, &f, &var)
            }
            2 => { let f = [w(0), w(ty), w(data.len() as u32)].concat(); self.reg_out(buf, len, retlen, &f, &data) }
            3 => { let f = [w(ty), w(data.len() as u32)].concat(); self.reg_out(buf, len, retlen, &f, &data) }
            _ => INVALID_INFO_CLASS,
        }
    }
    fn key_info(&mut self, class: u32, path: &str, buf: u64, len: u64, retlen: u64) -> u64 {
        let Some(k) = self.s.fs.reg.keys.get(path).cloned() else { return INVALID_HANDLE };
        let name = utf16(&k.name);
        let w = |x: u32| x.to_le_bytes();
        let t = 0x01DA_0000_0000_0000u64.to_le_bytes(); // a fixed "last write" time (2023)
        match class {
            0 => { let f = [&t[..], &w(0), &w(name.len() as u32)].concat(); self.reg_out(buf, len, retlen, &f, &name) }
            1 => { let f = [&t[..], &w(0), &w(24 + name.len() as u32), &w(0), &w(name.len() as u32)].concat(); self.reg_out(buf, len, retlen, &f, &name) }
            2 => {
                let kids = self.s.fs.reg.children(path);
                let max_name = kids.iter().map(|c| self.s.fs.reg.keys[c].name.encode_utf16().count() * 2).max().unwrap_or(0) as u32;
                let max_vn = k.values.iter().map(|v| v.0.encode_utf16().count() * 2).max().unwrap_or(0) as u32;
                let max_vd = k.values.iter().map(|v| v.2.len()).max().unwrap_or(0) as u32;
                let f = [&t[..], &w(0), &w(44), &w(0), &w(kids.len() as u32), &w(max_name), &w(0), &w(k.values.len() as u32), &w(max_vn), &w(max_vd)].concat();
                self.reg_out(buf, len, retlen, &f, &[])
            }
            3 => {
                // KeyNameInformation: the full name, cased as written
                let mut full = String::new(); let mut cur = String::new();
                for part in path.split('\\').filter(|p| !p.is_empty()) { cur.push('\\'); cur.push_str(part); full.push('\\'); full.push_str(&self.s.fs.reg.keys.get(&cur).map_or(part.to_string(), |k| k.name.clone())); }
                let n = utf16(&full);
                self.reg_out(buf, len, retlen, &w(n.len() as u32), &n)
            }
            7 => { let f = [w(0), w(0)].concat(); self.reg_out(buf, len, retlen, &f, &[]) } // KeyFlagsInformation-like
            _ => INVALID_INFO_CLASS,
        }
    }
}

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    e.s.fs.reg.ensure_roots();
    let r = match name {
        "NtCreateKey" | "NtOpenKey" | "NtOpenKeyEx" | "NtOpenKeyTransacted" | "NtOpenKeyTransactedEx" => {
            // (handle*, access, attributes, ...); NtCreateKey: (.., title index, class, options, disposition*)
            let oa = e.arg(2);
            let Some(p) = e.key_path(oa) else { return Some(INVALID_HANDLE) };
            if name == "NtCreateKey" {
                let new = e.s.fs.reg.create(&p);
                let disp = e.arg(6);
                if disp != 0 { let _ = e.mmu.write32(disp, if new { 1 } else { 2 }); } // REG_CREATED_NEW_KEY / REG_OPENED_EXISTING_KEY
            } else if !e.s.fs.reg.keys.contains_key(&p) { return Some(NAME_NOT_FOUND); }
            let h = e.new_handle(Handle::Key { path: p });
            let _ = e.mmu.write64(a0, h);
            OK
        }
        "NtSetValueKey" => {
            // (key, name, title index, type, data, size)
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            let us = e.arg(1); let vn = e.us_read(us);
            let (ty, data, size) = (e.arg(3) as u32, e.arg(4), e.arg(5) as u32 as usize);
            let mut v = vec![0u8; size];
            let _ = e.mmu.read_bytes(data, &mut v);
            let k = e.s.fs.reg.keys.get_mut(&p)?;
            match k.values.iter_mut().find(|x| x.0.eq_ignore_ascii_case(&vn)) { Some(x) => { x.1 = ty; x.2 = v; } None => k.values.push((vn, ty, v)) }
            OK
        }
        "NtQueryValueKey" => {
            // (key, name, class, info, length, result length*)
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            let us = e.arg(1); let vn = e.us_read(us);
            let (class, buf, len, ret) = (e.arg(2) as u32, e.arg(3), e.arg(4) as u32 as u64, e.arg(5));
            let Some(v) = e.s.fs.reg.keys.get(&p).and_then(|k| k.values.iter().find(|x| x.0.eq_ignore_ascii_case(&vn)).cloned()) else { return Some(NAME_NOT_FOUND) };
            e.value_info(class, &v, buf, len, ret)
        }
        "NtEnumerateValueKey" => {
            // (key, index, class, info, length, result length*)
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            let (i, class, buf, len, ret) = (e.arg(1) as u32 as usize, e.arg(2) as u32, e.arg(3), e.arg(4) as u32 as u64, e.arg(5));
            let Some(v) = e.s.fs.reg.keys.get(&p).and_then(|k| k.values.get(i).cloned()) else { return Some(NO_MORE_ENTRIES) };
            e.value_info(class, &v, buf, len, ret)
        }
        "NtEnumerateKey" => {
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            let (i, class, buf, len, ret) = (e.arg(1) as u32 as usize, e.arg(2) as u32, e.arg(3), e.arg(4) as u32 as u64, e.arg(5));
            let Some(c) = e.s.fs.reg.children(&p).get(i).cloned() else { return Some(NO_MORE_ENTRIES) };
            e.key_info(class, &c, buf, len, ret)
        }
        "NtQueryKey" => {
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            let (class, buf, len, ret) = (e.arg(1) as u32, e.arg(2), e.arg(3) as u32 as u64, e.arg(4));
            e.key_info(class, &p, buf, len, ret)
        }
        "NtDeleteValueKey" => {
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            let us = e.arg(1); let vn = e.us_read(us);
            let k = e.s.fs.reg.keys.get_mut(&p)?;
            let n = k.values.len();
            k.values.retain(|x| !x.0.eq_ignore_ascii_case(&vn));
            if k.values.len() == n { NAME_NOT_FOUND } else { OK }
        }
        "NtDeleteKey" => {
            let Some(p) = e.key_of_handle(a0) else { return Some(INVALID_HANDLE) };
            if !e.s.fs.reg.children(&p).is_empty() { return Some(CANNOT_DELETE); }
            e.s.fs.reg.keys.remove(&p);
            OK
        }
        "NtFlushKey" | "NtNotifyChangeKey" | "NtNotifyChangeMultipleKeys" => { if e.key_of_handle(a0).is_some() { OK } else { INVALID_HANDLE } }
        _ => return None,
    };
    Some(r)
}
