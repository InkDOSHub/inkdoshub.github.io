// C++ exceptions for x64 Windows programs (MSVC ABI).
//
// _CxxThrowException walks the program's stack with the unwind tables of each
// module (.pdata / UNWIND_INFO), finds the first frame whose handler is
// msvcrt's __CxxFrameHandler and has a matching catch, runs the destructors
// of the frames in between (unwind funclets), calls the catch funclet and
// resumes at the address it returns, with that frame's registers.

use crate::{Engine, RET_EH};

#[derive(Clone)]
struct Ctx { regs: [u64; 16], xmm: [u128; 16], rip: u64 }

pub enum Step { Call(u64, u64), Catch(u64, u64) }

#[derive(Default)]
pub struct Eh {
    steps: Vec<Step>,   // funclets still to call (in order, reversed)
    resume: Option<([u64; 16], [u128; 16])>, // registers of the catching frame
    base_sp: u64,
    /// frames whose catch block is running (a throw from inside a catch block
    /// belongs to that frame): its registers and establisher frame
    parents: Vec<(Ctx, u64)>,
    pending_parent: Option<(Ctx, u64)>,
}

struct Frame { ctx: Ctx, establisher: u64, image: u64, func_info: Option<u64> }

impl Engine {
    fn r32(&mut self, a: u64) -> u32 { self.mmu.read32(a).unwrap_or(0) }
    fn r64(&mut self, a: u64) -> u64 { self.mmu.read64(a).unwrap_or(0) }

    fn image_of(&self, ip: u64) -> Option<u64> {
        self.s.modules.iter().find(|m| !m.native && ip >= m.base && ip < m.base + m.size).map(|m| m.base)
    }

    /// RUNTIME_FUNCTION covering `ip` in the image at `base`.
    fn runtime_function(&mut self, base: u64, ip: u64) -> Option<u64> {
        let pe = base + self.r32(base + 0x3C) as u64;
        let dirs = pe + 24 + 112;
        let (rva, size) = (self.r32(dirs + 8 * 3) as u64, self.r32(dirs + 8 * 3 + 4) as u64);
        if rva == 0 { return None; }
        let rel = ip - base;
        let (mut lo, mut hi) = (0u64, size / 12);
        while lo < hi {
            let mid = (lo + hi) / 2;
            let f = base + rva + 12 * mid;
            let (b, e) = (self.r32(f) as u64, self.r32(f + 4) as u64);
            if rel < b { hi = mid } else if rel >= e { lo = mid + 1 } else { return Some(f); }
        }
        None
    }

    fn is_cxx_handler(&mut self, h: u64) -> bool {
        // usually a jmp through the import table
        let target = if self.mmu.read16(h).unwrap_or(0) == 0x25FF {
            let d = self.r32(h + 2) as i32 as i64;
            self.r64((h as i64 + 6 + d) as u64)
        } else { h };
        ["__CxxFrameHandler", "__CxxFrameHandler3", "__CxxFrameHandler4"].iter().any(|n| ["msvcrt.dll", "vcruntime140.dll", "vcruntime140_1.dll"].iter().any(|d| self.thunk_lookup(d, n) == Some(target)))
    }

