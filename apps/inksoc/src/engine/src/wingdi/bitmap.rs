// Bitmaps and DIBs: creation, bit transfers (BitBlt/StretchBlt) and pixel formats.

use super::*;

impl Engine {

    pub(super) fn new_bmp(&mut self, w: i32, h: i32, bpp: u16) -> u64 {
        let w = w.clamp(1, 16384); let h = h.clamp(1, 16384);
        let fill = if bpp == 1 { 0 } else { 0 };
        self.gdi_new(E_BMP, Obj::Bmp(Bmp { w, h, bpp, px: vec![fill; (w * h) as usize], dib: 0, stride: 0, pal: vec![], topdown: true, masks: [0xFF0000, 0xFF00, 0xFF], comp: 0 }))
    }

    pub(super) fn dib_fmt(&mut self, bmi: u64, coloruse: u32) -> Fmt {
        let size = self.r32(bmi);
        let core = size == 12;
        let (w, h, bpp, comp, used) = if core { ((self.r16(bmi + 4) as u32) as i32, (self.r16(bmi + 6) as u32) as i16 as i32, (self.r16(bmi + 10) as u32) as u16, 0, 0) } else { (self.r32(bmi + 4) as i32, self.r32(bmi + 8) as i32, (self.r16(bmi + 14) as u32) as u16, self.r32(bmi + 16), self.r32(bmi + 32)) };
        let mut masks = match bpp { 16 => [0x7C00, 0x3E0, 0x1F], _ => [0xFF0000, 0xFF00, 0xFF] };
        let mut ct = bmi + size as u64;
        if comp == 3 || comp == 6 {
            if size <= 40 { masks = [self.r32(ct), self.r32(ct + 4), self.r32(ct + 8)]; ct += 12; } else { masks = [self.r32(bmi + 40), self.r32(bmi + 44), self.r32(bmi + 48)]; }
        }
        let n = if bpp <= 8 { if used != 0 { used.min(1 << bpp) } else { 1 << bpp } } else { 0 };
        let dp = default_pal();
        let pal: Vec<u32> = (0..n as u64).map(|i| {
            if coloruse == 1 { dp[(self.r16(ct + 2 * i) as u32) as usize % 20] }
            else if core { let b = self.bytes(ct + 3 * i, 3); (b[2] as u32) << 16 | (b[1] as u32) << 8 | b[0] as u32 }
            else { self.r32(ct + 4 * i) & 0xFFFFFF }
        }).collect();
        let hdr = (ct - bmi) as u32 + if coloruse == 1 { 2 * n } else if core { 3 * n } else { 4 * n };
        Fmt { w, h, bpp, masks, pal, comp, hdr }
    }

    /// Reads DIB bits: pixels top-down, width, height.
    pub(super) fn read_dib(&mut self, bits: u64, f: &Fmt, start: u32, lines: u32) -> (Vec<u32>, i32, i32) {
        let (w, h) = (f.w.abs(), f.h.abs());
        let td = f.h < 0;
        if f.comp == 1 || f.comp == 2 || bits == 0 { return (vec![0; (w * h) as usize], w, h); }
        let lines = lines.min(h as u32 - start.min(h as u32)) as i32;
        let raw = self.bytes(bits, f.stride() * lines as usize);
        let part = decode(&raw, f, lines, td);
        if lines == h { return (part, w, h); }
        let mut full = vec![0u32; (w * h) as usize];
        for r in 0..lines {
            // bottom-up: scan `start + k` from the bottom
            let dst = if td { start as i32 + r } else { h - 1 - (start as i32 + (lines - 1 - r)) };
            if dst < 0 || dst >= h { continue; }
            full[(dst * w) as usize..((dst + 1) * w) as usize].copy_from_slice(&part[(r * w) as usize..((r + 1) * w) as usize]);
        }
        (full, w, h)
    }

