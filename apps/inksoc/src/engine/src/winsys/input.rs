// Mouse and keyboard input from the page.

use super::*;

impl Engine {
    /// Topmost visible window (deepest child) under a screen point.
    pub(super) fn window_at(&self, x: i32, y: i32) -> u64 {
        for &t in self.s.win.tops.iter().rev() {
            let Some(w) = self.wnd(t) else { continue };
            if w.style & WS_VISIBLE == 0 || !w.wrect.has(x, y) {
                continue;
            }
            let mut h = t;
            'down: loop {
                let kids = self.wnd(h).map_or(vec![], |w| w.children.clone());
                for &c in kids.iter().rev() {
                    let Some(cw) = self.wnd(c) else { continue };
                    if cw.style & WS_VISIBLE != 0 && cw.wrect.has(x, y) {
                        h = c;
                        continue 'down;
                    }
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
                if self.popup_mouse(kind, x, y) {
                    return;
                }
                if let Some((h, gx, gy)) = self.s.win.drag {
                    if kind == 3 {
                        self.s.win.drag = None;
                        return;
                    }
                    if let Some(w) = self.wnd(h) {
                        let (nx, ny) = (x - gx, y - gy);
                        let (dx, dy) = (nx - w.wrect.l, ny - w.wrect.t);
                        if let Some(w) = self.wnd_mut(h) {
                            w.wrect = w.wrect.off(dx, dy);
                            w.crect = w.crect.off(dx, dy);
                        }
                        self.move_children(h, dx, dy);
                    }
                    return;
                }
                let btn = data; // 0 left, 1 middle, 2 right
                if kind == 2 {
                    self.s.win.buttons |= 1 << btn;
                } else if kind == 3 {
                    self.s.win.buttons &= !(1 << btn);
                }
                let target = if self.s.win.capture != 0 { self.s.win.capture } else { self.window_at(x, y) };
                if target == 0 {
                    return;
                }
                if kind == 2 {
                    self.activate(target);
                }
                let Some(w) = self.wnd(target) else { return };
                let (w_class, w_crect, w_tid, w_style) = (w.class, w.crect, w.tid, w.style);
                let _ = w;
                if w_style & WS_DISABLED != 0 && self.s.win.capture == 0 {
                    return;
                }
                let ht = if self.s.win.capture != 0 { 1 } else { self.hit_test(target, x, y) };
                let mk = (self.s.win.buttons & 1)
                    | ((self.s.win.buttons & 4) >> 1)
                    | ((self.s.win.buttons & 2) << 3)
                    | if self.s.win.keys[0x10] & 0x80 != 0 { 4 } else { 0 }
                    | if self.s.win.keys[0x11] & 0x80 != 0 { 8 } else { 0 };
                if ht == 1 {
                    let (cx, cy) = (x - w_crect.l, y - w_crect.t);
                    let base = [WM_LBUTTONDOWN, 0x207, 0x204][btn.min(2) as usize];
                    let mut msg = match kind {
                        1 => WM_MOUSEMOVE,
                        2 => base,
                        _ => base + 1,
                    };
                    if kind == 2 {
                        let t = now_ms();
                        let (lt, lx, ly, lh) = self.s.win.last_click;
                        let dbl = self.s.win.classes[w_class].style & 0x8 != 0;
                        if dbl && lh == target && t - lt < 500.0 && (lx - x).abs() < 4 && (ly - y).abs() < 4 {
                            msg = base + 2;
                            self.s.win.last_click = (0.0, 0, 0, 0);
                        } else {
                            self.s.win.last_click = (t, x, y, target);
                        }
                        let _ = WM_LBUTTONDBLCLK;
                    }
                    let lp = ((cy as u16 as u64) << 16) | cx as u16 as u64;
                    let m = Msg { hwnd: target, msg, wp: mk as u64, lp, time: now_ms() as u32, x, y };
                    let tid = w_tid;
                    let q = self.s.win.queues.entry(tid).or_default();
                    if msg == WM_MOUSEMOVE {
                        if let Some(last) = q.input.back_mut() {
                            if last.msg == WM_MOUSEMOVE && last.hwnd == target {
                                *last = m;
                                return;
                            }
                        }
                    }
                    q.input.push_back(m);
                } else if kind == 2 && btn == 0 {
                    let top = self.top_of(target);
                    match ht {
                        2 => {
                            let w = self.wnd(top).unwrap();
                            self.s.win.drag = Some((top, x - w.wrect.l, y - w.wrect.t));
                        }
                        20 => {
                            self.post(top, WM_SYSCOMMAND, 0xF060, 0);
                        }
                        5 => {
                            self.open_menu_bar(top, x, y);
                        }
                        _ => {}
                    }
                }
            }
            4 | 5 => {
                let vk = (data & 0xFF) as usize;
                let ch = data >> 16;
                if kind == 4 {
                    self.s.win.keys[vk] = 0x80 | (self.s.win.keys[vk] ^ 1) & 1;
                } else {
                    self.s.win.keys[vk] &= 1;
                }
                let target = if self.s.win.focus != 0 { self.s.win.focus } else { self.s.win.active };
                let Some(w) = self.wnd(target) else { return };
                let tid = w.tid;
                let alt = self.s.win.keys[0x12] & 0x80 != 0;
                let msg = match (kind, alt) {
                    (4, false) => WM_KEYDOWN,
                    (5, false) => WM_KEYUP,
                    (4, true) => WM_SYSKEYDOWN,
                    _ => 0x105,
                };
                self.s.win.seq = self.s.win.seq.wrapping_add(1);
                let stamp = (now_ms() as u32 & !0xFFFF) | (self.s.win.seq & 0xFFFF);
                if kind == 4 && ch != 0 {
                    self.s.win.chars.insert(stamp, ch);
                }
                let (scan, ext) = vk_scan(vk as u32);
                let lp = 1 | ((scan as u64) << 16) | ((ext as u64) << 24) | if kind == 5 { 0xC000_0000 } else { 0 };
                let m = Msg { hwnd: target, msg, wp: vk as u64, lp, time: stamp, x: self.s.win.mouse.0, y: self.s.win.mouse.1 };
                self.s.win.queues.entry(tid).or_default().input.push_back(m);
            }
            _ => {}
        }
    }
}

