// AI Chat (experimental): small GGUF models running on the device with wllama (llama.cpp in wasm).
// The model comes from Hugging Face once, through the site's Worker (worker.js; Safari fails the direct download), and is kept as a file in the browser storage (OPFS).
import { Wllama } from "./wllama/index.js";

const MODELOS = [
  { repo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF", file: "qwen2.5-0.5b-instruct-q4_k_m.gguf" },
  { repo: "bartowski/Llama-3.2-1B-Instruct-GGUF", file: "Llama-3.2-1B-Instruct-Q4_K_M.gguf" },
  { repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF", file: "qwen2.5-1.5b-instruct-q4_k_m.gguf" }
];
const $ = (id) => document.getElementById(id);
const conversa = $("conversa"), estado = $("estado"), texto = $("texto"), enviar = $("enviar"), modelo = $("modelo");
// while loading, the engine's last log line is shown, so a stall in XeOS shows where it stopped
let mostrarLog = false;
const registro = (...a) => { console.log(...a); if (mostrarLog) aviso("Loading the model… " + a.map(String).join(" ").slice(0, 160)); };
// wllama 2.x on purpose: 3.x needs Memory64, which Safari does not have
const wllama = new Wllama({
  "single-thread/wllama.wasm": new URL("./wllama/single-thread/wllama.wasm", import.meta.url).href,
  "multi-thread/wllama.wasm": new URL("./wllama/multi-thread/wllama.wasm", import.meta.url).href
},
  { logger: { debug: registro, log: registro, warn: registro, error: registro } });
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
  // kept as a file in the browser storage (OPFS), written by baixar.js a piece at a time
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("ia", { create: true });
  const completo = await dir.getFileHandle(m.file + ".ok").then(() => true, () => false);
  let arq = completo ? await dir.getFileHandle(m.file).then((h) => h.getFile()).catch(() => null) : null;
  if (!arq || arq.size < 1e7) {
    await new Promise((ok, falha) => {
      const w = new Worker("baixar.js");
      w.onmessage = (e) => {
        const d = e.data;
        if (d.lidos) aviso("Downloading the model (only the first time)… " + (d.total ? Math.round(d.lidos / d.total * 100) + "%" : Math.round(d.lidos / 1048576) + " MB"));
        if (d.fim) { w.terminate(); ok(); }
        if (d.erro) { w.terminate(); falha(new Error(d.erro)); }
      };
      w.onerror = (e) => { w.terminate(); falha(new Error(e.message || "download worker failed")); };
      w.postMessage({ url: url + "?inkoff=1", nome: m.file });
    });
    arq = await (await dir.getFileHandle(m.file)).getFile();
  }
  if (window.caches) caches.delete("inkdoshub-ia").catch(() => {}); // old copies from the first version
  const blob = arq;
  aviso("Loading the model… (" + Math.round(blob.size / 1048576) + " MB, " + (navigator.hardwareConcurrency || "?") + " cores)");
  mostrarLog = true;
  try { await wllama.loadModel([blob], { n_ctx: 2048 }); } finally { mostrarLog = false; }
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
    await wllama.createChatCompletion(historico.slice(-13), {
      nPredict: 512, sampling: { temp: 0.7, top_p: 0.9 }, abortSignal: parar.signal,
      onNewToken: (_t, _p, atual) => { r = atual; saida.textContent = r; conversa.scrollTop = conversa.scrollHeight; }
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
