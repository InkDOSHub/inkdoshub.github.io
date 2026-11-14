// Windows sockets: the AFD device that Wine's ws2_32 talks to (NtDeviceIoControlFile on
// \Device\Afd handles), and ws2_32's Unix side (name lookups).
//
// A browser cannot open TCP connections, so the bytes go through the page: the engine
// queues [op u8][id u32][len u32][data] records (1 connect "host:port", 2 data, 3 close),
// the page sends them over the wisp tunnel (a WebSocket to our server, which opens the real
// connection) and hands back what arrives (`win_net_in`). Names are not looked up here: a
// name gets a stand-in address 198.18.x.y, and a connection to it asks the tunnel for the
// name itself (the server looks it up). Only TCP over IPv4 for now.

use crate::files::Handle;
use crate::status::*;
use crate::Engine;
use std::collections::{BTreeMap, VecDeque};

const DEVICE_NOT_READY: u64 = 0xC000_00A3; // WSAEWOULDBLOCK
const CONNECTION_RESET: u64 = 0xC000_020D;
const CONNECTION_REFUSED: u64 = 0xC000_0236;
const INVALID_CONNECTION: u64 = 0xC000_0140; // WSAENOTCONN

// AFD poll bits (wine/afd.h)
const POLL_READ: u32 = 0x1;
const POLL_WRITE: u32 = 0x4;
const POLL_HUP: u32 = 0x8;
const POLL_RESET: u32 = 0x10;
const POLL_CLOSE: u32 = 0x20;
const POLL_CONNECT: u32 = 0x40;
const POLL_CONNECT_ERR: u32 = 0x100;

/// Where a socket stands.
#[derive(Clone, Copy, PartialEq)]
enum St {
    New,
    Open,
    /// the other side closed (what was received can still be read)
    Closed,
    /// the connection failed or was reset
    Failed,
}

pub struct Sock {
    family: u32,
    ty: u32,
    proto: u32,
    nb: bool,
    st: St,
    rx: VecDeque<u8>,
    peer: [u8; 16],
    port: u16,
    /// WSAEventSelect: the event, the events asked for, and those already reported
    ev: u64,
    ev_mask: u32,
    ev_seen: u32,
    ev_pending: u32,
    pid: u32,
}

/// An I/O call waiting for the network.
pub(crate) struct Pend {
    pid: u32,
    sock: u32,
    kind: Kind,
    iosb: u64,
    event: u64,
}
enum Kind {
    Recv { bufs: u64, count: u32, flags: u64 },
    Poll { params: u64, out: u64, deadline: f64 },
}

#[derive(Default)]
pub struct Net {
    socks: BTreeMap<u32, Sock>,
    next: u32,
    pub(crate) pend: Vec<Pend>,
    out: Vec<u8>,
    /// names given stand-in addresses: 198.18.(k >> 8).(k & 255) is names[k - 1]
    names: Vec<String>,
}

fn record(out: &mut Vec<u8>, op: u8, id: u32, d: &[u8]) {
    out.push(op);
    out.extend_from_slice(&id.to_le_bytes());
    out.extend_from_slice(&(d.len() as u32).to_le_bytes());
    out.extend_from_slice(d);
}

impl Net {
    /// The stand-in IPv4 address of a name (or the address the name spells).
    fn addr_of(&mut self, name: &str) -> [u8; 4] {
        let n = name.trim_end_matches('.').to_lowercase();
        if n == "localhost" {
            return [127, 0, 0, 1];
        }
        if let Some(a) = parse_ipv4(&n) {
            return a;
        }
        let k = match self.names.iter().position(|x| *x == n) {
            Some(k) => k,
            None => {
                self.names.push(n);
                self.names.len() - 1
            }
        } + 1;
        [198, 18, (k >> 8) as u8, k as u8]
    }
    /// The name behind an address (the address itself when it is not a stand-in).
    fn host_of(&self, a: [u8; 4]) -> String {
        if a[0] == 198 && a[1] == 18 {
            let k = ((a[2] as usize) << 8) | a[3] as usize;
            if let Some(n) = k.checked_sub(1).and_then(|i| self.names.get(i)) {
                return n.clone();
            }
        }
        format!("{}.{}.{}.{}", a[0], a[1], a[2], a[3])
    }
    /// What is true of a socket now, as AFD poll bits.
    fn ready(s: &Sock) -> u32 {
        match s.st {
            St::New => 0,
            St::Open => POLL_WRITE | POLL_CONNECT | if s.rx.is_empty() { 0 } else { POLL_READ },
            St::Closed => POLL_WRITE | POLL_CONNECT | POLL_HUP | POLL_CLOSE | if s.rx.is_empty() { 0 } else { POLL_READ },
            St::Failed => POLL_RESET | POLL_CONNECT_ERR | POLL_CLOSE,
        }
    }
}

