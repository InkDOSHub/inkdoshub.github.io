// OpenGL on WebGL 2: the page side of the engine's OpenGL (src/engine/src/opengl).
//
// Wine's opengl32.dll makes one unix call per GL function. The engine reads the call's
// arguments and hands them here by function name (GL_FUNCS, gl-funcs.js), pointers as
// guest addresses: guest memory is read and written through the engine's gl_read and
// gl_write. Contexts share one WebGL 2 context on an OffscreenCanvas; a buffer swap reads
// the picture back and the engine draws it into the window.
//
// What is offered is a desktop OpenGL 3.2 core profile, mapped onto WebGL 2 (GLES 3.0):
// GLSL 1.50 shaders are rewritten as GLSL ES 3.00, integer object names map to WebGL
// objects, and desktop-only formats (BGRA textures) are converted on the way in.

/* global GL_FUNCS */
(() => {
  let x = null, mem = null, gl = null, canvas = null;
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---------- guest memory ----------
  const rd = (a, n) => (n > 0 ? new Uint8Array(mem.buffer, x.gl_read(a, n), n).slice() : new Uint8Array(0));
  const wr = (a, bytes) => {
    if (!a || !bytes.length) return;
    const p = x.gl_scratch(bytes.length);
    new Uint8Array(mem.buffer, p, bytes.length).set(bytes);
    x.gl_write(a, p, bytes.length);
  };
  const rdI32 = (a, n) => new Int32Array(rd(a, 4 * n).buffer);
  const rdU32 = (a, n) => new Uint32Array(rd(a, 4 * n).buffer);
  const rdF32 = (a, n) => new Float32Array(rd(a, 4 * n).buffer);
  const rdPtr = (a, n) => Array.from(new BigUint64Array(rd(a, 8 * n).buffer), Number);
  const wrI32 = (a, vals) => wr(a, new Uint8Array(Int32Array.from(vals).buffer));
  const wrF32 = (a, vals) => wr(a, new Uint8Array(Float32Array.from(vals).buffer));
  const str = (a, len = -1) => {
    if (!a) return '';
    if (len >= 0) return dec.decode(rd(a, len));
    let s = '';
    for (let at = a; ; at += 256) {
      const b = rd(at, 256), z = b.indexOf(0);
      s += dec.decode(z < 0 ? b : b.subarray(0, z));
      if (z >= 0 || s.length > 1 << 20) return s;
    }
  };
  // text results go back through the scratch area: the engine copies them for the program
  const text = (s) => {
    const b = enc.encode(s), p = x.gl_scratch(b.length);
    new Uint8Array(mem.buffer, p, b.length).set(b);
    return b.length;
  };

  // ---------- object names: GL's integers, WebGL's objects ----------
  const kinds = {};
  const table = (kind) => (kinds[kind] ??= { map: new Map(), next: 1 });
  const gen = (kind, n, out, make) => {
    const t = table(kind), ids = [];
    for (let i = 0; i < n; i++) { const id = t.next++; t.map.set(id, make ? make() : null); ids.push(id); }
    wrI32(out, ids);
  };
  const obj = (kind, id, make) => {
    if (!id) return null;
    const t = table(kind);
    let o = t.map.get(id);
    if (!o && make) { o = make(); t.map.set(id, o); if (id >= t.next) t.next = id + 1; }
    return o || null;
  };
  const del = (kind, n, ids, kill) => {
    const t = table(kind);
    for (const id of rdU32(ids, n)) { const o = t.map.get(id); if (o) kill(o); t.map.delete(id); }
  };
  const newId = (kind, o) => { const t = table(kind), id = t.next++; t.map.set(id, o); return id; };
  const tex = (id) => obj('tex', id, () => gl.createTexture());
  const buf = (id) => obj('buf', id, () => gl.createBuffer());
  const fbo = (id) => obj('fbo', id, () => gl.createFramebuffer());
  const rbo = (id) => obj('rbo', id, () => gl.createRenderbuffer());
  const vao = (id) => obj('vao', id, () => gl.createVertexArray());
  const sampler = (id) => obj('smp', id, () => gl.createSampler());
  const query = (id) => obj('qry', id, () => gl.createQuery());
  const prog = (id) => obj('prog', id);
  const shader = (id) => obj('shader', id);
  // uniform locations: per program, by number
  const uniforms = new Map();

  // ---------- what this "driver" says about itself ----------
  const EXTENSIONS = [
    'GL_ARB_framebuffer_object', 'GL_ARB_vertex_array_object', 'GL_ARB_texture_non_power_of_two',
    'GL_ARB_vertex_buffer_object', 'GL_ARB_pixel_buffer_object', 'GL_ARB_depth_texture', 'GL_ARB_shader_objects',
    'GL_ARB_vertex_shader', 'GL_ARB_fragment_shader', 'GL_ARB_shading_language_100', 'GL_ARB_texture_float',
    'GL_ARB_half_float_pixel', 'GL_ARB_instanced_arrays', 'GL_ARB_draw_instanced', 'GL_ARB_sampler_objects',
    'GL_ARB_occlusion_query', 'GL_ARB_texture_rg', 'GL_ARB_map_buffer_range', 'GL_ARB_sync', 'GL_ARB_uniform_buffer_object',
    'GL_EXT_texture_filter_anisotropic', 'GL_ARB_explicit_attrib_location', 'GL_EXT_blend_minmax',
    'GL_ARB_texture_storage', 'GL_EXT_texture_sRGB', 'GL_ARB_depth_buffer_float', 'GL_ARB_vertex_array_bgra',
  ];
  const STRINGS = { 0x1F00: 'InkSoC', 0x1F01: 'WebGL 2 (InkSoC)', 0x1F02: '3.2.0 InkSoC', 0x8B8C: '1.50', 0x1F03: EXTENSIONS.join(' ') };
  // values WebGL 2 does not answer (or answers differently) for a desktop GL 3.2 core profile
  const INTS = {
    0x821B: 3, 0x821C: 2, // MAJOR / MINOR VERSION
    0x821D: EXTENSIONS.length, // NUM_EXTENSIONS
    0x9126: 1, // CONTEXT_PROFILE_MASK: core
    0x821E: 0, // CONTEXT_FLAGS
    0x0D32: 8, 0x0D36: 8, 0x0D3B: 8, 0x0BB0: 16, // max clip planes, lights, modelview stack, attrib stack
    0x8871: 16, 0x8872: 16, 0x8B4C: 16, 0x8B4D: 32, // max texture coords / image units / vertex units / combined
    0x84E2: 8, // MAX_TEXTURE_UNITS (fixed function)
    0x8824: 4, // MAX_DRAW_BUFFERS
    0x8CDF: 4, // MAX_COLOR_ATTACHMENTS
    0x84FF: 16, // MAX_TEXTURE_MAX_ANISOTROPY
    0x8B4A: 1024, 0x8B49: 1024, 0x8DFB: 1024, 0x8DFD: 1024, // max uniform components
    0x8B4B: 64, 0x9125: 64, 0x9122: 64, 0x9124: 64, // max varyings / components
    0x8869: 16, // MAX_VERTEX_ATTRIBS
    0x0D33: 8192, 0x8073: 2048, 0x851C: 8192, 0x84E8: 8192, // max texture size, 3D, cube, renderbuffer
    0x8D57: 4, // MAX_SAMPLES
    0x8E28: 0, // TIMESTAMP bits
    0x8B8D: 0, // CURRENT_PROGRAM handled below
  };

  // ---------- shaders: GLSL 1.50 (desktop) -> GLSL ES 3.00 ----------
  const toEs = (src, type) => {
    let s = src.replace(/^[ \t]*#version[^\n]*\n?/m, '');
    s = s.replace(/^[ \t]*#extension[^\n]*\n?/gm, '');
    const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\nprecision highp samplerCube;\nprecision highp sampler2DShadow;\n';
    if (type === gl.FRAGMENT_SHADER && !/\bout\s+(highp\s+|mediump\s+|lowp\s+)?vec4\b/.test(s) && /gl_FragColor|gl_FragData/.test(s)) {
      s = 'out vec4 inksoc_frag[4];\n' + s.replace(/gl_FragData\s*\[\s*(\d+)\s*\]/g, 'inksoc_frag[$1]').replace(/gl_FragColor/g, 'inksoc_frag[0]');
    }
    return head + s;
  };

  // ---------- pixel transfers ----------
  const unpack = { rowLength: 0, alignment: 4, skipRows: 0, skipPixels: 0 };
  const pack = { rowLength: 0, alignment: 4 };
  const BYTES = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2,
    0x8367: 4, 0x8035: 4, 0x8368: 4, 0x8033: 2, 0x8034: 2, 0x8363: 2, 0x8364: 2, 0x8365: 2, 0x8366: 2, 0x84FA: 4, 0x8C3B: 4, 0x8C3E: 4, 0x8DAD: 8 };
  const PACKED = new Set([0x8367, 0x8035, 0x8368, 0x8033, 0x8034, 0x8363, 0x8364, 0x8365, 0x8366, 0x84FA, 0x8C3B, 0x8C3E, 0x8DAD]);
  const CHANNELS = { 0x1903: 1, 0x1906: 1, 0x1909: 1, 0x8227: 2, 0x8228: 2, 0x190A: 2, 0x1907: 3, 0x80E0: 3, 0x1908: 4, 0x80E1: 4,
    0x1902: 1, 0x84F9: 1, 0x8D94: 1, 0x8D98: 3, 0x8D99: 4, 0x8D9A: 3, 0x8D9B: 4 };
  const pixelSize = (format, type) => (PACKED.has(type) ? BYTES[type] : (CHANNELS[format] || 4) * (BYTES[type] || 1));
  // reads a w x h x d image from guest memory with the unpack state; returns tightly packed rows
  const readImage = (ptr, w, h, d, format, type) => {
    if (!ptr || w <= 0 || h <= 0) return null;
    const ps = pixelSize(format, type), row = (unpack.rowLength || w) * ps, a = unpack.alignment;
    const stride = Math.ceil(row / a) * a, tight = w * ps;
    const raw = rd(ptr + unpack.skipRows * stride + unpack.skipPixels * ps, stride * (h * d - 1) + tight);
    if (stride === tight) return raw;
    const out = new Uint8Array(tight * h * d);
    for (let y = 0; y < h * d; y++) out.set(raw.subarray(y * stride, y * stride + tight), y * tight);
    return out;
  };
  // desktop-only formats become WebGL ones: BGRA -> RGBA bytes, and sized internal formats
  const convert = (internal, format, type, data) => {
    if (format === 0x80E1) { // GL_BGRA
      if (data) {
        if (type === 0x8035) { // 8_8_8_8: A,R,G,B bytes
          for (let i = 0; i < data.length; i += 4) { const al = data[i]; data[i] = data[i + 1]; data[i + 1] = data[i + 2]; data[i + 2] = data[i + 3]; data[i + 3] = al; }
          type = 0x1401;
        } else if (type === 0x8367 || type === 0x1401) { // 8_8_8_8_REV / UNSIGNED_BYTE: B,G,R,A bytes
          for (let i = 0; i < data.length; i += 4) { const b = data[i]; data[i] = data[i + 2]; data[i + 2] = b; }
          type = 0x1401;
        }
      } else type = 0x1401;
      format = 0x1908;
    }
    if (type === 0x8035 && data) { // RGBA 8_8_8_8: A,B,G,R bytes
      for (let i = 0; i < data.length; i += 4) { const r = data[i + 3], g = data[i + 2]; data[i + 3] = data[i]; data[i + 2] = data[i + 1]; data[i] = r; data[i + 1] = g; }
      type = 0x1401;
    } else if (type === 0x8035) type = 0x1401;
    if (type === 0x8367) type = 0x1401; // RGBA with 8_8_8_8_REV = plain bytes
    if (format === 0x1908 && type === 0x1401) internal = internal === 0x8C43 || internal === 0x8C42 ? 0x8C43 : 0x8058; // SRGB8_ALPHA8 or RGBA8
    else if (format === 0x1907 && type === 0x1401) internal = 0x8051; // RGB8
    else if (format === 0x1903 && type === 0x1401) internal = 0x8229; // R8
    else if (format === 0x8227 && type === 0x1401) internal = 0x822B; // RG8
    else if (format === 0x1902) { // DEPTH_COMPONENT
      if (type === 0x1406) internal = 0x8CAC; else if (type === 0x1405) internal = 0x81A6; else { internal = 0x81A5; type = 0x1403; }
    } else if (format === 0x84F9) { internal = 0x88F0; type = 0x84FA; } // DEPTH_STENCIL -> DEPTH24_STENCIL8
    const view = data && (type === 0x1406 ? new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2)
      : type === 0x1403 || type === 0x140B || type === 0x8D61 || type === 0x8363 || type === 0x8033 || type === 0x8034 ? new Uint16Array(data.buffer, data.byteOffset, data.byteLength >> 1)
        : type === 0x1405 || type === 0x84FA || type === 0x8C3B || type === 0x8C3E ? new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2) : data);
    return [internal, format, type, view];
  };

  const vec = (n, f) => (a) => { f(a.slice(0, n)); return 0; };
  const F = {};

  // ---------- WGL (sizes come from the engine) ----------
  F.wglMakeCurrent = (a) => {
    const [, ctx, w, h] = a;
    if (!ctx) return 1;
    if (!gl) {
      canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
      gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, depth: true, stencil: true, alpha: true });
      if (!gl) return 0;
      gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('EXT_texture_filter_anisotropic');
      gl.getExtension('OES_texture_float_linear');
    } else if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    return 1;
  };
  F.wglSwapBuffers = (a) => {
    const [, w, h] = a;
    if (!gl || w <= 0 || h <= 0) return 0;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return 0; }
    const px = new Uint8Array(w * h * 4);
    const prevFb = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), prevPack = gl.getParameter(gl.PACK_ALIGNMENT);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevFb);
    gl.pixelStorei(gl.PACK_ALIGNMENT, prevPack);
    if (self.wineDebug >= 2 && ((swapN = (swapN || 0) + 1) <= 5 || swapN % 50 === 0)) { const c = (w * (h >> 1) + (w >> 1)) * 4, q = (w * (h >> 2) + (w >> 2)) * 4; console.log('[gl] swap', swapN, w, h, 'center', px.slice(c, c + 4).join(','), 'quarter', px.slice(q, q + 4).join(','), 'prevFb', !!prevFb); }
    // bottom-up RGBA bytes -> top-down 0xAARRGGBB words
    const p = x.gl_scratch(w * h * 4), out = new Uint32Array(mem.buffer, p, w * h);
    for (let y = 0; y < h; y++) {
      const s = (h - 1 - y) * w * 4, d = y * w;
      for (let i = 0; i < w; i++) { const k = s + 4 * i; out[d + i] = (0xFF000000 | (px[k] << 16) | (px[k + 1] << 8) | px[k + 2]) >>> 0; }
    }
    return p;
  };
  F.wglGetProcAddress = (a) => {
    const name = str(a[0]);
    return F[name] || F[name.replace(/(ARB|EXT|OES)$/, '')] ? 1 : 0;
  };
  F.wglCreateContextAttribsARB = () => 1; // the engine answers it; listed for wglGetProcAddress
  F.wglGetExtensionsStringARB = () => text('WGL_ARB_extensions_string WGL_ARB_create_context WGL_ARB_create_context_profile WGL_ARB_pixel_format WGL_EXT_swap_control');
  F.wglGetExtensionsStringEXT = F.wglGetExtensionsStringARB;
  F.wglChoosePixelFormatARB = () => 1;
  F.wglGetPixelFormatAttribivARB = () => 1;
  F.wglSwapIntervalEXT = () => 1;
  F.wglGetSwapIntervalEXT = () => 0;

  // ---------- state ----------
  F.glGetString = (a) => (a[0] in STRINGS ? text(STRINGS[a[0]]) : -1);
  F.glGetStringi = (a) => (a[0] === 0x1F03 && a[1] < EXTENSIONS.length ? text(EXTENSIONS[a[1]]) : -1);
  F.glGetError = () => (gl ? gl.getError() : 0);
  const param = (p) => {
    if (p in INTS) return INTS[p];
    if (!gl) return 0;
    if (p === 0x8B8D) { const pr = gl.getParameter(p); return pr ? idOf('prog', pr) : 0; }
    const BIND = { 0x8069: 'tex', 0x8514: 'tex', 0x806A: 'tex', 0x8C1D: 'tex', 0x8894: 'buf', 0x8895: 'buf', 0x88ED: 'buf', 0x88EF: 'buf',
      0x8CA6: 'fbo', 0x8CAA: 'fbo', 0x8CA7: 'rbo', 0x85B5: 'vao', 0x8919: 'smp', 0x8A28: 'buf' };
    let v;
    try { v = gl.getParameter(p); } catch (e) { v = null; }
    gl.getError();
    if (p in BIND) return v ? idOf(BIND[p], v) : 0;
    return v;
  };
  const idOf = (kind, o) => { for (const [k, v] of table(kind).map) if (v === o) return k; return 0; };
  const flat = (v) => (v === null || v === undefined ? [0] : typeof v === 'boolean' ? [v ? 1 : 0] : typeof v === 'number' ? [v] : Array.from(v, Number));
  F.glGetIntegerv = (a) => { wrI32(a[1], flat(param(a[0])).map((v) => v | 0)); return 0; };
  F.glGetInteger64v = (a) => { wr(a[1], new Uint8Array(BigInt64Array.from(flat(param(a[0])).map((v) => BigInt(Math.trunc(v)))).buffer)); return 0; };
  F.glGetFloatv = (a) => { wrF32(a[1], flat(param(a[0]))); return 0; };
  F.glGetDoublev = (a) => { wr(a[1], new Uint8Array(Float64Array.from(flat(param(a[0]))).buffer)); return 0; };
  F.glGetBooleanv = (a) => { wr(a[1], Uint8Array.from(flat(param(a[0])).map((v) => (v ? 1 : 0)))); return 0; };
  F.glGetIntegeri_v = (a) => { let v = 0; try { v = gl.getIndexedParameter(a[0], a[1]); } catch (e) { gl.getError(); } wrI32(a[2], flat(v).map((t) => t | 0)); return 0; };
  F.glEnable = (a) => { if (a[0] !== 0x8642 && a[0] !== 0x884F && a[0] !== 0x8DB9 && a[0] !== 0x809D) gl.enable(a[0]); gl.getError(); return 0; };
  F.glDisable = (a) => { if (a[0] !== 0x8642 && a[0] !== 0x884F && a[0] !== 0x8DB9 && a[0] !== 0x809D) gl.disable(a[0]); gl.getError(); return 0; };
  F.glIsEnabled = (a) => (gl.isEnabled(a[0]) ? 1 : 0);
  F.glEnablei = (a) => { gl.enable(a[0]); return 0; };
  F.glDisablei = (a) => { gl.disable(a[0]); return 0; };
  F.glHint = (a) => { try { gl.hint(a[0], a[1]); } catch (e) { /* desktop hints */ } gl.getError(); return 0; };
  F.glFlush = () => { gl.flush(); return 0; };
  F.glFinish = () => { gl.finish(); return 0; };
  F.glViewport = (a) => { gl.viewport(a[0], a[1], a[2], a[3]); return 0; };
  F.glScissor = (a) => { gl.scissor(a[0], a[1], a[2], a[3]); return 0; };
  F.glDepthRange = (a) => { gl.depthRange(a[0], a[1]); return 0; };
  F.glDepthRangef = F.glDepthRange;
  F.glClear = (a) => { gl.clear(a[0]); return 0; };
  F.glClearColor = (a) => { gl.clearColor(a[0], a[1], a[2], a[3]); return 0; };
  F.glClearDepth = (a) => { gl.clearDepth(a[0]); return 0; };
  F.glClearDepthf = F.glClearDepth;
  F.glClearStencil = (a) => { gl.clearStencil(a[0]); return 0; };
  F.glColorMask = (a) => { gl.colorMask(!!a[0], !!a[1], !!a[2], !!a[3]); return 0; };
  F.glColorMaski = F.glColorMask.bind(null) && ((a) => { gl.colorMask(!!a[1], !!a[2], !!a[3], !!a[4]); return 0; });
  F.glDepthMask = (a) => { gl.depthMask(!!a[0]); return 0; };
  F.glDepthFunc = (a) => { gl.depthFunc(a[0]); return 0; };
  F.glStencilMask = (a) => { gl.stencilMask(a[0]); return 0; };
  F.glStencilMaskSeparate = (a) => { gl.stencilMaskSeparate(a[0], a[1]); return 0; };
  F.glStencilFunc = (a) => { gl.stencilFunc(a[0], a[1], a[2]); return 0; };
  F.glStencilFuncSeparate = (a) => { gl.stencilFuncSeparate(a[0], a[1], a[2], a[3]); return 0; };
  F.glStencilOp = (a) => { gl.stencilOp(a[0], a[1], a[2]); return 0; };
  F.glStencilOpSeparate = (a) => { gl.stencilOpSeparate(a[0], a[1], a[2], a[3]); return 0; };
  F.glBlendFunc = (a) => { gl.blendFunc(a[0], a[1]); return 0; };
  F.glBlendFuncSeparate = (a) => { gl.blendFuncSeparate(a[0], a[1], a[2], a[3]); return 0; };
  F.glBlendEquation = (a) => { gl.blendEquation(a[0]); return 0; };
  F.glBlendEquationSeparate = (a) => { gl.blendEquationSeparate(a[0], a[1]); return 0; };
  F.glBlendColor = (a) => { gl.blendColor(a[0], a[1], a[2], a[3]); return 0; };
  F.glCullFace = (a) => { gl.cullFace(a[0]); return 0; };
  F.glFrontFace = (a) => { gl.frontFace(a[0]); return 0; };
  F.glPolygonOffset = (a) => { gl.polygonOffset(a[0], a[1]); return 0; };
  F.glPolygonMode = () => 0; // fill only
  F.glLineWidth = (a) => { gl.lineWidth(a[0]); return 0; };
  F.glPointSize = () => 0;
  F.glPixelStorei = (a) => {
    const [p, v] = a;
    if (p === 0x0CF2) unpack.rowLength = v; else if (p === 0x0CF5) unpack.alignment = v; else if (p === 0x0CF3) unpack.skipRows = v; else if (p === 0x0CF4) unpack.skipPixels = v;
    else if (p === 0x0D02) pack.rowLength = v; else if (p === 0x0D05) pack.alignment = v;
    if (p === 0x0CF5 || p === 0x0D05) gl.pixelStorei(p, v); // the rest is done here, on the way in
    return 0;
  };
  F.glPixelStoref = (a) => F.glPixelStorei(a);
  F.glReadBuffer = (a) => { gl.readBuffer(a[0] === 0x0405 || a[0] === 0x0404 ? gl.BACK : a[0]); gl.getError(); return 0; };
  F.glDrawBuffer = (a) => { const b = a[0] === 0x0405 || a[0] === 0x0404 ? gl.BACK : a[0]; try { gl.drawBuffers([b]); } catch (e) { /* */ } gl.getError(); return 0; };
  F.glDrawBuffers = (a) => { gl.drawBuffers(Array.from(rdU32(a[1], a[0]))); gl.getError(); return 0; };

  // ---------- textures and samplers ----------
  F.glGenTextures = (a) => { gen('tex', a[0], a[1], () => gl.createTexture()); return 0; };
  F.glDeleteTextures = (a) => { del('tex', a[0], a[1], (o) => gl.deleteTexture(o)); return 0; };
  F.glBindTexture = (a) => { gl.bindTexture(a[0] === 0x84F5 ? gl.TEXTURE_2D : a[0], tex(a[1])); gl.getError(); return 0; };
  F.glActiveTexture = (a) => { gl.activeTexture(a[0]); return 0; };
  F.glIsTexture = (a) => (table('tex').map.has(a[0]) ? 1 : 0);
  F.glTexParameteri = (a) => { if (a[1] !== 0x813C && a[1] !== 0x813D || true) { try { gl.texParameteri(a[0], a[1], a[2]); } catch (e) { /* */ } } gl.getError(); return 0; };
  F.glTexParameterf = (a) => { try { gl.texParameterf(a[0], a[1], a[2]); } catch (e) { /* */ } gl.getError(); return 0; };
  F.glTexParameteriv = (a) => F.glTexParameteri([a[0], a[1], rdI32(a[2], 1)[0]]);
  F.glTexParameterfv = (a) => F.glTexParameterf([a[0], a[1], rdF32(a[2], 1)[0]]);
  // each texture level's size and format: WebGL cannot be asked (glGetTexImage, glGetTexLevelParameteriv)
  const levels = new WeakMap();
  const bindingOf = (target) => (target >= 0x8515 && target <= 0x851A ? gl.TEXTURE_BINDING_CUBE_MAP : target === 0x806F ? gl.TEXTURE_BINDING_3D : target === 0x8C1A ? gl.TEXTURE_BINDING_2D_ARRAY : gl.TEXTURE_BINDING_2D);
  const setLevel = (target, level, w, h, internal) => {
    const t = gl.getParameter(bindingOf(target));
    if (!t) return;
    if (!levels.has(t)) levels.set(t, new Map());
    levels.get(t).set(target + ':' + level, [w, h, internal]);
  };
  const getLevel = (target, level) => { const t = gl.getParameter(bindingOf(target)); return t && levels.has(t) ? [t, levels.get(t).get(target + ':' + level)] : [t, null]; };
  F.glTexImage2D = (a) => {
    const [target, level, internal, w, h, , format, type, ptr] = a;
    setLevel(target, level, w, h, internal);
    const bound = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    const data = bound ? null : readImage(ptr, w, h, 1, format, type);
    const [i2, f2, t2, v] = convert(internal, format, type, data);
    if (bound) gl.texImage2D(target, level, i2, w, h, 0, f2, t2, ptr);
    else gl.texImage2D(target, level, i2, w, h, 0, f2, t2, v);
    return 0;
  };
  F.glTexSubImage2D = (a) => {
    const [target, level, xo, yo, w, h, format, type, ptr] = a;
    const bound = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    const data = bound ? null : readImage(ptr, w, h, 1, format, type);
    const [, f2, t2, v] = convert(0, format, type, data);
    if (bound) gl.texSubImage2D(target, level, xo, yo, w, h, f2, t2, ptr);
    else gl.texSubImage2D(target, level, xo, yo, w, h, f2, t2, v);
    return 0;
  };
  F.glTexImage3D = (a) => {
    const [target, level, internal, w, h, d, , format, type, ptr] = a;
    const [i2, f2, t2, v] = convert(internal, format, type, readImage(ptr, w, h, d, format, type));
    gl.texImage3D(target, level, i2, w, h, d, 0, f2, t2, v);
    return 0;
  };
  F.glTexStorage2D = (a) => {
    for (let i = 0; i < a[1]; i++) {
      const faces = a[0] === 0x8513 ? [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851A] : [a[0]];
      for (const f of faces) setLevel(f === a[0] ? a[0] : f, i, Math.max(1, a[3] >> i), Math.max(1, a[4] >> i), a[2]);
    }
    return texStorage2D(a);
  };
  const texStorage2D = (a) => { const [i2] = convert(a[2], 0, 0, null); gl.texStorage2D(a[0], a[1], i2 === 0 ? a[2] : a[2] === 0x8058 || a[2] === 0x1908 ? 0x8058 : a[2], a[3], a[4]); return 0; };
  F.glGenerateMipmap = (a) => { gl.generateMipmap(a[0]); return 0; };
  F.glGenSamplers = (a) => { gen('smp', a[0], a[1], () => gl.createSampler()); return 0; };
  F.glDeleteSamplers = (a) => { del('smp', a[0], a[1], (o) => gl.deleteSampler(o)); return 0; };
  F.glBindSampler = (a) => { gl.bindSampler(a[0], sampler(a[1])); return 0; };
  F.glSamplerParameteri = (a) => { try { gl.samplerParameteri(sampler(a[0]), a[1], a[2]); } catch (e) { /* */ } gl.getError(); return 0; };
  F.glSamplerParameterf = (a) => { try { gl.samplerParameterf(sampler(a[0]), a[1], a[2]); } catch (e) { /* */ } gl.getError(); return 0; };
  F.glSamplerParameterfv = (a) => F.glSamplerParameterf([a[0], a[1], rdF32(a[2], 1)[0]]);
  F.glSamplerParameteriv = (a) => F.glSamplerParameteri([a[0], a[1], rdI32(a[2], 1)[0]]);

  // ---------- buffers ----------
  const sizes = new Map(); // buffer id -> size
  F.glGenBuffers = (a) => { gen('buf', a[0], a[1], () => gl.createBuffer()); return 0; };
  F.glDeleteBuffers = (a) => {
    for (const id of rdI32(a[1], a[0])) { const m = maps.get(id); if (m) { x.gl_guest_free(m.ptr); maps.delete(id); } }
    del('buf', a[0], a[1], (o) => gl.deleteBuffer(o));
    return 0;
  };
  F.glBindBuffer = (a) => { gl.bindBuffer(a[0], buf(a[1])); return 0; };
  F.glBindBufferBase = (a) => { gl.bindBufferBase(a[0], a[1], buf(a[2])); return 0; };
  F.glBindBufferRange = (a) => { gl.bindBufferRange(a[0], a[1], buf(a[2]), a[3], a[4]); return 0; };
  F.glIsBuffer = (a) => (table('buf').map.has(a[0]) ? 1 : 0);
  const boundBuffer = (target) => {
    const B = { 0x8892: 0x8894, 0x8893: 0x8895, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8A11: 0x8A28, 0x8F36: 0x8F36, 0x8F37: 0x8F37 };
    const o = gl.getParameter(B[target] || 0x8894);
    return o ? idOf('buf', o) : 0;
  };
  F.glBufferData = (a) => {
    const [target, size, ptr, usage] = a;
    sizes.set(boundBuffer(target), size);
    if (ptr) gl.bufferData(target, rd(ptr, size), usage); else gl.bufferData(target, size, usage);
    return 0;
  };
  F.glBufferSubData = (a) => { gl.bufferSubData(a[0], a[1], rd(a[3], a[2])); return 0; };
  F.glGetBufferSubData = (a) => { const b = new Uint8Array(a[2]); gl.getBufferSubData(a[0], a[1], b); wr(a[3], b); return 0; };
  // mapping: WebGL has none, so a mapped range is a piece of guest memory, read from the
  // buffer when the program wants to read it and written back on flush or unmap
  const maps = new Map(); // buffer id -> { ptr, cap, offset, length, access }
  const mapRange = (target, offset, length, access) => {
    const id = boundBuffer(target);
    if (!id || length <= 0) return 0;
    let m = maps.get(id);
    if (!m || m.cap < length) {
      if (m) x.gl_guest_free(m.ptr);
      m = { ptr: x.gl_guest_alloc(length), cap: length };
      if (!m.ptr) return 0;
      maps.set(id, m);
    }
    Object.assign(m, { offset, length, access, mapped: true });
    if (access & 1) { const b = new Uint8Array(length); gl.getBufferSubData(target, offset, b); wr(m.ptr, b); } // MAP_READ_BIT
    return m.ptr;
  };
  F.glMapBufferRange = (a) => mapRange(a[0], a[1], a[2], a[3]);
  F.glMapBuffer = (a) => mapRange(a[0], 0, sizes.get(boundBuffer(a[0])) || 0, { 0x88B8: 1, 0x88B9: 2, 0x88BA: 3 }[a[1]] || 3);
  F.glFlushMappedBufferRange = (a) => {
    const m = maps.get(boundBuffer(a[0]));
    if (m && m.mapped && a[2] > 0) gl.bufferSubData(a[0], m.offset + a[1], rd(m.ptr + a[1], a[2]));
    return 0;
  };
  F.glUnmapBuffer = (a) => {
    const m = maps.get(boundBuffer(a[0]));
    if (!m || !m.mapped) return 0;
    m.mapped = false;
    if ((m.access & 2) && !(m.access & 0x10)) gl.bufferSubData(a[0], m.offset, rd(m.ptr, m.length)); // WRITE, not FLUSH_EXPLICIT
    return 1;
  };

  // ---------- vertex arrays and drawing ----------
  F.glGenVertexArrays = (a) => { gen('vao', a[0], a[1], () => gl.createVertexArray()); return 0; };
  F.glDeleteVertexArrays = (a) => { del('vao', a[0], a[1], (o) => gl.deleteVertexArray(o)); return 0; };
  F.glBindVertexArray = (a) => { gl.bindVertexArray(vao(a[0])); return 0; };
  F.glEnableVertexAttribArray = (a) => { gl.enableVertexAttribArray(a[0]); return 0; };
  F.glDisableVertexAttribArray = (a) => { gl.disableVertexAttribArray(a[0]); return 0; };
  F.glVertexAttribPointer = (a) => {
    // GL_BGRA as the size (ARB_vertex_array_bgra): 4 components (D3DCOLOR); the shader swizzles
    gl.vertexAttribPointer(a[0], a[1] === 0x80E1 ? 4 : a[1], a[2], !!a[3], a[4], a[5]);
    return 0;
  };
  F.glVertexAttribIPointer = (a) => { gl.vertexAttribIPointer(a[0], a[1], a[2], a[3], a[4]); return 0; };
  F.glVertexAttribDivisor = (a) => { gl.vertexAttribDivisor(a[0], a[1]); return 0; };
  F.glVertexAttrib4f = (a) => { gl.vertexAttrib4f(a[0], a[1], a[2], a[3], a[4]); return 0; };
  F.glVertexAttrib4fv = (a) => { gl.vertexAttrib4fv(a[0], rdF32(a[1], 4)); return 0; };
  F.glDrawArrays = (a) => { gl.drawArrays(a[0], a[1], a[2]); return 0; };
  F.glDrawArraysInstanced = (a) => { gl.drawArraysInstanced(a[0], a[1], a[2], a[3]); return 0; };
  F.glDrawElements = (a) => { gl.drawElements(a[0], a[1], a[2], a[3]); return 0; };
  F.glDrawElementsInstanced = (a) => { gl.drawElementsInstanced(a[0], a[1], a[2], a[3], a[4]); return 0; };
  F.glDrawRangeElements = (a) => { gl.drawRangeElements(a[0], a[1], a[2], a[3], a[4], a[5]); return 0; };
  F.glDrawElementsBaseVertex = (a) => { if (a[4]) return NaN; gl.drawElements(a[0], a[1], a[2], a[3]); return 0; };

  // ---------- shaders and programs ----------
  F.glCreateShader = (a) => newId('shader', { s: gl.createShader(a[0]), type: a[0], progs: new Set() });
  // a shader deleted while attached lives on until it is detached (GL keeps it; WebGL would not)
  const dropShader = (id) => { const o = shader(id); if (o && o.gone && !o.progs.size) { gl.deleteShader(o.s); table('shader').map.delete(id); } };
  F.glDeleteShader = (a) => { const o = shader(a[0]); if (o) { o.gone = true; dropShader(a[0]); } return 0; };
  F.glShaderSource = (a) => {
    const [id, count, strings, lengths] = a;
    const ptrs = rdPtr(strings, count), lens = lengths ? rdI32(lengths, count) : null;
    let src = '';
    for (let i = 0; i < count; i++) src += str(ptrs[i], lens && lens[i] >= 0 ? lens[i] : -1);
    const o = shader(id);
    o.src = src;
    gl.shaderSource(o.s, toEs(src, o.type));
    return 0;
  };
  F.glCompileShader = (a) => {
    const o = shader(a[0]);
    gl.compileShader(o.s);
    if (!gl.getShaderParameter(o.s, gl.COMPILE_STATUS)) console.log('[gl] shader:', gl.getShaderInfoLog(o.s), '\n', gl.getShaderSource(o.s));
    return 0;
  };
  F.glGetShaderiv = (a) => {
    const o = shader(a[0]);
    let v = 0;
    if (a[1] === 0x8B84) v = (gl.getShaderInfoLog(o.s) || '').length + 1; // INFO_LOG_LENGTH
    else if (a[1] === 0x8B88) v = (o.src || '').length + 1; // SHADER_SOURCE_LENGTH
    else v = gl.getShaderParameter(o.s, a[1]);
    wrI32(a[2], [+v || 0]);
    return 0;
  };
  const putLog = (log, max, lenOut, out) => {
    const b = enc.encode(log || '').subarray(0, Math.max(0, max - 1));
    if (out && max > 0) wr(out, Uint8Array.of(...b, 0));
    if (lenOut) wrI32(lenOut, [b.length]);
    return 0;
  };
  F.glGetShaderInfoLog = (a) => putLog(gl.getShaderInfoLog(shader(a[0]).s), a[1], a[2], a[3]);
  F.glCreateProgram = () => newId('prog', gl.createProgram());
  F.glDeleteProgram = (a) => {
    const o = prog(a[0]);
    if (o) gl.deleteProgram(o);
    table('prog').map.delete(a[0]); uniforms.delete(a[0]);
    for (const [id, sh] of [...table('shader').map]) if (sh.progs.delete(a[0])) dropShader(id);
    return 0;
  };
  F.glAttachShader = (a) => { const o = shader(a[1]); gl.attachShader(prog(a[0]), o.s); o.progs.add(a[0]); return 0; };
  F.glDetachShader = (a) => { const o = shader(a[1]); gl.detachShader(prog(a[0]), o.s); o.progs.delete(a[0]); dropShader(a[1]); return 0; };
  F.glGetAttachedShaders = (a) => {
    const ids = [...table('shader').map].filter(([, o]) => o.progs.has(a[0])).map(([id]) => id).slice(0, Math.max(0, a[1]));
    if (a[2]) wrI32(a[2], [ids.length]);
    if (a[3] && ids.length) wrI32(a[3], ids);
    return 0;
  };
  F.glGetShaderSource = (a) => putLog(shader(a[0]).src, a[1], a[2], a[3]);
  F.glBindAttribLocation = (a) => { gl.bindAttribLocation(prog(a[0]), a[1], str(a[2])); return 0; };
  F.glBindFragDataLocation = () => 0; // GLSL ES: outputs take their layout locations
  F.glLinkProgram = (a) => {
    gl.linkProgram(prog(a[0]));
    if (!gl.getProgramParameter(prog(a[0]), gl.LINK_STATUS)) console.log('[gl] link:', gl.getProgramInfoLog(prog(a[0])));
    uniforms.set(a[0], { byName: new Map(), byId: [null] });
    return 0;
  };
  F.glUseProgram = (a) => { gl.useProgram(prog(a[0])); return 0; };
  F.glValidateProgram = (a) => { gl.validateProgram(prog(a[0])); return 0; };
  F.glGetProgramiv = (a) => {
    const p = prog(a[0]);
    let v;
    if (a[1] === 0x8B84) v = (gl.getProgramInfoLog(p) || '').length + 1;
    else if (a[1] === 0x8B87) v = 256; // ACTIVE_UNIFORM_MAX_LENGTH
    else if (a[1] === 0x8B8A) v = 256; // ACTIVE_ATTRIBUTE_MAX_LENGTH
    else v = gl.getProgramParameter(p, a[1]);
    wrI32(a[2], [+v || 0]);
    return 0;
  };
  F.glGetProgramInfoLog = (a) => putLog(gl.getProgramInfoLog(prog(a[0])), a[1], a[2], a[3]);
  F.glGetAttribLocation = (a) => gl.getAttribLocation(prog(a[0]), str(a[1]));
  F.glGetUniformLocation = (a) => {
    const u = uniforms.get(a[0]) || { byName: new Map(), byId: [null] };
    uniforms.set(a[0], u);
    const name = str(a[1]);
    if (u.byName.has(name)) return u.byName.get(name);
    const loc = gl.getUniformLocation(prog(a[0]), name);
    if (!loc) return -1;
    const id = u.byId.length;
    u.byId.push(loc);
    u.byName.set(name, id);
    return id;
  };
  const curUniforms = () => { const p = gl.getParameter(gl.CURRENT_PROGRAM); return p ? uniforms.get(idOf('prog', p)) : null; };
  const loc = (id) => { const u = curUniforms(); return u && id >= 0 ? u.byId[id] || null : null; };
  F.glUniform1i = (a) => { gl.uniform1i(loc(a[0]), a[1]); return 0; };
  F.glUniform1f = (a) => { gl.uniform1f(loc(a[0]), a[1]); return 0; };
  F.glUniform2f = (a) => { gl.uniform2f(loc(a[0]), a[1], a[2]); return 0; };
  F.glUniform3f = (a) => { gl.uniform3f(loc(a[0]), a[1], a[2], a[3]); return 0; };
  F.glUniform4f = (a) => { gl.uniform4f(loc(a[0]), a[1], a[2], a[3], a[4]); return 0; };
  F.glUniform1iv = (a) => { gl.uniform1iv(loc(a[0]), rdI32(a[2], a[1])); return 0; };
  F.glUniform4iv = (a) => { gl.uniform4iv(loc(a[0]), rdI32(a[2], 4 * a[1])); return 0; };
  F.glUniform1fv = (a) => { gl.uniform1fv(loc(a[0]), rdF32(a[2], a[1])); return 0; };
  F.glUniform2fv = (a) => { gl.uniform2fv(loc(a[0]), rdF32(a[2], 2 * a[1])); return 0; };
  F.glUniform3fv = (a) => { gl.uniform3fv(loc(a[0]), rdF32(a[2], 3 * a[1])); return 0; };
  F.glUniform4fv = (a) => { gl.uniform4fv(loc(a[0]), rdF32(a[2], 4 * a[1])); return 0; };
  F.glUniformMatrix4fv = (a) => { gl.uniformMatrix4fv(loc(a[0]), !!a[2], rdF32(a[3], 16 * a[1])); return 0; };
  F.glUniformMatrix3fv = (a) => { gl.uniformMatrix3fv(loc(a[0]), !!a[2], rdF32(a[3], 9 * a[1])); return 0; };
  F.glGetUniformBlockIndex = (a) => gl.getUniformBlockIndex(prog(a[0]), str(a[1]));
  F.glUniformBlockBinding = (a) => { gl.uniformBlockBinding(prog(a[0]), a[1], a[2]); return 0; };

  // ---------- framebuffers ----------
  F.glGenFramebuffers = (a) => { gen('fbo', a[0], a[1], () => gl.createFramebuffer()); return 0; };
  F.glDeleteFramebuffers = (a) => { del('fbo', a[0], a[1], (o) => gl.deleteFramebuffer(o)); return 0; };
  F.glBindFramebuffer = (a) => { gl.bindFramebuffer(a[0], fbo(a[1])); return 0; };
  F.glGenRenderbuffers = (a) => { gen('rbo', a[0], a[1], () => gl.createRenderbuffer()); return 0; };
  F.glDeleteRenderbuffers = (a) => { del('rbo', a[0], a[1], (o) => gl.deleteRenderbuffer(o)); return 0; };
  F.glBindRenderbuffer = (a) => { gl.bindRenderbuffer(a[0], rbo(a[1])); return 0; };
  F.glRenderbufferStorage = (a) => { gl.renderbufferStorage(a[0], a[1] === 0x1908 ? 0x8058 : a[1] === 0x84F9 ? 0x88F0 : a[1], a[2], a[3]); return 0; };
  F.glRenderbufferStorageMultisample = (a) => { gl.renderbufferStorageMultisample(a[0], a[1], a[2], a[3], a[4]); return 0; };
  F.glFramebufferTexture2D = (a) => { gl.framebufferTexture2D(a[0], a[1], a[2], tex(a[3]), a[4]); return 0; };
  F.glFramebufferTextureLayer = (a) => { gl.framebufferTextureLayer(a[0], a[1], tex(a[2]), a[3], a[4]); return 0; };
  F.glFramebufferRenderbuffer = (a) => { gl.framebufferRenderbuffer(a[0], a[1], a[2], rbo(a[3])); return 0; };
  F.glCheckFramebufferStatus = (a) => gl.checkFramebufferStatus(a[0]);
  F.glBlitFramebuffer = (a) => { gl.blitFramebuffer(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9]); return 0; };
  F.glGetFramebufferAttachmentParameteriv = (a) => { let v = 0; try { v = gl.getFramebufferAttachmentParameter(a[0], a[1], a[2]); } catch (e) { gl.getError(); } wrI32(a[3], [typeof v === 'number' ? v : 0]); return 0; };
  F.glReadPixels = (a) => {
    const [x0, y0, w, h, format, type, ptr] = a;
    if (format === 0x80E1 || type === 0x8367) { // BGRA: read RGBA and swap
      const b = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
      for (let i = 0; i < b.length; i += 4) { const t = b[i]; b[i] = b[i + 2]; b[i + 2] = t; }
      wr(ptr, b);
      return 0;
    }
    const b = new Uint8Array(w * h * pixelSize(format, type));
    gl.readPixels(x0, y0, w, h, format, type, b);
    wr(ptr, b);
    return 0;
  };

  // glGetTexImage: the level is attached to a scratch framebuffer and read back
  let readFbo = null;
  F.glGetTexImage = (a) => {
    const [target, level, format, type, ptr] = a;
    const [t, lv] = getLevel(target, level);
    if (!t || !lv) return 0;
    const prev = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    readFbo ??= gl.createFramebuffer();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, target === 0x84F5 ? gl.TEXTURE_2D : target, t, level);
    const pb = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    if (pb) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) F.glReadPixels([0, 0, lv[0], lv[1], format, type, ptr]);
    if (pb) gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pb);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev);
    gl.getError();
    return 0;
  };
  F.glGetTexLevelParameteriv = (a) => {
    const [, lv] = getLevel(a[0], a[1]);
    const v = !lv ? 0 : a[2] === 0x1000 ? lv[0] : a[2] === 0x1001 ? lv[1] : a[2] === 0x1003 ? lv[2] : a[2] === 0x8071 ? 1 : 0; // WIDTH, HEIGHT, INTERNAL_FORMAT, DEPTH
    wrI32(a[3], [v]);
    return 0;
  };

  // ---------- queries and syncs ----------
  F.glGenQueries = (a) => { gen('qry', a[0], a[1], () => gl.createQuery()); return 0; };
  F.glDeleteQueries = (a) => { del('qry', a[0], a[1], (o) => gl.deleteQuery(o)); return 0; };
  F.glBeginQuery = (a) => { gl.beginQuery(a[0] === 0x8914 ? gl.ANY_SAMPLES_PASSED : a[0], query(a[1])); return 0; };
  F.glEndQuery = (a) => { gl.endQuery(a[0] === 0x8914 ? gl.ANY_SAMPLES_PASSED : a[0]); return 0; };
  F.glGetQueryObjectuiv = (a) => { const v = gl.getQueryParameter(query(a[0]), a[1]); wrI32(a[2], [+v || 0]); return 0; };
  F.glGetQueryObjectiv = F.glGetQueryObjectuiv;
  const syncs = new Map();
  F.glFenceSync = (a) => { const s = gl.fenceSync(a[0], a[1]); const id = newId('sync', s); syncs.set(id, s); return id; };
  F.glDeleteSync = (a) => { const s = syncs.get(a[0]); if (s) gl.deleteSync(s); syncs.delete(a[0]); return 0; };
  F.glClientWaitSync = () => 0x911C; // CONDITION_SATISFIED: everything here is already done
  F.glWaitSync = () => 0;

  // ---------- the call from the engine ----------
  const seen = {};
  let swapN = 0;
  self.glCall = (engine, memory, code, p, n) => {
    x = engine; mem = memory;
    const name = GL_FUNCS[code], f = F[name] || F[name.replace(/(ARB|EXT)$/, '')];
    if (!f) return NaN;
    const args = Array.from(new Float64Array(mem.buffer, p, n));
    try {
      const r = f(args);
      // ?winedebug=2 or more: each WebGL error once per function (the program may never ask)
      if (self.wineDebug >= 2 && name !== 'glGetError') {
        const err = gl && gl.getError();
        if (err && (seen[name + err] = (seen[name + err] || 0) + 1) <= 5) { console.log('[gl] ' + name + ' -> error 0x' + err.toString(16) + ' (' + args.map((v) => (v > 9 ? '0x' + v.toString(16) : v)).join(', ') + ')'); }
      }
      return r === undefined || r === null ? 0 : +r;
    } catch (e) {
      console.log('[gl] ' + name + ': ' + (e && e.message || e));
      return 0;
    }
  };
})();
