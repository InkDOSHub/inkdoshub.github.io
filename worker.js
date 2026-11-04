// Cloudflare copy of the Hub with cross-origin isolation (SharedArrayBuffer, multithread).
// Static files are served by Cloudflare with the _headers file. Files Cloudflare cannot
// hold (over 25 MB) are fetched from GitHub Pages and get the same headers here.
const ORIGEM = "https://inkdoshub.github.io";
// Files kept outside the repository (too big for git), fetched from their official source.
const EXTERNOS = {
  "/apps/wine/fs/wine11.zip": "https://boxedwine.org/v2/24/TinyCore15Wine11.0-web.zip",
};
const ISOLAR = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};
export default {
  async fetch(req, env) {
    const res = await env.ASSETS.fetch(req);
    if (res.status !== 404 || req.method !== "GET") return res;
    const url = new URL(req.url);
    const up = await fetch(EXTERNOS[url.pathname] || ORIGEM + url.pathname + url.search, { cf: { cacheTtl: 3600, cacheEverything: true } });
    const h = new Headers(up.headers);
    for (const [k, v] of Object.entries(ISOLAR)) h.set(k, v);
    return new Response(up.body, { status: up.status, statusText: up.statusText, headers: h });
  },
};
