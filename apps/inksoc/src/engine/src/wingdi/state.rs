// Wine's GDI objects and device contexts on the engine side: handles, DC attributes, owned DCs.

use super::*;

impl Engine {
    pub(super) fn s64(&mut self, a: u64, v: u64) { if a != 0 { self.w64(a, v); } }
    pub(super) fn bytes(&mut self, a: u64, n: usize) -> Vec<u8> { let mut v = vec![0u8; n]; let _ = self.mmu.read_bytes(a, &mut v); v }

    /// The GDI handle table (at PEB+0xF8) with the stock objects in Wine's slots.
    pub(crate) fn gdi_init(&mut self) {
        if self.s.gdi.table != 0 { return; }
        let Some(t) = self.reserve(0x10000 * 24) else { return };
        self.s.gdi.table = t;
        self.w64(crate::PEB + 0xF8, t);
        self.s.gdi.next = FIRST;
        for c in [0xFFFFFF, 0xC0C0C0, 0x808080, 0x404040, 0] { self.gdi_new(E_BRUSH, Obj::Brush(Brush::Solid(c))); }
        self.gdi_new(E_BRUSH, Obj::Brush(Brush::Null));
        for (s, c) in [(0, 0xFFFFFF), (0, 0), (5, 0)] { self.gdi_new(E_PEN, Obj::Pen(Pen { style: s, width: 0, color: c, dc: false, ext: false })); }
        let font = |e: &mut Engine, h: i32, wt: i32, face: &str| { let lf = mk_lf(h, wt, face); let fi = pick_font(h, wt); e.gdi_new(E_FONT, Obj::Font(Font { lf, fi })); };
        font(self, 12, 400, "Terminal"); // 9: scaled OEM
        font(self, 12, 400, "Terminal");
        font(self, 12, 400, "Courier");
        font(self, 12, 400, "MS Sans Serif");
        font(self, 16, 700, "System");
        font(self, 16, 700, "System");
        self.gdi_new(E_PAL, Obj::Pal(default_pal().to_vec()));
        font(self, 16, 400, "Fixedsys");
        font(self, -11, 400, "MS Shell Dlg");
        self.gdi_new(E_BRUSH, Obj::Brush(Brush::Dc));
        self.gdi_new(E_PEN, Obj::Pen(Pen { style: 0, width: 0, color: 0, dc: true, ext: false }));
        self.gdi_new(E_BMP, Obj::Bmp(Bmp { w: 1, h: 1, bpp: 1, px: vec![0], dib: 0, stride: 2, pal: vec![], topdown: true, masks: [0; 3], comp: 0 }));
        font(self, 16, 700, "System");
        font(self, 16, 400, "Fixedsys");
        font(self, -11, 400, "MS Shell Dlg");
        for i in FIRST..FIRST + 24 {
            let a = t + 24 * i as u64 + 12;
            let v = self.r8(a);
            self.w8(a, v | 0x80);
        }
    }

    pub(super) fn gdi_new(&mut self, ext: u32, obj: Obj) -> u64 {
        self.gdi_init();
        let g = &mut self.s.gdi;
        let i = match g.free.pop() { Some(i) => i, None => { g.next += 1; g.next - 1 } };
        if i >= 0x10000 { return 0; }
        g.objs.insert(i, obj);
        let e = g.table + 24 * i as u64;
        let gen = self.r8(e + 13);
        let gen = if gen + 1 >= 0x80 { 1 } else { gen + 1 };
        self.w64(e, 1 + i as u64);
        self.w32(e + 8, 0);
        self.w8(e + 12, ext as u8);
        self.w8(e + 13, gen);
        self.w8(e + 14, (ext & 0x1F) as u8);
        self.w8(e + 15, 0);
        self.w64(e + 16, 0);
        i as u64 | ((self.r16(e + 12) as u32) as u64) << 16
    }

    /// Full handle (with the type and generation bits) of a table slot.
    pub(super) fn handle_of(&mut self, i: u32) -> u64 {
        let t = self.s.gdi.table;
        if t == 0 { return 0; }
        i as u64 | ((self.r16(t + 24 * i as u64 + 12) as u32) as u64) << 16
    }
    pub(super) fn stock(&mut self, i: u32) -> u64 { self.gdi_init(); self.handle_of(FIRST + i) }
    pub(super) fn is_stock(&self, h: u64) -> bool { let i = idx(h); i >= FIRST && i < FIRST + 24 }

