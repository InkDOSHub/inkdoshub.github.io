// Cloudflare copy of the Hub with cross-origin isolation (SharedArrayBuffer, multithread).
// Static files are served by Cloudflare with the _headers file. Files Cloudflare cannot
// hold (over 25 MB) are fetched from GitHub Pages and get the same headers here.
// It is also the Linux terminal's internet tunnel: a WebSocket (wisp protocol, used by v86) that
// opens TCP connections. Only pages of the Hub can use it.
import { connect } from "cloudflare:sockets";

const ORIGEM = "https://inkdoshub.github.io";
// Files kept outside the repository (too big for git); the version in the address changes the cache key.
const EXTERNOS = {
  "/terminal/desktop/linux-gui.img.gz": "https://github.com/InkDOSHub/inkdoshub.github.io/releases/download/linux-gui/linux-gui.img.gz",
};
const ISOLAR = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};
const ORIGENS_OK = /^https:\/\/(inkdoshub\.github\.io|inkdoshub-github-io\.vfydr2m9wk\.workers\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PORTAS_BLOQUEADAS = new Set([25, 465, 587]); // no e-mail sending

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") === "websocket" && url.pathname === "/net/wisp/") {
      if (!ORIGENS_OK.test(req.headers.get("Origin") || "")) return new Response("forbidden", { status: 403 });
      const par = new WebSocketPair();
      const ws = par[1];
      ws.accept();
      wisp(ws);
      return new Response(null, { status: 101, webSocket: par[0] });
    }
    const res = await env.ASSETS.fetch(req);
    if (res.status !== 404 || req.method !== "GET") return res;
    const up = await fetch(EXTERNOS[url.pathname] ? EXTERNOS[url.pathname] + url.search : ORIGEM + url.pathname + url.search, { cf: { cacheTtl: 3600, cacheEverything: true } });
    const h = new Headers(up.headers);
    for (const [k, v] of Object.entries(ISOLAR)) h.set(k, v);
    if (EXTERNOS[url.pathname]) h.set("Access-Control-Allow-Origin", "*");
    return new Response(up.body, { status: up.status, statusText: up.statusText, headers: h });
  },
};

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
