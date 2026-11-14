// Handles, processes and threads.

use super::*;

pub(super) fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let a0 = e.arg(0);
    Some(match name {
        // ---- handles and processes ----
        "DuplicateHandle" => {
            let (h, out) = (e.arg(1), e.arg(3));
            let h = e.dup_handle(h);
            e.w64(out, h);
            1
        }
        "CreatePipe" => {
            let (pr, pw) = (e.arg(0), e.arg(1));
            let (r, w) = e.new_pipe();
            e.w64(pr, r);
            e.w64(pw, w);
            1
        }
        "CreateProcessW" | "CreateProcessA" | "CreateProcessAsUserW" => {
            // (app, cmdline, process attrs, thread attrs, inherit, flags, env, dir, startup info, process info); AsUser has a token first
            let o = if name == "CreateProcessAsUserW" { 1 } else { 0 };
            let wide = !name.ends_with('A');
            let rd = |e: &mut Engine, p: u64| {
                if p == 0 {
                    String::new()
                } else if wide {
                    e.read_wstr(p, 32767)
                } else {
                    e.read_cstr(p, 32767)
                }
            };
            let (app, cmd) = (e.arg(o), e.arg(o + 1));
            let (app, cmd) = (rd(e, app), rd(e, cmd));
            let (flags, envp, si, pi) = (e.arg(o + 5) as u32, e.arg(o + 6), e.arg(o + 8), e.arg(o + 9));
            // the program: the application name, or the first word of the command line
            let first = if !app.is_empty() {
                app.clone()
            } else if let Some(r) = cmd.strip_prefix('"') {
                r.split('"').next().unwrap_or("").to_string()
            } else {
                cmd.split_whitespace().next().unwrap_or("").to_string()
            };
            let mut exe = crate::pe::norm(first.rsplit(['\\', '/']).next().unwrap_or(&first));
            if !e.s.files.contains_key(&exe) && !exe.ends_with(".exe") {
                exe.push_str(".exe");
            }
            if !e.s.files.contains_key(&exe) {
                e.set_last_error(ERROR_FILE_NOT_FOUND);
                return Some(0);
            }
            let cmd = if cmd.is_empty() { first.clone() } else { cmd };
            // environment: the one given (Unicode with flag 0x400), else a copy of ours
            let env: Vec<u16> = if envp == 0 {
                e.env_vec()
            } else {
                let mut v = Vec::new();
                let uni = flags & 0x400 != 0;
                for k in 0..0x40000u64 {
                    let c = if uni { e.r16(envp + 2 * k) } else { e.r8(envp + k) as u16 };
                    v.push(c);
                    let n = v.len();
                    if c == 0 && (n >= 2 && v[n - 2] == 0 || n == 1) {
                        break;
                    }
                }
                if v.len() == 1 {
                    v.push(0);
                }
                v
            };
            // standard handles: given ones (STARTF_USESTDHANDLES), else ours
            let mut std = e.s.std;
            if si != 0 && e.r32(si + 60) & 0x100 != 0 {
                for k in 0..3 {
                    std[k] = e.r64(si + 80 + 8 * k as u64);
                }
            }
            match e.create_process(&exe, &cmd, env, std, flags & 4 != 0) {
                Ok((pid, tid, th)) => {
                    let ph = e.new_handle(crate::files::Handle::Process { pid });
                    e.w64(pi, ph);
                    e.w64(pi + 8, th);
                    e.w32(pi + 16, pid);
                    e.w32(pi + 20, tid);
                    1
                }
                Err(m) => {
                    crate::console(&format!("[inksoc] CreateProcess {}: {}\n", exe, m));
                    e.set_last_error(ERROR_FILE_NOT_FOUND);
                    0
                }
            }
        }
        "ShellExecuteW" | "ShellExecuteExW" => {
            e.set_last_error(ERROR_FILE_NOT_FOUND);
            0
        }
        "GetExitCodeProcess" => {
            let p = e.arg(1);
            let code = match e.s.fs.handles.get(&a0) {
                Some(crate::files::Handle::Process { pid }) => e.s.pinfo.get(pid).and_then(|i| i.exit).unwrap_or(259),
                _ => {
                    if a0 == u64::MAX {
                        259
                    } else {
                        0
                    }
                }
            };
            e.w32(p, code);
            1
        }
        "GetProcessId" => match e.s.fs.handles.get(&a0) {
            Some(crate::files::Handle::Process { pid }) => *pid as u64,
            _ => {
                if a0 == u64::MAX {
                    e.s.wpid.max(4) as u64
                } else {
                    0
                }
            }
        },
        "SetStdHandle" => {
            let k = match a0 as u32 as i32 {
                -10 => 0,
                -11 => 1,
                -12 => 2,
                _ => return Some(0),
            };
            e.s.std[k] = e.arg(1);
            1
        }
        "SetHandleInformation" => 1,
        "GetHandleInformation" => {
            let p = e.arg(1);
            e.w32(p, 0);
            1
        }
        "LockFile" | "UnlockFile" | "LockFileEx" | "UnlockFileEx" => 1,
        "VerifyConsoleIoHandle" => (a0 <= 3) as u64,
        // only the console input handle has input events (programs tell input from output this way)
        "GetNumberOfConsoleInputEvents" => {
            if a0 != 3 {
                return Some(0);
            }
            let p = e.arg(1);
            e.w32(p, 0);
            1
        }
        "PeekConsoleInputA" | "PeekConsoleInputW" | "ReadConsoleInputA" | "ReadConsoleInputW" => {
            let p = e.arg(3);
            e.w32(p, 0);
            1
        }
        "ReadConsoleA" | "ReadConsoleW" => {
            let p = e.arg(3);
            e.w32(p, 0);
            1
        }
        "GetConsoleScreenBufferInfoEx" => {
            e.set_last_error(6);
            0
        }
        "Beep" => 1,
        // known folders: the usual Windows layout; the user's own folders are under C:\InkSoC
        "SHGetKnownFolderPath" => {
            let (id, out) = (a0, e.arg(3));
            let p = match e.r32(id) {
                0x905E_63B6 => "C:\\Program Files",
                0x7C5A_40EF => "C:\\Program Files (x86)",
                0xF1B3_2785 => "C:\\InkSoC\\AppData\\Local",
                0x3EB6_85DB => "C:\\InkSoC\\AppData\\Roaming",
                0x62AB_5D82 => "C:\\ProgramData",
                0xFDD3_9AD0 => "C:\\InkSoC\\Documents",
                0xB4BF_CC3A => "C:\\InkSoC\\Desktop",
                0xF38B_F404 => "C:\\Windows",
                0x1AC1_4E77 => "C:\\Windows\\System32",
                0x6D80_9377 => "C:\\Program Files\\Common Files",
                0xA77F_5D77 => "C:\\InkSoC\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs",
                _ => "C:\\InkSoC",
            };
            let w: Vec<u16> = p.encode_utf16().chain([0]).collect();
            let b = e.heap_alloc(2 * w.len() as u64, false);
            for (k, c) in w.iter().enumerate() {
                e.w16(b + 2 * k as u64, *c);
            }
            e.w64(out, b);
            0
        }
        "SHGetFolderPathW" | "SHGetFolderPathA" | "SHGetSpecialFolderPathW" | "SHGetSpecialFolderPathA" => {
            let (buf, csidl) = if name.starts_with("SHGetSpecial") { (e.arg(1), e.arg(2) as u32) } else { (e.arg(4), e.arg(1) as u32) };
            let p = match csidl & 0xFF {
                0x26 => "C:\\Program Files",
                0x2A => "C:\\Program Files (x86)",
                0x2B => "C:\\Program Files\\Common Files",
                0x1A => "C:\\InkSoC\\AppData\\Roaming",
                0x1C => "C:\\InkSoC\\AppData\\Local",
                0x23 => "C:\\ProgramData",
                0x24 => "C:\\Windows",
                0x25 | 0x29 => "C:\\Windows\\System32",
                0x14 => "C:\\Windows\\Fonts",
                0x05 => "C:\\InkSoC\\Documents",
                0x10 | 0x00 => "C:\\InkSoC\\Desktop",
                0x19 => "C:\\Users\\Public\\Desktop",
                0x02 => "C:\\InkSoC\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs",
                0x17 => "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
                0x0B => "C:\\InkSoC\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu",
                0x16 => "C:\\ProgramData\\Microsoft\\Windows\\Start Menu",
                _ => "C:\\InkSoC",
            };
            if name.ends_with('W') {
                for (k, c) in p.encode_utf16().chain([0]).enumerate() {
                    e.w16(buf + 2 * k as u64, c);
                }
            } else {
                let _ = e.mmu.write_bytes(buf, p.as_bytes());
                e.w8(buf + p.len() as u64, 0);
            }
            if name.starts_with("SHGetSpecial") {
                1
            } else {
                0
            }
        }
        "DebugBreak" => {
            e.set_error("the program called DebugBreak".into());
            return Some(crate::kernel32::NO_RETURN);
        }
        "GetTempFileNameW" | "GetTempFileNameA" => {
            let (pre, uniq, out) = (e.arg(1), e.arg(2) as u32, e.arg(3));
            let p = if name.ends_with('W') { e.read_wstr(pre, 3) } else { e.read_cstr(pre, 3) };
            let dir = if name.ends_with('W') { e.read_wstr(a0, 260) } else { e.read_cstr(a0, 260) };
            let dir = if dir.is_empty() { crate::files::home_win() } else { dir.trim_end_matches('\\').to_string() };
            let mut n = if uniq != 0 { uniq } else { ((crate::now_ms() as u32) & 0xFFFF).max(1) };
            let mut s = format!("{}\\{}{:04X}.tmp", dir, p, n);
            // uUnique 0: a new name, and the file is made (empty), as Windows does
            if uniq == 0 {
                while crate::files::key_of(&s).map_or(false, |k| e.s.files.contains_key(&k)) {
                    n = n % 0xFFFF + 1;
                    s = format!("{}\\{}{:04X}.tmp", dir, p, n);
                }
                if let Some(k) = crate::files::key_of(&s) {
                    e.s.files.insert(k.clone(), Vec::new());
                    e.s.fs.written.insert(k.clone());
                    e.note_case(&k, &s);
                }
            }
            if name.ends_with('W') {
                e.out_w(out, 260, &s);
            } else {
                e.out_a(out, 260, &s);
            }
            n as u64
        }
        "GetTempPathA" => {
            let b = e.arg(1);
            e.out_a(b, a0, "C:\\InkSoC\\")
        }
        "GetTempPath2W" => {
            let b = e.arg(1);
            e.out_w(b, a0, "C:\\InkSoC\\")
        }
        _ => return e.not_mine(),
    })
}
