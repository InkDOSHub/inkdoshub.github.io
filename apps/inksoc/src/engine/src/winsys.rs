// The window system: Wine's win32u system calls (NtUser*), the part Wine
// runs on its Unix side. Wine's own user32.dll, gdi32.dll and comctl32.dll
// run as program code on top of these. Drawing (NtGdi*) is in wingdi.rs.
//
// Kept deliberately simple: one desktop, windows drawn into per-window
// surfaces and composed into a framebuffer the page shows on a canvas.

use crate::kernel32::NO_RETURN;
use crate::Engine;
use std::collections::{HashMap, HashSet, VecDeque};

pub const SCREEN_W: i32 = 1024;
pub const SCREEN_H: i32 = 768;
const DESKTOP: u64 = 0x10010;
const MSG_WINDOW: u64 = 0x10012;

// messages
pub const WM_CREATE: u32 = 0x01;
const WM_DESTROY: u32 = 0x02;
const WM_MOVE: u32 = 0x03;
const WM_SIZE: u32 = 0x05;
const WM_ACTIVATE: u32 = 0x06;
const WM_SETFOCUS: u32 = 0x07;
const WM_KILLFOCUS: u32 = 0x08;
const WM_SETTEXT: u32 = 0x0C;
const WM_GETTEXT: u32 = 0x0D;
const WM_GETTEXTLENGTH: u32 = 0x0E;
const WM_PAINT: u32 = 0x0F;
const WM_CLOSE: u32 = 0x10;
const WM_QUIT: u32 = 0x12;
const WM_ERASEBKGND: u32 = 0x14;
const WM_SHOWWINDOW: u32 = 0x18;
const WM_SETCURSOR: u32 = 0x20;
const WM_GETMINMAXINFO: u32 = 0x24;
const WM_NCCREATE: u32 = 0x81;
const WM_NCDESTROY: u32 = 0x82;
const WM_NCHITTEST: u32 = 0x84;
const WM_NCACTIVATE: u32 = 0x86;
const WM_KEYDOWN: u32 = 0x100;
const WM_KEYUP: u32 = 0x101;
const WM_CHAR: u32 = 0x102;
const WM_SYSKEYDOWN: u32 = 0x104;
const WM_COMMAND: u32 = 0x111;
const WM_SYSCOMMAND: u32 = 0x112;
const WM_TIMER: u32 = 0x113;
const WM_INITMENU: u32 = 0x116;
const WM_INITMENUPOPUP: u32 = 0x117;
const WM_MOUSEMOVE: u32 = 0x200;
const WM_LBUTTONDOWN: u32 = 0x201;
const WM_LBUTTONDBLCLK: u32 = 0x203;
const WM_PARENTNOTIFY: u32 = 0x210;

// styles
const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_CAPTION: u32 = 0x00C0_0000;
const WS_BORDER: u32 = 0x0080_0000;
const WS_DLGFRAME: u32 = 0x0040_0000;
const WS_VSCROLL: u32 = 0x0020_0000;
const WS_HSCROLL: u32 = 0x0010_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_THICKFRAME: u32 = 0x0004_0000;
const WS_EX_DLGMODALFRAME: u32 = 0x1;
const WS_EX_NOPARENTNOTIFY: u32 = 0x4;
const WS_EX_CLIENTEDGE: u32 = 0x200;
const WS_EX_STATICEDGE: u32 = 0x20000;
const CW_USEDEFAULT: i32 = i32::MIN;

#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Rect { pub l: i32, pub t: i32, pub r: i32, pub b: i32 }
impl Rect {
    pub fn new(l: i32, t: i32, r: i32, b: i32) -> Rect { Rect { l, t, r, b } }
    pub fn w(&self) -> i32 { self.r - self.l }
    pub fn h(&self) -> i32 { self.b - self.t }
    pub fn empty(&self) -> bool { self.r <= self.l || self.b <= self.t }
    pub fn inter(&self, o: &Rect) -> Rect { Rect::new(self.l.max(o.l), self.t.max(o.t), self.r.min(o.r), self.b.min(o.b)) }
    pub fn union(&self, o: &Rect) -> Rect {
        if self.empty() { return *o; }
        if o.empty() { return *self; }
        Rect::new(self.l.min(o.l), self.t.min(o.t), self.r.max(o.r), self.b.max(o.b))
    }
    pub fn has(&self, x: i32, y: i32) -> bool { x >= self.l && x < self.r && y >= self.t && y < self.b }
    pub fn off(&self, dx: i32, dy: i32) -> Rect { Rect::new(self.l + dx, self.t + dy, self.r + dx, self.b + dy) }
}

pub struct Class {
    pub atom: u16,
    pub name: String, // lower case
    pub style: u32,
    pub proc_: u64,
    pub proc_a: u64,
    pub proc_w: u64,
    pub ansi: bool,
    pub cls_extra: Vec<u8>,
    pub wnd_extra: usize,
    pub inst: u64,
    pub icon: u64,
    pub icon_sm: u64,
    pub cursor: u64,
    pub brush: u64,
    pub menu_name: u64,
    pub menu_name_a: u64,
    pub builtin: bool,
}

pub struct Wnd {
    pub class: usize,
    pub parent: u64, // 0 = top level (desktop child)
    pub owner: u64,
    pub style: u32,
    pub ex_style: u32,
    pub wrect: Rect, // screen coordinates
    pub crect: Rect, // screen coordinates
    pub text: String,
    pub proc_: u64,
    pub unicode: bool,
    pub id: u64,
    pub inst: u64,
    pub userdata: u64,
    pub extra: Vec<u8>,
    pub tid: u32,
    pub update: Rect, // client coordinates
    pub erase: bool,
    pub menu: u64,
    pub children: Vec<u64>,
    pub dlg_info: u64,
    pub props: Vec<(u64, u64)>,
    pub nc_dirty: bool,
    pub icon: u64,
}

#[derive(Clone, Copy)]
pub struct Msg { pub hwnd: u64, pub msg: u32, pub wp: u64, pub lp: u64, pub time: u32, pub x: i32, pub y: i32 }

#[derive(Default)]
pub struct Queue {
    pub posted: VecDeque<Msg>,
    pub input: VecDeque<Msg>,
    pub quit: Option<i32>,
}

pub struct Timer { pub hwnd: u64, pub id: u64, pub period: f64, pub next: f64, pub proc_: u64, pub tid: u32 }

pub struct MenuItem { pub id: u64, pub text: String, pub flags: u32, pub state: u32, pub sub: u64, pub data: u64, pub bmp: u64 }
#[derive(Default)]
pub struct Menu { pub items: Vec<MenuItem>, pub style: u32, pub data: u64, pub max_h: u32, pub help: u32, pub brush: u64 }

/// A popup menu shown over the screen (drawn by the compositor).
pub struct Popup { pub menu: u64, pub hwnd: u64, pub x: i32, pub y: i32, pub w: i32, pub h: i32, pub hot: i32 }

pub enum Step { Ret(u64), Send { hwnd: u64, msg: u32, wp: u64, lp: u64, then: Cont } }
pub type Cont = Box<dyn FnOnce(&mut Engine, u64) -> Step>;

struct Frame { tid: u32, rsp: u64, regs: [u64; 8], xmm: [u128; 10], cont: Cont, back: (u64, usize) }

pub struct Keys(pub [u8; 256]);
impl Default for Keys { fn default() -> Self { Keys([0; 256]) } }
impl std::ops::Index<usize> for Keys { type Output = u8; fn index(&self, i: usize) -> &u8 { &self.0[i] } }
impl std::ops::IndexMut<usize> for Keys { fn index_mut(&mut self, i: usize) -> &mut u8 { &mut self.0[i] } }

#[derive(Default)]
pub struct Win {
    pub unknown: HashSet<String>,
    pub classes: Vec<Class>,
    pub wins: HashMap<u64, Wnd>,
    pub tops: Vec<u64>, // top-level windows, back to front
    next_hwnd: u64,
    next_atom: u16,
    pub queues: HashMap<u32, Queue>,
    pub timers: Vec<Timer>,
    frames: Vec<Frame>,
    /// WoW64: (lparam, bytes) of the packed structure to copy back after the callback
    pack_back: Option<(u64, usize)>,
    pub procs_a: Vec<u64>,
    pub procs_w: Vec<u64>,
    pub builtins_done: bool,
    pub focus: u64,
    pub active: u64,
    pub capture: u64,
    pub menus: HashMap<u64, Menu>,
    next_menu: u64,
    pub cursors: HashMap<u64, u64>, // cursor/icon handle -> desc copy (guest)
    next_cursor: u64,
    pub mouse: (i32, i32),
    pub buttons: u32,
    pub keys: Keys,
    pub chars: HashMap<u32, u32>, // keydown time stamp -> character
    seq: u32,
    pub drag: Option<(u64, i32, i32)>, // window being moved, grab offset
    pub popup: Option<Popup>,
    pub last_click: (f64, i32, i32, u64),
    pub dirty: bool,
    pub props_atoms: HashMap<String, u16>,
}

fn now_ms() -> f64 { unsafe { crate::host_now_ms() } }

impl Engine {
    // ---------- small helpers ----------
    fn ur32(&mut self, a: u64) -> u32 { self.mmu.read32(a).unwrap_or(0) }
    fn ur64(&mut self, a: u64) -> u64 { self.mmu.read64(a).unwrap_or(0) }
    fn uw32(&mut self, a: u64, v: u32) { if a != 0 { let _ = self.mmu.write32(a, v); } }
    fn uw64(&mut self, a: u64, v: u64) { if a != 0 { let _ = self.mmu.write64(a, v); } }
    pub(crate) fn rd_rect(&mut self, a: u64) -> Rect {
        Rect::new(self.ur32(a) as i32, self.ur32(a + 4) as i32, self.ur32(a + 8) as i32, self.ur32(a + 12) as i32)
    }
    pub(crate) fn wr_rect(&mut self, a: u64, r: Rect) {
        if a == 0 { return; }
        self.uw32(a, r.l as u32); self.uw32(a + 4, r.t as u32); self.uw32(a + 8, r.r as u32); self.uw32(a + 12, r.b as u32);
    }
    /// Text of a UNICODE_STRING (or an atom when the buffer is a small integer).
    fn ustr(&mut self, us: u64) -> (String, u16) {
        if us == 0 { return (String::new(), 0); }
        let len = self.mmu.read16(us).unwrap_or(0) as usize / 2;
        let buf = self.ur64(us + 8);
        if buf < 0x10000 { return (String::new(), buf as u16); }
        let v: Vec<u16> = (0..len).map(|i| self.mmu.read16(buf + 2 * i as u64).unwrap_or(0)).collect();
        (String::from_utf16_lossy(&v), 0)
    }
    pub(crate) fn put_w(&mut self, a: u64, s: &str, max: usize) -> usize {
        if a == 0 || max == 0 { return 0; }
        let w: Vec<u16> = s.encode_utf16().take(max - 1).collect();
        for (i, c) in w.iter().enumerate() { let _ = self.mmu.write16(a + 2 * i as u64, *c); }
        let _ = self.mmu.write16(a + 2 * w.len() as u64, 0);
        w.len()
    }
    fn alloc_w(&mut self, s: &str) -> u64 {
        let w: Vec<u16> = s.encode_utf16().collect();
        let b = self.heap_alloc(2 * w.len() as u64 + 2, true);
        for (i, c) in w.iter().enumerate() { let _ = self.mmu.write16(b + 2 * i as u64, *c); }
        b
    }

    pub(crate) fn wnd(&self, h: u64) -> Option<&Wnd> { self.s.win.wins.get(&full(h)) }
    fn wnd_mut(&mut self, h: u64) -> Option<&mut Wnd> { self.s.win.wins.get_mut(&full(h)) }

    // ---------- callbacks into user32 (KeUserModeCallback) ----------

    /// Runs a step: returns the value for the native caller, or NO_RETURN when
    /// a window procedure is being called first.
    pub(crate) fn step(&mut self, mut s: Step) -> u64 {
        loop {
            match s {
                Step::Ret(v) => return v,
                Step::Send { hwnd, msg, wp, lp, then } => {
                    match self.proc_params(hwnd, msg, wp, lp, false) {
                        Some(mut p) => {
                            self.s.win.pack_back = None;
                            if self.s.wow64 && lp > 0xFFFF { self.pack_lparam(&mut p, msg, wp, lp); }
                            self.callback(4, &p, then); return NO_RETURN; // NtUserCallWinProc
                        }
                        None => s = then(self, 0),
                    }
                }
            }
        }
    }

    /// Sends a message from the window system, then continues with `then`.
    pub(crate) fn send(&mut self, hwnd: u64, msg: u32, wp: u64, lp: u64, then: impl FnOnce(&mut Engine, u64) -> Step + 'static) -> Step {
        Step::Send { hwnd, msg, wp, lp, then: Box::new(then) }
    }

    fn callback(&mut self, id: u32, args: &[u8], cont: Cont) {
        if self.s.win_ki == 0 {
            if let Some(m) = crate::pe::find_module(self, "wine-ntdll.dll") { self.s.win_ki = self.s.modules[m].exports.get("KiUserCallbackDispatcher").copied().unwrap_or(0); }
        }
        let ki = self.s.win_ki;
        if ki == 0 { let _ = cont; self.set_error("window system: KiUserCallbackDispatcher not found".into()); return; }
        let c = &self.cpu;
        let regs = [c.regs[3], c.regs[5], c.regs[6], c.regs[7], c.regs[12], c.regs[13], c.regs[14], c.regs[15]];
        let mut xmm = [0u128; 10];
        xmm.copy_from_slice(&c.xmm[6..16]);
        let rsp = c.regs[4];
        let tid = self.cur_tid();
        // WoW64: a packed lparam structure (after the parameters) comes back after the result
        let back = if self.s.wow64 && id == 4 { self.s.win.pack_back.take().unwrap_or((0, 0)) } else { (0, 0) };
        self.s.win.frames.push(Frame { tid, rsp, regs, xmm, cont, back });
        let base = (rsp - 0x300 - args.len() as u64) & !0xF;
        let _ = self.mmu.write_bytes(base, args);
        let sp = (base - 0x100) & !0xF;
        self.uw64(sp + 0x20, base);
        self.uw32(sp + 0x28, args.len() as u32);
        self.uw32(sp + 0x2C, id);
        self.cpu.regs[4] = sp;
        self.cpu.rip = ki;
    }

    /// NtCallbackReturn: the window procedure is done; go on with the native code.
    pub fn callback_return(&mut self) {
        let (ret, len) = (self.arg(0), self.arg(1) as u32);
        let lres = if ret != 0 && len >= 8 { self.ur64(ret) } else { 0 };
        let tid = self.cur_tid();
        let Some(i) = self.s.win.frames.iter().rposition(|f| f.tid == tid) else {
            self.set_error("NtCallbackReturn without a callback".into());
            return;
        };
        let f = self.s.win.frames.remove(i);
        if f.back.1 != 0 && ret != 0 && len as usize >= 8 + f.back.1 {
            let mut b = vec![0u8; f.back.1];
            if self.mmu.read_bytes(ret + 8, &mut b).is_ok() { let _ = self.mmu.write_bytes(f.back.0, &b); }
        }
        let c = &mut self.cpu;
        for (k, r) in [3usize, 5, 6, 7, 12, 13, 14, 15].iter().enumerate() { c.regs[*r] = f.regs[k]; }
        c.xmm[6..16].copy_from_slice(&f.xmm);
        c.regs[4] = f.rsp;
        let st = (f.cont)(self, lres);
        let v = self.step(st);
        if v != NO_RETURN { self.do_ret(v); }
    }