    /// Core of every blit: copies (scaling) from a pixel buffer into a view.
    pub(super) fn blit_px(&mut self, dst: u64, d: Rect, flip: (bool, bool), src: Option<(&[u32], i32, i32, bool, u32)>, s: Rect, rop: u32, mode: u32, arg: u32, mask: Option<(&[u32], i32, i32, i32, i32)>) -> bool {
        let Some(v) = self.view(dst) else { return false };
        let attr = v.attr;
        let op = (rop >> 16) as u8;
        let back = (rop >> 24) as u8;
        let uses_p = ((op >> 4) ^ op) & 0x0F != 0 || (mask.is_some() && ((back >> 4) ^ back) & 0x0F != 0);
        let brush = self.dc(dst).map_or(0, |d| d.brush);
        let be = if uses_p { self.brush_eval(brush, attr, v.mono, v.ox, v.oy) } else { Be::None };
        // a pattern-only blit with the null brush (NULL_BRUSH, a transparent control) draws nothing
        if uses_p && src.is_none() && mask.is_none() && matches!(be, Be::None) { return true; }
        let (dfg, dbg) = (rgb(self.r32(attr + 24)), rgb(self.r32(attr + 12)));
        let d = d.off(v.ox, v.oy);
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh)).inter(&d);
        if !clip.empty() && d.w() > 0 && d.h() > 0 {
            for y in clip.t..clip.b {
                let fy = if flip.1 { d.b - 1 - y } else { y - d.t };
                let sy = s.t + (fy as i64 * s.h() as i64 / d.h() as i64) as i32;
                for x in clip.l..clip.r {
                    let fx = if flip.0 { d.r - 1 - x } else { x - d.l };
                    let sx = s.l + (fx as i64 * s.w() as i64 / d.w() as i64) as i32;
                    let i = (y * sw + x) as usize;
                    let sp = match src {
                        Some((sp, w, h, smono, sbk)) => {
                            if sx < 0 || sy < 0 || sx >= w || sy >= h { if mode != 0 { continue; } 0 } else {
                                let p = sp[(sy * w + sx) as usize];
                                if smono && !v.mono { if p & 0xFFFFFF != 0 { dbg } else { dfg } }
                                else if v.mono && !smono { if p & 0xFFFFFF == sbk { 0xFFFFFF } else { 0 } }
                                else { p }
                            }
                        }
                        None => 0,
                    };
                    match mode {
                        1 => { if sp & 0xFFFFFF == arg { continue; } px[i] = sp & 0xFFFFFF; }
                        2 => {
                            let ca = (arg >> 16) & 0xFF;
                            let dp = px[i];
                            let sa = if arg >> 24 & 1 != 0 { (sp >> 24) * ca / 255 } else { ca };
                            let mut out = 0u32;
                            for sh_ in [0u32, 8, 16] {
                                let (sc, dc) = ((sp >> sh_) & 0xFF, (dp >> sh_) & 0xFF);
                                let c = if arg >> 24 & 1 != 0 { (sc * ca / 255 + dc * (255 - sa) / 255).min(255) } else { (sc * ca + dc * (255 - ca)) / 255 };
                                out |= c << sh_;
                            }
                            px[i] = out | (dp & 0xFF00_0000);
                        }
                        _ => {
                            let p = if uses_p { be_at(&be, x, y).unwrap_or(0) } else { 0 };
                            let o = match mask {
                                Some((m, mw, mh, mx, my)) => {
                                    let (u, w) = (mx + (x - d.l), my + (y - d.t));
                                    let bit = u >= 0 && w >= 0 && u < mw && w < mh && m[(w * mw + u) as usize] & 0xFFFFFF != 0;
                                    if bit { op } else { back }
                                }
                                None => op,
                            };
                            px[i] = rop3(o, p, sp, px[i]);
                        }
                    }
                }
            }
        }
        self.give(v.tgt, px, !clip.empty());
        true
    }

    /// BitBlt / StretchBlt / TransparentBlt / AlphaBlend / MaskBlt between DCs.
    pub(super) fn blit(&mut self, dst: u64, d: (i32, i32, i32, i32), src: u64, s: (i32, i32, i32, i32), rop: u32, mode: u32, arg: u32, mask: u64, mpos: (i32, i32)) -> bool {
        let Some(dv) = self.view(dst) else { return false };
        let (x0, y0) = self.lp(dv.attr, d.0, d.1);
        let (x1, y1) = self.lp(dv.attr, d.0 + d.2, d.1 + d.3);
        let dr = Rect::new(x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1));
        let op = (rop >> 16) as u8;
        let uses_s = ((op >> 2) ^ op) & 0x33 != 0 || mode != 0;
        if !uses_s || src == 0 {
            return self.blit_px(dst, dr, (false, false), None, Rect::new(0, 0, 1, 1), rop, 0, 0, None);
        }
        let Some(sv) = self.view(src) else { return false };
        let (a0, b0) = self.lp(sv.attr, s.0, s.1);
        let (a1, b1) = self.lp(sv.attr, s.0 + s.2, s.1 + s.3);
        let sr = Rect::new(a0.min(a1), b0.min(b1), a0.max(a1), b0.max(b1)).off(sv.ox, sv.oy);
        let flip = ((x1 < x0) != (a1 < a0), (y1 < y0) != (b1 < b0));
        let sbk = rgb(self.r32(sv.attr + 12));
        let mpx = if mask != 0 { let t = Tgt::Bmp(idx(mask)); let (m, w, h) = self.take(t); Some((t, m, w, h)) } else { None };
        let r = if sv.tgt == dv.tgt {
            let (p, w, h) = self.take(sv.tgt);
            let copy = p.clone();
            self.give(sv.tgt, p, false);
            self.blit_px(dst, dr, flip, Some((&copy, w, h, sv.mono, sbk)), sr, rop, mode, arg, mpx.as_ref().map(|(_, m, w, h)| (m.as_slice(), *w, *h, mpos.0, mpos.1)))
        } else {
            let (p, w, h) = self.take(sv.tgt);
            let r = self.blit_px(dst, dr, flip, Some((&p, w, h, sv.mono, sbk)), sr, rop, mode, arg, mpx.as_ref().map(|(_, m, w, h)| (m.as_slice(), *w, *h, mpos.0, mpos.1)));
            self.give(sv.tgt, p, false);
            r
        };
        if let Some((t, m, _, _)) = mpx { self.give(t, m, false); }
        r
    }

    pub(super) fn stretch_dib(&mut self, hdc: u64, d: (i32, i32, i32, i32), s: (i32, i32, i32, i32), bits: u64, bmi: u64, coloruse: u32, rop: u32, start: u32, lines: u32) -> u64 {
        let f = self.dib_fmt(bmi, coloruse);
        let (px, w, h) = self.read_dib(bits, &f, start, lines);
        let Some(v) = self.view(hdc) else { return 0 };
        let (x0, y0) = self.lp(v.attr, d.0, d.1);
        let (x1, y1) = self.lp(v.attr, d.0 + d.2, d.1 + d.3);
        let dr = Rect::new(x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1));
        // source y counts from the bottom for bottom-up DIBs
        let st = if f.h < 0 { s.1 } else { h - s.1 - s.3 };
        let sr = Rect::new(s.0.min(s.0 + s.2), st.min(st + s.3), s.0.max(s.0 + s.2), st.max(st + s.3));
        let flip = (x1 < x0 || s.2 < 0, y1 < y0);
        self.blit_px(hdc, dr, flip, Some((&px, w, h, false, 0)), sr, rop, 0, 0, None);
        h as u64
    }

    pub(super) fn get_dibits(&mut self, hbmp: u64, start: u32, lines: u32, bits: u64, info: u64, coloruse: u32) -> u64 {
        let t = Tgt::Bmp(idx(hbmp));
        let (bw, bh, bbpp, bpal, isdib) = match self.s.gdi.objs.get(&idx(hbmp)) { Some(Obj::Bmp(b)) => (b.w, b.h, b.bpp, b.pal.clone(), b.dib != 0), _ => return 0 };
        let size = self.r32(info);
        if size < 12 { return 0; }
        let mut bpp = (self.r16(info + 14) as u32) as u16;
        if bpp == 0 {
            // fill the header only
            let bpp = if bbpp <= 8 && !isdib { bbpp } else { bbpp.max(1) };
            self.w32(info + 4, bw as u32); self.w32(info + 8, bh as u32); self.w16(info + 12, (1) as u16); self.w16(info + 14, (bpp as u32) as u16);
            self.w32(info + 16, if bpp == 16 || bpp == 32 { 3 } else { 0 });
            self.w32(info + 20, (((bw as usize * bpp as usize + 31) / 32) * 4 * bh as usize) as u32);
            if bpp == 16 || bpp == 32 {
                let m = if bpp == 16 { [0xF800, 0x7E0, 0x1F] } else { [0xFF0000, 0xFF00, 0xFF] };
                let ct = info + size as u64;
                for (k, v) in m.iter().enumerate() { self.w32(ct + 4 * k as u64, *v); }
            }
            return 1;
        }
        if bpp != 1 && bpp != 4 && bpp != 8 && bpp != 16 && bpp != 24 && bpp != 32 { bpp = 32; }
        let ih = self.r32(info + 8) as i32;
        let comp = self.r32(info + 16);
        let masks = if comp == 3 { let ct = info + size as u64; [self.r32(ct), self.r32(ct + 4), self.r32(ct + 8)] } else if bpp == 16 { [0x7C00, 0x3E0, 0x1F] } else { [0xFF0000, 0xFF00, 0xFF] };
        let pal = if bpp <= 8 { if !bpal.is_empty() && bpal.len() == 1 << bpp { bpal } else { std_palette(bpp) } } else { vec![] };
        // color table
        if bpp <= 8 && coloruse == 0 {
            let ct = info + size as u64;
            for (k, c) in pal.iter().enumerate() { self.w32(ct + 4 * k as u64, *c); }
            if size >= 36 { self.w32(info + 32, 0); }
        }
        let height = ih.abs().min(bh).max(0);
        let iw = self.r32(info + 4) as i32;
        self.w32(info + 20, (((bw.min(iw).max(0) as usize * bpp as usize + 31) / 32) * 4 * height as usize) as u32);
        if bits == 0 { return bh as u64; }
        let w = (self.r32(info + 4) as i32).min(bw).max(0);
        let f = Fmt { w, h: height, bpp, masks, pal, comp: 0, hdr: 0 };
        let (px, sw, _) = self.take(t);
        let topdown = ih < 0;
        let lines = lines.min((height as u32).saturating_sub(start));
        // the requested scan lines (bottom-up numbering when the DIB is bottom-up)
        let mut part = vec![0u32; (w * lines as i32) as usize];
        for r in 0..lines as i32 {
            let src_row = if topdown { start as i32 + r } else { bh - 1 - (start as i32 + (lines as i32 - 1 - r)) };
            if src_row < 0 || src_row >= bh { continue; }
            for x in 0..w { part[(r * w + x) as usize] = px.get((src_row * sw + x) as usize).copied().unwrap_or(0); }
        }
        self.give(t, px, false);
        let raw = encode(&part, &f, lines as i32, topdown);
        let _ = self.mmu.write_bytes(bits, &raw);
        lines as u64
    }

    pub(super) fn create_dib_section(&mut self, bmi: u64, usage: u32, out: u64) -> u64 {
        let f = self.dib_fmt(bmi, usage);
        if f.w == 0 || f.h == 0 || f.bpp == 0 { return 0; }
        let size = f.stride() * f.h.unsigned_abs() as usize;
        let Some(bits) = self.alloc(size as u64) else { return 0 };
        self.s64(out, bits);
        let stride = f.stride();
        let pal = if f.pal.is_empty() && f.bpp <= 8 { std_palette(f.bpp) } else { f.pal };
        self.gdi_new(E_BMP, Obj::Bmp(Bmp { w: f.w.abs(), h: f.h.abs(), bpp: f.bpp, px: vec![], dib: bits, stride, pal, topdown: f.h < 0, masks: f.masks, comp: f.comp }))
    }
}
