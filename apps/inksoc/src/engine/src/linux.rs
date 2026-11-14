// Linux programs on the same CPU: a static x86-64 ELF loader and the Linux
// system calls (the `syscall` instruction). Files live in a small in-memory
// tree (/bin, /root, /tmp, ...). One process for now: no fork yet.

use crate::Engine;
use std::collections::{BTreeMap, BTreeSet};

const STACK_TOP: u64 = 0x7FFF_F000_0000;
const STACK_SIZE: u64 = 8 << 20;
const MMAP_BASE: u64 = 0x10_0000_0000;
const PAGE: u64 = 4096;
const BLOCKED: i64 = i64::MIN + 1; // the call waits (and runs again when woken)
const NORET: i64 = i64::MIN + 2; // registers already set (execve)

// errno
const ENOENT: i64 = 2; const EBADF: i64 = 9; const ENOMEM: i64 = 12; const EEXIST: i64 = 17;
const ENOTDIR: i64 = 20; const EISDIR: i64 = 21; const EINVAL: i64 = 22; const ENOTTY: i64 = 25;
const ESPIPE: i64 = 29; const ERANGE: i64 = 34; const ENOSYS: i64 = 38; const ENOTEMPTY: i64 = 39;
const ECHILD: i64 = 10; const EPIPE: i64 = 32; const ENOEXEC: i64 = 8;

pub enum Node { File(Vec<u8>), Dir, Link(String) }

#[derive(Clone)]
pub enum Fd {
    Tty,
    File { path: String, pos: u64, append: bool },
    Dir { path: String, pos: usize },
    Pipe { id: u32, w: bool },
    Sock { id: u32 },
    Dev(u8), // 0 /dev/zero, 1 /dev/urandom
}

/// What a waiting Linux thread waits for.
#[derive(Clone)]
pub enum Cond { PipeRead(u32), Child { parent: u32, pid: i64 }, Stdin, Until, Socks(Vec<u32>), Poll { socks: Vec<u32>, stdin: bool, pipes: Vec<u32> } }

/// A process that is not running right now keeps its state here.
pub struct Saved {
    fds: BTreeMap<i32, Fd>, cloexec: BTreeSet<i32>, cwd: String,
    brk_start: u64, brk: u64, mmap_next: u64, exe: String, ids: (u32, u32, u32),
    space: crate::mmu::Space, jit: crate::jit::Jit,
}
pub struct Proc { ppid: u32, saved: Option<Saved>, zombie: Option<i32> }

#[derive(Default)]
pub struct Lx {
    pub fs: BTreeMap<String, Node>,
    // the running process
    pub pid: u32,
    pub fds: BTreeMap<i32, Fd>,
    pub cloexec: BTreeSet<i32>,
    pub cwd: String,
    pub brk_start: u64,
    pub brk: u64,
    pub mmap_next: u64,
    pub exe: String,
    pub ids: (u32, u32, u32), // real uid, gid, effective uid
    pub dirty: bool, // the file tree changed since the page last saved it
    // every process
    pub procs: BTreeMap<u32, Proc>,
    pub next_pid: u32,
    pub pipes: BTreeMap<u32, std::collections::VecDeque<u8>>,
    pub next_pipe: u32,
    pub stdin: Vec<u8>,
    pub stdin_eof: bool,
    pub lflag: u32, // terminal mode (ICANON 2, ECHO 8)
    pub termios: Option<Vec<u8>>,
    pub winsize: (u16, u16), // rows, columns
    pub written: BTreeSet<String>,
    pub unknown: BTreeSet<u64>,
    want: Option<Cond>,
    // network: sockets go out through the page (wisp tunnel on our server)
    pub socks: BTreeMap<u32, Sock>,
    pub next_sock: u32,
    pub net_out: Vec<u8>,
    pub dns: Vec<String>,
}

/// A socket. TCP data comes and goes through the page; UDP only answers DNS (here, with made-up addresses
/// 198.18.x.y that the page turns back into names when connecting).
#[derive(Default)]
pub struct Sock { udp: bool, nb: bool, open: bool, closed: bool, failed: bool, rx: std::collections::VecDeque<u8>, dgrams: std::collections::VecDeque<(Vec<u8>, [u8; 16])>, peer: [u8; 16] }
const EAGAIN: i64 = 11; const ENOTCONN: i64 = 107; const ECONNREFUSED: i64 = 111; const EOPNOTSUPP: i64 = 95; const EAFNOSUPPORT: i64 = 97; const ENETUNREACH: i64 = 101;


fn align(v: u64) -> u64 { (v + PAGE - 1) & !(PAGE - 1) }

/// Splits a command line into words ("..." and '...' keep spaces).
pub fn split_args(cmd: &str) -> Vec<String> {
    let (mut out, mut cur, mut q, mut any) = (Vec::new(), String::new(), None::<char>, false);
    for c in cmd.chars() {
        match (q, c) {
            (Some(x), c) if c == x => q = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => { q = Some(c); any = true; }
            (None, c) if c.is_whitespace() => { if any || !cur.is_empty() { out.push(std::mem::take(&mut cur)); any = false; } }
            (None, c) => cur.push(c),
        }
    }
    if any || !cur.is_empty() { out.push(cur); }
    out
}

impl Lx {
    /// Absolute, normalized path (no symlinks followed).
    fn abs(&self, p: &str) -> String {
        let full = if p.starts_with('/') { p.to_string() } else { format!("{}/{}", self.cwd, p) };
        let mut parts: Vec<&str> = Vec::new();
        for s in full.split('/') {
            match s { "" | "." => {} ".." => { parts.pop(); } s => parts.push(s) }
        }
        format!("/{}", parts.join("/"))
    }
    /// Follows symlinks (in every component); `last` = follow the final one too.
    pub fn resolve(&self, p: &str, last: bool) -> String {
        let mut path = self.abs(p);
        for _ in 0..16 {
            let parts: Vec<String> = path.split('/').filter(|s| !s.is_empty()).map(String::from).collect();
            let mut cur = String::new();
            let mut changed = false;
            for (k, s) in parts.iter().enumerate() {
                cur = format!("{}/{}", cur, s);
                if k + 1 == parts.len() && !last { break; }
                if let Some(Node::Link(t)) = self.fs.get(&cur) {
                    let base = cur.rsplit_once('/').map(|x| x.0).unwrap_or("");
                    let target = if t.starts_with('/') { t.clone() } else { format!("{}/{}", base, t) };
                    let rest: Vec<&str> = parts[k + 1..].iter().map(|s| s.as_str()).collect();
                    path = self.abs(&format!("{}/{}", target, rest.join("/")));
                    changed = true;
                    break;
                }
            }
            if !changed { return if path.is_empty() { "/".into() } else { path }; }
        }
        path
    }
    pub fn mkdirs(&mut self, path: &str) {
        let mut cur = String::new();
        for s in path.split('/').filter(|s| !s.is_empty()) {
            cur = format!("{}/{}", cur, s);
            self.fs.entry(cur.clone()).or_insert(Node::Dir);
        }
    }
    pub fn put(&mut self, path: &str, data: Vec<u8>) {
        if let Some((dir, _)) = path.rsplit_once('/') { self.mkdirs(dir); }
        self.fs.insert(path.to_string(), Node::File(data));
    }
    fn is_dir(&self, p: &str) -> bool { p == "/" || matches!(self.fs.get(p), Some(Node::Dir)) }
    fn children(&self, dir: &str) -> Vec<String> {
        let pre = if dir == "/" { "/".to_string() } else { format!("{}/", dir) };
        self.fs.range(pre.clone()..).take_while(|(k, _)| k.starts_with(&pre))
            .filter(|(k, _)| !k[pre.len()..].contains('/')).map(|(k, _)| k[pre.len()..].to_string()).collect()
    }
    /// Unpacks a tar archive (ustar, GNU long names, pax paths) at /.
    pub fn untar(&mut self, t: &[u8]) {
        let num = |b: &[u8]| -> usize {
            if b[0] & 0x80 != 0 { return b[1..].iter().fold(0usize, |a, &c| (a << 8) | c as usize); }
            let s = String::from_utf8_lossy(b); usize::from_str_radix(s.trim_matches(|c: char| c == '\0' || c == ' '), 8).unwrap_or(0)
        };
        let cstr = |b: &[u8]| String::from_utf8_lossy(&b[..b.iter().position(|&c| c == 0).unwrap_or(b.len())]).to_string();
        let (mut o, mut long, mut longlink) = (0usize, None::<String>, None::<String>);
        while o + 512 <= t.len() {
            let h = &t[o..o + 512];
            if h.iter().all(|&c| c == 0) { break; }
            let size = num(&h[124..136]);
            let ty = h[156];
            let data = &t[(o + 512).min(t.len())..(o + 512 + size).min(t.len())];
            o += 512 + (size + 511) / 512 * 512;
            let mut name = cstr(&h[0..100]);
            if &h[257..262] == b"ustar" { let pre = cstr(&h[345..500]); if !pre.is_empty() { name = format!("{}/{}", pre, name); } }
            let mut link = cstr(&h[157..257]);
            match ty {
                b'L' => { long = Some(cstr(data)); continue; }
                b'K' => { longlink = Some(cstr(data)); continue; }
                b'x' => {
                    for rec in String::from_utf8_lossy(data).lines() {
                        if let Some((_, kv)) = rec.split_once(' ') {
                            if let Some(p) = kv.strip_prefix("path=") { long = Some(p.to_string()); }
                            if let Some(p) = kv.strip_prefix("linkpath=") { longlink = Some(p.to_string()); }
                        }
                    }
                    continue;
                }
                b'g' => continue,
                _ => {}
            }
            if let Some(n) = long.take() { name = n; }
            if let Some(n) = longlink.take() { link = n; }
            let path = self.abs(&format!("/{}", name));
            if path == "/" { continue; }
            if let Some((dir, _)) = path.rsplit_once('/') { self.mkdirs(dir); }
            match ty {
                b'5' => { self.mkdirs(&path); }
                b'2' => { self.fs.insert(path, Node::Link(link)); }
                b'1' => { let src = self.abs(&format!("/{}", link)); if let Some(Node::File(d)) = self.fs.get(&src) { let d = d.clone(); self.fs.insert(path, Node::File(d)); } }
                b'0' | 0 | b'7' => { self.fs.insert(path, Node::File(data.to_vec())); }
                _ => {}
            }
        }
    }
    fn new_fd(&mut self, f: Fd) -> i32 {
        let mut n = 0;
        while self.fds.contains_key(&n) { n += 1; }
        self.fds.insert(n, f);
        n
    }
}

fn lx(e: &mut Engine) -> &mut Lx { e.s.lx.as_mut().unwrap() }

