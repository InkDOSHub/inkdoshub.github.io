// Small helpers and calls back into Wine's user32 (KeUserModeCallback).

use super::*;

impl Engine {
    pub(super) fn ur32(&mut self, a: u64) -> u32 { self.r32(a) }
    pub(crate) fn rd_rect(&mut self, a: u64) -> Rect {
        Rect::new(self.ur32(a) as i32, self.ur32(a + 4) as i32, self.ur32(a + 8) as i32, self.ur32(a + 12) as i32)
    }
    pub(crate) fn wr_rect(&mut self, a: u64, r: Rect) {
        if a == 0 { return; }
        self.w32(a, r.l as u32); self.w32(a + 4, r.t as u32); self.w32(a + 8, r.r as u32); self.w32(a + 12, r.b as u32);
    }
    /// Text of a UNICODE_STRING (or an atom when the buffer is a small integer).
    pub(super) fn ustr(&mut self, us: u64) -> (String, u16) {
        if us == 0 { return (String::new(), 0); }
        let len = self.r16(us) as usize / 2;
        let buf = self.r64(us + 8);
        if buf < 0x10000 { return (String::new(), buf as u16); }
        let v: Vec<u16> = (0..len).map(|i| self.r16(buf + 2 * i as u64)).collect();
        (String::from_utf16_lossy(&v), 0)
    }
    pub(crate) fn put_w(&mut self, a: u64, s: &str, max: usize) -> usize {
        if a == 0 || max == 0 { return 0; }
        let w: Vec<u16> = s.encode_utf16().take(max - 1).collect();
        for (i, c) in w.iter().enumerate() { self.w16(a + 2 * i as u64, *c); }
        self.w16(a + 2 * w.len() as u64, 0);
        w.len()
    }
    pub(super) fn alloc_w(&mut self, s: &str) -> u64 {
        let w: Vec<u16> = s.encode_utf16().collect();
        let b = self.heap_alloc(2 * w.len() as u64 + 2, true);
        for (i, c) in w.iter().enumerate() { self.w16(b + 2 * i as u64, *c); }
        b
    }

    pub(crate) fn wnd(&self, h: u64) -> Option<&Wnd> { self.s.win.wins.get(&full(h)) }
    pub(super) fn wnd_mut(&mut self, h: u64) -> Option<&mut Wnd> { self.s.win.wins.get_mut(&full(h)) }

    // ---------- callbacks into user32 (KeUserModeCallback) ----------

    /// Runs a step: returns the value for the native caller, or NO_RETURN when
    /// a window procedure is being called first.
    pub(crate) fn step(&mut self, mut s: Step) -> u64 {
        loop {
            match s {
                Step::Ret(v) => return v,
                Step::Send { hwnd, msg, wp, lp, then } => {
                    match self.proc_params(hwnd, msg, wp, lp, false) {
                        Some(mut p) => {
                            self.s.win.pack_back = None;
                            if self.s.wow64 && lp > 0xFFFF { self.pack_lparam(&mut p, msg, wp, lp); }
                            self.callback(4, &p, then); return NO_RETURN; // NtUserCallWinProc
                        }
                        None => s = then(self, 0),
                    }
                }
            }
        }
    }

    /// Sends a message from the window system, then continues with `then`.
    pub(crate) fn send(&mut self, hwnd: u64, msg: u32, wp: u64, lp: u64, then: impl FnOnce(&mut Engine, u64) -> Step + 'static) -> Step {
        Step::Send { hwnd, msg, wp, lp, then: Box::new(then) }
    }

    pub(super) fn callback(&mut self, id: u32, args: &[u8], cont: Cont) {
        if self.s.win_ki == 0 {
            if let Some(m) = crate::pe::find_module(self, "wine-ntdll.dll") { self.s.win_ki = self.s.modules[m].exports.get("KiUserCallbackDispatcher").copied().unwrap_or(0); }
        }
        let ki = self.s.win_ki;
        if ki == 0 { let _ = cont; self.set_error("window system: KiUserCallbackDispatcher not found".into()); return; }
        let c = &self.cpu;
        let regs = [c.regs[3], c.regs[5], c.regs[6], c.regs[7], c.regs[12], c.regs[13], c.regs[14], c.regs[15]];
        let mut xmm = [0u128; 10];
        xmm.copy_from_slice(&c.xmm[6..16]);
        let rsp = c.regs[4];
        let tid = self.cur_tid();
        // WoW64: a packed lparam structure (after the parameters) comes back after the result
        let back = if self.s.wow64 && id == 4 { self.s.win.pack_back.take().unwrap_or((0, 0)) } else { (0, 0) };
        self.s.win.frames.push(Frame { tid, rsp, regs, xmm, cont, back });
        let base = (rsp - 0x300 - args.len() as u64) & !0xF;
        let _ = self.mmu.write_bytes(base, args);
        let sp = (base - 0x100) & !0xF;
        self.w64(sp + 0x20, base);
        self.w32(sp + 0x28, args.len() as u32);
        self.w32(sp + 0x2C, id);
        self.cpu.regs[4] = sp;
        self.cpu.rip = ki;
    }