    /// win_proc_params for calling a window's procedure (72 bytes).
    fn proc_params(&mut self, hwnd: u64, msg: u32, wp: u64, lp: u64, ansi: bool) -> Option<Vec<u8>> {
        let w = self.wnd(hwnd)?;
        let (mut func, unicode, cls) = (w.proc_, w.unicode, w.class);
        if func == 0 { return None; }
        let c = &self.s.win.classes[cls];
        let (pa, pw) = if c.builtin && (func == c.proc_w || func == c.proc_a) { func = c.proc_w; (c.proc_a, c.proc_w) } else { (func, func) };
        let mut p = vec![0u8; 72];
        p[0..8].copy_from_slice(&func.to_le_bytes());
        p[8..16].copy_from_slice(&full(hwnd).to_le_bytes());
        p[16..20].copy_from_slice(&msg.to_le_bytes());
        p[24..32].copy_from_slice(&wp.to_le_bytes());
        p[32..40].copy_from_slice(&lp.to_le_bytes());
        p[40..44].copy_from_slice(&(ansi as u32).to_le_bytes());
        let dst = if c.builtin && pa != pw { ansi } else { !unicode };
        p[44..48].copy_from_slice(&(dst as u32).to_le_bytes());
        p[48..52].copy_from_slice(&5u32.to_le_bytes()); // WMCHAR_MAP_CALLWINDOWPROC
        p[52..56].copy_from_slice(&0x12u32.to_le_bytes());
        p[56..64].copy_from_slice(&pa.to_le_bytes());
        p[64..72].copy_from_slice(&pw.to_le_bytes());
        Some(p)
    }

    /// WoW64: structures an lparam points to travel packed after the parameters
    /// (wow64win converts them to their 32-bit layout); what the procedure may
    /// change is copied back on return (pack_back).
    fn pack_lparam(&mut self, p: &mut Vec<u8>, msg: u32, wp: u64, lp: u64) {
        let (n, back) = match msg {
            0x01 | 0x81 => (0x50, false),                // WM_CREATE, WM_NCCREATE: CREATESTRUCTW (+ strings)
            0x83 => if wp != 0 { (56 + 40, true) } else { (16, true) }, // WM_NCCALCSIZE
            0x46 | 0x47 => (40, true),                   // WM_WINDOWPOSCHANGING/CHANGED
            0x24 => (40, true),                          // WM_GETMINMAXINFO
            0x7C | 0x7D => (8, true),                    // WM_STYLECHANGING/CHANGED
            0x0214 | 0x0216 => (16, true),               // WM_SIZING, WM_MOVING
            _ => return,
        };
        let mut d = vec![0u8; n];
        if msg == 0x83 && wp != 0 {
            // NCCALCSIZE_PARAMS then the WINDOWPOS it points to
            if self.mmu.read_bytes(lp, &mut d[..56]).is_err() { return; }
            let wpos = u64::from_le_bytes(d[48..56].try_into().unwrap());
            let _ = self.mmu.read_bytes(wpos, &mut d[56..]);
        } else if self.mmu.read_bytes(lp, &mut d).is_err() { return; }
        if msg == 0x01 || msg == 0x81 {
            for off in [0x38usize, 0x40] { // lpszName, lpszClass (strings follow unless atoms)
                let sp = u64::from_le_bytes(d[off..off + 8].try_into().unwrap());
                if sp > 0xFFFF {
                    let w = self.read_wstr(sp, 1024);
                    for c in w.encode_utf16().chain([0]) { d.extend_from_slice(&c.to_le_bytes()); }
                }
            }
        }
        p.resize(80, 0);
        p.extend_from_slice(&d);
        self.s.win.pack_back = if back { Some((lp, n)) } else { None };
        if msg == 0x83 && wp != 0 { self.s.win.pack_back = Some((lp, 48)); } // the rectangles
    }

    /// Fills the program's win_proc_params so user32 calls the procedure itself.
    fn fill_params(&mut self, out: u64, hwnd: u64, msg: u32, wp: u64, lp: u64, ansi: bool) -> bool {
        match self.proc_params(hwnd, msg, wp, lp, ansi) {
            Some(p) => { let _ = self.mmu.write_bytes(out, &p); true }
            None => false,
        }
    }

    // ---------- classes ----------

    fn find_class(&self, name: &str, atom: u16) -> Option<usize> {
        let n = name.to_lowercase();
        if atom == 0 && n.is_empty() { return None; } // unregistered classes keep an empty name
        self.s.win.classes.iter().position(|c| if atom != 0 { c.atom == atom } else { c.name == n })
    }

    fn add_class(&mut self, c: Class) -> u16 {
        let w = &mut self.s.win;
        if w.next_atom == 0 { w.next_atom = 0xC000; }
        let atom = match c.name.as_str() { "#32770" => 0x8002, "#32768" => 0x8000, "#32769" => 0x8001, "#32772" => 0x8004, _ => { w.next_atom += 1; w.next_atom } };
        w.classes.push(Class { atom, ..c });
        atom
    }

    fn register_builtins(&mut self) {
        if self.s.win.builtins_done || self.s.win.procs_w.is_empty() { return; }
        self.s.win.builtins_done = true;
        // (name, style, proc index, extra bytes, brush)
        let list: [(&str, u32, usize, usize, u64); 13] = [
            ("#32769", 0x8, 3, 0, 2), ("Message", 0, 1, 0, 0),
            ("Button", 0x8 | 0x1 | 0x2 | 0x80, 7, 4 + 16, 0), ("ComboBox", 0x80 | 0x8 | 0x2 | 0x1, 8, 8, 0),
            ("ComboLBox", 0x8 | 0x800, 9, 8, 0), ("#32770", 0x800 | 0x8, 10, 30 + 8 * 3, 0),
            ("#32772", 0, 5, 0, 0), ("IME", 0, 15, 16, 0), ("ListBox", 0x8, 12, 8, 0),
            ("#32768", 0x20000 | 0x800 | 0x8, 2, 8, 5), ("MDIClient", 0, 13, 16, 13),
            ("ScrollBar", 0x8 | 0x2 | 0x1 | 0x80, 0, 32, 0), ("Static", 0x8 | 0x80, 14, 16, 0),
        ];
        for (name, style, p, extra, brush) in list.into_iter().chain([("Edit", 0x8 | 0x80, 11, 8, 0)]) {
            let (pa, pw) = (self.s.win.procs_a.get(p).copied().unwrap_or(0), self.s.win.procs_w.get(p).copied().unwrap_or(0));
            let cursor = self.std_cursor(32512);
            self.add_class(Class {
                atom: 0, name: name.to_lowercase(), style, proc_: pw, proc_a: pa, proc_w: pw, ansi: false,
                cls_extra: vec![], wnd_extra: extra, inst: 0, icon: 0, icon_sm: 0, cursor, brush, menu_name: 0, menu_name_a: 0, builtin: true,
            });
        }
    }

    fn std_cursor(&mut self, _id: u32) -> u64 { self.new_cursor() }
    fn new_cursor(&mut self) -> u64 {
        let w = &mut self.s.win;
        if w.next_cursor == 0 { w.next_cursor = 0x20000; }
        w.next_cursor += 4;
        w.cursors.insert(w.next_cursor, 0);
        w.next_cursor
    }

    // ---------- windows ----------

    /// Space taken by the frame, caption and menu bar: (left, top, right, bottom).
    pub(crate) fn nc_insets(style: u32, ex: u32, menu: bool) -> (i32, i32, i32, i32) {
        let mut b = if style & WS_THICKFRAME != 0 { 4 } else if style & WS_DLGFRAME != 0 || ex & WS_EX_DLGMODALFRAME != 0 { 3 } else if style & WS_BORDER != 0 { 1 } else { 0 };
        if style & WS_CHILD != 0 && style & WS_CAPTION == WS_CAPTION && b == 0 { b = 3; }
        if ex & WS_EX_CLIENTEDGE != 0 { b += 2; }
        if ex & WS_EX_STATICEDGE != 0 { b += 1; }
        let mut top = b;
        if style & WS_CAPTION == WS_CAPTION { top += 19; }
        if menu && style & WS_CHILD == 0 { top += 19; }
        let (mut r, mut bt) = (b, b);
        if style & WS_VSCROLL != 0 { r += 17; }
        if style & WS_HSCROLL != 0 { bt += 17; }
        (b, top, r, bt)
    }

    fn client_from(&self, wr: Rect, style: u32, ex: u32, menu: bool) -> Rect {
        let (l, t, r, b) = Engine::nc_insets(style, ex, menu);
        let c = Rect::new(wr.l + l, wr.t + t, wr.r - r, wr.b - b);
        if c.r < c.l || c.b < c.t { Rect::new(c.l, c.t, c.l.max(c.r), c.t.max(c.b)) } else { c }
    }

    /// Screen origin of a window's client area (for child coordinates).
    fn client_origin(&self, h: u64) -> (i32, i32) {
        if h == 0 || full(h) == DESKTOP { return (0, 0); }
        self.wnd(h).map_or((0, 0), |w| (w.crect.l, w.crect.t))
    }

    pub(crate) fn top_of(&self, mut h: u64) -> u64 {
        h = full(h);
        while let Some(w) = self.wnd(h) { if w.parent == 0 || w.style & WS_CHILD == 0 { return h; } h = w.parent; }
        h
    }

    pub(crate) fn is_visible(&self, mut h: u64) -> bool {
        loop {
            let Some(w) = self.wnd(h) else { return false };
            if w.style & WS_VISIBLE == 0 { return false; }
            if w.parent == 0 || w.style & WS_CHILD == 0 { return true; }
            h = w.parent;
        }
    }

    fn create_window(&mut self) -> u64 {
        self.register_builtins();
        let (ex, cls_us, name_us, style) = (self.arg(0) as u32, self.arg(1), self.arg(3), self.arg(4) as u32);
        let (x, y, cx, cy) = (self.arg(5) as i32, self.arg(6) as i32, self.arg(7) as i32, self.arg(8) as i32);
        let (parent, menu, inst, params, ansi) = (self.arg(9), self.arg(10), self.arg(11), self.arg(12), self.arg(16) != 0);
        let (cname, atom) = self.ustr(cls_us);
        let Some(ci) = self.find_class(&cname, atom) else { self.set_last_error(1407); return 0 };
        let (title, _) = self.ustr(name_us);
        let parent = if parent == u64::MAX - 2 { MSG_WINDOW } else { full(parent) }; // HWND_MESSAGE
        let child = style & WS_CHILD != 0;
        let parent = if parent == DESKTOP { 0 } else { parent };
        // position: relative to the parent's client area for children
        let (ox, oy) = if child { self.client_origin(parent) } else { (0, 0) };
        let n = self.s.win.tops.len() as i32;
        let (mut x, mut y, mut cx, mut cy) = (x, y, cx, cy);
        if !child {
            if x == CW_USEDEFAULT { x = 40 + 24 * (n % 8); y = 30 + 24 * (n % 8); }
            if cx == CW_USEDEFAULT { cx = 600; cy = 420; }
        } else {
            if x == CW_USEDEFAULT { x = 0; y = 0; }
            if cx == CW_USEDEFAULT { cx = 0; cy = 0; }
        }
        if y == CW_USEDEFAULT { y = 30; }
        let wr = Rect::new(ox + x, oy + y, ox + x + cx.max(0), oy + y + cy.max(0));
        let has_menu = !child && menu != 0;
        let crect = self.client_from(wr, style, ex, has_menu);
        let w = &mut self.s.win;
        if w.next_hwnd == 0 { w.next_hwnd = 0x10020; }
        w.next_hwnd += 2;
        let h = w.next_hwnd;
        let c = &self.s.win.classes[ci];
        let (proc_, extra, unicode, cicon) = (c.proc_, c.wnd_extra, !(c.ansi) , c.icon);
        let unicode = if c.builtin { true } else { unicode };
        let tid = self.cur_tid();
        let owner = if !child { parent } else { 0 };
        let parent = if child { parent } else { 0 };
        self.s.win.wins.insert(h, Wnd {
            class: ci, parent, owner, style: style & !WS_VISIBLE, ex_style: ex, wrect: wr, crect, text: title.clone(),
            proc_, unicode, id: if child { menu } else { 0 }, inst, userdata: 0, extra: vec![0; extra], tid,
            update: Rect::default(), erase: false, menu: if has_menu { menu } else { 0 }, children: vec![], dlg_info: 0,
            props: vec![], nc_dirty: true, icon: cicon,
        });
        if parent != 0 { if let Some(p) = self.s.win.wins.get_mut(&parent) { p.children.push(h); } } else { self.s.win.tops.push(h); }
        self.surface_for(h);
        let _ = ansi;
        // CREATESTRUCTW for WM_NCCREATE / WM_CREATE
        let cs = self.heap_alloc(80, true);
        let tw = self.alloc_w(&title);
        let cw = if atom != 0 { atom as u64 } else { self.alloc_w(&cname) };
        self.uw64(cs, params); self.uw64(cs + 8, inst); self.uw64(cs + 16, menu); self.uw64(cs + 24, parent | owner);
        self.uw32(cs + 32, cy as u32); self.uw32(cs + 36, cx as u32); self.uw32(cs + 40, y as u32); self.uw32(cs + 44, x as u32);
        self.uw32(cs + 48, style); self.uw64(cs + 56, tw); self.uw64(cs + 64, cw); self.uw32(cs + 72, ex);
        let s = self.send(h, WM_NCCREATE, 0, cs, move |e, r| {
            if r == 0 { e.destroy_now(h); return Step::Ret(0); }
            e.send(h, WM_CREATE, 0, cs, move |e, r| {
                if r as i64 == -1 { e.destroy_now(h); return Step::Ret(0); }
                let (cw_, ch_) = e.wnd(h).map_or((0, 0), |w| (w.crect.w(), w.crect.h()));
                e.send(h, WM_SIZE, 0, ((ch_ as u64) << 16) | (cw_ as u64 & 0xFFFF), move |e, _| {
                    let (mx, my) = e.wnd(h).map_or((0, 0), |w| {
                        let (ox, oy) = if w.parent != 0 { e.client_origin(w.parent) } else { (0, 0) };
                        (w.crect.l - ox, w.crect.t - oy)
                    });
                    e.send(h, WM_MOVE, 0, (((my as u16) as u64) << 16) | (mx as u16) as u64, move |e, _| {
                        let notify = child && ex & WS_EX_NOPARENTNOTIFY == 0 && parent != 0;
                        let id = e.wnd(h).map_or(0, |w| w.id);
                        let after = move |e: &mut Engine, _| {
                            if style & WS_VISIBLE != 0 { e.show_window(h, 5, Box::new(move |_, _| Step::Ret(h))) } else { Step::Ret(h) }
                        };
                        if notify { e.send(parent, WM_PARENTNOTIFY, (WM_CREATE as u64) | ((id & 0xFFFF) << 16), h, after) } else { after(e, 0) }
                    })
                })
            })
        });
        self.step(s)
    }

