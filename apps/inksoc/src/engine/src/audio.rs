// Audio: the Unix side of Wine's winepulse.drv.
//
// Wine's mmdevapi.dll (behind winmm, DirectSound, XAudio2 and WASAPI) loads an audio driver
// and makes unix calls to it (Wine 11 dlls/mmdevapi/unixlib.h: code = position in
// enum unix_funcs). The engine answers as winepulse.drv would: one speaker device, any
// PCM or float format. Each block the program writes is turned into 32-bit float samples
// and handed to the page (host_audio), which plays it with Web Audio. The engine keeps
// the clock: what was written drains at the stream's rate, so padding and position move
// like on a real device.
//
// Recording (capture) devices: none.

use crate::sched::{BLOCK, W};
use crate::Engine;
use std::collections::HashMap;

#[link(wasm_import_module = "env")]
extern "C" {
    /// Plays `frames` frames of float samples (`channels` interleaved, at `rate`) for
    /// stream `id`; frames = 0 drops what is queued for it (stop, reset, release).
    fn host_audio(id: u32, samples: *const f32, frames: u32, channels: u32, rate: u32);
}

// HRESULTs
const S_OK: u64 = 0;
const E_FAIL: u32 = 0x8000_4005;
const E_NOTIMPL: u32 = 0x8000_4001;
const INSUFFICIENT_BUFFER: u32 = 0x8007_007A;
const AUDCLNT_E_NOT_STOPPED: u32 = 0x8889_0005;
const AUDCLNT_E_BUFFER_TOO_LARGE: u32 = 0x8889_0006;
const AUDCLNT_E_OUT_OF_ORDER: u32 = 0x8889_0007;
const AUDCLNT_E_UNSUPPORTED_FORMAT: u32 = 0x8889_0008;
const AUDCLNT_E_INVALID_SIZE: u32 = 0x8889_0009;
const AUDCLNT_E_DEVICE_INVALIDATED: u32 = 0x8889_0004;
const AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED: u32 = 0x8889_000E;
const AUDCLNT_BUFFERFLAGS_SILENT: u32 = 2;

/// The one device: its Windows name and its driver name.
const DEVICE_NAME: &str = "Speakers (InkSoC)";
const DEVICE: &str = "inksoc";
/// The mix format: 48 kHz, stereo, 32-bit float.
const MIX_RATE: u32 = 48000;
const MIX_CHANNELS: u16 = 2;
/// Device periods (100 ns units): 10 ms default, 3 ms minimum.
const DEF_PERIOD: u64 = 100_000;
const MIN_PERIOD: u64 = 30_000;

#[derive(Clone, Copy)]
enum Sample {
    U8,
    I16,
    I24,
    I32,
    F32,
}

struct Stream {
    id: u32,
    rate: u32,
    channels: u32,
    align: u32,
    sample: Sample,
    /// buffer size and period in frames, period in ms
    buf_frames: u32,
    period_frames: u32,
    period_ms: f64,
    /// where the program writes (one buffer's worth), and how much it asked for
    local: u64,
    locked: u32,
    /// frames written and not yet played; played frames (fractional) and when
    held: f64,
    played: f64,
    last: f64,
    started: bool,
    event: u64,
    quit: bool,
    volume: Vec<f32>,
}

#[derive(Default)]
pub struct Audio {
    streams: HashMap<u64, Stream>,
    next: u32,
}

/// The sample format of a WAVEFORMATEX(TENSIBLE), or None when it cannot be played.
fn parse_format(e: &mut Engine, f: u64) -> Option<(u32, u32, u32, Sample)> {
    let (tag, channels, rate, align, bits) = (e.r16(f), e.r16(f + 2) as u32, e.r32(f + 4), e.r16(f + 12) as u32, e.r16(f + 14));
    let float = match tag {
        1 => false,
        3 => true,
        0xFFFE => match e.r32(f + 24) {
            1 => false,
            3 => true,
            _ => return None,
        },
        _ => return None,
    };
    let sample = match (float, bits) {
        (false, 8) => Sample::U8,
        (false, 16) => Sample::I16,
        (false, 24) => Sample::I24,
        (false, 32) => Sample::I32,
        (true, 32) => Sample::F32,
        _ => return None,
    };
    if channels == 0 || channels > 8 || !(8000..=192_000).contains(&rate) || align != channels * bits as u32 / 8 {
        return None;
    }
    Some((rate, channels, align, sample))
}

