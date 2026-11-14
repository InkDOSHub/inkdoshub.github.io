// The NtUser* system calls Wine's user32 makes, answered from the pieces in this folder.

use super::*;

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let ar: [u64; 14] = std::array::from_fn(|i| e.arg(i));
    if name.starts_with("NtGdi") {
        return crate::wingdi::call(e, name);
    }
    let a0 = ar[0];
    let r = match name {
        "NtUserInitializeClientPfnArrays" => {
            let (pa, pw) = (a0, ar[1]);
            let mut va = vec![];
            let mut vw = vec![];
            for i in 0..19u64 {
                va.push(e.r64(pa + 8 * i));
                vw.push(e.r64(pw + 8 * i));
            }
            e.s.win.procs_a = va;
            e.s.win.procs_w = vw;
            0
        }
        "NtUserGetSystemDpiForProcess" | "NtUserGetDpiForMonitor" => 96,
        "NtUserCallNoParam" => match a0 as u32 {
            0 => DESKTOP,
            1 => (16 << 16) | 6,
            2 => now_ms() as u64,
            _ => 0,
        },
        "NtUserCallOneParam" => {
            let (arg, code) = (a0, ar[1] as u32);
            match code {
                0 => e.new_cursor(),
                4 => e.s.win.menus.get(&arg).map_or(u32::MAX as u64, |m| m.items.len() as u64),
                5 => {
                    let p = arg;
                    e.wr_rect(p, Rect::new(0, 0, SCREEN_W, SCREEN_H));
                    1
                }
                6 => Engine::sys_color(arg as u32) as u64,
                7 => e.sys_brush(arg as u32),
                8 => e.sys_pen(arg as u32),
                9 => e.sys_metric(arg as u32) as u32 as u64,
                10 => {
                    e.wr_rect(arg, Rect::new(0, 0, SCREEN_W, SCREEN_H));
                    1
                }
                12 => 0x12,
                14 => {
                    for i in 0..256u64 {
                        let v = e.s.win.keys[i as usize];
                        e.w8(arg + i, v);
                    }
                    1
                }
                _ => 0,
            }
        }
        "NtUserCallTwoParam" => {
            let (a1, a2, code) = (a0, ar[1], ar[2] as u32);
            match code {
                2 => {
                    // GetMonitorInfo
                    let r = Rect::new(0, 0, SCREEN_W, SCREEN_H);
                    e.wr_rect(a2 + 4, r);
                    e.wr_rect(a2 + 20, Rect::new(0, 0, SCREEN_W, SCREEN_H - 30));
                    e.w32(a2 + 36, 1);
                    if e.ur32(a2) >= 104 {
                        e.put_w(a2 + 40, "\\\\.\\DISPLAY1", 32);
                    }
                    1
                }
                3 => e.sys_metric(a1 as u32) as u32 as u64,
                4 => 0x10001, // MonitorFromRect: the one monitor
                7 => {
                    // AdjustWindowRect(rect, params{style, ex_style, menu, dpi})
                    let r = e.rd_rect(a1);
                    let (style, ex, menu) = (e.ur32(a2), e.ur32(a2 + 4), e.ur32(a2 + 8));
                    let (l, t, rr, b) = Engine::nc_insets(style, ex, menu != 0);
                    e.wr_rect(a1, Rect::new(r.l - l, r.t - t, r.r + rr, r.b + b));
                    1
                }
                8 => {
                    e.wr_rect(a1, Rect::new(0, 0, SCREEN_W, SCREEN_H));
                    1
                }
                1 => {
                    // GetMenuInfo
                    let Some(m) = e.s.win.menus.get(&a1) else { return Some(0) };
                    let (st, mh, br, help, data) = (m.style, m.max_h, m.brush, m.help, m.data);
                    e.w32(a2 + 8, st);
                    e.w32(a2 + 12, mh);
                    e.w64(a2 + 16, br);
                    e.w32(a2 + 24, help);
                    e.w64(a2 + 32, data);
                    1
                }
                9 => a1, // AllocWinProc: the procedure itself
                0 => a1,
                _ => 0,
            }
        }
        "NtUserCallHwnd" => {
            let (h, code) = (full(a0), ar[1] as u32);
            match code {
                1 => e.wnd(h).map_or(0, |w| w.dlg_info),
                2 => 96,
                3 => h,
                5 => e.wnd(h).map_or(0, |w| if w.style & WS_CHILD != 0 { w.parent } else { w.owner }),
                6 => 0x12,
                9 => e.wnd(h).map_or(0, |w| w.text.encode_utf16().count() as u64),
                10 => (e.wnd(h).is_some() || h == DESKTOP) as u64,
                11 => e.wnd(h).map_or(0, |w| (w.style & WS_DISABLED == 0) as u64),
                12 => e.wnd(h).map_or(0, |w| w.unicode as u64),
                13 => e.is_visible(h) as u64,
                14 => {
                    e.activate(h);
                    1
                }
                15 => h,
                16 => {
                    if e.wnd(h).is_some() || h == DESKTOP {
                        h
                    } else {
                        0
                    }
                }
                17 => {
                    let tid = e.cur_tid();
                    if e.wnd(h).map_or(false, |w| w.tid == tid) {
                        h
                    } else {
                        0
                    }
                }
                _ => 0,
            }
        }
        "NtUserCallHwndParam" => {
            let (h, p, code) = (full(a0), ar[1], ar[2] as u32);
            e.hwnd_param(h, p, code)
        }
        "NtUserRegisterClassExWOW" => {
            let (wc, name_us, menu_name, fnid, flags) = (a0, ar[1], ar[3], ar[4], ar[5]);
            let _ = fnid;
            let (name, atom) = e.ustr(name_us);
            if e.find_class(&name, atom).is_some() {
                e.set_last_error(1410);
                return Some(0);
            }
            let style = e.ur32(wc + 4);
            let proc_ = e.r64(wc + 8);
            let ce = e.ur32(wc + 16);
            let we = e.ur32(wc + 20);
            let inst = e.r64(wc + 24);
            let icon = e.r64(wc + 32);
            let cursor = e.r64(wc + 40);
            let brush = e.r64(wc + 48);
            let icon_sm = e.r64(wc + 72);
            let (mn, mna) = if menu_name != 0 { (e.r64(menu_name + 8), e.r64(menu_name)) } else { (0, 0) };
            let name = if name.is_empty() { format!("#{}", atom) } else { name };
            e.add_class(Class {
                atom: 0,
                name: name.to_lowercase(),
                style,
                proc_,
                proc_a: proc_,
                proc_w: proc_,
                ansi: flags != 0,
                cls_extra: vec![0; ce as usize],
                wnd_extra: we as usize,
                inst,
                icon,
                icon_sm,
                cursor,
                brush,
                menu_name: mn,
                menu_name_a: mna,
                builtin: false,
            }) as u64
        }
        "NtUserGetClassInfoEx" => {
            // (instance, name, WNDCLASSEXW*, menu name**, ansi)
            e.register_builtins();
            let (name, atom) = e.ustr(ar[1]);
            let out = ar[2];
            match e.find_class(&name, atom) {
                Some(i) => {
                    let c = &e.s.win.classes[i];
                    let v = (
                        c.style,
                        c.proc_,
                        c.cls_extra.len(),
                        c.wnd_extra,
                        c.inst,
                        c.icon,
                        c.cursor,
                        c.brush,
                        c.icon_sm,
                        c.atom,
                        c.menu_name,
                        c.menu_name_a,
                    );
                    e.w32(out + 4, v.0);
                    e.w64(out + 8, v.1);
                    e.w32(out + 16, v.2 as u32);
                    e.w32(out + 20, v.3 as u32);
                    e.w64(out + 24, v.4);
                    e.w64(out + 32, v.5);
                    e.w64(out + 40, v.6);
                    e.w64(out + 48, v.7);
                    e.w64(out + 72, v.8);
                    e.w64(out + 56, v.10);
                    let mp = ar[3];
                    if mp != 0 {
                        e.w64(mp, v.11);
                        e.w64(mp + 8, v.10);
                    }
                    v.9 as u64
                }
                None => {
                    e.set_last_error(1411);
                    0
                }
            }
        }
        "NtUserUnregisterClass" => {
            // (name, instance, client_menu_name*): user32 frees the menu names it gets back, so they must be the class's own
            let (cn, atom) = e.ustr(a0);
            let menu = ar[2];
            let Some(i) = e.find_class(&cn, atom).filter(|&i| !e.s.win.classes[i].builtin) else {
                if menu != 0 {
                    for k in 0..3 {
                        e.w64(menu + 8 * k, 0);
                    }
                }
                e.set_last_error(1411);
                return Some(0); // ERROR_CLASS_DOES_NOT_EXIST
            };
            let (mn, mna) = (e.s.win.classes[i].menu_name, e.s.win.classes[i].menu_name_a);
            if menu != 0 {
                e.w64(menu, mna);
                e.w64(menu + 8, mn);
                e.w64(menu + 16, 0);
            }
            // the slot stays (windows index classes) but can no longer be found
            let c = &mut e.s.win.classes[i];
            c.name.clear();
            c.atom = 0;
            c.menu_name = 0;
            c.menu_name_a = 0;
            1
        }
        "NtUserGetClassName" => {
            let (h, us) = (full(a0), ar[2]);
            let n = e.wnd(h).map(|w| e.s.win.classes[w.class].name.clone()).unwrap_or_default();
            let n = match n.as_str() {
                "button" => "Button".into(),
                "static" => "Static".into(),
                "edit" => "Edit".into(),
                "listbox" => "ListBox".into(),
                "combobox" => "ComboBox".into(),
                "scrollbar" => "ScrollBar".into(),
                _ => n,
            };
            let buf = e.r64(us + 8);
            let max = e.r16(us + 2) as usize / 2;
            e.put_w(buf, &n, max) as u64
        }
        "NtUserCreateWindowEx" => return Some(e.create_window()),
        "NtUserDestroyWindow" => {
            let s = e.destroy_window(a0, Box::new(|_, r| Step::Ret(r)));
            return Some(e.step(s));
        }
        "NtUserShowWindow" | "NtUserShowWindowAsync" => {
            let cmd = ar[1] as u32;
            let s = e.show_window(a0, cmd, Box::new(|_, r| Step::Ret(r)));
            return Some(e.step(s));
        }
        "NtUserSetWindowPos" => {
            let (after, x, y, cx, cy, fl) = (ar[1], ar[2] as i32, ar[3] as i32, ar[4] as i32, ar[5] as i32, ar[6] as u32);
            let s = e.win_set_pos(a0, after, x, y, cx, cy, fl, Box::new(|_, r| Step::Ret(r)));
            return Some(e.step(s));
        }
        "NtUserMoveWindow" => {
            let (x, y, cx, cy, rep) = (ar[1] as i32, ar[2] as i32, ar[3] as i32, ar[4] as i32, ar[5]);
            let s = e.win_set_pos(a0, 0, x, y, cx, cy, 4 | 0x10 | if rep == 0 { 8 } else { 0 }, Box::new(|_, r| Step::Ret(r)));
            return Some(e.step(s));
        }
        "NtUserSetWindowLong" | "NtUserSetWindowLongPtr" => {
            let (off, v) = (ar[1] as i32, ar[2]);
            let r = e.set_long(full(a0), off, v, name == "NtUserSetWindowLongPtr");
            // a new window procedure takes the caller's character set (SetWindowLongPtrA vs W)
            if off == -4 {
                let ansi = ar[3] as u32 != 0;
                if let Some(w) = e.wnd_mut(a0) {
                    w.unicode = !ansi;
                }
            }
            r
        }
        "NtUserSetWindowWord" => {
            let (off, v) = (ar[1] as i32, ar[2]);
            e.set_long(full(a0), off, v & 0xFFFF, false)
        }
        "NtUserSetClassLong" | "NtUserSetClassLongPtr" => {
            let (off, v) = (ar[1] as i32, ar[2]);
            let Some(ci) = e.wnd(a0).map(|w| w.class) else { return Some(0) };
            let c = &mut e.s.win.classes[ci];
            match off {
                -10 => {
                    let o = c.brush;
                    c.brush = v;
                    o
                }
                -12 => {
                    let o = c.cursor;
                    c.cursor = v;
                    o
                }
                -14 => {
                    let o = c.icon;
                    c.icon = v;
                    o
                }
                -34 => {
                    let o = c.icon_sm;
                    c.icon_sm = v;
                    o
                }
                -24 => {
                    let o = c.proc_;
                    c.proc_ = v;
                    o
                }
                -26 => {
                    let o = c.style as u64;
                    c.style = v as u32;
                    o
                }
                o if o >= 0 => {
                    let o = o as usize;
                    let n = if name.ends_with("Ptr") { 8 } else { 4 };
                    let mut old = 0u64;
                    for k in 0..n {
                        if let Some(b) = c.cls_extra.get_mut(o + k) {
                            old |= (*b as u64) << (8 * k);
                            *b = (v >> (8 * k)) as u8;
                        }
                    }
                    old
                }
                _ => 0,
            }
        }
        "NtUserGetAncestor" => {
            let (h, kind) = (full(a0), ar[1]);
            match kind {
                1 => e.wnd(h).map_or(0, |w| if w.style & WS_CHILD != 0 { w.parent } else { DESKTOP }),
                _ => e.top_of(h),
            }
        }
        "NtUserSetParent" => {
            let (h, p) = (full(a0), full(ar[1]));
            let old = e.wnd(h).map_or(0, |w| w.parent);
            if let Some(o) = e.s.win.wins.get_mut(&old) {
                o.children.retain(|&c| c != h);
            }
            let p = if p == DESKTOP { 0 } else { p };
            if let Some(w) = e.wnd_mut(h) {
                w.parent = p;
            }
            if p != 0 {
                if let Some(pw) = e.s.win.wins.get_mut(&p) {
                    pw.children.push(h);
                }
                e.s.win.tops.retain(|&t| t != h);
            }
            if old == 0 {
                DESKTOP
            } else {
                old
            }
        }
        "NtUserGetWindowRelative" | "NtUserGetWindow" => e.get_window(full(a0), ar[1] as u32),
        "NtUserBuildHwndList" => {
            // Wine 11: (desktop, parent hwnd, children, non_immersive, thread, count, buffer, size*)
            // server get_window_list: desktop/no hwnd = top levels; children = all descendants; else siblings from hwnd on
            let (desk, h, kids, max, buf, size) = (a0, full(ar[1]), ar[2] as u32 != 0, ar[5] as usize, ar[6], ar[7]);
            let tops: Vec<u64> = e.s.win.tops.iter().rev().copied().collect();
            let list: Vec<u64> = if desk != 0 {
                if kids {
                    vec![]
                } else {
                    tops
                }
            } else if h == 0 {
                tops
            } else if kids {
                let mut out = vec![];
                let mut st: Vec<u64> = e.wnd(h).map_or(vec![], |w| w.children.iter().rev().copied().collect());
                while let Some(c) = st.pop() {
                    out.push(c);
                    if let Some(w) = e.wnd(c) {
                        st.extend(w.children.iter().rev().copied());
                    }
                }
                out
            } else if h == DESKTOP {
                vec![DESKTOP]
            } else {
                let sib: Vec<u64> = match e.wnd(h).map(|w| w.parent) {
                    Some(0) => tops,
                    Some(p) => e.wnd(p).map_or(vec![], |w| w.children.clone()),
                    None => vec![],
                };
                sib.iter().position(|&x| x == h).map_or(vec![], |i| sib[i..].to_vec())
            };
            let n = list.len().min(max.saturating_sub(1));
            for (i, h) in list.iter().take(n).enumerate() {
                e.w64(buf + 8 * i as u64, *h);
            }
            e.w64(buf + 8 * n as u64, 1); // terminator HWND_BOTTOM-like
            e.w32(size, n as u32 + 1);
            0
        }
        "NtUserFindWindowEx" => {
            let (parent, after, cls_us, title_us) = (full(a0), full(ar[1]), ar[2], ar[3]);
            let (cn, atom) = e.ustr(cls_us);
            let (tn, _) = e.ustr(title_us);
            let ci = if cls_us != 0 { e.find_class(&cn, atom) } else { None };
            let list: Vec<u64> = if parent == 0 || parent == DESKTOP {
                e.s.win.tops.iter().rev().copied().collect()
            } else {
                e.wnd(parent).map_or(vec![], |w| w.children.clone())
            };
            let start = if after != 0 { list.iter().position(|&h| h == after).map_or(list.len(), |p| p + 1) } else { 0 };
            list[start.min(list.len())..]
                .iter()
                .copied()
                .find(|&h| {
                    let w = e.wnd(h).unwrap();
                    (cls_us == 0 || Some(w.class) == ci) && (title_us == 0 || w.text == tn)
                })
                .unwrap_or(0)
        }
        "NtUserInternalGetWindowText" => {
            let t = e.wnd(a0).map_or(String::new(), |w| w.text.clone());
            let (b, n) = (ar[1], ar[2] as usize);
            e.put_w(b, &t, n) as u64
        }
        "NtUserDefSetText" => {
            let us = ar[1];
            let t = if us == 0 {
                String::new()
            } else {
                // LARGE_STRING { Length, MaximumLength|bAnsi, Buffer }
                let len = e.ur32(us) as usize;
                let ansi = e.ur32(us + 4) & 0x8000_0000 != 0;
                let b = e.r64(us + 8);
                if b == 0 {
                    String::new()
                } else if ansi {
                    let mut v = vec![0u8; len];
                    let _ = e.mmu.read_bytes(b, &mut v);
                    String::from_utf8_lossy(&v).into_owned()
                } else {
                    let v: Vec<u16> = (0..len / 2).map(|i| e.r16(b + 2 * i as u64)).collect();
                    String::from_utf16_lossy(&v)
                }
            };
            if let Some(w) = e.wnd_mut(a0) {
                w.text = t;
                w.nc_dirty = true;
            }
            e.s.win.dirty = true;
            1
        }
        "NtUserMessageCall" => {
            let (msg, wp, lp, info, kind, ansi) = (ar[1] as u32, ar[2], ar[3], ar[4], ar[5] as u32, ar[6] as u32 != 0); // BOOL: low 32 bits
            let h = full(a0);
            match kind {
                0x2b1 | 0x2b3 | 0x2b7 | 0x2b8 => {
                    // SendMessage: same-thread target, user32 calls the procedure itself
                    if h == 0xFFFF {
                        return Some(1);
                    } // broadcast
                    if info != 0 && kind != 0x2b7 {
                        e.w64(info + 8, 0);
                        if e.fill_params(info, h, msg, wp, lp, ansi) {
                            return Some(0);
                        }
                    }
                    if e.wnd(h).is_none() {
                        return Some(0);
                    }
                    // no params to fill (notify): call it from here
                    let s = e.send(h, msg, wp, lp, |_, r| Step::Ret(r));
                    return Some(e.step(s));
                }
                0x3001 => e.fill_params(info, h, msg, wp, lp, ansi) as u64, // GetDispatchParams
                0x2ab => {
                    // CallWindowProc: params.func set by user32
                    let func = e.r64(info);
                    let mut p = vec![0u8; 72];
                    p[0..8].copy_from_slice(&func.to_le_bytes());
                    p[8..16].copy_from_slice(&h.to_le_bytes());
                    p[16..20].copy_from_slice(&msg.to_le_bytes());
                    p[24..32].copy_from_slice(&wp.to_le_bytes());
                    p[32..40].copy_from_slice(&lp.to_le_bytes());
                    p[40..44].copy_from_slice(&(ansi as u32).to_le_bytes());
                    // a builtin class procedure: use the matching pair
                    let (pa, pw) =
                        e.s.win
                            .classes
                            .iter()
                            .find(|c| c.builtin && (c.proc_a == func || c.proc_w == func))
                            .map_or((func, func), |c| (c.proc_a, c.proc_w));
                    let dst = if pa != pw { ansi } else { e.wnd(h).map_or(ansi, |w| if w.proc_ == func { !w.unicode } else { ansi }) };
                    p[44..48].copy_from_slice(&(dst as u32).to_le_bytes());
                    p[48..52].copy_from_slice(&5u32.to_le_bytes());
                    p[52..56].copy_from_slice(&0x12u32.to_le_bytes());
                    p[56..64].copy_from_slice(&pa.to_le_bytes());
                    p[64..72].copy_from_slice(&pw.to_le_bytes());
                    let _ = e.mmu.write_bytes(info, &p);
                    1
                }
                0x29e | 0x29d | 0x29a | 0x29c => {
                    let s = e.def_proc(h, msg, wp, lp, ansi);
                    return Some(e.step(s));
                }
                _ => 0,
            }
        }
        "NtUserPostMessage" => {
            let (msg, wp, lp) = (ar[1] as u32, ar[2], ar[3]);
            if full(a0) == 0xFFFF {
                let tops = e.s.win.tops.clone();
                for t in tops {
                    e.post(t, msg, wp, lp);
                }
                1
            } else {
                e.post(a0, msg, wp, lp) as u64
            }
        }
        "NtUserPostThreadMessage" => {
            let (tid, msg, wp, lp) = (a0 as u32, ar[1] as u32, ar[2], ar[3]);
            let m = Msg { hwnd: 0, msg, wp, lp, time: now_ms() as u32, x: 0, y: 0 };
            e.s.win.queues.entry(tid).or_default().posted.push_back(m);
            1
        }
        "NtUserPostQuitMessage" => {
            let tid = e.cur_tid();
            e.s.win.queues.entry(tid).or_default().quit = Some(a0 as i32);
            1
        }
        "NtUserPeekMessage" => {
            let (h, first, last, flags) = (ar[1], ar[2] as u32, ar[3] as u32, ar[4] as u32);
            match e.peek(a0, h, first, last, flags & 1 != 0) {
                Some(_) => 1,
                None => 0,
            }
        }
        "NtUserGetMessage" => {
            let (h, first, last) = (ar[1], ar[2] as u32, ar[3] as u32);
            match e.peek(a0, h, first, last, true) {
                Some(more) => more as u64,
                None => return Some(e.wait_on(crate::sched::W::Msg { out: a0, hwnd: h, first, last }, u64::MAX)),
            }
        }
        "NtUserMsgWaitForMultipleObjectsEx" => {
            // (count, handles, timeout, mask, flags): wake on input as well
            let (n, hs, ms) = (a0 as u32, ar[1], ar[2] as u32 as u64);
            let tid = e.cur_tid();
            let handles: Vec<u64> = (0..n as u64).map(|i| e.r64(hs + 8 * i)).collect();
            // the objects first (WAIT_OBJECT_0 + i), then input (WAIT_OBJECT_0 + n)
            if let Some(i) = handles.iter().position(|&h| e.signaled(h, tid)) {
                e.acquire(handles[i], tid);
                return Some(i as u64);
            }
            if e.has_msgs(tid) {
                return Some(n as u64);
            }
            return Some(e.wait_on(crate::sched::W::MsgOrObjs { hs: handles }, ms));
        }
        "NtUserWaitMessage" => return Some(e.wait_on(crate::sched::W::MsgOrObjs { hs: vec![] }, u64::MAX)),
        "NtUserGetQueueStatus" => {
            let tid = e.cur_tid();
            let q = e.s.win.queues.entry(tid).or_default();
            let mut s = 0u64;
            if !q.posted.is_empty() {
                s |= 8;
            }
            if !q.input.is_empty() {
                s |= 7;
            }
            if e.paint_due(tid) {
                s |= 0x20;
            }
            if e.next_timer(tid) <= now_ms() {
                s |= 0x10;
            }
            (s << 16) | s
        }
        "NtUserDispatchMessage" => {
            let m = a0;
            let (h, msg, wp, lp) = (e.r64(m), e.ur32(m + 8), e.r64(m + 16), e.r64(m + 24));
            if msg == WM_PAINT {
                // a window that does not paint would get WM_PAINT forever
                let s = e.send(h, msg, wp, lp, move |e, r| {
                    if let Some(w) = e.wnd_mut(h) {
                        w.update = Rect::default();
                        w.erase = false;
                    }
                    Step::Ret(r)
                });
                return Some(e.step(s));
            }
            let s = e.send(h, msg, wp, lp, |_, r| Step::Ret(r));
            return Some(e.step(s));
        }
        "NtUserTranslateMessage" => {
            let m = a0;
            let (h, msg, _wp, time) = (e.r64(m), e.ur32(m + 8), e.r64(m + 16), e.ur32(m + 32));
            if msg != WM_KEYDOWN && msg != WM_SYSKEYDOWN {
                return Some(0);
            }
            match e.s.win.chars.remove(&time) {
                Some(c) => {
                    e.post(h, if msg == WM_KEYDOWN { WM_CHAR } else { 0x106 }, c as u64, 1);
                    1
                }
                None => 0,
            }
        }
        "NtUserSetTimer" | "NtUserSetSystemTimer" => {
            let (h, id, ms, proc_) = (full(a0), ar[1], ar[2] as u32, if name == "NtUserSetTimer" { ar[3] } else { 0 });
            let tid = e.cur_tid();
            let ms = (ms.max(10)) as f64;
            let id = if h == 0 && id == 0 { 0x7FFF_0000 + e.s.win.timers.len() as u64 } else { id };
            e.s.win.timers.retain(|t| !(t.hwnd == h && t.id == id));
            e.s.win.timers.push(Timer { hwnd: h, id, period: ms, next: now_ms() + ms, proc_, tid });
            if id == 0 {
                1
            } else {
                id
            }
        }
        "NtUserKillTimer" | "NtUserKillSystemTimer" => {
            let (h, id) = (full(a0), ar[1]);
            let n = e.s.win.timers.len();
            e.s.win.timers.retain(|t| !(t.hwnd == h && t.id == id));
            (n != e.s.win.timers.len()) as u64
        }
        "NtUserInvalidateRect" => {
            let (r, erase) = (ar[1], ar[2] as u32 != 0);
            let rr = if r != 0 { Some(e.rd_rect(r)) } else { None };
            if full(a0) == 0 {
                let all: Vec<u64> = e.s.win.tops.clone();
                for t in all {
                    e.invalidate(t, None, erase);
                }
            } else {
                e.invalidate(a0, rr, erase);
            }
            1
        }
        "NtUserInvalidateRgn" => {
            let erase = ar[2] as u32 != 0;
            e.invalidate(a0, None, erase);
            1
        }
        "NtUserValidateRect" => {
            let r = ar[1];
            if let Some(w) = e.wnd_mut(a0) {
                if r == 0 {
                    w.update = Rect::default();
                    w.erase = false;
                }
            }
            1
        }
        "NtUserRedrawWindow" => {
            let (r, flags) = (ar[1], ar[3] as u32);
            let rr = if r != 0 { Some(e.rd_rect(r)) } else { None };
            if flags & 1 != 0 {
                e.invalidate(if full(a0) == 0 { DESKTOP } else { a0 }, rr, flags & 4 != 0);
            }
            if flags & 8 != 0 {
                if let Some(w) = e.wnd_mut(a0) {
                    w.update = Rect::default();
                }
            }
            if flags & 0x400 != 0 {
                if let Some(w) = e.wnd_mut(a0) {
                    w.nc_dirty = true;
                }
            }
            e.s.win.dirty = true;
            1
        }
        "NtUserGetUpdateRect" => {
            let r = ar[1];
            let u = e.wnd(a0).map_or(Rect::default(), |w| w.update);
            e.wr_rect(r, u);
            (!u.empty()) as u64
        }
        "NtUserGetUpdateRgn" => e.wnd(a0).map_or(0, |w| if w.update.empty() { 1 } else { 2 }),
        "NtUserUpdateWindow" => 1,
        "NtUserBeginPaint" => {
            let (h, ps) = (full(a0), ar[1]);
            let Some(w) = e.wnd(h) else { return Some(0) };
            let (upd, erase, cw, ch) = (w.update, w.erase, w.crect.w(), w.crect.h());
            let upd = if upd.empty() { Rect::new(0, 0, cw, ch) } else { upd };
            if let Some(w) = e.wnd_mut(h) {
                w.update = Rect::default();
                w.erase = false;
            }
            let hdc = e.get_dc(h, false);
            e.dc_clip_to(hdc, upd);
            e.w64(ps, hdc);
            e.w32(ps + 8, 0);
            e.wr_rect(ps + 12, upd);
            if erase {
                let s = e.send(h, WM_ERASEBKGND, hdc, 0, move |e, r| {
                    if r == 0 { /* not erased */ }
                    let _ = e;
                    Step::Ret(hdc)
                });
                // the default procedure fills with the class brush
                return Some(e.step(s));
            }
            hdc
        }
        "NtUserEndPaint" => {
            let ps = ar[1];
            let hdc = e.r64(ps);
            e.release_dc(hdc);
            1
        }
        "NtUserGetDCEx" => {
            let fl = ar[2] as u32;
            e.get_dc(full(a0), fl & 1 != 0)
        }
        "NtUserGetWindowDC" => e.get_dc(full(a0), true),
        "NtUserReleaseDC" => {
            let hdc = ar[1];
            e.release_dc(hdc);
            1
        }
        "NtUserGetDC" => e.get_dc(full(a0), false),
        "NtUserWindowFromDC" => e.dc_hwnd(ar[0]),
        "NtUserSetFocus" => {
            let h = full(a0);
            let old = e.s.win.focus;
            if h != 0 && e.wnd(h).is_none() {
                return Some(0);
            }
            if h == old {
                return Some(old);
            }
            e.s.win.focus = h;
            if h != 0 {
                e.activate(h);
                e.s.win.focus = h;
            }
            let s = e.send(old, WM_KILLFOCUS, h, 0, move |e, _| e.send(h, WM_SETFOCUS, old, 0, move |_, _| Step::Ret(old)));
            return Some(e.step(s));
        }
        "NtUserGetForegroundWindow" => e.s.win.active,
        "NtUserSetForegroundWindow" | "NtUserSetActiveWindow" => {
            let old = e.s.win.active;
            e.activate(a0);
            if name == "NtUserSetActiveWindow" {
                old
            } else {
                1
            }
        }
        "NtUserGetGUIThreadInfo" => {
            let p = ar[1];
            e.w32(p + 4, 0);
            e.w64(p + 8, e.s.win.active);
            e.w64(p + 16, e.s.win.focus);
            e.w64(p + 24, e.s.win.capture);
            1
        }
        "NtUserSetCapture" => {
            let old = e.s.win.capture;
            e.s.win.capture = full(a0);
            old
        }
        "NtUserReleaseCapture" => {
            e.s.win.capture = 0;
            1
        }
        "NtUserEnableWindow" => {
            let en = ar[1] as u32 != 0;
            let Some(w) = e.wnd_mut(a0) else { return Some(0) };
            let was = w.style & WS_DISABLED != 0;
            if en {
                w.style &= !WS_DISABLED;
            } else {
                w.style |= WS_DISABLED;
            }
            e.invalidate(a0, None, true);
            was as u64
        }
        "NtUserIsWindowRectFullyVisible" => 1,
        "NtUserGetKeyState" => {
            let k = a0 as usize & 0xFF;
            let v = e.s.win.keys[k];
            (if v & 0x80 != 0 { 0xFF80 } else { 0 } | (v & 1) as u64)
        }
        "NtUserGetAsyncKeyState" => {
            let k = a0 as usize & 0xFF;
            if e.s.win.keys[k] & 0x80 != 0 {
                0x8000
            } else {
                0
            }
        }
        "NtUserGetKeyboardState" => {
            for i in 0..256u64 {
                let v = e.s.win.keys[i as usize];
                e.w8(a0 + i, v);
            }
            1
        }
        "NtUserSetKeyboardState" => 1,
        "NtUserGetKeyboardLayout" => 0x0409_0409,
        "NtUserGetKeyboardLayoutName" => {
            e.put_w(a0, "00000409", 9);
            1
        }
        "NtUserMapVirtualKeyEx" => a0 & 0xFF,
        "NtUserGetCursorInfo" => {
            e.w32(a0 + 4, 1);
            e.w32(a0 + 16, e.s.win.mouse.0 as u32);
            e.w32(a0 + 20, e.s.win.mouse.1 as u32);
            1
        }
        "NtUserGetCursorPos" | "NtUserGetPhysicalCursorPos" => {
            let (x, y) = e.s.win.mouse;
            e.w32(a0, x as u32);
            e.w32(a0 + 4, y as u32);
            1
        }
        "NtUserSetCursorPos" => {
            e.s.win.mouse = (a0 as i32, ar[1] as i32);
            1
        }
        "NtUserSetCursor" | "NtUserGetCursor" => 0x20004,
        "NtUserShowCursor" => 1,
        "NtUserClipCursor" => 1,
        "NtUserGetClipCursor" => {
            e.wr_rect(a0, Rect::new(0, 0, SCREEN_W, SCREEN_H));
            1
        }
        "NtUserSetCursorIconData" | "NtUserDestroyCursor" => 1,
        "NtUserFindExistingCursorIcon" => 0,
        "NtUserGetIconSize" => {
            let (w, h) = (ar[2], ar[3]);
            e.w32(w, 32);
            e.w32(h, 64);
            1
        }
        "NtUserGetIconInfo" => 0,
        "NtUserDrawIconEx" => 1,
        "NtUserGetDoubleClickTime" => 500,
        "NtUserSystemParametersInfo" | "NtUserSystemParametersInfoForDpi" => e.spi(a0 as u32, ar[1] as u32, ar[2]),
        "NtUserGetSystemMenu" => {
            let h = full(a0);
            if ar[1] as u32 != 0 {
                0
            } else {
                e.wnd(h).map_or(0, |_| 0)
            }
        }
        "NtUserCreateMenu" => e.new_menu(false),
        "NtUserCreatePopupMenu" => e.new_menu(true),
        "NtUserDestroyMenu" => {
            e.s.win.menus.remove(&a0);
            1
        }
        "NtUserThunkedMenuItemInfo" => {
            let (pos, flags, method, info, text) = (ar[1] as u32, ar[2] as u32, ar[3] as u32, ar[4], ar[5]);
            e.menu_item_info(a0, pos, flags & 0x400 != 0, method, info, text)
        }
        "NtUserGetMenuItemInfo" => {
            let (pos, by, info) = (ar[1] as u32, ar[2] as u32 != 0, ar[3]);
            e.menu_item_info(a0, pos, by, 2, info, 0)
        }
        "NtUserRemoveMenu" | "NtUserDeleteMenu" => {
            let (pos, flags) = (ar[1] as u32, ar[2] as u32);
            let Some(m) = e.s.win.menus.get_mut(&a0) else { return Some(0) };
            let i = if flags & 0x400 != 0 {
                Some(pos as usize).filter(|&i| i < m.items.len())
            } else {
                m.items.iter().position(|it| it.id as u32 == pos)
            };
            match i {
                Some(i) => {
                    m.items.remove(i);
                    1
                }
                None => 0,
            }
        }
        "NtUserCheckMenuItem" => {
            let (id, flags) = (ar[1] as u32, ar[2] as u32);
            let Some(m) = e.s.win.menus.get_mut(&a0) else { return Some(u32::MAX as u64) };
            let i =
                if flags & 0x400 != 0 { Some(id as usize).filter(|&i| i < m.items.len()) } else { m.items.iter().position(|it| it.id as u32 == id) };
            let i = match i {
                Some(i) => i,
                None => {
                    // look in submenus
                    let subs: Vec<u64> = m.items.iter().map(|it| it.sub).filter(|&s| s != 0).collect();
                    for s in subs {
                        if let Some(sm) = e.s.win.menus.get_mut(&s) {
                            if let Some(it) = sm.items.iter_mut().find(|it| it.id as u32 == id) {
                                let old = it.state & 8;
                                if flags & 8 != 0 {
                                    it.state |= 8;
                                } else {
                                    it.state &= !8;
                                }
                                return Some(old as u64);
                            }
                        }
                    }
                    return Some(u32::MAX as u64);
                }
            };
            let it = &mut m.items[i];
            let old = it.state & 8;
            if flags & 8 != 0 {
                it.state |= 8;
            } else {
                it.state &= !8;
            }
            old as u64
        }
        "NtUserEnableMenuItem" => {
            let (id, flags) = (ar[1] as u32, ar[2] as u32);
            let mut done = u32::MAX as u64;
            let ms: Vec<u64> = std::iter::once(a0)
                .chain(e.s.win.menus.get(&a0).map_or(vec![], |m| m.items.iter().map(|i| i.sub).filter(|&s| s != 0).collect()))
                .collect();
            for (k, mh) in ms.iter().enumerate() {
                let Some(m) = e.s.win.menus.get_mut(mh) else { continue };
                let i = if flags & 0x400 != 0 {
                    if k == 0 {
                        Some(id as usize).filter(|&i| i < m.items.len())
                    } else {
                        None
                    }
                } else {
                    m.items.iter().position(|it| it.id as u32 == id)
                };
                if let Some(i) = i {
                    let it = &mut m.items[i];
                    done = (it.state & 3) as u64;
                    it.state = (it.state & !3) | (flags & 3);
                    break;
                }
            }
            done
        }
        "NtUserSetMenu" => {
            let (h, m) = (full(a0), ar[1]);
            let Some(w) = e.wnd(h) else { return Some(0) };
            let (wr, style, ex) = (w.wrect, w.style, w.ex_style);
            let cr = e.client_from(wr, style, ex, m != 0);
            if let Some(w) = e.wnd_mut(h) {
                w.menu = m;
                w.crect = cr;
                w.nc_dirty = true;
            }
            e.s.win.dirty = true;
            1
        }
        "NtUserGetMenu" => e.wnd(a0).map_or(0, |w| w.menu),
        "NtUserDrawMenuBar" => {
            if let Some(w) = e.wnd_mut(a0) {
                w.nc_dirty = true;
            }
            e.s.win.dirty = true;
            1
        }
        "NtUserGetMenuBarInfo" | "NtUserGetMenuItemRect" => 0,
        "NtUserSetMenuContextHelpId" | "NtUserSetMenuDefaultItem" => 1,
        "NtUserTrackPopupMenuEx" => {
            let (flags, x, y, h) = (ar[1] as u32, ar[2] as i32, ar[3] as i32, full(ar[4]));
            let _ = flags;
            e.s.win.popup = Some(Popup { menu: a0, hwnd: h, x, y, w: 0, h: 0, hot: -1 });
            e.layout_popup();
            1
        }
        "NtUserEndMenu" => {
            e.s.win.popup = None;
            1
        }
        "NtUserGetProp" => {
            let k = ar[1];
            e.wnd(a0).and_then(|w| w.props.iter().find(|p| p.0 == k).map(|p| p.1)).unwrap_or(0)
        }
        "NtUserSetProp" => {
            let (k, v) = (ar[1], ar[2]);
            if let Some(w) = e.wnd_mut(a0) {
                w.props.retain(|p| p.0 != k);
                w.props.push((k, v));
                1
            } else {
                0
            }
        }
        "NtUserRemoveProp" => {
            let k = ar[1];
            e.wnd_mut(a0)
                .and_then(|w| {
                    let v = w.props.iter().find(|p| p.0 == k).map(|p| p.1);
                    w.props.retain(|p| p.0 != k);
                    v
                })
                .unwrap_or(0)
        }
        "NtUserGetAtomName" => {
            // (atom, UNICODE_STRING*): a class atom's name (user32 turns MAKEINTATOM class names into strings)
            e.register_builtins();
            let (atom, us) = (a0 as u16, ar[1]);
            let Some(i) = e.find_class("", atom) else { return Some(0) };
            let n = e.s.win.classes[i].name.clone();
            let buf = e.r64(us + 8);
            let max = e.r16(us + 2) as usize / 2;
            let k = e.put_w(buf, &n, max);
            e.w16(us, (2 * k) as u16);
            k as u64
        }
        "NtUserGetThreadState" => match a0 as u32 {
            // focus, active, capture window; message time
            0 => e.s.win.focus,
            1 => e.s.win.active,
            2 => e.s.win.capture,
            9 => now_ms() as u32 as u64,
            _ => 0,
        },
        "NtUserIsClipboardFormatAvailable" | "NtUserOpenClipboard" | "NtUserCloseClipboard" | "NtUserEmptyClipboard" => 0,
        "NtUserGetClipboardSequenceNumber" => 1,
        "NtUserMessageBeep" | "NtUserFlashWindowEx" => 1,
        "NtUserGetWindowPlacement" => {
            let p = ar[1];
            let Some(w) = e.wnd(a0) else { return Some(0) };
            let r = w.wrect;
            e.w32(p, 44);
            e.w32(p + 4, 0);
            e.w32(p + 8, 1);
            e.wr_rect(p + 28, r);
            1
        }
        "NtUserSetWindowPlacement" => {
            // WINDOWPLACEMENT: showCmd at +8, rcNormalPosition at +28 (top levels: screen coordinates)
            let (p, h) = (ar[1], full(a0));
            if e.wnd(h).is_none() {
                return Some(0);
            }
            let (cmd, r) = (e.ur32(p + 8), e.rd_rect(p + 28));
            let s = if r.r > r.l && r.b > r.t {
                e.win_set_pos(h, 0, r.l, r.t, r.r - r.l, r.b - r.t, 0x14, Box::new(move |e, _| e.show_window(h, cmd, Box::new(|_, _| Step::Ret(1)))))
            } else {
                e.show_window(h, cmd, Box::new(|_, _| Step::Ret(1)))
            };
            return Some(e.step(s));
        }
        "NtUserGetTitleBarInfo" | "NtUserGetScrollBarInfo" => 0,
        "NtUserSetScrollInfo" => 0,
        "NtUserShowScrollBar" | "NtUserEnableScrollBar" => 1,
        "NtUserScrollWindowEx" | "NtUserScrollDC" => {
            e.invalidate(a0, None, true);
            1
        }
        "NtUserSetWindowRgn" => 1,
        "NtUserGetWindowRgnEx" => 0,
        "NtUserWindowFromPoint" => {
            let (x, y) = (a0 as i32, ar[1] as i32);
            e.window_at(x, y)
        }
        "NtUserChildWindowFromPointEx" => {
            let (x, y) = (ar[1] as i32, ar[2] as i32);
            let (ox, oy) = e.client_origin(a0);
            let kids = e.wnd(a0).map_or(vec![], |w| w.children.clone());
            kids.iter().rev().copied().find(|&c| e.wnd(c).map_or(false, |w| w.wrect.has(x + ox, y + oy))).unwrap_or(full(a0))
        }
        "NtUserRealChildWindowFromPoint" => full(a0),
        "NtUserIsChildWindowDpiMessageEnabled" | "NtUserEnableNonClientDpiScaling" => 1,
        "NtUserSetThreadDesktop" | "NtUserCloseDesktop" | "NtUserCloseWindowStation" | "NtUserSetProcessWindowStation" => 1,
        "NtUserGetThreadDesktop"
        | "NtUserGetProcessWindowStation"
        | "NtUserOpenInputDesktop"
        | "NtUserOpenDesktop"
        | "NtUserCreateDesktopEx"
        | "NtUserCreateWindowStation"
        | "NtUserOpenWindowStation" => 0x5000,
        "NtUserGetObjectInformation" => {
            let len = ar[3] as u64;
            let b = ar[2];
            for i in 0..len {
                e.w8(b + i, 0);
            }
            1
        }
        "NtUserSetObjectInformation" => 1,
        "NtUserGetProcessDpiAwarenessContext" | "NtUserGetDpiForWindow" => 0x12,
        "NtUserSetProcessDpiAwarenessContext" => 1,
        "NtUserGetDisplayConfigBufferSizes" => {
            e.w32(ar[1], 1);
            e.w32(ar[2], 1);
            0
        }
        // (device name or NULL, index, DISPLAY_DEVICEW*, flags): one display, with one monitor
        "NtUserEnumDisplayDevices" => {
            let info = ar[2];
            if ar[1] == 0 && info != 0 {
                let (name, text, state) =
                    if a0 == 0 { ("\\\\.\\DISPLAY1", "InkSoC display", 5) } else { ("\\\\.\\DISPLAY1\\Monitor0", "Generic monitor", 3) };
                e.put_w(info + 4, name, 32);
                e.put_w(info + 68, text, 128);
                e.w32(info + 324, state); // attached to the desktop | primary (a monitor: active | attached)
                0
            } else {
                crate::status::UNSUCCESSFUL
            }
        }
        "NtUserEnumDisplaySettings" => {
            let dm = ar[2];
            e.w32(dm + 168, 32);
            e.w32(dm + 172, SCREEN_W as u32);
            e.w32(dm + 176, SCREEN_H as u32);
            e.w32(dm + 184, 60);
            e.w32(dm + 72, 0x1C0000);
            if ar[1] == u32::MAX as u64 - 0 || ar[1] <= 1 {
                1
            } else {
                0
            }
        }
        "NtUserChangeDisplaySettings" => 0,
        "NtUserEnumDisplayMonitors" => 1,
        "NtUserGetLayeredWindowAttributes" | "NtUserSetLayeredWindowAttributes" | "NtUserUpdateLayeredWindow" => 1,
        "NtUserActivateKeyboardLayout" => 0x0409_0409,
        "NtUserGetKeyboardLayoutList" => {
            if a0 > 0 && ar[1] != 0 {
                e.w64(ar[1], 0x0409_0409);
            }
            1
        }
        "NtUserVkKeyScanEx" => a0 & 0xFF,
        "NtUserToUnicodeEx" => {
            let (vk, buf) = (a0 as u32, ar[3]);
            let c = if (0x41..=0x5A).contains(&vk) {
                vk + 32
            } else if (0x30..=0x39).contains(&vk) || vk == 0x20 {
                vk
            } else {
                0
            };
            if c != 0 {
                e.w16(buf, c as u16);
                1
            } else {
                0
            }
        }
        "NtUserGetKeyNameText" => 0,
        "NtUserAttachThreadInput" | "NtUserLockWindowUpdate" | "NtUserRegisterHotKey" | "NtUserUnregisterHotKey" => 1,
        "NtUserSetWindowsHookEx" => 0x60000 + 4,
        "NtUserUnhookWindowsHookEx" | "NtUserUnhookWinEvent" => 1,
        "NtUserSetWinEventHook" => 0x60008,
        "NtUserCallMsgFilter" => 0,
        "NtUserNotifyWinEvent" => 0,
        "NtUserGetLastInputInfo" => {
            e.w32(a0 + 4, now_ms() as u32);
            1
        }
        "NtUserDragDetect" | "NtUserDragObject" => 0,
        "NtUserCreateCaret" | "NtUserShowCaret" | "NtUserHideCaret" | "NtUserSetCaretPos" | "NtUserDestroyCaret" | "NtUserSetCaretBlinkTime" => 1,
        "NtUserGetCaretBlinkTime" => 530,
        "NtUserGetCaretPos" => {
            e.w32(a0, 0);
            e.w32(a0 + 4, 0);
            1
        }
        "NtUserCopyAcceleratorTable" => 0,
        "NtUserCreateAcceleratorTable" => 0x70004,
        "NtUserDestroyAcceleratorTable" => 1,
        "NtUserTranslateAccelerator" => 0,
        "NtUserRegisterWindowMessage" => {
            let (n, _) = e.ustr(a0);
            let w = &mut e.s.win;
            let k = w.props_atoms.len() as u16;
            *w.props_atoms.entry(n).or_insert(0xC100 + k) as u64
        }
        "NtUserGetRawInputDeviceList" | "NtUserGetRegisteredRawInputDevices" | "NtUserGetRawInputData" | "NtUserGetRawInputBuffer" => 0,
        "NtUserRegisterRawInputDevices" => 1,
        "NtUserGetPointerInfoList" => 0,
        "NtUserIsTouchWindow" => 0,
        "NtUserRedrawFrame" => 1,
        "NtUserGetControlBrush" | "NtUserGetControlColor" => e.sys_brush(15),
        "NtUserCountClipboardFormats"
        | "NtUserGetPriorityClipboardFormat"
        | "NtUserGetClipboardOwner"
        | "NtUserGetClipboardViewer"
        | "NtUserGetOpenClipboardWindow" => 0,
        "NtUserWaitForInputIdle" => 0,
        "NtUserExcludeUpdateRgn" => 1,
        "NtUserSetShellWindowEx" | "NtUserSetProgmanWindow" | "NtUserSetTaskmanWindow" => 1,
        "NtUserGetModuleFileNameEx" => 0,
        "NtUserQueryWindow" => 4,
        "NtUserSwitchDesktop" | "NtUserSetSysColors" => 1,
        "NtUserBeginDeferWindowPos" => 0x80004,
        "NtUserDeferWindowPosAndBand" => {
            let (h, after, x, y, cx, cy, fl) = (ar[1], ar[2], ar[3] as i32, ar[4] as i32, ar[5] as i32, ar[6] as i32, ar[7] as u32);
            let s = e.win_set_pos(h, after, x, y, cx, cy, fl, Box::new(move |_, _| Step::Ret(a0)));
            return Some(e.step(s));
        }
        "NtUserEndDeferWindowPosEx" => 1,
        "NtUserFillWindow" => 1,
        "NtUserFlashWindow" => 1,
        "NtUserGetMouseMovePointsEx" => u32::MAX as u64,
        "NtUserTrackMouseEvent" => 1,
        "NtUserArrangeIconicWindows" => 0,
        "NtUserAlterWindowStyle" => 0,
        "NtUserGetDialogBaseUnits" => (16 << 16) | 6,
        "NtUserCloseWindow" | "NtUserOpenIcon" => 1,
        "NtUserSelectPalette" => return crate::wingdi::call(e, name),
        "NtUserRealizePalette" => 0,
        _ => {
            if !e.s.win.unknown.contains(name) {
                e.s.win.unknown.insert(name.to_string());
                crate::console(&format!("[win32u] {} (not yet)\n", name));
            }
            0
        }
    };
    Some(r)
}