    /// Removes a window without messages (failed creation).
    fn destroy_now(&mut self, h: u64) {
        let Some(w) = self.s.win.wins.remove(&h) else { return };
        if w.parent != 0 { if let Some(p) = self.s.win.wins.get_mut(&w.parent) { p.children.retain(|&c| c != h); } }
        self.s.win.tops.retain(|&t| t != h);
        self.s.win.timers.retain(|t| t.hwnd != h);
        for c in w.children { self.destroy_now(c); }
        if self.s.win.focus == h { self.s.win.focus = 0; }
        if self.s.win.active == h { self.s.win.active = 0; }
        if self.s.win.capture == h { self.s.win.capture = 0; }
        self.drop_surface(h);
        self.s.win.dirty = true;
    }

    /// DestroyWindow: WM_DESTROY to the window and its children, then WM_NCDESTROY.
    fn destroy_window(&mut self, h: u64, then: Cont) -> Step {
        let h = full(h);
        if self.wnd(h).is_none() { return then(self, 0); }
        // hide first
        if let Some(w) = self.wnd_mut(h) { w.style &= !WS_VISIBLE; }
        self.s.win.dirty = true;
        let mut list = vec![h];
        let mut i = 0;
        while i < list.len() { let c = self.wnd(list[i]).map_or(vec![], |w| w.children.clone()); list.extend(c); i += 1; }
        // owned popups go too
        let owned: Vec<u64> = self.s.win.wins.iter().filter(|(_, w)| w.owner == h).map(|(&k, _)| k).collect();
        fn chain(e: &mut Engine, list: Vec<u64>, k: usize, msg: u32, then: Cont) -> Step {
            if k >= list.len() { return then(e, 1); }
            let hw = list[k];
            e.send(hw, msg, 0, 0, move |e, _| chain(e, list, k + 1, msg, then))
        }
        let l2 = list.clone();
        let parent = self.wnd(h).map_or(0, |w| w.parent);
        let s = chain(self, list, 0, WM_DESTROY, Box::new(move |e, _| {
            let mut rev = l2.clone(); rev.reverse();
            chain(e, rev, 0, WM_NCDESTROY, Box::new(move |e, _| {
                e.destroy_now(h);
                if parent == 0 && e.s.win.active == 0 {
                    if let Some(&t) = e.s.win.tops.iter().rev().find(|&&t| e.is_visible(t)) { e.s.win.active = t; e.s.win.focus = t; }
                }
                then(e, 1)
            }))
        }));
        // owned windows are destroyed first in Windows; keep it simple: after
        let _ = owned;
        s
    }

    fn invalidate(&mut self, h: u64, r: Option<Rect>, erase: bool) {
        let h = full(h);
        let Some(w) = self.wnd_mut(h) else { return };
        let all = Rect::new(0, 0, w.crect.w(), w.crect.h());
        let r = r.map_or(all, |r| r.inter(&all));
        if !r.empty() { w.update = w.update.union(&r); }
        w.erase |= erase;
        let kids = w.children.clone();
        if r == all { for c in kids { self.invalidate(c, None, erase); } }
        self.s.win.dirty = true;
    }

    fn show_window(&mut self, h: u64, cmd: u32, then: Cont) -> Step {
        let h = full(h);
        let Some(w) = self.wnd(h) else { return then(self, 0) };
        let was = w.style & WS_VISIBLE != 0;
        let show = cmd != 0;
        if show == was {
            if show && cmd != 8 && cmd != 4 { self.activate(h); }
            return then(self, was as u64);
        }
        if let Some(w) = self.wnd_mut(h) { if show { w.style |= WS_VISIBLE; } else { w.style &= !WS_VISIBLE; } w.nc_dirty = true; }
        self.s.win.dirty = true;
        if show { self.invalidate(h, None, true); }
        let top = self.wnd(h).map_or(false, |w| w.style & WS_CHILD == 0);
        self.send(h, WM_SHOWWINDOW, show as u64, 0, move |e, _| {
            if show && top && cmd != 4 && cmd != 8 { e.activate(h); }
            if !show && e.s.win.active == h {
                e.s.win.active = 0;
                if let Some(&t) = e.s.win.tops.iter().rev().find(|&&t| t != h && e.is_visible(t)) { e.activate(t); }
            }
            then(e, was as u64)
        })
    }

    fn activate(&mut self, h: u64) {
        let h = self.top_of(h);
        if self.s.win.active == h { return; }
        let old = self.s.win.active;
        self.s.win.active = h;
        if let Some(w) = self.wnd_mut(old) { w.nc_dirty = true; }
        if let Some(w) = self.wnd_mut(h) { w.nc_dirty = true; }
        // bring to front
        self.s.win.tops.retain(|&t| t != h);
        self.s.win.tops.push(h);
        if self.s.win.focus == 0 || self.top_of(self.s.win.focus) != h { self.s.win.focus = h; }
        // let the program know (posted: WM_ACTIVATE and focus)
        let _ = (WM_ACTIVATE, WM_NCACTIVATE);
        self.post(h, WM_ACTIVATE, 1, old);
        self.post(h, WM_SETFOCUS, old, 0);
        self.s.win.dirty = true;
    }

    /// Moves/resizes: SetWindowPos core (coordinates relative to the parent client area).
    fn win_set_pos(&mut self, h: u64, after: u64, x: i32, y: i32, cx: i32, cy: i32, flags: u32, then: Cont) -> Step {
        let h = full(h);
        let Some(w) = self.wnd(h) else { return then(self, 0) };
        let (ox, oy) = if w.style & WS_CHILD != 0 { self.client_origin(w.parent) } else { (0, 0) };
        let old_w = w.wrect;
        let old_c = w.crect;
        let mut nr = old_w;
        if flags & 2 == 0 { nr = Rect::new(ox + x, oy + y, ox + x + nr.w(), oy + y + nr.h()); }
        if flags & 1 == 0 { nr.r = nr.l + cx.max(0); nr.b = nr.t + cy.max(0); }
        let (style, ex, menu) = (w.style, w.ex_style, w.menu != 0);
        let cr = self.client_from(nr, style, ex, menu);
        let (dx, dy) = (cr.l - old_c.l, cr.t - old_c.t);
        if let Some(w) = self.wnd_mut(h) { w.wrect = nr; w.crect = cr; w.nc_dirty = true; }
        if dx != 0 || dy != 0 { self.move_children(h, dx, dy); }
        if nr.w() != old_w.w() || nr.h() != old_w.h() { self.surface_for(self.top_of(h)); }
        let _ = after;
        if flags & 4 == 0 && after == 0 { if let Some(p) = self.wnd(h).map(|w| w.parent) { if p == 0 { self.s.win.tops.retain(|&t| t != h); self.s.win.tops.push(h); } } }
        self.s.win.dirty = true;
        let sized = cr.w() != old_c.w() || cr.h() != old_c.h();
        let moved = dx != 0 || dy != 0;
        if flags & 8 == 0 && (sized || moved || flags & 0x20 != 0) { self.invalidate(h, None, true); if let Some(p) = self.wnd(h).map(|w| w.parent) { if p != 0 { self.invalidate(p, None, true); } } }
        let show = flags & 0x40 != 0;
        let hide = flags & 0x80 != 0;
        let step_size = move |e: &mut Engine, then: Cont| -> Step {
            if sized {
                let (cw, ch) = (cr.w(), cr.h());
                e.send(h, WM_SIZE, 0, ((ch as u64 & 0xFFFF) << 16) | (cw as u64 & 0xFFFF), move |e, _| then(e, 1))
            } else { then(e, 1) }
        };
        let s = move |e: &mut Engine, _| -> Step {
            step_size(e, Box::new(move |e, _| {
                if moved {
                    let (mx, my) = (cr.l - ox, cr.t - oy);
                    e.send(h, WM_MOVE, 0, (((my as u16) as u64) << 16) | (mx as u16) as u64, move |e, _| {
                        if show { e.show_window(h, 5, then) } else if hide { e.show_window(h, 0, then) } else { then(e, 1) }
                    })
                } else if show { e.show_window(h, 5, then) } else if hide { e.show_window(h, 0, then) } else { then(e, 1) }
            }))
        };
        s(self, 0)
    }

    fn move_children(&mut self, h: u64, dx: i32, dy: i32) {
        let kids = self.wnd(h).map_or(vec![], |w| w.children.clone());
        for c in kids {
            if let Some(w) = self.wnd_mut(c) { w.wrect = w.wrect.off(dx, dy); w.crect = w.crect.off(dx, dy); }
            self.move_children(c, dx, dy);
        }
    }

    // ---------- messages ----------

    pub(crate) fn post(&mut self, hwnd: u64, msg: u32, wp: u64, lp: u64) -> bool {
        let tid = if hwnd == 0 { self.cur_tid() } else { match self.wnd(hwnd) { Some(w) => w.tid, None => return false } };
        let (x, y) = self.s.win.mouse;
        let m = Msg { hwnd: full(hwnd), msg, wp, lp, time: now_ms() as u32, x, y };
        self.s.win.queues.entry(tid).or_default().posted.push_back(m);
        true
    }

    fn filter_ok(&self, m: &Msg, hwnd: u64, first: u32, last: u32) -> bool {
        let hwnd = full(hwnd);
        let wok = hwnd == 0 || m.hwnd == hwnd || (hwnd != u64::MAX && self.is_child_of(m.hwnd, hwnd)) || (hwnd == u64::MAX && m.hwnd == 0);
        let mok = (first == 0 && last == 0) || (m.msg >= first && m.msg <= last);
        wok && mok
    }

    fn is_child_of(&self, mut h: u64, p: u64) -> bool {
        while let Some(w) = self.wnd(h) { if w.parent == 0 { return false; } if w.parent == p { return true; } h = w.parent; }
        false
    }

    /// Next message for this thread (PeekMessage core). Writes the MSG.
    pub(crate) fn peek(&mut self, out: u64, hwnd: u64, first: u32, last: u32, remove: bool) -> Option<bool> {
        let tid = self.cur_tid();
        self.peek_tid(tid, out, hwnd, first, last, remove)
    }

    /// Whether the thread has anything for GetMessage (posted, input, quit, paint, due timer).
    pub(crate) fn has_msgs(&mut self, tid: u32) -> bool {
        self.s.win.queues.get(&tid).map_or(false, |q| !q.posted.is_empty() || !q.input.is_empty() || q.quit.is_some())
            || self.s.win.wins.values().any(|w| w.tid == tid && !w.update.empty()) || self.next_timer(tid) <= now_ms()
    }

    pub(crate) fn peek_tid(&mut self, tid: u32, out: u64, hwnd: u64, first: u32, last: u32, remove: bool) -> Option<bool> {
        self.pump_popup_close();
        let q = self.s.win.queues.entry(tid).or_default();
        let _ = q;
        // posted, then input
        for kind in 0..2 {
            let n = { let q = &self.s.win.queues[&tid]; if kind == 0 { q.posted.len() } else { q.input.len() } };
            for i in 0..n {
                let m = { let q = &self.s.win.queues[&tid]; if kind == 0 { q.posted[i] } else { q.input[i] } };
                if self.filter_ok(&m, hwnd, first, last) {
                    if remove { let q = self.s.win.queues.get_mut(&tid).unwrap(); if kind == 0 { q.posted.remove(i); } else { q.input.remove(i); } }
                    self.write_msg(out, &m);
                    return Some(m.msg != WM_QUIT);
                }
            }
        }
        // quit
        if let Some(code) = self.s.win.queues[&tid].quit {
            if remove { self.s.win.queues.get_mut(&tid).unwrap().quit = None; }
            let m = Msg { hwnd: 0, msg: WM_QUIT, wp: code as u64, lp: 0, time: now_ms() as u32, x: 0, y: 0 };
            self.write_msg(out, &m);
            return Some(false);
        }
        // paint
        if first == 0 && last == 0 || (WM_PAINT >= first && WM_PAINT <= last) {
            let mut cands: Vec<u64> = self.s.win.wins.iter().filter(|(_, w)| w.tid == tid && !w.update.empty()).map(|(&k, _)| k).collect();
            cands.sort();
            for h in cands {
                if !self.is_visible(h) { continue; }
                let m = Msg { hwnd: h, msg: WM_PAINT, wp: 0, lp: 0, time: now_ms() as u32, x: 0, y: 0 };
                if self.filter_ok(&m, hwnd, first, last) { self.write_msg(out, &m); return Some(true); }
            }
        }
        // timers
        let t = now_ms();
        for i in 0..self.s.win.timers.len() {
            let tm = &self.s.win.timers[i];
            if tm.tid != tid || tm.next > t { continue; }
            let m = Msg { hwnd: tm.hwnd, msg: WM_TIMER, wp: tm.id, lp: tm.proc_, time: t as u32, x: 0, y: 0 };
            if !self.filter_ok(&m, hwnd, first, last) { continue; }
            if remove { let tm = &mut self.s.win.timers[i]; tm.next = t + tm.period; }
            self.write_msg(out, &m);
            return Some(true);
        }
        None
    }

    fn write_msg(&mut self, out: u64, m: &Msg) {
        self.uw64(out, m.hwnd); self.uw32(out + 8, m.msg); self.uw64(out + 16, m.wp); self.uw64(out + 24, m.lp);
        self.uw32(out + 32, m.time); self.uw32(out + 36, m.x as u32); self.uw32(out + 40, m.y as u32);
    }

    /// When the next timer of this thread is due (ms, host clock).
    pub(crate) fn next_timer(&self, tid: u32) -> f64 {
        self.s.win.timers.iter().filter(|t| t.tid == tid).map(|t| t.next).fold(f64::INFINITY, f64::min)
    }

    // ---------- default window procedure ----------

