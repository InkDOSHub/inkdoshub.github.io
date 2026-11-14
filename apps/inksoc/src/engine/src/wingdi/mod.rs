// GDI: Wine's win32u drawing system calls (NtGdi*), the part Wine runs on its
// Unix side. Wine's gdi32.dll runs as program code on top of these: it keeps
// most DC state in DC_ATTR (shared with us through the GDI handle table at
// PEB+0xF8) and asks us to draw.
//
// Pixels are 0xAARRGGBB words (the layout of a 32-bit DIB). Windows draw into
// one surface per top-level window; `compose` builds the framebuffer the page
// shows, with simple classic frames, captions and menus.

use crate::winsys::{full, Rect, SCREEN_H, SCREEN_W};
use crate::Engine;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

mod bitmap;
mod calls;
mod compose;
mod objects;
mod region;
mod shapes;
mod state;
mod text;
mod view;

pub use calls::call;

const E_DC: u32 = 0x01;
const E_MEMDC: u32 = 0x41;
const E_RGN: u32 = 0x04;
const E_PAL: u32 = 0x08;
const E_BMP: u32 = 0x09;
const E_FONT: u32 = 0x0a;
const E_BRUSH: u32 = 0x10;
const E_PEN: u32 = 0x30;
const E_EXTPEN: u32 = 0x50;
const FIRST: u32 = 32;
const ATTR_SIZE: u64 = 192;

const FACE: u32 = 0xD4D0C8;
const LIGHT: u32 = 0xFFFFFF;
const SHADOW: u32 = 0x808080;
const DARK: u32 = 0x404040;
#[allow(dead_code)] // the page paints it (index.html --desk)
const DESKTOP_COLOR: u32 = 0x3A6EA5;

pub struct Bmp {
    pub w: i32,
    pub h: i32,
    pub bpp: u16,
    pub px: Vec<u32>,
    pub dib: u64, // DIB section bits (program memory), 0 = pixels kept here
    pub stride: usize,
    pub pal: Vec<u32>,
    pub topdown: bool,
    pub masks: [u32; 3],
    pub comp: u32,
}
impl Bmp {
    fn mono(&self) -> bool { self.bpp == 1 && self.dib == 0 }
}

#[derive(Clone)]
pub enum Brush { Null, Solid(u32), Hatch(u32, u32), Pat { w: i32, h: i32, px: Vec<u32>, mono: bool }, Dc }
pub struct Pen { style: u32, width: i32, color: u32, dc: bool, ext: bool }
pub struct Font { lf: Vec<u8>, fi: usize }

#[derive(Clone)]
struct Saved { attr: Vec<u8>, bmp: u64, brush: u64, pen: u64, font: u64, pal: u64, clip: Option<Rect> }

pub struct Dc {
    pub attr: u64,
    pub hwnd: u64,
    pub whole: bool,
    pub mem: bool,
    bmp: u64,
    brush: u64,
    pen: u64,
    font: u64,
    pal: u64,
    clip: Option<Rect>, // device coordinates
    vis: Option<Rect>,  // BeginPaint's update area (device coordinates)
    saved: Vec<Saved>,
}

pub enum Obj { Dc(Dc), Bmp(Bmp), Brush(Brush), Pen(Pen), Font(Font), Rgn(Rect), Pal(Vec<u32>), Other }

pub struct Surf { pub w: i32, pub h: i32, pub px: Vec<u32> }

#[derive(Default)]
pub struct Gdi {
    pub table: u64,
    objs: HashMap<u32, Obj>,
    next: u32,
    free: Vec<u32>,
    attr_next: u64,
    attr_end: u64,
    attr_free: Vec<u64>,
    pub surfs: HashMap<u64, Surf>,
    pub fb: Vec<u32>,
    sysbrush: Vec<u64>,
    syspen: Vec<u64>,
    owndc: HashMap<u64, u64>,
    unknown: HashSet<String>,
}

// ---------- fonts (Wine's Tahoma, baked by fonts/mkfont.py) ----------

pub struct FontData { pub h: i32, pub asc: i32, pub px: i32, pub bold: bool, glyphs: Vec<(u8, u8, usize)> }
static FONT_BIN: &[u8] = include_bytes!("../../fonts/tahoma.bin");

