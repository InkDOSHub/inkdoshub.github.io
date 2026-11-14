// Text output with the built-in bitmap fonts.

use super::*;

impl Engine {
    pub(super) fn dc_font(&mut self, hdc: u64) -> (usize, Vec<u8>) {
        let f = self.dc(hdc).map_or(0, |d| d.font);
        match self.s.gdi.objs.get(&idx(f)) {
            Some(Obj::Font(f)) => (f.fi, f.lf.clone()),
            _ => (3, mk_lf(16, 700, "System")),
        }
    }

    pub(super) fn ext_text_out(&mut self, hdc: u64, x: i32, y: i32, flags: u32, rect: u64, s: u64, n: u32, dx: u64) -> bool {
        let Some(v) = self.view(hdc) else { return false };
        let attr = v.attr;
        let (fi, lf) = self.dc_font(hdc);
        let fd = &fonts()[fi];
        let chars: Vec<u32> = (0..n as u64).map(|i| self.r16(s + 2 * i) as u32).collect();
        let extra = self.r32(attr + 64) as i32;
        let pdy = flags & 0x2000 != 0;
        let advs: Vec<i32> = chars
            .iter()
            .enumerate()
            .map(|(i, &c)| if dx != 0 { self.r32(dx + if pdy { 8 } else { 4 } * i as u64) as i32 } else { glyph(fd, c).map_or(0, |g| g.0) + extra })
            .collect();
        let width: i32 = advs.iter().sum();
        let align = self.r16(attr + 48) as u32;
        let (mut x, mut y) = if align & 1 != 0 { (self.r32(attr + 28) as i32, self.r32(attr + 32) as i32) } else { (x, y) };
        if align & 1 != 0 {
            let nx = x + if align & 6 == 2 { -width } else { width };
            self.w32(attr + 28, nx as u32);
        }
        match align & 6 {
            6 => x -= width / 2,
            2 => x -= width,
            _ => {}
        }
        match align & 24 {
            24 => y -= fd.asc,
            8 => y -= fd.h,
            _ => {}
        }
        let (dx0, dy0) = self.lp(attr, x, y);
        let (tx, ty) = (dx0 + v.ox, dy0 + v.oy);
        let rc = if rect != 0 {
            let r = self.rd_rect(rect);
            Some(self.lpr(attr, r).off(v.ox, v.oy))
        } else {
            None
        };
        let (fg, bg) = (rgb(self.r32(attr + 24)), rgb(self.r32(attr + 12)));
        let opaque_mode = (self.r16(attr + 50) as u32) == 2;
        let (mut px, sw, sh) = self.take(v.tgt);
        let mut clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        if let (Some(r), true) = (rc, flags & 2 != 0) {
            let c = clip.inter(&r);
            for yy in c.t..c.b {
                px[(yy * sw + c.l) as usize..(yy * sw + c.r) as usize].fill(bg);
            }
        }
        if let (Some(r), true) = (rc, flags & 4 != 0) {
            clip = clip.inter(&r);
        }
        if opaque_mode && !(flags & 2 != 0 && rc.is_some()) {
            let c = clip.inter(&Rect::new(tx, ty, tx + width, ty + fd.h));
            for yy in c.t..c.b {
                px[(yy * sw + c.l) as usize..(yy * sw + c.r) as usize].fill(bg);
            }
        }
        let mut cx = tx;
        for (i, &ch) in chars.iter().enumerate() {
            if let Some((_, gw, off)) = glyph(fd, ch) {
                draw_glyph(&mut px, sw, clip, fd, gw, off, cx, ty, fg, lf.get(20).copied().unwrap_or(0) != 0);
            }
            cx += advs[i];
        }
        if lf.get(21).copied().unwrap_or(0) != 0 {
            let yy = ty + fd.asc + 1;
            for xx in tx..tx + width {
                if clip.has(xx, yy) {
                    px[(yy * sw + xx) as usize] = fg;
                }
            }
        }
        if lf.get(22).copied().unwrap_or(0) != 0 {
            let yy = ty + fd.asc * 2 / 3;
            for xx in tx..tx + width {
                if clip.has(xx, yy) {
                    px[(yy * sw + xx) as usize] = fg;
                }
            }
        }
        self.give(v.tgt, px, true);
        true
    }

    pub(super) fn text_metrics(&mut self, hdc: u64, tm: u64) -> bool {
        let (fi, lf) = self.dc_font(hdc);
        let fd = &fonts()[fi];
        let avg = glyph(fd, 'x' as u32).map_or(5, |g| g.0);
        let max = (32..256).filter_map(|c| glyph(fd, c)).map(|g| g.0).max().unwrap_or(10);
        let v: [i32; 11] = [fd.h, fd.asc, fd.h - fd.asc, fd.h - fd.px, 0, avg, max, if fd.bold { 700 } else { 400 }, 0, 96, 96];
        for (i, x) in v.iter().enumerate() {
            self.w32(tm + 4 * i as u64, *x as u32);
        }
        self.w16(tm + 44, (0x1E) as u16);
        self.w16(tm + 46, (0xFFFC) as u16);
        self.w16(tm + 48, (0x1F) as u16);
        self.w16(tm + 50, (0x20) as u16);
        let _ = self
            .mmu
            .write_bytes(tm + 52, &[lf.get(20).copied().unwrap_or(0), lf.get(21).copied().unwrap_or(0), lf.get(22).copied().unwrap_or(0), 0x27, 0]);
        true
    }
}