    fn def_proc(&mut self, h: u64, msg: u32, wp: u64, lp: u64, ansi: bool) -> Step {
        let h = full(h);
        match msg {
            WM_NCCREATE => {
                // the title came with CREATESTRUCT
                Step::Ret(1)
            }
            WM_SETTEXT => {
                let t = if lp == 0 { String::new() } else if ansi { self.read_cstr(lp, 4096) } else { self.read_wstr(lp, 4096) };
                if let Some(w) = self.wnd_mut(h) { w.text = t; w.nc_dirty = true; }
                self.s.win.dirty = true;
                Step::Ret(1)
            }
            WM_GETTEXT => {
                let t = self.wnd(h).map_or(String::new(), |w| w.text.clone());
                if wp == 0 { return Step::Ret(0); }
                let n = if ansi {
                    let b = t.as_bytes(); let k = b.len().min(wp as usize - 1);
                    let _ = self.mmu.write_bytes(lp, &b[..k]); let _ = self.mmu.write8(lp + k as u64, 0); k
                } else { self.put_w(lp, &t, wp as usize) };
                Step::Ret(n as u64)
            }
            WM_GETTEXTLENGTH => Step::Ret(self.wnd(h).map_or(0, |w| if ansi { w.text.len() } else { w.text.encode_utf16().count() }) as u64),
            WM_PAINT => { if let Some(w) = self.wnd_mut(h) { w.update = Rect::default(); w.erase = false; } Step::Ret(0) }
            WM_ERASEBKGND => {
                let hdc = wp;
                let brush = self.wnd(h).map_or(0, |w| self.s.win.classes[w.class].brush);
                if brush == 0 { return Step::Ret(0); }
                let (cw, ch) = self.wnd(h).map_or((0, 0), |w| (w.crect.w(), w.crect.h()));
                self.fill_rect_brush(hdc, Rect::new(0, 0, cw, ch), brush);
                Step::Ret(1)
            }
            WM_CLOSE => self.destroy_window(h, Box::new(|_, _| Step::Ret(0))),
            WM_SYSCOMMAND => {
                if wp & 0xFFF0 == 0xF060 { self.post(h, WM_CLOSE, 0, 0); }
                Step::Ret(0)
            }
            WM_NCHITTEST => {
                let (x, y) = (lp as i16 as i32, (lp >> 16) as i16 as i32);
                Step::Ret(self.hit_test(h, x, y) as u64)
            }
            WM_SETCURSOR | WM_GETMINMAXINFO | WM_NCACTIVATE => Step::Ret(if msg == WM_NCACTIVATE { 1 } else { 0 }),
            WM_KEYDOWN | WM_KEYUP | WM_CHAR => Step::Ret(0),
            WM_SYSKEYDOWN => { if wp == 0x73 && self.s.win.keys[0x12] & 0x80 != 0 { self.post(h, WM_CLOSE, 0, 0); } Step::Ret(0) }
            _ => Step::Ret(0),
        }
    }

    /// HT* code for a screen point in a window.
    fn hit_test(&self, h: u64, x: i32, y: i32) -> u32 {
        let Some(w) = self.wnd(h) else { return 0 };
        if !w.wrect.has(x, y) { return 0; }
        if w.crect.has(x, y) { return 1; } // HTCLIENT
        if w.style & WS_CAPTION == WS_CAPTION {
            let (l, _, r, _) = Engine::nc_insets(w.style, w.ex_style, false);
            let top = w.wrect.t + if w.style & WS_THICKFRAME != 0 { 4 } else { 3 };
            if y >= top && y < top + 18 && x >= w.wrect.l + l && x < w.wrect.r - r {
                if w.style & WS_SYSMENU != 0 && x >= w.wrect.r - r - 18 { return 20; } // HTCLOSE
                return 2; // HTCAPTION
            }
            if w.menu != 0 && y >= top + 19 && y < top + 38 { return 5; } // HTMENU
        }
        18 // HTBORDER
    }

    // ---------- input from the page ----------

    /// Topmost visible window (deepest child) under a screen point.
    fn window_at(&self, x: i32, y: i32) -> u64 {
        for &t in self.s.win.tops.iter().rev() {
            let Some(w) = self.wnd(t) else { continue };
            if w.style & WS_VISIBLE == 0 || !w.wrect.has(x, y) { continue; }
            let mut h = t;
            'down: loop {
                let kids = self.wnd(h).map_or(vec![], |w| w.children.clone());
                for &c in kids.iter().rev() {
                    let Some(cw) = self.wnd(c) else { continue };
                    if cw.style & WS_VISIBLE != 0 && cw.wrect.has(x, y) { h = c; continue 'down; }
                }
                break;
            }
            return h;
        }
        0
    }

    pub fn input(&mut self, kind: u32, x: i32, y: i32, data: u32) {
        self.s.win.dirty = true;
        match kind {
            1 | 2 | 3 => {
                self.s.win.mouse = (x, y);
                if self.popup_mouse(kind, x, y) { return; }
                if let Some((h, gx, gy)) = self.s.win.drag {
                    if kind == 3 { self.s.win.drag = None; return; }
                    if let Some(w) = self.wnd(h) {
                        let (nx, ny) = (x - gx, y - gy);
                        let (dx, dy) = (nx - w.wrect.l, ny - w.wrect.t);
                        if let Some(w) = self.wnd_mut(h) { w.wrect = w.wrect.off(dx, dy); w.crect = w.crect.off(dx, dy); }
                        self.move_children(h, dx, dy);
                    }
                    return;
                }
                let btn = data; // 0 left, 1 middle, 2 right
                if kind == 2 { self.s.win.buttons |= 1 << btn; } else if kind == 3 { self.s.win.buttons &= !(1 << btn); }
                let target = if self.s.win.capture != 0 { self.s.win.capture } else { self.window_at(x, y) };
                if target == 0 { return; }
                if kind == 2 { self.activate(target); }
                let Some(w) = self.wnd(target) else { return };
                let (w_class, w_crect, w_tid, w_style) = (w.class, w.crect, w.tid, w.style);
                let _ = w;
                if w_style & WS_DISABLED != 0 && self.s.win.capture == 0 { return; }
                let ht = if self.s.win.capture != 0 { 1 } else { self.hit_test(target, x, y) };
                let mk = (self.s.win.buttons & 1) | ((self.s.win.buttons & 4) >> 1) | ((self.s.win.buttons & 2) << 3)
                    | if self.s.win.keys[0x10] & 0x80 != 0 { 4 } else { 0 } | if self.s.win.keys[0x11] & 0x80 != 0 { 8 } else { 0 };
                if ht == 1 {
                    let (cx, cy) = (x - w_crect.l, y - w_crect.t);
                    let base = [WM_LBUTTONDOWN, 0x207, 0x204][btn.min(2) as usize];
                    let mut msg = match kind { 1 => WM_MOUSEMOVE, 2 => base, _ => base + 1 };
                    if kind == 2 {
                        let t = now_ms();
                        let (lt, lx, ly, lh) = self.s.win.last_click;
                        let dbl = self.s.win.classes[w_class].style & 0x8 != 0;
                        if dbl && lh == target && t - lt < 500.0 && (lx - x).abs() < 4 && (ly - y).abs() < 4 { msg = base + 2; self.s.win.last_click = (0.0, 0, 0, 0); }
                        else { self.s.win.last_click = (t, x, y, target); }
                        let _ = WM_LBUTTONDBLCLK;
                    }
                    let lp = ((cy as u16 as u64) << 16) | cx as u16 as u64;
                    let m = Msg { hwnd: target, msg, wp: mk as u64, lp, time: now_ms() as u32, x, y };
                    let tid = w_tid;
                    let q = self.s.win.queues.entry(tid).or_default();
                    if msg == WM_MOUSEMOVE { if let Some(last) = q.input.back_mut() { if last.msg == WM_MOUSEMOVE && last.hwnd == target { *last = m; return; } } }
                    q.input.push_back(m);
                } else if kind == 2 && btn == 0 {
                    let top = self.top_of(target);
                    match ht {
                        2 => { let w = self.wnd(top).unwrap(); self.s.win.drag = Some((top, x - w.wrect.l, y - w.wrect.t)); }
                        20 => { self.post(top, WM_SYSCOMMAND, 0xF060, 0); }
                        5 => { self.open_menu_bar(top, x, y); }
                        _ => {}
                    }
                }
            }
            4 | 5 => {
                let vk = (data & 0xFF) as usize;
                let ch = data >> 16;
                if kind == 4 { self.s.win.keys[vk] = 0x80 | (self.s.win.keys[vk] ^ 1) & 1; } else { self.s.win.keys[vk] &= 1; }
                let target = if self.s.win.focus != 0 { self.s.win.focus } else { self.s.win.active };
                let Some(w) = self.wnd(target) else { return };
                let tid = w.tid;
                let alt = self.s.win.keys[0x12] & 0x80 != 0;
                let msg = match (kind, alt) { (4, false) => WM_KEYDOWN, (5, false) => WM_KEYUP, (4, true) => WM_SYSKEYDOWN, _ => 0x105 };
                self.s.win.seq = self.s.win.seq.wrapping_add(1);
                let stamp = (now_ms() as u32 & !0xFFFF) | (self.s.win.seq & 0xFFFF);
                if kind == 4 && ch != 0 { self.s.win.chars.insert(stamp, ch); }
                let lp = 1 | ((vk as u64 & 0xFF) << 16) | if kind == 5 { 0xC000_0000 } else { 0 };
                let m = Msg { hwnd: target, msg, wp: vk as u64, lp, time: stamp, x: self.s.win.mouse.0, y: self.s.win.mouse.1 };
                self.s.win.queues.entry(tid).or_default().input.push_back(m);
            }
            _ => {}
        }
    }

    // ---------- menus ----------

    fn new_menu(&mut self, popup: bool) -> u64 {
        let w = &mut self.s.win;
        if w.next_menu == 0 { w.next_menu = 0x30000; }
        w.next_menu += 4;
        let h = w.next_menu;
        w.menus.insert(h, Menu { style: if popup { 1 } else { 0 }, ..Default::default() });
        h
    }

    /// MENUITEMINFOW in/out (NtUserThunkedMenuItemInfo).
    fn menu_item_info(&mut self, menu: u64, pos: u32, by_pos: bool, method: u32, info: u64, text_us: u64) -> u64 {
        let find = |m: &Menu, pos: u32, by_pos: bool| -> Option<usize> {
            if by_pos { if (pos as usize) < m.items.len() { Some(pos as usize) } else { None } } else { m.items.iter().position(|i| i.id as u32 == pos) }
        };
        // Wine's codes: 0 set, 1 insert, 2 check radio, 3 default item, 4 item id, 5/6 info A/W, 7 state, 8 submenu
        match method {
            2 => return 1,
            3 => return u32::MAX as u64,
            4 | 7 | 8 => {
                let Some(m) = self.s.win.menus.get(&menu) else { return if method == 8 { 0 } else { u32::MAX as u64 } };
                let Some(i) = find(m, pos, by_pos) else { return if method == 8 { 0 } else { u32::MAX as u64 } };
                let it = &m.items[i];
                return match method {
                    4 => if it.sub != 0 { u32::MAX as u64 } else { it.id },
                    8 => it.sub,
                    _ => if it.sub != 0 { let n = self.s.win.menus.get(&it.sub).map_or(0, |s| s.items.len()); ((n as u64) << 8) | 0x10 | (it.state | it.flags) as u64 & 0xFF } else { (it.state | it.flags) as u64 },
                };
            }
            _ => {}
        }
        let mask = self.ur32(info + 4);
        let method = match method { 0 => 1, 1 => 0, _ => 2 };
        match method {
            0 | 1 => {
                // insert (0) or set (1)
                let ftype = self.ur32(info + 8); let state = self.ur32(info + 12); let id = self.ur32(info + 16) as u64;
                let sub = self.ur64(info + 24); let data = self.ur64(info + 48); let bmp = self.ur64(info + 72);
                let text = if text_us != 0 { self.ustr(text_us).0 } else if mask & 0x50 != 0 && ftype & 0x800 == 0 { let p = self.ur64(info + 56); if p > 0xFFFF { self.read_wstr(p, 1024) } else { String::new() } } else { String::new() };
                let Some(m) = self.s.win.menus.get_mut(&menu) else { return 0 };
                if method == 0 {
                    let at = if by_pos { (pos as usize).min(m.items.len()) } else { m.items.iter().position(|i| i.id as u32 == pos).unwrap_or(m.items.len()) };
                    m.items.insert(at, MenuItem { id, text, flags: ftype, state, sub, data, bmp });
                } else {
                    let Some(i) = find(m, pos, by_pos) else { return 0 };
                    let it = &mut m.items[i];
                    if mask & 0x100 != 0 || mask & 0x40 != 0 { it.text = text; }
                    if mask & 0x10 != 0 { it.flags = ftype; }
                    if mask & 0x1 != 0 { it.state = state; }
                    if mask & 0x2 != 0 { it.id = id; }
                    if mask & 0x4 != 0 { it.sub = sub; }
                    if mask & 0x20 != 0 { it.data = data; }
                    if mask & 0x80 != 0 { it.bmp = bmp; }
                }
                self.s.win.dirty = true;
                1
            }
            _ => {
                // get (2)
                let Some(m) = self.s.win.menus.get(&menu) else { return 0 };
                let Some(i) = find(m, pos, by_pos) else { return 0 };
                let (id, text, flags, state, sub, data) = { let it = &m.items[i]; (it.id, it.text.clone(), it.flags, it.state, it.sub, it.data) };
                if mask & 0x10 != 0 || mask & 0x100 != 0 { self.uw32(info + 8, flags); }
                if mask & 0x1 != 0 { self.uw32(info + 12, state); }
                if mask & 0x2 != 0 { self.uw32(info + 16, id as u32); }
                if mask & 0x4 != 0 { self.uw64(info + 24, sub); }
                if mask & 0x20 != 0 { self.uw64(info + 48, data); }
                if mask & 0x40 != 0 || mask & 0x10 != 0 {
                    let p = self.ur64(info + 56); let n = self.ur32(info + 64);
                    if p != 0 && n > 0 { let k = self.put_w(p, &text, n as usize); self.uw32(info + 64, k as u32); } else { self.uw32(info + 64, text.encode_utf16().count() as u32); }
                }
                1
            }
        }
    }