fn parse_ipv4(s: &str) -> Option<[u8; 4]> {
    let p: Vec<&str> = s.split('.').collect();
    if p.len() != 4 {
        return None;
    }
    let mut a = [0u8; 4];
    for (i, x) in p.iter().enumerate() {
        a[i] = x.parse().ok()?;
    }
    Some(a)
}

/// The page asks for what the sockets want to send.
#[no_mangle]
pub extern "C" fn win_net_poll() -> u32 {
    let e = crate::eng();
    let _g = crate::lock::lock();
    if e.s.net.out.is_empty() {
        return 0;
    }
    crate::set_out(std::mem::take(&mut e.s.net.out))
}

/// The page hands over what arrived for socket `id`: kind 1 = bytes (in the buffer),
/// 2 = closed by the other side, 3 = could not connect.
#[no_mangle]
pub extern "C" fn win_net_in(id: u32, kind: u32) {
    let e = crate::eng();
    let _g = crate::lock::lock();
    let b = unsafe { crate::take_buf() };
    let Some(s) = e.s.net.socks.get_mut(&id) else { return };
    match kind {
        1 => s.rx.extend(b),
        2 => {
            if s.st == St::Open {
                s.st = St::Closed;
            }
        }
        _ => s.st = St::Failed,
    }
}

impl Engine {
    fn sock_of(&self, h: u64) -> Option<u32> {
        match self.s.fs.handles.get(&h) {
            Some(Handle::Afd { id }) => Some(*id),
            _ => None,
        }
    }

    /// \Device\Afd opened: a new socket, not created yet (IOCTL_AFD_WINE_CREATE says what kind).
    pub(crate) fn afd_open(&mut self) -> u64 {
        let n = &mut self.s.net;
        n.next += 1;
        let id = n.next;
        n.socks.insert(id, Sock { family: 2, ty: 1, proto: 6, nb: false, st: St::New, rx: VecDeque::new(), peer: [0; 16], port: 0, ev: 0, ev_mask: 0, ev_seen: 0, ev_pending: 0, pid: self.s.wpid });
        self.new_handle(Handle::Afd { id })
    }

    /// The handle of a socket is closed: the connection goes too.
    pub(crate) fn afd_close(&mut self, id: u32) {
        let n = &mut self.s.net;
        if let Some(s) = n.socks.remove(&id) {
            if s.st == St::Open || s.st == St::Closed {
                record(&mut n.out, 3, id, &[]);
            }
        }
        n.pend.retain(|p| p.sock != id);
    }

