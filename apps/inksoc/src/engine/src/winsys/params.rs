// System metrics and colors, window longs and relations, SystemParametersInfo.

use super::*;

impl Engine {
    pub(super) fn sys_metric(&self, i: u32) -> i32 {
        match i {
            0 => SCREEN_W, 1 => SCREEN_H, 2 | 3 => 17, 4 => 19, 5 | 6 => 1, 7 | 8 => 3, 9 | 10 => 17, 11 | 12 => 32, 13 | 14 => 32,
            15 => 19, 16 => SCREEN_W, 17 => SCREEN_H - 30, 19 => 1, 20 | 21 => 17, 28 | 29 => 112, 30 | 31 => 18, 32 | 33 => 4,
            34 | 35 => 112, 36 | 37 => 4, 43 => 3, 45 | 46 => 2, 49 | 50 => 16, 51 => 16, 52 | 53 => 18, 54 | 55 => 18, 57 | 58 => 160,
            59 | 60 => SCREEN_W, 61 | 62 => SCREEN_W, 68 | 69 => 4, 71 | 72 => 16, 76 | 77 => 0, 78 => SCREEN_W, 79 => SCREEN_H, 80 => 1, 83 | 84 => 4,
            _ => 0,
        }
    }

    pub(super) fn sys_color(i: u32) -> u32 {
        // COLORREF (0x00BBGGRR), classic Windows scheme
        const C: [u32; 31] = [
            0xC8D0D4, 0x808000, 0x6A240A, 0x808080, 0xC8D0D4, 0xFFFFFF, 0x000000, 0x000000, 0x000000, 0xFFFFFF,
            0xC8D0D4, 0xC8D0D4, 0x808080, 0x6A240A, 0xFFFFFF, 0xC8D0D4, 0x808080, 0x808080, 0x000000, 0xC8D0D4,
            0xFFFFFF, 0x404040, 0xC8D0D4, 0x000000, 0xE1FFFF, 0xB5B5B5, 0x800000, 0xF0CAA6, 0xC0C0C0, 0x6A240A, 0xC8D0D4,
        ];
        C.get(i as usize).copied().unwrap_or(0)
    }
}

impl Engine {
    pub(super) fn hwnd_param(&mut self, h: u64, p: u64, code: u32) -> u64 {
        match code {
            0 | 23 => {
                // ClientToScreen / ScreenToClient (POINT*)
                if self.wnd(h).is_none() && h != DESKTOP { return 0; }
                let (ox, oy) = self.client_origin(h);
                let (x, y) = (self.ur32(p) as i32, self.ur32(p + 4) as i32);
                let (nx, ny) = if code == 0 { (x + ox, y + oy) } else { (x - ox, y - oy) };
                self.w32(p, nx as u32); self.w32(p + 4, ny as u32);
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
                self.wr_rect(p + 4, wr); self.wr_rect(p + 20, cr); self.w32(p + 36, st); self.w32(p + 40, ex); self.w32(p + 44, act as u32);
                let (l, _, _, _) = Engine::nc_insets(st, ex, false);
                self.w32(p + 48, l as u32); self.w32(p + 52, l as u32); self.w32(p + 60, 1);
                1
            }
            9..=12 | 18 => {
                let off = p as i32;
                let size = match code { 11 | 12 => 8, 18 => 2, _ => 4 };
                self.get_long(h, off, size, code == 9 || code == 11)
            }
            13 | 14 => {
                // GetWindowRect / GetClientRect (RECT*, dpi): param points at { RECT*, dpi }
                let out = self.r64(p);
                let Some(w) = self.wnd(h) else {
                    if h == DESKTOP { self.wr_rect(out, Rect::new(0, 0, SCREEN_W, SCREEN_H)); return 1; }
                    return 0;
                };
                let r = if code == 13 { w.wrect } else { Rect::new(0, 0, w.crect.w(), w.crect.h()) };
                self.wr_rect(out, r);
                1
            }
            16 => self.get_window(h, p as u32),
            17 => { let tid = self.wnd(h).map_or(0, |w| w.tid); let pp = p; if pp != 0 { self.w32(pp, 4); } tid as u64 }
            19 => self.is_child_of(full(p), h) as u64,
            20 => {
                // MapWindowPoints(to, points, count, dpi): param -> { hwnd_to, points*, count, dpi }
                let to = full(self.r64(p)); let pts = self.r64(p + 8); let n = self.ur32(p + 16);
                let (fx, fy) = self.client_origin(h); let (tx, ty) = self.client_origin(to);
                let (dx, dy) = (fx - tx, fy - ty);
                for i in 0..n as u64 { let (x, y) = (self.ur32(pts + 8 * i) as i32, self.ur32(pts + 8 * i + 4) as i32); self.w32(pts + 8 * i, (x + dx) as u32); self.w32(pts + 8 * i + 4, (y + dy) as u32); }
                ((dy as u16 as u64) << 16) | (dx as u16 as u64)
            }
            22 => 0x10001,
            24 => { if let Some(w) = self.wnd_mut(h) { w.dlg_info = p; } 1 }
            _ => 0,
        }
    }

