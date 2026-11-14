// Selecting and deleting GDI objects.

use super::*;

impl Engine {
    pub(super) fn select(&mut self, hdc: u64, h: u64, kind: u32) -> u64 {
        let ok = match self.s.gdi.objs.get(&idx(h)) {
            Some(Obj::Bmp(_)) => kind == 7,
            Some(Obj::Brush(_)) => kind == 2,
            Some(Obj::Pen(_)) => kind == 1,
            Some(Obj::Font(_)) => kind == 6,
            Some(Obj::Pal(_)) => kind == 5,
            _ => false,
        };
        if !ok {
            return 0;
        }
        let full = self.handle_of(idx(h));
        let Some(d) = self.dc_mut(hdc) else { return 0 };
        if kind == 7 && !d.mem {
            return 0;
        }
        let slot = match kind {
            7 => &mut d.bmp,
            2 => &mut d.brush,
            1 => &mut d.pen,
            6 => &mut d.font,
            _ => &mut d.pal,
        };
        let old = *slot;
        *slot = full;
        if kind == 7 {
            d.clip = None;
        }
        // keep DC_ATTR in step with the selected bitmap's size (vis rect)
        if kind == 7 {
            let a = d.attr;
            let (w, hh) = match self.s.gdi.objs.get(&idx(h)) {
                Some(Obj::Bmp(b)) => (b.w, b.h),
                _ => (1, 1),
            };
            self.wr_rect(a + 72, Rect::new(0, 0, w, hh));
        }
        old
    }

    pub(super) fn get_object(&mut self, h: u64, n: u32, buf: u64) -> u64 {
        enum O {
            Pen(u32, i32, u32, bool),
            Brush(u32, u32),
            Font(Vec<u8>),
            Bmp(i32, i32, u16, u64, Vec<u8>),
            Pal(u32),
            None,
        }
        let o = match self.s.gdi.objs.get(&idx(h)) {
            Some(Obj::Pen(p)) => O::Pen(p.style, p.width, p.color, p.ext),
            Some(Obj::Brush(b)) => match b {
                Brush::Null => O::Brush(1, 0),
                Brush::Solid(c) => O::Brush(0, *c),
                Brush::Hatch(_, c) => O::Brush(2, *c),
                Brush::Pat { .. } => O::Brush(3, 0),
                Brush::Dc => O::Brush(0, 0xFFFFFF),
            },
            Some(Obj::Font(f)) => O::Font(f.lf.clone()),
            Some(Obj::Bmp(b)) => {
                let mut hdr = vec![0u8; 40];
                hdr[0..4].copy_from_slice(&40u32.to_le_bytes());
                hdr[4..8].copy_from_slice(&b.w.to_le_bytes());
                hdr[8..12].copy_from_slice(&(if b.topdown { -b.h } else { b.h }).to_le_bytes());
                hdr[12..14].copy_from_slice(&1u16.to_le_bytes());
                hdr[14..16].copy_from_slice(&b.bpp.to_le_bytes());
                hdr[16..20].copy_from_slice(&b.comp.to_le_bytes());
                hdr[20..24].copy_from_slice(&((b.stride * b.h as usize) as u32).to_le_bytes());
                O::Bmp(b.w, b.h, b.bpp, b.dib, hdr)
            }
            Some(Obj::Pal(p)) => O::Pal(p.len() as u32),
            _ => O::None,
        };
        match o {
            O::Pen(st, w, c, ext) => {
                if ext {
                    if buf == 0 {
                        return 32;
                    }
                    if n < 28 {
                        return 0;
                    }
                    self.w32(buf, st);
                    self.w32(buf + 4, w as u32);
                    self.w32(buf + 8, 0);
                    self.w32(buf + 12, c);
                    self.s64(buf + 16, 0);
                    self.w32(buf + 24, 0);
                    return 28;
                }
                if buf == 0 {
                    return 16;
                }
                if n < 16 {
                    return 0;
                }
                self.w32(buf, st);
                self.w32(buf + 4, w as u32);
                self.w32(buf + 8, 0);
                self.w32(buf + 12, c);
                16
            }
            O::Brush(st, c) => {
                if buf == 0 {
                    return 16;
                }
                if n < 16 {
                    return 0;
                }
                self.w32(buf, st);
                self.w32(buf + 4, c);
                self.s64(buf + 8, 0);
                16
            }
            O::Font(lf) => {
                if buf == 0 {
                    return 92;
                }
                let k = (n as usize).min(92);
                let _ = self.mmu.write_bytes(buf, &lf[..k]);
                k as u64
            }
            O::Bmp(w, h, bpp, dib, hdr) => {
                let wb = ((w as u32 * bpp as u32 + 15) / 16) * 2;
                if buf == 0 {
                    return if dib != 0 { 104 } else { 32 };
                }
                if n < 24 {
                    return 0;
                }
                self.w32(buf, 0);
                self.w32(buf + 4, w as u32);
                self.w32(buf + 8, h as u32);
                self.w32(buf + 12, if dib != 0 { ((w as u32 * bpp as u32 + 31) / 32) * 4 } else { wb });
                self.w16(buf + 16, (1) as u16);
                self.w16(buf + 18, (bpp as u32) as u16);
                if n >= 32 {
                    self.s64(buf + 24, dib);
                }
                if dib != 0 && n >= 104 {
                    let _ = self.mmu.write_bytes(buf + 32, &hdr);
                    for k in 0..3 {
                        self.w32(buf + 72 + 4 * k, 0);
                    }
                    self.s64(buf + 88, 0);
                    self.w32(buf + 96, 0);
                    return 104;
                }
                if n >= 32 {
                    32
                } else {
                    24
                }
            }
            O::Pal(k) => {
                if buf == 0 {
                    return 2;
                }
                self.w16(buf, (k) as u16);
                2
            }
            O::None => 0,
        }
    }
}
