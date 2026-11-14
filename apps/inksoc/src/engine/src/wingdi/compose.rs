// Composition: building the page's framebuffer from window surfaces, with classic frames, captions and menus.

use super::*;

impl Engine {
    /// Builds the framebuffer: desktop, windows (back to front), frames, menus.
    pub(crate) fn compose(&mut self) {
        let (w, h) = (SCREEN_W, SCREEN_H);
        let mut fb = std::mem::take(&mut self.s.gdi.fb);
        fb.resize((w * h) as usize, 0);
        fb.fill(0); // transparent: the page draws the desktop under the windows
        let tops = self.s.win.tops.clone();
        for t in tops {
            let Some(win) = self.wnd(t) else { continue };
            if win.style & 0x1000_0000 == 0 {
                continue;
            }
            let wr = win.wrect;
            let Some(s) = self.s.gdi.surfs.get_mut(&t) else { continue };
            let (sw, sh) = (s.w, s.h);
            let mut px = std::mem::take(&mut s.px);
            if px.len() != (sw * sh) as usize {
                if let Some(s) = self.s.gdi.surfs.get_mut(&t) {
                    s.px = px;
                }
                continue;
            }
            // frames of the window and its visible children
            let mut list = vec![t];
            let mut i = 0;
            while i < list.len() {
                let kids = self.wnd(list[i]).map_or(vec![], |w| w.children.clone());
                for k in kids {
                    if self.wnd(k).map_or(false, |w| w.style & 0x1000_0000 != 0) {
                        list.push(k);
                    }
                }
                i += 1;
            }
            for k in list {
                self.draw_nc(k, &mut px, sw, sh, wr);
            }
            for y in 0..sh {
                let fy = wr.t + y;
                if fy < 0 || fy >= h {
                    continue;
                }
                for x in 0..sw {
                    let fx = wr.l + x;
                    if fx < 0 || fx >= w {
                        continue;
                    }
                    fb[(fy * w + fx) as usize] = 0xFF00_0000 | colorref(px[(y * sw + x) as usize] & 0xFFFFFF);
                }
            }
            if let Some(s) = self.s.gdi.surfs.get_mut(&t) {
                s.px = px;
            }
        }
        self.draw_popup(&mut fb, w, h);
        self.s.gdi.fb = fb;
    }

