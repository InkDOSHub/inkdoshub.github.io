// Views (where a DC draws), coordinate mapping and single pixels.

use super::*;

impl Engine {
    pub(super) fn view(&mut self, hdc: u64) -> Option<View> {
        let (attr, hwnd, whole, mem, bmp, clip, vis) = match self.dc(hdc) {
            Some(d) => (d.attr, d.hwnd, d.whole, d.mem, d.bmp, d.clip, d.vis),
            None => return None,
        };
        if mem {
            let bi = idx(bmp);
            let (w, h, mono) = match self.s.gdi.objs.get(&bi) {
                Some(Obj::Bmp(b)) => (b.w, b.h, b.mono()),
                _ => (0, 0, true),
            };
            let mut c = Rect::new(0, 0, w, h);
            if let Some(cl) = clip {
                c = c.inter(&cl);
            }
            return Some(View { tgt: Tgt::Bmp(bi), ox: 0, oy: 0, clip: c, attr, mono });
        }
        let none = View { tgt: Tgt::None, ox: 0, oy: 0, clip: Rect::default(), attr, mono: false };
        let hw = full(hwnd);
        let Some(w) = self.wnd(hw) else { return Some(none) };
        let top = self.top_of(hw);
        let Some(twr) = self.wnd(top).map(|w| w.wrect) else { return Some(none) };
        let area = if whole { w.wrect } else { w.crect };
        let mut c = area;
        let (mut p, mut child) = (w.parent, w.style & 0x4000_0000 != 0);
        while child && p != 0 {
            let Some(pw) = self.wnd(p) else { break };
            c = c.inter(&pw.crect);
            child = pw.style & 0x4000_0000 != 0;
            p = pw.parent;
        }
        c = c.inter(&twr);
        if !self.is_visible(hw) {
            c = Rect::default();
        }
        let (ox, oy) = (area.l - twr.l, area.t - twr.t);
        let mut c = c.off(-twr.l, -twr.t);
        if let Some(v) = vis {
            c = c.inter(&v.off(ox, oy));
        }
        if let Some(cl) = clip {
            c = c.inter(&cl.off(ox, oy));
        }
        Some(View { tgt: Tgt::Surf(top), ox, oy, clip: c, attr, mono: false })
    }

    /// Logical to device coordinates.
    pub(super) fn lp(&mut self, attr: u64, x: i32, y: i32) -> (i32, i32) {
        let mm = self.r32(attr + 60);
        let (wox, woy, vox, voy) =
            (self.r32(attr + 100) as i32, self.r32(attr + 104) as i32, self.r32(attr + 116) as i32, self.r32(attr + 120) as i32);
        if mm <= 1 {
            return (x - wox + vox, y - woy + voy);
        }
        let (wex, wey, vex, vey) =
            (self.r32(attr + 108) as i32, self.r32(attr + 112) as i32, self.r32(attr + 124) as i32, self.r32(attr + 128) as i32);
        let sx = |v: i32, we: i32, ve: i32| if we == 0 { v } else { (v as i64 * ve as i64 / we as i64) as i32 };
        (sx(x - wox, wex, vex) + vox, sx(y - woy, wey, vey) + voy)
    }
    pub(super) fn dp(&mut self, attr: u64, x: i32, y: i32) -> (i32, i32) {
        let mm = self.r32(attr + 60);
        let (wox, woy, vox, voy) =
            (self.r32(attr + 100) as i32, self.r32(attr + 104) as i32, self.r32(attr + 116) as i32, self.r32(attr + 120) as i32);
        if mm <= 1 {
            return (x - vox + wox, y - voy + woy);
        }
        let (wex, wey, vex, vey) =
            (self.r32(attr + 108) as i32, self.r32(attr + 112) as i32, self.r32(attr + 124) as i32, self.r32(attr + 128) as i32);
        let sx = |v: i32, we: i32, ve: i32| if ve == 0 { v } else { (v as i64 * we as i64 / ve as i64) as i32 };
        (sx(x - vox, wex, vex) + wox, sx(y - voy, wey, vey) + woy)
    }
    pub(super) fn lpr(&mut self, attr: u64, r: Rect) -> Rect {
        let (l, t) = self.lp(attr, r.l, r.t);
        let (rr, b) = self.lp(attr, r.r, r.b);
        Rect::new(l.min(rr), t.min(b), l.max(rr), t.max(b))
    }

    pub(super) fn take(&mut self, t: Tgt) -> (Vec<u32>, i32, i32) {
        match t {
            Tgt::Surf(h) => match self.s.gdi.surfs.get_mut(&h) {
                Some(s) => (std::mem::take(&mut s.px), s.w, s.h),
                None => (vec![], 0, 0),
            },
            Tgt::Bmp(i) => {
                let (dib, f, td) = match self.s.gdi.objs.get_mut(&i) {
                    Some(Obj::Bmp(b)) => {
                        if b.dib == 0 {
                            return (std::mem::take(&mut b.px), b.w, b.h);
                        }
                        (b.dib, Fmt { w: b.w, h: b.h, bpp: b.bpp, masks: b.masks, pal: b.pal.clone(), comp: b.comp, hdr: 40 }, b.topdown)
                    }
                    _ => return (vec![], 0, 0),
                };
                let raw = self.bytes(dib, f.stride() * f.h as usize);
                (decode(&raw, &f, f.h, td), f.w, f.h)
            }
            Tgt::None => (vec![], 0, 0),
        }
    }

