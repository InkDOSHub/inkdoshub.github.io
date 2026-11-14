// OpenGL: the Unix side of Wine's opengl32.dll.
//
// Wine's opengl32.dll runs as program code. Every GL and WGL function it exports packs
// its arguments into a "<name>_params" struct and makes a unix call (code = the
// function's number, see funcs.rs). The engine answers those calls here: pixel formats,
// contexts and buffer swaps are kept on the engine side; GL functions go to the page's
// WebGL 2 context (gl.js), which reads and writes guest memory through gl_read/gl_write.
//
// A swap copies the WebGL picture into the window, like any other drawing, so OpenGL
// windows show up in the composed screen with the rest.

mod funcs;

use crate::status::*;
use crate::Engine;
use std::collections::HashMap;

pub use funcs::{EXT_PROCS, FUNCS};

#[link(wasm_import_module = "env")]
extern "C" {
    /// Runs GL function `code` with its arguments (pointers as guest addresses). Returns
    /// its result, or NaN when the WebGL side has no such function.
    fn host_gl(code: u32, args: *const f64, n: u32) -> f64;
}

/// The pixel formats offered to every window: 1 = RGBA8 with depth 24 and stencil 8,
/// 2 = RGBA8 without depth (both double-buffered, drawing to a window).
const FORMATS: u32 = 2;
const FORMAT_SIZE: u64 = 144; // struct wgl_pixel_format

#[derive(Default)]
pub struct Gl {
    /// Pixel format chosen for each window.
    formats: HashMap<u64, i32>,
    /// Contexts made so far (handles are 0x6100_0000 + n).
    next_context: u64,
    /// Strings handed to the program (glGetString & co): kept for the program's lifetime.
    strings: HashMap<String, u64>,
    /// Functions the WebGL side does not have yet, reported once each.
    missing: std::collections::HashSet<u32>,
}

/// Scratch buffer the WebGL side uses to move bytes in and out of guest memory.
static mut SCRATCH: Vec<u8> = Vec::new();

fn scratch(len: usize) -> *mut u8 {
    #[allow(static_mut_refs)]
    unsafe {
        if SCRATCH.len() < len {
            SCRATCH.resize(len, 0);
        }
        SCRATCH.as_mut_ptr()
    }
}

/// A scratch area of `len` bytes in the engine's memory, for the WebGL side.
#[no_mangle]
pub extern "C" fn gl_scratch(len: u32) -> u32 {
    scratch(len as usize) as u32
}

/// Copies `len` bytes of guest memory at `addr` into the scratch area and returns it.
#[no_mangle]
pub extern "C" fn gl_read(addr: f64, len: u32) -> u32 {
    let p = scratch(len as usize);
    let buf = unsafe { std::slice::from_raw_parts_mut(p, len as usize) };
    if crate::eng().mmu.read_bytes(addr as u64, buf).is_err() {
        buf.fill(0);
    }
    p as u32
}

/// Copies `len` bytes from engine memory at `src` into guest memory at `addr`.
#[no_mangle]
pub extern "C" fn gl_write(addr: f64, src: u32, len: u32) {
    let data = unsafe { std::slice::from_raw_parts(src as *const u8, len as usize) };
    let _ = crate::eng().mmu.write_bytes(addr as u64, data);
}

/// Guest memory for a mapped buffer (glMapBufferRange): `len` bytes, or 0.
#[no_mangle]
pub extern "C" fn gl_guest_alloc(len: f64) -> f64 {
    crate::eng().heap_alloc(len as u64, false) as f64
}

/// Frees memory from gl_guest_alloc.
#[no_mangle]
pub extern "C" fn gl_guest_free(addr: f64) {
    crate::eng().heap_free(addr as u64);
}

/// One argument of a params struct, read by its kind letter; returns (value, size).
fn read_arg(e: &mut Engine, at: u64, kind: u8) -> (f64, u64) {
    match kind {
        b'p' | b'q' => (e.r64(at) as i64 as f64, 8),
        b'd' => (f64::from_bits(e.r64(at)), 8),
        b'f' => (f32::from_bits(e.r32(at)) as f64, 4),
        b'i' => (e.r32(at) as i32 as f64, 4),
        b'u' => (e.r32(at) as f64, 4),
        b's' => (e.r16(at) as i16 as f64, 2),
        b'H' => (e.r16(at) as f64, 2),
        b'b' => (e.r8(at) as i8 as f64, 1),
        _ => (e.r8(at) as f64, 1),
    }
}