    /// NtDeviceIoControlFile on a socket: (handle, event, apc, apc context, iosb, code, in, in size, out, out size).
    pub(crate) fn afd_ioctl(&mut self, h: u64) -> Option<u64> {
        let id = self.sock_of(h)?;
        let (event, iosb, code) = (self.arg(1), self.arg(4), self.arg(5) as u32);
        let (inp, inl, out, outl) = (self.arg(6), self.arg(7) as u32 as u64, self.arg(8), self.arg(9) as u32 as u64);
        let r = match code {
            0x12_0320 => self.afd_create(id, inp),
            0x12_032C => self.afd_connect(id, inp, inl),
            0x12_0330 => self.afd_shutdown(id, inp),
            0x12_0334 => self.afd_recvmsg(id, inp, iosb, event),
            0x12_0338 => self.afd_sendmsg(id, inp, iosb, event),
            0x12_0344 => {
                // FIONBIO
                let on = self.r32(inp) != 0;
                if let Some(s) = self.s.net.socks.get_mut(&id) {
                    s.nb = on;
                }
                (OK, 0)
            }
            0x12_0348 => (self.r32(inp) as u64, 0), // complete an async call user mode already finished
            0x12_034C => {
                // FIONREAD
                let n = self.s.net.socks.get(&id).map_or(0, |s| s.rx.len() as u32);
                self.w32(out, n);
                (OK, 4)
            }
            0x12_0360 => self.afd_name(id, out, outl, true),
            0x1_202F => self.afd_name(id, out, outl, false),
            0x12_0368 => {
                // GET_INFO: family, type, protocol
                let (f, t, p) = self.s.net.socks.get(&id).map_or((2, 1, 6), |s| (s.family, s.ty, s.proto));
                self.w32(out, f);
                self.w32(out + 4, t);
                self.w32(out + 8, p);
                (OK, 12)
            }
            0x12_0378 => {
                // SO_ERROR
                let failed = self.s.net.socks.get(&id).map_or(false, |s| s.st == St::Failed);
                self.w32(out, if failed { 10061 } else { 0 });
                (OK, 4)
            }
            0x1_2003 => {
                // bind: the address asked for is the address got
                let n = inl.saturating_sub(4).min(outl);
                let mut v = vec![0u8; n as usize];
                let _ = self.mmu.read_bytes(inp + 4, &mut v);
                let _ = self.mmu.write_bytes(out, &v);
                if n >= 4 {
                    let port = u16::from_be_bytes([v[2], v[3]]);
                    if let Some(s) = self.s.net.socks.get_mut(&id) {
                        s.port = port;
                    }
                }
                (OK, n)
            }
            0x1_2024 => self.afd_poll(inp, inl, out, iosb, event),
            0x1_2087 => self.afd_event_select(id, inp),
            0x1_208B => self.afd_get_events(id, out),
            0x1_200B => (NOT_SUPPORTED, 0), // listen: no server sockets yet
            // socket options (IOCTL_AFD_WINE_GET_*/SET_*): taken, and read back as 0
            c if (0x12_0378..=0x12_04C0).contains(&c) => {
                if out != 0 && outl >= 4 {
                    self.w32(out, 0);
                    (OK, outl.min(4))
                } else {
                    (OK, 0)
                }
            }
            _ => {
                if unsafe { crate::WINE_DEBUG } > 0 {
                    crate::console(&format!("[afd] ioctl {:x} not handled\n", code));
                }
                (NOT_SUPPORTED, 0)
            }
        };
        if r.0 != PENDING {
            self.iosb(iosb, r.0, r.1);
        }
        Some(r.0)
    }

    fn afd_create(&mut self, id: u32, p: u64) -> (u64, u64) {
        let (family, ty, proto) = (self.r32(p), self.r32(p + 4), self.r32(p + 8));
        if family != 2 && family != 23 {
            return (0xC000_0299, 0); // STATUS_INVALID_ADDRESS_COMPONENT-like: family not supported
        }
        if let Some(s) = self.s.net.socks.get_mut(&id) {
            s.family = family;
            s.ty = ty;
            s.proto = if proto != 0 { proto } else if ty == 2 { 17 } else { 6 };
        }
        (OK, 0)
    }

    /// The IPv4 address and port of a sockaddr (an IPv4-mapped IPv6 address counts).
    fn sockaddr_v4(&mut self, a: u64, len: u64) -> Option<([u8; 4], u16)> {
        let mut b = [0u8; 28];
        let _ = self.mmu.read_bytes(a, &mut b[..(len as usize).min(28)]);
        let port = u16::from_be_bytes([b[2], b[3]]);
        match u16::from_le_bytes([b[0], b[1]]) {
            2 => Some(([b[4], b[5], b[6], b[7]], port)),
            23 if b[8..18].iter().all(|&c| c == 0) && b[18] == 0xFF && b[19] == 0xFF => Some(([b[20], b[21], b[22], b[23]], port)),
            _ => None,
        }
    }

    /// IOCTL_AFD_WINE_CONNECT (addr_len, synchronous, address): the tunnel opens the connection.
    /// It counts as made at once (the tunnel says nothing until data or a close comes).
    fn afd_connect(&mut self, id: u32, p: u64, len: u64) -> (u64, u64) {
        let alen = self.r32(p) as u64;
        let Some((ip, port)) = self.sockaddr_v4(p + 8, alen.min(len.saturating_sub(8))) else { return (CONNECTION_REFUSED, 0) };
        let host = self.s.net.host_of(ip);
        let n = &mut self.s.net;
        let Some(s) = n.socks.get_mut(&id) else { return (INVALID_HANDLE, 0) };
        if s.st != St::New {
            return (0xC000_0238, 0); // STATUS_ADDRESS_ALREADY_ASSOCIATED
        }
        if s.ty != 1 {
            return (NOT_SUPPORTED, 0); // UDP: not yet
        }
        s.st = St::Open;
        s.peer = [0; 16];
        s.peer[0] = 2;
        s.peer[2..4].copy_from_slice(&port.to_be_bytes());
        s.peer[4..8].copy_from_slice(&ip);
        record(&mut n.out, 1, id, format!("{}:{}", host, port).as_bytes());
        (OK, 0)
    }

