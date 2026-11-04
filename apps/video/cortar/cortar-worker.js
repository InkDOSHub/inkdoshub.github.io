// Exports the chosen segment with ffmpeg.wasm. On an isolated page (SharedArrayBuffer, e.g. the
// Cloudflare copy) it uses the multithread build; otherwise the single-thread one.
// Request: {arquivo: File, ini, fim (seconds), som (bool), soSom (bool: audio only, as .m4a), altura (0 = original)}.
// Resposta: {tipo: "progresso", parte} ... {tipo: "pronto", blob} ou {tipo: "erro", texto, codigo}.
// The error text is technical (English); codigo "vazio" = ffmpeg produced nothing (the page translates it).
// In multithread mode the file is copied to memory (encoding threads cannot read WORKERFS) and
// "-threads 4" is always passed (without it the MT build fails); any MT error falls back to single-thread.
const PODE_MT = self.crossOriginIsolated && typeof SharedArrayBuffer === "function";
const MT_MAX_BYTES = 1024 * 1024 * 1024;
let MT = PODE_MT, PASTA = MT ? "./ffmpeg-core-mt/" : "./ffmpeg-core/";

let core = null, duracao = 1;
async function carregar() {
  if (core) return core;
  const { default: createFFmpegCore } = await import(PASTA + "ffmpeg-core.js");
  const u = (f) => new URL(PASTA + f, import.meta.url).href;
  const extra = { wasmURL: u("ffmpeg-core.wasm") };
  if (MT) extra.workerURL = u("ffmpeg-core.worker.js");
  core = await createFFmpegCore({
    // like @ffmpeg/ffmpeg 0.12 does: the .wasm (and thread worker) addresses go after the "#", in base64
    mainScriptUrlOrBlob: u("ffmpeg-core.js") + "#" + btoa(JSON.stringify(extra)),
  });
  core.setLogger(({ message }) => {
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message || "");
    if (m) postMessage({ tipo: "progresso", parte: Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / duracao) });
  });
  return core;
}

const f3 = (n) => Math.max(0, n).toFixed(3);

onmessage = async ({ data }) => {
  // re-encoding gains from threads; plain trims (copy) do not
  const usarMT = PODE_MT && data.altura && data.arquivo.size <= MT_MAX_BYTES;
  if (MT !== usarMT) { MT = usarMT; PASTA = MT ? "./ffmpeg-core-mt/" : "./ffmpeg-core/"; core = null; }
  try { await exportar(data); }
  catch (e) {
    if (MT) { MT = false; PASTA = "./ffmpeg-core/"; core = null; try { await exportar(data); return; } catch (e2) { e = e2; } }
    try { core && core.FS.unmount("/in"); } catch (_) {}
    postMessage({ tipo: "erro", texto: String((e && e.message) || e), codigo: (e && e.codigo) || "" });
  }
};

async function exportar(data) {
  const { arquivo, ini, fim, som, soSom, altura } = data;
  {
    const c = await carregar();
    duracao = Math.max(0.1, fim - ini);
    try { c.FS.mkdir("/in"); } catch (_) {}
    if (MT) { c.FS.mount(c.FS.filesystems.MEMFS, {}, "/in"); c.FS.writeFile("/in/" + arquivo.name, new Uint8Array(await arquivo.arrayBuffer())); }
    // the video is read straight from the file (WORKERFS), without a full copy in memory
    else c.FS.mount(c.FS.filesystems.WORKERFS, { files: [arquivo] }, "/in");
    const ext = (/\.[a-z0-9]+$/i.exec(arquivo.name) || [".mp4"])[0].toLowerCase();
    if (soSom) {
      // sound only: copies the AAC as is (fast, lossless); if not possible (other format), converts to AAC
      const base = ["-hide_banner", "-ss", f3(ini), "-i", "/in/" + arquivo.name, "-t", f3(duracao), "-vn", "-sn", "-dn", "-map", "0:a:0"];
      const saidaArgs = ["-map_metadata", "0", "-movflags", "+faststart", "-y", "/saida.m4a"];
      let dados = new Uint8Array(0);
      for (const codec of [["-c:a", "copy"], ["-c:a", "aac", "-b:a", "128k"]]) {
        try { c.FS.unlink("/saida.m4a"); } catch (_) {}
        const ret = c.exec(...base, ...codec, ...saidaArgs);
        c.reset && c.reset();
        try { dados = c.FS.readFile("/saida.m4a"); } catch (_) { dados = new Uint8Array(0); }
        if (!ret && dados.length > 1024) break;
      }
      try { c.FS.unlink("/saida.m4a"); } catch (_) {}
      c.FS.unmount("/in");
      if (!dados.length) throw Object.assign(new Error("ffmpeg did not produce the audio"), { codigo: "semaudio" });
      postMessage({ tipo: "pronto", blob: new Blob([dados], { type: "audio/mp4" }), ext: ".m4a" });
      return;
    }
    const saida = "/saida" + (!altura && [".mov", ".m4v", ".webm", ".mkv"].includes(ext) ? ext : ".mp4");
    const args = ["-hide_banner", "-ss", f3(ini), "-i", "/in/" + arquivo.name, "-t", f3(duracao)];
    if (altura) {
      // height is the shorter side (portrait videos too); never upscales
      const s = `scale='if(gte(iw,ih),-2,min(${altura},iw))':'if(gte(iw,ih),min(${altura},ih),-2)'`;
      if (MT) args.push("-threads", "4");
      args.push("-vf", s, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
      if (som) args.push("-c:a", "aac", "-b:a", "128k"); else args.push("-an");
    } else {
      // original quality: only trims, no conversion (fast). The start falls on the previous keyframe.
      args.push("-c", "copy", "-avoid_negative_ts", "make_zero");
      if (!som) args.push("-an");
    }
    args.push("-map_metadata", "0", "-movflags", "+faststart", "-y", saida);
    const ret = c.exec(...args);
    c.reset && c.reset();
    if (MT && ret) throw new Error("ffmpeg mt exited " + ret);
    const dados = c.FS.readFile(saida);
    c.FS.unlink(saida);
    c.FS.unmount("/in");
    if (!dados.length) throw Object.assign(new Error("ffmpeg did not produce the video"), { codigo: "vazio" });
    const tipos = { ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".m4v": "video/mp4", ".mp4": "video/mp4" };
    postMessage({ tipo: "pronto", blob: new Blob([dados], { type: tipos[saida.slice(6)] }), ext: saida.slice(6) });
  }
}
