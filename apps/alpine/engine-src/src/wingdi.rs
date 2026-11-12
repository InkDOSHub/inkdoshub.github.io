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
static FONT_BIN: &[u8] = include_bytes!("../fonts/tahoma.bin");

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
        32..=255 => c,
        0x2018 | 0x2019 | 0x201A => '\'' as u32,
        0x201C | 0x201D | 0x201E => '"' as u32,
        0x2013 | 0x2014 | 0x2212 => '-' as u32,
        0x2022 => 0xB7,
        0x2026 => '.' as u32,
        0x00A0 => 32,
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

impl Engine {
    fn g16(&mut self, a: u64) -> u32 { self.mmu.read16(a).unwrap_or(0) as u32 }
    fn g32(&mut self, a: u64) -> u32 { self.mmu.read32(a).unwrap_or(0) }
    fn g64(&mut self, a: u64) -> u64 { self.mmu.read64(a).unwrap_or(0) }
    fn s16(&mut self, a: u64, v: u32) { if a != 0 { let _ = self.mmu.write16(a, v as u16); } }
    fn s32(&mut self, a: u64, v: u32) { if a != 0 { let _ = self.mmu.write32(a, v); } }
    fn s64(&mut self, a: u64, v: u64) { if a != 0 { let _ = self.mmu.write64(a, v); } }
    fn bytes(&mut self, a: u64, n: usize) -> Vec<u8> { let mut v = vec![0u8; n]; let _ = self.mmu.read_bytes(a, &mut v); v }

    /// The GDI handle table (at PEB+0xF8) with the stock objects in Wine's slots.
    pub(crate) fn gdi_init(&mut self) {
        if self.s.gdi.table != 0 { return; }
        let Some(t) = self.reserve(0x10000 * 24) else { return };
        self.s.gdi.table = t;
        let _ = self.mmu.write64(crate::PEB + 0xF8, t);
        self.s.gdi.next = FIRST;
        for c in [0xFFFFFF, 0xC0C0C0, 0x808080, 0x404040, 0] { self.gdi_new(E_BRUSH, Obj::Brush(Brush::Solid(c))); }
        self.gdi_new(E_BRUSH, Obj::Brush(Brush::Null));
        for (s, c) in [(0, 0xFFFFFF), (0, 0), (5, 0)] { self.gdi_new(E_PEN, Obj::Pen(Pen { style: s, width: 0, color: c, dc: false, ext: false })); }
        let font = |e: &mut Engine, h: i32, wt: i32, face: &str| { let lf = mk_lf(h, wt, face); let fi = pick_font(h, wt); e.gdi_new(E_FONT, Obj::Font(Font { lf, fi })); };
        font(self, 12, 400, "Terminal"); // 9: scaled OEM
        font(self, 12, 400, "Terminal");
        font(self, 12, 400, "Courier");
        font(self, 12, 400, "MS Sans Serif");
        font(self, 16, 700, "System");
        font(self, 16, 700, "System");
        self.gdi_new(E_PAL, Obj::Pal(default_pal().to_vec()));
        font(self, 16, 400, "Fixedsys");
        font(self, -11, 400, "MS Shell Dlg");
        self.gdi_new(E_BRUSH, Obj::Brush(Brush::Dc));
        self.gdi_new(E_PEN, Obj::Pen(Pen { style: 0, width: 0, color: 0, dc: true, ext: false }));
        self.gdi_new(E_BMP, Obj::Bmp(Bmp { w: 1, h: 1, bpp: 1, px: vec![0], dib: 0, stride: 2, pal: vec![], topdown: true, masks: [0; 3], comp: 0 }));
        font(self, 16, 700, "System");
        font(self, 16, 400, "Fixedsys");
        font(self, -11, 400, "MS Shell Dlg");
        for i in FIRST..FIRST + 24 {
            let a = t + 24 * i as u64 + 12;
            let v = self.mmu.read8(a).unwrap_or(0);
            let _ = self.mmu.write8(a, v | 0x80);
        }
    }

    fn gdi_new(&mut self, ext: u32, obj: Obj) -> u64 {
        self.gdi_init();
        let g = &mut self.s.gdi;
        let i = match g.free.pop() { Some(i) => i, None => { g.next += 1; g.next - 1 } };
        if i >= 0x10000 { return 0; }
        g.objs.insert(i, obj);
        let e = g.table + 24 * i as u64;
        let gen = self.mmu.read8(e + 13).unwrap_or(0);
        let gen = if gen + 1 >= 0x80 { 1 } else { gen + 1 };
        let _ = self.mmu.write64(e, 1 + i as u64);
        let _ = self.mmu.write32(e + 8, 0);
        let _ = self.mmu.write8(e + 12, ext as u8);
        let _ = self.mmu.write8(e + 13, gen);
        let _ = self.mmu.write8(e + 14, (ext & 0x1F) as u8);
        let _ = self.mmu.write8(e + 15, 0);
        let _ = self.mmu.write64(e + 16, 0);
        i as u64 | (self.g16(e + 12) as u64) << 16
    }

    /// Full handle (with the type and generation bits) of a table slot.
    fn handle_of(&mut self, i: u32) -> u64 {
        let t = self.s.gdi.table;
        if t == 0 { return 0; }
        i as u64 | (self.g16(t + 24 * i as u64 + 12) as u64) << 16
    }
    fn stock(&mut self, i: u32) -> u64 { self.gdi_init(); self.handle_of(FIRST + i) }
    fn is_stock(&self, h: u64) -> bool { let i = idx(h); i >= FIRST && i < FIRST + 24 }

    fn gdi_free(&mut self, i: u32) {
        if self.s.gdi.objs.remove(&i).is_none() { return; }
        let e = self.s.gdi.table + 24 * i as u64;
        let _ = self.mmu.write64(e, 0);
        let _ = self.mmu.write8(e + 14, 0);
        let _ = self.mmu.write64(e + 16, 0);
        self.s.gdi.free.push(i);
    }

    fn dc(&self, h: u64) -> Option<&Dc> { match self.s.gdi.objs.get(&idx(h)) { Some(Obj::Dc(d)) => Some(d), _ => None } }
    fn dc_mut(&mut self, h: u64) -> Option<&mut Dc> { match self.s.gdi.objs.get_mut(&idx(h)) { Some(Obj::Dc(d)) => Some(d), _ => None } }

    fn attr_new(&mut self, hdc: u64) -> u64 {
        let a = match self.s.gdi.attr_free.pop() {
            Some(a) => a,
            None => {
                if self.s.gdi.attr_next + ATTR_SIZE > self.s.gdi.attr_end {
                    let Some(p) = self.reserve(0x10000) else { return 0 };
                    self.s.gdi.attr_next = p; self.s.gdi.attr_end = p + 0x10000;
                }
                self.s.gdi.attr_next += ATTR_SIZE;
                self.s.gdi.attr_next - ATTR_SIZE
            }
        };
        let _ = self.mmu.write_bytes(a, &[0u8; ATTR_SIZE as usize]);
        self.s32(a, hdc as u32);
        self.s32(a + 12, 0xFFFFFF); // background
        self.s32(a + 16, 0xFFFFFF); // DC brush
        self.s32(a + 36, 1); // GM_COMPATIBLE
        self.s32(a + 40, 1); // AD_COUNTERCLOCKWISE
        self.s16(a + 50, 2); // OPAQUE
        self.s16(a + 52, 1); // ALTERNATE
        self.s16(a + 54, 13); // R2_COPYPEN
        self.s16(a + 56, 1);
        self.s16(a + 58, 1); // BLACKONWHITE
        self.s32(a + 60, 1); // MM_TEXT
        self.s32(a + 88, 10.0f32.to_bits());
        for o in [108u64, 112, 124, 128] { self.s32(a + o, 1); }
        self.s32(a + 132, SCREEN_W as u32); self.s32(a + 136, SCREEN_H as u32);
        self.s32(a + 140, 320); self.s32(a + 144, 240);
        a
    }

    fn dc_new(&mut self, hwnd: u64, whole: bool, mem: bool) -> u64 {
        let (bmp, brush, pen, font, pal) = (if mem { self.stock(20) } else { 0 }, self.stock(0), self.stock(7), self.stock(13), self.stock(15));
        let h = self.gdi_new(if mem { E_MEMDC } else { E_DC }, Obj::Dc(Dc { attr: 0, hwnd, whole, mem, bmp, brush, pen, font, pal, clip: None, vis: None, saved: vec![] }));
        let a = self.attr_new(h);
        if let Some(d) = self.dc_mut(h) { d.attr = a; }
        let e = self.s.gdi.table + 24 * idx(h) as u64;
        self.s64(e + 16, a);
        // visible rectangle (screen coordinates)
        let r = if hwnd == 0 || mem { Rect::new(0, 0, SCREEN_W, SCREEN_H) } else { self.wnd(hwnd).map_or(Rect::default(), |w| if whole { w.wrect } else { w.crect }) };
        self.wr_rect(a + 72, r);
        h
    }

    fn dc_delete(&mut self, h: u64) {
        let i = idx(h);
        let a = match self.s.gdi.objs.get(&i) { Some(Obj::Dc(d)) => d.attr, _ => return };
        self.gdi_free(i);
        if a != 0 { self.s.gdi.attr_free.push(a); }
        self.s.gdi.owndc.retain(|_, &mut v| idx(v) != i);
    }

    /// A DC for a window (GetDC / BeginPaint), or the screen for hwnd 0.
    pub(crate) fn get_dc(&mut self, h: u64, whole: bool) -> u64 {
        let h = full(h);
        let h = if h == 0x10010 { 0 } else { h };
        if h != 0 && self.wnd(h).is_none() { return 0; }
        let own = h != 0 && !whole && self.wnd(h).map_or(false, |w| self.s.win.classes[w.class].style & 0x60 != 0);
        if own {
            if let Some(&d) = self.s.gdi.owndc.get(&h) {
                if self.dc(d).is_some() { if let Some(dc) = self.dc_mut(d) { dc.vis = None; } return d; }
            }
            let d = self.dc_new(h, false, false);
            self.s.gdi.owndc.insert(h, d);
            return d;
        }
        self.dc_new(h, whole, false)
    }

    pub(crate) fn release_dc(&mut self, hdc: u64) {
        if self.s.gdi.owndc.values().any(|&v| idx(v) == idx(hdc)) { if let Some(d) = self.dc_mut(hdc) { d.vis = None; } return; }
        if self.dc(hdc).map_or(false, |d| !d.mem) { self.dc_delete(hdc); }
    }

    pub(crate) fn dc_clip_to(&mut self, hdc: u64, r: Rect) { if let Some(d) = self.dc_mut(hdc) { d.vis = Some(r); } }

    /// Fills with a brush handle or a system color index + 1 (class brushes).
    pub(crate) fn fill_rect_brush(&mut self, hdc: u64, r: Rect, brush: u64) {
        let b = if brush != 0 && brush <= 31 { self.sys_brush(brush as u32 - 1) } else { brush };
        let Some(old) = self.dc(hdc).map(|d| d.brush) else { return };
        if let Some(d) = self.dc_mut(hdc) { d.brush = b; }
        // the rectangle is in device units: draw without the mapping
        if let Some(v) = self.view(hdc) {
            let be = self.brush_eval(b, v.attr, v.mono, v.ox, v.oy);
            self.fill_with(v, r.off(v.ox, v.oy), &be, 0xF0);
        }
        if let Some(d) = self.dc_mut(hdc) { d.brush = old; }
    }

    pub(crate) fn sys_brush(&mut self, i: u32) -> u64 {
        self.gdi_init();
        if self.s.gdi.sysbrush.is_empty() {
            for k in 0..31 {
                let c = colorref(sys_color_px(k));
                let h = self.gdi_new(E_BRUSH, Obj::Brush(Brush::Solid(c)));
                let a = self.s.gdi.table + 24 * idx(h) as u64 + 12;
                let v = self.mmu.read8(a).unwrap_or(0); let _ = self.mmu.write8(a, v | 0x80);
                let h = self.handle_of(idx(h));
                self.s.gdi.sysbrush.push(h);
            }
        }
        self.s.gdi.sysbrush.get(i as usize).copied().unwrap_or(0)
    }

    pub(crate) fn sys_pen(&mut self, i: u32) -> u64 {
        self.gdi_init();
        if self.s.gdi.syspen.is_empty() {
            for k in 0..31 {
                let c = colorref(sys_color_px(k));
                let h = self.gdi_new(E_PEN, Obj::Pen(Pen { style: 0, width: 0, color: c, dc: false, ext: false }));
                let a = self.s.gdi.table + 24 * idx(h) as u64 + 12;
                let v = self.mmu.read8(a).unwrap_or(0); let _ = self.mmu.write8(a, v | 0x80);
                let h = self.handle_of(idx(h));
                self.s.gdi.syspen.push(h);
            }
        }
        self.s.gdi.syspen.get(i as usize).copied().unwrap_or(0)
    }

    /// Creates or resizes the surface of a top-level window (keeps old pixels).
    pub(crate) fn surface_for(&mut self, h: u64) {
        let Some(w) = self.wnd(h) else { return };
        if w.parent != 0 && w.style & 0x4000_0000 != 0 { return; }
        let (nw, nh) = (w.wrect.w().clamp(0, 4096), w.wrect.h().clamp(0, 4096));
        let s = self.s.gdi.surfs.entry(full(h)).or_insert(Surf { w: 0, h: 0, px: vec![] });
        if s.w == nw && s.h == nh { return; }
        let mut px = vec![FACE; (nw * nh) as usize];
        for y in 0..nh.min(s.h) { for x in 0..nw.min(s.w) { px[(y * nw + x) as usize] = s.px[(y * s.w + x) as usize]; } }
        *s = Surf { w: nw, h: nh, px };
    }