impl Engine {
    /// Loads a static ELF and builds the Linux start stack.
    pub fn linux_boot(&mut self, name: &str, cmd: &str) -> Result<(), String> {
        let mut l = Lx { cwd: "/root".into(), mmap_next: MMAP_BASE, pid: 1, next_pid: 100, lflag: 0x8A3B, winsize: (30, 100), ..Default::default() };
        l.procs.insert(1, Proc { ppid: 0, saved: None, zombie: None });
        for d in ["/bin", "/usr/bin", "/sbin", "/tmp", "/root", "/etc", "/dev", "/proc/self"] { l.mkdirs(d); }
        l.fs.insert("/etc/passwd".into(), Node::File(b"root:x:0:0:root:/root:/bin/sh\n".to_vec()));
        l.fs.insert("/etc/group".into(), Node::File(b"root:x:0:\n".to_vec()));
        l.fs.insert("/etc/hostname".into(), Node::File(b"inksoc\n".to_vec()));
        l.fs.insert("/dev/null".into(), Node::File(Vec::new()));
        for d in ["zero", "urandom", "random", "tty"] { l.fs.insert(format!("/dev/{}", d), Node::File(Vec::new())); }
        // the page's files go to /root; an ELF also goes to /bin (busybox: every applet links to it)
        let nm = |e: &Engine, k: &str| e.s.names.get(k).cloned().unwrap_or_else(|| k.to_string());
        let files: Vec<(String, Vec<u8>)> = self.s.files.iter().map(|(k, v)| (nm(self, k), v.clone())).collect();
        let bytes = self.s.files.get(name).cloned().ok_or_else(|| format!("{} not found", name))?;
        let name = nm(self, name);
        // a .tar is a root file system (e.g. Alpine's minirootfs): it is unpacked at /
        let mut files = files;
        files.sort_by_key(|(k, _)| (!k.starts_with("rootfs"), k.clone())); // the root file system first, overlays after
        for (k, v) in files { if k.ends_with(".tar") { l.untar(&v); } else if k != name { l.put(&format!("/root/{}", k), v); } }
        l.fs.insert("/etc/resolv.conf".into(), Node::File(b"nameserver 10.0.2.3\n".to_vec()));
        let exe = format!("/bin/{}", name);
        l.put(&exe, bytes.clone());
        l.fds.insert(0, Fd::Tty); l.fds.insert(1, Fd::Tty); l.fds.insert(2, Fd::Tty);
        l.fs.insert("/proc/self/exe".into(), Node::Link(exe.clone()));
        if name == "busybox" || name.starts_with("busybox") {
            for a in ["sh", "ash", "ls", "cat", "echo", "mkdir", "rm", "cp", "mv", "pwd", "grep", "sed", "awk", "wc", "head", "tail", "sort", "uniq", "touch", "find", "xargs", "vi", "env", "uname", "date", "sleep", "true", "false", "test", "expr", "printf", "md5sum", "sha256sum", "tar", "gzip", "gunzip", "ps", "free", "df", "du", "which", "clear", "seq", "tr", "cut", "basename", "dirname", "yes", "hexdump", "od", "diff", "less", "more", "ln", "chmod", "stat"] {
                l.fs.insert(format!("/bin/{}", a), Node::Link(exe.clone()));
            }
        }
        self.s.lx = Some(Box::new(l));
        self.mmu.sh.no_evict = true;
        self.sched_init();
        self.s.sched.th[0].pid = 1;
        let mut args = split_args(cmd);
        if args.is_empty() { args.push(name.clone()); }
        let env: Vec<String> = ["HOME=/root", "PATH=/bin:/usr/bin:/sbin", "TERM=xterm-256color", "USER=root", "SHELL=/bin/sh", "PWD=/root", "LANG=C.UTF-8"].iter().map(|s| s.to_string()).collect();
        self.load_elf(&bytes, &exe, &args, &env)
    }

    /// Maps the PT_LOAD segments of an ELF at `base` (0 for fixed programs).
    /// Returns (entry, phdr, phent, phnum, end, interpreter path).
    fn map_elf(&mut self, b: &[u8], base: u64) -> Result<(u64, u64, u64, u64, u64, Option<String>), String> {
        let u16_ = |o: usize| u16::from_le_bytes([b[o], b[o + 1]]) as u64;
        let u32_ = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as u64;
        let u64_ = |o: usize| u64::from_le_bytes(b[o..o + 8].try_into().unwrap());
        if b.len() < 64 || &b[0..4] != b"\x7fELF" || b[4] != 2 || u16_(18) != 62 { return Err("not an x86-64 ELF program".into()); }
        let base = if u16_(16) == 3 { base } else { 0 };
        let (phoff, phent, phnum) = (u64_(32) as usize, u16_(54) as usize, u16_(56) as usize);
        let (mut end, mut phdr, mut interp) = (0u64, 0u64, None);
        for k in 0..phnum {
            let p = phoff + k * phent;
            if p + 56 > b.len() { return Err("bad ELF header".into()); }
            match u32_(p) {
                1 => {
                    let (off, va, fsz, msz) = (u64_(p + 8), u64_(p + 16) + base, u64_(p + 32), u64_(p + 40));
                    let start = va & !(PAGE - 1);
                    let stop = align(va + msz);
                    // segments may share a page: only add what is not mapped yet
                    let mut a = start;
                    while a < stop {
                        if self.mmu.region_of(a).is_none() {
                            let mut z = a;
                            while z < stop && self.mmu.region_of(z).is_none() { z += PAGE; }
                            self.mmu.add_region(a, z - a);
                            a = z;
                        } else { a += PAGE; }
                    }
                    let data = b.get(off as usize..(off + fsz) as usize).ok_or("ELF segment outside the file")?;
                    self.mmu.write_bytes(va, data).map_err(|_| "out of memory")?;
                    if off == 0 && phdr == 0 { phdr = va + phoff as u64; }
                    end = end.max(stop);
                }
                3 => {
                    let (off, sz) = (u64_(p + 8) as usize, u64_(p + 32) as usize);
                    let s = b.get(off..off + sz).ok_or("bad interpreter path")?;
                    interp = Some(String::from_utf8_lossy(s).trim_end_matches('\0').to_string());
                }
                6 => phdr = u64_(p + 16) + base,
                _ => {}
            }
        }
        Ok((u64_(24) + base, phdr, phent as u64, phnum as u64, end, interp))
    }

    /// Maps an ELF program into the (empty) current address space and builds its start stack.
    /// A dynamic program also gets its loader (e.g. /lib/ld-musl-x86_64.so.1), which starts first.
    fn load_elf(&mut self, bytes: &[u8], exe: &str, args: &[String], env: &[String]) -> Result<(), String> {
        lx(self).exe = exe.to_string();
        let (entry, phdr, phent, phnum, end, interp) = self.map_elf(bytes, 0x5555_5555_4000)?;
        let (mut start_ip, mut ld_base) = (entry, 0u64);
        if let Some(ip) = interp {
            let l = lx(self);
            let q = l.resolve(&ip, true);
            let d = match l.fs.get(&q) { Some(Node::File(d)) => d.clone(), _ => return Err(format!("needs {} (its dynamic loader), which is not installed", ip)) };
            ld_base = 0x7F00_0000_0000;
            let r = self.map_elf(&d, ld_base)?;
            start_ip = r.0;
        }
        let l = lx(self);
        l.brk_start = end; l.brk = end; l.mmap_next = MMAP_BASE;

        // stack: argc, argv, envp, auxv, then the strings
        self.mmu.add_region(STACK_TOP - STACK_SIZE, STACK_SIZE);
        let mut sp = STACK_TOP - 0x100;
        let mut put = |e: &mut Engine, s: &[u8]| -> u64 { sp -= s.len() as u64 + 1; let _ = e.mmu.write_bytes(sp, s); e.w8(sp + s.len() as u64, 0); sp };
        let argp: Vec<u64> = args.iter().map(|a| put(self, a.as_bytes())).collect();
        let envp: Vec<u64> = env.iter().map(|a| put(self, a.as_bytes())).collect();
        let plat = put(self, b"x86_64");
        let rnd = put(self, b"0123456789abcdef");
        let exe_p = put(self, exe.as_bytes());
        let aux: [(u64, u64); 15] = [(3, phdr), (4, phent), (5, phnum), (6, PAGE), (7, ld_base), (8, 0), (9, entry),
            (11, 0), (12, 0), (13, 0), (14, 0), (16, 0x178bfbff), (17, 100), (25, rnd), (31, exe_p)];
        let words = 1 + argp.len() + 1 + envp.len() + 1 + 2 * (aux.len() + 2);
        let mut p = (sp - 8 * words as u64) & !15;
        let start = p;
        let mut w = |e: &mut Engine, v: u64| { e.w64(p, v); p += 8; };
        w(self, argp.len() as u64);
        for a in argp { w(self, a); }
        w(self, 0);
        for a in envp { w(self, a); }
        w(self, 0);
        for (k, v) in aux { w(self, k); w(self, v); }
        w(self, 15); w(self, plat);
        w(self, 0); w(self, 0);
        self.cpu.regs = [0; 16];
        self.cpu.fs_base = 0;
        self.cpu.regs[4] = start;
        self.cpu.rip = start_ip;
        Ok(())
    }
}

fn ret(e: &mut Engine, v: i64) { e.cpu.regs[0] = v as u64; }

fn stat_buf(e: &mut Engine, a: u64, mode: u32, size: u64, ino: u64) -> i64 {
    let mut b = [0u8; 144];
    b[0..8].copy_from_slice(&1u64.to_le_bytes());
    b[8..16].copy_from_slice(&ino.to_le_bytes());
    b[16..24].copy_from_slice(&1u64.to_le_bytes());
    b[24..28].copy_from_slice(&mode.to_le_bytes());
    b[48..56].copy_from_slice(&size.to_le_bytes());
    b[56..64].copy_from_slice(&4096u64.to_le_bytes());
    b[64..72].copy_from_slice(&((size + 511) / 512).to_le_bytes());
    let t = (crate::epoch_ms() / 1000.0) as u64;
    for o in [72, 88, 104] { b[o..o + 8].copy_from_slice(&t.to_le_bytes()); }
    if e.mmu.write_bytes(a, &b).is_err() { return -14; }
    0
}

fn stat_path(e: &mut Engine, path: &str, a: u64, follow: bool) -> i64 {
    let l = lx(e);
    let p = l.resolve(path, follow);
    let ino = p.bytes().fold(1469598103934665603u64, |h, c| (h ^ c as u64).wrapping_mul(1099511628211));
    let (mode, size) = match l.fs.get(&p) {
        _ if p == "/" => (0o040755, 4096),
        Some(Node::Dir) => (0o040755, 4096),
        Some(Node::File(d)) => (if p.starts_with("/dev/") { 0o020666 } else if p.starts_with("/bin/") || p.starts_with("/usr/bin/") { 0o100755 } else { 0o100644 }, d.len() as u64),
        Some(Node::Link(t)) => (0o120777, t.len() as u64),
        None => return -ENOENT,
    };
    stat_buf(e, a, mode, size, ino)
}

