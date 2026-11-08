// AI Chat (experimental): small GGUF models running on the device with wllama (llama.cpp in wasm).
// The model comes from Hugging Face once, through the site's Worker (worker.js; Safari fails the direct download), and is kept in the browser cache.
import { Wllama } from "./wllama/index.js";

const MODELOS = [
  { repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF", file: "qwen2.5-0.5b-instruct-q4_k_m.gguf" },
  { repo: "bartowski/Llama-3.2-1B-Instruct-GGUF", file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf" },
  { repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF", file: "qwen2.5-1.5b-instruct-q4_k_m.gguf" }
];
const $ = (id) => document.getElementById(id);
const conversa = $("conversa"), estado = $("estado"), texto = $("texto"), enviar = $("enviar"), modelo = $("modelo");
const wllama = new Wllama({ default: new URL("./wllama/wllama.wasm", import.meta.url).href });
let carregado = null, ocupado = false, parar = null;
const historico = [{ role: "system", content: "You are a helpful assistant. Answer briefly, in the user's language." }];

function bolha(classe, t) {
  const p = document.createElement("div");
  p.className = "msg " + classe; p.textContent = t;
  conversa.appendChild(p); conversa.scrollTop = conversa.scrollHeight;
  return p;
}
function aviso(t) { estado.textContent = t; conversa.appendChild(estado); conversa.scrollTop = conversa.scrollHeight; }

async function carregar() {
  const i = +modelo.value;
  if (carregado === i) return;
  if (carregado !== null) await wllama.exit();
  carregado = null;
  aviso("Loading the model…");
  const m = MODELOS[i], url = new URL("./modelos/" + m.file, import.meta.url).href;
  // same way as the Recorder: Cache API + our own download (wllama's OPFS download stalls in Safari)
  const cache = window.caches ? await caches.open("inkdoshub-ia").catch(() => null) : null;
  let r = cache ? await cache.match(url) : null, blob;
  if (r) blob = await r.blob();
  if (blob && blob.size < 1e7) { blob = null; if (cache) await cache.delete(url).catch(() => {}); } // broken copy from an earlier try
  if (!blob) {
    // "inkoff": the site's service worker lets it pass straight to the network
    r = await fetch(url + "?inkoff=1");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const total = +r.headers.get("content-length") || 0, partes = [], leitor = r.body.getReader();
    let lidos = 0;
    for (;;) {
      const p = await leitor.read();
      if (p.done) break;
      partes.push(p.value); lidos += p.value.length;
      aviso("Downloading the model (only the first time)… " + (total ? Math.round(lidos / total * 100) + "%" : Math.round(lidos / 1048576) + " MB"));
    }
    blob = new Blob(partes);
    if (blob.size < 1e7) throw new Error("download incomplete (" + blob.size + " bytes)");
    // not awaited (Safari takes long); Safari may keep an empty body for a big Blob, so check and drop it
    const tam = blob.size;
    if (cache) cache.put(url, new Response(blob)).then(() => cache.match(url)).then((c) => c && c.blob())
      .then((b) => { if (b && b.size !== tam) cache.delete(url); }).catch(() => cache.delete(url).catch(() => {}));
  }
  aviso("Loading the model…");
  await wllama.loadModel([blob], { n_ctx: 2048 });
  carregado = i;
  aviso(wllama.isMultithread() ? "Model ready." : "Model ready (single thread, slower).");
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) { if (parar) parar.abort(); return; }
  const t = texto.value.trim();
  if (!t) return;
  ocupado = true; enviar.textContent = "Stop"; texto.value = "";
  bolha("eu", t);
  historico.push({ role: "user", content: t });
  try {
    await carregar();
    estado.remove();
    const saida = bolha("ia", "…");
    let r = "";
    parar = new AbortController();
    await wllama.createChatCompletion({
      messages: historico.slice(-13), max_tokens: 512, temperature: 0.7, top_p: 0.9,
      stream: true, abortSignal: parar.signal,
      onData: (c) => { const d = c.choices && c.choices[0] && c.choices[0].delta; if (d && d.content) { r += d.content; saida.textContent = r; conversa.scrollTop = conversa.scrollHeight; } }
    }).catch((err) => { if (!parar.signal.aborted) throw err; });
    historico.push({ role: "assistant", content: r || "…" });
  } catch (err) {
    historico.pop();
    aviso("Error: " + (err && err.message || err) + ". Try Qwen 0.5B.");
  }
  ocupado = false; parar = null; enviar.textContent = "Send";
});
texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } });
modelo.addEventListener("change", () => { if (!ocupado) aviso("The model changes on the next message."); });
