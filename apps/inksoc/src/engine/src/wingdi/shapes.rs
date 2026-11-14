// Lines, rectangles, ellipses, polygons and fills.

use super::*;

impl Engine {

    pub(super) fn shape_rect(&mut self, hdc: u64, r: Rect, round: bool) -> bool {
        let Some(v) = self.view(hdc) else { return false };
        let r = self.lpr(v.attr, r).off(v.ox, v.oy);
        let brush = self.dc(hdc).map_or(0, |d| d.brush);
        let be = self.brush_eval(brush, v.attr, v.mono, v.ox, v.oy);
        let pen = self.pen_eval(hdc, v.attr);
        let r2 = self.rop_mode(v.attr);
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let pw = pen.map_or(0, |p| p.1);
        let inner = Rect::new(r.l + pw, r.t + pw, r.r - pw, r.b - pw);
        let put = |x: i32, y: i32, c: u32, px: &mut Vec<u32>| { if clip.has(x, y) { let i = (y * sw + x) as usize; px[i] = rop2(r2, c, px[i]); } };
        let fill = if pen.is_none() { r } else { inner };
        for y in fill.t.max(clip.t)..fill.b.min(clip.b) {
            for x in fill.l.max(clip.l)..fill.r.min(clip.r) { if let Some(c) = be_at(&be, x, y) { put(x, y, c, &mut px); } }
        }
        if let Some((c, w, _)) = pen {
            for y in r.t..r.b {
                for x in r.l..r.r {
                    let edge = x < r.l + w || x >= r.r - w || y < r.t + w || y >= r.b - w;
                    if !edge { continue; }
                    if round && ((x == r.l || x == r.r - 1) && (y == r.t || y == r.b - 1)) { continue; }
                    put(x, y, c, &mut px);
                }
            }
        }
        self.give(v.tgt, px, true);
        true
    }

    pub(super) fn ellipse(&mut self, hdc: u64, r: Rect) -> bool {
        let Some(v) = self.view(hdc) else { return false };
        let r = self.lpr(v.attr, r).off(v.ox, v.oy);
        let brush = self.dc(hdc).map_or(0, |d| d.brush);
        let be = self.brush_eval(brush, v.attr, v.mono, v.ox, v.oy);
        let pen = self.pen_eval(hdc, v.attr);
        let r2 = self.rop_mode(v.attr);
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let (cx, cy) = ((r.l + r.r) as f64 / 2.0, (r.t + r.b) as f64 / 2.0);
        let (rx, ry) = (r.w() as f64 / 2.0, r.h() as f64 / 2.0);
        let span = |y: i32, rx: f64, ry: f64| -> Option<(i32, i32)> {
            if rx <= 0.0 || ry <= 0.0 { return None; }
            let yy = (y as f64 + 0.5 - cy) / ry;
            if yy.abs() >= 1.0 { return None; }
            let h = rx * (1.0 - yy * yy).sqrt();
            Some(((cx - h).round() as i32, (cx + h).round() as i32))
        };
        let pw = pen.map_or(0, |p| p.1) as f64;
        for y in r.t..r.b {
            let Some((x0, x1)) = span(y, rx, ry) else { continue };
            let inner = span(y, rx - pw, ry - pw);
            for x in x0..x1 {
                if !clip.has(x, y) { continue; }
                let i = (y * sw + x) as usize;
                let on_edge = pen.is_some() && inner.map_or(true, |(a, b)| x < a || x >= b);
                let c = if on_edge { pen.map(|p| p.0) } else { be_at(&be, x, y) };
                if let Some(c) = c { px[i] = rop2(r2, c, px[i]); }
            }
        }
        self.give(v.tgt, px, true);
        true
    }

    /// Lines through device points (already mapped); `close` joins the last to the first.
    pub(super) fn polyline_dev(&mut self, v: View, pts: &[(i32, i32)], pen: (u32, i32, u32), r2: u32, last: bool) {
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let (c, w, style) = pen;
        let mut n = 0u32;
        let mut plot = |x: i32, y: i32, px: &mut Vec<u32>| {
            n += 1;
            if style != 0 && style <= 4 && (n / 2) % 2 == 1 { return; }
            let o = w / 2;
            for yy in y - o..y - o + w { for xx in x - o..x - o + w { if clip.has(xx, yy) { let i = (yy * sw + xx) as usize; px[i] = rop2(r2, c, px[i]); } } }
        };
        for k in 1..pts.len() {
            let (mut x0, mut y0) = pts[k - 1];
            let (x1, y1) = pts[k];
            let (dx, dy) = ((x1 - x0).abs(), -(y1 - y0).abs());
            let (sx, sy) = (if x0 < x1 { 1 } else { -1 }, if y0 < y1 { 1 } else { -1 });
            let mut err = dx + dy;
            while x0 != x1 || y0 != y1 {
                plot(x0, y0, &mut px);
                let e2 = 2 * err;
                if e2 >= dy { err += dy; x0 += sx; }
                if e2 <= dx { err += dx; y0 += sy; }
            }
        }
        if last { if let Some(&(x, y)) = pts.last() { plot(x, y, &mut px); } }
        self.give(v.tgt, px, true);
    }

