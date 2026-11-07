// Cloudflare copy of the Hub with cross-origin isolation (SharedArrayBuffer, multithread).
// Static files are served by Cloudflare with the _headers file. Files Cloudflare cannot
// hold (over 25 MB) are fetched from GitHub Pages and get the same headers here.
// It is also the internet tunnel: a WebSocket that opens TCP connections for the Linux terminal
// (wisp protocol, v86) and Windows (Boxedwine's gateway protocol, DNS through DNS-over-HTTPS).
// Only pages of the Hub can use it.
import { connect } from "cloudflare:sockets";

const ORIGEM = "https://inkdoshub.github.io";
// Files kept outside the repository (too big for git); the version in the address changes the cache key.
const EXTERNOS = {
  "/apps/wine/fs/wine11.zip": "https://boxedwine.org/v2/24/TinyCore15Wine11.0-web.zip",
  // Recorder transcription models (Safari failed the direct cross-origin download)
  "/apps/gravador/modelos/ggml-tiny-q5_1.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
  "/apps/gravador/modelos/ggml-base-q5_1.bin": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
  "/apps/wine/x64/maquina/load-rootfs.data": "https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/wine-x64/load-rootfs.data",
};
const ISOLAR = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};
const ORIGENS_OK = /^https:\/\/(inkdoshub\.github\.io|inkdoshub-github-io\.vfydr2m9wk\.workers\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const DOH = "https://cloudflare-dns.com/dns-query";
const PORTAS_BLOQUEADAS = new Set([25, 465, 587]); // no e-mail sending

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") === "websocket" && (url.pathname === "/net/wisp/" || url.pathname === "/net/boxedwine")) {
      if (!ORIGENS_OK.test(req.headers.get("Origin") || "")) return new Response("forbidden", { status: 403 });
      const par = new WebSocketPair();
      const ws = par[1];
      ws.accept();
      if (url.pathname === "/net/wisp/") wisp(ws); else boxedwine(ws);
      return new Response(null, { status: 101, webSocket: par[0] });
    }
    if (url.pathname.startsWith("/net/github/")) return github(req, url);
    const res = await env.ASSETS.fetch(req);
    if (res.status !== 404 || req.method !== "GET") return res;
    const up = await fetch(EXTERNOS[url.pathname] ? EXTERNOS[url.pathname] + url.search : ORIGEM + url.pathname + url.search, { cf: { cacheTtl: 3600, cacheEverything: true } });
    const h = new Headers(up.headers);
    for (const [k, v] of Object.entries(ISOLAR)) h.set(k, v);
    if (EXTERNOS[url.pathname]) h.set("Access-Control-Allow-Origin", "*");
    return new Response(up.body, { status: up.status, statusText: up.statusText, headers: h });
  },
};

