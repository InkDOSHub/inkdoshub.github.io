// Windows: creation, destruction, position, visibility and the window tree.

use super::*;

impl Engine {
    /// Space taken by the frame, caption and menu bar: (left, top, right, bottom).
    pub(crate) fn nc_insets(style: u32, ex: u32, menu: bool) -> (i32, i32, i32, i32) {
        let mut b = if style & WS_THICKFRAME != 0 {
            4
        } else if style & WS_DLGFRAME != 0 || ex & WS_EX_DLGMODALFRAME != 0 {
            3
        } else if style & WS_BORDER != 0 {
            1
        } else {
            0
        };
        if style & WS_CHILD != 0 && style & WS_CAPTION == WS_CAPTION && b == 0 {
            b = 3;
        }
        if ex & WS_EX_CLIENTEDGE != 0 {
            b += 2;
        }
        if ex & WS_EX_STATICEDGE != 0 {
            b += 1;
        }
        let mut top = b;
        if style & WS_CAPTION == WS_CAPTION {
            top += 19;
        }
        if menu && style & WS_CHILD == 0 {
            top += 19;
        }
        let (mut r, mut bt) = (b, b);
        if style & WS_VSCROLL != 0 {
            r += 17;
        }
        if style & WS_HSCROLL != 0 {
            bt += 17;
        }
        (b, top, r, bt)
    }

    pub(super) fn client_from(&self, wr: Rect, style: u32, ex: u32, menu: bool) -> Rect {
        let (l, t, r, b) = Engine::nc_insets(style, ex, menu);
        let c = Rect::new(wr.l + l, wr.t + t, wr.r - r, wr.b - b);
        if c.r < c.l || c.b < c.t {
            Rect::new(c.l, c.t, c.l.max(c.r), c.t.max(c.b))
        } else {
            c
        }
    }

    /// Screen origin of a window's client area (for child coordinates).
    pub(super) fn client_origin(&self, h: u64) -> (i32, i32) {
        if h == 0 || full(h) == DESKTOP {
            return (0, 0);
        }
        self.wnd(h).map_or((0, 0), |w| (w.crect.l, w.crect.t))
    }

    pub(crate) fn top_of(&self, mut h: u64) -> u64 {
        h = full(h);
        while let Some(w) = self.wnd(h) {
            if w.parent == 0 || w.style & WS_CHILD == 0 {
                return h;
            }
            h = w.parent;
        }
        h
    }

    pub(crate) fn is_visible(&self, mut h: u64) -> bool {
        loop {
            let Some(w) = self.wnd(h) else { return false };
            if w.style & WS_VISIBLE == 0 {
                return false;
            }
            if w.parent == 0 || w.style & WS_CHILD == 0 {
                return true;
            }
            h = w.parent;
        }
    }