    pub(crate) fn drop_surface(&mut self, h: u64) {
        self.s.gdi.surfs.remove(&full(h));
        if let Some(d) = self.s.gdi.owndc.remove(&full(h)) { self.dc_delete(d); }
    }

    // ---------- views, mapping, pixels ----------

    fn view(&mut self, hdc: u64) -> Option<View> {
        let (attr, hwnd, whole, mem, bmp, clip, vis) = match self.dc(hdc) { Some(d) => (d.attr, d.hwnd, d.whole, d.mem, d.bmp, d.clip, d.vis), None => return None };
        if mem {
            let bi = idx(bmp);
            let (w, h, mono) = match self.s.gdi.objs.get(&bi) { Some(Obj::Bmp(b)) => (b.w, b.h, b.mono()), _ => (0, 0, true) };
            let mut c = Rect::new(0, 0, w, h);
            if let Some(cl) = clip { c = c.inter(&cl); }
            return Some(View { tgt: Tgt::Bmp(bi), ox: 0, oy: 0, clip: c, attr, mono });
        }
        let none = View { tgt: Tgt::None, ox: 0, oy: 0, clip: Rect::default(), attr, mono: false };
        let hw = full(hwnd);
        let Some(w) = self.wnd(hw) else { return Some(none) };
        let top = self.top_of(hw);
        let Some(twr) = self.wnd(top).map(|w| w.wrect) else { return Some(none) };
        let area = if whole { w.wrect } else { w.crect };
        let mut c = area;
        let (mut p, mut child) = (w.parent, w.style & 0x4000_0000 != 0);
        while child && p != 0 {
            let Some(pw) = self.wnd(p) else { break };
            c = c.inter(&pw.crect);
            child = pw.style & 0x4000_0000 != 0;
            p = pw.parent;
        }
        c = c.inter(&twr);
        if !self.is_visible(hw) { c = Rect::default(); }
        let (ox, oy) = (area.l - twr.l, area.t - twr.t);
        let mut c = c.off(-twr.l, -twr.t);
        if let Some(v) = vis { c = c.inter(&v.off(ox, oy)); }
        if let Some(cl) = clip { c = c.inter(&cl.off(ox, oy)); }
        Some(View { tgt: Tgt::Surf(top), ox, oy, clip: c, attr, mono: false })
    }

    /// Logical to device coordinates.
    fn lp(&mut self, attr: u64, x: i32, y: i32) -> (i32, i32) {
        let mm = self.g32(attr + 60);
        let (wox, woy, vox, voy) = (self.g32(attr + 100) as i32, self.g32(attr + 104) as i32, self.g32(attr + 116) as i32, self.g32(attr + 120) as i32);
        if mm <= 1 { return (x - wox + vox, y - woy + voy); }
        let (wex, wey, vex, vey) = (self.g32(attr + 108) as i32, self.g32(attr + 112) as i32, self.g32(attr + 124) as i32, self.g32(attr + 128) as i32);
        let sx = |v: i32, we: i32, ve: i32| if we == 0 { v } else { (v as i64 * ve as i64 / we as i64) as i32 };
        (sx(x - wox, wex, vex) + vox, sx(y - woy, wey, vey) + voy)
    }
    fn dp(&mut self, attr: u64, x: i32, y: i32) -> (i32, i32) {
        let mm = self.g32(attr + 60);
        let (wox, woy, vox, voy) = (self.g32(attr + 100) as i32, self.g32(attr + 104) as i32, self.g32(attr + 116) as i32, self.g32(attr + 120) as i32);
        if mm <= 1 { return (x - vox + wox, y - voy + woy); }
        let (wex, wey, vex, vey) = (self.g32(attr + 108) as i32, self.g32(attr + 112) as i32, self.g32(attr + 124) as i32, self.g32(attr + 128) as i32);
        let sx = |v: i32, we: i32, ve: i32| if ve == 0 { v } else { (v as i64 * we as i64 / ve as i64) as i32 };
        (sx(x - vox, wex, vex) + wox, sx(y - voy, wey, vey) + woy)
    }
    fn lpr(&mut self, attr: u64, r: Rect) -> Rect {
        let (l, t) = self.lp(attr, r.l, r.t);
        let (rr, b) = self.lp(attr, r.r, r.b);
        Rect::new(l.min(rr), t.min(b), l.max(rr), t.max(b))
    }

    fn take(&mut self, t: Tgt) -> (Vec<u32>, i32, i32) {
        match t {
            Tgt::Surf(h) => match self.s.gdi.surfs.get_mut(&h) { Some(s) => (std::mem::take(&mut s.px), s.w, s.h), None => (vec![], 0, 0) },
            Tgt::Bmp(i) => {
                let (dib, f, td) = match self.s.gdi.objs.get_mut(&i) {
                    Some(Obj::Bmp(b)) => {
                        if b.dib == 0 { return (std::mem::take(&mut b.px), b.w, b.h); }
                        (b.dib, Fmt { w: b.w, h: b.h, bpp: b.bpp, masks: b.masks, pal: b.pal.clone(), comp: b.comp, hdr: 40 }, b.topdown)
                    }
                    _ => return (vec![], 0, 0),
                };
                let raw = self.bytes(dib, f.stride() * f.h as usize);
                (decode(&raw, &f, f.h, td), f.w, f.h)
            }
            Tgt::None => (vec![], 0, 0),
        }
    }

    fn give(&mut self, t: Tgt, mut px: Vec<u32>, changed: bool) {
        match t {
            Tgt::Surf(h) => {
                if let Some(s) = self.s.gdi.surfs.get_mut(&h) { if s.px.is_empty() { s.px = px; } }
                if changed { self.s.win.dirty = true; }
            }
            Tgt::Bmp(i) => {
                let Some(Obj::Bmp(b)) = self.s.gdi.objs.get_mut(&i) else { return };
                if b.dib == 0 {
                    if changed && b.bpp == 1 { for p in px.iter_mut() { *p = if lum(*p & 0xFFFFFF) >= 128 { 0xFFFFFF } else { 0 }; } }
                    if b.px.is_empty() { b.px = px; }
                } else if changed {
                    let f = Fmt { w: b.w, h: b.h, bpp: b.bpp, masks: b.masks, pal: b.pal.clone(), comp: b.comp, hdr: 40 };
                    let (dib, td) = (b.dib, b.topdown);
                    let raw = encode(&px, &f, f.h, td);
                    let _ = self.mmu.write_bytes(dib, &raw);
                }
            }
            Tgt::None => {}
        }
    }

    fn brush_eval(&mut self, brush: u64, attr: u64, mono_dst: bool, ox: i32, oy: i32) -> Be {
        let b = match self.s.gdi.objs.get(&idx(brush)) { Some(Obj::Brush(b)) => b.clone(), _ => return Be::None };
        match b {
            Brush::Null => Be::None,
            Brush::Solid(c) => Be::Solid(rgb(c)),
            Brush::Dc => Be::Solid(rgb(self.g32(attr + 16))),
            Brush::Hatch(st, c) => {
                let bg = if self.g16(attr + 50) == 2 { Some(rgb(self.g32(attr + 12))) } else { None };
                Be::Hatch(st, rgb(c), bg)
            }
            Brush::Pat { w, h, mut px, mono } => {
                if mono && !mono_dst {
                    let (fg, bg) = (rgb(self.g32(attr + 24)), rgb(self.g32(attr + 12)));
                    for p in px.iter_mut() { *p = if *p & 0xFFFFFF != 0 { bg } else { fg }; }
                }
                let (bx, by) = (self.g32(attr + 92) as i32, self.g32(attr + 96) as i32);
                Be::Pat { w, h, px, ox: ox + bx, oy: oy + by }
            }
        }
    }

    /// Fills a rectangle (target coordinates) with a brush and a ROP3 (pattern + destination only).
    fn fill_with(&mut self, v: View, r: Rect, be: &Be, rop: u8) {
        if let Be::None = be { if rop == 0xF0 { return; } }
        let (mut px, sw, sh) = self.take(v.tgt);
        let c = v.clip.inter(&Rect::new(0, 0, sw, sh)).inter(&r);
        if !c.empty() {
            for y in c.t..c.b {
                let row = (y * sw) as usize;
                if let (Be::Solid(col), 0xF0) = (be, rop) { px[row + c.l as usize..row + c.r as usize].fill(*col); continue; }
                for x in c.l..c.r {
                    let i = row + x as usize;
                    let p = match be_at(be, x, y) { Some(p) => p, None => if rop == 0xF0 || rop == 0x5A { continue } else { 0 } };
                    px[i] = rop3(rop, p, 0, px[i]);
                }
            }
        }
        self.give(v.tgt, px, !c.empty());
    }

    fn pen_eval(&mut self, hdc: u64, attr: u64) -> Option<(u32, i32, u32)> {
        let pen = self.dc(hdc)?.pen;
        let (style, width, color, dc) = match self.s.gdi.objs.get(&idx(pen)) { Some(Obj::Pen(p)) => (p.style, p.width, p.color, p.dc), _ => return None };
        if style & 0xF == 5 { return None; }
        let c = if dc { self.g32(attr + 20) } else { color };
        Some((rgb(c), width.max(1), style & 0xF))
    }

    fn rop_mode(&mut self, attr: u64) -> u32 { self.g16(attr + 54) }

    // ---------- shapes ----------

    fn shape_rect(&mut self, hdc: u64, r: Rect, round: bool) -> bool {
        let Some(v) = self.view(hdc) else { return false };
        let r = self.lpr(v.attr, r).off(v.ox, v.oy);
        let brush = self.dc(hdc).map_or(0, |d| d.brush);
        let be = self.brush_eval(brush, v.attr, v.mono, v.ox, v.oy);
        let pen = self.pen_eval(hdc, v.attr);
        let r2 = self.rop_mode(v.attr);
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let pw = pen.map_or(0, |p| p.1);
        let inner = Rect::new(r.l + pw, r.t + pw, r.r - pw, r.b - pw);
        let mut put = |x: i32, y: i32, c: u32, px: &mut Vec<u32>| { if clip.has(x, y) { let i = (y * sw + x) as usize; px[i] = rop2(r2, c, px[i]); } };
        let fill = if pen.is_none() { r } else { inner };
        for y in fill.t.max(clip.t)..fill.b.min(clip.b) {
            for x in fill.l.max(clip.l)..fill.r.min(clip.r) { if let Some(c) = be_at(&be, x, y) { put(x, y, c, &mut px); } }
        }
        if let Some((c, w, _)) = pen {
            for y in r.t..r.b {
                for x in r.l..r.r {
                    let edge = x < r.l + w || x >= r.r - w || y < r.t + w || y >= r.b - w;
                    if !edge { continue; }
                    if round && ((x == r.l || x == r.r - 1) && (y == r.t || y == r.b - 1)) { continue; }
                    put(x, y, c, &mut px);
                }
            }
        }
        self.give(v.tgt, px, true);
        true
    }

    fn ellipse(&mut self, hdc: u64, r: Rect) -> bool {
        let Some(v) = self.view(hdc) else { return false };
        let r = self.lpr(v.attr, r).off(v.ox, v.oy);
        let brush = self.dc(hdc).map_or(0, |d| d.brush);
        let be = self.brush_eval(brush, v.attr, v.mono, v.ox, v.oy);
        let pen = self.pen_eval(hdc, v.attr);
        let r2 = self.rop_mode(v.attr);
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let (cx, cy) = ((r.l + r.r) as f64 / 2.0, (r.t + r.b) as f64 / 2.0);
        let (rx, ry) = (r.w() as f64 / 2.0, r.h() as f64 / 2.0);
        let span = |y: i32, rx: f64, ry: f64| -> Option<(i32, i32)> {
            if rx <= 0.0 || ry <= 0.0 { return None; }
            let yy = (y as f64 + 0.5 - cy) / ry;
            if yy.abs() >= 1.0 { return None; }
            let h = rx * (1.0 - yy * yy).sqrt();
            Some(((cx - h).round() as i32, (cx + h).round() as i32))
        };
        let pw = pen.map_or(0, |p| p.1) as f64;
        for y in r.t..r.b {
            let Some((x0, x1)) = span(y, rx, ry) else { continue };
            let inner = span(y, rx - pw, ry - pw);
            for x in x0..x1 {
                if !clip.has(x, y) { continue; }
                let i = (y * sw + x) as usize;
                let on_edge = pen.is_some() && inner.map_or(true, |(a, b)| x < a || x >= b);
                let c = if on_edge { pen.map(|p| p.0) } else { be_at(&be, x, y) };
                if let Some(c) = c { px[i] = rop2(r2, c, px[i]); }
            }
        }
        self.give(v.tgt, px, true);
        true
    }

    /// Lines through device points (already mapped); `close` joins the last to the first.
    fn polyline_dev(&mut self, v: View, pts: &[(i32, i32)], pen: (u32, i32, u32), r2: u32, last: bool) {
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let (c, w, style) = pen;
        let mut n = 0u32;
        let mut plot = |x: i32, y: i32, px: &mut Vec<u32>| {
            n += 1;
            if style != 0 && style <= 4 && (n / 2) % 2 == 1 { return; }
            let o = w / 2;
            for yy in y - o..y - o + w { for xx in x - o..x - o + w { if clip.has(xx, yy) { let i = (yy * sw + xx) as usize; px[i] = rop2(r2, c, px[i]); } } }
        };
        for k in 1..pts.len() {
            let (mut x0, mut y0) = pts[k - 1];
            let (x1, y1) = pts[k];
            let (dx, dy) = ((x1 - x0).abs(), -(y1 - y0).abs());
            let (sx, sy) = (if x0 < x1 { 1 } else { -1 }, if y0 < y1 { 1 } else { -1 });
            let mut err = dx + dy;
            while x0 != x1 || y0 != y1 {
                plot(x0, y0, &mut px);
                let e2 = 2 * err;
                if e2 >= dy { err += dy; x0 += sx; }
                if e2 <= dx { err += dx; y0 += sy; }
            }
        }
        if last { if let Some(&(x, y)) = pts.last() { plot(x, y, &mut px); } }
        self.give(v.tgt, px, true);
    }