fn kind_size(kind: u8) -> u64 {
    match kind {
        b'p' | b'q' | b'd' => 8,
        b'f' | b'i' | b'u' => 4,
        b's' | b'H' => 2,
        _ => 1,
    }
}

fn write_ret(e: &mut Engine, at: u64, kind: u8, v: f64) {
    match kind {
        b'p' | b'q' => e.w64(at, v as i64 as u64),
        b'd' => e.w64(at, v.to_bits()),
        b'f' => e.w32(at, (v as f32).to_bits()),
        b'i' | b'u' => e.w32(at, v as i64 as u32),
        b's' | b'H' => e.w16(at, v as i64 as u16),
        _ => e.w8(at, v as i64 as u8),
    }
}

impl Engine {
    /// A unix call of opengl32.dll: `code` is the function's number, `params` its struct.
    pub(crate) fn opengl_call(&mut self, code: u32, params: u64) -> u64 {
        let Some(&(name, sig)) = FUNCS.get(code as usize) else { return INVALID_PARAMETER };
        match name {
            "process_attach" | "thread_attach" | "process_detach" => return OK,
            "get_pixel_formats" => return self.gl_pixel_formats(params),
            _ => {}
        }
        // the arguments, laid out after the TEB pointer with C alignment
        let sig = sig.as_bytes();
        let (args_sig, ret_kind) = match sig.iter().position(|&c| c == b'>') {
            Some(i) => (&sig[..i], Some(sig[i + 1])),
            None => (sig, None),
        };
        let mut at = params + 8;
        let mut args = Vec::with_capacity(args_sig.len());
        for &k in args_sig {
            let sz = kind_size(k);
            at = (at + sz - 1) & !(sz - 1);
            let (v, n) = read_arg(self, at, k);
            args.push(v);
            at += n;
        }
        let ret_at = ret_kind.map(|k| {
            let sz = kind_size(k);
            (at + sz - 1) & !(sz - 1)
        });
        let r = match name {
            "wglGetPixelFormat" => Some(self.gl_get_format(args[0]) as f64),
            "wglSetPixelFormat" => Some(self.gl_set_format(args[0], args[1] as i32) as f64),
            "wglCreateContext" => Some(self.gl_create_context(args[0])),
            "wglCreateContextAttribsARB" => Some(self.gl_create_context(args[0])),
            "wglDeleteContext" => Some(1.0),
            "wglGetProcAddress" => Some(self.gl_proc_index(args[0])),
            "wglMakeCurrent" | "wglMakeContextCurrentARB" => Some(self.gl_make_current(args[0], args[args.len() - 1])),
            "wglSwapBuffers" => Some(self.gl_swap(args[0])),
            "wglChoosePixelFormatARB" => Some(self.gl_choose_format(&args)),
            "wglGetPixelFormatAttribivARB" | "wglGetPixelFormatAttribfvARB" => Some(0.0),
            "wglSwapIntervalEXT" => Some(1.0),
            "wglGetSwapIntervalEXT" => Some(0.0),
            "glGetString" | "glGetStringi" | "wglGetExtensionsStringARB" | "wglGetExtensionsStringEXT" => {
                Some(self.gl_string(code, &args) as f64)
            }
            _ => self.gl_host(code, &args),
        };
        let Some(v) = r else {
            if self.s.gl.missing.insert(code) && unsafe { crate::WINE_DEBUG } > 0 {
                crate::console(&format!("[gl] {} is not available yet\n", name));
            }
            return NOT_IMPLEMENTED;
        };
        if let (Some(k), Some(a)) = (ret_kind, ret_at) {
            write_ret(self, a, k, v);
        }
        OK
    }

    fn gl_host(&mut self, code: u32, args: &[f64]) -> Option<f64> {
        let v = unsafe { host_gl(code, args.as_ptr(), args.len() as u32) };
        if v.is_nan() {
            None
        } else {
            Some(v)
        }
    }

