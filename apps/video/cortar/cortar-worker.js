// Exporta o trecho escolhido com o ffmpeg.wasm (versão de uma thread só, sem modo isolado).
// Pedido: {arquivo: File, ini, fim (segundos), som (bool), altura (0 = original)}.
// Resposta: {tipo: "progresso", parte} ... {tipo: "pronto", blob} ou {tipo: "erro", texto, codigo}.
// O texto do erro é técnico (em inglês); codigo "vazio" = o ffmpeg não gerou nada (a página traduz).
import createFFmpegCore from "./ffmpeg-core/ffmpeg-core.js";

let core = null, duracao = 1;
async function carregar() {
  if (core) return core;
  core = await createFFmpegCore({
    // como o @ffmpeg/ffmpeg 0.12 faz: o endereço do .wasm vai depois do "#", em base64
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
  const { arquivo, ini, fim, som, altura } = data;
  try {
    const c = await carregar();
    duracao = Math.max(0.1, fim - ini);
    try { c.FS.mkdir("/in"); } catch (_) {}
    // o vídeo é lido direto do arquivo (WORKERFS), sem uma cópia inteira na memória
    c.FS.mount(c.FS.filesystems.WORKERFS, { files: [arquivo] }, "/in");
    const ext = (/\.[a-z0-9]+$/i.exec(arquivo.name) || [".mp4"])[0].toLowerCase();
    const saida = "/saida" + (!altura && [".mov", ".m4v", ".webm", ".mkv"].includes(ext) ? ext : ".mp4");
    const args = ["-hide_banner", "-ss", f3(ini), "-i", "/in/" + arquivo.name, "-t", f3(duracao)];
    if (altura) {
      // altura é o lado menor (vídeos em pé também); nunca aumenta
      const s = `scale='if(gte(iw,ih),-2,min(${altura},iw))':'if(gte(iw,ih),min(${altura},ih),-2)'`;
      args.push("-vf", s, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p");
      if (som) args.push("-c:a", "aac", "-b:a", "128k"); else args.push("-an");
    } else {
      // qualidade original: só corta, sem converter (rápido). O começo cai no quadro-chave anterior.
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