    pub(super) fn get_long(&mut self, h: u64, off: i32, size: usize, ansi: bool) -> u64 {
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

    pub(super) fn set_long(&mut self, h: u64, off: i32, v: u64, ptr: bool) -> u64 {
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

    pub(super) fn get_window(&self, h: u64, rel: u32) -> u64 {
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

    pub(super) fn spi(&mut self, action: u32, val: u32, p: u64) -> u64 {
        match action {
            0x30 => { self.wr_rect(p, Rect::new(0, 0, SCREEN_W, SCREEN_H - 30)); 1 } // SPI_GETWORKAREA
            0x29 => {
                // SPI_GETNONCLIENTMETRICS: sizes and fonts
                let n = self.ur32(p).max(340) as u64;
                for i in 4..n { self.w8(p + i, 0); }
                let m = [1u32, 17, 17, 19, 18];
                for (i, v) in m.iter().enumerate() { self.w32(p + 4 + 4 * i as u64, *v); }
                for (k, off) in [24u64, 24 + 92 + 8, 24 + 92 + 8 + 92 + 8, 24 + 92 * 3 + 16, 24 + 92 * 4 + 16].iter().enumerate() {
                    let f = p + off;
                    if f + 92 > p + n { break; }
                    self.w32(f, (-11i32) as u32); self.w32(f + 16, if k == 0 { 700 } else { 400 });
                    self.put_w(f + 28, "Tahoma", 32);
                }
                1
            }
            0x1F => { // SPI_GETICONTITLELOGFONT
                for i in 0..92 { self.w8(p + i, 0); }
                self.w32(p, (-11i32) as u32); self.w32(p + 16, 400); self.put_w(p + 28, "Tahoma", 32); 1
            }
            0x2C => { if p != 0 { self.w32(p, 0); } 1 }
            0x1000 | 0x1002 | 0x100A | 0x1012 | 0x1016 | 0x1024 | 0x103E | 0x1042 | 0x104A | 0x1014 | 0x2006 => { if p != 0 { self.w32(p, 0); } 1 }
            0x26 | 0x0E => { if p != 0 { self.w32(p, 1); } 1 } // icon metrics / grid
            0x0D => { if p != 0 { self.w32(p, 75); } 1 }
            0x48 => { if p != 0 { self.w32(p, 1); } 1 } // font smoothing
            0x200C => { if p != 0 { self.w32(p, 3); } 1 }
            0x68 => { if p != 0 { self.w32(p, 3); } 1 } // wheel lines
            0x0A | 0x0016 => { if p != 0 { self.w32(p, 400); } 1 }
            0x5C | 0x5E => { if p != 0 { self.w32(p, 0); } 1 }
            _ => { let _ = val; if p != 0 { self.w32(p, 0); } 1 }
        }
    }
}