pub fn fonts() -> &'static Vec<FontData> {
    static F: OnceLock<Vec<FontData>> = OnceLock::new();
    F.get_or_init(|| {
        let b = FONT_BIN;
        let mut v = vec![];
        let mut p = 1usize;
        for i in 0..b[0] as usize {
            let len = u32::from_le_bytes([b[p], b[p + 1], b[p + 2], b[p + 3]]) as usize;
            let s = p + 4;
            let (h, asc) = (b[s] as i32, b[s + 1] as i32);
            let mut k = s + 2;
            let mut glyphs = vec![];
            for _ in 32..256 {
                let (adv, w) = (b[k], b[k + 1]);
                glyphs.push((adv, w, k + 2));
                k += 2 + w as usize * h as usize;
            }
            v.push(FontData { h, asc, px: if i < 2 { 11 } else { 16 }, bold: i % 2 == 1, glyphs });
            p = s + len;
        }
        v
    })
}

fn map_char(c: u32) -> u32 {
    match c {
        0x00A0 => 32, // no-break space: the baked fonts draw it as a space
        32..=255 => c,
        0x2018 | 0x2019 | 0x201A => '\'' as u32,
        0x201C | 0x201D | 0x201E => '"' as u32,
        0x2013 | 0x2014 | 0x2212 => '-' as u32,
        0x2022 => 0xB7,
        0x2026 => '.' as u32,
        _ if c < 32 => 0,
        _ => '?' as u32,
    }
}

/// (advance, width, offset of the alpha bytes) of a character.
fn glyph(fd: &FontData, c: u32) -> Option<(i32, i32, usize)> {
    let c = map_char(c);
    if c < 32 { return None; }
    let (a, w, o) = fd.glyphs[(c - 32) as usize];
    Some((a as i32, w as i32, o))
}

pub fn char_adv(fi: usize, c: u32) -> i32 { glyph(&fonts()[fi], c).map_or(0, |g| g.0) }

pub fn text_width(fi: usize, s: &str) -> i32 { s.chars().map(|c| char_adv(fi, c as u32)).sum() }

/// Which baked font a LOGFONTW asks for.
fn pick_font(height: i32, weight: i32) -> usize {
    let cell = if height < 0 { -height * 5 / 4 } else if height == 0 { 14 } else { height };
    (if cell >= 18 { 2 } else { 0 }) + (weight >= 600) as usize
}

// ---------- pixels ----------

/// COLORREF (0x00BBGGRR) to a pixel (0x00RRGGBB).
pub fn rgb(c: u32) -> u32 {
    if c >> 24 == 1 { return default_pal()[(c & 0xFF) as usize % 20]; } // PALETTEINDEX
    ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF)
}
fn colorref(p: u32) -> u32 { ((p & 0xFF) << 16) | (p & 0xFF00) | ((p >> 16) & 0xFF) }

fn default_pal() -> [u32; 20] {
    [0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xC0C0C0, 0xC0DCC0, 0xA6CAF0,
     0xFFFBF0, 0xA0A0A4, 0x808080, 0xFF0000, 0x00FF00, 0xFFFF00, 0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF]
}

fn lum(p: u32) -> u32 { (((p >> 16) & 0xFF) * 3 + ((p >> 8) & 0xFF) * 6 + (p & 0xFF)) / 10 }