    /// Menu bar items laid out: (x from window left, width).
    pub(crate) fn menu_bar_layout(&mut self, menu: u64) -> Vec<(i32, i32)> {
        let items: Vec<String> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| i.text.replace('&', "")).collect());
        let mut x = 0;
        items.iter().map(|t| { let w = crate::wingdi::text_width(0, t) + 16; let r = (x, w); x += w; r }).collect()
    }

    fn open_menu_bar(&mut self, top: u64, x: i32, _y: i32) {
        let Some(w) = self.wnd(top) else { return };
        let (menu, wl, l, t) = (w.menu, w.wrect.l, Engine::nc_insets(w.style, w.ex_style, false).0, w.wrect.t + Engine::nc_insets(w.style, w.ex_style, false).1);
        let lay = self.menu_bar_layout(menu);
        for (i, (mx, mw)) in lay.iter().enumerate() {
            let sx = wl + l + mx;
            if x >= sx && x < sx + mw {
                let sub = self.s.win.menus[&menu].items[i].sub;
                if sub == 0 { let id = self.s.win.menus[&menu].items[i].id; self.post(top, WM_COMMAND, id & 0xFFFF, 0); return; }
                self.post(top, WM_INITMENU, menu, 0);
                self.post(top, WM_INITMENUPOPUP, sub, i as u64);
                self.s.win.popup = Some(Popup { menu: sub, hwnd: top, x: sx, y: t + 19, w: 0, h: 0, hot: -1 });
                self.layout_popup();
                return;
            }
        }
    }

    pub(crate) fn layout_popup(&mut self) {
        let Some(p) = &self.s.win.popup else { return };
        let menu = p.menu;
        let items: Vec<(String, u32)> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| (i.text.replace('&', ""), i.flags)).collect());
        let mut w = 60; let mut h = 4;
        for (t, f) in &items {
            let t = t.split('\t').collect::<Vec<_>>();
            let tw = crate::wingdi::text_width(0, t[0]) + t.get(1).map_or(0, |s| crate::wingdi::text_width(0, s) + 24);
            w = w.max(tw + 40);
            h += if f & 0x800 != 0 { 8 } else { 18 };
        }
        let p = self.s.win.popup.as_mut().unwrap();
        p.w = w; p.h = h + 2;
    }

    fn popup_mouse(&mut self, kind: u32, x: i32, y: i32) -> bool {
        let Some(p) = &self.s.win.popup else { return false };
        let (px, py, pw, ph, menu, hwnd) = (p.x, p.y, p.w, p.h, p.menu, p.hwnd);
        let inside = x >= px && x < px + pw && y >= py && y < py + ph;
        let mut hot = -1;
        if inside {
            let mut yy = py + 3;
            let items: Vec<u32> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| i.flags).collect());
            for (i, f) in items.iter().enumerate() {
                let hh = if f & 0x800 != 0 { 8 } else { 18 };
                if y >= yy && y < yy + hh && f & 0x800 == 0 { hot = i as i32; }
                yy += hh;
            }
        }
        if let Some(p) = self.s.win.popup.as_mut() { p.hot = hot; }
        if kind == 3 && inside && hot >= 0 {
            let it = &self.s.win.menus[&menu].items[hot as usize];
            let (id, st) = (it.id, it.state);
            if st & 3 == 0 { self.s.win.popup = None; self.post(hwnd, WM_COMMAND, id & 0xFFFF, 0); }
            return true;
        }
        if kind == 2 && !inside {
            self.s.win.popup = None;
            // a click on the menu bar again just closes it
            return true;
        }
        true
    }
    fn pump_popup_close(&mut self) {}

    // ---------- the system call table ----------

    fn sys_metric(&self, i: u32) -> i32 {
        match i {
            0 => SCREEN_W, 1 => SCREEN_H, 2 | 3 => 17, 4 => 19, 5 | 6 => 1, 7 | 8 => 3, 9 | 10 => 17, 11 | 12 => 32, 13 | 14 => 32,
            15 => 19, 16 => SCREEN_W, 17 => SCREEN_H - 30, 19 => 1, 20 | 21 => 17, 28 | 29 => 112, 30 | 31 => 18, 32 | 33 => 4,
            34 | 35 => 112, 36 | 37 => 4, 43 => 3, 45 | 46 => 2, 49 | 50 => 16, 51 => 16, 52 | 53 => 18, 54 | 55 => 18, 57 | 58 => 160,
            59 | 60 => SCREEN_W, 61 | 62 => SCREEN_W, 68 | 69 => 4, 71 | 72 => 16, 76 | 77 => 0, 78 => SCREEN_W, 79 => SCREEN_H, 80 => 1, 83 | 84 => 4,
            _ => 0,
        }
    }

    fn sys_color(i: u32) -> u32 {
        // COLORREF (0x00BBGGRR), classic Windows scheme
        const C: [u32; 31] = [
            0xC8D0D4, 0x808000, 0x6A240A, 0x808080, 0xC8D0D4, 0xFFFFFF, 0x000000, 0x000000, 0x000000, 0xFFFFFF,
            0xC8D0D4, 0xC8D0D4, 0x808080, 0x6A240A, 0xFFFFFF, 0xC8D0D4, 0x808080, 0x808080, 0x000000, 0xC8D0D4,
            0xFFFFFF, 0x404040, 0xC8D0D4, 0x000000, 0xE1FFFF, 0xB5B5B5, 0x800000, 0xF0CAA6, 0xC0C0C0, 0x6A240A, 0xC8D0D4,
        ];
        C.get(i as usize).copied().unwrap_or(0)
    }
}

