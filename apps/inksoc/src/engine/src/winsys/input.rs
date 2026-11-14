// Mouse and keyboard input from the page.

use super::*;

impl Engine {
    /// Topmost visible window (deepest child) under a screen point.
    pub(super) fn window_at(&self, x: i32, y: i32) -> u64 {
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
}