    pub(super) fn polygon_dev(&mut self, v: View, polys: &[Vec<(i32, i32)>], be: &Be, r2: u32, winding: bool) {
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let (mut t, mut b) = (i32::MAX, i32::MIN);
        for p in polys { for &(_, y) in p { t = t.min(y); b = b.max(y); } }
        for y in t.max(clip.t)..b.min(clip.b) {
            let fy = y as f64 + 0.5;
            let mut xs: Vec<(f64, i32)> = vec![];
            for p in polys {
                for k in 0..p.len() {
                    let (a, c) = (p[k], p[(k + 1) % p.len()]);
                    if (a.1 as f64 <= fy) != (c.1 as f64 <= fy) {
                        let x = a.0 as f64 + (fy - a.1 as f64) * (c.0 - a.0) as f64 / (c.1 - a.1) as f64;
                        xs.push((x, if c.1 > a.1 { 1 } else { -1 }));
                    }
                }
            }
            xs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            let mut wn = 0;
            for k in 0..xs.len() {
                let inside = if winding { wn += xs[k].1; wn != 0 } else { k % 2 == 0 };
                if !inside || k + 1 >= xs.len() { continue; }
                let (x0, x1) = ((xs[k].0 - 0.5).ceil() as i32, (xs[k + 1].0 - 0.5).ceil() as i32);
                for x in x0.max(clip.l)..x1.min(clip.r) {
                    if let Some(c) = be_at(be, x, y) { let i = (y * sw + x) as usize; px[i] = rop2(r2, c, px[i]); }
                }
            }
        }
        self.give(v.tgt, px, true);
    }

    pub(super) fn poly_poly_draw(&mut self, hdc: u64, pts: u64, counts: u64, n: u32, func: u32) -> u64 {
        if func == 6 {
            // PolyPolygonRgn: the bounding box
            let mut r = Rect::default();
            let mut k = 0u64;
            for i in 0..n as u64 { let c = self.r32(counts + 4 * i) as u64; for j in 0..c { let (x, y) = (self.r32(pts + 8 * (k + j)) as i32, self.r32(pts + 8 * (k + j) + 4) as i32); r = r.union(&Rect::new(x, y, x + 1, y + 1)); } k += c; }
            return self.gdi_new(E_RGN, Obj::Rgn(r));
        }
        let Some(v) = self.view(hdc) else { return 0 };
        let attr = v.attr;
        let mut polys = vec![];
        let mut k = 0u64;
        let cur = (self.r32(attr + 28) as i32, self.r32(attr + 32) as i32);
        for i in 0..n as u64 {
            let c = self.r32(counts + 4 * i) as u64;
            let mut p = vec![];
            if func == 4 || func == 5 { let (x, y) = self.lp(attr, cur.0, cur.1); p.push((x + v.ox, y + v.oy)); }
            for j in 0..c {
                let (x, y) = (self.r32(pts + 8 * (k + j)) as i32, self.r32(pts + 8 * (k + j) + 4) as i32);
                let (x, y) = self.lp(attr, x, y);
                p.push((x + v.ox, y + v.oy));
            }
            k += c;
            polys.push(p);
        }
        if (func == 4 || func == 5) && k > 0 {
            let (x, y) = (self.r32(pts + 8 * (k - 1)), self.r32(pts + 8 * (k - 1) + 4));
            self.w32(attr + 28, x); self.w32(attr + 32, y);
        }
        if func == 3 || func == 4 {
            // Béziers: flatten
            for p in polys.iter_mut() {
                let mut out = vec![p[0]];
                let mut i = 1;
                while i + 2 < p.len() {
                    let (a, b, c, d) = (p[i - 1], p[i], p[i + 1], p[i + 2]);
                    for s in 1..=16 {
                        let t = s as f64 / 16.0; let u = 1.0 - t;
                        let f = |a: i32, b: i32, c: i32, d: i32| (u * u * u * a as f64 + 3.0 * u * u * t * b as f64 + 3.0 * u * t * t * c as f64 + t * t * t * d as f64).round() as i32;
                        out.push((f(a.0, b.0, c.0, d.0), f(a.1, b.1, c.1, d.1)));
                    }
                    i += 3;
                }
                *p = out;
            }
        }
        let r2 = self.rop_mode(attr);
        if func == 1 {
            let brush = self.dc(hdc).map_or(0, |d| d.brush);
            let be = self.brush_eval(brush, attr, v.mono, v.ox, v.oy);
            let winding = (self.r16(attr + 52) as u32) == 2;
            self.polygon_dev(v, &polys, &be, r2, winding);
        }
        if let Some(pen) = self.pen_eval(hdc, attr) {
            for mut p in polys { if func == 1 && !p.is_empty() { p.push(p[0]); } self.polyline_dev(v, &p, pen, r2, false); }
        }
        1
    }
}
