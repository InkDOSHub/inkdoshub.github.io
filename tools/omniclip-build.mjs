// Empacota o omniclip (MIT, https://github.com/omni-media/omniclip) para
// apps/video/editor/, sem nada vindo de outros sites:
// - as bibliotecas que o original busca em CDNs (shoelace, pixi, mediainfo,
//   opfs-tools, web-demuxer, núcleo do ffmpeg) vêm desta pasta;
// - a análise de uso (posthog) e as fontes do Google foram retiradas;
// - os caminhos "/assets/..." passam a ser relativos à página.
// Uso: node omniclip-build.mjs <repo omniclip com x/ compilado> <node_modules das dependências> <saída>
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const [OMC, DEPS, OUT] = process.argv.slice(2).map((p) => path.resolve(p));
const NM = path.join(OMC, "node_modules");
const X = path.join(OMC, "x");

const cdn = {
  "https://cdn.jsdelivr.net/npm/mediainfo.js@0.3.2/+esm": path.join(DEPS, "mediainfo.js/dist/esm-bundle/index.js"),
  "https://cdn.jsdelivr.net/npm/opfs-tools@0.7.0/+esm": path.join(DEPS, "opfs-tools/dist/opfs-tools.js"),
};
const trocas = [
  ["`${window.location.origin}/assets/MediaInfoModule.wasm`", 'new URL("./assets/MediaInfoModule.wasm", location.href).href'],
  ['"https://cdn.jsdelivr.net/npm/web-demuxer@1.0.5/dist/wasm-files/ffmpeg.min.js"', 'new URL("./web-demuxer/ffmpeg.js", location.href).href'],
  ["'https://unpkg.com/@ffmpeg/core@0.12.5/dist/esm'", 'new URL("./ffmpeg-core", location.href).href'],
  ['"../../video-export/parts/decode_worker.js"', '"./decode_worker.js"'],
  ['"../../video-export/parts/encode_worker.js"', '"./encode_worker.js"'],
  // InkTerminal: arrumação inicial com mídia, prévia e linha do tempo (inkterminal.js)
  ['default: single_panel_layout("TimelinePanel")', 'default: globalThis.inkLayout || single_panel_layout("TimelinePanel")'],
  // InkTerminal: deixa a página abrir o vídeo vindo do player
  ["const omnislate = setupContext(projectId);", "const omnislate = setupContext(projectId); globalThis.inkOmni = omnislate;"],
];
const local = {
  name: "local",
  setup(b) {
    b.onResolve({ filter: /^https:\/\// }, (a) => {
      if (cdn[a.path]) return { path: cdn[a.path] };
      throw new Error("endereço externo sem cópia local: " + a.path);
    });
    b.onResolve({ filter: /^posthog-js$/ }, () => ({ path: "posthog", namespace: "vazio" }));
    b.onLoad({ filter: /.*/, namespace: "vazio" }, () => ({
      contents: "export default { init() {}, capture() {}, identify() {} };", loader: "js",
    }));
    // importações de arquivos internos de pacotes (fora do "exports" deles)
    b.onResolve({ filter: /^[@a-z][^:]*\/.*\.m?js$/ }, (a) => {
      const f = path.join(NM, a.path);
      if (fs.existsSync(f)) return { path: f };
    });
    b.onLoad({ filter: /[\\/]omc[\\/]x[\\/].*\.js$|[\\/]x[\\/].*\.js$/ }, (a) => {
      let s = fs.readFileSync(a.path, "utf8");
      for (const [de, para] of trocas) {
        if (s.includes(de)) { s = s.split(de).join(para); usadas.add(de); }
      }
      s = s.replace(/(["'`(])\/assets\//g, "$1./assets/").split("${window.location.origin}/assets/").join("./assets/");
      return { contents: s, loader: "js", resolveDir: path.dirname(a.path) };
    });
  },
};

const usadas = new Set();
fs.mkdirSync(OUT, { recursive: true });
await esbuild.build({
  entryPoints: {
    main: path.join(X, "main.js"),
    encode_worker: path.join(X, "context/controllers/video-export/parts/encode_worker.js"),
    decode_worker: path.join(X, "context/controllers/video-export/parts/decode_worker.js"),
    "opfs-worker": path.join(X, "context/controllers/collaboration/parts/opfs-worker.js"),
    worker: path.join(NM, "@ffmpeg/ffmpeg/dist/esm/worker.js"),
  },
  bundle: true, format: "esm", minify: true, outdir: OUT, plugins: [local],
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning",
});

for (const [de] of trocas) if (!usadas.has(de)) throw new Error("troca não aplicada: " + de);

// InkTerminal: o ffprobe (versão com threads, que exige SharedArrayBuffer) só é criado se usado.
// O editor não o usa (os dados do vídeo vêm do mediainfo), e assim ele abre sem modo isolado,
// como no XeOS, onde o coi-serviceworker não consegue ligar o isolamento.
{
  const f = path.join(OUT, "main.js");
  const s = fs.readFileSync(f, "utf8");
  let n = s.replace(/ffprobe=new (\w+);/, "#inkFp=null;get ffprobe(){return this.#inkFp??=new $1};");
  if (n === s) throw new Error("troca não aplicada: ffprobe preguiçoso");
  // Identificação do arquivo importado: o original lê o vídeo inteiro na memória para o SHA-256,
  // o que trava o iPad com vídeos grandes. Aqui o hash usa o tamanho, os 4 MB do começo e os do fim.
  let m = n.replace(/(async function \w+\((\w)\)\{let (\w)=)await \2\.arrayBuffer\(\)(,\w=await crypto\.subtle\.digest\("SHA-256",\3\))/,
    "$1$2.size<=8388608?await $2.arrayBuffer():await new Blob([String($2.size),$2.slice(0,4194304),$2.slice($2.size-4194304)]).arrayBuffer()$4");
  if (m === n) throw new Error("troca não aplicada: hash parcial");
  // O núcleo do ffmpeg (31 MB) só serve para exportar: carrega 8 s depois, para não disputar com a
  // abertura do editor e a importação do vídeo.
  n = m.replace(/(this\.isLoading=this\.is_loading\.load\(async\(\)=>\{)(await this\.#\w+\(\)\}\))/,
    "$1await new Promise(r=>setTimeout(r,8e3)),$2");
  if (n === m) throw new Error("troca não aplicada: ffmpeg depois");
  // Prévias dos filtros: o original desenha 39 prévias de 1024x1024 de uma vez (cada uma lida da
  // GPU pixel a pixel), o que trava a abertura por vários segundos. Aqui são 160x160, uma por vez.
  m = n.replace(/(for\(let (\w) in \w+\)\{)(let \w=await PIXI\.Assets\.load\([^)]*\),(\w)=new PIXI\.Sprite\(\w\);)/,
    "$1await new Promise(r=>setTimeout(r,0));$3$4.width=$4.height=160;");
  if (m === n) throw new Error("troca não aplicada: prévias dos filtros");
  n = m;
  fs.writeFileSync(f, n);
}

// CSS: as mesmas regras do original, sem a fonte de emoji do Google.
const css = fs.readFileSync(path.join(OMC, "s/index.css"), "utf8")
  .replace(/@import url\('https:\/\/fonts\.googleapis\.com[^)]*\);\n?/, "");
fs.writeFileSync(path.join(OMC, "s/_inkterminal.css"), css);
await esbuild.build({
  entryPoints: [path.join(OMC, "s/_inkterminal.css")],
  bundle: true, minify: true, outfile: path.join(OUT, "index.css"),
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".otf": "file", ".eot": "file", ".svg": "file", ".png": "file" },
  assetNames: "assets/css/[name]-[hash]", logLevel: "warning",
});
fs.rmSync(path.join(OMC, "s/_inkterminal.css"));
console.log("ok");