    fn afd_shutdown(&mut self, id: u32, p: u64) -> (u64, u64) {
        let how = self.r32(p);
        // sending ends (SD_SEND / SD_BOTH): the tunnel has no half-close, so it waits for the close
        let _ = (how, id);
        (OK, 0)
    }

    /// getsockname / getpeername: 10.0.2.15 here, the address connected to there.
    fn afd_name(&mut self, id: u32, out: u64, outl: u64, peer: bool) -> (u64, u64) {
        let Some(s) = self.s.net.socks.get(&id) else { return (INVALID_HANDLE, 0) };
        if peer && s.st == St::New {
            return (INVALID_CONNECTION, 0);
        }
        let mut a = [0u8; 16];
        if peer {
            a = s.peer;
        } else {
            a[0] = 2;
            let port = if s.port != 0 { s.port } else { 49152 + (id as u16 & 0x3FFF) };
            a[2..4].copy_from_slice(&port.to_be_bytes());
            if s.st != St::New {
                a[4..8].copy_from_slice(&[10, 0, 2, 15]);
            }
        }
        let n = outl.min(16);
        let _ = self.mmu.write_bytes(out, &a[..n as usize]);
        (OK, n)
    }

    /// IOCTL_AFD_WINE_SENDMSG: the buffers go to the tunnel at once.
    fn afd_sendmsg(&mut self, id: u32, p: u64, iosb: u64, event: u64) -> (u64, u64) {
        let (force_async, count, bufs) = (self.r32(p + 16) != 0, self.r32(p + 20), self.r64(p + 24));
        let st = match self.s.net.socks.get(&id) {
            Some(s) => s.st,
            None => return (INVALID_HANDLE, 0),
        };
        match st {
            St::New => return (INVALID_CONNECTION, 0),
            St::Failed => return (CONNECTION_RESET, 0),
            _ => {}
        }
        let mut data = Vec::new();
        for i in 0..count.min(1024) as u64 {
            let (len, at) = (self.r32(bufs + 16 * i) as usize, self.r64(bufs + 16 * i + 8));
            let k = data.len();
            data.resize(k + len, 0);
            if self.mmu.read_bytes(at, &mut data[k..]).is_err() {
                return (ACCESS_VIOLATION, 0);
            }
        }
        for c in data.chunks(32 << 10) {
            record(&mut self.s.net.out, 2, id, c);
        }
        let n = data.len() as u64;
        if force_async {
            // overlapped: done now, said through the I/O block and the event as well
            self.iosb(iosb, OK, n);
            if event != 0 {
                self.event_set(event, true);
            }
        }
        (OK, n)
    }

    /// Copies what was received into the buffers; None when nothing is there yet.
    fn sock_take(&mut self, id: u32, bufs: u64, count: u32, flags: u64) -> Option<(u64, u64)> {
        let s = self.s.net.socks.get(&id)?;
        let st = s.st;
        if s.rx.is_empty() {
            return match st {
                St::Closed => Some((OK, 0)),
                St::Failed => Some((CONNECTION_RESET, 0)),
                St::New => Some((INVALID_CONNECTION, 0)),
                St::Open => None,
            };
        }
        let mut total = 0u64;
        for i in 0..count.min(1024) as u64 {
            let (len, at) = (self.r32(bufs + 16 * i) as usize, self.r64(bufs + 16 * i + 8));
            let s = self.s.net.socks.get_mut(&id)?;
            let k = len.min(s.rx.len());
            if k == 0 {
                break;
            }
            let v: Vec<u8> = s.rx.drain(..k).collect();
            if self.mmu.write_bytes(at, &v).is_err() {
                return Some((ACCESS_VIOLATION, total));
            }
            total += k as u64;
        }
        if flags != 0 {
            self.w32(flags, 0);
        }
        if let Some(s) = self.s.net.socks.get_mut(&id) {
            s.ev_seen &= !POLL_READ; // FD_READ comes again for the next data
        }
        Some((OK, total))
    }