    pub(super) fn give(&mut self, t: Tgt, mut px: Vec<u32>, changed: bool) {
        match t {
            Tgt::Surf(h) => {
                if let Some(s) = self.s.gdi.surfs.get_mut(&h) {
                    if s.px.is_empty() {
                        s.px = px;
                    }
                }
                if changed {
                    self.s.win.dirty = true;
                }
            }
            Tgt::Bmp(i) => {
                let Some(Obj::Bmp(b)) = self.s.gdi.objs.get_mut(&i) else { return };
                if b.dib == 0 {
                    if changed && b.bpp == 1 {
                        for p in px.iter_mut() {
                            *p = if lum(*p & 0xFFFFFF) >= 128 { 0xFFFFFF } else { 0 };
                        }
                    }
                    if b.px.is_empty() {
                        b.px = px;
                    }
                } else if changed {
                    let f = Fmt { w: b.w, h: b.h, bpp: b.bpp, masks: b.masks, pal: b.pal.clone(), comp: b.comp, hdr: 40 };
                    let (dib, td) = (b.dib, b.topdown);
                    let raw = encode(&px, &f, f.h, td);
                    let _ = self.mmu.write_bytes(dib, &raw);
                }
            }
            Tgt::None => {}
        }
    }

    pub(super) fn brush_eval(&mut self, brush: u64, attr: u64, mono_dst: bool, ox: i32, oy: i32) -> Be {
        let b = match self.s.gdi.objs.get(&idx(brush)) {
            Some(Obj::Brush(b)) => b.clone(),
            _ => return Be::None,
        };
        match b {
            Brush::Null => Be::None,
            Brush::Solid(c) => Be::Solid(rgb(c)),
            Brush::Dc => Be::Solid(rgb(self.r32(attr + 16))),
            Brush::Hatch(st, c) => {
                let bg = if (self.r16(attr + 50) as u32) == 2 { Some(rgb(self.r32(attr + 12))) } else { None };
                Be::Hatch(st, rgb(c), bg)
            }
            Brush::Pat { w, h, mut px, mono } => {
                if mono && !mono_dst {
                    let (fg, bg) = (rgb(self.r32(attr + 24)), rgb(self.r32(attr + 12)));
                    for p in px.iter_mut() {
                        *p = if *p & 0xFFFFFF != 0 { bg } else { fg };
                    }
                }
                let (bx, by) = (self.r32(attr + 92) as i32, self.r32(attr + 96) as i32);
                Be::Pat { w, h, px, ox: ox + bx, oy: oy + by }
            }
        }
    }

    /// Fills a rectangle (target coordinates) with a brush and a ROP3 (pattern + destination only).
    pub(super) fn fill_with(&mut self, v: View, r: Rect, be: &Be, rop: u8) {
        if let Be::None = be {
            if rop == 0xF0 {
                return;
            }
        }
        let (mut px, sw, sh) = self.take(v.tgt);
        let c = v.clip.inter(&Rect::new(0, 0, sw, sh)).inter(&r);
        if !c.empty() {
            for y in c.t..c.b {
                let row = (y * sw) as usize;
                if let (Be::Solid(col), 0xF0) = (be, rop) {
                    px[row + c.l as usize..row + c.r as usize].fill(*col);
                    continue;
                }
                for x in c.l..c.r {
                    let i = row + x as usize;
                    let p = match be_at(be, x, y) {
                        Some(p) => p,
                        None => {
                            if rop == 0xF0 || rop == 0x5A {
                                continue;
                            } else {
                                0
                            }
                        }
                    };
                    px[i] = rop3(rop, p, 0, px[i]);
                }
            }
        }
        self.give(v.tgt, px, !c.empty());
    }

    pub(super) fn pen_eval(&mut self, hdc: u64, attr: u64) -> Option<(u32, i32, u32)> {
        let pen = self.dc(hdc)?.pen;
        let (style, width, color, dc) = match self.s.gdi.objs.get(&idx(pen)) {
            Some(Obj::Pen(p)) => (p.style, p.width, p.color, p.dc),
            _ => return None,
        };
        if style & 0xF == 5 {
            return None;
        }
        let c = if dc { self.r32(attr + 20) } else { color };
        Some((rgb(c), width.max(1), style & 0xF))
    }

    pub(super) fn rop_mode(&mut self, attr: u64) -> u32 {
        self.r16(attr + 54) as u32
    }
}