/// US keyboard: virtual key -> (set 1 scan code, extended key). Games (SDL) read the
/// scan code in the key message's lParam to tell the keys apart.
const SCANS: &[(u32, u32, bool)] = &[
    (0x1B, 0x01, false), (0x31, 0x02, false), (0x32, 0x03, false), (0x33, 0x04, false), (0x34, 0x05, false),
    (0x35, 0x06, false), (0x36, 0x07, false), (0x37, 0x08, false), (0x38, 0x09, false), (0x39, 0x0A, false),
    (0x30, 0x0B, false), (0xBD, 0x0C, false), (0xBB, 0x0D, false), (0x08, 0x0E, false), (0x09, 0x0F, false),
    (0x51, 0x10, false), (0x57, 0x11, false), (0x45, 0x12, false), (0x52, 0x13, false), (0x54, 0x14, false),
    (0x59, 0x15, false), (0x55, 0x16, false), (0x49, 0x17, false), (0x4F, 0x18, false), (0x50, 0x19, false),
    (0xDB, 0x1A, false), (0xDD, 0x1B, false), (0x0D, 0x1C, false), (0x11, 0x1D, false), (0xA2, 0x1D, false),
    (0xA3, 0x1D, true), (0x41, 0x1E, false), (0x53, 0x1F, false), (0x44, 0x20, false), (0x46, 0x21, false),
    (0x47, 0x22, false), (0x48, 0x23, false), (0x4A, 0x24, false), (0x4B, 0x25, false), (0x4C, 0x26, false),
    (0xBA, 0x27, false), (0xDE, 0x28, false), (0xC0, 0x29, false), (0x10, 0x2A, false), (0xA0, 0x2A, false),
    (0xDC, 0x2B, false), (0x5A, 0x2C, false), (0x58, 0x2D, false), (0x43, 0x2E, false), (0x56, 0x2F, false),
    (0x42, 0x30, false), (0x4E, 0x31, false), (0x4D, 0x32, false), (0xBC, 0x33, false), (0xBE, 0x34, false),
    (0xBF, 0x35, false), (0xA1, 0x36, false), (0x6A, 0x37, false), (0x12, 0x38, false), (0xA4, 0x38, false),
    (0xA5, 0x38, true), (0x20, 0x39, false), (0x14, 0x3A, false), (0x70, 0x3B, false), (0x71, 0x3C, false),
    (0x72, 0x3D, false), (0x73, 0x3E, false), (0x74, 0x3F, false), (0x75, 0x40, false), (0x76, 0x41, false),
    (0x77, 0x42, false), (0x78, 0x43, false), (0x79, 0x44, false), (0x90, 0x45, false), (0x91, 0x46, false),
    (0x24, 0x47, true), (0x26, 0x48, true), (0x21, 0x49, true), (0x6D, 0x4A, false), (0x25, 0x4B, true),
    (0x27, 0x4D, true), (0x6B, 0x4E, false), (0x23, 0x4F, true), (0x28, 0x50, true), (0x22, 0x51, true),
    (0x2D, 0x52, true), (0x2E, 0x53, true), (0x7A, 0x57, false), (0x7B, 0x58, false), (0x5B, 0x5B, true),
    (0x5C, 0x5C, true), (0x5D, 0x5D, true),
];
pub(crate) fn vk_scan(vk: u32) -> (u32, bool) {
    SCANS.iter().find(|s| s.0 == vk).map_or((0, false), |s| (s.1, s.2))
}
pub(crate) fn scan_vk(scan: u32) -> u32 {
    SCANS.iter().find(|s| s.1 == scan & 0xFF).map_or(0, |s| s.0)
}