// Wasm Build app: GitHub sends Actions artifacts and logs through a redirect to storage without
// CORS, so the page asks here. Only those two read-only API paths; the user's token is passed
// along and never kept.
const GH_OK = /^repos\/[\w.-]+\/[\w.-]+\/actions\/(artifacts\/\d+\/zip|jobs\/\d+\/logs)$/;
async function github(req, url) {
  // same-origin GETs carry no Origin header: use the page's own address then
  const origem = req.headers.get("Origin") || (req.headers.get("Sec-Fetch-Site") === "same-origin" ? url.origin : "");
  if (!ORIGENS_OK.test(origem)) return new Response("forbidden", { status: 403 });
  const cors = { "Access-Control-Allow-Origin": origem, "Access-Control-Allow-Headers": "Authorization", "Access-Control-Allow-Methods": "GET", "Vary": "Origin", "Cross-Origin-Resource-Policy": "cross-origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const caminho = url.pathname.slice("/net/github/".length);
  if (req.method !== "GET" || !GH_OK.test(caminho)) return new Response("not allowed", { status: 400, headers: cors });
  let up = await fetch("https://api.github.com/" + caminho, { redirect: "manual", headers: { Authorization: req.headers.get("Authorization") || "", "User-Agent": "InkDOS-Hub-Wasm-Build", Accept: "application/vnd.github+json" } });
  // the file itself is on a signed storage link, which must be fetched without the GitHub token
  const destino = up.status >= 300 && up.status < 400 && up.headers.get("Location");
  if (destino) up = await fetch(destino, { headers: { "User-Agent": "InkDOS-Hub-Wasm-Build" } });
  const h = new Headers(cors);
  h.set("Content-Type", up.headers.get("Content-Type") || "application/octet-stream");
  h.set("Cache-Control", "no-store");
  return new Response(up.body, { status: up.status, headers: h });
}

// opens a TCP connection; calls aoReceber(bytes) for each chunk and aoFechar() at the end
function abrirTcp(host, porta, aoReceber, aoFechar) {
  if (PORTAS_BLOQUEADAS.has(porta) || !porta) throw new Error("port not allowed");
  const s = connect({ hostname: host, port: porta });
  const escritor = s.writable.getWriter();
  (async () => {
    try {
      const leitor = s.readable.getReader();
      for (;;) { const { value, done } = await leitor.read(); if (done) break; aoReceber(value); }
    } catch (e) {}
    aoFechar();
  })();
  return {
    pronto: s.opened,
    escrever: (b) => escritor.write(b).catch(() => {}),
    fechar: () => { try { s.close(); } catch (e) {} },
  };
}

async function doh(pergunta) {
  const r = await fetch(DOH, { method: "POST", headers: { "Content-Type": "application/dns-message", Accept: "application/dns-message" }, body: pergunta });
  return new Uint8Array(await r.arrayBuffer());
}

// --- wisp v1 (v86): [type][stream id u32 LE][payload]; 1 CONNECT, 2 DATA, 3 CONTINUE, 4 CLOSE ---
function wisp(ws) {
  const BUF = 128, fluxos = new Map();
  const pacote = (tipo, id, corpo) => {
    const b = new Uint8Array(5 + (corpo ? corpo.length : 0));
    b[0] = tipo; new DataView(b.buffer).setUint32(1, id, true);
    if (corpo) b.set(corpo, 5);
    try { ws.send(b); } catch (e) {}
  };
  const continuar = (id) => { const c = new Uint8Array(4); new DataView(c.buffer).setUint32(0, BUF, true); pacote(3, id, c); };
  const fechar = (id, motivo) => { const f = fluxos.get(id); if (!f) return; fluxos.delete(id); f.tcp && f.tcp.fechar(); pacote(4, id, new Uint8Array([motivo])); };
  continuar(0);
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data === "string") return;
    const b = new Uint8Array(ev.data), v = new DataView(b.buffer);
    if (b.length < 5) return;
    const tipo = b[0], id = v.getUint32(1, true);
    if (tipo === 1) {
      const porta = v.getUint16(6, true), host = new TextDecoder().decode(b.subarray(8));
      if (b[5] !== 1) return fechar(id, 0x41); // TCP only
      const f = { recebidos: 0, tcp: null };
      fluxos.set(id, f);
      try {
        f.tcp = abrirTcp(host, porta, (d) => pacote(2, id, d), () => fechar(id, 0x02));
        continuar(id);
      } catch (e) { fechar(id, 0x48); }
    } else if (tipo === 2) {
      const f = fluxos.get(id); if (!f || !f.tcp) return;
      f.tcp.escrever(b.slice(5));
      if (++f.recebidos >= BUF / 2) { f.recebidos = 0; continuar(id); }
    } else if (tipo === 4) {
      const f = fluxos.get(id); if (f) { fluxos.delete(id); f.tcp && f.tcp.fechar(); }
    }
  });
  ws.addEventListener("close", () => { for (const f of fluxos.values()) f.tcp && f.tcp.fechar(); fluxos.clear(); });
}

// --- Boxedwine gateway (subset): JSON control text frames + binary frames
//     TCP data [1][socket id u32 BE][bytes]; UDP [2][id u32 BE][ipv4 4 bytes][port u16 BE][bytes] ---
function boxedwine(ws) {
  const tcp = new Map();
  const ctrl = (m) => { try { ws.send(JSON.stringify(m)); } catch (e) {} };
  const quadro = (id, d) => { const f = new Uint8Array(5 + d.length); f[0] = 1; new DataView(f.buffer).setUint32(1, id); f.set(d, 5); try { ws.send(f); } catch (e) {} };
  ws.addEventListener("message", async (ev) => {
    if (typeof ev.data === "string") {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "open") {
        try {
          const c = abrirTcp(String(m.host), m.port | 0, (d) => quadro(m.id, d), () => { if (tcp.delete(m.id)) ctrl({ type: "close", id: m.id }); });
          tcp.set(m.id, c);
          await c.pronto;
          ctrl({ type: "open", id: m.id, status: 0 });
        } catch (e) { tcp.delete(m.id); ctrl({ type: "open", id: m.id, status: -111 }); }
      } else if (m.type === "close") {
        const c = tcp.get(m.id); if (c) { tcp.delete(m.id); c.fechar(); }
      } else if (m.type === "udp-open" || m.type === "udp-bind") {
        ctrl({ type: m.type, id: m.id, status: 0, host: "0.0.0.0", port: m.port || 40000 + (m.id % 20000) });
      } else if (m.type === "listen") {
        ctrl({ type: "listen", id: m.id, status: -13 });
      }
      return;
    }
    const b = new Uint8Array(ev.data), v = new DataView(b.buffer);
    if (b.length < 5) return;
    const id = v.getUint32(1);
    if (b[0] === 1) { const c = tcp.get(id); if (c) c.escrever(b.slice(5)); return; }
    // UDP: only DNS (port 53), answered with DNS-over-HTTPS
    if (b[0] === 2 && b.length > 11 && v.getUint16(9) === 53) {
      try {
        const resp = await doh(b.slice(11));
        const f = new Uint8Array(11 + resp.length); f.set(b.subarray(0, 11)); f.set(resp, 11);
        ws.send(f);
      } catch (e) {}
    }
  });
  ws.addEventListener("close", () => { for (const c of tcp.values()) c.fechar(); tcp.clear(); });
}