/// Window handles are used with and without the upper 16 bits.
pub fn full(h: u64) -> u64 { h & 0xFFFF_FFFF }

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let ar: [u64; 14] = std::array::from_fn(|i| e.arg(i));
    if name.starts_with("NtGdi") { return crate::wingdi::call(e, name); }
    let a0 = ar[0];
    let r = match name {
        "NtUserInitializeClientPfnArrays" => {
            let (pa, pw) = (a0, ar[1]);
            let mut va = vec![]; let mut vw = vec![];
            for i in 0..19u64 { va.push(e.ur64(pa + 8 * i)); vw.push(e.ur64(pw + 8 * i)); }
            e.s.win.procs_a = va; e.s.win.procs_w = vw;
            0
        }
        "NtUserGetSystemDpiForProcess" | "NtUserGetDpiForMonitor" => 96,
        "NtUserCallNoParam" => match a0 as u32 {
            0 => DESKTOP, 1 => (16 << 16) | 6, 2 => now_ms() as u64, _ => 0,
        },
        "NtUserCallOneParam" => {
            let (arg, code) = (a0, ar[1] as u32);
            match code {
                0 => e.new_cursor(),
                4 => e.s.win.menus.get(&arg).map_or(u32::MAX as u64, |m| m.items.len() as u64),
                5 => { let p = arg; e.wr_rect(p, Rect::new(0, 0, SCREEN_W, SCREEN_H)); 1 }
                6 => Engine::sys_color(arg as u32) as u64,
                7 => e.sys_brush(arg as u32),
                8 => e.sys_pen(arg as u32),
                9 => e.sys_metric(arg as u32) as u32 as u64,
                10 => { e.wr_rect(arg, Rect::new(0, 0, SCREEN_W, SCREEN_H)); 1 }
                12 => 0x12,
                14 => { for i in 0..256u64 { let v = e.s.win.keys[i as usize]; let _ = e.mmu.write8(arg + i, v); } 1 }
                _ => 0,
            }
        }
        "NtUserCallTwoParam" => {
            let (a1, a2, code) = (a0, ar[1], ar[2] as u32);
            match code {
                2 => { // GetMonitorInfo
                    let r = Rect::new(0, 0, SCREEN_W, SCREEN_H);
                    e.wr_rect(a2 + 4, r); e.wr_rect(a2 + 20, Rect::new(0, 0, SCREEN_W, SCREEN_H - 30)); e.uw32(a2 + 36, 1);
                    if e.ur32(a2) >= 104 { e.put_w(a2 + 40, "\\\\.\\DISPLAY1", 32); }
                    1
                }
                3 => e.sys_metric(a1 as u32) as u32 as u64,
                4 => 0x10001, // MonitorFromRect: the one monitor
                7 => { // AdjustWindowRect(rect, params{style, ex_style, menu, dpi})
                    let r = e.rd_rect(a1);
                    let (style, ex, menu) = (e.ur32(a2), e.ur32(a2 + 4), e.ur32(a2 + 8));
                    let (l, t, rr, b) = Engine::nc_insets(style, ex, menu != 0);
                    e.wr_rect(a1, Rect::new(r.l - l, r.t - t, r.r + rr, r.b + b));
                    1
                }
                8 => { e.wr_rect(a1, Rect::new(0, 0, SCREEN_W, SCREEN_H)); 1 }
                1 => { // GetMenuInfo
                    let Some(m) = e.s.win.menus.get(&a1) else { return Some(0) };
                    let (st, mh, br, help, data) = (m.style, m.max_h, m.brush, m.help, m.data);
                    e.uw32(a2 + 8, st); e.uw32(a2 + 12, mh); e.uw64(a2 + 16, br); e.uw32(a2 + 24, help); e.uw64(a2 + 32, data);
                    1
                }
                9 => a1, // AllocWinProc: the procedure itself
                0 => a1,
                _ => 0,
            }
        }
        "NtUserCallHwnd" => {
            let (h, code) = (full(a0), ar[1] as u32);
            match code {
                1 => e.wnd(h).map_or(0, |w| w.dlg_info),
                2 => 96,
                3 => h,
                5 => e.wnd(h).map_or(0, |w| if w.style & WS_CHILD != 0 { w.parent } else { w.owner }),
                6 => 0x12,
                9 => e.wnd(h).map_or(0, |w| w.text.encode_utf16().count() as u64),
                10 => (e.wnd(h).is_some() || h == DESKTOP) as u64,
                11 => e.wnd(h).map_or(0, |w| (w.style & WS_DISABLED == 0) as u64),
                12 => e.wnd(h).map_or(0, |w| w.unicode as u64),
                13 => e.is_visible(h) as u64,
                14 => { e.activate(h); 1 }
                15 => h,
                16 => if e.wnd(h).is_some() || h == DESKTOP { h } else { 0 },
                17 => { let tid = e.cur_tid(); if e.wnd(h).map_or(false, |w| w.tid == tid) { h } else { 0 } }
                _ => 0,
            }
        }
        "NtUserCallHwndParam" => {
            let (h, p, code) = (full(a0), ar[1], ar[2] as u32);
            e.hwnd_param(h, p, code)
        }
        "NtUserRegisterClassExWOW" => {
            let (wc, name_us, menu_name, fnid, flags) = (a0, ar[1], ar[3], ar[4], ar[5]);
            let _ = fnid;
            let (name, atom) = e.ustr(name_us);
            if e.find_class(&name, atom).is_some() { e.set_last_error(1410); return Some(0); }
            let style = e.ur32(wc + 4); let proc_ = e.ur64(wc + 8); let ce = e.ur32(wc + 16); let we = e.ur32(wc + 20);
            let inst = e.ur64(wc + 24); let icon = e.ur64(wc + 32); let cursor = e.ur64(wc + 40); let brush = e.ur64(wc + 48);
            let icon_sm = e.ur64(wc + 72);
            let (mn, mna) = if menu_name != 0 { (e.ur64(menu_name + 8), e.ur64(menu_name)) } else { (0, 0) };
            let name = if name.is_empty() { format!("#{}", atom) } else { name };
            e.add_class(Class {
                atom: 0, name: name.to_lowercase(), style, proc_, proc_a: proc_, proc_w: proc_, ansi: flags != 0,
                cls_extra: vec![0; ce as usize], wnd_extra: we as usize, inst, icon, icon_sm, cursor, brush, menu_name: mn, menu_name_a: mna, builtin: false,
            }) as u64
        }
        "NtUserGetClassInfoEx" => {
            // (instance, name, WNDCLASSEXW*, menu name**, ansi)
            e.register_builtins();
            let (name, atom) = e.ustr(ar[1]);
            let out = ar[2];
            match e.find_class(&name, atom) {
                Some(i) => {
                    let c = &e.s.win.classes[i];
                    let v = (c.style, c.proc_, c.cls_extra.len(), c.wnd_extra, c.inst, c.icon, c.cursor, c.brush, c.icon_sm, c.atom, c.menu_name, c.menu_name_a);
                    e.uw32(out + 4, v.0); e.uw64(out + 8, v.1); e.uw32(out + 16, v.2 as u32); e.uw32(out + 20, v.3 as u32);
                    e.uw64(out + 24, v.4); e.uw64(out + 32, v.5); e.uw64(out + 40, v.6); e.uw64(out + 48, v.7); e.uw64(out + 72, v.8);
                    e.uw64(out + 56, v.10); let mp = ar[3]; if mp != 0 { e.uw64(mp, v.11); e.uw64(mp + 8, v.10); }
                    v.9 as u64
                }
                None => { e.set_last_error(1411); 0 }
            }
        }
        "NtUserUnregisterClass" => {
            // (name, instance, client_menu_name*): user32 frees the menu names it gets back, so they must be the class's own
            let (cn, atom) = e.ustr(a0);
            let menu = ar[2];
            let Some(i) = e.find_class(&cn, atom).filter(|&i| !e.s.win.classes[i].builtin) else {
                if menu != 0 { for k in 0..3 { e.uw64(menu + 8 * k, 0); } }
                e.set_last_error(1411); return Some(0) // ERROR_CLASS_DOES_NOT_EXIST
            };
            let (mn, mna) = (e.s.win.classes[i].menu_name, e.s.win.classes[i].menu_name_a);
            if menu != 0 { e.uw64(menu, mna); e.uw64(menu + 8, mn); e.uw64(menu + 16, 0); }
            // the slot stays (windows index classes) but can no longer be found
            let c = &mut e.s.win.classes[i]; c.name.clear(); c.atom = 0; c.menu_name = 0; c.menu_name_a = 0;
            1
        }
        "NtUserGetClassName" => {
            let (h, us) = (full(a0), ar[2]);
            let n = e.wnd(h).map(|w| e.s.win.classes[w.class].name.clone()).unwrap_or_default();
            let n = match n.as_str() { "button" => "Button".into(), "static" => "Static".into(), "edit" => "Edit".into(), "listbox" => "ListBox".into(), "combobox" => "ComboBox".into(), "scrollbar" => "ScrollBar".into(), _ => n };
            let buf = e.ur64(us + 8); let max = e.mmu.read16(us + 2).unwrap_or(0) as usize / 2;
            e.put_w(buf, &n, max) as u64
        }
        "NtUserCreateWindowEx" => return Some(e.create_window()),
        "NtUserDestroyWindow" => { let s = e.destroy_window(a0, Box::new(|_, r| Step::Ret(r))); return Some(e.step(s)); }
        "NtUserShowWindow" | "NtUserShowWindowAsync" => { let cmd = ar[1] as u32; let s = e.show_window(a0, cmd, Box::new(|_, r| Step::Ret(r))); return Some(e.step(s)); }
        "NtUserSetWindowPos" => {
            let (after, x, y, cx, cy, fl) = (ar[1], ar[2] as i32, ar[3] as i32, ar[4] as i32, ar[5] as i32, ar[6] as u32);
            let s = e.win_set_pos(a0, after, x, y, cx, cy, fl, Box::new(|_, r| Step::Ret(r))); return Some(e.step(s));
        }
        "NtUserMoveWindow" => {
            let (x, y, cx, cy, rep) = (ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32, ar[5]);
            let s = e.win_set_pos(a0, 0, x, y, cx, cy, 4 | 0x10 | if rep == 0 { 8 } else { 0 }, Box::new(|_, r| Step::Ret(r))); return Some(e.step(s));
        }
        "NtUserSetWindowLong" | "NtUserSetWindowLongPtr" => {
            let (off, v) = (ar[1] as i32, ar[2]);
            let r = e.set_long(full(a0), off, v, name == "NtUserSetWindowLongPtr");
            // a new window procedure takes the caller's character set (SetWindowLongPtrA vs W)
            if off == -4 { let ansi = ar[3] as u32 != 0; if let Some(w) = e.wnd_mut(a0) { w.unicode = !ansi; } }
            r
        }
        "NtUserSetWindowWord" => { let (off, v) = (ar[1] as i32, ar[2]); e.set_long(full(a0), off, v & 0xFFFF, false) }
        "NtUserSetClassLong" | "NtUserSetClassLongPtr" => {
            let (off, v) = (ar[1] as i32, ar[2]);
            let Some(ci) = e.wnd(a0).map(|w| w.class) else { return Some(0) };
            let c = &mut e.s.win.classes[ci];
            match off {
                -10 => { let o = c.brush; c.brush = v; o }
                -12 => { let o = c.cursor; c.cursor = v; o }
                -14 => { let o = c.icon; c.icon = v; o }
                -34 => { let o = c.icon_sm; c.icon_sm = v; o }
                -24 => { let o = c.proc_; c.proc_ = v; o }
                -26 => { let o = c.style as u64; c.style = v as u32; o }
                o if o >= 0 => { let o = o as usize; let n = if name.ends_with("Ptr") { 8 } else { 4 }; let mut old = 0u64; for k in 0..n { if let Some(b) = c.cls_extra.get_mut(o + k) { old |= (*b as u64) << (8 * k); *b = (v >> (8 * k)) as u8; } } old }
                _ => 0,
            }
        }
        "NtUserGetAncestor" => {
            let (h, kind) = (full(a0), ar[1]);
            match kind { 1 => e.wnd(h).map_or(0, |w| if w.style & WS_CHILD != 0 { w.parent } else { DESKTOP }), _ => e.top_of(h) }
        }
        "NtUserSetParent" => {
            let (h, p) = (full(a0), full(ar[1]));
            let old = e.wnd(h).map_or(0, |w| w.parent);
            if let Some(o) = e.s.win.wins.get_mut(&old) { o.children.retain(|&c| c != h); }
            let p = if p == DESKTOP { 0 } else { p };
            if let Some(w) = e.wnd_mut(h) { w.parent = p; }
            if p != 0 { if let Some(pw) = e.s.win.wins.get_mut(&p) { pw.children.push(h); } e.s.win.tops.retain(|&t| t != h); }
            if old == 0 { DESKTOP } else { old }
        }
        "NtUserGetWindowRelative" | "NtUserGetWindow" => e.get_window(full(a0), ar[1] as u32),
        "NtUserBuildHwndList" => {
            // Wine 11: (desktop, parent hwnd, children, non_immersive, thread, count, buffer, size*)
            // server get_window_list: desktop/no hwnd = top levels; children = all descendants; else siblings from hwnd on
            let (desk, h, kids, max, buf, size) = (a0, full(ar[1]), ar[2] as u32 != 0, ar[5] as usize, ar[6], ar[7]);
            let tops: Vec<u64> = e.s.win.tops.iter().rev().copied().collect();
            let list: Vec<u64> = if desk != 0 { if kids { vec![] } else { tops } }
                else if h == 0 { tops }
                else if kids {
                    let mut out = vec![]; let mut st: Vec<u64> = e.wnd(h).map_or(vec![], |w| w.children.iter().rev().copied().collect());
                    while let Some(c) = st.pop() { out.push(c); if let Some(w) = e.wnd(c) { st.extend(w.children.iter().rev().copied()); } }
                    out
                } else if h == DESKTOP { vec![DESKTOP] }
                else {
                    let sib: Vec<u64> = match e.wnd(h).map(|w| w.parent) { Some(0) => tops, Some(p) => e.wnd(p).map_or(vec![], |w| w.children.clone()), None => vec![] };
                    sib.iter().position(|&x| x == h).map_or(vec![], |i| sib[i..].to_vec())
                };
            let n = list.len().min(max.saturating_sub(1));
            for (i, h) in list.iter().take(n).enumerate() { e.uw64(buf + 8 * i as u64, *h); }
            e.uw64(buf + 8 * n as u64, 1); // terminator HWND_BOTTOM-like
            e.uw32(size, n as u32 + 1);
            0
        }
        "NtUserFindWindowEx" => {
            let (parent, after, cls_us, title_us) = (full(a0), full(ar[1]), ar[2], ar[3]);
            let (cn, atom) = e.ustr(cls_us); let (tn, _) = e.ustr(title_us);
            let ci = if cls_us != 0 { e.find_class(&cn, atom) } else { None };
            let list: Vec<u64> = if parent == 0 || parent == DESKTOP { e.s.win.tops.iter().rev().copied().collect() } else { e.wnd(parent).map_or(vec![], |w| w.children.clone()) };
            let start = if after != 0 { list.iter().position(|&h| h == after).map_or(list.len(), |p| p + 1) } else { 0 };
            list[start.min(list.len())..].iter().copied().find(|&h| {
                let w = e.wnd(h).unwrap();
                (cls_us == 0 || Some(w.class) == ci) && (title_us == 0 || w.text == tn)
            }).unwrap_or(0)
        }
        "NtUserInternalGetWindowText" => { let t = e.wnd(a0).map_or(String::new(), |w| w.text.clone()); let (b, n) = (ar[1], ar[2] as usize); e.put_w(b, &t, n) as u64 }
        "NtUserDefSetText" => {
            let us = ar[1];
            let t = if us == 0 { String::new() } else {
                // LARGE_STRING { Length, MaximumLength|bAnsi, Buffer }
                let len = e.ur32(us) as usize; let ansi = e.ur32(us + 4) & 0x8000_0000 != 0; let b = e.ur64(us + 8);
                if b == 0 { String::new() } else if ansi { let mut v = vec![0u8; len]; let _ = e.mmu.read_bytes(b, &mut v); String::from_utf8_lossy(&v).into_owned() } else { let v: Vec<u16> = (0..len / 2).map(|i| e.mmu.read16(b + 2 * i as u64).unwrap_or(0)).collect(); String::from_utf16_lossy(&v) }
            };
            if let Some(w) = e.wnd_mut(a0) { w.text = t; w.nc_dirty = true; }
            e.s.win.dirty = true;
            1
        }
        "NtUserMessageCall" => {
            let (msg, wp, lp, info, kind, ansi) = (ar[1] as u32, ar[2], ar[3], ar[4], ar[5] as u32, ar[6] as u32 != 0); // BOOL: low 32 bits
            let h = full(a0);
            match kind {
                0x2b1 | 0x2b3 | 0x2b7 | 0x2b8 => {
                    // SendMessage: same-thread target, user32 calls the procedure itself
                    if h == 0xFFFF { return Some(1); } // broadcast
                    if info != 0 && kind != 0x2b7 { e.uw64(info + 8, 0); if e.fill_params(info, h, msg, wp, lp, ansi) { return Some(0); } }
                    if e.wnd(h).is_none() { return Some(0); }
                    // no params to fill (notify): call it from here
                    let s = e.send(h, msg, wp, lp, |_, r| Step::Ret(r));
                    return Some(e.step(s));
                }
                0x3001 => e.fill_params(info, h, msg, wp, lp, ansi) as u64, // GetDispatchParams
                0x2ab => {
                    // CallWindowProc: params.func set by user32
                    let func = e.ur64(info);
                    let mut p = vec![0u8; 72];
                    p[0..8].copy_from_slice(&func.to_le_bytes());
                    p[8..16].copy_from_slice(&h.to_le_bytes());
                    p[16..20].copy_from_slice(&msg.to_le_bytes());
                    p[24..32].copy_from_slice(&wp.to_le_bytes());
                    p[32..40].copy_from_slice(&lp.to_le_bytes());
                    p[40..44].copy_from_slice(&(ansi as u32).to_le_bytes());
                    // a builtin class procedure: use the matching pair
                    let (pa, pw) = e.s.win.classes.iter().find(|c| c.builtin && (c.proc_a == func || c.proc_w == func)).map_or((func, func), |c| (c.proc_a, c.proc_w));
                    let dst = if pa != pw { ansi } else { e.wnd(h).map_or(ansi, |w| if w.proc_ == func { !w.unicode } else { ansi }) };
                    p[44..48].copy_from_slice(&(dst as u32).to_le_bytes());
                    p[48..52].copy_from_slice(&5u32.to_le_bytes());
                    p[52..56].copy_from_slice(&0x12u32.to_le_bytes());
                    p[56..64].copy_from_slice(&pa.to_le_bytes());
                    p[64..72].copy_from_slice(&pw.to_le_bytes());
                    let _ = e.mmu.write_bytes(info, &p);
                    1
                }
                0x29e | 0x29d | 0x29a | 0x29c => { let s = e.def_proc(h, msg, wp, lp, ansi); return Some(e.step(s)); }
                _ => 0,
            }
        }
        "NtUserPostMessage" => {
            let (msg, wp, lp) = (ar[1] as u32, ar[2], ar[3]);
            if full(a0) == 0xFFFF { let tops = e.s.win.tops.clone(); for t in tops { e.post(t, msg, wp, lp); } 1 } else { e.post(a0, msg, wp, lp) as u64 }
        }
        "NtUserPostThreadMessage" => {
            let (tid, msg, wp, lp) = (a0 as u32, ar[1] as u32, ar[2], ar[3]);
            let m = Msg { hwnd: 0, msg, wp, lp, time: now_ms() as u32, x: 0, y: 0 };
            e.s.win.queues.entry(tid).or_default().posted.push_back(m);
            1
        }
        "NtUserPostQuitMessage" => { let tid = e.cur_tid(); e.s.win.queues.entry(tid).or_default().quit = Some(a0 as i32); 1 }
        "NtUserPeekMessage" => {
            let (h, first, last, flags) = (ar[1], ar[2] as u32, ar[3] as u32, ar[4] as u32);
            match e.peek(a0, h, first, last, flags & 1 != 0) { Some(_) => 1, None => 0 }
        }
        "NtUserGetMessage" => {
            let (h, first, last) = (ar[1], ar[2] as u32, ar[3] as u32);
            match e.peek(a0, h, first, last, true) {
                Some(more) => more as u64,
                None => return Some(e.wait_on(crate::sched::W::Msg { out: a0, hwnd: h, first, last }, u64::MAX)),
            }
        }
        "NtUserMsgWaitForMultipleObjectsEx" => {
            // (count, handles, timeout, mask, flags): wake on input as well
            let (n, hs, ms) = (a0 as u32, ar[1], ar[2] as u32 as u64);
            let tid = e.cur_tid();
            let has = e.s.win.queues.get(&tid).map_or(false, |q| !q.posted.is_empty() || !q.input.is_empty() || q.quit.is_some())
                || e.s.win.wins.values().any(|w| w.tid == tid && !w.update.empty()) || e.next_timer(tid) <= now_ms();
            if has { return Some(n as u64); }
            let handles: Vec<u64> = (0..n as u64).map(|i| e.ur64(hs + 8 * i)).collect();
            return Some(e.wait_on(crate::sched::W::MsgOrObjs { hs: handles }, ms));
        }
        "NtUserWaitMessage" => return Some(e.wait_on(crate::sched::W::MsgOrObjs { hs: vec![] }, u64::MAX)),
        "NtUserGetQueueStatus" => {
            let tid = e.cur_tid();
            let q = e.s.win.queues.entry(tid).or_default();
            let mut s = 0u64;
            if !q.posted.is_empty() { s |= 8; }
            if !q.input.is_empty() { s |= 7; }
            if e.s.win.wins.values().any(|w| w.tid == tid && !w.update.empty()) { s |= 0x20; }
            if e.next_timer(tid) <= now_ms() { s |= 0x10; }
            (s << 16) | s
        }
        "NtUserDispatchMessage" => {
            let m = a0;
            let (h, msg, wp, lp) = (e.ur64(m), e.ur32(m + 8), e.ur64(m + 16), e.ur64(m + 24));
            if msg == WM_PAINT {
                // a window that does not paint would get WM_PAINT forever
                let s = e.send(h, msg, wp, lp, move |e, r| { if let Some(w) = e.wnd_mut(h) { w.update = Rect::default(); w.erase = false; } Step::Ret(r) });
                return Some(e.step(s));
            }
            let s = e.send(h, msg, wp, lp, |_, r| Step::Ret(r));
            return Some(e.step(s));
        }
        "NtUserTranslateMessage" => {
            let m = a0;
            let (h, msg, wp, time) = (e.ur64(m), e.ur32(m + 8), e.ur64(m + 16), e.ur32(m + 32));
            if msg != WM_KEYDOWN && msg != WM_SYSKEYDOWN { return Some(0); }
            match e.s.win.chars.remove(&time) {
                Some(c) => { e.post(h, if msg == WM_KEYDOWN { WM_CHAR } else { 0x106 }, c as u64, 1); 1 }
                None => 0,
            }
        }
        "NtUserSetTimer" | "NtUserSetSystemTimer" => {
            let (h, id, ms, proc_) = (full(a0), ar[1], ar[2] as u32, if name == "NtUserSetTimer" { ar[3] } else { 0 });
            let tid = e.cur_tid();
            let ms = (ms.max(10)) as f64;
            let id = if h == 0 && id == 0 { 0x7FFF_0000 + e.s.win.timers.len() as u64 } else { id };
            e.s.win.timers.retain(|t| !(t.hwnd == h && t.id == id));
            e.s.win.timers.push(Timer { hwnd: h, id, period: ms, next: now_ms() + ms, proc_, tid });
            if id == 0 { 1 } else { id }
        }
        "NtUserKillTimer" | "NtUserKillSystemTimer" => { let (h, id) = (full(a0), ar[1]); let n = e.s.win.timers.len(); e.s.win.timers.retain(|t| !(t.hwnd == h && t.id == id)); (n != e.s.win.timers.len()) as u64 }
        "NtUserInvalidateRect" => {
            let (r, erase) = (ar[1], ar[2] as u32 != 0);
            let rr = if r != 0 { Some(e.rd_rect(r)) } else { None };
            if full(a0) == 0 { let all: Vec<u64> = e.s.win.tops.clone(); for t in all { e.invalidate(t, None, erase); } } else { e.invalidate(a0, rr, erase); }
            1
        }
        "NtUserInvalidateRgn" => { let erase = ar[2] as u32 != 0; e.invalidate(a0, None, erase); 1 }
        "NtUserValidateRect" => {
            let r = ar[1];
            if let Some(w) = e.wnd_mut(a0) { if r == 0 { w.update = Rect::default(); w.erase = false; } }
            1
        }
        "NtUserRedrawWindow" => {
            let (r, flags) = (ar[1], ar[3] as u32);
            let rr = if r != 0 { Some(e.rd_rect(r)) } else { None };
            if flags & 1 != 0 { e.invalidate(if full(a0) == 0 { DESKTOP } else { a0 }, rr, flags & 4 != 0); }
            if flags & 8 != 0 { if let Some(w) = e.wnd_mut(a0) { w.update = Rect::default(); } }
            if flags & 0x400 != 0 { if let Some(w) = e.wnd_mut(a0) { w.nc_dirty = true; } }
            e.s.win.dirty = true;
            1
        }
        "NtUserGetUpdateRect" => {
            let r = ar[1];
            let u = e.wnd(a0).map_or(Rect::default(), |w| w.update);
            e.wr_rect(r, u);
            (!u.empty()) as u64
        }
        "NtUserGetUpdateRgn" => e.wnd(a0).map_or(0, |w| if w.update.empty() { 1 } else { 2 }),
        "NtUserUpdateWindow" => 1,
        "NtUserBeginPaint" => {
            let (h, ps) = (full(a0), ar[1]);
            let Some(w) = e.wnd(h) else { return Some(0) };
            let (upd, erase, cw, ch) = (w.update, w.erase, w.crect.w(), w.crect.h());
            let upd = if upd.empty() { Rect::new(0, 0, cw, ch) } else { upd };
            if let Some(w) = e.wnd_mut(h) { w.update = Rect::default(); w.erase = false; }
            let hdc = e.get_dc(h, false);
            e.dc_clip_to(hdc, upd);
            e.uw64(ps, hdc); e.uw32(ps + 8, 0); e.wr_rect(ps + 12, upd);
            if erase {
                let s = e.send(h, WM_ERASEBKGND, hdc, 0, move |e, r| {
                    if r == 0 { /* not erased */ }
                    let _ = e; Step::Ret(hdc)
                });
                // the default procedure fills with the class brush
                return Some(e.step(s));
            }
            hdc
        }
        "NtUserEndPaint" => { let ps = ar[1]; let hdc = e.ur64(ps); e.release_dc(hdc); 1 }
        "NtUserGetDCEx" => { let fl = ar[2] as u32; e.get_dc(full(a0), fl & 1 != 0) }
        "NtUserGetWindowDC" => e.get_dc(full(a0), true),
        "NtUserReleaseDC" => { let hdc = ar[1]; e.release_dc(hdc); 1 }
        "NtUserGetDC" => e.get_dc(full(a0), false),
        "NtUserSetFocus" => {
            let h = full(a0); let old = e.s.win.focus;
            if h != 0 && e.wnd(h).is_none() { return Some(0); }
            if h == old { return Some(old); }
            e.s.win.focus = h;
            if h != 0 { e.activate(h); e.s.win.focus = h; }
            let s = e.send(old, WM_KILLFOCUS, h, 0, move |e, _| e.send(h, WM_SETFOCUS, old, 0, move |_, _| Step::Ret(old)));
            return Some(e.step(s));
        }
        "NtUserGetForegroundWindow" => e.s.win.active,
        "NtUserSetForegroundWindow" | "NtUserSetActiveWindow" => { let old = e.s.win.active; e.activate(a0); if name == "NtUserSetActiveWindow" { old } else { 1 } }
        "NtUserGetGUIThreadInfo" => {
            let p = ar[1];
            e.uw32(p + 4, 0); e.uw64(p + 8, e.s.win.active); e.uw64(p + 16, e.s.win.focus); e.uw64(p + 24, e.s.win.capture);
            1
        }
        "NtUserSetCapture" => { let old = e.s.win.capture; e.s.win.capture = full(a0); old }
        "NtUserReleaseCapture" => { e.s.win.capture = 0; 1 }
        "NtUserEnableWindow" => {
            let en = ar[1] as u32 != 0;
            let Some(w) = e.wnd_mut(a0) else { return Some(0) };
            let was = w.style & WS_DISABLED != 0;
            if en { w.style &= !WS_DISABLED; } else { w.style |= WS_DISABLED; }
            e.invalidate(a0, None, true);
            was as u64
        }
        "NtUserIsWindowRectFullyVisible" => 1,
        "NtUserGetKeyState" => { let k = a0 as usize & 0xFF; let v = e.s.win.keys[k]; (if v & 0x80 != 0 { 0xFF80 } else { 0 } | (v & 1) as u64) }
        "NtUserGetAsyncKeyState" => { let k = a0 as usize & 0xFF; if e.s.win.keys[k] & 0x80 != 0 { 0x8000 } else { 0 } }
        "NtUserGetKeyboardState" => { for i in 0..256u64 { let v = e.s.win.keys[i as usize]; let _ = e.mmu.write8(a0 + i, v); } 1 }
        "NtUserSetKeyboardState" => 1,
        "NtUserGetKeyboardLayout" => 0x0409_0409,
        "NtUserGetKeyboardLayoutName" => { e.put_w(a0, "00000409", 9); 1 }
        "NtUserMapVirtualKeyEx" => a0 & 0xFF,
        "NtUserGetCursorInfo" => { e.uw32(a0 + 4, 1); e.uw32(a0 + 16, e.s.win.mouse.0 as u32); e.uw32(a0 + 20, e.s.win.mouse.1 as u32); 1 }
        "NtUserGetCursorPos" | "NtUserGetPhysicalCursorPos" => { let (x, y) = e.s.win.mouse; e.uw32(a0, x as u32); e.uw32(a0 + 4, y as u32); 1 }
        "NtUserSetCursorPos" => { e.s.win.mouse = (a0 as i32, ar[1] as i32); 1 }
        "NtUserSetCursor" | "NtUserGetCursor" => 0x20004,
        "NtUserShowCursor" => 1,
        "NtUserClipCursor" => 1,
        "NtUserGetClipCursor" => { e.wr_rect(a0, Rect::new(0, 0, SCREEN_W, SCREEN_H)); 1 }
        "NtUserSetCursorIconData" | "NtUserDestroyCursor" => 1,
        "NtUserFindExistingCursorIcon" => 0,
        "NtUserGetIconSize" => { let (w, h) = (ar[2], ar[3]); e.uw32(w, 32); e.uw32(h, 64); 1 }
        "NtUserGetIconInfo" => 0,
        "NtUserDrawIconEx" => 1,
        "NtUserGetDoubleClickTime" => 500,
        "NtUserSystemParametersInfo" | "NtUserSystemParametersInfoForDpi" => e.spi(a0 as u32, ar[1] as u32, ar[2]),
        "NtUserGetSystemMenu" => { let h = full(a0); if ar[1] as u32 != 0 { 0 } else { e.wnd(h).map_or(0, |_| 0) } }
        "NtUserCreateMenu" => e.new_menu(false),
        "NtUserCreatePopupMenu" => e.new_menu(true),
        "NtUserDestroyMenu" => { e.s.win.menus.remove(&a0); 1 }
        "NtUserThunkedMenuItemInfo" => {
            let (pos, flags, method, info, text) = (ar[1] as u32, ar[2] as u32, ar[3] as u32, ar[4], ar[5]);
            e.menu_item_info(a0, pos, flags & 0x400 != 0, method, info, text)
        }
        "NtUserGetMenuItemInfo" => { let (pos, by, info) = (ar[1] as u32, ar[2] as u32 != 0, ar[3]); e.menu_item_info(a0, pos, by, 2, info, 0) }
        "NtUserRemoveMenu" | "NtUserDeleteMenu" => {
            let (pos, flags) = (ar[1] as u32, ar[2] as u32);
            let Some(m) = e.s.win.menus.get_mut(&a0) else { return Some(0) };
            let i = if flags & 0x400 != 0 { Some(pos as usize).filter(|&i| i < m.items.len()) } else { m.items.iter().position(|it| it.id as u32 == pos) };
            match i { Some(i) => { m.items.remove(i); 1 } None => 0 }
        }
        "NtUserCheckMenuItem" => {
            let (id, flags) = (ar[1] as u32, ar[2] as u32);
            let Some(m) = e.s.win.menus.get_mut(&a0) else { return Some(u32::MAX as u64) };
            let i = if flags & 0x400 != 0 { Some(id as usize).filter(|&i| i < m.items.len()) } else { m.items.iter().position(|it| it.id as u32 == id) };
            let i = match i { Some(i) => i, None => {
                // look in submenus
                let subs: Vec<u64> = m.items.iter().map(|it| it.sub).filter(|&s| s != 0).collect();
                for s in subs { if let Some(sm) = e.s.win.menus.get_mut(&s) { if let Some(it) = sm.items.iter_mut().find(|it| it.id as u32 == id) { let old = it.state & 8; if flags & 8 != 0 { it.state |= 8; } else { it.state &= !8; } return Some(old as u64); } } }
                return Some(u32::MAX as u64)
            } };
            let it = &mut m.items[i];
            let old = it.state & 8;
            if flags & 8 != 0 { it.state |= 8; } else { it.state &= !8; }
            old as u64
        }
        "NtUserEnableMenuItem" => {
            let (id, flags) = (ar[1] as u32, ar[2] as u32);
            let mut done = u32::MAX as u64;
            let ms: Vec<u64> = std::iter::once(a0).chain(e.s.win.menus.get(&a0).map_or(vec![], |m| m.items.iter().map(|i| i.sub).filter(|&s| s != 0).collect())).collect();
            for (k, mh) in ms.iter().enumerate() {
                let Some(m) = e.s.win.menus.get_mut(mh) else { continue };
                let i = if flags & 0x400 != 0 { if k == 0 { Some(id as usize).filter(|&i| i < m.items.len()) } else { None } } else { m.items.iter().position(|it| it.id as u32 == id) };
                if let Some(i) = i { let it = &mut m.items[i]; done = (it.state & 3) as u64; it.state = (it.state & !3) | (flags & 3); break; }
            }
            done
        }
        "NtUserSetMenu" => {
            let (h, m) = (full(a0), ar[1]);
            let Some(w) = e.wnd(h) else { return Some(0) };
            let (wr, style, ex) = (w.wrect, w.style, w.ex_style);
            let cr = e.client_from(wr, style, ex, m != 0);
            if let Some(w) = e.wnd_mut(h) { w.menu = m; w.crect = cr; w.nc_dirty = true; }
            e.s.win.dirty = true;
            1
        }
        "NtUserGetMenu" => e.wnd(a0).map_or(0, |w| w.menu),
        "NtUserDrawMenuBar" => { if let Some(w) = e.wnd_mut(a0) { w.nc_dirty = true; } e.s.win.dirty = true; 1 }
        "NtUserGetMenuBarInfo" | "NtUserGetMenuItemRect" => 0,
        "NtUserSetMenuContextHelpId" | "NtUserSetMenuDefaultItem" => 1,
        "NtUserTrackPopupMenuEx" => {
            let (flags, x, y, h) = (ar[1] as u32, ar[2] as i32, ar[3] as i32, full(ar[4]));
            let _ = flags;
            e.s.win.popup = Some(Popup { menu: a0, hwnd: h, x, y, w: 0, h: 0, hot: -1 });
            e.layout_popup();
            1
        }
        "NtUserEndMenu" => { e.s.win.popup = None; 1 }
        "NtUserGetProp" => { let k = ar[1]; e.wnd(a0).and_then(|w| w.props.iter().find(|p| p.0 == k).map(|p| p.1)).unwrap_or(0) }
        "NtUserSetProp" => { let (k, v) = (ar[1], ar[2]); if let Some(w) = e.wnd_mut(a0) { w.props.retain(|p| p.0 != k); w.props.push((k, v)); 1 } else { 0 } }
        "NtUserRemoveProp" => { let k = ar[1]; e.wnd_mut(a0).and_then(|w| { let v = w.props.iter().find(|p| p.0 == k).map(|p| p.1); w.props.retain(|p| p.0 != k); v }).unwrap_or(0) }
        "NtUserGetAtomName" => {
            // (atom, UNICODE_STRING*): a class atom's name (user32 turns MAKEINTATOM class names into strings)
            e.register_builtins();
            let (atom, us) = (a0 as u16, ar[1]);
            let Some(i) = e.find_class("", atom) else { return Some(0) };
            let n = e.s.win.classes[i].name.clone();
            let buf = e.ur64(us + 8); let max = e.mmu.read16(us + 2).unwrap_or(0) as usize / 2;
            let k = e.put_w(buf, &n, max);
            let _ = e.mmu.write16(us, (2 * k) as u16);
            k as u64
        }
        "NtUserGetThreadState" => match a0 as u32 {
            // focus, active, capture window; message time
            0 => e.s.win.focus, 1 => e.s.win.active, 2 => e.s.win.capture, 9 => now_ms() as u32 as u64, _ => 0,
        },
        "NtUserIsClipboardFormatAvailable" | "NtUserOpenClipboard" | "NtUserCloseClipboard" | "NtUserEmptyClipboard" => 0,
        "NtUserGetClipboardSequenceNumber" => 1,
        "NtUserMessageBeep" | "NtUserFlashWindowEx" => 1,
        "NtUserGetWindowPlacement" => {
            let p = ar[1];
            let Some(w) = e.wnd(a0) else { return Some(0) };
            let r = w.wrect;
            e.uw32(p, 44); e.uw32(p + 4, 0); e.uw32(p + 8, 1); e.wr_rect(p + 28, r);
            1
        }
        "NtUserSetWindowPlacement" => {
            // WINDOWPLACEMENT: showCmd at +8, rcNormalPosition at +28 (top levels: screen coordinates)
            let (p, h) = (ar[1], full(a0));
            if e.wnd(h).is_none() { return Some(0) }
            let (cmd, r) = (e.ur32(p + 8), e.rd_rect(p + 28));
            let s = if r.r > r.l && r.b > r.t {
                e.win_set_pos(h, 0, r.l, r.t, r.r - r.l, r.b - r.t, 0x14, Box::new(move |e, _| e.show_window(h, cmd, Box::new(|_, _| Step::Ret(1)))))
            } else { e.show_window(h, cmd, Box::new(|_, _| Step::Ret(1))) };
            return Some(e.step(s));
        }
        "NtUserGetTitleBarInfo" | "NtUserGetScrollBarInfo" => 0,
        "NtUserSetScrollInfo" => 0,
        "NtUserShowScrollBar" | "NtUserEnableScrollBar" => 1,
        "NtUserScrollWindowEx" | "NtUserScrollDC" => { e.invalidate(a0, None, true); 1 }
        "NtUserSetWindowRgn" => 1,
        "NtUserGetWindowRgnEx" => 0,
        "NtUserWindowFromPoint" => { let (x, y) = (a0 as i32, ar[1] as i32); e.window_at(x, y) }
        "NtUserChildWindowFromPointEx" => {
            let (x, y) = (ar[1] as i32, ar[2] as i32);
            let (ox, oy) = e.client_origin(a0);
            let kids = e.wnd(a0).map_or(vec![], |w| w.children.clone());
            kids.iter().rev().copied().find(|&c| e.wnd(c).map_or(false, |w| w.wrect.has(x + ox, y + oy))).unwrap_or(full(a0))
        }
        "NtUserRealChildWindowFromPoint" => full(a0),
        "NtUserIsChildWindowDpiMessageEnabled" | "NtUserEnableNonClientDpiScaling" => 1,
        "NtUserSetThreadDesktop" | "NtUserCloseDesktop" | "NtUserCloseWindowStation" | "NtUserSetProcessWindowStation" => 1,
        "NtUserGetThreadDesktop" | "NtUserGetProcessWindowStation" | "NtUserOpenInputDesktop" | "NtUserOpenDesktop" | "NtUserCreateDesktopEx" | "NtUserCreateWindowStation" | "NtUserOpenWindowStation" => 0x5000,
        "NtUserGetObjectInformation" => { let len = ar[3] as u64; let b = ar[2]; for i in 0..len { let _ = e.mmu.write8(b + i, 0); } 1 }
        "NtUserSetObjectInformation" => 1,
        "NtUserGetProcessDpiAwarenessContext" | "NtUserGetDpiForWindow" => 0x12,
        "NtUserSetProcessDpiAwarenessContext" => 1,
        "NtUserGetDisplayConfigBufferSizes" => { e.uw32(ar[1], 1); e.uw32(ar[2], 1); 0 }
        "NtUserEnumDisplayDevices" => if ar[1] == 0 { e.put_w(ar[3] + 4, "\\\\.\\DISPLAY1", 32); e.put_w(ar[3] + 68, "InkSoC display", 128); e.uw32(ar[3] + 324, 5); 0 } else { 0xC000_0001 },
        "NtUserEnumDisplaySettings" => {
            let dm = ar[2];
            e.uw32(dm + 168, 32); e.uw32(dm + 172, SCREEN_W as u32); e.uw32(dm + 176, SCREEN_H as u32); e.uw32(dm + 184, 60);
            e.uw32(dm + 72, 0x1C0000);
            if ar[1] == u32::MAX as u64 - 0 || ar[1] <= 1 { 1 } else { 0 }
        }
        "NtUserChangeDisplaySettings" => 0,
        "NtUserEnumDisplayMonitors" => 1,
        "NtUserGetLayeredWindowAttributes" | "NtUserSetLayeredWindowAttributes" | "NtUserUpdateLayeredWindow" => 1,
        "NtUserActivateKeyboardLayout" => 0x0409_0409,
        "NtUserGetKeyboardLayoutList" => { if a0 > 0 && ar[1] != 0 { e.uw64(ar[1], 0x0409_0409); } 1 }
        "NtUserVkKeyScanEx" => a0 & 0xFF,
        "NtUserToUnicodeEx" => {
            let (vk, buf) = (a0 as u32, ar[3]);
            let c = if (0x41..=0x5A).contains(&vk) { vk + 32 } else if (0x30..=0x39).contains(&vk) || vk == 0x20 { vk } else { 0 };
            if c != 0 { let _ = e.mmu.write16(buf, c as u16); 1 } else { 0 }
        }
        "NtUserGetKeyNameText" => 0,
        "NtUserAttachThreadInput" | "NtUserLockWindowUpdate" | "NtUserRegisterHotKey" | "NtUserUnregisterHotKey" => 1,
        "NtUserSetWindowsHookEx" => 0x60000 + 4,
        "NtUserUnhookWindowsHookEx" | "NtUserUnhookWinEvent" => 1,
        "NtUserSetWinEventHook" => 0x60008,
        "NtUserCallMsgFilter" => 0,
        "NtUserNotifyWinEvent" => 0,
        "NtUserGetLastInputInfo" => { e.uw32(a0 + 4, now_ms() as u32); 1 }
        "NtUserDragDetect" | "NtUserDragObject" => 0,
        "NtUserCreateCaret" | "NtUserShowCaret" | "NtUserHideCaret" | "NtUserSetCaretPos" | "NtUserDestroyCaret" | "NtUserSetCaretBlinkTime" => 1,
        "NtUserGetCaretBlinkTime" => 530,
        "NtUserGetCaretPos" => { e.uw32(a0, 0); e.uw32(a0 + 4, 0); 1 }
        "NtUserCopyAcceleratorTable" => 0,
        "NtUserCreateAcceleratorTable" => { 0x70004 }
        "NtUserDestroyAcceleratorTable" => 1,
        "NtUserTranslateAccelerator" => 0,
        "NtUserRegisterWindowMessage" => { let (n, _) = e.ustr(a0); let w = &mut e.s.win; let k = w.props_atoms.len() as u16; *w.props_atoms.entry(n).or_insert(0xC100 + k) as u64 }
        "NtUserGetRawInputDeviceList" | "NtUserGetRegisteredRawInputDevices" | "NtUserGetRawInputData" | "NtUserGetRawInputBuffer" => 0,
        "NtUserRegisterRawInputDevices" => 1,
        "NtUserGetPointerInfoList" => 0,
        "NtUserIsTouchWindow" => 0,
        "NtUserRedrawFrame" => 1,
        "NtUserGetControlBrush" | "NtUserGetControlColor" => e.sys_brush(15),
        "NtUserCountClipboardFormats" | "NtUserGetPriorityClipboardFormat" | "NtUserGetClipboardOwner" | "NtUserGetClipboardViewer" | "NtUserGetOpenClipboardWindow" => 0,
        "NtUserWaitForInputIdle" => 0,
        "NtUserExcludeUpdateRgn" => 1,
        "NtUserSetShellWindowEx" | "NtUserSetProgmanWindow" | "NtUserSetTaskmanWindow" => 1,
        "NtUserGetModuleFileNameEx" => 0,
        "NtUserQueryWindow" => 4,
        "NtUserSwitchDesktop" | "NtUserSetSysColors" => 1,
        "NtUserBeginDeferWindowPos" => 0x80004,
        "NtUserDeferWindowPosAndBand" => {
            let (h, after, x, y, cx, cy, fl) = (ar[1], ar[2], ar[3] as i32, ar[4] as i32, ar[5] as i32, ar[6] as i32, ar[7] as u32);
            let s = e.win_set_pos(h, after, x, y, cx, cy, fl, Box::new(move |_, _| Step::Ret(a0)));
            return Some(e.step(s));
        }
        "NtUserEndDeferWindowPosEx" => 1,
        "NtUserFillWindow" => 1,
        "NtUserFlashWindow" => 1,
        "NtUserGetMouseMovePointsEx" => u32::MAX as u64,
        "NtUserTrackMouseEvent" => 1,
        "NtUserArrangeIconicWindows" => 0,
        "NtUserAlterWindowStyle" => 0,
        "NtUserGetDialogBaseUnits" => (16 << 16) | 6,
        "NtUserCloseWindow" | "NtUserOpenIcon" => 1,
        "NtUserSelectPalette" => return crate::wingdi::call(e, name),
        "NtUserRealizePalette" => 0,
        _ => {
            if !e.s.win.unknown.contains(name) {
                e.s.win.unknown.insert(name.to_string());
                crate::console(&format!("[win32u] {} (not yet)\n", name));
            }
            0
        }
    };
    Some(r)
}