fn open(e: &mut Engine, path: &str, flags: u64) -> i64 {
    let l = lx(e);
    let p = l.resolve(path, true);
    let exists = p == "/" || l.fs.contains_key(&p);
    if l.is_dir(&p) {
        if flags & 3 != 0 { return -EISDIR; }
        let fd = l.new_fd(Fd::Dir { path: p, pos: 0 });
        if flags & 0x80000 != 0 { l.cloexec.insert(fd); }
        return fd as i64;
    }
    if flags & 0x10000 != 0 { return if exists { -ENOTDIR } else { -ENOENT }; }
    if p == "/dev/tty" || p == "/dev/console" { return l.new_fd(Fd::Tty) as i64; }
    if p == "/dev/zero" || p == "/dev/urandom" || p == "/dev/random" { let fd = l.new_fd(Fd::Dev(if p == "/dev/zero" { 0 } else { 1 })); if flags & 0x80000 != 0 { l.cloexec.insert(fd); } return fd as i64; }
    if !exists {
        if flags & 0x40 == 0 { return -ENOENT; }
        let dir = p.rsplit_once('/').map(|x| x.0).unwrap_or("/");
        if !l.is_dir(if dir.is_empty() { "/" } else { dir }) { return -ENOENT; }
        l.fs.insert(p.clone(), Node::File(Vec::new()));
    } else if flags & 0xC0 == 0xC0 {
        return -EEXIST;
    }
    if flags & 0x200 != 0 && flags & 3 != 0 { if let Some(Node::File(d)) = l.fs.get_mut(&p) { d.clear(); } }
    if flags & 3 != 0 && !p.starts_with("/dev/") { l.written.insert(p.clone()); }
    let fd = l.new_fd(Fd::File { path: p, pos: 0, append: flags & 0x400 != 0 });
    if flags & 0x80000 != 0 { l.cloexec.insert(fd); }
    fd as i64
}

fn path_at(e: &mut Engine, dirfd: u64, a: u64) -> String {
    let s = e.read_cstr(a, 4096);
    if s.starts_with('/') || dirfd as i32 == -100 { return s; }
    match lx(e).fds.get(&(dirfd as i32)) { Some(Fd::Dir { path, .. }) => format!("{}/{}", path, s), _ => s }
}

fn do_read(e: &mut Engine, fd: i32, buf: u64, n: u64) -> i64 {
    let l = lx(e);
    match l.fds.get_mut(&fd) {
        Some(Fd::Pipe { id, .. }) => {
            let id = *id;
            if l.pipes.get(&id).map_or(true, |b| b.is_empty()) {
                if has_end(l, id, true) { l.want = Some(Cond::PipeRead(id)); return BLOCKED; }
                return 0;
            }
            let b = l.pipes.get_mut(&id).unwrap();
            let k = (n as usize).min(b.len());
            let d: Vec<u8> = b.drain(..k).collect();
            if e.mmu.write_bytes(buf, &d).is_err() { return -14; }
            k as i64
        }
        Some(Fd::Sock { id }) => { let id = *id; sock_recv(e, id, buf, n, false).0 }
        Some(Fd::Dev(k)) => {
            let k = *k; let n = n.min(1 << 20) as usize;
            let mut d = vec![0u8; n];
            if k == 1 { let mut x = (crate::now_ms() * 1000.0) as u64 | 1; for c in d.iter_mut() { x ^= x << 13; x ^= x >> 7; x ^= x << 17; *c = x as u8; } }
            if e.mmu.write_bytes(buf, &d).is_err() { return -14; }
            n as i64
        }
        Some(Fd::Tty) => {
            if l.stdin.is_empty() {
                if l.stdin_eof { l.stdin_eof = false; return 0; }
                l.want = Some(Cond::Stdin);
                return BLOCKED;
            }
            let k = (n as usize).min(l.stdin.len());
            let d: Vec<u8> = l.stdin.drain(..k).collect();
            if e.mmu.write_bytes(buf, &d).is_err() { return -14; }
            k as i64
        }
        Some(Fd::File { path, pos, .. }) => {
            let (path, p) = (path.clone(), *pos);
            let d = match l.fs.get(&path) { Some(Node::File(d)) => d, _ => return -EBADF };
            let s = (p as usize).min(d.len());
            let k = (n as usize).min(d.len() - s);
            let chunk = d[s..s + k].to_vec();
            if let Some(Fd::File { pos, .. }) = l.fds.get_mut(&fd) { *pos += k as u64; }
            if e.mmu.write_bytes(buf, &chunk).is_err() { return -14; }
            k as i64
        }
        Some(Fd::Dir { .. }) => -EISDIR,
        None => -EBADF,
    }
}

fn do_write(e: &mut Engine, fd: i32, buf: u64, n: u64) -> i64 {
    let mut d = vec![0u8; n.min(1 << 24) as usize];
    if e.mmu.read_bytes(buf, &mut d).is_err() { return -14; }
    write_data(e, fd, &d)
}

fn write_data(e: &mut Engine, fd: i32, d: &[u8]) -> i64 {
    let n = d.len() as u64;
    let l = lx(e);
    match l.fds.get_mut(&fd) {
        Some(Fd::Tty) => { crate::console(&String::from_utf8_lossy(&d)); n as i64 }
        Some(Fd::Sock { id }) => { let id = *id; sock_send(l, id, d, None) }
        Some(Fd::Dev(_)) => n as i64,
        Some(Fd::Pipe { id, .. }) => {
            let id = *id;
            if !has_end(l, id, false) { return -EPIPE; }
            l.pipes.entry(id).or_default().extend(d.iter());
            n as i64
        }
        Some(Fd::File { path, pos, append }) => {
            let (path, p, app) = (path.clone(), *pos, *append);
            if path == "/dev/null" { return n as i64; }
            let f = match l.fs.get_mut(&path) { Some(Node::File(f)) => f, _ => return -EBADF };
            let at = if app { f.len() } else { p as usize };
            if f.len() < at + d.len() { f.resize(at + d.len(), 0); }
            f[at..at + d.len()].copy_from_slice(&d);
            if let Some(Fd::File { pos, .. }) = l.fds.get_mut(&fd) { *pos = (at + d.len()) as u64; }
            n as i64
        }
        Some(Fd::Dir { .. }) => -EISDIR,
        None => -EBADF,
    }
}