impl Stream {
    /// Lets the played part drain at the stream's rate (the device clock).
    fn update(&mut self) {
        let now = crate::now_ms();
        if self.started {
            let n = (now - self.last) * self.rate as f64 / 1000.0;
            if n >= self.held - 0.01 {
                // all played (whole frames, so a position reaches the end exactly)
                self.played = (self.played + self.held).round();
                self.held = 0.0;
            } else {
                self.held -= n;
                self.played += n;
            }
        }
        self.last = now;
    }

    fn padding(&mut self) -> u32 {
        self.update();
        self.held.ceil() as u32
    }
}

impl Engine {
    /// A unix call of winepulse.drv: `code` is the function's number, `p` its struct.
    pub(crate) fn audio_call(&mut self, code: u32, p: u64) -> u64 {
        const NAMES: [&str; 37] = [
            "process_attach",
            "process_detach",
            "main_loop",
            "get_endpoint_ids",
            "create_stream",
            "release_stream",
            "start",
            "stop",
            "reset",
            "timer_loop",
            "get_render_buffer",
            "release_render_buffer",
            "get_capture_buffer",
            "release_capture_buffer",
            "is_format_supported",
            "get_loopback_capture_device",
            "get_mix_format",
            "get_device_period",
            "get_buffer_size",
            "get_latency",
            "get_current_padding",
            "get_next_packet_size",
            "get_frequency",
            "get_position",
            "set_volumes",
            "set_event_handle",
            "set_sample_rate",
            "test_connect",
            "is_started",
            "get_prop_value",
            "midi_get_driver",
            "midi_init",
            "midi_release",
            "midi_out_message",
            "midi_in_message",
            "midi_notify_wait",
            "aux_message",
        ];
        let Some(&name) = NAMES.get(code as usize) else { return crate::status::INVALID_PARAMETER };
        match name {
            "process_attach" | "process_detach" => 0,
            "main_loop" => self.audio_main_loop(p),
            "test_connect" => {
                self.w32(p + 8, 3); // Priority_Preferred
                0
            }
            "get_endpoint_ids" => self.audio_endpoints(p),
            "create_stream" => self.audio_create(p),
            "release_stream" => self.audio_release(p),
            "start" | "stop" | "reset" | "is_started" => self.audio_control(name, p),
            "timer_loop" => self.audio_timer(p),
            "get_render_buffer" => self.audio_get_buffer(p),
            "release_render_buffer" => self.audio_release_buffer(p),
            "is_format_supported" => {
                let (flow, fmt) = (self.r32(p + 8), self.r64(p + 16));
                let ok = flow == 0 && parse_format(self, fmt).is_some();
                self.w32(p + 24, if ok { 0 } else { AUDCLNT_E_UNSUPPORTED_FORMAT });
                0
            }
            "get_mix_format" => self.audio_mix_format(p),
            "get_device_period" => {
                // (device, flow, result, def_period*, min_period*)
                let (def, min) = (self.r64(p + 16), self.r64(p + 24));
                if def != 0 {
                    self.w64(def, DEF_PERIOD);
                }
                if min != 0 {
                    self.w64(min, MIN_PERIOD);
                }
                self.w32(p + 12, 0);
                0
            }
            "get_buffer_size" | "get_latency" | "get_current_padding" | "get_next_packet_size" | "get_frequency" => self.audio_query(name, p),
            "get_position" => self.audio_position(p),
            "set_volumes" => {
                // (stream, master, volumes*, session_volumes*)
                let (master, vols, svols) = (f32::from_bits(self.r32(p + 8)), self.r64(p + 16), self.r64(p + 24));
                let h = self.r64(p);
                let ch = self.s.audio.streams.get(&h).map_or(0, |s| s.channels);
                let v: Vec<f32> = (0..ch as u64)
                    .map(|i| {
                        let a = if vols != 0 { f32::from_bits(self.r32(vols + 4 * i)) } else { 1.0 };
                        let b = if svols != 0 { f32::from_bits(self.r32(svols + 4 * i)) } else { 1.0 };
                        master * a * b
                    })
                    .collect();
                if let Some(s) = self.s.audio.streams.get_mut(&h) {
                    s.volume = v;
                }
                0
            }
            "set_event_handle" => {
                let (id, ev) = (self.r64(p), self.r64(p + 8));
                let r = match self.s.audio.streams.get_mut(&id) {
                    None => AUDCLNT_E_DEVICE_INVALIDATED,
                    Some(s) if s.event != 0 => 0x8007_0011, // HRESULT_FROM_WIN32(ERROR_INVALID_NAME)
                    Some(s) => {
                        s.event = ev;
                        0
                    }
                };
                self.w32(p + 16, r);
                0
            }
            "set_sample_rate" => {
                self.w32(p + 12, E_NOTIMPL);
                0
            }
            "get_prop_value" => {
                // (device, flow, guid, prop, result, value, buffer, buffer_size): FormFactor = Speakers
                let prop = self.r64(p + 24);
                let value = self.r64(p + 40);
                let pid = self.r32(prop + 16);
                let audio_endpoint = self.r32(prop) == 0x1da5_d803;
                if audio_endpoint && pid == 0 {
                    self.w16(value, 19); // VT_UI4
                    self.w32(value + 8, 1); // Speakers
                    self.w32(p + 32, 0);
                } else {
                    self.w32(p + 32, E_NOTIMPL);
                }
                0
            }
            "midi_get_driver" => {
                self.w16(p, 0); // no MIDI driver: the audio driver answers
                0
            }
            "midi_init" => {
                let err = self.r64(p);
                if err != 0 {
                    self.w32(err, 0);
                }
                0
            }
            "midi_out_message" | "midi_in_message" => {
                // (dev_id, msg, user, param_1, param_2, err*, notify*): no MIDI devices
                let err = self.r64(p + 32);
                if err != 0 {
                    self.w32(err, 2); // MMSYSERR_BADDEVICEID
                }
                0
            }
            "aux_message" => {
                // (dev_id, msg, user, param_1, param_2, err*)
                let err = self.r64(p + 32);
                if err != 0 {
                    self.w32(err, 2);
                }
                0
            }
            _ => crate::status::NOT_IMPLEMENTED,
        }
    }

