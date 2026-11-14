// Message queues, timers and the default window procedure.

use super::*;

impl Engine {
    pub(crate) fn post(&mut self, hwnd: u64, msg: u32, wp: u64, lp: u64) -> bool {
        let tid = if hwnd == 0 {
            self.cur_tid()
        } else {
            match self.wnd(hwnd) {
                Some(w) => w.tid,
                None => return false,
            }
        };
        let (x, y) = self.s.win.mouse;
        let m = Msg { hwnd: full(hwnd), msg, wp, lp, time: now_ms() as u32, x, y };
        self.s.win.queues.entry(tid).or_default().posted.push_back(m);
        true
    }

    pub(super) fn filter_ok(&self, m: &Msg, hwnd: u64, first: u32, last: u32) -> bool {
        let hwnd = full(hwnd);
        let wok = hwnd == 0 || m.hwnd == hwnd || (hwnd != u64::MAX && self.is_child_of(m.hwnd, hwnd)) || (hwnd == u64::MAX && m.hwnd == 0);
        let mok = (first == 0 && last == 0) || (m.msg >= first && m.msg <= last);
        wok && mok
    }

    pub(super) fn is_child_of(&self, mut h: u64, p: u64) -> bool {
        while let Some(w) = self.wnd(h) {
            if w.parent == 0 {
                return false;
            }
            if w.parent == p {
                return true;
            }
            h = w.parent;
        }
        false
    }

    /// Next message for this thread (PeekMessage core). Writes the MSG.
    pub(crate) fn peek(&mut self, out: u64, hwnd: u64, first: u32, last: u32, remove: bool) -> Option<bool> {
        let tid = self.cur_tid();
        self.peek_tid(tid, out, hwnd, first, last, remove)
    }

    /// Whether the thread has anything for GetMessage (posted, input, quit, paint, due timer).
    pub(crate) fn has_msgs(&mut self, tid: u32) -> bool {
        self.s.win.queues.get(&tid).map_or(false, |q| !q.posted.is_empty() || !q.input.is_empty() || q.quit.is_some())
            || self.paint_due(tid)
            || self.next_timer(tid) <= now_ms()
    }
    /// A shown window of this thread waits for WM_PAINT (a hidden one gets it once shown,
    /// as peek_tid does: counting it would make a message wait return with nothing to read).
    pub(crate) fn paint_due(&self, tid: u32) -> bool {
        self.s.win.wins.iter().any(|(&h, w)| w.tid == tid && !w.update.empty() && self.is_visible(h))
    }

    pub(crate) fn peek_tid(&mut self, tid: u32, out: u64, hwnd: u64, first: u32, last: u32, remove: bool) -> Option<bool> {
        self.pump_popup_close();
        let q = self.s.win.queues.entry(tid).or_default();
        let _ = q;
        // posted, then input
        for kind in 0..2 {
            let n = {
                let q = &self.s.win.queues[&tid];
                if kind == 0 {
                    q.posted.len()
                } else {
                    q.input.len()
                }
            };
            for i in 0..n {
                let m = {
                    let q = &self.s.win.queues[&tid];
                    if kind == 0 {
                        q.posted[i]
                    } else {
                        q.input[i]
                    }
                };
                if self.filter_ok(&m, hwnd, first, last) {
                    if remove {
                        let q = self.s.win.queues.get_mut(&tid).unwrap();
                        if kind == 0 {
                            q.posted.remove(i);
                        } else {
                            q.input.remove(i);
                        }
                    }
                    self.write_msg(out, &m);
                    return Some(m.msg != WM_QUIT);
                }
            }
        }
        // quit
        if let Some(code) = self.s.win.queues[&tid].quit {
            if remove {
                self.s.win.queues.get_mut(&tid).unwrap().quit = None;
            }
            let m = Msg { hwnd: 0, msg: WM_QUIT, wp: code as u64, lp: 0, time: now_ms() as u32, x: 0, y: 0 };
            self.write_msg(out, &m);
            return Some(false);
        }
        // paint
        if first == 0 && last == 0 || (WM_PAINT >= first && WM_PAINT <= last) {
            let mut cands: Vec<u64> = self.s.win.wins.iter().filter(|(_, w)| w.tid == tid && !w.update.empty()).map(|(&k, _)| k).collect();
            cands.sort();
            for h in cands {
                if !self.is_visible(h) {
                    continue;
                }
                let m = Msg { hwnd: h, msg: WM_PAINT, wp: 0, lp: 0, time: now_ms() as u32, x: 0, y: 0 };
                if self.filter_ok(&m, hwnd, first, last) {
                    self.write_msg(out, &m);
                    return Some(true);
                }
            }
        }
        // timers
        let t = now_ms();
        for i in 0..self.s.win.timers.len() {
            let tm = &self.s.win.timers[i];
            if tm.tid != tid || tm.next > t {
                continue;
            }
            let m = Msg { hwnd: tm.hwnd, msg: WM_TIMER, wp: tm.id, lp: tm.proc_, time: t as u32, x: 0, y: 0 };
            if !self.filter_ok(&m, hwnd, first, last) {
                continue;
            }
            if remove {
                let tm = &mut self.s.win.timers[i];
                tm.next = t + tm.period;
            }
            self.write_msg(out, &m);
            return Some(true);
        }
        None
    }

