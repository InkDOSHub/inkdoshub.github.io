var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { connect } from "cloudflare:sockets";

var ORIGEM = "https://inkdoshub.github.io";
var EXTERNOS = {
  // Recorder transcription models (Safari failed the direct cross-origin download)
  "/apps/gravador/modelos/ggml-tiny-q5_1.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
  "/apps/gravador/modelos/ggml-base-q5_1.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
  "/apps/gravador/modelos/ggml-small-q5_1.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
  // AI Chat models (same reason)
  "/InkMind/modelos/qwen2.5-0.5b-instruct-q4_k_m.gguf": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  "/InkMind/modelos/Llama-3.2-1B-Instruct-Q4_K_M.gguf": "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
  "/InkMind/modelos/qwen2.5-1.5b-instruct-q4_k_m.gguf": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  // GridCraft Wasm (> 25 MiB limit in Workers assets -> resolved from origin)
  "/artcraft/gridcraft/gridcraft-web-fdc723373f2aa0d8_bg.wasm": `${ORIGEM}/artcraft/gridcraft/gridcraft-web-fdc723373f2aa0d8_bg.wasm`
};

var ISOLAR = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin"
};

var ORIGENS_OK = /^https:\/\/(hub\.inkdos\.workers\.dev|inkdoshub\.github\.io|inkdoshub-github-io\.vfydr2m9wk\.workers\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
var PORTAS_BLOQUEADAS = /* @__PURE__ */ new Set([25, 465, 587]);

var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") === "websocket" && url.pathname === "/net/wisp/") {
      if (!ORIGENS_OK.test(req.headers.get("Origin") || "")) return new Response("forbidden", { status: 403 });
      const par = new WebSocketPair();
      const ws = par[1];
      ws.accept();
      ws.binaryType = "arraybuffer";
      wisp(ws);
      return new Response(null, { status: 101, webSocket: par[0] });
    }
    if (url.pathname.startsWith("/net/github/")) return github(req, url);
    const res = await env.ASSETS.fetch(req);
    if (res.status !== 404 || req.method !== "GET") return res;
    const pagina = /(\/|\.html)$/.test(url.pathname);
    const destinoUrl = EXTERNOS[url.pathname] ? EXTERNOS[url.pathname] + url.search : ORIGEM + url.pathname + url.search;
    const up = await fetch(destinoUrl, {
      cf: {
        cacheTtlByStatus: { "200-299": pagina ? 60 : 3600, "404": 0, "500-599": 0 },
        cacheEverything: true
      }
    });
    const h = new Headers(up.headers);
    if (url.pathname.endsWith(".wasm")) h.set("Content-Type", "application/wasm");
    if (pagina) h.set("Cache-Control", "no-cache");
    for (const [k, v] of Object.entries(ISOLAR)) h.set(k, v);
    if (EXTERNOS[url.pathname] || url.pathname.endsWith(".wasm")) h.set("Access-Control-Allow-Origin", "*");
    return new Response(up.body, { status: up.status, statusText: up.statusText, headers: h });
  }
};

var GH_OK = /^repos\/[\w.-]+\/[\w.-]+\/actions\/(artifacts\/\d+\/zip|jobs\/\d+\/logs)$/;

async function github(req, url) {
  const origem = req.headers.get("Origin") || (req.headers.get("Sec-Fetch-Site") === "same-origin" ? url.origin : "");
  if (!ORIGENS_OK.test(origem)) return new Response("forbidden", { status: 403 });
  const cors = {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Allow-Methods": "GET",
    "Vary": "Origin",
    "Cross-Origin-Resource-Policy": "cross-origin"
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const caminho = url.pathname.slice("/net/github/".length);
  if (req.method !== "GET" || !GH_OK.test(caminho)) return new Response("not allowed", { status: 400, headers: cors });
  let up = await fetch("https://api.github.com/" + caminho, {
    redirect: "manual",
    headers: {
      Authorization: req.headers.get("Authorization") || "",
      "User-Agent": "InkDOS-Hub-Wasm-Build",
      Accept: "application/vnd.github+json"
    }
  });
  const destino = up.status >= 300 && up.status < 400 && up.headers.get("Location");
  if (destino) up = await fetch(destino, { headers: { "User-Agent": "InkDOS-Hub-Wasm-Build" } });
  const h = new Headers(cors);
  h.set("Content-Type", up.headers.get("Content-Type") || "application/octet-stream");
  h.set("Cache-Control", "no-store");
  return new Response(up.body, { status: up.status, headers: h });
}
__name(github, "github");

function abrirTcp(host, porta, aoReceber, aoFechar) {
  if (PORTAS_BLOQUEADAS.has(porta) || !porta) throw new Error("port not allowed");
  const s = connect({ hostname: host, port: porta });
  const escritor = s.writable.getWriter();
  (async () => {
    try {
      const leitor = s.readable.getReader();
      for (; ; ) {
        const { value, done } = await leitor.read();
        if (done) break;
        aoReceber(value);
      }
    } catch (e) {
    }
    aoFechar();
  })();
  return {
    pronto: s.opened,
    escrever: /* @__PURE__ */ __name((b) => escritor.write(b).catch(() => {
    }), "escrever"),
    fechar: /* @__PURE__ */ __name(() => {
      try {
        s.close();
      } catch (e) {
      }
    }, "fechar")
  };
}
__name(abrirTcp, "abrirTcp");

function wisp(ws) {
  const BUF = 128, fluxos = /* @__PURE__ */ new Map();
  const pacote = /* @__PURE__ */ __name((tipo, id, corpo) => {
    const b = new Uint8Array(5 + (corpo ? corpo.length : 0));
    b[0] = tipo;
    new DataView(b.buffer).setUint32(1, id, true);
    if (corpo) b.set(corpo, 5);
    try {
      ws.send(b);
    } catch (e) {
    }
  }, "pacote");
  const continuar = /* @__PURE__ */ __name((id) => {
    const c = new Uint8Array(4);
    new DataView(c.buffer).setUint32(0, BUF, true);
    pacote(3, id, c);
  }, "continuar");
  const fechar = /* @__PURE__ */ __name((id, motivo) => {
    const f = fluxos.get(id);
    if (!f) return;
    fluxos.delete(id);
    f.tcp && f.tcp.fechar();
    pacote(4, id, new Uint8Array([motivo]));
  }, "fechar");
  continuar(0);
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data === "string") return;
    const b = new Uint8Array(ev.data), v = new DataView(b.buffer);
    if (b.length < 5) return;
    const tipo = b[0], id = v.getUint32(1, true);
    if (tipo === 1) {
      const porta = v.getUint16(6, true), host = new TextDecoder().decode(b.subarray(8));
      if (b[5] !== 1) return fechar(id, 65);
      const f = { recebidos: 0, tcp: null };
      fluxos.set(id, f);
      try {
        f.tcp = abrirTcp(host, porta, (d) => pacote(2, id, d), () => fechar(id, 2));
        continuar(id);
      } catch (e) {
        fechar(id, 72);
      }
    } else if (tipo === 2) {
      const f = fluxos.get(id);
      if (!f || !f.tcp) return;
      f.tcp.escrever(b.slice(5));
      if (++f.recebidos >= BUF / 2) {
        f.recebidos = 0;
        continuar(id);
      }
    } else if (tipo === 4) {
      const f = fluxos.get(id);
      if (f) {
        fluxos.delete(id);
        f.tcp && f.tcp.fechar();
      }
    }
  });
  ws.addEventListener("close", () => {
    for (const f of fluxos.values()) f.tcp && f.tcp.fechar();
    fluxos.clear();
  });
}
__name(wisp, "wisp");

export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