/// The `syscall` instruction (rip already points after it).
pub fn syscall(e: &mut Engine) {
    let _g = crate::lock::lock();
    let r = e.cpu.regs;
    let (nr, a0, a1, a2, a3, a4) = (r[0], r[7], r[6], r[2], r[10], r[8]);
    let _ = a4;
    e.cpu.regs[1] = e.cpu.rip;
    e.cpu.regs[11] = 0x202;
    #[cfg(feature = "prof")]
    crate::console(&format!("[sys pid {} {} {:x} {:x} {:x}]\n", lx(e).pid, nr, a0, a1, a2));
    if matches!(nr, 2 | 257 | 76 | 77 | 82 | 264 | 316 | 83 | 258 | 84 | 87 | 263 | 86 | 88 | 265 | 266) || (matches!(nr, 1 | 18 | 20) && matches!(lx(e).fds.get(&(a0 as i32)), Some(Fd::File { .. }))) { lx(e).dirty = true; }
    let v: i64 = match nr {
        0 => do_read(e, a0 as i32, a1, a2),
        22 | 293 => { // pipe / pipe2
            let l = lx(e);
            let id = l.next_pipe; l.next_pipe += 1;
            l.pipes.insert(id, Default::default());
            let r = l.new_fd(Fd::Pipe { id, w: false });
            let w = l.new_fd(Fd::Pipe { id, w: true });
            if nr == 293 && a1 & 0x80000 != 0 { l.cloexec.insert(r); l.cloexec.insert(w); }
            e.w32(a0, r as u32); e.w32(a0 + 4, w as u32);
            0
        }
        56 if a0 & 0x100 != 0 && a0 & 0x4000 == 0 => -ENOSYS, // threads (CLONE_VM): not yet
        56 | 57 | 58 => fork(e),
        59 | 322 => {
            let path = if nr == 59 { e.read_cstr(a0, 4096) } else { path_at(e, a0, a1) };
            let (av, ev) = if nr == 59 { (a1, a2) } else { (a2, a3) };
            let strs = |e: &mut Engine, mut p: u64| { let mut v = Vec::new(); while p != 0 && v.len() < 4096 { let s = e.r64(p); if s == 0 { break; } v.push(e.read_cstr(s, 1 << 17)); p += 8; } v };
            let args = strs(e, av); let env = strs(e, ev);
            execve(e, &path, args, env)
        }
        61 => { if a3 != 0 { let _ = e.mmu.write_bytes(a3, &[0u8; 144]); } wait4(e, a0 as i32 as i64, a1, a2) }
        60 | 231 => { exit_proc(e, ((a0 & 0xFF) << 8) as i32); NORET }
        39 | 186 => lx(e).pid as i64,
        110 => { let l = lx(e); l.procs.get(&l.pid).map_or(0, |p| p.ppid) as i64 }
        62 => { // kill
            let pid = a0 as i32;
            let me = lx(e).pid;
            // signals whose default is to stop, continue or nothing: no effect here
            if a1 == 0 || !matches!(a1, 1 | 2 | 3 | 6 | 9 | 13 | 14 | 15) { 0 } else if pid as u32 == me || pid == 0 || pid == -1 { exit_proc(e, (a1 & 0x7F) as i32); NORET } else if pid > 0 && lx(e).procs.get(&(pid as u32)).map_or(false, |p| p.zombie.is_none()) { kill_proc(e, pid as u32, (a1 & 0x7F) as i32); 0 } else { -3 }
        }
        1 => do_write(e, a0 as i32, a1, a2),
        2 => { let p = e.read_cstr(a0, 4096); open(e, &p, a1) }
        257 => { let p = path_at(e, a0, a1); open(e, &p, a2) }
        3 => { let l = lx(e); l.cloexec.remove(&(a0 as i32)); if l.fds.remove(&(a0 as i32)).is_some() { 0 } else { -EBADF } }
        4 | 6 => { let p = e.read_cstr(a0, 4096); stat_path(e, &p, a1, nr == 4) }
        262 => { // newfstatat
            let p = path_at(e, a0, a1);
            if p.is_empty() && a3 & 0x1000 != 0 { fstat(e, a0 as i32, a2) } else { stat_path(e, &p, a2, a3 & 0x100 == 0) }
        }
        5 => fstat(e, a0 as i32, a1),
        8 => { // lseek
            let l = lx(e);
            let size = match l.fds.get(&(a0 as i32)) { Some(Fd::File { path, .. }) => match l.fs.get(path) { Some(Node::File(d)) => d.len() as i64, _ => 0 }, Some(Fd::Tty) | Some(Fd::Pipe { .. }) | Some(Fd::Sock { .. }) | Some(Fd::Dev(_)) => return ret(e, -ESPIPE), Some(Fd::Dir { .. }) => 0, None => return ret(e, -EBADF) };
            match l.fds.get_mut(&(a0 as i32)) {
                Some(Fd::File { pos, .. }) => {
                    let np = match a2 { 0 => a1 as i64, 1 => *pos as i64 + a1 as i64, 2 => size + a1 as i64, _ => -1 };
                    if np < 0 { -EINVAL } else { *pos = np as u64; np }
                }
                Some(Fd::Dir { pos, .. }) => { *pos = a1 as usize; a1 as i64 }
                _ => -EINVAL,
            }
        }
        9 => mmap(e, a0, a1, a2, a3, r[8] as i32, r[9]),
        10 | 26 | 28 => 0, // mprotect, msync, madvise
        11 => { e.mmu.drop_pages(a0, a0 + align(a1)); 0 }
        25 => -ENOMEM, // mremap: callers fall back to mmap + copy
        12 => { // brk
            let l = lx(e);
            let (cur, start) = (l.brk, l.brk_start);
            if a0 > cur && a0 < start + (1 << 30) {
                let (from, to) = (align(cur), align(a0));
                if to > from { e.mmu.add_region(from, to - from); }
                lx(e).brk = a0;
                a0 as i64
            } else if a0 >= start && a0 <= cur { lx(e).brk = a0; a0 as i64 } else { cur as i64 }
        }
        13 | 14 | 15 | 127 | 130 | 131 => 0, // signals: accepted, never delivered
        16 => ioctl(e, a0 as i32, a1, a2),
        40 => { // sendfile
            let (out, inp, offp, n) = (a0 as i32, a1 as i32, a2, a3.min(1 << 20));
            let buf = 0x7FFF_EFF0_0000u64; // scratch at the bottom of the stack region
            let _ = buf;
            let l = lx(e);
            let (path, pos) = match l.fds.get(&inp) { Some(Fd::File { path, pos, .. }) => (path.clone(), *pos), _ => return ret(e, -EINVAL) };
            let at = if offp != 0 { e.r64(offp) } else { pos };
            let d = match lx(e).fs.get(&path) { Some(Node::File(d)) => { let s = (at as usize).min(d.len()); d[s..(s + n as usize).min(d.len())].to_vec() } _ => return ret(e, -EBADF) };
            let k = write_data(e, out, &d);
            if k > 0 {
                if offp != 0 { e.w64(offp, at + k as u64); } else if let Some(Fd::File { pos, .. }) = lx(e).fds.get_mut(&inp) { *pos += k as u64; }
            }
            k
        }
        17 => { let fd = a0 as i32; let k = do_pread(e, fd, a1, a2, a3); k }
        19 | 20 => { // readv / writev
            let mut tot = 0i64;
            for k in 0..a2.min(1024) {
                let (b, n) = (e.r64(a1 + 16 * k), e.r64(a1 + 16 * k + 8));
                if n == 0 { continue; }
                let got = if nr == 19 { do_read(e, a0 as i32, b, n) } else { do_write(e, a0 as i32, b, n) };
                if got < 0 { if tot == 0 { tot = got; } break; }
                tot += got;
                if (got as u64) < n { break; }
            }
            tot
        }
        21 | 269 => { // access / faccessat
            let p = if nr == 21 { e.read_cstr(a0, 4096) } else { path_at(e, a0, a1) };
            let l = lx(e); let q = l.resolve(&p, true);
            if q == "/" || l.fs.contains_key(&q) { 0 } else { -ENOENT }
        }
        7 | 271 if poll_socks(e, a0, a1, nr, a2) => NORET,
        41..=55 | 288 => net_call(e, nr, a0, a1, a2, a3, a4, r[9]),
        23 | 7 | 271 => { // select / poll / ppoll: everything is ready
            if nr == 7 || nr == 271 { for k in 0..a1.min(64) { let ev = e.r16(a0 + 8 * k + 4); e.w16(a0 + 8 * k + 6, ev & 5); } a1 as i64 } else { 1 }
        }
        24 => 0, // sched_yield
        165 | 166 => -1, // mount / umount2: EPERM, as for a program without the right to mount
        73 => 0, // flock: one machine, nobody else holds the lock
        37 => 0, // alarm
        38 => { if a2 != 0 { let _ = e.mmu.write_bytes(a2, &[0u8; 32]); } 0 } // setitimer: timers are not delivered
        32 => { let l = lx(e); match l.fds.get(&(a0 as i32)).cloned() { Some(f) => l.new_fd(f) as i64, None => -EBADF } }
        33 | 292 => { // dup2 / dup3
            let l = lx(e);
            let Some(f) = l.fds.get(&(a0 as i32)).cloned() else { return ret(e, -EBADF) };
            if a0 != a1 { l.fds.insert(a1 as i32, f); if nr == 292 && a2 & 0x80000 != 0 { l.cloexec.insert(a1 as i32); } else { l.cloexec.remove(&(a1 as i32)); } }
            a1 as i64
        }
        35 => { // nanosleep
            let ms = e.r64(a0) as f64 * 1000.0 + e.r64(a0 + 8) as f64 / 1e6;
            if ms <= 0.0 { 0 } else { lx(e).want = Some(Cond::Until); e.cpu.rip -= 2; e.block_linux(Cond::Until, Some(ms)); lx(e).want = None; NORET }
        }
        102 => lx(e).ids.0 as i64, // getuid
        107 => lx(e).ids.2 as i64, // geteuid
        104 | 108 => lx(e).ids.1 as i64, // getgid / getegid
        105 => { let l = lx(e); if l.ids.2 == 0 { l.ids.0 = a0 as u32; } l.ids.2 = a0 as u32; 0 } // setuid
        113 | 117 => { let l = lx(e); if a0 as i32 != -1 { l.ids.0 = a0 as u32; } if a1 as i32 != -1 { l.ids.2 = a1 as u32; } 0 } // setreuid / setresuid
        106 | 114 | 119 => { let l = lx(e); let v = if nr == 106 { a0 } else if a1 as i32 != -1 { a1 } else { a0 }; if v as i32 != -1 { l.ids.1 = v as u32; } 0 } // setgid / setregid / setresgid
        118 | 120 => { let i = lx(e).ids; let v = if nr == 118 { [i.0, i.2, i.2] } else { [i.1; 3] }; for (p, x) in [a0, a1, a2].into_iter().zip(v) { if p != 0 { e.w32(p, x); } } 0 }
        116 | 115 => 0, // setgroups / getgroups (none)
        122 | 123 => lx(e).ids.0 as i64, // setfsuid / setfsgid
        109 | 112 => 0,
        121 => if a0 == 0 { lx(e).pid as i64 } else { a0 as i64 }, // getpgid
        111 => lx(e).pid as i64, // getpgrp
        124 => 1, // getsid
        435 => -ENOSYS, // clone3: callers fall back to clone
        247 => -ECHILD, // waitid
        200 | 234 => 0, // tkill / tgkill
        63 => { // uname
            let mut b = [0u8; 390];
            for (k, s) in ["Linux", "inksoc", "6.1.0-inksoc", "#1 SMP InkSoC", "x86_64", "(none)"].iter().enumerate() { b[65 * k..65 * k + s.len()].copy_from_slice(s.as_bytes()); }
            if e.mmu.write_bytes(a0, &b).is_err() { -14 } else { 0 }
        }
        72 if (a1 == 3 || a1 == 4) && matches!(lx(e).fds.get(&(a0 as i32)), Some(Fd::Sock { .. })) => { // F_GETFL / F_SETFL on a socket: O_NONBLOCK
            let l = lx(e);
            let Some(Fd::Sock { id }) = l.fds.get(&(a0 as i32)).cloned() else { unreachable!() };
            let s = l.socks.get_mut(&id).unwrap();
            if a1 == 4 { s.nb = a2 & 0x800 != 0; 0 } else { 2 | if s.nb { 0x800 } else { 0 } }
        }
        72 => { // fcntl
            let l = lx(e);
            let fd = a0 as i32;
            match (a1, l.fds.get(&fd).cloned()) {
                (_, None) => -EBADF,
                (0 | 1030, Some(f)) => { let n = l.new_fd_from(a2 as i32, f); if a1 == 1030 { l.cloexec.insert(n); } n as i64 }
                (1, _) => l.cloexec.contains(&fd) as i64,
                (2, _) => { if a2 & 1 != 0 { l.cloexec.insert(fd); } else { l.cloexec.remove(&fd); } 0 }
                (3, Some(Fd::Pipe { w, .. })) => w as i64,
                (3, _) => 2,
                _ => 0,
            }
        }
        74 | 75 | 162 => 0, // fsync / fdatasync / sync
        77 => { let l = lx(e); if let Some(Fd::File { path, .. }) = l.fds.get(&(a0 as i32)) { let p = path.clone(); if let Some(Node::File(d)) = l.fs.get_mut(&p) { d.resize(a1 as usize, 0); } } 0 }
        76 => { let p = e.read_cstr(a0, 4096); let l = lx(e); let q = l.resolve(&p, true); if let Some(Node::File(d)) = l.fs.get_mut(&q) { d.resize(a1 as usize, 0); 0 } else { -ENOENT } }
        78 | 217 => getdents(e, a0 as i32, a1, a2),
        79 => { // getcwd
            let c = lx(e).cwd.clone();
            if c.len() + 1 > a1 as usize { -ERANGE } else { let _ = e.mmu.write_bytes(a0, c.as_bytes()); e.w8(a0 + c.len() as u64, 0); c.len() as i64 + 1 }
        }
        80 => { let p = e.read_cstr(a0, 4096); let l = lx(e); let q = l.resolve(&p, true); if l.is_dir(&q) { l.cwd = q; 0 } else if l.fs.contains_key(&q) { -ENOTDIR } else { -ENOENT } }
        81 => { let l = lx(e); match l.fds.get(&(a0 as i32)) { Some(Fd::Dir { path, .. }) => { l.cwd = path.clone(); 0 } _ => -ENOTDIR } }
        82 | 264 | 316 => { // rename / renameat / renameat2
            let (f, t) = if nr == 82 { (e.read_cstr(a0, 4096), e.read_cstr(a1, 4096)) } else { (path_at(e, a0, a1), path_at(e, a2, a3)) };
            let l = lx(e); let (f, t) = (l.resolve(&f, false), l.resolve(&t, false));
            let keys: Vec<String> = l.fs.keys().filter(|k| **k == f || k.starts_with(&format!("{}/", f))).cloned().collect();
            if keys.is_empty() { -ENOENT } else { for k in keys { let n = l.fs.remove(&k).unwrap(); let nk = format!("{}{}", t, &k[f.len()..]); l.written.remove(&k); if matches!(n, Node::File(_)) { l.written.insert(nk.clone()); } l.fs.insert(nk, n); } 0 }
        }
        83 | 258 => { // mkdir / mkdirat
            let p = if nr == 83 { e.read_cstr(a0, 4096) } else { path_at(e, a0, a1) };
            let l = lx(e); let q = l.resolve(&p, false);
            if l.fs.contains_key(&q) { -EEXIST } else { l.fs.insert(q, Node::Dir); 0 }
        }
        84 | 87 | 263 => { // rmdir / unlink / unlinkat
            let (p, dir) = if nr == 263 { (path_at(e, a0, a1), a2 & 0x200 != 0) } else { (e.read_cstr(a0, 4096), nr == 84) };
            let l = lx(e); let q = l.resolve(&p, false);
            match l.fs.get(&q) {
                None => -ENOENT,
                Some(Node::Dir) if !dir => -EISDIR,
                Some(Node::Dir) if !l.children(&q).is_empty() => -ENOTEMPTY,
                Some(Node::Dir) => { l.fs.remove(&q); 0 }
                Some(_) if dir => -ENOTDIR,
                Some(_) => { l.fs.remove(&q); l.written.remove(&q); 0 }
            }
        }
        86 | 88 | 265 | 266 => { // link / symlink / linkat / symlinkat
            let (t, n) = match nr { 88 => (e.read_cstr(a0, 4096), e.read_cstr(a1, 4096)), 266 => (e.read_cstr(a0, 4096), path_at(e, a1, a2)), 86 => (e.read_cstr(a0, 4096), e.read_cstr(a1, 4096)), _ => (path_at(e, a0, a1), path_at(e, a2, a3)) };
            let l = lx(e); let q = l.resolve(&n, false);
            if l.fs.contains_key(&q) { -EEXIST } else if nr == 88 || nr == 266 { l.fs.insert(q, Node::Link(t)); 0 } else {
                let src = l.resolve(&t, true);
                match l.fs.get(&src) { Some(Node::File(d)) => { let d = d.clone(); l.fs.insert(q, Node::File(d)); 0 } _ => -ENOENT }
            }
        }
        89 | 267 => { // readlink / readlinkat
            let (p, b, n) = if nr == 89 { (e.read_cstr(a0, 4096), a1, a2) } else { (path_at(e, a0, a1), a2, a3) };
            let l = lx(e); let q = l.resolve(&p, false);
            match l.fs.get(&q) { Some(Node::Link(t)) => { let t = t.clone(); let k = t.len().min(n as usize); let _ = e.mmu.write_bytes(b, &t.as_bytes()[..k]); k as i64 } Some(_) => -EINVAL, None => -ENOENT }
        }
        90 | 91 | 92 | 93 | 94 | 95 | 268 | 260 | 280 | 235 | 132 => 0, // chmod, chown, umask, utimes...
        96 => { // gettimeofday
            let ms = crate::epoch_ms();
            if a0 != 0 { e.w64(a0, (ms / 1000.0) as u64); e.w64(a0 + 8, ((ms % 1000.0) * 1000.0) as u64); }
            0
        }
        97 | 302 => { if nr == 302 && a3 != 0 { e.w64(a3, u64::MAX); e.w64(a3 + 8, u64::MAX); } 0 } // getrlimit / prlimit64
        98 => { let _ = e.mmu.write_bytes(a1, &[0u8; 144]); 0 } // getrusage
        99 => { let mut b = [0u8; 112]; b[32..40].copy_from_slice(&(1u64 << 33).to_le_bytes()); b[40..48].copy_from_slice(&(1u64 << 32).to_le_bytes()); b[104..108].copy_from_slice(&1u32.to_le_bytes()); let _ = e.mmu.write_bytes(a0, &b); 0 } // sysinfo
        100 => { let _ = e.mmu.write_bytes(a0, &[0u8; 32]); 0 } // times
        137 | 138 => { let mut b = [0u8; 120]; b[0..8].copy_from_slice(&0xEF53u64.to_le_bytes()); b[8..16].copy_from_slice(&4096u64.to_le_bytes()); b[16..24].copy_from_slice(&(1u64 << 20).to_le_bytes()); b[24..32].copy_from_slice(&(1u64 << 19).to_le_bytes()); b[32..40].copy_from_slice(&(1u64 << 19).to_le_bytes()); b[56..64].copy_from_slice(&255u64.to_le_bytes()); let _ = e.mmu.write_bytes(a1, &b); 0 } // statfs
        158 => { // arch_prctl
            match a0 { 0x1002 => { e.cpu.fs_base = a1; 0 } 0x1003 => { e.w64(a1, e.cpu.fs_base); 0 } 0x1001 => { e.cpu.gs_base = a1; 0 } _ => -EINVAL }
        }
        201 => { let t = (crate::epoch_ms() / 1000.0) as i64; if a0 != 0 { e.w64(a0, t as u64); } t }
        202 => 0, // futex: one thread, nothing to wait for
        203 | 204 => { if nr == 204 { e.w64(a2, 1); } if nr == 204 { 8 } else { 0 } } // sched_setaffinity / getaffinity
        218 => 1, // set_tid_address
        228 => { // clock_gettime
            let ms = if a0 == 0 || a0 == 5 || a0 == 8 { crate::epoch_ms() } else { crate::now_ms() };
            e.w64(a1, (ms / 1000.0) as u64); e.w64(a1 + 8, ((ms % 1000.0) * 1e6) as u64);
            0
        }
        229 => { e.w64(a1, 0); e.w64(a1 + 8, 1); 0 }
        230 => { // clock_nanosleep (relative)
            let ms = e.r64(a2) as f64 * 1000.0 + e.r64(a2 + 8) as f64 / 1e6;
            if ms <= 0.0 || a1 & 1 != 0 { 0 } else { e.cpu.rip -= 2; e.block_linux(Cond::Until, Some(ms)); NORET }
        }
        273 | 334 => 0, // set_robust_list / rseq
        318 => { // getrandom
            let mut s = (crate::now_ms() * 1000.0) as u64 | 1;
            for k in 0..a1.min(1 << 20) { s ^= s << 13; s ^= s >> 7; s ^= s << 17; e.w8(a0 + k, s as u8); }
            a1 as i64
        }
        332 => { // statx
            let p = path_at(e, a0, a1);
            let tmp = 0u64;
            let _ = tmp;
            statx(e, &p, a0 as i32, a2, r[8])
        }
        _ => {
            if lx(e).unknown.insert(nr) { crate::console(&format!("[inksoc] Linux system call {} is not available yet\n", nr)); }
            -ENOSYS
        }
    };
    if v == BLOCKED {
        let c = lx(e).want.take().unwrap_or(Cond::Until);
        e.cpu.regs[0] = nr; // runs again from the start when woken
        e.cpu.rip -= 2;
        e.block_linux(c, None);
        return;
    }
    lx(e).want = None;
    if v != NORET { ret(e, v); }
}