impl Engine {
    fn hwnd_param(&mut self, h: u64, p: u64, code: u32) -> u64 {
        match code {
            0 | 23 => {
                // ClientToScreen / ScreenToClient (POINT*)
                if self.wnd(h).is_none() && h != DESKTOP { return 0; }
                let (ox, oy) = self.client_origin(h);
                let (x, y) = (self.ur32(p) as i32, self.ur32(p + 4) as i32);
                let (nx, ny) = if code == 0 { (x + ox, y + oy) } else { (x - ox, y - oy) };
                self.uw32(p, nx as u32); self.uw32(p + 4, ny as u32);
                1
            }
            1 => { // GetChildRect: window rect relative to parent client
                let Some(w) = self.wnd(h) else { return 0 };
                let (r, par) = (w.wrect, w.parent);
                let (ox, oy) = self.client_origin(par);
                self.wr_rect(p, r.off(-ox, -oy));
                1
            }
            2..=6 => {
                let Some(ci) = self.wnd(h).map(|w| w.class) else { return 0 };
                let c = &self.s.win.classes[ci];
                let off = p as i32;
                match off {
                    -10 => c.brush, -12 => c.cursor, -14 => c.icon, -34 => c.icon_sm, -16 => c.inst, -24 => if code == 2 || code == 4 { c.proc_a } else { c.proc_w },
                    -26 => c.style as u64, -18 => c.wnd_extra as u64, -20 => c.cls_extra.len() as u64, -32 => c.atom as u64, -8 => c.menu_name,
                    o if o >= 0 => { let o = o as usize; let n = if code >= 4 { 8 } else if code == 6 { 2 } else { 4 }; (0..n).fold(0u64, |a, k| a | (*c.cls_extra.get(o + k).unwrap_or(&0) as u64) << (8 * k)) }
                    _ => 0,
                }
            }
            8 => { // GetWindowInfo
                let Some(w) = self.wnd(h) else { return 0 };
                let (wr, cr, st, ex, act) = (w.wrect, w.crect, w.style, w.ex_style, self.s.win.active == h);
                self.wr_rect(p + 4, wr); self.wr_rect(p + 20, cr); self.uw32(p + 36, st); self.uw32(p + 40, ex); self.uw32(p + 44, act as u32);
                let (l, _, _, _) = Engine::nc_insets(st, ex, false);
                self.uw32(p + 48, l as u32); self.uw32(p + 52, l as u32); self.uw32(p + 60, 1);
                1
            }
            9..=12 | 18 => {
                let off = p as i32;
                let size = match code { 11 | 12 => 8, 18 => 2, _ => 4 };
                self.get_long(h, off, size, code == 9 || code == 11)
            }
            13 | 14 => {
                // GetWindowRect / GetClientRect (RECT*, dpi): param points at { RECT*, dpi }
                let out = self.ur64(p);
                let Some(w) = self.wnd(h) else {
                    if h == DESKTOP { self.wr_rect(out, Rect::new(0, 0, SCREEN_W, SCREEN_H)); return 1; }
                    return 0;
                };
                let r = if code == 13 { w.wrect } else { Rect::new(0, 0, w.crect.w(), w.crect.h()) };
                self.wr_rect(out, r);
                1
            }
            16 => self.get_window(h, p as u32),
            17 => { let tid = self.wnd(h).map_or(0, |w| w.tid); let pp = p; if pp != 0 { self.uw32(pp, 4); } tid as u64 }
            19 => self.is_child_of(full(p), h) as u64,
            20 => {
                // MapWindowPoints(to, points, count, dpi): param -> { hwnd_to, points*, count, dpi }
                let to = full(self.ur64(p)); let pts = self.ur64(p + 8); let n = self.ur32(p + 16);
                let (fx, fy) = self.client_origin(h); let (tx, ty) = self.client_origin(to);
                let (dx, dy) = (fx - tx, fy - ty);
                for i in 0..n as u64 { let (x, y) = (self.ur32(pts + 8 * i) as i32, self.ur32(pts + 8 * i + 4) as i32); self.uw32(pts + 8 * i, (x + dx) as u32); self.uw32(pts + 8 * i + 4, (y + dy) as u32); }
                ((dy as u16 as u64) << 16) | (dx as u16 as u64)
            }
            22 => 0x10001,
            24 => { if let Some(w) = self.wnd_mut(h) { w.dlg_info = p; } 1 }
            _ => 0,
        }
    }