fn rop3(rop: u8, p: u32, s: u32, d: u32) -> u32 {
    match rop {
        0xCC => s,
        0xF0 => p & 0xFFFFFF,
        0xAA => d,
        0x00 => 0,
        0xFF => 0xFFFFFF,
        0x66 => (s ^ d) & 0xFFFFFF,
        0x88 => (s & d) & 0xFFFFFF,
        0xEE => (s | d) & 0xFFFFFF,
        0x5A => (p ^ d) & 0xFFFFFF,
        0x55 => !d & 0xFFFFFF,
        0x33 => !s & 0xFFFFFF,
        0x44 => (s & !d) & 0xFFFFFF,
        0x11 => !(s | d) & 0xFFFFFF,
        0xBB => (!s | d) & 0xFFFFFF,
        0xC0 => (p & s) & 0xFFFFFF,
        0xFB => (p | !s | d) & 0xFFFFFF,
        0xB8 => ((p ^ d) & s ^ p) & 0xFFFFFF,
        0xE2 => ((p ^ d) & s ^ d) & 0xFFFFFF,
        _ => {
            let mut r = 0u32;
            for i in 0..8 {
                if rop >> i & 1 != 0 {
                    r |= (if i & 4 != 0 { p } else { !p }) & (if i & 2 != 0 { s } else { !s }) & (if i & 1 != 0 { d } else { !d });
                }
            }
            r & 0xFFFFFF
        }
    }
}

fn rop2(r: u32, p: u32, d: u32) -> u32 {
    match r {
        13 => p,
        7 => (p ^ d) & 0xFFFFFF,
        6 => !d & 0xFFFFFF,
        11 => d,
        _ => {
            let f = r.wrapping_sub(1) & 15;
            let mut o = 0u32;
            for i in 0..4 {
                if f >> i & 1 != 0 { o |= (if i & 2 != 0 { p } else { !p }) & (if i & 1 != 0 { d } else { !d }); }
            }
            o & 0xFFFFFF
        }
    }
}

/// A drawing target: a top-level window's surface or a bitmap.
#[derive(Clone, Copy, PartialEq)]
enum Tgt { None, Surf(u64), Bmp(u32) }

#[derive(Clone, Copy)]
struct View { tgt: Tgt, ox: i32, oy: i32, clip: Rect, attr: u64, mono: bool }

/// A brush resolved for one drawing operation.
enum Be { None, Solid(u32), Hatch(u32, u32, Option<u32>), Pat { w: i32, h: i32, px: Vec<u32>, ox: i32, oy: i32 } }
fn be_at(b: &Be, x: i32, y: i32) -> Option<u32> {
    match b {
        Be::None => None,
        Be::Solid(c) => Some(*c),
        Be::Hatch(st, fg, bg) => {
            let (u, v) = (x & 7, y & 7);
            let on = match st { 0 => v == 0, 1 => u == 0, 2 => (u - v) & 7 == 0, 3 => (u + v) & 7 == 7, 4 => u == 0 || v == 0, _ => (u - v) & 7 == 0 || (u + v) & 7 == 7 };
            if on { Some(*fg) } else { *bg }
        }
        Be::Pat { w, h, px, ox, oy } => {
            if *w <= 0 || *h <= 0 { return None; }
            let (u, v) = ((x - ox).rem_euclid(*w), (y - oy).rem_euclid(*h));
            Some(px[(v * w + u) as usize])
        }
    }
}

// ---------- DIB formats ----------

struct Fmt { w: i32, h: i32, bpp: u16, masks: [u32; 3], pal: Vec<u32>, comp: u32, hdr: u32 }
impl Fmt {
    fn stride(&self) -> usize { ((self.w.unsigned_abs() as usize * self.bpp as usize + 31) / 32) * 4 }
}

fn chan(v: u32, m: u32) -> u32 {
    if m == 0 { return 0; }
    let sh = m.trailing_zeros();
    let bits = (m >> sh).count_ones();
    let x = (v & m) >> sh;
    if bits >= 8 { x >> (bits - 8) } else { x * 255 / ((1 << bits) - 1) }
}
fn unchan(c: u32, m: u32) -> u32 {
    if m == 0 { return 0; }
    let sh = m.trailing_zeros();
    let bits = (m >> sh).count_ones();
    let x = if bits >= 8 { c << (bits - 8) } else { c >> (8 - bits) };
    (x << sh) & m
}