impl Lx {
    fn new_fd_from(&mut self, min: i32, f: Fd) -> i32 {
        let mut n = min.max(0);
        while self.fds.contains_key(&n) { n += 1; }
        self.fds.insert(n, f);
        n
    }
}

fn do_pread(e: &mut Engine, fd: i32, buf: u64, n: u64, off: u64) -> i64 {
    let l = lx(e);
    let path = match l.fds.get(&fd) { Some(Fd::File { path, .. }) => path.clone(), _ => return -ESPIPE };
    let d = match l.fs.get(&path) { Some(Node::File(d)) => d, _ => return -EBADF };
    let s = (off as usize).min(d.len());
    let k = (n as usize).min(d.len() - s);
    let chunk = d[s..s + k].to_vec();
    if e.mmu.write_bytes(buf, &chunk).is_err() { return -14; }
    k as i64
}

fn fstat(e: &mut Engine, fd: i32, a: u64) -> i64 {
    let l = lx(e);
    match l.fds.get(&fd) {
        Some(Fd::Pipe { id, .. }) => { let id = *id as u64; stat_buf(e, a, 0o010600, 0, 1000 + id) }
        Some(Fd::Tty) => stat_buf(e, a, 0o020620, 0, 5),
        Some(Fd::Sock { id }) => { let id = *id as u64; stat_buf(e, a, 0o140777, 0, 5000 + id) }
        Some(Fd::Dev(k)) => { let k = *k as u64; stat_buf(e, a, 0o020666, 0, 7 + k) }
        Some(Fd::File { path, .. }) | Some(Fd::Dir { path, .. }) => { let p = path.clone(); stat_path(e, &p, a, true) }
        None => -EBADF,
    }
}

fn statx(e: &mut Engine, path: &str, dirfd: i32, flags: u64, buf: u64) -> i64 {
    let mut st = [0u8; 144];
    let tmp = 0x7FFF_EFFF_F000u64; // scratch inside the stack region
    let _ = st;
    let r = if path.is_empty() && flags & 0x1000 != 0 { fstat(e, dirfd, tmp) } else { stat_path(e, path, tmp, flags & 0x100 == 0) };
    if r < 0 { return r; }
    let _ = e.mmu.read_bytes(tmp, &mut st);
    let g = |o: usize| u64::from_le_bytes(st[o..o + 8].try_into().unwrap());
    let mut b = [0u8; 256];
    b[0..4].copy_from_slice(&0x7FFu32.to_le_bytes());
    b[4..8].copy_from_slice(&4096u32.to_le_bytes());
    b[16..20].copy_from_slice(&1u32.to_le_bytes());
    b[28..30].copy_from_slice(&(u32::from_le_bytes(st[24..28].try_into().unwrap()) as u16).to_le_bytes());
    b[32..40].copy_from_slice(&g(8).to_le_bytes());
    b[40..48].copy_from_slice(&g(48).to_le_bytes());
    b[48..56].copy_from_slice(&g(64).to_le_bytes());
    for o in [64, 80, 96, 112] { b[o..o + 8].copy_from_slice(&g(72).to_le_bytes()); }
    if e.mmu.write_bytes(buf, &b).is_err() { -14 } else { 0 }
}

fn ioctl(e: &mut Engine, fd: i32, req: u64, a: u64) -> i64 {
    let tty = matches!(lx(e).fds.get(&fd), Some(Fd::Tty));
    if !lx(e).fds.contains_key(&fd) { return -EBADF; }
    if !tty { return -ENOTTY; }
    match req {
        0x5401 => { // TCGETS: what the program set last (a cooked terminal at first)
            let t = lx(e).termios.clone().unwrap_or_else(|| {
                let mut t = vec![0u8; 36];
                t[0..4].copy_from_slice(&0x500u32.to_le_bytes()); // ICRNL | IXON
                t[4..8].copy_from_slice(&0x5u32.to_le_bytes()); // OPOST | ONLCR
                t[8..12].copy_from_slice(&0xBFu32.to_le_bytes()); // CS8 | CREAD | B38400
                t[12..16].copy_from_slice(&0x8A3Bu32.to_le_bytes()); // ISIG | ICANON | ECHO...
                t[17..28].copy_from_slice(&[3, 0x1C, 0x7F, 0x15, 4, 0, 1, 0, 0x11, 0x13, 0x1A]); // ^C ^\ DEL ^U ^D, VMIN 1, ^Q ^S ^Z
                t
            });
            let lf = lx(e).lflag; e.w32(a + 12, lf);
            if e.mmu.write_bytes(a, &t[..12]).is_err() { -14 } else { let _ = e.mmu.write_bytes(a + 16, &t[16..]); 0 }
        }
        0x5402..=0x5404 => {
            let mut t = vec![0u8; 36];
            let _ = e.mmu.read_bytes(a, &mut t);
            let l = lx(e);
            l.lflag = u32::from_le_bytes(t[12..16].try_into().unwrap());
            l.termios = Some(t);
            0
        }
        0x5413 => { let (rows, cols) = lx(e).winsize; let w: [u16; 4] = [rows, cols, 0, 0]; for (k, v) in w.iter().enumerate() { e.w16(a + 2 * k as u64, *v); } 0 }
        0x5414 => 0,
        0x540F => { e.w32(a, 1); 0 }
        0x5410 => 0,
        _ => -EINVAL,
    }
}

