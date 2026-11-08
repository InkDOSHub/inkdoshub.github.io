// AI Chat (experimental): small GGUF models running on the device with wllama (llama.cpp in wasm).
// The model comes from Hugging Face once, through the site's Worker (worker.js; Safari fails the direct download), and is kept as a file in the browser storage (OPFS).
import { Wllama } from "./wllama/index.js";
import { extrair, ehImagem } from "./extrair.js";

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
// wllama 2.3.7 on purpose: 2.4.0 and later need Memory64, which Safari does not have
const wllama = new Wllama({
  "single-thread/wllama.wasm": new URL("./wllama/single-thread/wllama.wasm", import.meta.url).href,
  "multi-thread/wllama.wasm": new URL("./wllama/multi-thread/wllama.wasm", import.meta.url).href
},
  { logger: { debug: registro, log: registro, warn: registro, error: registro } });
let carregado = null, ocupado = false, parar = null;
// Windows app: every model, from the lightest to the heaviest, runs on native llama.cpp (windows/hub/ia.js)
const nativo = window.inkHubNativo && window.inkHubNativo.ia;
if (nativo) nativo.modelos().then((lista) => {
  modelo.textContent = "";
  for (const m of lista) modelo.add(new Option(m.nome + " (" + m.gb + " GB)", m.id));
  modelo.value = "qwen3b"; // suggested start (1.9 GB); bigger ones for who wants more
}).catch(() => {});
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
  try { await wllama.loadModel([blob], { n_ctx: 4096 }); } finally { mostrarLog = false; }
  carregado = i;
  aviso(wllama.isMultithread() ? "Model ready." : "Model ready (single thread, slower).");
}

// attachments (+ button): text of files on every device; images and web pages only in the Windows app
let anexos = [];
const LIMITE = nativo ? 18000 : 8000;      // characters of attachments per message
const ORCAMENTO = nativo ? 22000 : 11000;  // characters of conversation sent to the model (context 8192 / 4096 tokens)
if (nativo) $("arquivo").accept += ",image/*";
$("mais").addEventListener("click", () => $("arquivo").click());
const dataUrl = (f) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => falha(r.error); r.readAsDataURL(f); });
function mostrarAnexos() {
  const box = $("anexos"); box.textContent = "";
  anexos.forEach((x, i) => {
    const c = document.createElement("div"); c.className = "anexo";
    const n = document.createElement("span"); n.textContent = (x.imagem ? "🖼 " : "📄 ") + x.nome;
    const b = document.createElement("button"); b.type = "button"; b.textContent = "✕"; b.setAttribute("aria-label", "Remove");
    b.onclick = () => { anexos.splice(i, 1); mostrarAnexos(); };
    c.append(n, b); box.appendChild(c);
  });
}
$("arquivo").addEventListener("change", async () => {
  for (const f of Array.from($("arquivo").files)) {
    try {
      if (ehImagem(f)) {
        if (!nativo) throw new Error("images only in the Windows app");
        anexos.push({ nome: f.name, imagem: await dataUrl(f) });
      } else {
        aviso("Reading " + f.name + "…");
        anexos.push({ nome: f.name, texto: (await extrair(f)).trim() });
        estado.remove();
      }
    } catch (err) { aviso("Could not read " + f.name + ": " + (err && err.message || err)); }
  }
  $("arquivo").value = ""; mostrarAnexos();
});
// what is sent: the newest messages that fit in the budget; images only in the last message
const tamanho = (m) => (typeof m.content === "string" ? m.content : m.content[0].text).length;
function montar() {
  const out = []; let usado = 0;
  for (let i = historico.length - 1; i > 0; i--) {
    let m = historico[i];
    if (out.length && typeof m.content !== "string") m = { role: m.role, content: m.content[0].text };
    usado += tamanho(m);
    if (out.length && usado > ORCAMENTO) break;
    out.unshift(m);
  }
  return [historico[0]].concat(out);
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) { if (parar) parar.abort(); return; }
  const t = texto.value.trim();
  if (!t && !anexos.length) return;
  ocupado = true; enviar.textContent = "Stop"; texto.value = "";
  const meus = anexos; anexos = []; mostrarAnexos();
  bolha("eu", (t || "") + (meus.length ? (t ? "\n" : "") + meus.map((x) => (x.imagem ? "🖼 " : "📄 ") + x.nome).join("\n") : ""));
  let user = null;
  try {
    // Windows app: web pages whose address is in the message are read by the Hub
    if (nativo && nativo.site) for (const url of (t.match(/https?:\/\/[^\s<>"']+/g) || []).slice(0, 3)) {
      aviso("Reading " + url + "…");
      try { const p = await nativo.site(url); meus.push({ nome: url, texto: (p.titulo ? p.titulo + "\n\n" : "") + p.texto }); }
      catch (err) { meus.push({ nome: url, texto: "(could not open this page: " + (err && err.message || err) + ")" }); }
    }
    let corpo = t || "Analyze the attached content.", resta = LIMITE;
    for (const x of meus.filter((y) => y.texto != null)) {
      let tx = x.texto;
      if (tx.length > resta) tx = tx.slice(0, Math.max(0, resta)) + "\n[… cut: only the first " + Math.max(0, resta) + " of " + x.texto.length + " characters fit]";
      resta -= tx.length;
      corpo += "\n\n[Attached: " + x.nome + "]\n" + tx;
    }
    const imagens = meus.filter((y) => y.imagem);
    if (imagens.length && nativo && !/vl/.test(modelo.value)) { modelo.value = "qwenvl3b"; aviso("Images: using Qwen 2.5 VL 3B, which can see images."); }
    user = { role: "user", content: imagens.length ? [{ type: "text", text: corpo }].concat(imagens.map((y) => ({ type: "image_url", image_url: { url: y.imagem } }))) : corpo };
    historico.push(user);
    if (!nativo) await carregar();
    if (nativo) await nativo.iniciar(modelo.value, aviso);
    estado.remove();
    const saida = bolha("ia", "…");
    let r = "";
    if (nativo) {
      parar = { abort: () => nativo.parar(), signal: {} };
      r = await nativo.conversar(montar(), (x) => { saida.textContent = x; conversa.scrollTop = conversa.scrollHeight; });
      saida.textContent = r || "…";
    } else {
      parar = new AbortController();
      await wllama.createChatCompletion(montar(), {
        nPredict: 512, sampling: { temp: 0.7, top_p: 0.9 }, abortSignal: parar.signal,
        onNewToken: (_t, _p, atual) => { r = atual; saida.textContent = r; conversa.scrollTop = conversa.scrollHeight; }
      }).catch((err) => { if (!parar.signal.aborted) throw err; });
    }
    historico.push({ role: "assistant", content: r || "…" });
  } catch (err) {
    if (user && historico[historico.length - 1] === user) historico.pop();
    aviso("Error: " + (err && err.message || err) + (nativo ? "" : ". Try Qwen 0.5B."));
  }
  ocupado = false; parar = null; enviar.textContent = "Send";
});
texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } });
modelo.addEventListener("change", () => { if (!ocupado) aviso("The model changes on the next message."); });