fn decode(b: &[u8], f: &Fmt, rows: i32, topdown: bool) -> Vec<u32> {
    let w = f.w.abs();
    let stride = f.stride();
    let mut out = vec![0u32; (w * rows).max(0) as usize];
    let std_masks = f.masks == [0xFF0000, 0xFF00, 0xFF];
    let pal = |i: usize| -> u32 { f.pal.get(i).copied().unwrap_or(if i == 0 { 0 } else { 0xFFFFFF }) };
    for row in 0..rows {
        let sy = if topdown { row } else { rows - 1 - row } as usize;
        let Some(line) = b.get(sy * stride..(sy + 1) * stride) else { continue };
        let o = &mut out[(row * w) as usize..((row + 1) * w) as usize];
        match f.bpp {
            32 => for x in 0..w as usize {
                let v = u32::from_le_bytes([line[4 * x], line[4 * x + 1], line[4 * x + 2], line[4 * x + 3]]);
                o[x] = if std_masks { v } else { (chan(v, f.masks[0]) << 16) | (chan(v, f.masks[1]) << 8) | chan(v, f.masks[2]) };
            },
            24 => for x in 0..w as usize { o[x] = (line[3 * x + 2] as u32) << 16 | (line[3 * x + 1] as u32) << 8 | line[3 * x] as u32; },
            16 => for x in 0..w as usize {
                let v = u16::from_le_bytes([line[2 * x], line[2 * x + 1]]) as u32;
                o[x] = (chan(v, f.masks[0]) << 16) | (chan(v, f.masks[1]) << 8) | chan(v, f.masks[2]);
            },
            8 => for x in 0..w as usize { o[x] = pal(line[x] as usize); },
            4 => for x in 0..w as usize { o[x] = pal(((line[x / 2] >> (4 - 4 * (x & 1))) & 15) as usize); },
            1 => for x in 0..w as usize { o[x] = pal(((line[x / 8] >> (7 - (x & 7))) & 1) as usize); },
            _ => {}
        }
    }
    out
}

fn nearest(pal: &[u32], c: u32, cache: &mut HashMap<u32, u8>) -> u8 {
    if let Some(&i) = cache.get(&c) { return i; }
    let (r, g, b) = ((c >> 16 & 0xFF) as i32, (c >> 8 & 0xFF) as i32, (c & 0xFF) as i32);
    let mut best = (i32::MAX, 0u8);
    for (i, &p) in pal.iter().enumerate() {
        let d = (r - (p >> 16 & 0xFF) as i32).pow(2) + (g - (p >> 8 & 0xFF) as i32).pow(2) + (b - (p & 0xFF) as i32).pow(2);
        if d < best.0 { best = (d, i as u8); }
    }
    cache.insert(c, best.1);
    best.1
}

fn encode(px: &[u32], f: &Fmt, rows: i32, topdown: bool) -> Vec<u8> {
    let w = f.w.abs();
    let stride = f.stride();
    let mut out = vec![0u8; stride * rows.max(0) as usize];
    let mut cache = HashMap::new();
    let std_masks = f.masks == [0xFF0000, 0xFF00, 0xFF];
    for row in 0..rows {
        let sy = if topdown { row } else { rows - 1 - row } as usize;
        let line = &mut out[sy * stride..(sy + 1) * stride];
        let Some(src) = px.get((row * w) as usize..((row + 1) * w) as usize) else { continue };
        for (x, &c) in src.iter().enumerate() {
            let (r, g, b) = (c >> 16 & 0xFF, c >> 8 & 0xFF, c & 0xFF);
            match f.bpp {
                32 => { let v = if std_masks { c } else { unchan(r, f.masks[0]) | unchan(g, f.masks[1]) | unchan(b, f.masks[2]) }; line[4 * x..4 * x + 4].copy_from_slice(&v.to_le_bytes()); }
                24 => { line[3 * x] = b as u8; line[3 * x + 1] = g as u8; line[3 * x + 2] = r as u8; }
                16 => { let v = (unchan(r, f.masks[0]) | unchan(g, f.masks[1]) | unchan(b, f.masks[2])) as u16; line[2 * x..2 * x + 2].copy_from_slice(&v.to_le_bytes()); }
                8 => line[x] = nearest(&f.pal, c & 0xFFFFFF, &mut cache),
                4 => { let i = nearest(&f.pal, c & 0xFFFFFF, &mut cache) & 15; line[x / 2] |= i << (4 - 4 * (x & 1)); }
                1 => { if nearest(&f.pal, c & 0xFFFFFF, &mut cache) & 1 != 0 { line[x / 8] |= 0x80 >> (x & 7); } }
                _ => {}
            }
        }
    }
    out
}