    pub(super) fn gdi_free(&mut self, i: u32) {
        if self.s.gdi.objs.remove(&i).is_none() { return; }
        let e = self.s.gdi.table + 24 * i as u64;
        self.w64(e, 0);
        self.w8(e + 14, 0);
        self.w64(e + 16, 0);
        self.s.gdi.free.push(i);
    }

    pub(super) fn dc(&self, h: u64) -> Option<&Dc> { match self.s.gdi.objs.get(&idx(h)) { Some(Obj::Dc(d)) => Some(d), _ => None } }
    pub(super) fn dc_mut(&mut self, h: u64) -> Option<&mut Dc> { match self.s.gdi.objs.get_mut(&idx(h)) { Some(Obj::Dc(d)) => Some(d), _ => None } }

    pub(super) fn attr_new(&mut self, hdc: u64) -> u64 {
        let a = match self.s.gdi.attr_free.pop() {
            Some(a) => a,
            None => {
                if self.s.gdi.attr_next + ATTR_SIZE > self.s.gdi.attr_end {
                    let Some(p) = self.reserve(0x10000) else { return 0 };
                    self.s.gdi.attr_next = p; self.s.gdi.attr_end = p + 0x10000;
                }
                self.s.gdi.attr_next += ATTR_SIZE;
                self.s.gdi.attr_next - ATTR_SIZE
            }
        };
        let _ = self.mmu.write_bytes(a, &[0u8; ATTR_SIZE as usize]);
        self.w32(a, hdc as u32);
        self.w32(a + 12, 0xFFFFFF); // background
        self.w32(a + 16, 0xFFFFFF); // DC brush
        self.w32(a + 36, 1); // GM_COMPATIBLE
        self.w32(a + 40, 1); // AD_COUNTERCLOCKWISE
        self.w16(a + 50, (2) as u16); // OPAQUE
        self.w16(a + 52, (1) as u16); // ALTERNATE
        self.w16(a + 54, (13) as u16); // R2_COPYPEN
        self.w16(a + 56, (1) as u16);
        self.w16(a + 58, (1) as u16); // BLACKONWHITE
        self.w32(a + 60, 1); // MM_TEXT
        self.w32(a + 88, 10.0f32.to_bits());
        for o in [108u64, 112, 124, 128] { self.w32(a + o, 1); }
        self.w32(a + 132, SCREEN_W as u32); self.w32(a + 136, SCREEN_H as u32);
        self.w32(a + 140, 320); self.w32(a + 144, 240);
        a
    }

    pub(super) fn dc_new(&mut self, hwnd: u64, whole: bool, mem: bool) -> u64 {
        let (bmp, brush, pen, font, pal) = (if mem { self.stock(20) } else { 0 }, self.stock(0), self.stock(7), self.stock(13), self.stock(15));
        let h = self.gdi_new(if mem { E_MEMDC } else { E_DC }, Obj::Dc(Dc { attr: 0, hwnd, whole, mem, bmp, brush, pen, font, pal, clip: None, vis: None, saved: vec![] }));
        let a = self.attr_new(h);
        if let Some(d) = self.dc_mut(h) { d.attr = a; }
        let e = self.s.gdi.table + 24 * idx(h) as u64;
        self.s64(e + 16, a);
        // visible rectangle (screen coordinates)
        let r = if hwnd == 0 || mem { Rect::new(0, 0, SCREEN_W, SCREEN_H) } else { self.wnd(hwnd).map_or(Rect::default(), |w| if whole { w.wrect } else { w.crect }) };
        self.wr_rect(a + 72, r);
        h
    }

    pub(super) fn dc_delete(&mut self, h: u64) {
        let i = idx(h);
        let a = match self.s.gdi.objs.get(&i) { Some(Obj::Dc(d)) => d.attr, _ => return };
        self.gdi_free(i);
        if a != 0 { self.s.gdi.attr_free.push(a); }
        self.s.gdi.owndc.retain(|_, &mut v| idx(v) != i);
    }