    /// main_loop(event): says it is running, then waits for good (the process's audio thread).
    fn audio_main_loop(&mut self, p: u64) -> u64 {
        let ev = self.r64(p);
        self.set_event(ev);
        self.wait_on(W::Sleep, u64::MAX)
    }

    fn set_event(&mut self, h: u64) {
        if let Some(crate::files::Handle::Event { set, .. }) = self.s.fs.handles.get_mut(&h) {
            *set = true;
        }
    }

    /// get_endpoint_ids(flow, endpoints*, size, result, num, default_idx): one speaker device.
    fn audio_endpoints(&mut self, p: u64) -> u64 {
        let (flow, out, size) = (self.r32(p), self.r64(p + 8), self.r32(p + 16));
        if flow != 0 {
            self.w32(p + 24, 0);
            self.w32(p + 28, 0);
            self.w32(p + 20, 0);
            return 0;
        }
        let name: Vec<u16> = DEVICE_NAME.encode_utf16().chain([0]).collect();
        let dev_len = (DEVICE.len() as u32 + 1 + 1) & !1;
        let needed = 8 + name.len() as u32 * 2 + dev_len;
        self.w32(p + 24, 1);
        self.w32(p + 28, 0);
        if needed > size {
            self.w32(p + 16, needed);
            self.w32(p + 20, INSUFFICIENT_BUFFER);
            return 0;
        }
        self.w32(out, 8);
        for (i, c) in name.iter().enumerate() {
            self.w16(out + 8 + 2 * i as u64, *c);
        }
        let dev_at = 8 + name.len() as u32 * 2;
        self.w32(out + 4, dev_at);
        let _ = self.mmu.write_bytes(out + dev_at as u64, DEVICE.as_bytes());
        self.w8(out + dev_at as u64 + DEVICE.len() as u64, 0);
        self.w32(p + 20, 0);
        0
    }