    fn polygon_dev(&mut self, v: View, polys: &[Vec<(i32, i32)>], be: &Be, r2: u32, winding: bool) {
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        let (mut t, mut b) = (i32::MAX, i32::MIN);
        for p in polys { for &(_, y) in p { t = t.min(y); b = b.max(y); } }
        for y in t.max(clip.t)..b.min(clip.b) {
            let fy = y as f64 + 0.5;
            let mut xs: Vec<(f64, i32)> = vec![];
            for p in polys {
                for k in 0..p.len() {
                    let (a, c) = (p[k], p[(k + 1) % p.len()]);
                    if (a.1 as f64 <= fy) != (c.1 as f64 <= fy) {
                        let x = a.0 as f64 + (fy - a.1 as f64) * (c.0 - a.0) as f64 / (c.1 - a.1) as f64;
                        xs.push((x, if c.1 > a.1 { 1 } else { -1 }));
                    }
                }
            }
            xs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            let mut wn = 0;
            for k in 0..xs.len() {
                let inside = if winding { wn += xs[k].1; wn != 0 } else { k % 2 == 0 };
                if !inside || k + 1 >= xs.len() { continue; }
                let (x0, x1) = ((xs[k].0 - 0.5).ceil() as i32, (xs[k + 1].0 - 0.5).ceil() as i32);
                for x in x0.max(clip.l)..x1.min(clip.r) {
                    if let Some(c) = be_at(be, x, y) { let i = (y * sw + x) as usize; px[i] = rop2(r2, c, px[i]); }
                }
            }
        }
        self.give(v.tgt, px, true);
    }

    fn poly_poly_draw(&mut self, hdc: u64, pts: u64, counts: u64, n: u32, func: u32) -> u64 {
        if func == 6 {
            // PolyPolygonRgn: the bounding box
            let mut r = Rect::default();
            let mut k = 0u64;
            for i in 0..n as u64 { let c = self.g32(counts + 4 * i) as u64; for j in 0..c { let (x, y) = (self.g32(pts + 8 * (k + j)) as i32, self.g32(pts + 8 * (k + j) + 4) as i32); r = r.union(&Rect::new(x, y, x + 1, y + 1)); } k += c; }
            return self.gdi_new(E_RGN, Obj::Rgn(r));
        }
        let Some(v) = self.view(hdc) else { return 0 };
        let attr = v.attr;
        let mut polys = vec![];
        let mut k = 0u64;
        let cur = (self.g32(attr + 28) as i32, self.g32(attr + 32) as i32);
        for i in 0..n as u64 {
            let c = self.g32(counts + 4 * i) as u64;
            let mut p = vec![];
            if func == 4 || func == 5 { let (x, y) = self.lp(attr, cur.0, cur.1); p.push((x + v.ox, y + v.oy)); }
            for j in 0..c {
                let (x, y) = (self.g32(pts + 8 * (k + j)) as i32, self.g32(pts + 8 * (k + j) + 4) as i32);
                let (x, y) = self.lp(attr, x, y);
                p.push((x + v.ox, y + v.oy));
            }
            k += c;
            polys.push(p);
        }
        if (func == 4 || func == 5) && k > 0 {
            let (x, y) = (self.g32(pts + 8 * (k - 1)), self.g32(pts + 8 * (k - 1) + 4));
            self.s32(attr + 28, x); self.s32(attr + 32, y);
        }
        if func == 3 || func == 4 {
            // Béziers: flatten
            for p in polys.iter_mut() {
                let mut out = vec![p[0]];
                let mut i = 1;
                while i + 2 < p.len() {
                    let (a, b, c, d) = (p[i - 1], p[i], p[i + 1], p[i + 2]);
                    for s in 1..=16 {
                        let t = s as f64 / 16.0; let u = 1.0 - t;
                        let f = |a: i32, b: i32, c: i32, d: i32| (u * u * u * a as f64 + 3.0 * u * u * t * b as f64 + 3.0 * u * t * t * c as f64 + t * t * t * d as f64).round() as i32;
                        out.push((f(a.0, b.0, c.0, d.0), f(a.1, b.1, c.1, d.1)));
                    }
                    i += 3;
                }
                *p = out;
            }
        }
        let r2 = self.rop_mode(attr);
        if func == 1 {
            let brush = self.dc(hdc).map_or(0, |d| d.brush);
            let be = self.brush_eval(brush, attr, v.mono, v.ox, v.oy);
            let winding = self.g16(attr + 52) == 2;
            self.polygon_dev(v, &polys, &be, r2, winding);
        }
        if let Some(pen) = self.pen_eval(hdc, attr) {
            for mut p in polys { if func == 1 && !p.is_empty() { p.push(p[0]); } self.polyline_dev(v, &p, pen, r2, false); }
        }
        1
    }

    // ---------- text ----------

    fn dc_font(&mut self, hdc: u64) -> (usize, Vec<u8>) {
        let f = self.dc(hdc).map_or(0, |d| d.font);
        match self.s.gdi.objs.get(&idx(f)) { Some(Obj::Font(f)) => (f.fi, f.lf.clone()), _ => (3, mk_lf(16, 700, "System")) }
    }

    fn ext_text_out(&mut self, hdc: u64, x: i32, y: i32, flags: u32, rect: u64, s: u64, n: u32, dx: u64) -> bool {
        let Some(v) = self.view(hdc) else { return false };
        let attr = v.attr;
        let (fi, lf) = self.dc_font(hdc);
        let fd = &fonts()[fi];
        let chars: Vec<u32> = (0..n as u64).map(|i| self.g16(s + 2 * i)).collect();
        let extra = self.g32(attr + 64) as i32;
        let pdy = flags & 0x2000 != 0;
        let advs: Vec<i32> = chars.iter().enumerate().map(|(i, &c)| if dx != 0 { self.g32(dx + if pdy { 8 } else { 4 } * i as u64) as i32 } else { glyph(fd, c).map_or(0, |g| g.0) + extra }).collect();
        let width: i32 = advs.iter().sum();
        let align = self.g16(attr + 48);
        let (mut x, mut y) = if align & 1 != 0 { (self.g32(attr + 28) as i32, self.g32(attr + 32) as i32) } else { (x, y) };
        if align & 1 != 0 { let nx = x + if align & 6 == 2 { -width } else { width }; self.s32(attr + 28, nx as u32); }
        match align & 6 { 6 => x -= width / 2, 2 => x -= width, _ => {} }
        match align & 24 { 24 => y -= fd.asc, 8 => y -= fd.h, _ => {} }
        let (dx0, dy0) = self.lp(attr, x, y);
        let (tx, ty) = (dx0 + v.ox, dy0 + v.oy);
        let rc = if rect != 0 { let r = self.rd_rect(rect); Some(self.lpr(attr, r).off(v.ox, v.oy)) } else { None };
        let (fg, bg) = (rgb(self.g32(attr + 24)), rgb(self.g32(attr + 12)));
        let opaque_mode = self.g16(attr + 50) == 2;
        let (mut px, sw, sh) = self.take(v.tgt);
        let mut clip = v.clip.inter(&Rect::new(0, 0, sw, sh));
        if let (Some(r), true) = (rc, flags & 2 != 0) {
            let c = clip.inter(&r);
            for yy in c.t..c.b { px[(yy * sw + c.l) as usize..(yy * sw + c.r) as usize].fill(bg); }
        }
        if let (Some(r), true) = (rc, flags & 4 != 0) { clip = clip.inter(&r); }
        if opaque_mode && !(flags & 2 != 0 && rc.is_some()) {
            let c = clip.inter(&Rect::new(tx, ty, tx + width, ty + fd.h));
            for yy in c.t..c.b { px[(yy * sw + c.l) as usize..(yy * sw + c.r) as usize].fill(bg); }
        }
        let mut cx = tx;
        for (i, &ch) in chars.iter().enumerate() {
            if let Some((_, gw, off)) = glyph(fd, ch) {
                draw_glyph(&mut px, sw, clip, fd, gw, off, cx, ty, fg, lf.get(20).copied().unwrap_or(0) != 0);
            }
            cx += advs[i];
        }
        if lf.get(21).copied().unwrap_or(0) != 0 {
            let yy = ty + fd.asc + 1;
            for xx in tx..tx + width { if clip.has(xx, yy) { px[(yy * sw + xx) as usize] = fg; } }
        }
        if lf.get(22).copied().unwrap_or(0) != 0 {
            let yy = ty + fd.asc * 2 / 3;
            for xx in tx..tx + width { if clip.has(xx, yy) { px[(yy * sw + xx) as usize] = fg; } }
        }
        self.give(v.tgt, px, true);
        true
    }

    fn text_metrics(&mut self, hdc: u64, tm: u64) -> bool {
        let (fi, lf) = self.dc_font(hdc);
        let fd = &fonts()[fi];
        let avg = glyph(fd, 'x' as u32).map_or(5, |g| g.0);
        let max = (32..256).filter_map(|c| glyph(fd, c)).map(|g| g.0).max().unwrap_or(10);
        let v: [i32; 11] = [fd.h, fd.asc, fd.h - fd.asc, fd.h - fd.px, 0, avg, max, if fd.bold { 700 } else { 400 }, 0, 96, 96];
        for (i, x) in v.iter().enumerate() { self.s32(tm + 4 * i as u64, *x as u32); }
        self.s16(tm + 44, 0x1E); self.s16(tm + 46, 0xFFFC); self.s16(tm + 48, 0x1F); self.s16(tm + 50, 0x20);
        let _ = self.mmu.write_bytes(tm + 52, &[lf.get(20).copied().unwrap_or(0), lf.get(21).copied().unwrap_or(0), lf.get(22).copied().unwrap_or(0), 0x27, 0]);
        true
    }

    // ---------- bitmaps ----------

    fn new_bmp(&mut self, w: i32, h: i32, bpp: u16) -> u64 {
        let w = w.clamp(1, 16384); let h = h.clamp(1, 16384);
        let fill = if bpp == 1 { 0 } else { 0 };
        self.gdi_new(E_BMP, Obj::Bmp(Bmp { w, h, bpp, px: vec![fill; (w * h) as usize], dib: 0, stride: 0, pal: vec![], topdown: true, masks: [0xFF0000, 0xFF00, 0xFF], comp: 0 }))
    }

    fn dib_fmt(&mut self, bmi: u64, coloruse: u32) -> Fmt {
        let size = self.g32(bmi);
        let core = size == 12;
        let (w, h, bpp, comp, used) = if core { (self.g16(bmi + 4) as i32, self.g16(bmi + 6) as i16 as i32, self.g16(bmi + 10) as u16, 0, 0) } else { (self.g32(bmi + 4) as i32, self.g32(bmi + 8) as i32, self.g16(bmi + 14) as u16, self.g32(bmi + 16), self.g32(bmi + 32)) };
        let mut masks = match bpp { 16 => [0x7C00, 0x3E0, 0x1F], _ => [0xFF0000, 0xFF00, 0xFF] };
        let mut ct = bmi + size as u64;
        if comp == 3 || comp == 6 {
            if size <= 40 { masks = [self.g32(ct), self.g32(ct + 4), self.g32(ct + 8)]; ct += 12; } else { masks = [self.g32(bmi + 40), self.g32(bmi + 44), self.g32(bmi + 48)]; }
        }
        let n = if bpp <= 8 { if used != 0 { used.min(1 << bpp) } else { 1 << bpp } } else { 0 };
        let dp = default_pal();
        let pal: Vec<u32> = (0..n as u64).map(|i| {
            if coloruse == 1 { dp[self.g16(ct + 2 * i) as usize % 20] }
            else if core { let b = self.bytes(ct + 3 * i, 3); (b[2] as u32) << 16 | (b[1] as u32) << 8 | b[0] as u32 }
            else { self.g32(ct + 4 * i) & 0xFFFFFF }
        }).collect();
        let hdr = (ct - bmi) as u32 + if coloruse == 1 { 2 * n } else if core { 3 * n } else { 4 * n };
        Fmt { w, h, bpp, masks, pal, comp, hdr }
    }

    /// Reads DIB bits: pixels top-down, width, height.
    fn read_dib(&mut self, bits: u64, f: &Fmt, start: u32, lines: u32) -> (Vec<u32>, i32, i32) {
        let (w, h) = (f.w.abs(), f.h.abs());
        let td = f.h < 0;
        if f.comp == 1 || f.comp == 2 || bits == 0 { return (vec![0; (w * h) as usize], w, h); }
        let lines = lines.min(h as u32 - start.min(h as u32)) as i32;
        let raw = self.bytes(bits, f.stride() * lines as usize);
        let part = decode(&raw, f, lines, td);
        if lines == h { return (part, w, h); }
        let mut full = vec![0u32; (w * h) as usize];
        for r in 0..lines {
            // bottom-up: scan `start + k` from the bottom
            let dst = if td { start as i32 + r } else { h - 1 - (start as i32 + (lines - 1 - r)) };
            if dst < 0 || dst >= h { continue; }
            full[(dst * w) as usize..((dst + 1) * w) as usize].copy_from_slice(&part[(r * w) as usize..((r + 1) * w) as usize]);
        }
        (full, w, h)
    }

