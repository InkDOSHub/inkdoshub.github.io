// The NtGdi* system calls Wine's gdi32 makes, answered from the pieces in this folder.

use super::*;

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let ar: [u64; 14] = std::array::from_fn(|i| e.arg(i));
    e.gdi_init();
    let a0 = ar[0];
    let r: u64 = match name {
        "NtGdiInit" | "NtGdiFlush" => 1,
        "NtGdiCreateCompatibleDC" => e.dc_new(0, false, true),
        "NtGdiOpenDCW" => e.dc_new(0, false, false),
        "NtGdiCreateMetafileDC" => e.dc_new(0, false, true),
        "NtGdiDeleteObjectApp" => {
            let i = idx(a0);
            if e.is_stock(a0) || e.s.gdi.sysbrush.iter().chain(e.s.gdi.syspen.iter()).any(|&h| idx(h) == i) {
                return Some(1);
            }
            match e.s.gdi.objs.get(&i) {
                Some(Obj::Dc(_)) => e.dc_delete(a0),
                Some(_) => e.gdi_free(i),
                None => return Some(0),
            }
            1
        }
        "NtGdiCreateClientObj" => e.gdi_new(((a0 >> 16) & 0x7F) as u32, Obj::Other),
        "NtGdiDeleteClientObj" => {
            e.gdi_free(idx(a0));
            1
        }
        "NtGdiGetDCObject" => {
            let t = ar[1] as u32;
            match e.dc(a0) {
                Some(d) => match t {
                    1 | 0x30_0000 | 0x50_0000 => d.pen,
                    2 | 0x10_0000 => d.brush,
                    5 | 0x8_0000 => d.pal,
                    6 | 0xa_0000 => d.font,
                    7 | 0x5_0000 | 0x9_0000 => d.bmp,
                    _ => 0,
                },
                None => 0,
            }
        }
        "NtGdiSelectBitmap" => {
            let h = ar[1];
            e.select(a0, h, 7)
        }
        "NtGdiSelectBrush" => {
            let h = ar[1];
            e.select(a0, h, 2)
        }
        "NtGdiSelectPen" => {
            let h = ar[1];
            e.select(a0, h, 1)
        }
        "NtGdiSelectFont" => {
            let h = ar[1];
            e.select(a0, h, 6)
        }
        "NtUserSelectPalette" | "NtGdiSelectPalette" => {
            let h = ar[1];
            let r = e.select(a0, h, 5);
            if r == 0 {
                e.stock(15)
            } else {
                r
            }
        }
        "NtGdiGetAndSetDCDword" => {
            let (m, v, out) = (ar[1] as u32, ar[2] as u32, ar[3]);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            let (off, w16) = match m {
                8 => (60, false),
                100 => (12, false),
                101 => (50, true),
                102 => (24, false),
                103 => (16, false),
                104 => (20, false),
                105 => (36, false),
                106 => (54, true),
                107 => (48, true),
                _ => return Some(0),
            };
            let old = if w16 { e.r16(attr + off) as u32 } else { e.r32(attr + off) };
            if w16 {
                e.w16(attr + off, (v) as u16);
            } else {
                e.w32(attr + off, v);
            }
            if m == 8 && v == 1 {
                for o in [108u64, 112, 124, 128] {
                    e.w32(attr + o, 1);
                }
            }
            if m == 8 && v == 8 {
                e.w32(attr + 108, 1);
                e.w32(attr + 112, 1);
                e.w32(attr + 124, 1);
                e.w32(attr + 128, 1);
            }
            e.w32(out, old);
            1
        }
        "NtGdiGetDCDword" => {
            let (m, out) = (ar[1] as u32, ar[2]);
            let Some((attr, mem)) = e.dc(a0).map(|d| (d.attr, d.mem)) else { return Some(0) };
            let v = match m {
                0 => e.r32(attr + 40),
                1 => e.r32(attr + 12),
                2 => e.r16(attr + 50) as u32,
                3 => e.r32(attr + 16),
                4 => e.r32(attr + 20),
                5 => e.r32(attr + 36),
                6 => e.r32(attr + 44),
                7 => e.r16(attr + 52) as u32,
                8 => e.r16(attr + 54) as u32,
                9 => e.r32(attr + 24),
                10 => mem as u32,
                _ => 0,
            };
            e.w32(out, v);
            1
        }
        "NtGdiGetDCPoint" => {
            let (m, out) = (ar[1] as u32, ar[2]);
            let Some((attr, hwnd, whole)) = e.dc(a0).map(|d| (d.attr, d.hwnd, d.whole)) else { return Some(0) };
            let (x, y) = match m {
                0 => (e.r32(attr + 92), e.r32(attr + 96)),
                1 => (e.r32(attr + 28), e.r32(attr + 32)),
                _ => e.wnd(hwnd).map_or((0, 0), |w| {
                    let r = if whole { w.wrect } else { w.crect };
                    (r.l as u32, r.t as u32)
                }),
            };
            e.w32(out, x);
            e.w32(out + 4, y);
            1
        }
        "NtGdiSetBrushOrg" => {
            let (x, y, prev) = (ar[1] as u32, ar[2] as u32, ar[3]);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            if prev != 0 {
                let (px, py) = (e.r32(attr + 92), e.r32(attr + 96));
                e.w32(prev, px);
                e.w32(prev + 4, py);
            }
            e.w32(attr + 92, x);
            e.w32(attr + 96, y);
            1
        }
        "NtGdiMoveTo" => {
            let (x, y, pt) = (ar[1] as u32, ar[2] as u32, ar[3]);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            if pt != 0 {
                let (px, py) = (e.r32(attr + 28), e.r32(attr + 32));
                e.w32(pt, px);
                e.w32(pt + 4, py);
            }
            e.w32(attr + 28, x);
            e.w32(attr + 32, y);
            1
        }
        "NtGdiLineTo" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let Some(v) = e.view(a0) else { return Some(0) };
            let (cx, cy) = (e.r32(v.attr + 28) as i32, e.r32(v.attr + 32) as i32);
            e.w32(v.attr + 28, x as u32);
            e.w32(v.attr + 32, y as u32);
            if let Some(pen) = e.pen_eval(a0, v.attr) {
                let p0 = e.lp(v.attr, cx, cy);
                let p1 = e.lp(v.attr, x, y);
                let r2 = e.rop_mode(v.attr);
                e.polyline_dev(v, &[(p0.0 + v.ox, p0.1 + v.oy), (p1.0 + v.ox, p1.1 + v.oy)], pen, r2, false);
            }
            1
        }
        "NtGdiPolyPolyDraw" => {
            let (p, c, n, f) = (ar[1], ar[2], ar[3] as u32, ar[4] as u32);
            e.poly_poly_draw(a0, p, c, n, f)
        }
        "NtGdiRectangle" => {
            let r = Rect::new(ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32);
            e.shape_rect(a0, r, false) as u64
        }
        "NtGdiRoundRect" => {
            let r = Rect::new(ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32);
            e.shape_rect(a0, r, true) as u64
        }
        "NtGdiEllipse" => {
            let r = Rect::new(ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32);
            e.ellipse(a0, r) as u64
        }
        "NtGdiArcInternal" | "NtGdiAngleArc" | "NtGdiPolyDraw" | "NtGdiExtFloodFill" => 1,
        "NtGdiPatBlt" => {
            let (l, t, w, h, rop) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5] as u32);
            e.blit(a0, (l, t, w, h), 0, (0, 0, 0, 0), rop, 0, 0, 0, (0, 0)) as u64
        }
        "NtGdiBitBlt" => {
            let (x, y, w, h, src, xs, ys, rop) =
                ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5], (ar[6] as i32), (ar[7] as i32), ar[8] as u32);
            e.blit(a0, (x, y, w, h), src, (xs, ys, w, h), rop, 0, 0, 0, (0, 0)) as u64
        }
        "NtGdiStretchBlt" => {
            let (x, y, w, h, src, xs, ys, ws, hs, rop) = (
                (ar[1] as i32),
                (ar[2] as i32),
                (ar[3] as i32),
                (ar[4] as i32),
                ar[5],
                (ar[6] as i32),
                (ar[7] as i32),
                (ar[8] as i32),
                (ar[9] as i32),
                ar[10] as u32,
            );
            e.blit(a0, (x, y, w, h), src, (xs, ys, ws, hs), rop, 0, 0, 0, (0, 0)) as u64
        }
        "NtGdiMaskBlt" => {
            let (x, y, w, h, src, xs, ys, mask, xm, ym, rop) = (
                (ar[1] as i32),
                (ar[2] as i32),
                (ar[3] as i32),
                (ar[4] as i32),
                ar[5],
                (ar[6] as i32),
                (ar[7] as i32),
                ar[8],
                (ar[9] as i32),
                (ar[10] as i32),
                ar[11] as u32,
            );
            let rop = if mask == 0 { rop & 0xFFFFFF } else { rop };
            e.blit(a0, (x, y, w, h), src, (xs, ys, w, h), rop, 0, 0, mask, (xm, ym)) as u64
        }
        "NtGdiTransparentBlt" => {
            let (x, y, w, h, src, xs, ys, ws, hs, col) = (
                (ar[1] as i32),
                (ar[2] as i32),
                (ar[3] as i32),
                (ar[4] as i32),
                ar[5],
                (ar[6] as i32),
                (ar[7] as i32),
                (ar[8] as i32),
                (ar[9] as i32),
                ar[10] as u32,
            );
            e.blit(a0, (x, y, w, h), src, (xs, ys, ws, hs), 0xCC0020, 1, rgb(col), 0, (0, 0)) as u64
        }
        "NtGdiAlphaBlend" => {
            let (x, y, w, h, src, xs, ys, ws, hs, bf) = (
                (ar[1] as i32),
                (ar[2] as i32),
                (ar[3] as i32),
                (ar[4] as i32),
                ar[5],
                (ar[6] as i32),
                (ar[7] as i32),
                (ar[8] as i32),
                (ar[9] as i32),
                ar[10] as u32,
            );
            e.blit(a0, (x, y, w, h), src, (xs, ys, ws, hs), 0xCC0020, 2, bf, 0, (0, 0)) as u64
        }
        "NtGdiPlgBlt" => 0,
        "NtGdiGradientFill" => {
            let (vert, nv, mesh, nm, mode) = (ar[1], ar[2] as u64, ar[3], ar[4] as u64, ar[5] as u32);
            let Some(v) = e.view(a0) else { return Some(0) };
            let vx: Vec<(i32, i32, u32, u32, u32)> = (0..nv)
                .map(|i| {
                    let b = vert + 16 * i;
                    (e.r32(b) as i32, e.r32(b + 4) as i32, (e.r16(b + 8) as u32) >> 8, (e.r16(b + 10) as u32) >> 8, (e.r16(b + 12) as u32) >> 8)
                })
                .collect();
            for m in 0..nm {
                if mode < 2 {
                    let (i0, i1) = (e.r32(mesh + 8 * m) as usize, e.r32(mesh + 8 * m + 4) as usize);
                    let (Some(&p0), Some(&p1)) = (vx.get(i0), vx.get(i1)) else { continue };
                    let r = e.lpr(v.attr, Rect::new(p0.0, p0.1, p1.0, p1.1)).off(v.ox, v.oy);
                    let n = if mode == 0 { r.w() } else { r.h() };
                    for k in 0..n.max(0) {
                        let t = if n > 1 { k as u32 * 255 / (n - 1) as u32 } else { 0 };
                        let mix = |a: u32, b: u32| (a * (255 - t) + b * t) / 255;
                        let c = mix(p0.2, p1.2) << 16 | mix(p0.3, p1.3) << 8 | mix(p0.4, p1.4);
                        let band = if mode == 0 { Rect::new(r.l + k, r.t, r.l + k + 1, r.b) } else { Rect::new(r.l, r.t + k, r.r, r.t + k + 1) };
                        e.fill_with(v, band, &Be::Solid(c), 0xF0);
                    }
                } else {
                    let ids: Vec<usize> = (0..3).map(|k| e.r32(mesh + 12 * m + 4 * k) as usize).collect();
                    let pts: Vec<_> = ids.iter().filter_map(|&i| vx.get(i).copied()).collect();
                    if pts.len() < 3 {
                        continue;
                    }
                    let c = ((pts[0].2 + pts[1].2 + pts[2].2) / 3) << 16
                        | ((pts[0].3 + pts[1].3 + pts[2].3) / 3) << 8
                        | (pts[0].4 + pts[1].4 + pts[2].4) / 3;
                    let poly: Vec<(i32, i32)> = pts
                        .iter()
                        .map(|p| {
                            let (x, y) = e.lp(v.attr, p.0, p.1);
                            (x + v.ox, y + v.oy)
                        })
                        .collect();
                    e.polygon_dev(v, &[poly], &Be::Solid(c), 13, false);
                }
            }
            1
        }
        "NtGdiSetPixel" => {
            let (x, y, c) = ((ar[1] as i32), (ar[2] as i32), ar[3] as u32);
            let Some(v) = e.view(a0) else { return Some(u32::MAX as u64) };
            let (x, y) = e.lp(v.attr, x, y);
            e.fill_with(v, Rect::new(x + v.ox, y + v.oy, x + v.ox + 1, y + v.oy + 1), &Be::Solid(rgb(c)), 0xF0);
            c as u64
        }
        "NtGdiGetPixel" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let Some(v) = e.view(a0) else { return Some(u32::MAX as u64) };
            let (x, y) = e.lp(v.attr, x, y);
            let (x, y) = (x + v.ox, y + v.oy);
            let (px, w, h) = e.take(v.tgt);
            let r = if x >= 0 && y >= 0 && x < w && y < h { colorref(px[(y * w + x) as usize] & 0xFFFFFF) as u64 } else { u32::MAX as u64 };
            e.give(v.tgt, px, false);
            r
        }
        "NtGdiExtTextOutW" => {
            let (x, y, fl, rc, s, n, dx) = ((ar[1] as i32), (ar[2] as i32), ar[3] as u32, ar[4], ar[5], ar[6] as u32, ar[7]);
            e.ext_text_out(a0, x, y, fl, rc, s, n, dx) as u64
        }
        "NtGdiGetTextExtentExW" => {
            let (s, n, max, nfit, dxs, size) = (ar[1], ar[2] as u64, (ar[3] as i32), ar[4], ar[5], ar[6]);
            let (fi, _) = e.dc_font(a0);
            let attr = e.dc(a0).map_or(0, |d| d.attr);
            let extra = if attr != 0 { e.r32(attr + 64) as i32 } else { 0 };
            let mut tot = 0;
            let mut fit = 0;
            for i in 0..n {
                let c = e.r16(s + 2 * i) as u32;
                tot += char_adv(fi, c) + extra;
                if tot <= max || max < 0 {
                    fit = i + 1;
                }
                if dxs != 0 {
                    e.w32(dxs + 4 * i, tot as u32);
                }
            }
            if nfit != 0 {
                e.w32(nfit, fit as u32);
            }
            e.w32(size, tot as u32);
            e.w32(size + 4, fonts()[fi].h as u32);
            1
        }
        "NtGdiGetTextMetricsW" => {
            let tm = ar[1];
            e.text_metrics(a0, tm) as u64
        }
        "NtGdiGetCharWidthW" | "NtGdiGetCharABCWidthsW" => {
            let (first, last, chars, flags, buf) = (ar[1] as u32, ar[2] as u32, ar[3], ar[4] as u32, ar[5]);
            let (fi, _) = e.dc_font(a0);
            let abc = name == "NtGdiGetCharABCWidthsW";
            let int = if abc { flags & 1 != 0 } else { flags & 2 != 0 };
            let n = if chars != 0 { last as u64 } else { (last.saturating_sub(first) + 1) as u64 };
            for i in 0..n {
                let c = if chars != 0 { e.r16(chars + 2 * i) as u32 } else { first + i as u32 };
                let w = char_adv(fi, c);
                if abc {
                    let b = buf + 12 * i;
                    if int {
                        e.w32(b, 0);
                        e.w32(b + 4, w as u32);
                        e.w32(b + 8, 0);
                    } else {
                        e.w32(b, 0);
                        e.w32(b + 4, (w as f32).to_bits());
                        e.w32(b + 8, 0);
                    }
                } else if int {
                    e.w32(buf + 4 * i, w as u32);
                } else {
                    e.w32(buf + 4 * i, (w as f32).to_bits());
                }
            }
            1
        }
        "NtGdiGetTextFaceW" => {
            let (n, out) = (ar[1] as usize, ar[2]);
            let (_, lf) = e.dc_font(a0);
            let face: Vec<u16> = lf[28..92].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
            let face = String::from_utf16_lossy(&face);
            let face = if face.is_empty() { "Tahoma".to_string() } else { face };
            if out == 0 {
                return Some(face.encode_utf16().count() as u64 + 1);
            }
            e.put_w(out, &face, n) as u64 + 1
        }
        "NtGdiGetOutlineTextMetricsInternalW"
        | "NtGdiGetKerningPairs"
        | "NtGdiGetFontUnicodeRanges"
        | "NtGdiGetFontFileData"
        | "NtGdiGetFontFileInfo" => 0,
        "NtGdiGetFontData" | "NtGdiGetGlyphOutline" => u32::MAX as u64,
        "NtGdiGetTextCharsetInfo" => {
            let fs = ar[1];
            if fs != 0 {
                for k in 0..6 {
                    e.w32(fs + 4 * k, 0);
                }
                e.w32(fs + 16, 1);
            }
            0
        }
        "NtGdiGetRealizationInfo" => {
            let p = ar[1];
            let (fi, _) = e.dc_font(a0);
            e.w32(p + 4, 1);
            e.w32(p + 8, 1);
            e.w32(p + 12, fi as u32 + 1);
            1
        }
        "NtGdiGetGlyphIndicesW" => {
            let (s, n, out, fl) = (ar[1], ar[2] as u64, ar[3], ar[4] as u32);
            for i in 0..n {
                let c = e.r16(s + 2 * i) as u32;
                let g = if map_char(c) == c || c < 32 {
                    c
                } else if fl & 1 != 0 {
                    0xFFFF
                } else {
                    0
                };
                e.w16(out + 2 * i, (g) as u16);
            }
            n
        }
        "NtGdiEnumFonts" => {
            let cnt = ar[6];
            e.w32(cnt, 0);
            1
        }
        "NtGdiHfontCreate" => {
            let lf = e.bytes(a0, 92);
            let (h, wt) = (i32::from_le_bytes([lf[0], lf[1], lf[2], lf[3]]), i32::from_le_bytes([lf[16], lf[17], lf[18], lf[19]]));
            let fi = pick_font(h, wt);
            e.gdi_new(E_FONT, Obj::Font(Font { lf, fi }))
        }
        "NtGdiAddFontResourceW" | "NtGdiRemoveFontResourceW" | "NtGdiRemoveFontMemResourceEx" => 1,
        "NtGdiAddFontMemResourceEx" => {
            let n = ar[4];
            if n != 0 {
                e.w32(n, 1);
            }
            0x7F00_0001
        }
        "NtGdiCreateSolidBrush" => e.gdi_new(E_BRUSH, Obj::Brush(Brush::Solid(a0 as u32))),
        "NtGdiCreateHatchBrushInternal" => {
            let c = ar[1] as u32;
            e.gdi_new(E_BRUSH, Obj::Brush(Brush::Hatch(a0 as u32, c)))
        }
        "NtGdiCreatePatternBrushInternal" => {
            let t = Tgt::Bmp(idx(a0));
            let mono = matches!(e.s.gdi.objs.get(&idx(a0)), Some(Obj::Bmp(b)) if b.mono());
            let (px, w, h) = e.take(t);
            let copy = px.clone();
            e.give(t, px, false);
            if w == 0 {
                return Some(0);
            }
            e.gdi_new(E_BRUSH, Obj::Brush(Brush::Pat { w, h, px: copy, mono }))
        }
        "NtGdiCreateDIBBrush" => {
            let (data, cu) = (a0, ar[1] as u32);
            let f = e.dib_fmt(data, cu);
            let bits = data + f.hdr as u64;
            let (px, w, h) = e.read_dib(bits, &f, 0, f.h.unsigned_abs());
            e.gdi_new(E_BRUSH, Obj::Brush(Brush::Pat { w, h, px, mono: false }))
        }
        "NtGdiCreatePen" => {
            let (w, c) = (ar[1] as i32, ar[2] as u32);
            e.gdi_new(E_PEN, Obj::Pen(Pen { style: a0 as u32, width: w, color: c, dc: false, ext: false }))
        }
        "NtGdiExtCreatePen" => {
            let (w, c) = (ar[1] as i32, ar[3] as u32);
            e.gdi_new(E_EXTPEN, Obj::Pen(Pen { style: a0 as u32, width: w, color: c, dc: false, ext: true }))
        }
        "NtGdiCreateCompatibleBitmap" => {
            let (w, h) = ((ar[1] as i32), (ar[2] as i32));
            if w == 0 || h == 0 {
                return Some(e.stock(20));
            }
            let mono = e.view(a0).map_or(false, |v| v.mono);
            e.new_bmp(w, h, if mono { 1 } else { 32 })
        }
        "NtGdiCreateBitmap" => {
            let (w, h, bpp, bits) = ((ar[0] as i32), (ar[1] as i32), ar[3] as u16, ar[4]);
            let bpp = match bpp {
                1 => 1,
                0..=8 => 8,
                9..=16 => 16,
                17..=24 => 24,
                _ => 32,
            };
            let hb = e.new_bmp(w, h, bpp);
            if bits != 0 {
                e.set_bitmap_bits(hb, bits, u32::MAX);
            }
            hb
        }
        "NtGdiCreateDIBitmapInternal" => {
            let (w, h, init, bits, bmi, cu) = ((ar[1] as i32), (ar[2] as i32), ar[3] as u32, ar[4], ar[5], ar[6] as u32);
            let mono = a0 == 0 || e.view(a0).map_or(false, |v| v.mono);
            let hb = e.new_bmp(w.abs(), h.abs(), if mono { 1 } else { 32 });
            if init & 4 != 0 && bmi != 0 {
                let f = e.dib_fmt(bmi, cu);
                let (px, pw, ph) = e.read_dib(bits, &f, 0, f.h.unsigned_abs());
                if let Some(Obj::Bmp(b)) = e.s.gdi.objs.get_mut(&idx(hb)) {
                    for y in 0..b.h.min(ph) {
                        for x in 0..b.w.min(pw) {
                            b.px[(y * b.w + x) as usize] = px[(y * pw + x) as usize];
                        }
                    }
                    if mono {
                        for p in b.px.iter_mut() {
                            *p = if lum(*p & 0xFFFFFF) >= 128 { 0xFFFFFF } else { 0 };
                        }
                    }
                }
            }
            hb
        }
        "NtGdiCreateDIBSection" => {
            let (bmi, usage, out) = (ar[3], ar[4] as u32, ar[8]);
            e.create_dib_section(bmi, usage, out)
        }
        "NtGdiGetDIBitsInternal" => {
            let (hb, start, lines, bits, info, cu) = (ar[1], ar[2] as u32, ar[3] as u32, ar[4], ar[5], ar[6] as u32);
            e.get_dibits(hb, start, lines, bits, info, cu)
        }
        "NtGdiSetDIBitsToDeviceInternal" => {
            let (x, y, cx, cy, xs, ys, start, lines, bits, bmi, cu) = (
                (ar[1] as i32),
                (ar[2] as i32),
                (ar[3] as i32),
                (ar[4] as i32),
                (ar[5] as i32),
                (ar[6] as i32),
                ar[7] as u32,
                ar[8] as u32,
                ar[9],
                ar[10],
                ar[11] as u32,
            );
            e.stretch_dib(a0, (x, y, cx, cy), (xs, ys, cx, cy), bits, bmi, cu, 0xCC0020, start, lines);
            lines as u64
        }
        "NtGdiStretchDIBitsInternal" => {
            let (x, y, w, h, xs, ys, ws, hs, bits, bmi, cu, rop) = (
                (ar[1] as i32),
                (ar[2] as i32),
                (ar[3] as i32),
                (ar[4] as i32),
                (ar[5] as i32),
                (ar[6] as i32),
                (ar[7] as i32),
                (ar[8] as i32),
                ar[9],
                ar[10],
                ar[11] as u32,
                ar[12] as u32,
            );
            e.stretch_dib(a0, (x, y, w, h), (xs, ys, ws, hs), bits, bmi, cu, rop, 0, u32::MAX)
        }
        "NtGdiSetDIBitsInternal" => {
            // (hdc, hbitmap, startscan, lines, bits, info, coloruse, ...)
            let (hb, start, lines, bits, bmi, cu) = (ar[1], ar[2] as u32, ar[3] as u32, ar[4], ar[5], ar[6] as u32);
            let f = e.dib_fmt(bmi, cu);
            let (px, pw, ph) = e.read_dib(bits, &f, start, lines);
            let t = Tgt::Bmp(idx(hb));
            let (mut d, w, h) = e.take(t);
            for y in 0..h.min(ph) {
                for x in 0..w.min(pw) {
                    d[(y * w + x) as usize] = px[(y * pw + x) as usize];
                }
            }
            e.give(t, d, true);
            lines as u64
        }
        "NtGdiGetBitmapBits" => {
            let (n, out) = (ar[1] as u32, ar[2]);
            let t = Tgt::Bmp(idx(a0));
            let (bpp, mono) = match e.s.gdi.objs.get(&idx(a0)) {
                Some(Obj::Bmp(b)) => (b.bpp, b.mono()),
                _ => return Some(0),
            };
            let (px, w, h) = e.take(t);
            let f = Fmt { w, h, bpp: if mono { 1 } else { bpp }, masks: [0xFF0000, 0xFF00, 0xFF], pal: vec![0, 0xFFFFFF], comp: 0, hdr: 0 };
            let stride = ((w as usize * f.bpp as usize + 15) / 16) * 2;
            let total = stride * h as usize;
            if out == 0 {
                e.give(t, px, false);
                return Some(total as u64);
            }
            let raw = encode(&px, &f, h, true);
            e.give(t, px, false);
            let s4 = f.stride();
            let mut o = vec![0u8; total];
            for y in 0..h as usize {
                let k = stride.min(s4);
                o[y * stride..y * stride + k].copy_from_slice(&raw[y * s4..y * s4 + k]);
            }
            let k = (n as usize).min(total);
            let _ = e.mmu.write_bytes(out, &o[..k]);
            k as u64
        }
        "NtGdiSetBitmapBits" => {
            let (n, bits) = (ar[1] as u32, ar[2]);
            e.set_bitmap_bits(a0, bits, n)
        }
        "NtGdiGetBitmapDimension" => {
            let s = ar[1];
            e.w32(s, 0);
            e.w32(s + 4, 0);
            1
        }
        "NtGdiSetBitmapDimension" => 1,
        "NtGdiExtGetObjectW" => {
            let (n, buf) = (ar[1] as u32, ar[2]);
            e.get_object(a0, n, buf)
        }
        "NtGdiGetDeviceCaps" => {
            let cap = ar[1] as u32;
            let mono_mem = e.view(a0).map_or(false, |v| v.mono);
            (match cap {
                0 => 0x4000,
                2 => 1,
                4 => 320,
                6 => 240,
                8 => SCREEN_W,
                10 => SCREEN_H,
                12 => {
                    if mono_mem {
                        1
                    } else {
                        32
                    }
                }
                14 => 1,
                16 | 18 => -1,
                20 => 0,
                22 => 0,
                24 => -1,
                26 => 0,
                28 => 0xFF,
                30 => 0xFE,
                32 => 0xFF,
                34 => 0x7807,
                36 => 1,
                38 => 0x7E99,
                40 | 42 => 36,
                44 => 51,
                88 | 90 => 96,
                104 => 0,
                106 => 20,
                108 => 24,
                116 => 60,
                117 => SCREEN_H,
                118 => SCREEN_W,
                119 => 0,
                120 => 0xFF,
                121 => 0,
                _ => 0,
            }) as i32 as u32 as u64
        }
        "NtGdiSaveDC" => {
            let Some(d) = e.dc(a0) else { return Some(0) };
            let (attr, bmp, brush, pen, font, pal, clip) = (d.attr, d.bmp, d.brush, d.pen, d.font, d.pal, d.clip);
            let ab = e.bytes(attr, ATTR_SIZE as usize);
            let d = e.dc_mut(a0).unwrap();
            d.saved.push(Saved { attr: ab, bmp, brush, pen, font, pal, clip });
            let n = d.saved.len() as u32;
            e.w32(attr + 8, n);
            n as u64
        }
        "NtGdiRestoreDC" => {
            let lvl = ar[1] as i32;
            let Some(d) = e.dc_mut(a0) else { return Some(0) };
            let n = d.saved.len() as i32;
            let target = if lvl < 0 { n + lvl } else { lvl - 1 };
            if target < 0 || target >= n {
                return Some(0);
            }
            let s = d.saved[target as usize].clone();
            d.saved.truncate(target as usize);
            d.bmp = s.bmp;
            d.brush = s.brush;
            d.pen = s.pen;
            d.font = s.font;
            d.pal = s.pal;
            d.clip = s.clip;
            let attr = d.attr;
            let mut ab = s.attr;
            ab[0..4].copy_from_slice(&(a0 as u32).to_le_bytes());
            ab[8..12].copy_from_slice(&(target as u32).to_le_bytes());
            let _ = e.mmu.write_bytes(attr, &ab);
            1
        }
        "NtGdiResetDC" | "NtGdiCancelDC" => 1,
        "NtGdiComputeXformCoefficients"
        | "NtGdiModifyWorldTransform"
        | "NtGdiSetVirtualResolution"
        | "NtGdiSetSizeDevice"
        | "NtGdiSetMiterLimit"
        | "NtGdiSetTextJustification"
        | "NtGdiScaleViewportExtEx"
        | "NtGdiScaleWindowExtEx" => 1,
        "NtGdiSetMetaRgn" => 2,
        "NtGdiSetLayout" => {
            let (l, attr) = (ar[2] as u32, e.dc(a0).map_or(0, |d| d.attr));
            if attr == 0 {
                return Some(u32::MAX as u64);
            }
            let o = e.r32(attr + 44);
            e.w32(attr + 44, l);
            o as u64
        }
        "NtGdiTransformPoints" => {
            let (pin, pout, n, mode) = (ar[1], ar[2], ar[3] as u64, ar[4] as u32);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            for i in 0..n {
                let (x, y) = (e.r32(pin + 8 * i) as i32, e.r32(pin + 8 * i + 4) as i32);
                let (x, y) = if mode == 0 { e.lp(attr, x, y) } else { e.dp(attr, x, y) };
                e.w32(pout + 8 * i, x as u32);
                e.w32(pout + 8 * i + 4, y as u32);
            }
            1
        }
        "NtGdiGetTransform" => {
            let x = ar[2];
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            let (o0, o1) = e.lp(attr, 0, 0);
            let (p0, p1) = e.lp(attr, 1000, 1000);
            let vals = [(p0 - o0) as f32 / 1000.0, 0.0, 0.0, (p1 - o1) as f32 / 1000.0, o0 as f32, o1 as f32];
            let world = ar[1] as u32 == 0x203 || ar[1] as u32 == 0x204;
            for (k, v) in vals.iter().enumerate() {
                let v = if world {
                    *v
                } else if k == 0 || k == 3 {
                    1.0
                } else {
                    0.0
                };
                e.w32(x + 4 * k as u64, v.to_bits());
            }
            1
        }
        "NtGdiGetBoundsRect" | "NtGdiSetBoundsRect" => 0,
        // clipping
        "NtGdiExtSelectClipRgn" => {
            let (rg, mode) = (ar[1], ar[2] as u32);
            let r = if rg == 0 { None } else { e.rgn(rg) };
            e.clip_op(a0, r, mode)
        }
        "NtGdiIntersectClipRect" | "NtGdiExcludeClipRect" => {
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            let r = Rect::new(ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32);
            let r = e.lpr(attr, r);
            e.clip_op(a0, Some(r), if name == "NtGdiIntersectClipRect" { 1 } else { 4 })
        }
        "NtGdiOffsetClipRgn" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let area = e.dc_area(a0);
            let Some(d) = e.dc_mut(a0) else { return Some(0) };
            if let Some(c) = d.clip.as_mut() {
                *c = c.off(x, y);
            }
            Engine::rtype(d.clip.unwrap_or(area))
        }
        "NtGdiRectVisible" | "NtGdiPtVisible" => {
            // does a logical rectangle (or point) touch the DC's visible, clipped area?
            let area = e.dc_area(a0);
            let Some((attr, clip, vis)) = e.dc(a0).map(|d| (d.attr, d.clip, d.vis)) else { return Some(0) };
            let mut c = area;
            if let Some(v) = vis {
                c = c.inter(&v);
            }
            if let Some(cl) = clip {
                c = c.inter(&cl);
            }
            let q = if name == "NtGdiPtVisible" {
                let (x, y) = (a0 as i32, 0);
                let _ = (x, y);
                let (x, y) = (ar[1] as i32, ar[2] as i32);
                Rect::new(x, y, x + 1, y + 1)
            } else {
                e.rd_rect(ar[1])
            };
            let (l, t) = e.dp(attr, q.l, q.t);
            let (r, b) = e.dp(attr, q.r, q.b);
            let q = Rect::new(l.min(r), t.min(b), l.max(r), t.max(b));
            (!q.inter(&c).empty()) as u64
        }
        "NtGdiGetAppClipBox" => {
            let out = ar[1];
            let area = e.dc_area(a0);
            let Some((attr, clip, vis)) = e.dc(a0).map(|d| (d.attr, d.clip, d.vis)) else { return Some(0) };
            let mut c = area;
            if let Some(v) = vis {
                c = c.inter(&v);
            }
            if let Some(cl) = clip {
                c = c.inter(&cl);
            }
            if c.empty() {
                c = Rect::default();
            }
            let (l, t) = e.dp(attr, c.l, c.t);
            let (r, b) = e.dp(attr, c.r, c.b);
            e.wr_rect(out, Rect::new(l.min(r), t.min(b), l.max(r), t.max(b)));
            Engine::rtype(c)
        }
        "NtGdiGetRandomRgn" => {
            let (rg, code) = (ar[1], ar[2] as u32 & 0xFFFF);
            let Some((clip, vis, hwnd, whole)) = e.dc(a0).map(|d| (d.clip, d.vis, d.hwnd, d.whole)) else { return Some(u32::MAX as u64) };
            match code {
                1 => match clip {
                    Some(c) => {
                        e.set_rgn(rg, c);
                        1
                    }
                    None => 0,
                },
                4 => {
                    let area = e.dc_area(a0);
                    let org = e.wnd(hwnd).map_or((0, 0), |w| {
                        let r = if whole { w.wrect } else { w.crect };
                        (r.l, r.t)
                    });
                    let r = vis.map_or(area, |v| v.inter(&area)).off(org.0, org.1);
                    e.set_rgn(rg, r);
                    1
                }
                _ => 0,
            }
        }
        "NtGdiCreateRectRgn" => {
            let r = Rect::new(ar[0] as i32, ar[1] as i32, ar[2] as i32, ar[3] as i32);
            let r = Rect::new(r.l.min(r.r), r.t.min(r.b), r.l.max(r.r), r.t.max(r.b));
            e.gdi_new(E_RGN, Obj::Rgn(if r.empty() { Rect::default() } else { r }))
        }
        "NtGdiCreateEllipticRgn" | "NtGdiCreateRoundRectRgn" => {
            let r = Rect::new(ar[0] as i32, ar[1] as i32, ar[2] as i32, ar[3] as i32);
            e.gdi_new(E_RGN, Obj::Rgn(r))
        }
        "NtGdiExtCreateRegion" => {
            let data = ar[2];
            let n = e.r32(data + 8);
            let r = if n == 0 { Rect::default() } else { e.rd_rect(data + 16) };
            e.gdi_new(E_RGN, Obj::Rgn(r))
        }
        "NtGdiSetRectRgn" => {
            let r = Rect::new(ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32);
            e.set_rgn(a0, r);
            1
        }
        "NtGdiCombineRgn" => {
            let (s1, s2, mode) = (ar[1], ar[2], ar[3] as u32);
            let (Some(r1), r2) = (e.rgn(s1), e.rgn(s2)) else { return Some(0) };
            let r2 = r2.unwrap_or_default();
            let r = match mode {
                1 => r1.inter(&r2),
                2 | 3 => r1.union(&r2),
                4 => Engine::diff(r1, r2),
                _ => r1,
            };
            let r = if r.empty() { Rect::default() } else { r };
            e.set_rgn(a0, r);
            Engine::rtype(r)
        }
        "NtGdiOffsetRgn" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let Some(r) = e.rgn(a0) else { return Some(0) };
            let r = if r.empty() { r } else { r.off(x, y) };
            e.set_rgn(a0, r);
            Engine::rtype(r)
        }
        "NtGdiGetRgnBox" => {
            let out = ar[1];
            let Some(r) = e.rgn(a0) else { return Some(0) };
            e.wr_rect(out, r);
            Engine::rtype(r)
        }
        "NtGdiPtInRegion" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            e.rgn(a0).map_or(0, |r| r.has(x, y) as u64)
        }
        "NtGdiRectInRegion" => {
            let rr = ar[1];
            let q = e.rd_rect(rr);
            e.rgn(a0).map_or(0, |r| !r.inter(&q).empty() as u64)
        }
        "NtGdiEqualRgn" => {
            let b = ar[1];
            (e.rgn(a0) == e.rgn(b)) as u64
        }
        "NtGdiGetRegionData" => {
            let (n, out) = (ar[1] as u32, ar[2]);
            let Some(r) = e.rgn(a0) else { return Some(0) };
            let cnt = if r.empty() { 0 } else { 1 };
            let need = 32 + 16 * cnt;
            if out == 0 || n < need {
                return Some(need as u64);
            }
            e.w32(out, 32);
            e.w32(out + 4, 1);
            e.w32(out + 8, cnt);
            e.w32(out + 12, 16 * cnt);
            e.wr_rect(out + 16, r);
            if cnt == 1 {
                e.wr_rect(out + 32, r);
            }
            need as u64
        }
        "NtGdiFillRgn" | "NtGdiFrameRgn" | "NtGdiInvertRgn" => {
            let rg = ar[1];
            let Some(r) = e.rgn(rg) else { return Some(0) };
            let Some(v) = e.view(a0) else { return Some(0) };
            let r = e.lpr(v.attr, r).off(v.ox, v.oy);
            if name == "NtGdiInvertRgn" {
                e.fill_with(v, r, &Be::Solid(0), 0x55);
                return Some(1);
            }
            let br = ar[2];
            let be = e.brush_eval(br, v.attr, v.mono, v.ox, v.oy);
            if name == "NtGdiFillRgn" {
                e.fill_with(v, r, &be, 0xF0);
            } else {
                let (w, h) = ((ar[3] as i32).max(1), (ar[4] as i32).max(1));
                for b in [
                    Rect::new(r.l, r.t, r.r, r.t + h),
                    Rect::new(r.l, r.b - h, r.r, r.b),
                    Rect::new(r.l, r.t, r.l + w, r.b),
                    Rect::new(r.r - w, r.t, r.r, r.b),
                ] {
                    e.fill_with(v, b, &be, 0xF0);
                }
            }
            1
        }
        // palettes
        "NtGdiCreatePaletteInternal" => {
            let n = (ar[1] as u64).min(256);
            let cols = (0..n)
                .map(|i| {
                    let b = e.bytes(a0 + 4 + 4 * i, 3);
                    (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32
                })
                .collect();
            e.gdi_new(E_PAL, Obj::Pal(cols))
        }
        "NtGdiCreateHalftonePalette" => e.gdi_new(E_PAL, Obj::Pal(std_palette(8))),
        "NtGdiDoPalette" => {
            let (start, n, ent, func, inb) = (ar[1] as usize, ar[2] as usize, ar[3], ar[4] as u32, ar[5] as u32 != 0);
            match func {
                1 | 2 | 0 => {
                    let Some(Obj::Pal(p)) = e.s.gdi.objs.get(&idx(a0)) else { return Some(0) };
                    let mut p = p.clone();
                    if ent == 0 {
                        return Some(p.len() as u64);
                    }
                    let k = n.min(p.len().saturating_sub(start));
                    for i in 0..k {
                        let a = ent + 4 * i as u64;
                        if func == 2 || !inb {
                            let c = p[start + i];
                            let _ = e.mmu.write_bytes(a, &[(c >> 16) as u8, (c >> 8) as u8, c as u8, 0]);
                        } else {
                            let b = e.bytes(a, 3);
                            p[start + i] = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
                        }
                    }
                    if let Some(Obj::Pal(q)) = e.s.gdi.objs.get_mut(&idx(a0)) {
                        *q = p;
                    }
                    k as u64
                }
                3 => {
                    let p = default_pal();
                    for i in 0..n.min(20) {
                        let c = p[i];
                        let _ = e.mmu.write_bytes(ent + 4 * i as u64, &[(c >> 16) as u8, (c >> 8) as u8, c as u8, 0]);
                    }
                    n.min(20) as u64
                }
                4 | 5 => {
                    // DIB color table of the bitmap selected in the DC (RGBQUAD = our pixel layout)
                    let bmp = e.dc(a0).map_or(0, |d| d.bmp);
                    let Some(Obj::Bmp(b)) = e.s.gdi.objs.get(&idx(bmp)) else { return Some(0) };
                    let mut p = b.pal.clone();
                    let k = n.min(p.len().saturating_sub(start));
                    for i in 0..k {
                        let a = ent + 4 * i as u64;
                        if func == 4 {
                            e.w32(a, p[start + i]);
                        } else {
                            p[start + i] = e.r32(a) & 0xFFFFFF;
                        }
                    }
                    if func == 5 {
                        if let Some(Obj::Bmp(b)) = e.s.gdi.objs.get_mut(&idx(bmp)) {
                            b.pal = p;
                        }
                    }
                    k as u64
                }
                _ => 0,
            }
        }
        "NtGdiGetNearestColor" => ar[1] & 0xFFFFFF,
        "NtGdiGetNearestPaletteIndex" => 0,
        "NtGdiGetSystemPaletteUse" => 1,
        "NtGdiSetSystemPaletteUse" => 1,
        "NtGdiUnrealizeObject" => 1,
        "NtGdiResizePalette" => 1,
        "NtGdiGetColorAdjustment" | "NtGdiSetColorAdjustment" => 0,
        "NtGdiGetDeviceGammaRamp" => 0,
        "NtGdiSetDeviceGammaRamp" => 1,
        "NtGdiDescribePixelFormat" | "NtGdiSetPixelFormat" | "NtGdiSwapBuffers" => 0,
        "NtGdiGetSpoolMessage" | "NtGdiExtEscape" | "NtGdiStartDoc" | "NtGdiStartPage" | "NtGdiEndPage" | "NtGdiEndDoc" | "NtGdiAbortDoc" => 0,
        // paths: accepted and not drawn yet
        "NtGdiBeginPath"
        | "NtGdiEndPath"
        | "NtGdiAbortPath"
        | "NtGdiCloseFigure"
        | "NtGdiFlattenPath"
        | "NtGdiWidenPath"
        | "NtGdiStrokePath"
        | "NtGdiFillPath"
        | "NtGdiStrokeAndFillPath"
        | "NtGdiSelectClipPath" => 1,
        "NtGdiPathToRegion" => e.gdi_new(E_RGN, Obj::Rgn(Rect::default())),
        "NtGdiGetPath" => 0,
        "NtGdiIcmBrushInfo" => 0,
        "NtGdiGetCharSet" => 0,
        "NtGdiGetFontResourceInfoInternalW" => 0,
        "NtGdiMakeFontDir" => 0,
        _ => {
            if name.starts_with("NtGdiDdDDI") {
                if let Some(st) = e.d3dkmt(name, a0) {
                    return Some(st);
                }
                return Some(crate::status::NOT_SUPPORTED);
            }
            if !e.s.gdi.unknown.contains(name) {
                e.s.gdi.unknown.insert(name.to_string());
                crate::console(&format!("[win32u] {} (not yet)\n", name));
            }
            0
        }
    };
    Some(r)
}