    /// get_mix_format(device, flow, fmt*, result): 48 kHz stereo float (WAVEFORMATEXTENSIBLE).
    fn audio_mix_format(&mut self, p: u64) -> u64 {
        let (flow, f) = (self.r32(p + 8), self.r64(p + 16));
        if flow != 0 || f == 0 {
            self.w32(p + 24, E_FAIL);
            return 0;
        }
        let align = MIX_CHANNELS as u32 * 4;
        self.w16(f, 0xFFFE);
        self.w16(f + 2, MIX_CHANNELS);
        self.w32(f + 4, MIX_RATE);
        self.w32(f + 8, MIX_RATE * align);
        self.w16(f + 12, align as u16);
        self.w16(f + 14, 32);
        self.w16(f + 16, 22);
        self.w16(f + 18, 32);
        self.w32(f + 20, 3); // front left | front right
                             // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {00000003-0000-0010-8000-00aa00389b71}
        self.w32(f + 24, 3);
        self.w16(f + 28, 0);
        self.w16(f + 30, 0x10);
        for (i, b) in [0x80u8, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71].iter().enumerate() {
            self.w8(f + 32 + i as u64, *b);
        }
        self.w32(p + 24, 0);
        0
    }

    /// create_stream(name, device, flow, share, flags, duration, period, fmt, result,
    /// channel_count*, stream*).
    fn audio_create(&mut self, p: u64) -> u64 {
        let (flow, share, duration, period, fmt) = (self.r32(p + 16), self.r32(p + 20), self.r64(p + 32), self.r64(p + 40), self.r64(p + 48));
        let result = p + 56;
        if flow != 0 {
            self.w32(result, E_FAIL);
            return 0;
        }
        if share != 0 {
            self.w32(result, AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED);
            return 0;
        }
        let Some((rate, channels, align, sample)) = parse_format(self, fmt) else {
            self.w32(result, AUDCLNT_E_UNSUPPORTED_FORMAT);
            return 0;
        };
        let period = if period == 0 { DEF_PERIOD } else { period };
        let buf_frames = ((duration as f64 / 1e7) * rate as f64).ceil().max(1.0) as u32;
        let period_frames = ((period as f64 / 1e7) * rate as f64).round().max(1.0) as u32;
        let local = self.heap_alloc(buf_frames as u64 * align as u64, true);
        if local == 0 {
            self.w32(result, 0x8007_000E); // E_OUTOFMEMORY
            return 0;
        }
        self.s.audio.next += 1;
        let id = self.s.audio.next;
        let handle = 0x5100_0000 + id as u64;
        let s = Stream {
            id,
            rate,
            channels,
            align,
            sample,
            buf_frames,
            period_frames,
            period_ms: period as f64 / 10_000.0,
            local,
            locked: 0,
            held: 0.0,
            played: 0.0,
            last: crate::now_ms(),
            started: false,
            event: 0,
            quit: false,
            volume: vec![1.0; channels as usize],
        };
        self.s.audio.streams.insert(handle, s);
        let (cc, out) = (self.r64(p + 64), self.r64(p + 72));
        if cc != 0 {
            self.w32(cc, channels);
        }
        if out != 0 {
            self.w64(out, handle);
        }
        self.w32(result, 0);
        0
    }