    /// Core of every blit: copies (scaling) from a pixel buffer into a view.
    fn blit_px(&mut self, dst: u64, d: Rect, flip: (bool, bool), src: Option<(&[u32], i32, i32, bool, u32)>, s: Rect, rop: u32, mode: u32, arg: u32, mask: Option<(&[u32], i32, i32, i32, i32)>) -> bool {
        let Some(v) = self.view(dst) else { return false };
        let attr = v.attr;
        let op = (rop >> 16) as u8;
        let back = (rop >> 24) as u8;
        let uses_p = ((op >> 4) ^ op) & 0x0F != 0 || (mask.is_some() && ((back >> 4) ^ back) & 0x0F != 0);
        let brush = self.dc(dst).map_or(0, |d| d.brush);
        let be = if uses_p { self.brush_eval(brush, attr, v.mono, v.ox, v.oy) } else { Be::None };
        let (dfg, dbg) = (rgb(self.g32(attr + 24)), rgb(self.g32(attr + 12)));
        let d = d.off(v.ox, v.oy);
        let (mut px, sw, sh) = self.take(v.tgt);
        let clip = v.clip.inter(&Rect::new(0, 0, sw, sh)).inter(&d);
        if !clip.empty() && d.w() > 0 && d.h() > 0 {
            for y in clip.t..clip.b {
                let fy = if flip.1 { d.b - 1 - y } else { y - d.t };
                let sy = s.t + (fy as i64 * s.h() as i64 / d.h() as i64) as i32;
                for x in clip.l..clip.r {
                    let fx = if flip.0 { d.r - 1 - x } else { x - d.l };
                    let sx = s.l + (fx as i64 * s.w() as i64 / d.w() as i64) as i32;
                    let i = (y * sw + x) as usize;
                    let sp = match src {
                        Some((sp, w, h, smono, sbk)) => {
                            if sx < 0 || sy < 0 || sx >= w || sy >= h { if mode != 0 { continue; } 0 } else {
                                let p = sp[(sy * w + sx) as usize];
                                if smono && !v.mono { if p & 0xFFFFFF != 0 { dbg } else { dfg } }
                                else if v.mono && !smono { if p & 0xFFFFFF == sbk { 0xFFFFFF } else { 0 } }
                                else { p }
                            }
                        }
                        None => 0,
                    };
                    match mode {
                        1 => { if sp & 0xFFFFFF == arg { continue; } px[i] = sp & 0xFFFFFF; }
                        2 => {
                            let ca = (arg >> 16) & 0xFF;
                            let dp = px[i];
                            let sa = if arg >> 24 & 1 != 0 { (sp >> 24) * ca / 255 } else { ca };
                            let mut out = 0u32;
                            for sh_ in [0u32, 8, 16] {
                                let (sc, dc) = ((sp >> sh_) & 0xFF, (dp >> sh_) & 0xFF);
                                let c = if arg >> 24 & 1 != 0 { (sc * ca / 255 + dc * (255 - sa) / 255).min(255) } else { (sc * ca + dc * (255 - ca)) / 255 };
                                out |= c << sh_;
                            }
                            px[i] = out | (dp & 0xFF00_0000);
                        }
                        _ => {
                            let p = if uses_p { be_at(&be, x, y).unwrap_or(0) } else { 0 };
                            let o = match mask {
                                Some((m, mw, mh, mx, my)) => {
                                    let (u, w) = (mx + (x - d.l), my + (y - d.t));
                                    let bit = u >= 0 && w >= 0 && u < mw && w < mh && m[(w * mw + u) as usize] & 0xFFFFFF != 0;
                                    if bit { op } else { back }
                                }
                                None => op,
                            };
                            px[i] = rop3(o, p, sp, px[i]);
                        }
                    }
                }
            }
        }
        self.give(v.tgt, px, !clip.empty());
        true
    }