/// A palette for reading bitmaps back at 8 bits or less.
fn std_palette(bpp: u16) -> Vec<u32> {
    match bpp {
        1 => vec![0, 0xFFFFFF],
        4 => { let p = default_pal(); vec![p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[12], p[13], p[14], p[15], p[16], p[17], p[18], p[19]] }
        _ => {
            let mut v: Vec<u32> = default_pal()[..10].to_vec();
            for r in 0..6u32 { for g in 0..6u32 { for b in 0..6u32 { v.push((r * 51) << 16 | (g * 51) << 8 | b * 51); } } }
            while v.len() < 246 { let k = (v.len() as u32 - 226) * 10; v.push(k << 16 | k << 8 | k); }
            v.extend_from_slice(&default_pal()[10..]);
            v.truncate(256);
            v
        }
    }
}

// ---------- engine side ----------

fn idx(h: u64) -> u32 { (h & 0xFFFF) as u32 }


fn sys_color_px(i: u32) -> u32 {
    const C: [u32; 31] = [
        0xC8D0D4, 0x808000, 0x6A240A, 0x808080, 0xC8D0D4, 0xFFFFFF, 0x000000, 0x000000, 0x000000, 0xFFFFFF,
        0xC8D0D4, 0xC8D0D4, 0x808080, 0x6A240A, 0xFFFFFF, 0xC8D0D4, 0x808080, 0x808080, 0x000000, 0xC8D0D4,
        0xFFFFFF, 0x404040, 0xC8D0D4, 0x000000, 0xE1FFFF, 0xB5B5B5, 0x800000, 0xF0CAA6, 0xC0C0C0, 0x6A240A, 0xC8D0D4,
    ];
    rgb(C.get(i as usize).copied().unwrap_or(0))
}

fn mk_lf(h: i32, weight: i32, face: &str) -> Vec<u8> {
    let mut v = vec![0u8; 92];
    v[0..4].copy_from_slice(&h.to_le_bytes());
    v[16..20].copy_from_slice(&weight.to_le_bytes());
    for (i, c) in face.encode_utf16().take(31).enumerate() { v[28 + 2 * i..30 + 2 * i].copy_from_slice(&c.to_le_bytes()); }
    v
}

fn draw_glyph(px: &mut [u32], sw: i32, clip: Rect, fd: &FontData, gw: i32, off: usize, x: i32, y: i32, color: u32, italic: bool) {
    for gy in 0..fd.h {
        let sl = if italic { (fd.asc - gy) / 4 } else { 0 };
        for gx in 0..gw {
            let a = FONT_BIN[off + (gy * gw + gx) as usize] as u32;
            if a == 0 { continue; }
            let (xx, yy) = (x + gx + sl, y + gy);
            if !clip.has(xx, yy) { continue; }
            let i = (yy * sw + xx) as usize;
            px[i] = if a >= 250 { color } else {
                let d = px[i];
                let m = |s: u32| ((((color >> s) & 0xFF) * a + ((d >> s) & 0xFF) * (255 - a)) / 255) << s;
                m(16) | m(8) | m(0)
            };
        }
    }
}