    /// IOCTL_AFD_WINE_RECVMSG: what is there, or a wait (an error for a non-blocking socket).
    fn afd_recvmsg(&mut self, id: u32, p: u64, iosb: u64, event: u64) -> (u64, u64) {
        let (flags, force_async, count, bufs) = (self.r64(p + 24), self.r32(p + 32) != 0, self.r32(p + 36), self.r64(p + 40));
        if let Some(r) = self.sock_take(id, bufs, count, flags) {
            if force_async {
                self.iosb(iosb, r.0, r.1);
                if event != 0 {
                    self.event_set(event, true);
                }
            }
            return r;
        }
        let nb = self.s.net.socks.get(&id).map_or(false, |s| s.nb);
        if nb && !force_async {
            return (DEVICE_NOT_READY, 0);
        }
        if event != 0 {
            self.event_set(event, false);
        }
        let pid = self.s.wpid;
        self.s.net.pend.push(Pend { pid, sock: id, kind: Kind::Recv { bufs, count, flags }, iosb, event });
        (PENDING, 0)
    }

    /// The sockets of an IOCTL_AFD_POLL that are ready: written to `out`, with their count.
    fn poll_ready(&mut self, params: u64, out: u64) -> u32 {
        let count = self.r32(params + 8).min(1024) as u64;
        let mut found = Vec::new();
        for i in 0..count {
            let at = params + 16 + 16 * i;
            let (h, want) = (self.r64(at), self.r32(at + 8));
            let have = match self.sock_of(h).and_then(|id| self.s.net.socks.get(&id)) {
                Some(s) => Net::ready(s),
                None => POLL_CLOSE,
            };
            if have & want != 0 {
                found.push((h, have & want));
            }
        }
        for (k, (h, f)) in found.iter().enumerate() {
            let at = out + 16 + 16 * k as u64;
            self.w64(at, *h);
            self.w32(at + 8, *f);
            self.w32(at + 12, 0);
        }
        self.w32(out + 8, found.len() as u32);
        found.len() as u32
    }

    /// IOCTL_AFD_POLL (select, WSAPoll): ready sockets now, or a wait until some are or the time is up.
    fn afd_poll(&mut self, inp: u64, inl: u64, out: u64, iosb: u64, event: u64) -> (u64, u64) {
        let timeout = self.r64(inp) as i64;
        if out != inp {
            // METHOD_BUFFERED: the answer has the question's layout
            let mut v = vec![0u8; inl.min(16 + 16 * 1024) as usize];
            let _ = self.mmu.read_bytes(inp, &mut v);
            let _ = self.mmu.write_bytes(out, &v);
        }
        let n = self.poll_ready(inp, out);
        if n > 0 || timeout == 0 {
            return (OK, 16 + 16 * n as u64);
        }
        let now = crate::now_ms();
        let deadline = if timeout == i64::MAX {
            f64::INFINITY
        } else if timeout < 0 {
            now + (-timeout) as f64 / 10_000.0
        } else {
            now + ((timeout as u64).saturating_sub(crate::filetime_now())) as f64 / 10_000.0
        };
        if event != 0 {
            self.event_set(event, false);
        }
        let pid = self.s.wpid;
        self.s.net.pend.push(Pend { pid, sock: 0, kind: Kind::Poll { params: inp, out, deadline }, iosb, event });
        (PENDING, 0)
    }

    /// IOCTL_AFD_EVENT_SELECT (event, mask): the event is set when one of those things happens.
    fn afd_event_select(&mut self, id: u32, p: u64) -> (u64, u64) {
        let (ev, mask) = (self.r64(p), self.r32(p + 8));
        if let Some(s) = self.s.net.socks.get_mut(&id) {
            s.ev = ev;
            s.ev_mask = mask;
            s.ev_seen = 0;
            s.ev_pending = 0;
        }
        self.sock_events();
        (OK, 0)
    }