    /// BitBlt / StretchBlt / TransparentBlt / AlphaBlend / MaskBlt between DCs.
    fn blit(&mut self, dst: u64, d: (i32, i32, i32, i32), src: u64, s: (i32, i32, i32, i32), rop: u32, mode: u32, arg: u32, mask: u64, mpos: (i32, i32)) -> bool {
        let Some(dv) = self.view(dst) else { return false };
        let (x0, y0) = self.lp(dv.attr, d.0, d.1);
        let (x1, y1) = self.lp(dv.attr, d.0 + d.2, d.1 + d.3);
        let dr = Rect::new(x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1));
        let op = (rop >> 16) as u8;
        let uses_s = ((op >> 2) ^ op) & 0x33 != 0 || mode != 0;
        if !uses_s || src == 0 {
            return self.blit_px(dst, dr, (false, false), None, Rect::new(0, 0, 1, 1), rop, 0, 0, None);
        }
        let Some(sv) = self.view(src) else { return false };
        let (a0, b0) = self.lp(sv.attr, s.0, s.1);
        let (a1, b1) = self.lp(sv.attr, s.0 + s.2, s.1 + s.3);
        let sr = Rect::new(a0.min(a1), b0.min(b1), a0.max(a1), b0.max(b1)).off(sv.ox, sv.oy);
        let flip = ((x1 < x0) != (a1 < a0), (y1 < y0) != (b1 < b0));
        let sbk = rgb(self.g32(sv.attr + 12));
        let mpx = if mask != 0 { let t = Tgt::Bmp(idx(mask)); let (m, w, h) = self.take(t); Some((t, m, w, h)) } else { None };
        let r = if sv.tgt == dv.tgt {
            let (p, w, h) = self.take(sv.tgt);
            let copy = p.clone();
            self.give(sv.tgt, p, false);
            self.blit_px(dst, dr, flip, Some((&copy, w, h, sv.mono, sbk)), sr, rop, mode, arg, mpx.as_ref().map(|(_, m, w, h)| (m.as_slice(), *w, *h, mpos.0, mpos.1)))
        } else {
            let (p, w, h) = self.take(sv.tgt);
            let r = self.blit_px(dst, dr, flip, Some((&p, w, h, sv.mono, sbk)), sr, rop, mode, arg, mpx.as_ref().map(|(_, m, w, h)| (m.as_slice(), *w, *h, mpos.0, mpos.1)));
            self.give(sv.tgt, p, false);
            r
        };
        if let Some((t, m, _, _)) = mpx { self.give(t, m, false); }
        r
    }

    fn stretch_dib(&mut self, hdc: u64, d: (i32, i32, i32, i32), s: (i32, i32, i32, i32), bits: u64, bmi: u64, coloruse: u32, rop: u32, start: u32, lines: u32) -> u64 {
        let f = self.dib_fmt(bmi, coloruse);
        let (px, w, h) = self.read_dib(bits, &f, start, lines);
        let Some(v) = self.view(hdc) else { return 0 };
        let (x0, y0) = self.lp(v.attr, d.0, d.1);
        let (x1, y1) = self.lp(v.attr, d.0 + d.2, d.1 + d.3);
        let dr = Rect::new(x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1));
        // source y counts from the bottom for bottom-up DIBs
        let st = if f.h < 0 { s.1 } else { h - s.1 - s.3 };
        let sr = Rect::new(s.0.min(s.0 + s.2), st.min(st + s.3), s.0.max(s.0 + s.2), st.max(st + s.3));
        let flip = (x1 < x0 || s.2 < 0, y1 < y0);
        self.blit_px(hdc, dr, flip, Some((&px, w, h, false, 0)), sr, rop, 0, 0, None);
        h as u64
    }

    fn get_dibits(&mut self, hbmp: u64, start: u32, lines: u32, bits: u64, info: u64, coloruse: u32) -> u64 {
        let t = Tgt::Bmp(idx(hbmp));
        let (bw, bh, bbpp, bpal, isdib) = match self.s.gdi.objs.get(&idx(hbmp)) { Some(Obj::Bmp(b)) => (b.w, b.h, b.bpp, b.pal.clone(), b.dib != 0), _ => return 0 };
        let size = self.g32(info);
        if size < 12 { return 0; }
        let mut bpp = self.g16(info + 14) as u16;
        if bpp == 0 {
            // fill the header only
            let bpp = if bbpp <= 8 && !isdib { bbpp } else { bbpp.max(1) };
            self.s32(info + 4, bw as u32); self.s32(info + 8, bh as u32); self.s16(info + 12, 1); self.s16(info + 14, bpp as u32);
            self.s32(info + 16, if bpp == 16 || bpp == 32 { 3 } else { 0 });
            self.s32(info + 20, (((bw as usize * bpp as usize + 31) / 32) * 4 * bh as usize) as u32);
            if bpp == 16 || bpp == 32 {
                let m = if bpp == 16 { [0xF800, 0x7E0, 0x1F] } else { [0xFF0000, 0xFF00, 0xFF] };
                let ct = info + size as u64;
                for (k, v) in m.iter().enumerate() { self.s32(ct + 4 * k as u64, *v); }
            }
            return 1;
        }
        if bpp != 1 && bpp != 4 && bpp != 8 && bpp != 16 && bpp != 24 && bpp != 32 { bpp = 32; }
        let ih = self.g32(info + 8) as i32;
        let comp = self.g32(info + 16);
        let masks = if comp == 3 { let ct = info + size as u64; [self.g32(ct), self.g32(ct + 4), self.g32(ct + 8)] } else if bpp == 16 { [0x7C00, 0x3E0, 0x1F] } else { [0xFF0000, 0xFF00, 0xFF] };
        let pal = if bpp <= 8 { if !bpal.is_empty() && bpal.len() == 1 << bpp { bpal } else { std_palette(bpp) } } else { vec![] };
        // color table
        if bpp <= 8 && coloruse == 0 {
            let ct = info + size as u64;
            for (k, c) in pal.iter().enumerate() { self.s32(ct + 4 * k as u64, *c); }
            if size >= 36 { self.s32(info + 32, 0); }
        }
        let height = ih.abs().min(bh).max(0);
        let iw = self.g32(info + 4) as i32;
        self.s32(info + 20, (((bw.min(iw).max(0) as usize * bpp as usize + 31) / 32) * 4 * height as usize) as u32);
        if bits == 0 { return bh as u64; }
        let w = (self.g32(info + 4) as i32).min(bw).max(0);
        let f = Fmt { w, h: height, bpp, masks, pal, comp: 0, hdr: 0 };
        let (px, sw, _) = self.take(t);
        let topdown = ih < 0;
        let lines = lines.min((height as u32).saturating_sub(start));
        // the requested scan lines (bottom-up numbering when the DIB is bottom-up)
        let mut part = vec![0u32; (w * lines as i32) as usize];
        for r in 0..lines as i32 {
            let src_row = if topdown { start as i32 + r } else { bh - 1 - (start as i32 + (lines as i32 - 1 - r)) };
            if src_row < 0 || src_row >= bh { continue; }
            for x in 0..w { part[(r * w + x) as usize] = px.get((src_row * sw + x) as usize).copied().unwrap_or(0); }
        }
        self.give(t, px, false);
        let raw = encode(&part, &f, lines as i32, topdown);
        let _ = self.mmu.write_bytes(bits, &raw);
        lines as u64
    }

    fn create_dib_section(&mut self, bmi: u64, usage: u32, out: u64) -> u64 {
        let f = self.dib_fmt(bmi, usage);
        if f.w == 0 || f.h == 0 || f.bpp == 0 { return 0; }
        let size = f.stride() * f.h.unsigned_abs() as usize;
        let Some(bits) = self.alloc(size as u64) else { return 0 };
        self.s64(out, bits);
        let stride = f.stride();
        let pal = if f.pal.is_empty() && f.bpp <= 8 { std_palette(f.bpp) } else { f.pal };
        self.gdi_new(E_BMP, Obj::Bmp(Bmp { w: f.w.abs(), h: f.h.abs(), bpp: f.bpp, px: vec![], dib: bits, stride, pal, topdown: f.h < 0, masks: f.masks, comp: f.comp }))
    }

    // ---------- clipping and regions ----------

    fn rgn(&self, h: u64) -> Option<Rect> { match self.s.gdi.objs.get(&idx(h)) { Some(Obj::Rgn(r)) => Some(*r), _ => None } }
    fn set_rgn(&mut self, h: u64, r: Rect) { if let Some(Obj::Rgn(x)) = self.s.gdi.objs.get_mut(&idx(h)) { *x = if r.empty() { Rect::default() } else { r }; } }
    fn rtype(r: Rect) -> u64 { if r.empty() { 1 } else { 2 } }

    fn diff(a: Rect, b: Rect) -> Rect {
        let i = a.inter(&b);
        if i.empty() { return a; }
        if i == a { return Rect::default(); }
        // only a full-width or full-height band can be taken away exactly
        if i.l == a.l && i.r == a.r { if i.t == a.t { return Rect::new(a.l, i.b, a.r, a.b); } if i.b == a.b { return Rect::new(a.l, a.t, a.r, i.t); } }
        if i.t == a.t && i.b == a.b { if i.l == a.l { return Rect::new(i.r, a.t, a.r, a.b); } if i.r == a.r { return Rect::new(a.l, a.t, i.l, a.b); } }
        a
    }

    /// The DC's whole drawable area (device coordinates, before the program's clip).
    fn dc_area(&mut self, hdc: u64) -> Rect {
        let Some(d) = self.dc(hdc) else { return Rect::default() };
        let (mem, bmp, hwnd, whole) = (d.mem, d.bmp, d.hwnd, d.whole);
        if mem { return match self.s.gdi.objs.get(&idx(bmp)) { Some(Obj::Bmp(b)) => Rect::new(0, 0, b.w, b.h), _ => Rect::new(0, 0, 1, 1) }; }
        if hwnd == 0 { return Rect::new(0, 0, SCREEN_W, SCREEN_H); }
        self.wnd(hwnd).map_or(Rect::default(), |w| { let r = if whole { w.wrect } else { w.crect }; Rect::new(0, 0, r.w(), r.h()) })
    }

    fn clip_op(&mut self, hdc: u64, r: Option<Rect>, mode: u32) -> u64 {
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

    // ---------- objects ----------

    fn select(&mut self, hdc: u64, h: u64, kind: u32) -> u64 {
        let ok = match self.s.gdi.objs.get(&idx(h)) {
            Some(Obj::Bmp(_)) => kind == 7, Some(Obj::Brush(_)) => kind == 2, Some(Obj::Pen(_)) => kind == 1, Some(Obj::Font(_)) => kind == 6, Some(Obj::Pal(_)) => kind == 5, _ => false,
        };
        if !ok { return 0; }
        let full = self.handle_of(idx(h));
        let Some(d) = self.dc_mut(hdc) else { return 0 };
        if kind == 7 && !d.mem { return 0; }
        let slot = match kind { 7 => &mut d.bmp, 2 => &mut d.brush, 1 => &mut d.pen, 6 => &mut d.font, _ => &mut d.pal };
        let old = *slot;
        *slot = full;
        if kind == 7 { d.clip = None; }
        // keep DC_ATTR in step with the selected bitmap's size (vis rect)
        if kind == 7 {
            let a = d.attr;
            let (w, hh) = match self.s.gdi.objs.get(&idx(h)) { Some(Obj::Bmp(b)) => (b.w, b.h), _ => (1, 1) };
            self.wr_rect(a + 72, Rect::new(0, 0, w, hh));
        }
        old
    }

    fn get_object(&mut self, h: u64, n: u32, buf: u64) -> u64 {
        enum O { Pen(u32, i32, u32, bool), Brush(u32, u32), Font(Vec<u8>), Bmp(i32, i32, u16, u64, Vec<u8>), Pal(u32), None }
        let o = match self.s.gdi.objs.get(&idx(h)) {
            Some(Obj::Pen(p)) => O::Pen(p.style, p.width, p.color, p.ext),
            Some(Obj::Brush(b)) => match b { Brush::Null => O::Brush(1, 0), Brush::Solid(c) => O::Brush(0, *c), Brush::Hatch(_, c) => O::Brush(2, *c), Brush::Pat { .. } => O::Brush(3, 0), Brush::Dc => O::Brush(0, 0xFFFFFF) },
            Some(Obj::Font(f)) => O::Font(f.lf.clone()),
            Some(Obj::Bmp(b)) => {
                let mut hdr = vec![0u8; 40];
                hdr[0..4].copy_from_slice(&40u32.to_le_bytes()); hdr[4..8].copy_from_slice(&b.w.to_le_bytes());
                hdr[8..12].copy_from_slice(&(if b.topdown { -b.h } else { b.h }).to_le_bytes()); hdr[12..14].copy_from_slice(&1u16.to_le_bytes());
                hdr[14..16].copy_from_slice(&b.bpp.to_le_bytes()); hdr[16..20].copy_from_slice(&b.comp.to_le_bytes());
                hdr[20..24].copy_from_slice(&((b.stride * b.h as usize) as u32).to_le_bytes());
                O::Bmp(b.w, b.h, b.bpp, b.dib, hdr)
            }
            Some(Obj::Pal(p)) => O::Pal(p.len() as u32),
            _ => O::None,
        };
        match o {
            O::Pen(st, w, c, ext) => {
                if ext { if buf == 0 { return 32; } if n < 28 { return 0; } self.s32(buf, st); self.s32(buf + 4, w as u32); self.s32(buf + 8, 0); self.s32(buf + 12, c); self.s64(buf + 16, 0); self.s32(buf + 24, 0); return 28; }
                if buf == 0 { return 16; }
                if n < 16 { return 0; }
                self.s32(buf, st); self.s32(buf + 4, w as u32); self.s32(buf + 8, 0); self.s32(buf + 12, c); 16
            }
            O::Brush(st, c) => { if buf == 0 { return 16; } if n < 16 { return 0; } self.s32(buf, st); self.s32(buf + 4, c); self.s64(buf + 8, 0); 16 }
            O::Font(lf) => { if buf == 0 { return 92; } let k = (n as usize).min(92); let _ = self.mmu.write_bytes(buf, &lf[..k]); k as u64 }
            O::Bmp(w, h, bpp, dib, hdr) => {
                let wb = ((w as u32 * bpp as u32 + 15) / 16) * 2;
                if buf == 0 { return if dib != 0 { 104 } else { 32 }; }
                if n < 24 { return 0; }
                self.s32(buf, 0); self.s32(buf + 4, w as u32); self.s32(buf + 8, h as u32);
                self.s32(buf + 12, if dib != 0 { ((w as u32 * bpp as u32 + 31) / 32) * 4 } else { wb });
                self.s16(buf + 16, 1); self.s16(buf + 18, bpp as u32);
                if n >= 32 { self.s64(buf + 24, dib); }
                if dib != 0 && n >= 104 {
                    let _ = self.mmu.write_bytes(buf + 32, &hdr);
                    for k in 0..3 { self.s32(buf + 72 + 4 * k, 0); }
                    self.s64(buf + 88, 0); self.s32(buf + 96, 0);
                    return 104;
                }
                if n >= 32 { 32 } else { 24 }
            }
            O::Pal(k) => { if buf == 0 { return 2; } self.s16(buf, k); 2 }
            O::None => 0,
        }
    }

    // ---------- composition ----------

    /// Builds the framebuffer: desktop, windows (back to front), frames, menus.
    pub(crate) fn compose(&mut self) {
        let (w, h) = (SCREEN_W, SCREEN_H);
        let mut fb = std::mem::take(&mut self.s.gdi.fb);
        fb.resize((w * h) as usize, 0);
        fb.fill(0xFF00_0000 | colorref(DESKTOP_COLOR));
        let tops = self.s.win.tops.clone();
        for t in tops {
            let Some(win) = self.wnd(t) else { continue };
            if win.style & 0x1000_0000 == 0 { continue; }
            let wr = win.wrect;
            let Some(s) = self.s.gdi.surfs.get_mut(&t) else { continue };
            let (sw, sh) = (s.w, s.h);
            let mut px = std::mem::take(&mut s.px);
            if px.len() != (sw * sh) as usize { if let Some(s) = self.s.gdi.surfs.get_mut(&t) { s.px = px; } continue; }
            // frames of the window and its visible children
            let mut list = vec![t];
            let mut i = 0;
            while i < list.len() {
                let kids = self.wnd(list[i]).map_or(vec![], |w| w.children.clone());
                for k in kids { if self.wnd(k).map_or(false, |w| w.style & 0x1000_0000 != 0) { list.push(k); } }
                i += 1;
            }
            for k in list { self.draw_nc(k, &mut px, sw, sh, wr); }
            for y in 0..sh {
                let fy = wr.t + y;
                if fy < 0 || fy >= h { continue; }
                for x in 0..sw {
                    let fx = wr.l + x;
                    if fx < 0 || fx >= w { continue; }
                    fb[(fy * w + fx) as usize] = 0xFF00_0000 | colorref(px[(y * sw + x) as usize] & 0xFFFFFF);
                }
            }
            if let Some(s) = self.s.gdi.surfs.get_mut(&t) { s.px = px; }
        }
        self.draw_popup(&mut fb, w, h);
        self.s.gdi.fb = fb;
    }

    fn draw_nc(&mut self, hw: u64, px: &mut Vec<u32>, sw: i32, sh: i32, twr: Rect) {
        let Some(w) = self.wnd(hw) else { return };
        let (style, ex, menu, text, child) = (w.style, w.ex_style, w.menu, w.text.clone(), w.style & 0x4000_0000 != 0);
        let mut r = w.wrect.off(-twr.l, -twr.t);
        let crect = w.crect.off(-twr.l, -twr.t);
        let active = !child && self.s.win.active == hw;
        let cl = Rect::new(0, 0, sw, sh);
        let mut cv = Cv { px, w: sw, clip: cl };
        let caption = style & 0x00C0_0000 == 0x00C0_0000;
        let outer = if style & 0x0004_0000 != 0 { 4 } else if style & 0x0040_0000 != 0 || ex & 1 != 0 { 3 } else if style & 0x0080_0000 != 0 { 1 } else if child && caption { 3 } else { 0 };
        if outer >= 3 {
            cv.edge(r, FACE, DARK); cv.edge(r.inset(1), LIGHT, SHADOW);
            for k in 2..outer { cv.frame(r.inset(k), FACE); }
        } else if outer == 1 { cv.frame(r, 0); }
        r = r.inset(outer);
        if caption {
            let cap = Rect::new(r.l, r.t, r.r, r.t + 18);
            let (c0, c1) = if active { (0x0A246A, 0xA6CAF0) } else { (0x808080, 0xC0C0C0) };
            for x in cap.l..cap.r {
                let t = if cap.w() > 1 { (x - cap.l) as u32 * 255 / (cap.w() - 1) as u32 } else { 0 };
                let mix = |a: u32, b: u32, s: u32| (((a >> s & 0xFF) * (255 - t) + (b >> s & 0xFF) * t) / 255) << s;
                let c = mix(c0, c1, 16) | mix(c0, c1, 8) | mix(c0, c1, 0);
                cv.fill(Rect::new(x, cap.t, x + 1, cap.b), c);
            }
            cv.fill(Rect::new(r.l, cap.b, r.r, cap.b + 1), FACE);
            let tc = if active { 0xFFFFFF } else { FACE };
            let room = Rect::new(cap.l + 4, cap.t, cap.r - 22, cap.b);
            cv.text(room, cap.l + 4, cap.t + 2, &text, 1, tc);
            if style & 0x0008_0000 != 0 {
                let b = Rect::new(cap.r - 18, cap.t + 2, cap.r - 2, cap.t + 16);
                cv.fill(b, FACE); cv.edge(b, LIGHT, DARK); cv.edge(b.inset(1), FACE, SHADOW);
                for k in 0..7 { for d in 0..2 { cv.put(b.l + 4 + k + d, b.t + 3 + k, 0); cv.put(b.l + 10 - k + d, b.t + 3 + k, 0); } }
            }
            r.t += 19;
        }
        if menu != 0 && !child {
            let bar = Rect::new(r.l, r.t, r.r, r.t + 18);
            cv.fill(Rect::new(r.l, r.t, r.r, r.t + 19), FACE);
            let lay = self.menu_bar_layout(menu);
            let items: Vec<(String, u32)> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| (i.text.replace('&', ""), i.state)).collect());
            let open = self.s.win.popup.as_ref().map(|p| p.hwnd == hw).unwrap_or(false);
            let open_menu = self.s.win.popup.as_ref().map_or(0, |p| p.menu);
            for (i, (x, wd)) in lay.iter().enumerate() {
                let Some((t, st)) = items.get(i) else { continue };
                let ir = Rect::new(bar.l + x, bar.t, bar.l + x + wd, bar.b);
                let sub = self.s.win.menus.get(&menu).and_then(|m| m.items.get(i)).map_or(0, |it| it.sub);
                let hot = open && sub != 0 && sub == open_menu;
                if hot { cv.fill(ir, 0x0A246A); }
                let c = if hot { 0xFFFFFF } else if st & 3 != 0 { SHADOW } else { 0 };
                cv.text(ir, ir.l + 8, ir.t + 2, t, 0, c);
            }
            r.t += 19;
        }
        if ex & 0x200 != 0 { cv.edge(r, SHADOW, LIGHT); cv.edge(r.inset(1), DARK, FACE); r = r.inset(2); }
        if ex & 0x20000 != 0 { cv.edge(r, SHADOW, LIGHT); r = r.inset(1); }
        let (vs, hs) = (style & 0x0020_0000 != 0, style & 0x0010_0000 != 0);
        if vs {
            let sb = Rect::new(crect.r, r.t, crect.r + 17, crect.b);
            cv.fill(sb, 0xE8E8E8);
            let up = Rect::new(sb.l, sb.t, sb.r, sb.t + 17);
            let dn = Rect::new(sb.l, sb.b - 17, sb.r, sb.b);
            for (b, down) in [(up, false), (dn, true)] {
                cv.fill(b, FACE); cv.edge(b, LIGHT, DARK); cv.edge(b.inset(1), FACE, SHADOW);
                for k in 0..4 { let y = if down { b.t + 6 + k } else { b.t + 9 - k }; cv.fill(Rect::new(b.l + 8 - (3 - k), y, b.l + 9 + (3 - k), y + 1), 0); }
            }
        }
        if hs {
            let sb = Rect::new(r.l, crect.b, crect.r, crect.b + 17);
            cv.fill(sb, 0xE8E8E8);
            if vs { cv.fill(Rect::new(crect.r, crect.b, crect.r + 17, crect.b + 17), FACE); }
        }
    }

    fn draw_popup(&mut self, fb: &mut Vec<u32>, w: i32, h: i32) {
        let Some(p) = &self.s.win.popup else { return };
        let (x, y, pw, ph, menu, hot) = (p.x, p.y, p.w, p.h, p.menu, p.hot);
        if pw <= 0 || ph <= 0 { return; }
        let mut px = vec![FACE; (pw * ph) as usize];
        {
            let mut cv = Cv { px: &mut px, w: pw, clip: Rect::new(0, 0, pw, ph) };
            let r = Rect::new(0, 0, pw, ph);
            cv.edge(r, FACE, DARK); cv.edge(r.inset(1), LIGHT, SHADOW);
            let items: Vec<(String, u32, u32, u64)> = self.s.win.menus.get(&menu).map_or(vec![], |m| m.items.iter().map(|i| (i.text.replace('&', ""), i.flags, i.state, i.sub)).collect());
            let mut yy = 3;
            for (i, (t, f, st, sub)) in items.iter().enumerate() {
                if f & 0x800 != 0 { cv.fill(Rect::new(3, yy + 3, pw - 3, yy + 4), SHADOW); cv.fill(Rect::new(3, yy + 4, pw - 3, yy + 5), LIGHT); yy += 8; continue; }
                let ir = Rect::new(3, yy, pw - 3, yy + 18);
                let is_hot = i as i32 == hot;
                if is_hot { cv.fill(ir, 0x0A246A); }
                let c = if st & 3 != 0 { SHADOW } else if is_hot { 0xFFFFFF } else { 0 };
                let mut parts = t.split('\t');
                let main = parts.next().unwrap_or("");
                cv.text(ir, 22, yy + 2, main, 0, c);
                if let Some(acc) = parts.next() { let aw = text_width(0, acc); cv.text(ir, pw - 10 - aw, yy + 2, acc, 0, c); }
                if st & 8 != 0 { for k in 0..3 { cv.fill(Rect::new(8 + k, yy + 8 + k, 9 + k, yy + 11 + k), c); } for k in 0..4 { cv.fill(Rect::new(11 + k, yy + 9 - k, 12 + k, yy + 12 - k), c); } }
                if *sub != 0 { for k in 0..4 { cv.fill(Rect::new(pw - 12 + k, yy + 5 + k, pw - 11 + k, yy + 13 - k), c); } }
                yy += 18;
            }
        }
        for j in 0..ph { for i in 0..pw {
            let (fx, fy) = (x + i, y + j);
            if fx >= 0 && fy >= 0 && fx < w && fy < h { fb[(fy * w + fx) as usize] = 0xFF00_0000 | colorref(px[(j * pw + i) as usize]); }
        } }
    }
}

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