    pub(super) fn create_window(&mut self) -> u64 {
        self.register_builtins();
        let (ex, cls_us, name_us, style) = (self.arg(0) as u32, self.arg(1), self.arg(3), self.arg(4) as u32);
        let (x, y, cx, cy) = (self.arg(5) as i32, self.arg(6) as i32, self.arg(7) as i32, self.arg(8) as i32);
        let (parent, menu, inst, params, ansi) = (self.arg(9), self.arg(10), self.arg(11), self.arg(12), self.arg(16) != 0);
        let (cname, atom) = self.ustr(cls_us);
        let Some(ci) = self.find_class(&cname, atom) else {
            self.set_last_error(1407);
            return 0;
        };
        let (title, _) = self.ustr(name_us);
        let parent = if parent == u64::MAX - 2 { MSG_WINDOW } else { full(parent) }; // HWND_MESSAGE
        let child = style & WS_CHILD != 0;
        let parent = if parent == DESKTOP { 0 } else { parent };
        // position: relative to the parent's client area for children
        let (ox, oy) = if child { self.client_origin(parent) } else { (0, 0) };
        let n = self.s.win.tops.len() as i32;
        let (mut x, mut y, mut cx, mut cy) = (x, y, cx, cy);
        if !child {
            if x == CW_USEDEFAULT {
                x = 40 + 24 * (n % 8);
                y = 30 + 24 * (n % 8);
            }
            if cx == CW_USEDEFAULT {
                cx = 600;
                cy = 420;
            }
        } else {
            if x == CW_USEDEFAULT {
                x = 0;
                y = 0;
            }
            if cx == CW_USEDEFAULT {
                cx = 0;
                cy = 0;
            }
        }
        if y == CW_USEDEFAULT {
            y = 30;
        }
        let wr = Rect::new(ox + x, oy + y, ox + x + cx.max(0), oy + y + cy.max(0));
        let has_menu = !child && menu != 0;
        let crect = self.client_from(wr, style, ex, has_menu);
        let w = &mut self.s.win;
        if w.next_hwnd == 0 {
            w.next_hwnd = 0x10020;
        }
        w.next_hwnd += 2;
        let h = w.next_hwnd;
        let c = &self.s.win.classes[ci];
        let (proc_, extra, unicode, cicon) = (c.proc_, c.wnd_extra, !(c.ansi), c.icon);
        let unicode = if c.builtin { true } else { unicode };
        let tid = self.cur_tid();
        let owner = if !child { parent } else { 0 };
        let parent = if child { parent } else { 0 };
        self.s.win.wins.insert(
            h,
            Wnd {
                class: ci,
                parent,
                owner,
                style: style & !WS_VISIBLE,
                ex_style: ex,
                wrect: wr,
                crect,
                text: title.clone(),
                proc_,
                unicode,
                id: if child { menu } else { 0 },
                inst,
                userdata: 0,
                extra: vec![0; extra],
                tid,
                update: Rect::default(),
                erase: false,
                menu: if has_menu { menu } else { 0 },
                children: vec![],
                dlg_info: 0,
                props: vec![],
                nc_dirty: true,
                icon: cicon,
            },
        );
        if parent != 0 {
            if let Some(p) = self.s.win.wins.get_mut(&parent) {
                p.children.push(h);
            }
        } else {
            self.s.win.tops.push(h);
        }
        self.surface_for(h);
        let _ = ansi;
        // CREATESTRUCTW for WM_NCCREATE / WM_CREATE
        let cs = self.heap_alloc(80, true);
        let tw = self.alloc_w(&title);
        let cw = if atom != 0 { atom as u64 } else { self.alloc_w(&cname) };
        self.w64(cs, params);
        self.w64(cs + 8, inst);
        self.w64(cs + 16, menu);
        self.w64(cs + 24, parent | owner);
        self.w32(cs + 32, cy as u32);
        self.w32(cs + 36, cx as u32);
        self.w32(cs + 40, y as u32);
        self.w32(cs + 44, x as u32);
        self.w32(cs + 48, style);
        self.w64(cs + 56, tw);
        self.w64(cs + 64, cw);
        self.w32(cs + 72, ex);
        let s = self.send(h, WM_NCCREATE, 0, cs, move |e, r| {
            if r == 0 {
                e.destroy_now(h);
                return Step::Ret(0);
            }
            e.send(h, WM_CREATE, 0, cs, move |e, r| {
                if r as i64 == -1 {
                    e.destroy_now(h);
                    return Step::Ret(0);
                }
                let (cw_, ch_) = e.wnd(h).map_or((0, 0), |w| (w.crect.w(), w.crect.h()));
                e.send(h, WM_SIZE, 0, ((ch_ as u64) << 16) | (cw_ as u64 & 0xFFFF), move |e, _| {
                    let (mx, my) = e.wnd(h).map_or((0, 0), |w| {
                        let (ox, oy) = if w.parent != 0 { e.client_origin(w.parent) } else { (0, 0) };
                        (w.crect.l - ox, w.crect.t - oy)
                    });
                    e.send(h, WM_MOVE, 0, (((my as u16) as u64) << 16) | (mx as u16) as u64, move |e, _| {
                        let notify = child && ex & WS_EX_NOPARENTNOTIFY == 0 && parent != 0;
                        let id = e.wnd(h).map_or(0, |w| w.id);
                        let after = move |e: &mut Engine, _| {
                            if style & WS_VISIBLE != 0 {
                                e.show_window(h, 5, Box::new(move |_, _| Step::Ret(h)))
                            } else {
                                Step::Ret(h)
                            }
                        };
                        if notify {
                            e.send(parent, WM_PARENTNOTIFY, (WM_CREATE as u64) | ((id & 0xFFFF) << 16), h, after)
                        } else {
                            after(e, 0)
                        }
                    })
                })
            })
        });
        self.step(s)
    }