    /// IOCTL_AFD_GET_EVENTS: what happened since the last call (WSAEnumNetworkEvents).
    fn afd_get_events(&mut self, id: u32, out: u64) -> (u64, u64) {
        self.sock_events();
        let Some(s) = self.s.net.socks.get_mut(&id) else { return (INVALID_HANDLE, 0) };
        let (f, failed) = (std::mem::take(&mut s.ev_pending), s.st == St::Failed);
        self.w32(out, f);
        for i in 0..13u64 {
            let bit = 1u32 << i;
            let err = if failed && f & bit != 0 && (bit == POLL_CONNECT_ERR || bit == POLL_CLOSE) { 0xC000_0236u32 } else { 0 };
            self.w32(out + 4 + 4 * i, err);
        }
        (OK, 56)
    }

    /// Sets the events of WSAEventSelect for what became true.
    fn sock_events(&mut self) {
        let pid = self.s.wpid;
        let mut set = Vec::new();
        for s in self.s.net.socks.values_mut() {
            if s.ev == 0 || s.pid != pid {
                continue;
            }
            let mut now = Net::ready(s) & s.ev_mask;
            if now & (POLL_READ | POLL_HUP | POLL_CLOSE) != 0 && s.st == St::Closed && !s.rx.is_empty() {
                now &= !(POLL_HUP | POLL_CLOSE); // FD_CLOSE after the data was read
            }
            let new = now & !s.ev_seen;
            if new != 0 {
                s.ev_seen |= new;
                s.ev_pending |= new;
                set.push(s.ev);
            }
        }
        for ev in set {
            self.event_set(ev, true);
        }
    }

    /// Finishes waiting socket I/O that can finish now (called while threads wait).
    pub(crate) fn sock_poll(&mut self) {
        if self.s.net.socks.is_empty() {
            return;
        }
        self.sock_events();
        let pid = self.s.wpid;
        let now = crate::now_ms();
        let mut i = 0;
        while i < self.s.net.pend.len() {
            let p = &self.s.net.pend[i];
            if p.pid != pid {
                i += 1;
                continue;
            }
            let (sock, iosb, event) = (p.sock, p.iosb, p.event);
            let done = match p.kind {
                Kind::Recv { bufs, count, flags } => self.sock_take(sock, bufs, count, flags),
                Kind::Poll { params, out, deadline } => {
                    let n = self.poll_ready(params, out);
                    if n > 0 {
                        Some((OK, 16 + 16 * n as u64))
                    } else if now >= deadline {
                        Some((OK, 16))
                    } else {
                        None
                    }
                }
            };
            match done {
                Some((st, n)) => {
                    self.s.net.pend.remove(i);
                    self.iosb(iosb, st, n);
                    if event != 0 {
                        self.event_set(event, true);
                    }
                }
                None => i += 1,
            }
        }
    }

    /// When a waiting thread should look again (a poll's time limit).
    pub(crate) fn sock_deadline(&self) -> f64 {
        self.s.net.pend.iter().filter_map(|p| if let Kind::Poll { deadline, .. } = p.kind { Some(deadline) } else { None }).fold(f64::INFINITY, f64::min)
    }

    // ---------- ws2_32's Unix side (__wine_unix_call on ws2_32.dll) ----------

    pub(crate) fn ws2_call(&mut self, code: u32, p: u64) -> u64 {
        match code {
            0 => self.ws_getaddrinfo(p),
            1 => 11004, // gethostbyaddr: WSANO_DATA
            2 => self.ws_gethostbyname(p),
            3 => {
                // gethostname (name, size)
                let (name, size) = (self.r64(p), self.r32(p + 8));
                if size < 7 {
                    return 10014; // WSAEFAULT
                }
                let _ = self.mmu.write_bytes(name, b"inksoc\0");
                0
            }
            4 => self.ws_getnameinfo(p),
            _ => NOT_IMPLEMENTED,
        }
    }