    /// A DC for a window (GetDC / BeginPaint), or the screen for hwnd 0.
    pub(crate) fn get_dc(&mut self, h: u64, whole: bool) -> u64 {
        let h = full(h);
        let h = if h == 0x10010 { 0 } else { h };
        if h != 0 && self.wnd(h).is_none() { return 0; }
        let own = h != 0 && !whole && self.wnd(h).map_or(false, |w| self.s.win.classes[w.class].style & 0x60 != 0);
        if own {
            if let Some(&d) = self.s.gdi.owndc.get(&h) {
                if self.dc(d).is_some() { if let Some(dc) = self.dc_mut(d) { dc.vis = None; } return d; }
            }
            let d = self.dc_new(h, false, false);
            self.s.gdi.owndc.insert(h, d);
            return d;
        }
        self.dc_new(h, whole, false)
    }

    pub(crate) fn release_dc(&mut self, hdc: u64) {
        if self.s.gdi.owndc.values().any(|&v| idx(v) == idx(hdc)) { if let Some(d) = self.dc_mut(hdc) { d.vis = None; } return; }
        if self.dc(hdc).map_or(false, |d| !d.mem) { self.dc_delete(hdc); }
    }

    pub(crate) fn dc_clip_to(&mut self, hdc: u64, r: Rect) { if let Some(d) = self.dc_mut(hdc) { d.vis = Some(r); } }

    /// Fills with a brush handle or a system color index + 1 (class brushes).
    pub(crate) fn fill_rect_brush(&mut self, hdc: u64, r: Rect, brush: u64) {
        let b = if brush != 0 && brush <= 31 { self.sys_brush(brush as u32 - 1) } else { brush };
        let Some(old) = self.dc(hdc).map(|d| d.brush) else { return };
        if let Some(d) = self.dc_mut(hdc) { d.brush = b; }
        // the rectangle is in device units: draw without the mapping
        if let Some(v) = self.view(hdc) {
            let be = self.brush_eval(b, v.attr, v.mono, v.ox, v.oy);
            self.fill_with(v, r.off(v.ox, v.oy), &be, 0xF0);
        }
        if let Some(d) = self.dc_mut(hdc) { d.brush = old; }
    }

    pub(crate) fn sys_brush(&mut self, i: u32) -> u64 {
        self.gdi_init();
        if self.s.gdi.sysbrush.is_empty() {
            for k in 0..31 {
                let c = colorref(sys_color_px(k));
                let h = self.gdi_new(E_BRUSH, Obj::Brush(Brush::Solid(c)));
                let a = self.s.gdi.table + 24 * idx(h) as u64 + 12;
                let v = self.r8(a); self.w8(a, v | 0x80);
                let h = self.handle_of(idx(h));
                self.s.gdi.sysbrush.push(h);
            }
        }
        self.s.gdi.sysbrush.get(i as usize).copied().unwrap_or(0)
    }

    pub(crate) fn sys_pen(&mut self, i: u32) -> u64 {
        self.gdi_init();
        if self.s.gdi.syspen.is_empty() {
            for k in 0..31 {
                let c = colorref(sys_color_px(k));
                let h = self.gdi_new(E_PEN, Obj::Pen(Pen { style: 0, width: 0, color: c, dc: false, ext: false }));
                let a = self.s.gdi.table + 24 * idx(h) as u64 + 12;
                let v = self.r8(a); self.w8(a, v | 0x80);
                let h = self.handle_of(idx(h));
                self.s.gdi.syspen.push(h);
            }
        }
        self.s.gdi.syspen.get(i as usize).copied().unwrap_or(0)
    }

    /// Creates or resizes the surface of a top-level window (keeps old pixels).
    pub(crate) fn surface_for(&mut self, h: u64) {
        let Some(w) = self.wnd(h) else { return };
        if w.parent != 0 && w.style & 0x4000_0000 != 0 { return; }
        let (nw, nh) = (w.wrect.w().clamp(0, 4096), w.wrect.h().clamp(0, 4096));
        let s = self.s.gdi.surfs.entry(full(h)).or_insert(Surf { w: 0, h: 0, px: vec![] });
        if s.w == nw && s.h == nh { return; }
        let mut px = vec![FACE; (nw * nh) as usize];
        for y in 0..nh.min(s.h) { for x in 0..nw.min(s.w) { px[(y * nw + x) as usize] = s.px[(y * s.w + x) as usize]; } }
        *s = Surf { w: nw, h: nh, px };
    }

    pub(crate) fn drop_surface(&mut self, h: u64) {
        self.s.gdi.surfs.remove(&full(h));
        if let Some(d) = self.s.gdi.owndc.remove(&full(h)) { self.dc_delete(d); }
    }
}