// ---------- the system calls ----------

pub fn call(e: &mut Engine, name: &str) -> Option<u64> {
    let ar: [u64; 14] = std::array::from_fn(|i| e.arg(i));
    e.gdi_init();
    let a0 = ar[0];
    let r: u64 = match name {
        "NtGdiInit" | "NtGdiFlush" => 1,
        "NtGdiCreateCompatibleDC" => e.dc_new(0, false, true),
        "NtGdiOpenDCW" => e.dc_new(0, false, false),
        "NtGdiCreateMetafileDC" => e.dc_new(0, false, true),
        "NtGdiDeleteObjectApp" => {
            let i = idx(a0);
            if e.is_stock(a0) || e.s.gdi.sysbrush.iter().chain(e.s.gdi.syspen.iter()).any(|&h| idx(h) == i) { return Some(1); }
            match e.s.gdi.objs.get(&i) { Some(Obj::Dc(_)) => e.dc_delete(a0), Some(_) => e.gdi_free(i), None => return Some(0) }
            1
        }
        "NtGdiCreateClientObj" => e.gdi_new(((a0 >> 16) & 0x7F) as u32, Obj::Other),
        "NtGdiDeleteClientObj" => { e.gdi_free(idx(a0)); 1 }
        "NtGdiGetDCObject" => {
            let t = ar[1] as u32;
            match e.dc(a0) { Some(d) => match t { 1 => d.pen, 2 => d.brush, 5 => d.pal, 6 => d.font, 7 => d.bmp, _ => 0 }, None => 0 }
        }
        "NtGdiSelectBitmap" => { let h = ar[1]; e.select(a0, h, 7) }
        "NtGdiSelectBrush" => { let h = ar[1]; e.select(a0, h, 2) }
        "NtGdiSelectPen" => { let h = ar[1]; e.select(a0, h, 1) }
        "NtGdiSelectFont" => { let h = ar[1]; e.select(a0, h, 6) }
        "NtUserSelectPalette" | "NtGdiSelectPalette" => { let h = ar[1]; let r = e.select(a0, h, 5); if r == 0 { e.stock(15) } else { r } }
        "NtGdiGetAndSetDCDword" => {
            let (m, v, out) = (ar[1] as u32, ar[2] as u32, ar[3]);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            let (off, w16) = match m { 8 => (60, false), 100 => (12, false), 101 => (50, true), 102 => (24, false), 103 => (16, false), 104 => (20, false), 105 => (36, false), 106 => (54, true), 107 => (48, true), _ => return Some(0) };
            let old = if w16 { e.g16(attr + off) } else { e.g32(attr + off) };
            if w16 { e.s16(attr + off, v); } else { e.s32(attr + off, v); }
            if m == 8 && v == 1 { for o in [108u64, 112, 124, 128] { e.s32(attr + o, 1); } }
            if m == 8 && v == 8 { e.s32(attr + 108, 1); e.s32(attr + 112, 1); e.s32(attr + 124, 1); e.s32(attr + 128, 1); }
            e.s32(out, old);
            1
        }
        "NtGdiGetDCDword" => {
            let (m, out) = (ar[1] as u32, ar[2]);
            let Some((attr, mem)) = e.dc(a0).map(|d| (d.attr, d.mem)) else { return Some(0) };
            let v = match m { 0 => e.g32(attr + 40), 1 => e.g32(attr + 12), 2 => e.g16(attr + 50), 3 => e.g32(attr + 16), 4 => e.g32(attr + 20), 5 => e.g32(attr + 36), 6 => e.g32(attr + 44), 7 => e.g16(attr + 52), 8 => e.g16(attr + 54), 9 => e.g32(attr + 24), 10 => mem as u32, _ => 0 };
            e.s32(out, v);
            1
        }
        "NtGdiGetDCPoint" => {
            let (m, out) = (ar[1] as u32, ar[2]);
            let Some((attr, hwnd, whole)) = e.dc(a0).map(|d| (d.attr, d.hwnd, d.whole)) else { return Some(0) };
            let (x, y) = match m {
                0 => (e.g32(attr + 92), e.g32(attr + 96)),
                1 => (e.g32(attr + 28), e.g32(attr + 32)),
                _ => e.wnd(hwnd).map_or((0, 0), |w| { let r = if whole { w.wrect } else { w.crect }; (r.l as u32, r.t as u32) }),
            };
            e.s32(out, x); e.s32(out + 4, y);
            1
        }
        "NtGdiSetBrushOrg" => {
            let (x, y, prev) = (ar[1] as u32, ar[2] as u32, ar[3]);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            if prev != 0 { let (px, py) = (e.g32(attr + 92), e.g32(attr + 96)); e.s32(prev, px); e.s32(prev + 4, py); }
            e.s32(attr + 92, x); e.s32(attr + 96, y);
            1
        }
        "NtGdiMoveTo" => {
            let (x, y, pt) = (ar[1] as u32, ar[2] as u32, ar[3]);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            if pt != 0 { let (px, py) = (e.g32(attr + 28), e.g32(attr + 32)); e.s32(pt, px); e.s32(pt + 4, py); }
            e.s32(attr + 28, x); e.s32(attr + 32, y);
            1
        }
        "NtGdiLineTo" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let Some(v) = e.view(a0) else { return Some(0) };
            let (cx, cy) = (e.g32(v.attr + 28) as i32, e.g32(v.attr + 32) as i32);
            e.s32(v.attr + 28, x as u32); e.s32(v.attr + 32, y as u32);
            if let Some(pen) = e.pen_eval(a0, v.attr) {
                let p0 = e.lp(v.attr, cx, cy); let p1 = e.lp(v.attr, x, y);
                let r2 = e.rop_mode(v.attr);
                e.polyline_dev(v, &[(p0.0 + v.ox, p0.1 + v.oy), (p1.0 + v.ox, p1.1 + v.oy)], pen, r2, false);
            }
            1
        }
        "NtGdiPolyPolyDraw" => { let (p, c, n, f) = (ar[1], ar[2], ar[3] as u32, ar[4] as u32); e.poly_poly_draw(a0, p, c, n, f) }
        "NtGdiRectangle" => { let r = Rect::new((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32)); e.shape_rect(a0, r, false) as u64 }
        "NtGdiRoundRect" => { let r = Rect::new((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32)); e.shape_rect(a0, r, true) as u64 }
        "NtGdiEllipse" => { let r = Rect::new((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32)); e.ellipse(a0, r) as u64 }
        "NtGdiArcInternal" | "NtGdiAngleArc" | "NtGdiPolyDraw" | "NtGdiExtFloodFill" => 1,
        "NtGdiPatBlt" => {
            let (l, t, w, h, rop) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5] as u32);
            e.blit(a0, (l, t, w, h), 0, (0, 0, 0, 0), rop, 0, 0, 0, (0, 0)) as u64
        }
        "NtGdiBitBlt" => {
            let (x, y, w, h, src, xs, ys, rop) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5], (ar[6] as i32), (ar[7] as i32), ar[8] as u32);
            e.blit(a0, (x, y, w, h), src, (xs, ys, w, h), rop, 0, 0, 0, (0, 0)) as u64
        }
        "NtGdiStretchBlt" => {
            let (x, y, w, h, src, xs, ys, ws, hs, rop) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5], (ar[6] as i32), (ar[7] as i32), (ar[8] as i32), (ar[9] as i32), ar[10] as u32);
            e.blit(a0, (x, y, w, h), src, (xs, ys, ws, hs), rop, 0, 0, 0, (0, 0)) as u64
        }
        "NtGdiMaskBlt" => {
            let (x, y, w, h, src, xs, ys, mask, xm, ym, rop) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5], (ar[6] as i32), (ar[7] as i32), ar[8], (ar[9] as i32), (ar[10] as i32), ar[11] as u32);
            let rop = if mask == 0 { rop & 0xFFFFFF } else { rop };
            e.blit(a0, (x, y, w, h), src, (xs, ys, w, h), rop, 0, 0, mask, (xm, ym)) as u64
        }
        "NtGdiTransparentBlt" => {
            let (x, y, w, h, src, xs, ys, ws, hs, col) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5], (ar[6] as i32), (ar[7] as i32), (ar[8] as i32), (ar[9] as i32), ar[10] as u32);
            e.blit(a0, (x, y, w, h), src, (xs, ys, ws, hs), 0xCC0020, 1, rgb(col), 0, (0, 0)) as u64
        }
        "NtGdiAlphaBlend" => {
            let (x, y, w, h, src, xs, ys, ws, hs, bf) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), ar[5], (ar[6] as i32), (ar[7] as i32), (ar[8] as i32), (ar[9] as i32), ar[10] as u32);
            e.blit(a0, (x, y, w, h), src, (xs, ys, ws, hs), 0xCC0020, 2, bf, 0, (0, 0)) as u64
        }
        "NtGdiPlgBlt" => 0,
        "NtGdiGradientFill" => {
            let (vert, nv, mesh, nm, mode) = (ar[1], ar[2] as u64, ar[3], ar[4] as u64, ar[5] as u32);
            let Some(v) = e.view(a0) else { return Some(0) };
            let vx: Vec<(i32, i32, u32, u32, u32)> = (0..nv).map(|i| { let b = vert + 16 * i; (e.g32(b) as i32, e.g32(b + 4) as i32, e.g16(b + 8) >> 8, e.g16(b + 10) >> 8, e.g16(b + 12) >> 8) }).collect();
            for m in 0..nm {
                if mode < 2 {
                    let (i0, i1) = (e.g32(mesh + 8 * m) as usize, e.g32(mesh + 8 * m + 4) as usize);
                    let (Some(&p0), Some(&p1)) = (vx.get(i0), vx.get(i1)) else { continue };
                    let r = e.lpr(v.attr, Rect::new(p0.0, p0.1, p1.0, p1.1)).off(v.ox, v.oy);
                    let n = if mode == 0 { r.w() } else { r.h() };
                    for k in 0..n.max(0) {
                        let t = if n > 1 { k as u32 * 255 / (n - 1) as u32 } else { 0 };
                        let mix = |a: u32, b: u32| (a * (255 - t) + b * t) / 255;
                        let c = mix(p0.2, p1.2) << 16 | mix(p0.3, p1.3) << 8 | mix(p0.4, p1.4);
                        let band = if mode == 0 { Rect::new(r.l + k, r.t, r.l + k + 1, r.b) } else { Rect::new(r.l, r.t + k, r.r, r.t + k + 1) };
                        e.fill_with(v, band, &Be::Solid(c), 0xF0);
                    }
                } else {
                    let ids: Vec<usize> = (0..3).map(|k| e.g32(mesh + 12 * m + 4 * k) as usize).collect();
                    let pts: Vec<_> = ids.iter().filter_map(|&i| vx.get(i).copied()).collect();
                    if pts.len() < 3 { continue; }
                    let c = ((pts[0].2 + pts[1].2 + pts[2].2) / 3) << 16 | ((pts[0].3 + pts[1].3 + pts[2].3) / 3) << 8 | (pts[0].4 + pts[1].4 + pts[2].4) / 3;
                    let poly: Vec<(i32, i32)> = pts.iter().map(|p| { let (x, y) = e.lp(v.attr, p.0, p.1); (x + v.ox, y + v.oy) }).collect();
                    e.polygon_dev(v, &[poly], &Be::Solid(c), 13, false);
                }
            }
            1
        }
        "NtGdiSetPixel" => {
            let (x, y, c) = ((ar[1] as i32), (ar[2] as i32), ar[3] as u32);
            let Some(v) = e.view(a0) else { return Some(u32::MAX as u64) };
            let (x, y) = e.lp(v.attr, x, y);
            e.fill_with(v, Rect::new(x + v.ox, y + v.oy, x + v.ox + 1, y + v.oy + 1), &Be::Solid(rgb(c)), 0xF0);
            c as u64
        }
        "NtGdiGetPixel" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let Some(v) = e.view(a0) else { return Some(u32::MAX as u64) };
            let (x, y) = e.lp(v.attr, x, y);
            let (x, y) = (x + v.ox, y + v.oy);
            let (px, w, h) = e.take(v.tgt);
            let r = if x >= 0 && y >= 0 && x < w && y < h { colorref(px[(y * w + x) as usize] & 0xFFFFFF) as u64 } else { u32::MAX as u64 };
            e.give(v.tgt, px, false);
            r
        }
        "NtGdiExtTextOutW" => {
            let (x, y, fl, rc, s, n, dx) = ((ar[1] as i32), (ar[2] as i32), ar[3] as u32, ar[4], ar[5], ar[6] as u32, ar[7]);
            e.ext_text_out(a0, x, y, fl, rc, s, n, dx) as u64
        }
        "NtGdiGetTextExtentExW" => {
            let (s, n, max, nfit, dxs, size) = (ar[1], ar[2] as u64, (ar[3] as i32), ar[4], ar[5], ar[6]);
            let (fi, _) = e.dc_font(a0);
            let attr = e.dc(a0).map_or(0, |d| d.attr);
            let extra = if attr != 0 { e.g32(attr + 64) as i32 } else { 0 };
            let mut tot = 0;
            let mut fit = 0;
            for i in 0..n {
                let c = e.g16(s + 2 * i);
                tot += char_adv(fi, c) + extra;
                if tot <= max || max < 0 { fit = i + 1; }
                if dxs != 0 { e.s32(dxs + 4 * i, tot as u32); }
            }
            if nfit != 0 { e.s32(nfit, fit as u32); }
            e.s32(size, tot as u32); e.s32(size + 4, fonts()[fi].h as u32);
            1
        }
        "NtGdiGetTextMetricsW" => { let tm = ar[1]; e.text_metrics(a0, tm) as u64 }
        "NtGdiGetCharWidthW" | "NtGdiGetCharABCWidthsW" => {
            let (first, last, chars, flags, buf) = (ar[1] as u32, ar[2] as u32, ar[3], ar[4] as u32, ar[5]);
            let (fi, _) = e.dc_font(a0);
            let abc = name == "NtGdiGetCharABCWidthsW";
            let int = if abc { flags & 1 != 0 } else { flags & 2 != 0 };
            let n = if chars != 0 { last as u64 } else { (last.saturating_sub(first) + 1) as u64 };
            for i in 0..n {
                let c = if chars != 0 { e.g16(chars + 2 * i) } else { first + i as u32 };
                let w = char_adv(fi, c);
                if abc {
                    let b = buf + 12 * i;
                    if int { e.s32(b, 0); e.s32(b + 4, w as u32); e.s32(b + 8, 0); } else { e.s32(b, 0); e.s32(b + 4, (w as f32).to_bits()); e.s32(b + 8, 0); }
                } else if int { e.s32(buf + 4 * i, w as u32); } else { e.s32(buf + 4 * i, (w as f32).to_bits()); }
            }
            1
        }
        "NtGdiGetTextFaceW" => {
            let (n, out) = (ar[1] as usize, ar[2]);
            let (_, lf) = e.dc_font(a0);
            let face: Vec<u16> = lf[28..92].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
            let face = String::from_utf16_lossy(&face);
            let face = if face.is_empty() { "Tahoma".to_string() } else { face };
            if out == 0 { return Some(face.encode_utf16().count() as u64 + 1); }
            e.put_w(out, &face, n) as u64 + 1
        }
        "NtGdiGetOutlineTextMetricsInternalW" | "NtGdiGetKerningPairs" | "NtGdiGetFontUnicodeRanges" | "NtGdiGetFontFileData" | "NtGdiGetFontFileInfo" => 0,
        "NtGdiGetFontData" | "NtGdiGetGlyphOutline" => u32::MAX as u64,
        "NtGdiGetTextCharsetInfo" => { let fs = ar[1]; if fs != 0 { for k in 0..6 { e.s32(fs + 4 * k, 0); } e.s32(fs + 16, 1); } 0 }
        "NtGdiGetRealizationInfo" => { let p = ar[1]; let (fi, _) = e.dc_font(a0); e.s32(p + 4, 1); e.s32(p + 8, 1); e.s32(p + 12, fi as u32 + 1); 1 }
        "NtGdiGetGlyphIndicesW" => {
            let (s, n, out, fl) = (ar[1], ar[2] as u64, ar[3], ar[4] as u32);
            for i in 0..n { let c = e.g16(s + 2 * i); let g = if map_char(c) == c || c < 32 { c } else if fl & 1 != 0 { 0xFFFF } else { 0 }; e.s16(out + 2 * i, g); }
            n
        }
        "NtGdiEnumFonts" => { let cnt = ar[6]; e.s32(cnt, 0); 1 }
        "NtGdiHfontCreate" => {
            let lf = e.bytes(a0, 92);
            let (h, wt) = (i32::from_le_bytes([lf[0], lf[1], lf[2], lf[3]]), i32::from_le_bytes([lf[16], lf[17], lf[18], lf[19]]));
            let fi = pick_font(h, wt);
            e.gdi_new(E_FONT, Obj::Font(Font { lf, fi }))
        }
        "NtGdiAddFontResourceW" | "NtGdiRemoveFontResourceW" | "NtGdiRemoveFontMemResourceEx" => 1,
        "NtGdiAddFontMemResourceEx" => { let n = ar[4]; if n != 0 { e.s32(n, 1); } 0x7F00_0001 }
        "NtGdiCreateSolidBrush" => e.gdi_new(E_BRUSH, Obj::Brush(Brush::Solid(a0 as u32))),
        "NtGdiCreateHatchBrushInternal" => { let c = ar[1] as u32; e.gdi_new(E_BRUSH, Obj::Brush(Brush::Hatch(a0 as u32, c))) }
        "NtGdiCreatePatternBrushInternal" => {
            let t = Tgt::Bmp(idx(a0));
            let mono = matches!(e.s.gdi.objs.get(&idx(a0)), Some(Obj::Bmp(b)) if b.mono());
            let (px, w, h) = e.take(t);
            let copy = px.clone();
            e.give(t, px, false);
            if w == 0 { return Some(0); }
            e.gdi_new(E_BRUSH, Obj::Brush(Brush::Pat { w, h, px: copy, mono }))
        }
        "NtGdiCreateDIBBrush" => {
            let (data, cu) = (a0, ar[1] as u32);
            let f = e.dib_fmt(data, cu);
            let bits = data + f.hdr as u64;
            let (px, w, h) = e.read_dib(bits, &f, 0, f.h.unsigned_abs());
            e.gdi_new(E_BRUSH, Obj::Brush(Brush::Pat { w, h, px, mono: false }))
        }
        "NtGdiCreatePen" => { let (w, c) = (ar[1] as i32, ar[2] as u32); e.gdi_new(E_PEN, Obj::Pen(Pen { style: a0 as u32, width: w, color: c, dc: false, ext: false })) }
        "NtGdiExtCreatePen" => {
            let (w, c) = (ar[1] as i32, ar[3] as u32);
            e.gdi_new(E_EXTPEN, Obj::Pen(Pen { style: a0 as u32, width: w, color: c, dc: false, ext: true }))
        }
        "NtGdiCreateCompatibleBitmap" => {
            let (w, h) = ((ar[1] as i32), (ar[2] as i32));
            if w == 0 || h == 0 { return Some(e.stock(20)); }
            let mono = e.view(a0).map_or(false, |v| v.mono);
            e.new_bmp(w, h, if mono { 1 } else { 32 })
        }
        "NtGdiCreateBitmap" => {
            let (w, h, bpp, bits) = ((ar[0] as i32), (ar[1] as i32), ar[3] as u16, ar[4]);
            let bpp = match bpp { 1 => 1, 0..=8 => 8, 9..=16 => 16, 17..=24 => 24, _ => 32 };
            let hb = e.new_bmp(w, h, bpp);
            if bits != 0 { e.set_bitmap_bits(hb, bits, u32::MAX); }
            hb
        }
        "NtGdiCreateDIBitmapInternal" => {
            let (w, h, init, bits, bmi, cu) = ((ar[1] as i32), (ar[2] as i32), ar[3] as u32, ar[4], ar[5], ar[6] as u32);
            let mono = a0 == 0 || e.view(a0).map_or(false, |v| v.mono);
            let hb = e.new_bmp(w.abs(), h.abs(), if mono { 1 } else { 32 });
            if init & 4 != 0 && bmi != 0 {
                let f = e.dib_fmt(bmi, cu);
                let (px, pw, ph) = e.read_dib(bits, &f, 0, f.h.unsigned_abs());
                if let Some(Obj::Bmp(b)) = e.s.gdi.objs.get_mut(&idx(hb)) {
                    for y in 0..b.h.min(ph) { for x in 0..b.w.min(pw) { b.px[(y * b.w + x) as usize] = px[(y * pw + x) as usize]; } }
                    if mono { for p in b.px.iter_mut() { *p = if lum(*p & 0xFFFFFF) >= 128 { 0xFFFFFF } else { 0 }; } }
                }
            }
            hb
        }
        "NtGdiCreateDIBSection" => { let (bmi, usage, out) = (ar[3], ar[4] as u32, ar[8]); e.create_dib_section(bmi, usage, out) }
        "NtGdiGetDIBitsInternal" => {
            let (hb, start, lines, bits, info, cu) = (ar[1], ar[2] as u32, ar[3] as u32, ar[4], ar[5], ar[6] as u32);
            e.get_dibits(hb, start, lines, bits, info, cu)
        }
        "NtGdiSetDIBitsToDeviceInternal" => {
            let (x, y, cx, cy, xs, ys, start, lines, bits, bmi, cu) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), (ar[5] as i32), (ar[6] as i32), ar[7] as u32, ar[8] as u32, ar[9], ar[10], ar[11] as u32);
            e.stretch_dib(a0, (x, y, cx, cy), (xs, ys, cx, cy), bits, bmi, cu, 0xCC0020, start, lines);
            lines as u64
        }
        "NtGdiStretchDIBitsInternal" => {
            let (x, y, w, h, xs, ys, ws, hs, bits, bmi, cu, rop) = ((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32), (ar[5] as i32), (ar[6] as i32), (ar[7] as i32), (ar[8] as i32), ar[9], ar[10], ar[11] as u32, ar[12] as u32);
            e.stretch_dib(a0, (x, y, w, h), (xs, ys, ws, hs), bits, bmi, cu, rop, 0, u32::MAX)
        }
        "NtGdiSetDIBitsInternal" => {
            // (hdc, hbitmap, startscan, lines, bits, info, coloruse, ...)
            let (hb, start, lines, bits, bmi, cu) = (ar[1], ar[2] as u32, ar[3] as u32, ar[4], ar[5], ar[6] as u32);
            let f = e.dib_fmt(bmi, cu);
            let (px, pw, ph) = e.read_dib(bits, &f, start, lines);
            let t = Tgt::Bmp(idx(hb));
            let (mut d, w, h) = e.take(t);
            for y in 0..h.min(ph) { for x in 0..w.min(pw) { d[(y * w + x) as usize] = px[(y * pw + x) as usize]; } }
            e.give(t, d, true);
            lines as u64
        }
        "NtGdiGetBitmapBits" => {
            let (n, out) = (ar[1] as u32, ar[2]);
            let t = Tgt::Bmp(idx(a0));
            let (bpp, mono) = match e.s.gdi.objs.get(&idx(a0)) { Some(Obj::Bmp(b)) => (b.bpp, b.mono()), _ => return Some(0) };
            let (px, w, h) = e.take(t);
            let f = Fmt { w, h, bpp: if mono { 1 } else { bpp }, masks: [0xFF0000, 0xFF00, 0xFF], pal: vec![0, 0xFFFFFF], comp: 0, hdr: 0 };
            let stride = ((w as usize * f.bpp as usize + 15) / 16) * 2;
            let total = stride * h as usize;
            if out == 0 { e.give(t, px, false); return Some(total as u64); }
            let raw = encode(&px, &f, h, true);
            e.give(t, px, false);
            let s4 = f.stride();
            let mut o = vec![0u8; total];
            for y in 0..h as usize { let k = stride.min(s4); o[y * stride..y * stride + k].copy_from_slice(&raw[y * s4..y * s4 + k]); }
            let k = (n as usize).min(total);
            let _ = e.mmu.write_bytes(out, &o[..k]);
            k as u64
        }
        "NtGdiSetBitmapBits" => { let (n, bits) = (ar[1] as u32, ar[2]); e.set_bitmap_bits(a0, bits, n) }
        "NtGdiGetBitmapDimension" => { let s = ar[1]; e.s32(s, 0); e.s32(s + 4, 0); 1 }
        "NtGdiSetBitmapDimension" => 1,
        "NtGdiExtGetObjectW" => { let (n, buf) = (ar[1] as u32, ar[2]); e.get_object(a0, n, buf) }
        "NtGdiGetDeviceCaps" => {
            let cap = ar[1] as u32;
            let mono_mem = e.view(a0).map_or(false, |v| v.mono);
            (match cap {
                0 => 0x4000, 2 => 1, 4 => 320, 6 => 240, 8 => SCREEN_W, 10 => SCREEN_H, 12 => if mono_mem { 1 } else { 32 }, 14 => 1,
                16 | 18 => -1, 20 => 0, 22 => 0, 24 => -1, 26 => 0, 28 => 0xFF, 30 => 0xFE, 32 => 0xFF, 34 => 0x7807, 36 => 1, 38 => 0x7E99,
                40 | 42 => 36, 44 => 51, 88 | 90 => 96, 104 => 0, 106 => 20, 108 => 24, 116 => 60, 117 => SCREEN_H, 118 => SCREEN_W, 119 => 0, 120 => 0xFF, 121 => 0,
                _ => 0,
            }) as i32 as u32 as u64
        }
        "NtGdiSaveDC" => {
            let Some(d) = e.dc(a0) else { return Some(0) };
            let (attr, bmp, brush, pen, font, pal, clip) = (d.attr, d.bmp, d.brush, d.pen, d.font, d.pal, d.clip);
            let ab = e.bytes(attr, ATTR_SIZE as usize);
            let d = e.dc_mut(a0).unwrap();
            d.saved.push(Saved { attr: ab, bmp, brush, pen, font, pal, clip });
            let n = d.saved.len() as u32;
            e.s32(attr + 8, n);
            n as u64
        }
        "NtGdiRestoreDC" => {
            let lvl = (ar[1] as i32);
            let Some(d) = e.dc_mut(a0) else { return Some(0) };
            let n = d.saved.len() as i32;
            let target = if lvl < 0 { n + lvl } else { lvl - 1 };
            if target < 0 || target >= n { return Some(0); }
            let s = d.saved[target as usize].clone();
            d.saved.truncate(target as usize);
            d.bmp = s.bmp; d.brush = s.brush; d.pen = s.pen; d.font = s.font; d.pal = s.pal; d.clip = s.clip;
            let attr = d.attr;
            let mut ab = s.attr;
            ab[0..4].copy_from_slice(&(a0 as u32).to_le_bytes());
            ab[8..12].copy_from_slice(&(target as u32).to_le_bytes());
            let _ = e.mmu.write_bytes(attr, &ab);
            1
        }
        "NtGdiResetDC" | "NtGdiCancelDC" => 1,
        "NtGdiComputeXformCoefficients" | "NtGdiModifyWorldTransform" | "NtGdiSetVirtualResolution" | "NtGdiSetSizeDevice" | "NtGdiSetMiterLimit" | "NtGdiSetTextJustification" | "NtGdiScaleViewportExtEx" | "NtGdiScaleWindowExtEx" => 1,
        "NtGdiSetMetaRgn" => 2,
        "NtGdiSetLayout" => { let (l, attr) = (ar[2] as u32, e.dc(a0).map_or(0, |d| d.attr)); if attr == 0 { return Some(u32::MAX as u64) } let o = e.g32(attr + 44); e.s32(attr + 44, l); o as u64 }
        "NtGdiTransformPoints" => {
            let (pin, pout, n, mode) = (ar[1], ar[2], ar[3] as u64, ar[4] as u32);
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            for i in 0..n {
                let (x, y) = (e.g32(pin + 8 * i) as i32, e.g32(pin + 8 * i + 4) as i32);
                let (x, y) = if mode == 0 { e.lp(attr, x, y) } else { e.dp(attr, x, y) };
                e.s32(pout + 8 * i, x as u32); e.s32(pout + 8 * i + 4, y as u32);
            }
            1
        }
        "NtGdiGetTransform" => {
            let x = ar[2];
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            let (o0, o1) = e.lp(attr, 0, 0);
            let (p0, p1) = e.lp(attr, 1000, 1000);
            let vals = [(p0 - o0) as f32 / 1000.0, 0.0, 0.0, (p1 - o1) as f32 / 1000.0, o0 as f32, o1 as f32];
            let world = ar[1] as u32 == 0x203 || ar[1] as u32 == 0x204;
            for (k, v) in vals.iter().enumerate() { let v = if world { *v } else if k == 0 || k == 3 { 1.0 } else { 0.0 }; e.s32(x + 4 * k as u64, v.to_bits()); }
            1
        }
        "NtGdiGetBoundsRect" | "NtGdiSetBoundsRect" => 0,
        // clipping
        "NtGdiExtSelectClipRgn" => { let (rg, mode) = (ar[1], ar[2] as u32); let r = if rg == 0 { None } else { e.rgn(rg) }; e.clip_op(a0, r, mode) }
        "NtGdiIntersectClipRect" | "NtGdiExcludeClipRect" => {
            let Some(attr) = e.dc(a0).map(|d| d.attr) else { return Some(0) };
            let r = Rect::new((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32));
            let r = e.lpr(attr, r);
            e.clip_op(a0, Some(r), if name == "NtGdiIntersectClipRect" { 1 } else { 4 })
        }
        "NtGdiOffsetClipRgn" => {
            let (x, y) = ((ar[1] as i32), (ar[2] as i32));
            let area = e.dc_area(a0);
            let Some(d) = e.dc_mut(a0) else { return Some(0) };
            if let Some(c) = d.clip.as_mut() { *c = c.off(x, y); }
            Engine::rtype(d.clip.unwrap_or(area))
        }
        "NtGdiGetAppClipBox" => {
            let out = ar[1];
            let area = e.dc_area(a0);
            let Some((attr, clip, vis)) = e.dc(a0).map(|d| (d.attr, d.clip, d.vis)) else { return Some(0) };
            let mut c = area;
            if let Some(v) = vis { c = c.inter(&v); }
            if let Some(cl) = clip { c = c.inter(&cl); }
            if c.empty() { c = Rect::default(); }
            let (l, t) = e.dp(attr, c.l, c.t);
            let (r, b) = e.dp(attr, c.r, c.b);
            e.wr_rect(out, Rect::new(l.min(r), t.min(b), l.max(r), t.max(b)));
            Engine::rtype(c)
        }
        "NtGdiGetRandomRgn" => {
            let (rg, code) = (ar[1], ar[2] as u32 & 0xFFFF);
            let Some((clip, vis, hwnd, whole)) = e.dc(a0).map(|d| (d.clip, d.vis, d.hwnd, d.whole)) else { return Some(u32::MAX as u64) };
            match code {
                1 => match clip { Some(c) => { e.set_rgn(rg, c); 1 } None => 0 },
                4 => {
                    let area = e.dc_area(a0);
                    let org = e.wnd(hwnd).map_or((0, 0), |w| { let r = if whole { w.wrect } else { w.crect }; (r.l, r.t) });
                    let r = vis.map_or(area, |v| v.inter(&area)).off(org.0, org.1);
                    e.set_rgn(rg, r); 1
                }
                _ => 0,
            }
        }
        "NtGdiCreateRectRgn" => { let r = Rect::new((ar[0] as i32), (ar[1] as i32), (ar[2] as i32), (ar[3] as i32)); let r = Rect::new(r.l.min(r.r), r.t.min(r.b), r.l.max(r.r), r.t.max(r.b)); e.gdi_new(E_RGN, Obj::Rgn(if r.empty() { Rect::default() } else { r })) }
        "NtGdiCreateEllipticRgn" | "NtGdiCreateRoundRectRgn" => { let r = Rect::new((ar[0] as i32), (ar[1] as i32), (ar[2] as i32), (ar[3] as i32)); e.gdi_new(E_RGN, Obj::Rgn(r)) }
        "NtGdiExtCreateRegion" => {
            let data = ar[2];
            let n = e.g32(data + 8);
            let r = if n == 0 { Rect::default() } else { e.rd_rect(data + 16) };
            e.gdi_new(E_RGN, Obj::Rgn(r))
        }
        "NtGdiSetRectRgn" => { let r = Rect::new((ar[1] as i32), (ar[2] as i32), (ar[3] as i32), (ar[4] as i32)); e.set_rgn(a0, r); 1 }
        "NtGdiCombineRgn" => {
            let (s1, s2, mode) = (ar[1], ar[2], ar[3] as u32);
            let (Some(r1), r2) = (e.rgn(s1), e.rgn(s2)) else { return Some(0) };
            let r2 = r2.unwrap_or_default();
            let r = match mode { 1 => r1.inter(&r2), 2 | 3 => r1.union(&r2), 4 => Engine::diff(r1, r2), _ => r1 };
            let r = if r.empty() { Rect::default() } else { r };
            e.set_rgn(a0, r);
            Engine::rtype(r)
        }
        "NtGdiOffsetRgn" => { let (x, y) = ((ar[1] as i32), (ar[2] as i32)); let Some(r) = e.rgn(a0) else { return Some(0) }; let r = if r.empty() { r } else { r.off(x, y) }; e.set_rgn(a0, r); Engine::rtype(r) }
        "NtGdiGetRgnBox" => { let out = ar[1]; let Some(r) = e.rgn(a0) else { return Some(0) }; e.wr_rect(out, r); Engine::rtype(r) }
        "NtGdiPtInRegion" => { let (x, y) = ((ar[1] as i32), (ar[2] as i32)); e.rgn(a0).map_or(0, |r| r.has(x, y) as u64) }
        "NtGdiRectInRegion" => { let rr = ar[1]; let q = e.rd_rect(rr); e.rgn(a0).map_or(0, |r| !r.inter(&q).empty() as u64) }
        "NtGdiEqualRgn" => { let b = ar[1]; (e.rgn(a0) == e.rgn(b)) as u64 }
        "NtGdiGetRegionData" => {
            let (n, out) = (ar[1] as u32, ar[2]);
            let Some(r) = e.rgn(a0) else { return Some(0) };
            let cnt = if r.empty() { 0 } else { 1 };
            let need = 32 + 16 * cnt;
            if out == 0 || n < need { return Some(need as u64); }
            e.s32(out, 32); e.s32(out + 4, 1); e.s32(out + 8, cnt); e.s32(out + 12, 16 * cnt); e.wr_rect(out + 16, r);
            if cnt == 1 { e.wr_rect(out + 32, r); }
            need as u64
        }
        "NtGdiFillRgn" | "NtGdiFrameRgn" | "NtGdiInvertRgn" => {
            let rg = ar[1];
            let Some(r) = e.rgn(rg) else { return Some(0) };
            let Some(v) = e.view(a0) else { return Some(0) };
            let r = e.lpr(v.attr, r).off(v.ox, v.oy);
            if name == "NtGdiInvertRgn" { e.fill_with(v, r, &Be::Solid(0), 0x55); return Some(1); }
            let br = ar[2];
            let be = e.brush_eval(br, v.attr, v.mono, v.ox, v.oy);
            if name == "NtGdiFillRgn" { e.fill_with(v, r, &be, 0xF0); } else {
                let (w, h) = ((ar[3] as i32).max(1), (ar[4] as i32).max(1));
                for b in [Rect::new(r.l, r.t, r.r, r.t + h), Rect::new(r.l, r.b - h, r.r, r.b), Rect::new(r.l, r.t, r.l + w, r.b), Rect::new(r.r - w, r.t, r.r, r.b)] { e.fill_with(v, b, &be, 0xF0); }
            }
            1
        }
        // palettes
        "NtGdiCreatePaletteInternal" => {
            let n = (ar[1] as u64).min(256);
            let cols = (0..n).map(|i| { let b = e.bytes(a0 + 4 + 4 * i, 3); (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32 }).collect();
            e.gdi_new(E_PAL, Obj::Pal(cols))
        }
        "NtGdiCreateHalftonePalette" => e.gdi_new(E_PAL, Obj::Pal(std_palette(8))),
        "NtGdiDoPalette" => {
            let (start, n, ent, func, inb) = (ar[1] as usize, ar[2] as usize, ar[3], ar[4] as u32, ar[5] != 0);
            match func {
                1 | 2 | 0 => {
                    let Some(Obj::Pal(p)) = e.s.gdi.objs.get(&idx(a0)) else { return Some(0) };
                    let mut p = p.clone();
                    if ent == 0 { return Some(p.len() as u64); }
                    let k = n.min(p.len().saturating_sub(start));
                    for i in 0..k {
                        let a = ent + 4 * i as u64;
                        if func == 2 || !inb { let c = p[start + i]; let _ = e.mmu.write_bytes(a, &[(c >> 16) as u8, (c >> 8) as u8, c as u8, 0]); }
                        else { let b = e.bytes(a, 3); p[start + i] = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32; }
                    }
                    if let Some(Obj::Pal(q)) = e.s.gdi.objs.get_mut(&idx(a0)) { *q = p; }
                    k as u64
                }
                3 => { let p = default_pal(); for i in 0..n.min(20) { let c = p[i]; let _ = e.mmu.write_bytes(ent + 4 * i as u64, &[(c >> 16) as u8, (c >> 8) as u8, c as u8, 0]); } n.min(20) as u64 }
                4 | 5 => {
                    // DIB color table of the bitmap selected in the DC (RGBQUAD = our pixel layout)
                    let bmp = e.dc(a0).map_or(0, |d| d.bmp);
                    let Some(Obj::Bmp(b)) = e.s.gdi.objs.get(&idx(bmp)) else { return Some(0) };
                    let mut p = b.pal.clone();
                    let k = n.min(p.len().saturating_sub(start));
                    for i in 0..k { let a = ent + 4 * i as u64; if func == 4 { e.s32(a, p[start + i]); } else { p[start + i] = e.g32(a) & 0xFFFFFF; } }
                    if func == 5 { if let Some(Obj::Bmp(b)) = e.s.gdi.objs.get_mut(&idx(bmp)) { b.pal = p; } }
                    k as u64
                }
                _ => 0,
            }
        }
        "NtGdiGetNearestColor" => ar[1] & 0xFFFFFF,
        "NtGdiGetNearestPaletteIndex" => 0,
        "NtGdiGetSystemPaletteUse" => 1,
        "NtGdiSetSystemPaletteUse" => 1,
        "NtGdiUnrealizeObject" => 1,
        "NtGdiResizePalette" => 1,
        "NtGdiGetColorAdjustment" | "NtGdiSetColorAdjustment" => 0,
        "NtGdiGetDeviceGammaRamp" => 0,
        "NtGdiSetDeviceGammaRamp" => 1,
        "NtGdiDescribePixelFormat" | "NtGdiSetPixelFormat" | "NtGdiSwapBuffers" => 0,
        "NtGdiGetSpoolMessage" | "NtGdiExtEscape" | "NtGdiStartDoc" | "NtGdiStartPage" | "NtGdiEndPage" | "NtGdiEndDoc" | "NtGdiAbortDoc" => 0,
        // paths: accepted and not drawn yet
        "NtGdiBeginPath" | "NtGdiEndPath" | "NtGdiAbortPath" | "NtGdiCloseFigure" | "NtGdiFlattenPath" | "NtGdiWidenPath" | "NtGdiStrokePath" | "NtGdiFillPath" | "NtGdiStrokeAndFillPath" | "NtGdiSelectClipPath" => 1,
        "NtGdiPathToRegion" => e.gdi_new(E_RGN, Obj::Rgn(Rect::default())),
        "NtGdiGetPath" => 0,
        "NtGdiIcmBrushInfo" => 0,
        "NtGdiGetCharSet" => 0,
        "NtGdiGetFontResourceInfoInternalW" => 0,
        "NtGdiMakeFontDir" => 0,
        _ => {
            if name.starts_with("NtGdiDdDDI") { return Some(0xC000_00BB); }
            if !e.s.gdi.unknown.contains(name) { e.s.gdi.unknown.insert(name.to_string()); crate::console(&format!("[win32u] {} (not yet)\n", name)); }
            0
        }
    };
    Some(r)
}

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