    /// release_stream(stream, timer_thread, result): stops it and waits for its timer thread.
    fn audio_release(&mut self, p: u64) -> u64 {
        let (h, thread) = (self.r64(p), self.r64(p + 8));
        self.w32(p + 16, 0);
        let Some(s) = self.s.audio.streams.get_mut(&h) else { return 0 };
        s.quit = true;
        let (id, local) = (s.id, s.local);
        unsafe { host_audio(id, std::ptr::null(), 0, 0, 0) };
        if thread != 0 {
            // the timer thread sees `quit` within a period and ends; the stream goes after
            self.s.audio.streams.get_mut(&h).unwrap().started = false;
            return self.wait_on(W::Objs { hs: vec![thread], all: false }, u64::MAX);
        }
        self.heap_free(local);
        self.s.audio.streams.remove(&h);
        0
    }

    fn audio_control(&mut self, name: &str, p: u64) -> u64 {
        let h = self.r64(p);
        let Some(s) = self.s.audio.streams.get_mut(&h) else {
            self.w32(p + 8, AUDCLNT_E_DEVICE_INVALIDATED);
            return 0;
        };
        s.update();
        let r = match name {
            "start" if s.started => AUDCLNT_E_NOT_STOPPED,
            "start" => {
                s.started = true;
                s.last = crate::now_ms();
                0
            }
            "stop" if !s.started => 1, // S_FALSE
            "stop" => {
                s.started = false;
                0
            }
            "reset" if s.started => AUDCLNT_E_NOT_STOPPED,
            "reset" if s.locked != 0 => AUDCLNT_E_BUFFER_TOO_LARGE,
            "reset" => {
                s.held = 0.0;
                s.played = 0.0;
                let id = s.id;
                unsafe { host_audio(id, std::ptr::null(), 0, 0, 0) };
                0
            }
            _ => {
                if s.started {
                    0
                } else {
                    1
                }
            }
        };
        self.w32(p + 8, r);
        0
    }

    /// timer_loop(stream): every period, sets the program's event; ends when released.
    fn audio_timer(&mut self, p: u64) -> u64 {
        let h = self.r64(p);
        let Some(s) = self.s.audio.streams.get_mut(&h) else { return 0 };
        if s.quit {
            let local = s.local;
            self.s.audio.streams.remove(&h);
            self.heap_free(local);
            return 0;
        }
        s.update();
        let (ev, ms) = (s.event, s.period_ms);
        if ev != 0 {
            self.set_event(ev);
        }
        // wait a period, then run this call again
        let r = self.wait_on(W::Again, ms.max(1.0) as u64);
        if r == BLOCK {
            BLOCK
        } else {
            crate::sched::RETRY
        }
    }

    /// get_render_buffer(stream, frames, result, data**).
    fn audio_get_buffer(&mut self, p: u64) -> u64 {
        let (h, frames, data) = (self.r64(p), self.r32(p + 8), self.r64(p + 16));
        let Some(s) = self.s.audio.streams.get_mut(&h) else {
            self.w32(p + 12, AUDCLNT_E_DEVICE_INVALIDATED);
            return 0;
        };
        let r = if s.locked != 0 {
            AUDCLNT_E_OUT_OF_ORDER
        } else if frames == 0 {
            0
        } else if frames > s.buf_frames - s.padding().min(s.buf_frames) {
            AUDCLNT_E_BUFFER_TOO_LARGE
        } else {
            s.locked = frames;
            0
        };
        let local = s.local;
        if r == 0 && data != 0 {
            self.w64(data, if frames == 0 { 0 } else { local });
        }
        self.w32(p + 12, r);
        0
    }