fn getdents(e: &mut Engine, fd: i32, buf: u64, n: u64) -> i64 {
    let l = lx(e);
    let (path, pos) = match l.fds.get(&fd) { Some(Fd::Dir { path, pos }) => (path.clone(), *pos), Some(_) => return -ENOTDIR, None => return -EBADF };
    let mut names = vec![".".to_string(), "..".to_string()];
    names.extend(l.children(&path));
    let mut out = Vec::new();
    let mut k = pos;
    while k < names.len() {
        let nm = &names[k];
        let full = if path == "/" { format!("/{}", nm) } else { format!("{}/{}", path, nm) };
        let ty = match l.fs.get(&full) { Some(Node::Dir) => 4u8, Some(Node::Link(_)) => 10, Some(Node::File(_)) => 8, None => 4 };
        let rec = (19 + nm.len() + 1 + 7) & !7;
        if out.len() + rec > n as usize { break; }
        let ino = full.bytes().fold(1469598103934665603u64, |h, c| (h ^ c as u64).wrapping_mul(1099511628211));
        out.extend_from_slice(&ino.to_le_bytes());
        out.extend_from_slice(&((k + 1) as u64).to_le_bytes());
        out.extend_from_slice(&(rec as u16).to_le_bytes());
        out.push(ty);
        out.extend_from_slice(nm.as_bytes());
        out.resize(out.len() + rec - 19 - nm.len(), 0);
        k += 1;
    }
    if let Some(Fd::Dir { pos, .. }) = l.fds.get_mut(&fd) { *pos = k; }
    if out.is_empty() && k < names.len() { return -EINVAL; }
    if e.mmu.write_bytes(buf, &out).is_err() { return -14; }
    out.len() as i64
}

fn mmap(e: &mut Engine, addr: u64, len: u64, _prot: u64, flags: u64, fd: i32, off: u64) -> i64 {
    let len = align(len.max(1));
    let a = if flags & 0x10 != 0 { // MAP_FIXED
        e.mmu.drop_pages(addr, addr + len);
        let mut p = addr & !(PAGE - 1);
        while p < addr + len { if e.mmu.region_of(p).is_none() { e.mmu.add_region(p, PAGE); } p += PAGE; }
        addr
    } else {
        if e.mmu.sh.committed + len > e.mmu.sh.target_bytes { return -ENOMEM; }
        let l = lx(e);
        let a = l.mmap_next;
        l.mmap_next += len + PAGE;
        e.mmu.add_region(a, len);
        a
    };
    if flags & 0x20 == 0 && fd >= 0 { // file mapping: copy the bytes in
        let l = lx(e);
        let path = match l.fds.get(&fd) { Some(Fd::File { path, .. }) => path.clone(), _ => return -EBADF };
        let d = match l.fs.get(&path) { Some(Node::File(d)) => d, _ => return -EBADF };
        let s = (off as usize).min(d.len());
        let k = (len as usize).min(d.len() - s);
        let chunk = d[s..s + k].to_vec();
        if e.mmu.write_bytes(a, &chunk).is_err() { return -ENOMEM; }
    }
    a as i64
}

/// Text typed in the terminal, for programs reading stdin.
#[no_mangle]
pub extern "C" fn linux_stdin(n: u32) {
    let e = crate::eng();
    let b = unsafe { crate::take_buf() };
    if let Some(l) = e.s.lx.as_mut() { l.stdin.extend_from_slice(&b[..(n as usize).min(b.len())]); }
}

/// Files the Linux program created or changed: same download path as Windows.
pub fn written(e: &Engine) -> Vec<(String, Vec<u8>)> {
    let Some(l) = e.s.lx.as_ref() else { return Vec::new() };
    l.written.iter().filter_map(|p| match l.fs.get(p) { Some(Node::File(d)) => Some((p.trim_start_matches("/root/").to_string(), d.clone())), _ => None }).collect()
}

/// Is there an open read end (`w` false) or write end (`w` true) of pipe `id` in any process?
fn has_end(l: &Lx, id: u32, w: bool) -> bool {
    let is = |f: &Fd| matches!(f, Fd::Pipe { id: i, w: x } if *i == id && *x == w);
    l.fds.values().any(is) || l.procs.values().any(|p| p.saved.as_ref().map_or(false, |s| s.fds.values().any(is)))
}

/// Can a Linux thread waiting on `c` go on?
pub fn ready(e: &mut Engine, c: &Cond) -> bool {
    let l = lx(e);
    match c {
        Cond::PipeRead(id) => l.pipes.get(id).map_or(true, |b| !b.is_empty()) || !has_end(l, *id, true),
        Cond::Child { parent, pid } => {
            let kids: Vec<(&u32, &Proc)> = l.procs.iter().filter(|(k, p)| p.ppid == *parent && (*pid <= 0 || **k as i64 == *pid)).collect();
            kids.is_empty() || kids.iter().any(|(_, p)| p.zombie.is_some())
        }
        Cond::Stdin => !l.stdin.is_empty() || l.stdin_eof,
        Cond::Until => false,
        Cond::Socks(ids) => ids.iter().any(|i| l.socks.get(i).map_or(true, |s| !s.rx.is_empty() || !s.dgrams.is_empty() || s.closed)),
        Cond::Poll { socks, stdin, pipes } => socks.iter().any(|i| l.socks.get(i).map_or(true, |s| !s.rx.is_empty() || !s.dgrams.is_empty() || s.closed || s.failed))
            || (*stdin && (!l.stdin.is_empty() || l.stdin_eof))
            || pipes.iter().any(|id| l.pipes.get(id).map_or(true, |b| !b.is_empty()) || !has_end(l, *id, true)),
    }
}

/// Makes process `pid` the running one (its memory, files and compiled code).
pub fn enter(e: &mut Engine, pid: u32) {
    if pid == 0 || lx(e).pid == pid { return; }
    let space = e.mmu.take_space();
    let jit = std::mem::take(&mut e.jit);
    let on = jit.on;
    let l = lx(e);
    let cur = l.pid;
    let saved = Saved {
        fds: std::mem::take(&mut l.fds), cloexec: std::mem::take(&mut l.cloexec), cwd: std::mem::take(&mut l.cwd),
        brk_start: l.brk_start, brk: l.brk, mmap_next: l.mmap_next, exe: std::mem::take(&mut l.exe), ids: l.ids, space, jit,
    };
    match l.procs.get_mut(&cur) { Some(p) => p.saved = Some(saved), None => e.mmu.free_saved(saved.space) }
    let l = lx(e);
    let Some(s) = l.procs.get_mut(&pid).and_then(|p| p.saved.take()) else { return };
    l.pid = pid;
    l.fds = s.fds; l.cloexec = s.cloexec; l.cwd = s.cwd; l.brk_start = s.brk_start; l.brk = s.brk; l.mmap_next = s.mmap_next; l.exe = s.exe; l.ids = s.ids;
    e.mmu.put_space(s.space);
    e.jit = s.jit;
    e.jit.on = on;
}

/// fork: the child gets a copy of the memory, the files and the registers (rax 0).
fn fork(e: &mut Engine) -> i64 {
    e.materialize();
    let Some(space) = e.mmu.clone_space() else { return -ENOMEM };
    let jit = e.jit.clone();
    let l = lx(e);
    let pid = l.next_pid; l.next_pid += 1;
    let saved = Saved {
        fds: l.fds.clone(), cloexec: l.cloexec.clone(), cwd: l.cwd.clone(),
        brk_start: l.brk_start, brk: l.brk, mmap_next: l.mmap_next, exe: l.exe.clone(), ids: l.ids, space, jit,
    };
    let me = l.pid;
    l.procs.insert(pid, Proc { ppid: me, saved: Some(saved), zombie: None });
    let mut cpu = e.cpu.clone();
    cpu.regs[0] = 0;
    e.spawn_linux(cpu, pid);
    pid as i64
}

/// The running process ends with wait status `status`.
fn exit_proc(e: &mut Engine, status: i32) {
    let l = lx(e);
    let pid = l.pid;
    if pid == 1 {
        e.s.exit_code = ((status >> 8) & 0xFF) as u32 | if status & 0x7F != 0 { 128 + (status & 0x7F) as u32 } else { 0 };
        e.s.exited = true;
        return;
    }
    l.fds.clear(); l.cloexec.clear();
    for p in l.procs.values_mut() { if p.ppid == pid { p.ppid = 1; } }
    if let Some(p) = l.procs.get_mut(&pid) { p.zombie = Some(status); }
    e.mmu.free_space();
    { let on = e.jit.on; e.jit = Default::default(); e.jit.on = on; }
    e.end_linux(pid);
}

fn kill_proc(e: &mut Engine, pid: u32, sig: i32) {
    let l = lx(e);
    let Some(p) = l.procs.get_mut(&pid) else { return };
    p.zombie = Some(sig);
    let saved = p.saved.take();
    for q in l.procs.values_mut() { if q.ppid == pid { q.ppid = 1; } }
    if let Some(s) = saved { e.mmu.free_saved(s.space); }
    e.end_linux(pid);
}

fn wait4(e: &mut Engine, pid: i64, status: u64, opts: u64) -> i64 {
    let l = lx(e);
    let me = l.pid;
    let kids: Vec<u32> = l.procs.iter().filter(|(k, p)| p.ppid == me && (pid <= 0 || **k as i64 == pid)).map(|(k, _)| *k).collect();
    if kids.is_empty() { return -ECHILD; }
    if let Some(&k) = kids.iter().find(|k| l.procs[k].zombie.is_some()) {
        let p = l.procs.remove(&k).unwrap();
        if let Some(s) = p.saved { e.mmu.free_saved(s.space); }
        if status != 0 { e.w32(status, p.zombie.unwrap() as u32); }
        return k as i64;
    }
    if opts & 1 != 0 { return 0; } // WNOHANG
    l.want = Some(Cond::Child { parent: me, pid });
    BLOCKED
}