    /// One step of virtual unwind: returns this frame's description and moves ctx to the caller.
    fn unwind_frame(&mut self, ctx: &mut Ctx) -> Option<Frame> {
        let ip = ctx.rip;
        let base = self.image_of(ip)?;
        let Some(mut rf) = self.runtime_function(base, ip) else {
            // leaf function
            let frame = Frame { ctx: ctx.clone(), establisher: ctx.regs[4], image: base, func_info: None };
            ctx.rip = self.r64(ctx.regs[4]);
            ctx.regs[4] += 8;
            return Some(frame);
        };
        let start_ctx = ctx.clone();
        let mut establisher = 0;
        let mut func_info = None;
        let mut first = true;
        loop {
            let begin = base + self.r32(rf) as u64;
            let ui = base + self.r32(rf + 8) as u64;
            let b0 = self.mmu.read8(ui).unwrap_or(0);
            let (flags, prolog) = (b0 >> 3, self.mmu.read8(ui + 1).unwrap_or(0) as u64);
            let count = self.mmu.read8(ui + 2).unwrap_or(0) as u64;
            let fr = self.mmu.read8(ui + 3).unwrap_or(0);
            let (freg, foff) = ((fr & 15) as usize, (fr >> 4) as u64);
            if first {
                establisher = if freg != 0 { ctx.regs[freg].wrapping_sub(16 * foff) } else { ctx.regs[4] };
                if flags & 3 != 0 {
                    let h = ui + 4 + 2 * ((count + 1) & !1);
                    let handler = base + self.r32(h) as u64;
                    if self.is_cxx_handler(handler) { func_info = Some(base + self.r32(h + 4) as u64); }
                }
            }
            let offset_in = ip.wrapping_sub(begin);
            let mut i = 0;
            while i < count {
                let c = ui + 4 + 2 * i;
                let code_off = self.mmu.read8(c).unwrap_or(0) as u64;
                let b = self.mmu.read8(c + 1).unwrap_or(0);
                let (op, info) = (b & 15, (b >> 4) as usize);
                let skip = first && offset_in < prolog && code_off > offset_in;
                let slots = match op { 1 => if info == 0 { 2 } else { 3 }, 4 | 8 => 2, 5 | 9 => 3, _ => 1 };
                if !skip {
                    match op {
                        0 => { ctx.regs[info] = self.r64(ctx.regs[4]); ctx.regs[4] += 8; }
                        1 => {
                            let size = if info == 0 { self.mmu.read16(c + 2).unwrap_or(0) as u64 * 8 } else { self.r32(c + 2) as u64 };
                            ctx.regs[4] += size;
                        }
                        2 => { ctx.regs[4] += info as u64 * 8 + 8; }
                        3 => { ctx.regs[4] = ctx.regs[freg].wrapping_sub(16 * foff); }
                        4 => { let o = self.mmu.read16(c + 2).unwrap_or(0) as u64 * 8; ctx.regs[info] = self.r64(ctx.regs[4] + o); }
                        5 => { let o = self.r32(c + 2) as u64; ctx.regs[info] = self.r64(ctx.regs[4] + o); }
                        8 | 9 => {
                            let o = if op == 8 { self.mmu.read16(c + 2).unwrap_or(0) as u64 * 16 } else { self.r32(c + 2) as u64 };
                            let a = ctx.regs[4] + o;
                            ctx.xmm[info] = self.r64(a) as u128 | (self.r64(a + 8) as u128) << 64;
                        }
                        10 => {
                            let sp = ctx.regs[4] + if info != 0 { 8 } else { 0 };
                            ctx.rip = self.r64(sp);
                            ctx.regs[4] = self.r64(sp + 24);
                            return Some(Frame { ctx: start_ctx, establisher, image: base, func_info });
                        }
                        _ => {}
                    }
                }
                i += slots;
            }
            if flags & 4 != 0 {
                // chained: continue with the parent function's unwind info
                rf = ui + 4 + 2 * ((count + 1) & !1);
                first = false;
                continue;
            }
            break;
        }
        ctx.rip = self.r64(ctx.regs[4]);
        ctx.regs[4] += 8;
        Some(Frame { ctx: start_ctx, establisher, image: base, func_info })
    }

    fn type_name(&mut self, td: u64) -> String { self.read_cstr(td + 16, 256) }