/// Simple drawing on a raw pixel buffer (frames, captions, menus).
struct Cv<'a> { px: &'a mut Vec<u32>, w: i32, clip: Rect }
impl<'a> Cv<'a> {
    fn put(&mut self, x: i32, y: i32, c: u32) { if self.clip.has(x, y) { self.px[(y * self.w + x) as usize] = c; } }
    fn fill(&mut self, r: Rect, c: u32) {
        let r = r.inter(&self.clip);
        if r.l >= r.r { return; } // empty, or a window narrower than its frame
        for y in r.t..r.b { self.px[(y * self.w + r.l) as usize..(y * self.w + r.r) as usize].fill(c); }
    }
    fn frame(&mut self, r: Rect, c: u32) {
        self.fill(Rect::new(r.l, r.t, r.r, r.t + 1), c); self.fill(Rect::new(r.l, r.b - 1, r.r, r.b), c);
        self.fill(Rect::new(r.l, r.t, r.l + 1, r.b), c); self.fill(Rect::new(r.r - 1, r.t, r.r, r.b), c);
    }
    /// A one-pixel 3D edge: `tl` on the top and left, `br` on the bottom and right.
    fn edge(&mut self, r: Rect, tl: u32, br: u32) {
        self.fill(Rect::new(r.l, r.t, r.r, r.t + 1), tl); self.fill(Rect::new(r.l, r.t, r.l + 1, r.b), tl);
        self.fill(Rect::new(r.l, r.b - 1, r.r, r.b), br); self.fill(Rect::new(r.r - 1, r.t, r.r, r.b), br);
    }
    fn text(&mut self, room: Rect, x: i32, y: i32, s: &str, fi: usize, c: u32) {
        let fd = &fonts()[fi];
        let clip = self.clip.inter(&room);
        let mut cx = x;
        for ch in s.chars() {
            if let Some((adv, gw, off)) = glyph(fd, ch as u32) { draw_glyph(self.px, self.w, clip, fd, gw, off, cx, y, c, false); cx += adv; }
        }
    }
}

trait Inset { fn inset(&self, k: i32) -> Rect; }
impl Inset for Rect { fn inset(&self, k: i32) -> Rect { Rect::new(self.l + k, self.t + k, self.r - k, self.b - k) } }


impl Engine {
    fn set_bitmap_bits(&mut self, hb: u64, bits: u64, n: u32) -> u64 {
        let t = Tgt::Bmp(idx(hb));
        let (bpp, w, h) = match self.s.gdi.objs.get(&idx(hb)) { Some(Obj::Bmp(b)) => (b.bpp, b.w, b.h), _ => return 0 };
        let stride = ((w as usize * bpp as usize + 15) / 16) * 2;
        let total = (stride * h as usize).min(n as usize);
        let raw = self.bytes(bits, total);
        let f = Fmt { w, h, bpp, masks: if bpp == 16 { [0xF800, 0x7E0, 0x1F] } else { [0xFF0000, 0xFF00, 0xFF] }, pal: if bpp == 1 { vec![0, 0xFFFFFF] } else { std_palette(8) }, comp: 0, hdr: 0 };
        // DDB rows are WORD aligned: widen to DWORD rows for the decoder
        let s4 = f.stride();
        let rows = total / stride.max(1);
        let mut buf = vec![0u8; s4 * h as usize];
        for y in 0..rows { let k = stride.min(s4); buf[y * s4..y * s4 + k].copy_from_slice(&raw[y * stride..y * stride + k]); }
        let px = decode(&buf, &f, h, true);
        let (_, _, _) = self.take(t);
        self.give(t, px, true);
        total as u64
    }
}

// ---------- page side ----------

/// The framebuffer (RGBA, SCREEN_W x SCREEN_H) when it changed, else 0.
#[no_mangle]
pub extern "C" fn win_frame() -> u32 {
    let e = crate::eng();
    let _g = crate::lock::lock();
    if !e.s.win.dirty || e.s.win.tops.is_empty() { return 0; }
    e.s.win.dirty = false;
    e.compose();
    e.s.gdi.fb.as_ptr() as u32
}

/// Visible top-level windows (the page shows the screen when there is one).
#[no_mangle]
pub extern "C" fn win_count() -> u32 {
    let e = crate::eng();
    let _g = crate::lock::lock();
    let tops = e.s.win.tops.clone();
    tops.iter().filter(|&&t| e.wnd(t).map_or(false, |w| w.style & 0x1000_0000 != 0)).count() as u32
}

#[no_mangle]
pub extern "C" fn win_size() -> u32 { ((SCREEN_W as u32) << 16) | SCREEN_H as u32 }

/// Mouse and keyboard from the page: kind 1 move, 2 down, 3 up (data = button),
/// 4 key down, 5 key up (data = virtual key | character << 16).
#[no_mangle]
pub extern "C" fn win_input(kind: u32, x: i32, y: i32, data: u32) {
    let e = crate::eng();
    let _g = crate::lock::lock();
    e.input(kind, x, y, data);
}