/// execve: the running process becomes another program (same pid and open files).
fn execve(e: &mut Engine, path: &str, mut args: Vec<String>, env: Vec<String>) -> i64 {
    let l = lx(e);
    let mut p = l.resolve(path, true);
    let mut data = match l.fs.get(&p) { Some(Node::File(d)) => d.clone(), Some(Node::Dir) => return -13, _ => return -ENOENT };
    if data.starts_with(b"#!") { // script: run its interpreter
        let line = String::from_utf8_lossy(&data[2..data.iter().position(|&c| c == b'\n').unwrap_or(data.len()).min(256)]).trim().to_string();
        let mut it = line.splitn(2, char::is_whitespace);
        let interp = it.next().unwrap_or("").to_string();
        let mut na = vec![interp.clone()];
        if let Some(x) = it.next() { na.push(x.trim().to_string()); }
        na.push(path.to_string());
        na.extend(args.into_iter().skip(1));
        args = na;
        p = l.resolve(&interp, true);
        data = match l.fs.get(&p) { Some(Node::File(d)) => d.clone(), _ => return -ENOENT };
    }
    if !data.starts_with(b"\x7fELF") { return -ENOEXEC; }
    if args.is_empty() { args.push(p.clone()); }
    // set-uid programs (no file modes here): these run with effective uid 0, as on Alpine
    let base = path.rsplit('/').next().unwrap_or("");
    if matches!(base, "su" | "passwd" | "login" | "ping" | "ping6" | "traceroute" | "crontab" | "doas" | "sudo" | "newgrp" | "chsh" | "chfn" | "gpasswd") { l.ids.2 = 0; }
    // the old program goes away
    let cx: Vec<i32> = l.cloexec.iter().copied().collect();
    for fd in cx { l.fds.remove(&fd); }
    l.cloexec.clear();
    e.mmu.free_space();
    { let on = e.jit.on; e.jit = Default::default(); e.jit.on = on; }
    match e.load_elf(&data, &p, &args, &env) {
        Ok(()) => NORET,
        Err(m) => { crate::console(&format!("{}: {}\n", path, m)); exit_proc(e, 127 << 8); NORET }
    }
}

/// A child process hit a fatal error: it ends with a signal and the others go on.
/// false = it is the first process (the whole run stops with the error).
pub fn crash(e: &mut Engine, m: &str) -> bool {
    let Some(l) = e.s.lx.as_ref() else { return false };
    let pid = l.pid;
    if pid <= 1 || e.cur_pid() != pid { return false; }
    let sig = if m.starts_with("access violation") { 11 } else { 4 };
    crate::console(&format!("[inksoc] {} (process {} stopped)\n", m, pid));
    exit_proc(e, sig);
    e.cpu.jit_limit = 0;
    true
}

/// Terminal mode for the page: bit 2 = line mode (the page edits the line), bit 8 = echo.
#[no_mangle]
pub extern "C" fn linux_lflag() -> u32 { crate::eng().s.lx.as_ref().map_or(0x8A3B, |l| l.lflag) }

#[no_mangle]
pub extern "C" fn linux_winsize(rows: u32, cols: u32) {
    if let Some(l) = crate::eng().s.lx.as_mut() { l.winsize = (rows.clamp(2, 500) as u16, cols.clamp(10, 1000) as u16); }
}

/// Ctrl+D: the next read of the terminal returns 0 (end of input).
#[no_mangle]
pub extern "C" fn linux_eof() { if let Some(l) = crate::eng().s.lx.as_mut() { l.stdin_eof = true; } }

/// Ctrl+C: stops every program started from the shell (the shell itself stays).
#[no_mangle]
pub extern "C" fn linux_interrupt() {
    let e = crate::eng();
    let Some(l) = e.s.lx.as_mut() else { return };
    l.stdin.clear();
    let alive: Vec<u32> = l.procs.iter().filter(|(k, p)| **k != 1 && p.zombie.is_none()).map(|(k, _)| *k).collect();
    let cur = l.pid;
    for pid in alive {
        if pid == cur && e.cur_pid() == pid { exit_proc(e, 2); } else if pid == cur { exit_proc(e, 2); } else { kill_proc(e, pid, 2); }
    }
    crate::lock::kick();
}

/// Adds a file from the page ("path\0data" in the buffer) to the file tree.
#[no_mangle]
pub extern "C" fn linux_put_file() {
    let e = crate::eng();
    let b = unsafe { crate::take_buf() };
    let nl = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    let name = String::from_utf8_lossy(&b[..nl]).into_owned();
    let Some(l) = e.s.lx.as_mut() else { return };
    // relative names go to the user's home (the Alpine terminal keeps the user name in /etc/inksoc/user)
    let home = match l.fs.get("/etc/inksoc/user") { Some(Node::File(d)) if !d.is_empty() => format!("/home/{}", String::from_utf8_lossy(d).trim()), _ => "/root".to_string() };
    let path = l.abs(&if name.starts_with('/') { name } else { format!("{}/{}", home, name) });
    l.put(&path, b.get(nl + 1..).unwrap_or(&[]).to_vec());
    l.dirty = true;
}

/// Reads a file of the tree (path in the buffer) for the page to download; its size, or -1.
#[no_mangle]
pub extern "C" fn linux_get_file() -> i32 {
    let e = crate::eng();
    let b = unsafe { crate::take_buf() };
    let Some(l) = e.s.lx.as_ref() else { return -1 };
    let p = l.resolve(&String::from_utf8_lossy(&b), true);
    match l.fs.get(&p) { Some(Node::File(d)) => crate::set_out(d.clone()) as i32, _ => -1 }
}

// ---------------------------------------------------------------- network

fn sock_send(l: &mut Lx, id: u32, d: &[u8], to: Option<[u8; 16]>) -> i64 {
    let Some(s) = l.socks.get_mut(&id) else { return -EBADF };
    if s.udp {
        let to = to.unwrap_or(s.peer);
        if u16::from_be_bytes([to[2], to[3]]) == 53 { if let Some(r) = dns_answer(&mut l.dns, d) { l.socks.get_mut(&id).unwrap().dgrams.push_back((r, to)); } }
        return d.len() as i64;
    }
    if s.failed { return -ECONNREFUSED; }
    if !s.open { return -ENOTCONN; }
    if s.closed { return -EPIPE; }
    net_event(&mut l.net_out, 2, id, d);
    d.len() as i64
}

/// Reads from a socket: (result, source address for UDP).
fn sock_recv(e: &mut Engine, id: u32, buf: u64, n: u64, dontwait: bool) -> (i64, Option<[u8; 16]>) {
    let l = lx(e);
    let Some(s) = l.socks.get_mut(&id) else { return (-EBADF, None) };
    if s.udp {
        let Some((d, from)) = s.dgrams.pop_front() else {
            if s.nb || dontwait { return (-EAGAIN, None); }
            l.want = Some(Cond::Socks(vec![id])); return (BLOCKED, None);
        };
        let k = d.len().min(n as usize);
        let _ = e.mmu.write_bytes(buf, &d[..k]);
        return (k as i64, Some(from));
    }
    if s.rx.is_empty() {
        if s.failed { return (-ECONNREFUSED, None); }
        if s.closed || !s.open { return (0, None); }
        if s.nb || dontwait { return (-EAGAIN, None); }
        l.want = Some(Cond::Socks(vec![id])); return (BLOCKED, None);
    }
    let k = (n as usize).min(s.rx.len());
    let d: Vec<u8> = s.rx.drain(..k).collect();
    if e.mmu.write_bytes(buf, &d).is_err() { return (-14, None); }
    (k as i64, None)
}

fn net_event(out: &mut Vec<u8>, op: u8, id: u32, d: &[u8]) {
    out.push(op); out.extend_from_slice(&id.to_le_bytes()); out.extend_from_slice(&(d.len() as u32).to_le_bytes()); out.extend_from_slice(d);
}

/// A DNS question answered here: an A record gets 198.18.x.y (the name is kept), other types get no answer.
fn dns_answer(names: &mut Vec<String>, q: &[u8]) -> Option<Vec<u8>> {
    if q.len() < 17 { return None; }
    let mut o = 12; let mut labels = Vec::new();
    while o < q.len() && q[o] != 0 { let n = q[o] as usize; labels.push(String::from_utf8_lossy(q.get(o + 1..o + 1 + n)?).to_string()); o += 1 + n; }
    o += 1;
    let qtype = u16::from_be_bytes([*q.get(o)?, *q.get(o + 1)?]);
    let end = o + 4;
    let name = labels.join(".").to_lowercase();
    let mut r = q.get(..end)?.to_vec();
    r[2] = 0x81; r[3] = 0x80; r[8..12].fill(0);
    if qtype == 1 && !name.is_empty() {
        let k = match names.iter().position(|n| *n == name) { Some(k) => k, None => { names.push(name); names.len() - 1 } } + 1;
        r[6] = 0; r[7] = 1;
        r.extend_from_slice(&[0xC0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 198, 18, (k >> 8) as u8, k as u8]);
    } else { r[6] = 0; r[7] = 0; }
    Some(r)
}

/// poll/ppoll with real readiness (sockets, the terminal, pipes); it waits when nothing is ready.
fn poll_socks(e: &mut Engine, fds: u64, n: u64, nr: u64, t: u64) -> bool {
    let ms = if nr == 7 { t as i32 as i64 } else if t == 0 { -1 } else { (e.r64(t) * 1000 + e.r64(t + 8) / 1_000_000) as i64 };
    if n > 256 { return false; }
    let (mut socks, mut stdin, mut pipes, mut nready) = (Vec::new(), false, Vec::new(), 0i64);
    for k in 0..n {
        let at = fds + 8 * k;
        let fd = e.r32(at) as i32;
        let ev = e.r16(at + 4);
        let l = lx(e);
        let (rd, wr, hup) = if fd < 0 { (false, false, false) } else { match l.fds.get(&fd) {
            Some(Fd::Sock { id }) => {
                socks.push(*id);
                match l.socks.get(id) { Some(s) => (!s.rx.is_empty() || !s.dgrams.is_empty() || s.closed || s.failed, s.udp || (s.open && !s.closed), s.closed || s.failed), None => (true, false, true) }
            }
            Some(Fd::Tty) => { stdin = true; (!l.stdin.is_empty() || l.stdin_eof, true, false) }
            Some(Fd::Pipe { id, w }) => {
                if *w { (false, true, !has_end(l, *id, false)) } else {
                    pipes.push(*id);
                    let open = has_end(l, *id, true);
                    (l.pipes.get(id).map_or(false, |b| !b.is_empty()) || !open, false, !open)
                }
            }
            Some(_) => (true, true, false),
            None => { e.w16(at + 6, 0x20); nready += 1; continue; } // POLLNVAL
        } };
        let re = ((if rd { 1 } else { 0 }) | (if wr { 4 } else { 0 })) & ev | if hup { 0x10 } else { 0 };
        e.w16(at + 6, re);
        if re != 0 { nready += 1; }
    }
    if nready > 0 || ms == 0 { ret(e, nready); return true; }
    e.cpu.rip -= 2;
    e.block_linux(Cond::Poll { socks, stdin, pipes }, if ms < 0 { None } else { Some(ms as f64) });
    true
}