    pub(super) fn write_msg(&mut self, out: u64, m: &Msg) {
        self.w64(out, m.hwnd);
        self.w32(out + 8, m.msg);
        self.w64(out + 16, m.wp);
        self.w64(out + 24, m.lp);
        self.w32(out + 32, m.time);
        self.w32(out + 36, m.x as u32);
        self.w32(out + 40, m.y as u32);
    }

    /// When the next timer of this thread is due (ms, host clock).
    pub(crate) fn next_timer(&self, tid: u32) -> f64 {
        self.s.win.timers.iter().filter(|t| t.tid == tid).map(|t| t.next).fold(f64::INFINITY, f64::min)
    }

    // ---------- default window procedure ----------

    pub(super) fn def_proc(&mut self, h: u64, msg: u32, wp: u64, lp: u64, ansi: bool) -> Step {
        let h = full(h);
        match msg {
            WM_NCCREATE => {
                // the title came with CREATESTRUCT
                Step::Ret(1)
            }
            WM_SETTEXT => {
                let t = if lp == 0 {
                    String::new()
                } else if ansi {
                    self.read_cstr(lp, 4096)
                } else {
                    self.read_wstr(lp, 4096)
                };
                if let Some(w) = self.wnd_mut(h) {
                    w.text = t;
                    w.nc_dirty = true;
                }
                self.s.win.dirty = true;
                Step::Ret(1)
            }
            WM_GETTEXT => {
                let t = self.wnd(h).map_or(String::new(), |w| w.text.clone());
                if wp == 0 {
                    return Step::Ret(0);
                }
                let n = if ansi {
                    let b = t.as_bytes();
                    let k = b.len().min(wp as usize - 1);
                    let _ = self.mmu.write_bytes(lp, &b[..k]);
                    self.w8(lp + k as u64, 0);
                    k
                } else {
                    self.put_w(lp, &t, wp as usize)
                };
                Step::Ret(n as u64)
            }
            WM_GETTEXTLENGTH => Step::Ret(self.wnd(h).map_or(0, |w| if ansi { w.text.len() } else { w.text.encode_utf16().count() }) as u64),
            WM_PAINT => {
                if let Some(w) = self.wnd_mut(h) {
                    w.update = Rect::default();
                    w.erase = false;
                }
                Step::Ret(0)
            }
            WM_ERASEBKGND => {
                let hdc = wp;
                let brush = self.wnd(h).map_or(0, |w| self.s.win.classes[w.class].brush);
                if brush == 0 {
                    return Step::Ret(0);
                }
                let (cw, ch) = self.wnd(h).map_or((0, 0), |w| (w.crect.w(), w.crect.h()));
                self.fill_rect_brush(hdc, Rect::new(0, 0, cw, ch), brush);
                Step::Ret(1)
            }
            WM_CLOSE => self.destroy_window(h, Box::new(|_, _| Step::Ret(0))),
            WM_SYSCOMMAND => {
                if wp & 0xFFF0 == 0xF060 {
                    self.post(h, WM_CLOSE, 0, 0);
                }
                Step::Ret(0)
            }
            WM_NCHITTEST => {
                let (x, y) = (lp as i16 as i32, (lp >> 16) as i16 as i32);
                Step::Ret(self.hit_test(h, x, y) as u64)
            }
            WM_SETCURSOR | WM_GETMINMAXINFO | WM_NCACTIVATE => Step::Ret(if msg == WM_NCACTIVATE { 1 } else { 0 }),
            WM_KEYDOWN | WM_KEYUP | WM_CHAR => Step::Ret(0),
            WM_SYSKEYDOWN => {
                if wp == 0x73 && self.s.win.keys[0x12] & 0x80 != 0 {
                    self.post(h, WM_CLOSE, 0, 0);
                }
                Step::Ret(0)
            }
            _ => Step::Ret(0),
        }
    }

    /// HT* code for a screen point in a window.
    pub(super) fn hit_test(&self, h: u64, x: i32, y: i32) -> u32 {
        let Some(w) = self.wnd(h) else { return 0 };
        if !w.wrect.has(x, y) {
            return 0;
        }
        if w.crect.has(x, y) {
            return 1;
        } // HTCLIENT
        if w.style & WS_CAPTION == WS_CAPTION {
            let (l, _, r, _) = Engine::nc_insets(w.style, w.ex_style, false);
            let top = w.wrect.t + if w.style & WS_THICKFRAME != 0 { 4 } else { 3 };
            if y >= top && y < top + 18 && x >= w.wrect.l + l && x < w.wrect.r - r {
                if w.style & WS_SYSMENU != 0 && x >= w.wrect.r - r - 18 {
                    return 20;
                } // HTCLOSE
                return 2; // HTCAPTION
            }
            if w.menu != 0 && y >= top + 19 && y < top + 38 {
                return 5;
            } // HTMENU
        }
        18 // HTBORDER
    }
}