    /// release_render_buffer(stream, written_frames, flags, result): plays what was written.
    fn audio_release_buffer(&mut self, p: u64) -> u64 {
        let (h, written, flags) = (self.r64(p), self.r32(p + 8), self.r32(p + 12));
        let Some(s) = self.s.audio.streams.get(&h) else {
            self.w32(p + 16, AUDCLNT_E_DEVICE_INVALIDATED);
            return 0;
        };
        let (locked, local, align, ch, rate, sample, id) = (s.locked, s.local, s.align, s.channels, s.rate, s.sample, s.id);
        let vol = s.volume.clone();
        let r = if written == 0 {
            0
        } else if locked == 0 {
            AUDCLNT_E_OUT_OF_ORDER
        } else if written > locked {
            AUDCLNT_E_INVALID_SIZE
        } else {
            0
        };
        if r == 0 && written > 0 {
            let n = (written * ch) as usize;
            let mut out = vec![0f32; n];
            if flags & AUDCLNT_BUFFERFLAGS_SILENT == 0 {
                let mut raw = vec![0u8; (written * align) as usize];
                let _ = self.mmu.read_bytes(local, &mut raw);
                for (i, o) in out.iter_mut().enumerate() {
                    let v = match sample {
                        Sample::U8 => (raw[i] as f32 - 128.0) / 128.0,
                        Sample::I16 => i16::from_le_bytes([raw[2 * i], raw[2 * i + 1]]) as f32 / 32768.0,
                        Sample::I24 => (i32::from_le_bytes([0, raw[3 * i], raw[3 * i + 1], raw[3 * i + 2]]) >> 8) as f32 / 8_388_608.0,
                        Sample::I32 => i32::from_le_bytes(raw[4 * i..4 * i + 4].try_into().unwrap()) as f32 / 2_147_483_648.0,
                        Sample::F32 => f32::from_le_bytes(raw[4 * i..4 * i + 4].try_into().unwrap()),
                    };
                    *o = v * vol.get(i % ch as usize).copied().unwrap_or(1.0);
                }
            }
            unsafe { host_audio(id, out.as_ptr(), written, ch, rate) };
        }
        if let Some(s) = self.s.audio.streams.get_mut(&h) {
            if r == 0 {
                s.update();
                s.held += written as f64;
                s.locked = 0;
            }
        }
        self.w32(p + 16, r);
        0
    }

    fn audio_query(&mut self, name: &str, p: u64) -> u64 {
        let (h, out) = (self.r64(p), self.r64(p + 16));
        let Some(s) = self.s.audio.streams.get_mut(&h) else {
            self.w32(p + 8, AUDCLNT_E_DEVICE_INVALIDATED);
            return 0;
        };
        let (v, size) = match name {
            "get_buffer_size" => (s.buf_frames as u64, 4),
            "get_latency" => ((s.period_frames as u64 * 10_000_000) / s.rate as u64 + DEF_PERIOD, 8),
            "get_current_padding" => (s.padding() as u64, 4),
            "get_next_packet_size" => (0, 4),
            _ => (s.rate as u64 * s.align as u64, 8), // get_frequency: bytes per second (shared mode)
        };
        if out != 0 {
            if size == 8 {
                self.w64(out, v);
            } else {
                self.w32(out, v as u32);
            }
        }
        self.w32(p + 8, 0);
        0
    }

    /// get_position(stream, device, result, pos*, qpctime*): played bytes (frames with `device`).
    fn audio_position(&mut self, p: u64) -> u64 {
        let (h, device, pos, qpc) = (self.r64(p), self.r32(p + 8), self.r64(p + 16), self.r64(p + 24));
        let Some(s) = self.s.audio.streams.get_mut(&h) else {
            self.w32(p + 12, AUDCLNT_E_DEVICE_INVALIDATED);
            return 0;
        };
        s.update();
        let frames = s.played as u64;
        let v = if device != 0 { frames } else { frames * s.align as u64 };
        if pos != 0 {
            self.w64(pos, v);
        }
        if qpc != 0 {
            self.w64(qpc, (crate::now_ms() * 10_000.0) as u64);
        }
        self.w32(p + 12, S_OK as u32);
        0
    }
}