    /// getaddrinfo (node, service, hints, info, size*): one IPv4 address per socket type.
    fn ws_getaddrinfo(&mut self, p: u64) -> u64 {
        let (node, service, hints, info, sizep) = (self.r64(p), self.r64(p + 8), self.r64(p + 16), self.r64(p + 24), self.r64(p + 32));
        let (mut flags, mut family, mut ty, mut proto) = (0, 0, 0, 0);
        if hints != 0 {
            flags = self.r32(hints);
            family = self.r32(hints + 4);
            ty = self.r32(hints + 8);
            proto = self.r32(hints + 12);
        }
        if family != 0 && family != 2 {
            return 11001; // WSAHOST_NOT_FOUND (no IPv6 here)
        }
        let port: u16 = if service == 0 {
            0
        } else {
            let s = self.read_cstr(service, 64).to_lowercase();
            match s.as_str() {
                "" => 0,
                "http" | "www" => 80,
                "https" => 443,
                "ftp" => 21,
                _ => match s.parse() {
                    Ok(v) => v,
                    Err(_) => return 10109, // WSATYPE_NOT_FOUND
                },
            }
        };
        let addr = if node == 0 {
            if flags & 1 != 0 { [0, 0, 0, 0] } else { [127, 0, 0, 1] } // AI_PASSIVE
        } else {
            let n = self.read_cstr(node, 256);
            if flags & 4 != 0 && parse_ipv4(&n).is_none() {
                return 11001; // AI_NUMERICHOST with a name
            }
            self.s.net.addr_of(&n)
        };
        let types: Vec<(u32, u32)> = if ty != 0 { vec![(ty, if proto != 0 { proto } else if ty == 2 { 17 } else { 6 })] } else { vec![(1, 6), (2, 17)] };
        let need = (48 + 16) * types.len() as u32;
        if self.r32(sizep) < need {
            self.w32(sizep, need);
            return 122; // ERROR_INSUFFICIENT_BUFFER
        }
        for (k, (t, pr)) in types.iter().enumerate() {
            let at = info + 64 * k as u64;
            let sa = at + 48;
            for i in 0..64 {
                self.w8(at + i, 0);
            }
            self.w32(at + 4, 2);
            self.w32(at + 8, *t);
            self.w32(at + 12, *pr);
            self.w64(at + 16, 16);
            self.w64(at + 32, sa);
            self.w64(at + 40, if k + 1 < types.len() { at + 64 } else { 0 });
            self.w16(sa, 2);
            let _ = self.mmu.write_bytes(sa + 2, &port.to_be_bytes());
            let _ = self.mmu.write_bytes(sa + 4, &addr);
        }
        0
    }

    /// gethostbyname (name, hostent, size*): the name with its one address.
    fn ws_gethostbyname(&mut self, p: u64) -> u64 {
        let (name, host, sizep) = (self.r64(p), self.r64(p + 8), self.r64(p + 16));
        let n = if name == 0 { "inksoc".to_string() } else { self.read_cstr(name, 256) };
        let addr = if name == 0 { [10, 0, 2, 15] } else { self.s.net.addr_of(&n) };
        let need = 32 + 8 + 16 + 4 + n.len() as u32 + 1;
        if self.r32(sizep) < need {
            self.w32(sizep, need);
            return 122;
        }
        // hostent: name, aliases, type, length, address list; then the lists, the address, the name
        let (aliases, list, a, s) = (host + 32, host + 40, host + 56, host + 60);
        self.w64(host, s);
        self.w64(host + 8, aliases);
        self.w16(host + 16, 2);
        self.w16(host + 18, 4);
        self.w64(host + 24, list);
        self.w64(aliases, 0);
        self.w64(list, a);
        self.w64(list + 8, 0);
        let _ = self.mmu.write_bytes(a, &addr);
        let mut b = n.into_bytes();
        b.push(0);
        let _ = self.mmu.write_bytes(s, &b);
        0
    }

    /// getnameinfo (addr, len, host, host len, serv, serv len, flags): the name behind a stand-in address, the port as a number.
    fn ws_getnameinfo(&mut self, p: u64) -> u64 {
        let (addr, len) = (self.r64(p), self.r32(p + 8) as u64);
        let (host, hl, serv, sl, flags) = (self.r64(p + 16), self.r32(p + 24) as usize, self.r64(p + 32), self.r32(p + 40) as usize, self.r32(p + 44));
        let Some((ip, port)) = self.sockaddr_v4(addr, len) else { return 10047 }; // WSAEAFNOSUPPORT
        let numeric = flags & 2 != 0; // NI_NUMERICHOST
        let h = if numeric { format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3]) } else { self.s.net.host_of(ip) };
        for (at, cap, text) in [(host, hl, h), (serv, sl, port.to_string())] {
            if at != 0 && cap > 0 {
                let mut b: Vec<u8> = text.into_bytes();
                b.truncate(cap - 1);
                b.push(0);
                let _ = self.mmu.write_bytes(at, &b);
            }
        }
        0
    }
}