    /// Removes a window without messages (failed creation).
    pub(super) fn destroy_now(&mut self, h: u64) {
        let Some(w) = self.s.win.wins.remove(&h) else { return };
        if w.parent != 0 {
            if let Some(p) = self.s.win.wins.get_mut(&w.parent) {
                p.children.retain(|&c| c != h);
            }
        }
        self.s.win.tops.retain(|&t| t != h);
        self.s.win.timers.retain(|t| t.hwnd != h);
        for c in w.children {
            self.destroy_now(c);
        }
        if self.s.win.focus == h {
            self.s.win.focus = 0;
        }
        if self.s.win.active == h {
            self.s.win.active = 0;
        }
        if self.s.win.capture == h {
            self.s.win.capture = 0;
        }
        self.drop_surface(h);
        self.s.win.dirty = true;
    }

    /// DestroyWindow: WM_DESTROY to the window and its children, then WM_NCDESTROY.
    pub(super) fn destroy_window(&mut self, h: u64, then: Cont) -> Step {
        let h = full(h);
        if self.wnd(h).is_none() {
            return then(self, 0);
        }
        // hide first
        if let Some(w) = self.wnd_mut(h) {
            w.style &= !WS_VISIBLE;
        }
        self.s.win.dirty = true;
        let mut list = vec![h];
        let mut i = 0;
        while i < list.len() {
            let c = self.wnd(list[i]).map_or(vec![], |w| w.children.clone());
            list.extend(c);
            i += 1;
        }
        // owned popups go too
        let owned: Vec<u64> = self.s.win.wins.iter().filter(|(_, w)| w.owner == h).map(|(&k, _)| k).collect();
        fn chain(e: &mut Engine, list: Vec<u64>, k: usize, msg: u32, then: Cont) -> Step {
            if k >= list.len() {
                return then(e, 1);
            }
            let hw = list[k];
            e.send(hw, msg, 0, 0, move |e, _| chain(e, list, k + 1, msg, then))
        }
        let l2 = list.clone();
        let parent = self.wnd(h).map_or(0, |w| w.parent);
        let s = chain(
            self,
            list,
            0,
            WM_DESTROY,
            Box::new(move |e, _| {
                let mut rev = l2.clone();
                rev.reverse();
                chain(
                    e,
                    rev,
                    0,
                    WM_NCDESTROY,
                    Box::new(move |e, _| {
                        e.destroy_now(h);
                        if parent == 0 && e.s.win.active == 0 {
                            if let Some(&t) = e.s.win.tops.iter().rev().find(|&&t| e.is_visible(t)) {
                                e.s.win.active = t;
                                e.s.win.focus = t;
                            }
                        }
                        then(e, 1)
                    }),
                )
            }),
        );
        // owned windows are destroyed first in Windows; keep it simple: after
        let _ = owned;
        s
    }

    pub(super) fn invalidate(&mut self, h: u64, r: Option<Rect>, erase: bool) {
        let h = full(h);
        let Some(w) = self.wnd_mut(h) else { return };
        let all = Rect::new(0, 0, w.crect.w(), w.crect.h());
        let r = r.map_or(all, |r| r.inter(&all));
        if !r.empty() {
            w.update = w.update.union(&r);
        }
        w.erase |= erase;
        let kids = w.children.clone();
        if r == all {
            for c in kids {
                self.invalidate(c, None, erase);
            }
        }
        self.s.win.dirty = true;
    }

    pub(super) fn show_window(&mut self, h: u64, cmd: u32, then: Cont) -> Step {
        let h = full(h);
        let Some(w) = self.wnd(h) else { return then(self, 0) };
        let was = w.style & WS_VISIBLE != 0;
        let show = cmd != 0;
        if show == was {
            if show && cmd != 8 && cmd != 4 {
                self.activate(h);
            }
            return then(self, was as u64);
        }
        if let Some(w) = self.wnd_mut(h) {
            if show {
                w.style |= WS_VISIBLE;
            } else {
                w.style &= !WS_VISIBLE;
            }
            w.nc_dirty = true;
        }
        self.s.win.dirty = true;
        if show {
            self.invalidate(h, None, true);
        }
        let top = self.wnd(h).map_or(false, |w| w.style & WS_CHILD == 0);
        self.send(h, WM_SHOWWINDOW, show as u64, 0, move |e, _| {
            if show && top && cmd != 4 && cmd != 8 {
                e.activate(h);
            }
            if !show && e.s.win.active == h {
                e.s.win.active = 0;
                if let Some(&t) = e.s.win.tops.iter().rev().find(|&&t| t != h && e.is_visible(t)) {
                    e.activate(t);
                }
            }
            then(e, was as u64)
        })
    }

