// Menus and popup menus.

use super::*;

impl Engine {
    pub(super) fn new_menu(&mut self, popup: bool) -> u64 {
        let w = &mut self.s.win;
        if w.next_menu == 0 {
            w.next_menu = 0x30000;
        }
        w.next_menu += 4;
        let h = w.next_menu;
        w.menus.insert(h, Menu { style: if popup { 1 } else { 0 }, ..Default::default() });
        h
    }

    /// MENUITEMINFOW in/out (NtUserThunkedMenuItemInfo).
    pub(super) fn menu_item_info(&mut self, menu: u64, pos: u32, by_pos: bool, method: u32, info: u64, text_us: u64) -> u64 {
        let find = |m: &Menu, pos: u32, by_pos: bool| -> Option<usize> {
            if by_pos {
                if (pos as usize) < m.items.len() {
                    Some(pos as usize)
                } else {
                    None
                }
            } else {
                m.items.iter().position(|i| i.id as u32 == pos)
            }
        };
        // Wine's codes: 0 set, 1 insert, 2 check radio, 3 default item, 4 item id, 5/6 info A/W, 7 state, 8 submenu
        match method {
            2 => return 1,
            3 => return u32::MAX as u64,
            4 | 7 | 8 => {
                let Some(m) = self.s.win.menus.get(&menu) else { return if method == 8 { 0 } else { u32::MAX as u64 } };
                let Some(i) = find(m, pos, by_pos) else { return if method == 8 { 0 } else { u32::MAX as u64 } };
                let it = &m.items[i];
                return match method {
                    4 => {
                        if it.sub != 0 {
                            u32::MAX as u64
                        } else {
                            it.id
                        }
                    }
                    8 => it.sub,
                    _ => {
                        if it.sub != 0 {
                            let n = self.s.win.menus.get(&it.sub).map_or(0, |s| s.items.len());
                            ((n as u64) << 8) | 0x10 | (it.state | it.flags) as u64 & 0xFF
                        } else {
                            (it.state | it.flags) as u64
                        }
                    }
                };
            }
            _ => {}
        }
        let mask = self.ur32(info + 4);
        let method = match method {
            0 => 1,
            1 => 0,
            _ => 2,
        };
        match method {
            0 | 1 => {
                // insert (0) or set (1)
                let ftype = self.ur32(info + 8);
                let state = self.ur32(info + 12);
                let id = self.ur32(info + 16) as u64;
                let sub = self.r64(info + 24);
                let data = self.r64(info + 48);
                let bmp = self.r64(info + 72);
                let text = if text_us != 0 {
                    self.ustr(text_us).0
                } else if mask & 0x50 != 0 && ftype & 0x800 == 0 {
                    let p = self.r64(info + 56);
                    if p > 0xFFFF {
                        self.read_wstr(p, 1024)
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                };
                let Some(m) = self.s.win.menus.get_mut(&menu) else { return 0 };
                if method == 0 {
                    let at = if by_pos {
                        (pos as usize).min(m.items.len())
                    } else {
                        m.items.iter().position(|i| i.id as u32 == pos).unwrap_or(m.items.len())
                    };
                    m.items.insert(at, MenuItem { id, text, flags: ftype, state, sub, data, bmp });
                } else {
                    let Some(i) = find(m, pos, by_pos) else { return 0 };
                    let it = &mut m.items[i];
                    if mask & 0x100 != 0 || mask & 0x40 != 0 {
                        it.text = text;
                    }
                    if mask & 0x10 != 0 {
                        it.flags = ftype;
                    }
                    if mask & 0x1 != 0 {
                        it.state = state;
                    }
                    if mask & 0x2 != 0 {
                        it.id = id;
                    }
                    if mask & 0x4 != 0 {
                        it.sub = sub;
                    }
                    if mask & 0x20 != 0 {
                        it.data = data;
                    }
                    if mask & 0x80 != 0 {
                        it.bmp = bmp;
                    }
                }
                self.s.win.dirty = true;
                1
            }
            _ => {
                // get (2)
                let Some(m) = self.s.win.menus.get(&menu) else { return 0 };
                let Some(i) = find(m, pos, by_pos) else { return 0 };
                let (id, text, flags, state, sub, data) = {
                    let it = &m.items[i];
                    (it.id, it.text.clone(), it.flags, it.state, it.sub, it.data)
                };
                if mask & 0x10 != 0 || mask & 0x100 != 0 {
                    self.w32(info + 8, flags);
                }
                if mask & 0x1 != 0 {
                    self.w32(info + 12, state);
                }
                if mask & 0x2 != 0 {
                    self.w32(info + 16, id as u32);
                }
                if mask & 0x4 != 0 {
                    self.w64(info + 24, sub);
                }
                if mask & 0x20 != 0 {
                    self.w64(info + 48, data);
                }
                if mask & 0x40 != 0 || mask & 0x10 != 0 {
                    let p = self.r64(info + 56);
                    let n = self.ur32(info + 64);
                    if p != 0 && n > 0 {
                        let k = self.put_w(p, &text, n as usize);
                        self.w32(info + 64, k as u32);
                    } else {
                        self.w32(info + 64, text.encode_utf16().count() as u32);
                    }
                }
                1
            }
        }
    }

    /// Menu bar items laid out: (x from window left, width).
    pub(crate) fn menu_bar_layout(&mut self, menu: u64) -> Vec<(i32, i32)> {
        let items: Vec<String> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| i.text.replace('&', "")).collect());
        let mut x = 0;
        items
            .iter()
            .map(|t| {
                let w = crate::wingdi::text_width(0, t) + 16;
                let r = (x, w);
                x += w;
                r
            })
            .collect()
    }

    pub(super) fn open_menu_bar(&mut self, top: u64, x: i32, _y: i32) {
        let Some(w) = self.wnd(top) else { return };
        let (menu, wl, l, t) =
            (w.menu, w.wrect.l, Engine::nc_insets(w.style, w.ex_style, false).0, w.wrect.t + Engine::nc_insets(w.style, w.ex_style, false).1);
        let lay = self.menu_bar_layout(menu);
        for (i, (mx, mw)) in lay.iter().enumerate() {
            let sx = wl + l + mx;
            if x >= sx && x < sx + mw {
                let sub = self.s.win.menus[&menu].items[i].sub;
                if sub == 0 {
                    let id = self.s.win.menus[&menu].items[i].id;
                    self.post(top, WM_COMMAND, id & 0xFFFF, 0);
                    return;
                }
                self.post(top, WM_INITMENU, menu, 0);
                self.post(top, WM_INITMENUPOPUP, sub, i as u64);
                self.s.win.popup = Some(Popup { menu: sub, hwnd: top, x: sx, y: t + 19, w: 0, h: 0, hot: -1 });
                self.layout_popup();
                return;
            }
        }
    }

    pub(crate) fn layout_popup(&mut self) {
        let Some(p) = &self.s.win.popup else { return };
        let menu = p.menu;
        let items: Vec<(String, u32)> =
            self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| (i.text.replace('&', ""), i.flags)).collect());
        let mut w = 60;
        let mut h = 4;
        for (t, f) in &items {
            let t = t.split('\t').collect::<Vec<_>>();
            let tw = crate::wingdi::text_width(0, t[0]) + t.get(1).map_or(0, |s| crate::wingdi::text_width(0, s) + 24);
            w = w.max(tw + 40);
            h += if f & 0x800 != 0 { 8 } else { 18 };
        }
        let p = self.s.win.popup.as_mut().unwrap();
        p.w = w;
        p.h = h + 2;
    }

    pub(super) fn popup_mouse(&mut self, kind: u32, x: i32, y: i32) -> bool {
        let Some(p) = &self.s.win.popup else { return false };
        let (px, py, pw, ph, menu, hwnd) = (p.x, p.y, p.w, p.h, p.menu, p.hwnd);
        let inside = x >= px && x < px + pw && y >= py && y < py + ph;
        let mut hot = -1;
        if inside {
            let mut yy = py + 3;
            let items: Vec<u32> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| i.flags).collect());
            for (i, f) in items.iter().enumerate() {
                let hh = if f & 0x800 != 0 { 8 } else { 18 };
                if y >= yy && y < yy + hh && f & 0x800 == 0 {
                    hot = i as i32;
                }
                yy += hh;
            }
        }
        if let Some(p) = self.s.win.popup.as_mut() {
            p.hot = hot;
        }
        if kind == 3 && inside && hot >= 0 {
            let it = &self.s.win.menus[&menu].items[hot as usize];
            let (id, st) = (it.id, it.state);
            if st & 3 == 0 {
                self.s.win.popup = None;
                self.post(hwnd, WM_COMMAND, id & 0xFFFF, 0);
            }
            return true;
        }
        if kind == 2 && !inside {
            self.s.win.popup = None;
            // a click on the menu bar again just closes it
            return true;
        }
        true
    }
    pub(super) fn pump_popup_close(&mut self) {}
}