    /// Called for msvcrt!_CxxThrowException(object, throw_info).
    pub fn cxx_throw(&mut self) -> Result<(), String> {
        let (obj, ti) = (self.arg(0), self.arg(1));
        if ti == 0 { return Err("the program re-threw a C++ exception (not supported yet)".into()); }
        let throw_base = self.image_of(ti).unwrap_or(0);
        // catchable types of the thrown object
        let cta = throw_base + self.r32(ti + 12) as u64;
        let n = self.r32(cta) as u64;
        let mut types = Vec::new();
        for i in 0..n {
            let ct = throw_base + self.r32(cta + 4 + 4 * i) as u64;
            let td = throw_base + self.r32(ct + 4) as u64;
            let name = self.type_name(td);
            types.push((name, ct));
        }
        let thrown = types.first().map(|t| t.0.clone()).unwrap_or_default();

        let throw_sp = self.cpu.regs[4];
        let mut ctx = Ctx { regs: self.cpu.regs, xmm: self.cpu.xmm, rip: self.r64(throw_sp) };
        ctx.regs[4] = throw_sp + 8;
        let mut unwinds: Vec<Step> = Vec::new();
        let mut depth = self.eh.parents.len();
        for _ in 0..1000 {
            let Some(mut frame) = self.unwind_frame(&mut ctx) else { break };
            if ctx.rip == RET_EH && depth > 0 {
                // this frame is a catch block (funclet): it acts for its parent function
                depth -= 1;
                let (pctx, pest) = self.eh.parents[depth].clone();
                frame.establisher = pest;
                frame.ctx = pctx.clone();
                // continue the walk above the parent (its own try was already used)
                ctx = pctx;
                let _ = self.unwind_frame(&mut ctx);
            }
            let Some(fi) = frame.func_info else { continue };
            let base = frame.image;
            let rd = |e: &mut Engine, o: u64| e.r32(fi + o);
            let max_state = rd(self, 4) as i32;
            let (unwind_map, ntry, try_map, nip, ip_map) = (base + rd(self, 8) as u64, rd(self, 12) as u64, base + rd(self, 16) as u64, rd(self, 20) as u64, base + rd(self, 24) as u64);
            // current state from the instruction pointer
            let rel = frame.ctx.rip - base;
            let mut state = -1i32;
            for i in 0..nip {
                if (self.r32(ip_map + 8 * i) as u64) > rel { break; }
                state = self.r32(ip_map + 8 * i + 4) as i32;
            }
            // a try block covering the state with a matching catch?
            let mut found = None;
            'tries: for t in 0..ntry {
                let tb = try_map + 20 * t;
                let (low, high, ncatch, harr) = (self.r32(tb) as i32, self.r32(tb + 4) as i32, self.r32(tb + 12) as u64, base + self.r32(tb + 16) as u64);
                if state < low || state > high { continue; }
                for h in 0..ncatch {
                    let ht = harr + 20 * h;
                    let (adj, tdr, catch_obj, funclet) = (self.r32(ht), self.r32(ht + 4), self.r32(ht + 8) as i32, base + self.r32(ht + 12) as u64);
                    if tdr == 0 { found = Some((low, funclet, catch_obj, adj, None)); break 'tries; }
                    let cname = { let td = base + tdr as u64; self.type_name(td) };
                    if let Some((_, ct)) = types.iter().find(|(n, _)| *n == cname) {
                        found = Some((low, funclet, catch_obj, adj, Some(*ct)));
                        break 'tries;
                    }
                }
            }
            let target = found.as_ref().map(|f| f.0 - 1).unwrap_or(-1);
            // destructors of this frame down to the target state
            let mut s = state;
            let mut guard = 0;
            while s > target && s >= 0 && s < max_state.max(0) + 1 && guard < 10000 {
                let ent = unwind_map + 8 * s as u64;
                let (to, action) = (self.r32(ent) as i32, self.r32(ent + 4) as u64);
                if action != 0 { unwinds.push(Step::Call(base + action, frame.establisher)); }
                s = to;
                guard += 1;
            }
            if let Some((_, funclet, catch_obj, adj, ct)) = found {
                // the catch variable: a reference gets the address, a value gets a copy of the bytes
                if catch_obj != 0 {
                    if let Some(ct) = ct {
                        let dst = frame.establisher.wrapping_add(catch_obj as i64 as u64);
                        let src = obj.wrapping_add(self.r32(ct + 8) as i32 as i64 as u64);
                        if adj & 8 != 0 { let _ = self.mmu.write64(dst, src); } else {
                            let size = self.r32(ct + 20) as u64;
                            let props = self.r32(ct);
                            if props & 1 != 0 { let p = self.r64(src); let _ = self.mmu.write64(dst, p); }
                            else { let v = self.read_bytes_vec(src, size.min(4096)); let _ = self.mmu.write_bytes(dst, &v); }
                        }
                    }
                }
                unwinds.push(Step::Catch(funclet, frame.establisher));
                unwinds.reverse();
                self.eh.parents.truncate(depth);
                self.eh.pending_parent = Some((frame.ctx.clone(), frame.establisher));
                self.eh.steps = unwinds;
                self.eh.resume = Some((frame.ctx.regs, frame.ctx.xmm));
                self.eh.base_sp = (throw_sp - 0x200) & !0xF;
                self.eh_next();
                return Ok(());
            }
        }
        Err(format!("unhandled C++ exception{}", if thrown.is_empty() { String::new() } else { format!(" ({})", thrown) }))
    }

    fn read_bytes_vec(&mut self, a: u64, n: u64) -> Vec<u8> {
        let mut v = vec![0u8; n as usize];
        let _ = self.mmu.read_bytes(a, &mut v);
        v
    }

    /// Runs the next funclet; after the catch funclet, resumes the program.
    pub fn eh_next(&mut self) {
        match self.eh.steps.pop() {
            Some(Step::Catch(f, frame)) => {
                if let Some(p) = self.eh.pending_parent.take() { self.eh.parents.push(p); }
                self.cpu.regs[4] = self.eh.base_sp;
                self.call_guest(f, [frame, frame, 0], RET_EH);
                self.cpu.regs[2] = frame;
            }
            Some(Step::Call(f, frame)) => {
                self.cpu.regs[4] = self.eh.base_sp;
                self.call_guest(f, [frame, frame, 0], RET_EH);
                self.cpu.regs[2] = frame;
                self.cpu.regs[1] = frame;
            }
            None => {
                let cont = self.cpu.regs[0];
                self.eh.parents.pop();
                if let Some((regs, xmm)) = self.eh.resume.take() {
                    self.cpu.regs = regs;
                    self.cpu.xmm = xmm;
                    self.cpu.regs[0] = cont;
                    self.cpu.rip = cont;
                }
            }
        }
    }
}
