// Clipping and regions.

use super::*;

impl Engine {

    pub(super) fn rgn(&self, h: u64) -> Option<Rect> { match self.s.gdi.objs.get(&idx(h)) { Some(Obj::Rgn(r)) => Some(*r), _ => None } }
    pub(super) fn set_rgn(&mut self, h: u64, r: Rect) { if let Some(Obj::Rgn(x)) = self.s.gdi.objs.get_mut(&idx(h)) { *x = if r.empty() { Rect::default() } else { r }; } }
    pub(super) fn rtype(r: Rect) -> u64 { if r.empty() { 1 } else { 2 } }

    pub(super) fn diff(a: Rect, b: Rect) -> Rect {
        let i = a.inter(&b);
        if i.empty() { return a; }
        if i == a { return Rect::default(); }
        // only a full-width or full-height band can be taken away exactly
        if i.l == a.l && i.r == a.r { if i.t == a.t { return Rect::new(a.l, i.b, a.r, a.b); } if i.b == a.b { return Rect::new(a.l, a.t, a.r, i.t); } }
        if i.t == a.t && i.b == a.b { if i.l == a.l { return Rect::new(i.r, a.t, a.r, a.b); } if i.r == a.r { return Rect::new(a.l, a.t, i.l, a.b); } }
        a
    }

    /// The DC's whole drawable area (device coordinates, before the program's clip).
    pub(super) fn dc_area(&mut self, hdc: u64) -> Rect {
        let Some(d) = self.dc(hdc) else { return Rect::default() };
        let (mem, bmp, hwnd, whole) = (d.mem, d.bmp, d.hwnd, d.whole);
        if mem { return match self.s.gdi.objs.get(&idx(bmp)) { Some(Obj::Bmp(b)) => Rect::new(0, 0, b.w, b.h), _ => Rect::new(0, 0, 1, 1) }; }
        if hwnd == 0 { return Rect::new(0, 0, SCREEN_W, SCREEN_H); }
        self.wnd(hwnd).map_or(Rect::default(), |w| { let r = if whole { w.wrect } else { w.crect }; Rect::new(0, 0, r.w(), r.h()) })
    }

    pub(super) fn clip_op(&mut self, hdc: u64, r: Option<Rect>, mode: u32) -> u64 {
        let area = self.dc_area(hdc);
        let Some(d) = self.dc_mut(hdc) else { return 0 };
        let cur = d.clip.unwrap_or(area);
        d.clip = match (mode, r) {
            (5, None) => None,
            (5, Some(r)) => Some(r),
            (1, Some(r)) => Some(cur.inter(&r)),
            (2, Some(r)) | (3, Some(r)) => Some(cur.union(&r)),
            (4, Some(r)) => Some(Engine::diff(cur, r)),
            _ => d.clip,
        };
        let res = d.clip.unwrap_or(area).inter(&area);
        Engine::rtype(res)
    }
}
