// Exports the chosen segment with ffmpeg.wasm (single-thread build, no isolated mode).
// Request: {arquivo: File, ini, fim (seconds), som (bool), soSom (bool: audio only, as .m4a), altura (0 = original)}.
// Resposta: {tipo: "progresso", parte} ... {tipo: "pronto", blob} ou {tipo: "erro", texto, codigo}.
// The error text is technical (English); codigo "vazio" = ffmpeg produced nothing (the page translates it).
import createFFmpegCore from "./ffmpeg-core/ffmpeg-core.js";

let core = null, duracao = 1;
async function carregar() {
  if (core) return core;
  core = await createFFmpegCore({
    // like @ffmpeg/ffmpeg 0.12 does: the .wasm address goes after the "#", in base64
    mainScriptUrlOrBlob: new URL("./ffmpeg-core/ffmpeg-core.js", import.meta.url).href + "#" +
      btoa(JSON.stringify({ wasmURL: new URL("./ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href })),
  });
  core.setLogger(({ message }) => {
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message || "");
    if (m) postMessage({ tipo: "progresso", parte: Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / duracao) });
  });
  return core;
}

const f3 = (n) => Math.max(0, n).toFixed(3);

onmessage = async ({ data }) => {
  const { arquivo, ini, fim, som, soSom, altura } = data;
  try {
    const c = await carregar();
    duracao = Math.max(0.1, fim - ini);
    try { c.FS.mkdir("/in"); } catch (_) {}
    // the video is read straight from the file (WORKERFS), without a full copy in memory
    c.FS.mount(c.FS.filesystems.WORKERFS, { files: [arquivo] }, "/in");
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
      args.push("-vf", s, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
      if (som) args.push("-c:a", "aac", "-b:a", "128k"); else args.push("-an");
    } else {
      // original quality: only trims, no conversion (fast). The start falls on the previous keyframe.
      args.push("-c", "copy", "-avoid_negative_ts", "make_zero");
      if (!som) args.push("-an");
    }
    args.push("-map_metadata", "0", "-movflags", "+faststart", "-y", saida);
    c.exec(...args);
    c.reset && c.reset();
    const dados = c.FS.readFile(saida);
    c.FS.unlink(saida);
    c.FS.unmount("/in");
    if (!dados.length) throw Object.assign(new Error("ffmpeg did not produce the video"), { codigo: "vazio" });
    const tipos = { ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".m4v": "video/mp4", ".mp4": "video/mp4" };
    postMessage({ tipo: "pronto", blob: new Blob([dados], { type: tipos[saida.slice(6)] }), ext: saida.slice(6) });
  } catch (e) {
    try { core && core.FS.unmount("/in"); } catch (_) {}
    postMessage({ tipo: "erro", texto: String((e && e.message) || e), codigo: (e && e.codigo) || "" });
  }
};