    pub(super) fn activate(&mut self, h: u64) {
        let h = self.top_of(h);
        if self.s.win.active == h {
            return;
        }
        let old = self.s.win.active;
        self.s.win.active = h;
        if let Some(w) = self.wnd_mut(old) {
            w.nc_dirty = true;
        }
        if let Some(w) = self.wnd_mut(h) {
            w.nc_dirty = true;
        }
        // bring to front
        self.s.win.tops.retain(|&t| t != h);
        self.s.win.tops.push(h);
        if self.s.win.focus == 0 || self.top_of(self.s.win.focus) != h {
            self.s.win.focus = h;
        }
        // let the program know (posted: WM_ACTIVATE and focus)
        let _ = (WM_ACTIVATE, WM_NCACTIVATE);
        self.post(h, WM_ACTIVATE, 1, old);
        self.post(h, WM_SETFOCUS, old, 0);
        self.s.win.dirty = true;
    }

    /// Moves/resizes: SetWindowPos core (coordinates relative to the parent client area).
    pub(super) fn win_set_pos(&mut self, h: u64, after: u64, x: i32, y: i32, cx: i32, cy: i32, flags: u32, then: Cont) -> Step {
        let h = full(h);
        let Some(w) = self.wnd(h) else { return then(self, 0) };
        let (ox, oy) = if w.style & WS_CHILD != 0 { self.client_origin(w.parent) } else { (0, 0) };
        let old_w = w.wrect;
        let old_c = w.crect;
        let mut nr = old_w;
        if flags & 2 == 0 {
            nr = Rect::new(ox + x, oy + y, ox + x + nr.w(), oy + y + nr.h());
        }
        if flags & 1 == 0 {
            nr.r = nr.l + cx.max(0);
            nr.b = nr.t + cy.max(0);
        }
        let (style, ex, menu) = (w.style, w.ex_style, w.menu != 0);
        let cr = self.client_from(nr, style, ex, menu);
        let (dx, dy) = (cr.l - old_c.l, cr.t - old_c.t);
        if let Some(w) = self.wnd_mut(h) {
            w.wrect = nr;
            w.crect = cr;
            w.nc_dirty = true;
        }
        if dx != 0 || dy != 0 {
            self.move_children(h, dx, dy);
        }
        if nr.w() != old_w.w() || nr.h() != old_w.h() {
            self.surface_for(self.top_of(h));
        }
        let _ = after;
        if flags & 4 == 0 && after == 0 {
            if let Some(p) = self.wnd(h).map(|w| w.parent) {
                if p == 0 {
                    self.s.win.tops.retain(|&t| t != h);
                    self.s.win.tops.push(h);
                }
            }
        }
        self.s.win.dirty = true;
        let sized = cr.w() != old_c.w() || cr.h() != old_c.h();
        let moved = dx != 0 || dy != 0;
        if flags & 8 == 0 && (sized || moved || flags & 0x20 != 0) {
            self.invalidate(h, None, true);
            if let Some(p) = self.wnd(h).map(|w| w.parent) {
                if p != 0 {
                    self.invalidate(p, None, true);
                }
            }
        }
        let show = flags & 0x40 != 0;
        let hide = flags & 0x80 != 0;
        let step_size = move |e: &mut Engine, then: Cont| -> Step {
            if sized {
                let (cw, ch) = (cr.w(), cr.h());
                e.send(h, WM_SIZE, 0, ((ch as u64 & 0xFFFF) << 16) | (cw as u64 & 0xFFFF), move |e, _| then(e, 1))
            } else {
                then(e, 1)
            }
        };
        let s = move |e: &mut Engine, _| -> Step {
            step_size(
                e,
                Box::new(move |e, _| {
                    if moved {
                        let (mx, my) = (cr.l - ox, cr.t - oy);
                        e.send(h, WM_MOVE, 0, (((my as u16) as u64) << 16) | (mx as u16) as u64, move |e, _| {
                            if show {
                                e.show_window(h, 5, then)
                            } else if hide {
                                e.show_window(h, 0, then)
                            } else {
                                then(e, 1)
                            }
                        })
                    } else if show {
                        e.show_window(h, 5, then)
                    } else if hide {
                        e.show_window(h, 0, then)
                    } else {
                        then(e, 1)
                    }
                }),
            )
        };
        s(self, 0)
    }

    pub(super) fn move_children(&mut self, h: u64, dx: i32, dy: i32) {
        let kids = self.wnd(h).map_or(vec![], |w| w.children.clone());
        for c in kids {
            if let Some(w) = self.wnd_mut(c) {
                w.wrect = w.wrect.off(dx, dy);
                w.crect = w.crect.off(dx, dy);
            }
            self.move_children(c, dx, dy);
        }
    }
}