    /// NtCallbackReturn: the window procedure is done; go on with the native code.
    pub fn callback_return(&mut self) {
        let (ret, len) = (self.arg(0), self.arg(1) as u32);
        let lres = if ret != 0 && len >= 8 { self.r64(ret) } else { 0 };
        let tid = self.cur_tid();
        let Some(i) = self.s.win.frames.iter().rposition(|f| f.tid == tid) else {
            self.set_error("NtCallbackReturn without a callback".into());
            return;
        };
        let f = self.s.win.frames.remove(i);
        if f.back.1 != 0 && ret != 0 && len as usize >= 8 + f.back.1 {
            let mut b = vec![0u8; f.back.1];
            if self.mmu.read_bytes(ret + 8, &mut b).is_ok() { let _ = self.mmu.write_bytes(f.back.0, &b); }
        }
        let c = &mut self.cpu;
        for (k, r) in [3usize, 5, 6, 7, 12, 13, 14, 15].iter().enumerate() { c.regs[*r] = f.regs[k]; }
        c.xmm[6..16].copy_from_slice(&f.xmm);
        c.regs[4] = f.rsp;
        let st = (f.cont)(self, lres);
        let v = self.step(st);
        if v != NO_RETURN { self.do_ret(v); }
    }

    /// win_proc_params for calling a window's procedure (72 bytes).
    pub(super) fn proc_params(&mut self, hwnd: u64, msg: u32, wp: u64, lp: u64, ansi: bool) -> Option<Vec<u8>> {
        let w = self.wnd(hwnd)?;
        let (mut func, unicode, cls) = (w.proc_, w.unicode, w.class);
        if func == 0 { return None; }
        let c = &self.s.win.classes[cls];
        let (pa, pw) = if c.builtin && (func == c.proc_w || func == c.proc_a) { func = c.proc_w; (c.proc_a, c.proc_w) } else { (func, func) };
        let mut p = vec![0u8; 72];
        p[0..8].copy_from_slice(&func.to_le_bytes());
        p[8..16].copy_from_slice(&full(hwnd).to_le_bytes());
        p[16..20].copy_from_slice(&msg.to_le_bytes());
        p[24..32].copy_from_slice(&wp.to_le_bytes());
        p[32..40].copy_from_slice(&lp.to_le_bytes());
        p[40..44].copy_from_slice(&(ansi as u32).to_le_bytes());
        let dst = if c.builtin && pa != pw { ansi } else { !unicode };
        p[44..48].copy_from_slice(&(dst as u32).to_le_bytes());
        p[48..52].copy_from_slice(&5u32.to_le_bytes()); // WMCHAR_MAP_CALLWINDOWPROC
        p[52..56].copy_from_slice(&0x12u32.to_le_bytes());
        p[56..64].copy_from_slice(&pa.to_le_bytes());
        p[64..72].copy_from_slice(&pw.to_le_bytes());
        Some(p)
    }

    /// WoW64: structures an lparam points to travel packed after the parameters
    /// (wow64win converts them to their 32-bit layout); what the procedure may
    /// change is copied back on return (pack_back).
    pub(super) fn pack_lparam(&mut self, p: &mut Vec<u8>, msg: u32, wp: u64, lp: u64) {
        let (n, back) = match msg {
            0x01 | 0x81 => (0x50, false),                // WM_CREATE, WM_NCCREATE: CREATESTRUCTW (+ strings)
            0x83 => if wp != 0 { (56 + 40, true) } else { (16, true) }, // WM_NCCALCSIZE
            0x46 | 0x47 => (40, true),                   // WM_WINDOWPOSCHANGING/CHANGED
            0x24 => (40, true),                          // WM_GETMINMAXINFO
            0x7C | 0x7D => (8, true),                    // WM_STYLECHANGING/CHANGED
            0x0214 | 0x0216 => (16, true),               // WM_SIZING, WM_MOVING
            _ => return,
        };
        let mut d = vec![0u8; n];
        if msg == 0x83 && wp != 0 {
            // NCCALCSIZE_PARAMS then the WINDOWPOS it points to
            if self.mmu.read_bytes(lp, &mut d[..56]).is_err() { return; }
            let wpos = u64::from_le_bytes(d[48..56].try_into().unwrap());
            let _ = self.mmu.read_bytes(wpos, &mut d[56..]);
        } else if self.mmu.read_bytes(lp, &mut d).is_err() { return; }
        if msg == 0x01 || msg == 0x81 {
            for off in [0x38usize, 0x40] { // lpszName, lpszClass (strings follow unless atoms)
                let sp = u64::from_le_bytes(d[off..off + 8].try_into().unwrap());
                if sp > 0xFFFF {
                    let w = self.read_wstr(sp, 1024);
                    for c in w.encode_utf16().chain([0]) { d.extend_from_slice(&c.to_le_bytes()); }
                }
            }
        }
        p.resize(80, 0);
        p.extend_from_slice(&d);
        self.s.win.pack_back = if back { Some((lp, n)) } else { None };
        if msg == 0x83 && wp != 0 { self.s.win.pack_back = Some((lp, 48)); } // the rectangles
    }

    /// Fills the program's win_proc_params so user32 calls the procedure itself.
    pub(super) fn fill_params(&mut self, out: u64, hwnd: u64, msg: u32, wp: u64, lp: u64, ansi: bool) -> bool {
        match self.proc_params(hwnd, msg, wp, lp, ansi) {
            Some(p) => { let _ = self.mmu.write_bytes(out, &p); true }
            None => false,
        }
    }
}