    pub(super) fn draw_nc(&mut self, hw: u64, px: &mut Vec<u32>, sw: i32, sh: i32, twr: Rect) {
        let Some(w) = self.wnd(hw) else { return };
        let (style, ex, menu, text, child) = (w.style, w.ex_style, w.menu, w.text.clone(), w.style & 0x4000_0000 != 0);
        let mut r = w.wrect.off(-twr.l, -twr.t);
        let crect = w.crect.off(-twr.l, -twr.t);
        let active = !child && self.s.win.active == hw;
        let cl = Rect::new(0, 0, sw, sh);
        let mut cv = Cv { px, w: sw, clip: cl };
        let caption = style & 0x00C0_0000 == 0x00C0_0000;
        let outer = if style & 0x0004_0000 != 0 {
            4
        } else if style & 0x0040_0000 != 0 || ex & 1 != 0 {
            3
        } else if style & 0x0080_0000 != 0 {
            1
        } else if child && caption {
            3
        } else {
            0
        };
        if outer >= 3 {
            cv.edge(r, FACE, DARK);
            cv.edge(r.inset(1), LIGHT, SHADOW);
            for k in 2..outer {
                cv.frame(r.inset(k), FACE);
            }
        } else if outer == 1 {
            cv.frame(r, 0);
        }
        r = r.inset(outer);
        if caption {
            let cap = Rect::new(r.l, r.t, r.r, r.t + 18);
            let (c0, c1) = if active { (0x0A246A, 0xA6CAF0) } else { (0x808080, 0xC0C0C0) };
            for x in cap.l..cap.r {
                let t = if cap.w() > 1 { (x - cap.l) as u32 * 255 / (cap.w() - 1) as u32 } else { 0 };
                let mix = |a: u32, b: u32, s: u32| (((a >> s & 0xFF) * (255 - t) + (b >> s & 0xFF) * t) / 255) << s;
                let c = mix(c0, c1, 16) | mix(c0, c1, 8) | mix(c0, c1, 0);
                cv.fill(Rect::new(x, cap.t, x + 1, cap.b), c);
            }
            cv.fill(Rect::new(r.l, cap.b, r.r, cap.b + 1), FACE);
            let tc = if active { 0xFFFFFF } else { FACE };
            let room = Rect::new(cap.l + 4, cap.t, cap.r - 22, cap.b);
            cv.text(room, cap.l + 4, cap.t + 2, &text, 1, tc);
            if style & 0x0008_0000 != 0 {
                let b = Rect::new(cap.r - 18, cap.t + 2, cap.r - 2, cap.t + 16);
                cv.fill(b, FACE);
                cv.edge(b, LIGHT, DARK);
                cv.edge(b.inset(1), FACE, SHADOW);
                for k in 0..7 {
                    for d in 0..2 {
                        cv.put(b.l + 4 + k + d, b.t + 3 + k, 0);
                        cv.put(b.l + 10 - k + d, b.t + 3 + k, 0);
                    }
                }
            }
            r.t += 19;
        }
        if menu != 0 && !child {
            let bar = Rect::new(r.l, r.t, r.r, r.t + 18);
            cv.fill(Rect::new(r.l, r.t, r.r, r.t + 19), FACE);
            let lay = self.menu_bar_layout(menu);
            let items: Vec<(String, u32)> =
                self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| (i.text.replace('&', ""), i.state)).collect());
            let open = self.s.win.popup.as_ref().map(|p| p.hwnd == hw).unwrap_or(false);
            let open_menu = self.s.win.popup.as_ref().map_or(0, |p| p.menu);
            for (i, (x, wd)) in lay.iter().enumerate() {
                let Some((t, st)) = items.get(i) else { continue };
                let ir = Rect::new(bar.l + x, bar.t, bar.l + x + wd, bar.b);
                let sub = self.s.win.menus.get(&menu).and_then(|m| m.items.get(i)).map_or(0, |it| it.sub);
                let hot = open && sub != 0 && sub == open_menu;
                if hot {
                    cv.fill(ir, 0x0A246A);
                }
                let c = if hot {
                    0xFFFFFF
                } else if st & 3 != 0 {
                    SHADOW
                } else {
                    0
                };
                cv.text(ir, ir.l + 8, ir.t + 2, t, 0, c);
            }
            r.t += 19;
        }
        if ex & 0x200 != 0 {
            cv.edge(r, SHADOW, LIGHT);
            cv.edge(r.inset(1), DARK, FACE);
            r = r.inset(2);
        }
        if ex & 0x20000 != 0 {
            cv.edge(r, SHADOW, LIGHT);
            r = r.inset(1);
        }
        let (vs, hs) = (style & 0x0020_0000 != 0, style & 0x0010_0000 != 0);
        if vs {
            let sb = Rect::new(crect.r, r.t, crect.r + 17, crect.b);
            cv.fill(sb, 0xE8E8E8);
            let up = Rect::new(sb.l, sb.t, sb.r, sb.t + 17);
            let dn = Rect::new(sb.l, sb.b - 17, sb.r, sb.b);
            for (b, down) in [(up, false), (dn, true)] {
                cv.fill(b, FACE);
                cv.edge(b, LIGHT, DARK);
                cv.edge(b.inset(1), FACE, SHADOW);
                for k in 0..4 {
                    let y = if down { b.t + 6 + k } else { b.t + 9 - k };
                    cv.fill(Rect::new(b.l + 8 - (3 - k), y, b.l + 9 + (3 - k), y + 1), 0);
                }
            }
        }
        if hs {
            let sb = Rect::new(r.l, crect.b, crect.r, crect.b + 17);
            cv.fill(sb, 0xE8E8E8);
            if vs {
                cv.fill(Rect::new(crect.r, crect.b, crect.r + 17, crect.b + 17), FACE);
            }
        }
    }

    pub(super) fn draw_popup(&mut self, fb: &mut Vec<u32>, w: i32, h: i32) {
        let Some(p) = &self.s.win.popup else { return };
        let (x, y, pw, ph, menu, hot) = (p.x, p.y, p.w, p.h, p.menu, p.hot);
        if pw <= 0 || ph <= 0 {
            return;
        }
        let mut px = vec![FACE; (pw * ph) as usize];
        {
            let mut cv = Cv { px: &mut px, w: pw, clip: Rect::new(0, 0, pw, ph) };
            let r = Rect::new(0, 0, pw, ph);
            cv.edge(r, FACE, DARK);
            cv.edge(r.inset(1), LIGHT, SHADOW);
            let items: Vec<(String, u32, u32, u64)> =
                self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| (i.text.replace('&', ""), i.flags, i.state, i.sub)).collect());
            let mut yy = 3;
            for (i, (t, f, st, sub)) in items.iter().enumerate() {
                if f & 0x800 != 0 {
                    cv.fill(Rect::new(3, yy + 3, pw - 3, yy + 4), SHADOW);
                    cv.fill(Rect::new(3, yy + 4, pw - 3, yy + 5), LIGHT);
                    yy += 8;
                    continue;
                }
                let ir = Rect::new(3, yy, pw - 3, yy + 18);
                let is_hot = i as i32 == hot;
                if is_hot {
                    cv.fill(ir, 0x0A246A);
                }
                let c = if st & 3 != 0 {
                    SHADOW
                } else if is_hot {
                    0xFFFFFF
                } else {
                    0
                };
                let mut parts = t.split('\t');
                let main = parts.next().unwrap_or("");
                cv.text(ir, 22, yy + 2, main, 0, c);
                if let Some(acc) = parts.next() {
                    let aw = text_width(0, acc);
                    cv.text(ir, pw - 10 - aw, yy + 2, acc, 0, c);
                }
                if st & 8 != 0 {
                    for k in 0..3 {
                        cv.fill(Rect::new(8 + k, yy + 8 + k, 9 + k, yy + 11 + k), c);
                    }
                    for k in 0..4 {
                        cv.fill(Rect::new(11 + k, yy + 9 - k, 12 + k, yy + 12 - k), c);
                    }
                }
                if *sub != 0 {
                    for k in 0..4 {
                        cv.fill(Rect::new(pw - 12 + k, yy + 5 + k, pw - 11 + k, yy + 13 - k), c);
                    }
                }
                yy += 18;
            }
        }
        for j in 0..ph {
            for i in 0..pw {
                let (fx, fy) = (x + i, y + j);
                if fx >= 0 && fy >= 0 && fx < w && fy < h {
                    fb[(fy * w + fx) as usize] = 0xFF00_0000 | colorref(px[(j * pw + i) as usize]);
                }
            }
        }
    }
}