    fn get_long(&mut self, h: u64, off: i32, size: usize, ansi: bool) -> u64 {
        let Some(w) = self.wnd(h) else { return 0 };
        match off {
            -4 => { let _ = ansi; w.proc_ }
            -6 => w.inst,
            -8 => if w.style & WS_CHILD != 0 { w.parent } else { w.owner },
            -12 => if w.style & WS_CHILD != 0 { w.id } else { w.menu },
            -16 => w.style as u64,
            -20 => w.ex_style as u64,
            -21 => w.userdata,
            o if o >= 0 => { let o = o as usize; (0..size).fold(0u64, |a, k| a | (*w.extra.get(o + k).unwrap_or(&0) as u64) << (8 * k)) }
            _ => 0,
        }
    }

    fn set_long(&mut self, h: u64, off: i32, v: u64, ptr: bool) -> u64 {
        let Some(w) = self.wnd_mut(h) else { return 0 };
        let mut nc = false;
        let old = match off {
            -4 => { let o = w.proc_; w.proc_ = v; o }
            -6 => { let o = w.inst; w.inst = v; o }
            -8 => { let o = w.owner; w.owner = v; o }
            -12 => if w.style & WS_CHILD != 0 { let o = w.id; w.id = v; o } else { let o = w.menu; w.menu = v; w.nc_dirty = true; o },
            -16 => { let o = w.style as u64; w.style = (v as u32 & !WS_VISIBLE) | (w.style & WS_VISIBLE); nc = true; o }
            -20 => { let o = w.ex_style as u64; w.ex_style = v as u32; nc = true; o }
            -21 => { let o = w.userdata; w.userdata = v; o }
            o if o >= 0 => {
                let o = o as usize; let n = if ptr { 8 } else { 4 };
                let mut old = 0u64;
                for k in 0..n { if let Some(b) = w.extra.get_mut(o + k) { old |= (*b as u64) << (8 * k); *b = (v >> (8 * k)) as u8; } }
                old
            }
            _ => 0,
        };
        if nc { w.nc_dirty = true; let (wr, st, ex, m) = (w.wrect, w.style, w.ex_style, w.menu != 0); let cr = self.client_from(wr, st, ex, m); if let Some(w) = self.wnd_mut(h) { w.crect = cr; } self.s.win.dirty = true; }
        old
    }

    fn get_window(&self, h: u64, rel: u32) -> u64 {
        let Some(w) = self.wnd(h) else { return 0 };
        let sibs: Vec<u64> = if w.parent != 0 && w.style & WS_CHILD != 0 { self.wnd(w.parent).map_or(vec![], |p| p.children.clone()) } else { self.s.win.tops.iter().rev().copied().collect() };
        let i = sibs.iter().position(|&s| s == h);
        match rel {
            0 => sibs.first().copied().unwrap_or(0),
            1 => sibs.last().copied().unwrap_or(0),
            2 => i.and_then(|i| sibs.get(i + 1)).copied().unwrap_or(0),
            3 => i.and_then(|i| if i > 0 { sibs.get(i - 1) } else { None }).copied().unwrap_or(0),
            4 => w.owner,
            5 => w.children.first().copied().unwrap_or(0),
            _ => 0,
        }
    }

    fn spi(&mut self, action: u32, val: u32, p: u64) -> u64 {
        match action {
            0x30 => { self.wr_rect(p, Rect::new(0, 0, SCREEN_W, SCREEN_H - 30)); 1 } // SPI_GETWORKAREA
            0x29 => {
                // SPI_GETNONCLIENTMETRICS: sizes and fonts
                let n = self.ur32(p).max(340) as u64;
                for i in 4..n { let _ = self.mmu.write8(p + i, 0); }
                let m = [1u32, 17, 17, 19, 18];
                for (i, v) in m.iter().enumerate() { self.uw32(p + 4 + 4 * i as u64, *v); }
                for (k, off) in [24u64, 24 + 92 + 8, 24 + 92 + 8 + 92 + 8, 24 + 92 * 3 + 16, 24 + 92 * 4 + 16].iter().enumerate() {
                    let f = p + off;
                    if f + 92 > p + n { break; }
                    self.uw32(f, (-11i32) as u32); self.uw32(f + 16, if k == 0 { 700 } else { 400 });
                    self.put_w(f + 28, "Tahoma", 32);
                }
                1
            }
            0x1F => { // SPI_GETICONTITLELOGFONT
                for i in 0..92 { let _ = self.mmu.write8(p + i, 0); }
                self.uw32(p, (-11i32) as u32); self.uw32(p + 16, 400); self.put_w(p + 28, "Tahoma", 32); 1
            }
            0x2C => { if p != 0 { self.uw32(p, 0); } 1 }
            0x1000 | 0x1002 | 0x100A | 0x1012 | 0x1016 | 0x1024 | 0x103E | 0x1042 | 0x104A | 0x1014 | 0x2006 => { if p != 0 { self.uw32(p, 0); } 1 }
            0x26 | 0x0E => { if p != 0 { self.uw32(p, 1); } 1 } // icon metrics / grid
            0x0D => { if p != 0 { self.uw32(p, 75); } 1 }
            0x48 => { if p != 0 { self.uw32(p, 1); } 1 } // font smoothing
            0x200C => { if p != 0 { self.uw32(p, 3); } 1 }
            0x68 => { if p != 0 { self.uw32(p, 3); } 1 } // wheel lines
            0x0A | 0x0016 => { if p != 0 { self.uw32(p, 400); } 1 }
            0x5C | 0x5E => { if p != 0 { self.uw32(p, 0); } 1 }
            _ => { let _ = val; if p != 0 { self.uw32(p, 0); } 1 }
        }
    }
}