    /// get_pixel_formats(hdc, formats*, max, &num, &num_onscreen): fills the format table.
    fn gl_pixel_formats(&mut self, params: u64) -> u64 {
        let (formats, max) = (self.r64(params + 16), self.r32(params + 24));
        self.w32(params + 28, FORMATS);
        self.w32(params + 32, FORMATS);
        if formats == 0 {
            return OK;
        }
        for i in 0..FORMATS.min(max) {
            let f = formats + FORMAT_SIZE * i as u64;
            self.zero_n(f, FORMAT_SIZE);
            // PIXELFORMATDESCRIPTOR
            self.w16(f, 40);
            self.w16(f + 2, 1);
            self.w32(f + 4, 0x25); // draw to window | support OpenGL | double buffer
            self.w8(f + 8, 0); // RGBA
            for (o, v) in [(9u64, 32u8), (10, 8), (11, 16), (12, 8), (13, 8), (14, 8), (15, 0), (16, 8), (17, 24)] {
                self.w8(f + o, v);
            }
            if i == 0 {
                self.w8(f + 23, 24); // depth
                self.w8(f + 24, 8); // stencil
            }
            self.w32(f + 40, 0x202A); // swap_method: WGL_SWAP_UNDEFINED_ARB
            self.w32(f + 48, 0x202B); // pixel_type: WGL_TYPE_RGBA_ARB
        }
        OK
    }

    fn gl_window(&mut self, hdc: f64) -> u64 {
        crate::winsys::full(self.dc_hwnd(hdc as u64))
    }

    fn gl_get_format(&mut self, hdc: f64) -> i32 {
        let w = self.gl_window(hdc);
        self.s.gl.formats.get(&w).copied().unwrap_or(0)
    }

    fn gl_set_format(&mut self, hdc: f64, format: i32) -> i32 {
        if format < 1 || format as u32 > FORMATS {
            return 0;
        }
        let w = self.gl_window(hdc);
        self.s.gl.formats.insert(w, format);
        1
    }

    /// wglChoosePixelFormatARB(hdc, int attribs, float attribs, max, formats*, count*): format 1.
    fn gl_choose_format(&mut self, args: &[f64]) -> f64 {
        let (max, out, count) = (args[3] as u32, args[4] as u64, args[5] as u64);
        if max > 0 && out != 0 {
            self.w32(out, 1);
        }
        self.w32(count, max.min(1));
        1.0
    }

    /// wglGetProcAddress: the index of the function in opengl32's extension_procs[], or -1.
    fn gl_proc_index(&mut self, name: f64) -> f64 {
        let name = self.read_cstr(name as u64, 256);
        EXT_PROCS.iter().position(|&n| n == name).map_or(-1.0, |i| i as f64)
    }

    fn gl_create_context(&mut self, _hdc: f64) -> f64 {
        self.s.gl.next_context += 1;
        (0x6100_0000 + self.s.gl.next_context) as f64
    }

    /// Makes `ctx` current for `hdc`: the WebGL side sizes its canvas to the window.
    fn gl_make_current(&mut self, hdc: f64, ctx: f64) -> f64 {
        let (w, h) = if ctx != 0.0 { self.dc_size(hdc as u64) } else { (0, 0) };
        let code = FUNCS.iter().position(|f| f.0 == "wglMakeCurrent").unwrap_or(0) as u32;
        self.gl_host(code, &[hdc, ctx, w as f64, h as f64]).unwrap_or(1.0)
    }

    /// wglSwapBuffers: the WebGL side reads its picture into the scratch area (top-down
    /// 0xAARRGGBB words), and it is drawn into the window like a DIB.
    fn gl_swap(&mut self, hdc: f64) -> f64 {
        let (w, h) = self.dc_size(hdc as u64);
        let code = FUNCS.iter().position(|f| f.0 == "wglSwapBuffers").unwrap_or(0) as u32;
        let Some(p) = self.gl_host(code, &[hdc, w as f64, h as f64]) else { return 0.0 };
        if p <= 0.0 || w <= 0 || h <= 0 {
            return 1.0;
        }
        let px = unsafe { std::slice::from_raw_parts(p as u32 as *const u32, (w * h) as usize) }.to_vec();
        self.present_pixels(hdc as u64, w, h, &px);
        1.0
    }

    /// glGetString & co: the WebGL side writes the text into the scratch area and returns
    /// its length; the program gets a pointer to a copy in its own memory.
    fn gl_string(&mut self, code: u32, args: &[f64]) -> u64 {
        let Some(n) = self.gl_host(code, args) else { return 0 };
        if n < 0.0 {
            return 0;
        }
        let bytes = unsafe { std::slice::from_raw_parts(scratch(0), n as usize) }.to_vec();
        let text = String::from_utf8_lossy(&bytes).into_owned();
        if let Some(&a) = self.s.gl.strings.get(&text) {
            return a;
        }
        let a = self.heap_alloc(bytes.len() as u64 + 1, true);
        let _ = self.mmu.write_bytes(a, &bytes);
        self.s.gl.strings.insert(text, a);
        a
    }
}