fn read_addr(e: &mut Engine, a: u64, len: u64) -> Option<[u8; 16]> {
    if a == 0 || len < 8 { return None; }
    let mut b = [0u8; 28];
    let _ = e.mmu.read_bytes(a, &mut b[..(len as usize).min(28)]);
    let mut out = [0u8; 16];
    match u16::from_le_bytes([b[0], b[1]]) {
        2 => { out[..8].copy_from_slice(&b[..8]); }
        10 => { // IPv6: only IPv4-mapped (::ffff:a.b.c.d)
            if b[8..18].iter().any(|&c| c != 0) || b[18] != 0xFF || b[19] != 0xFF { return Some([0xFF; 16]); }
            out[0] = 2; out[2] = b[2]; out[3] = b[3]; out[4..8].copy_from_slice(&b[20..24]);
        }
        _ => return Some([0xFF; 16]),
    }
    Some(out)
}

fn write_addr(e: &mut Engine, a: u64, lenp: u64, ad: &[u8; 16]) {
    if a == 0 { return; }
    let _ = e.mmu.write_bytes(a, ad);
    if lenp != 0 { e.w32(lenp, 16); }
}

fn net_call(e: &mut Engine, nr: u64, a0: u64, a1: u64, a2: u64, a3: u64, a4: u64, a5: u64) -> i64 {
    let fd = a0 as i32;
    let sid = match lx(e).fds.get(&fd) { Some(Fd::Sock { id }) => Some(*id), _ => None };
    match nr {
        41 => { // socket
            if a0 != 2 && a0 != 10 { return -EAFNOSUPPORT; }
            let ty = a1 & 0xF;
            if ty != 1 && ty != 2 { return -EOPNOTSUPP; }
            let l = lx(e);
            l.next_sock += 1;
            let id = l.next_sock;
            l.socks.insert(id, Sock { udp: ty == 2, nb: a1 & 0x800 != 0, ..Default::default() });
            let n = l.new_fd(Fd::Sock { id });
            if a1 & 0x80000 != 0 { l.cloexec.insert(n); }
            n as i64
        }
        53 => -EOPNOTSUPP, // socketpair
        288 => -EOPNOTSUPP, // accept4
        _ if sid.is_none() => if lx(e).fds.contains_key(&fd) { -88 } else { -EBADF }, // ENOTSOCK
        42 => { // connect
            let id = sid.unwrap();
            let Some(ad) = read_addr(e, a1, a2) else { return -EINVAL };
            if ad[0] == 0xFF { return -ENETUNREACH; }
            let l = lx(e);
            let s = l.socks.get_mut(&id).unwrap();
            s.peer = ad;
            if s.udp { return 0; }
            if s.open { return -106; } // EISCONN
            s.open = true;
            let port = u16::from_be_bytes([ad[2], ad[3]]);
            let host = if ad[4] == 198 && ad[5] == 18 {
                let k = ((ad[6] as usize) << 8 | ad[7] as usize).wrapping_sub(1);
                l.dns.get(k).cloned().unwrap_or_default()
            } else { format!("{}.{}.{}.{}", ad[4], ad[5], ad[6], ad[7]) };
            net_event(&mut l.net_out, 1, id, format!("{}:{}", host, port).as_bytes());
            0
        }
        44 | 46 => { // sendto / sendmsg
            let id = sid.unwrap();
            let (d, to) = if nr == 44 {
                let mut d = vec![0u8; a2.min(1 << 20) as usize];
                let _ = e.mmu.read_bytes(a1, &mut d);
                (d, read_addr(e, a4, a5))
            } else {
                let (name, nlen, iov, iovn) = (e.r64(a1), e.r32(a1 + 8) as u64, e.r64(a1 + 16), e.r64(a1 + 24));
                let mut d = Vec::new();
                for k in 0..iovn.min(64) {
                    let (b, n) = (e.r64(iov + 16 * k), e.r64(iov + 16 * k + 8).min(1 << 20));
                    let mut c = vec![0u8; n as usize]; let _ = e.mmu.read_bytes(b, &mut c); d.extend_from_slice(&c);
                }
                (d, read_addr(e, name, nlen))
            };
            if to.map_or(false, |t| t[0] == 0xFF) { return -ENETUNREACH; }
            sock_send(lx(e), id, &d, to)
        }
        45 | 47 => { // recvfrom / recvmsg
            let id = sid.unwrap();
            if nr == 45 {
                let (v, from) = sock_recv(e, id, a1, a2, a3 & 0x40 != 0);
                if let Some(f) = from { write_addr(e, a4, a5, &f); }
                v
            } else {
                let (name, iov, iovn) = (e.r64(a1), e.r64(a1 + 16), e.r64(a1 + 24));
                let (b, n) = (e.r64(iov), if iovn > 0 { e.r64(iov + 8) } else { 0 });
                let (v, from) = sock_recv(e, id, b, n, a2 & 0x40 != 0);
                if let Some(f) = from { if name != 0 { let _ = e.mmu.write_bytes(name, &f); e.w32(a1 + 8, 16); } }
                if v >= 0 { e.w64(a1 + 40, 0); e.w32(a1 + 48, 0); }
                v
            }
        }
        48 | 49 | 54 => 0, // shutdown / bind / setsockopt
        50 => -EOPNOTSUPP, // listen
        43 => -EOPNOTSUPP, // accept
        51 | 52 => { // getsockname / getpeername
            let id = sid.unwrap();
            let ad = if nr == 52 { lx(e).socks.get(&id).map_or([0; 16], |s| s.peer) } else { let mut a = [0u8; 16]; a[0] = 2; a[4] = 10; a[7] = 15; a };
            if nr == 52 && ad[0] == 0 { return -ENOTCONN; }
            write_addr(e, a1, a2, &ad);
            0
        }
        55 => { // getsockopt: SO_ERROR and the rest read as 0
            let id = sid.unwrap();
            let err = if lx(e).socks.get(&id).map_or(false, |s| s.failed) { ECONNREFUSED } else { 0 };
            if a3 != 0 { e.w32(a3, err as u32); }
            if a4 != 0 { e.w32(a4, 4); }
            0
        }
        _ => -ENOSYS,
    }
}

/// The page collects what the sockets want to send: [op u8][id u32][len u32][data]...
/// (1 connect "host:port", 2 data, 3 close). Sockets no process holds any more are closed here.
#[no_mangle]
pub extern "C" fn linux_net_poll() -> i32 {
    let Some(l) = crate::eng().s.lx.as_mut() else { return 0 };
    let held = |l: &Lx, id: u32| {
        let is = |f: &Fd| matches!(f, Fd::Sock { id: i } if *i == id);
        l.fds.values().any(is) || l.procs.values().any(|p| p.saved.as_ref().map_or(false, |s| s.fds.values().any(is)))
    };
    let gone: Vec<u32> = l.socks.keys().copied().filter(|&id| !held(l, id)).collect();
    for id in gone {
        let s = l.socks.remove(&id).unwrap();
        if !s.udp && s.open && !s.closed { net_event(&mut l.net_out, 3, id, &[]); }
    }
    if l.net_out.is_empty() { return 0; }
    let v = std::mem::take(&mut l.net_out);
    crate::set_out(v) as i32
}

/// The page hands data to socket `id`: kind 1 = bytes (in the buffer), 2 = closed by the other side, 3 = could not connect.
#[no_mangle]
pub extern "C" fn linux_net_in(id: u32, kind: u32) {
    let b = unsafe { crate::take_buf() };
    let Some(l) = crate::eng().s.lx.as_mut() else { return };
    let Some(s) = l.socks.get_mut(&id) else { return };
    match kind { 1 => s.rx.extend(b), 2 => s.closed = true, _ => s.failed = true }
}

/// Has the file tree changed since the last call? (the page then saves it with `linux_save_tar`)
#[no_mangle]
pub extern "C" fn linux_dirty() -> u32 { crate::eng().s.lx.as_mut().map_or(0, |l| std::mem::take(&mut l.dirty) as u32) }

/// The whole file tree as a tar (without /proc, /dev and /tmp), in out_ptr(); its size.
#[no_mangle]
pub extern "C" fn linux_save_tar() -> u32 {
    let Some(l) = crate::eng().s.lx.as_ref() else { return 0 };
    let mut t: Vec<u8> = Vec::new();
    fn hdr(t: &mut Vec<u8>, name: &str, ty: u8, size: usize, link: &str, mode: u32) {
        if name.len() > 99 { // GNU long name
            let mut d = name.as_bytes().to_vec(); d.push(0);
            hdr(t, "././@LongLink", b'L', d.len(), "", 0o644);
            t.extend_from_slice(&d); t.resize((t.len() + 511) / 512 * 512, 0);
        }
        let mut h = [0u8; 512];
        let n = name.as_bytes(); h[..n.len().min(99)].copy_from_slice(&n[..n.len().min(99)]);
        h[100..108].copy_from_slice(format!("{:07o}\0", mode).as_bytes());
        h[108..116].copy_from_slice(b"0000000\0"); h[116..124].copy_from_slice(b"0000000\0");
        h[124..136].copy_from_slice(format!("{:011o}\0", size).as_bytes());
        h[136..148].copy_from_slice(b"00000000000\0");
        h[156] = ty;
        let lk = link.as_bytes(); h[157..157 + lk.len().min(99)].copy_from_slice(&lk[..lk.len().min(99)]);
        h[257..263].copy_from_slice(b"ustar\0"); h[263..265].copy_from_slice(b"00");
        h[148..156].fill(b' ');
        let sum: u32 = h.iter().map(|&c| c as u32).sum();
        h[148..156].copy_from_slice(format!("{:06o}\0 ", sum).as_bytes());
        t.extend_from_slice(&h);
    }
    for (p, n) in l.fs.iter() {
        if p.starts_with("/proc") || p.starts_with("/dev") || p.starts_with("/tmp/") { continue; }
        let name = &p[1..];
        match n {
            Node::Dir => hdr(&mut t, &format!("{}/", name), b'5', 0, "", 0o755),
            Node::Link(k) => {
                if k.len() > 99 { let mut d = k.as_bytes().to_vec(); d.push(0); hdr(&mut t, "././@LongLink", b'K', d.len(), "", 0o644); t.extend_from_slice(&d); t.resize((t.len() + 511) / 512 * 512, 0); }
                hdr(&mut t, name, b'2', 0, k, 0o777)
            }
            Node::File(d) => { hdr(&mut t, name, b'0', d.len(), "", 0o755); t.extend_from_slice(d); t.resize((t.len() + 511) / 512 * 512, 0); }
        }
    }
    t.extend_from_slice(&[0u8; 1024]);
    crate::set_out(t)
}
