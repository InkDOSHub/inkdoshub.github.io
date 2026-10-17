// Player de música do InkTerminal: toca com o <audio> nativo do Safari.
// Os ajustes (equalizador, volume extra, balanço) só ligam o Web Audio quando
// usados, para o player nativo continuar simples e leve.
const $ = (id) => document.getElementById(id);
const audio = $("audio"), lista = $("lista");
const bib = InkBiblioteca("inkterminal-musica");
const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const PRESETS = {
  Normal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Graves: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Voz: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Agudos: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Rock: [4, 3, 1, -1, -1, 1, 2, 3, 4, 4],
};
let faixas = [], atual = -1, url = null, aleat = false, rep = "nao";
let cfg = { eq: PRESETS.Normal.slice(), ganho: 0, bal: 0, vel: 1 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem("inkterminal-musica-ajustes") || "{}")); } catch (_) {}
const salvar = () => { try { localStorage.setItem("inkterminal-musica-ajustes", JSON.stringify(cfg)); } catch (_) {} };

function nomeLimpo(n) { return n.replace(/\.[^.]+$/, "").replace(/_/g, " "); }
function partes(n) {
  const s = nomeLimpo(n), i = s.indexOf(" - ");
  return i > 0 ? { titulo: s.slice(i + 3), artista: s.slice(0, i) } : { titulo: s, artista: "" };
}

function desenhar() {
  lista.innerHTML = "";
  if (!faixas.length) {
    lista.innerHTML = '<li style="cursor:default;color:var(--muted)">A lista está vazia.</li>';
    return;
  }
  faixas.forEach((f, i) => {
    const li = document.createElement("li");
    if (i === atual) li.className = "atual";
    li.innerHTML = '<span class="n"></span><span class="t"></span><span class="d"></span><button class="x" title="Tirar da lista">×</button>';
    li.querySelector(".n").textContent = i === atual ? "▶" : i + 1;
    li.querySelector(".t").textContent = nomeLimpo(f.nome);
    li.querySelector(".d").textContent = f.duracao ? inkTempo(f.duracao) : "";
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("x")) return tirar(i);
      tocar(i);
    });
    lista.appendChild(li);
  });
}

function carregar(i, comecar) {
  if (i < 0 || i >= faixas.length) return;
  atual = i;
  const f = faixas[i];
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(f.blob);
  audio.src = url;
  audio.playbackRate = cfg.vel;
  audio.preservesPitch = true;
  const p = partes(f.nome);
  $("titulo").textContent = p.titulo;
  $("sub").textContent = (p.artista ? p.artista + " · " : "") + "Faixa " + (i + 1) + " de " + faixas.length;
  document.title = p.titulo + " · Música";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: p.titulo, artist: p.artista, album: "InkTerminal" });
  }
  try { localStorage.setItem("inkterminal-musica-atual", String(f.id)); } catch (_) {}
  desenhar();
  if (comecar) audio.play().catch(() => {});
}
function tocar(i) { carregar(i, true); }

function proxima(manual) {
  if (!faixas.length) return;
  if (rep === "uma" && !manual) return tocar(atual);
  let n;
  if (aleat && faixas.length > 1) { do n = Math.floor(Math.random() * faixas.length); while (n === atual); }
  else n = atual + 1;
  if (n >= faixas.length) { if (rep === "todas" || manual) n = 0; else return; }
  tocar(n);
}
function anterior() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  tocar(atual > 0 ? atual - 1 : faixas.length - 1);
}

async function tirar(i) {
  const f = faixas[i];
  await bib.remover(f.id);
  faixas.splice(i, 1);
  if (i === atual) { audio.pause(); audio.removeAttribute("src"); audio.load(); atual = -1; $("titulo").textContent = "Nenhuma música"; $("sub").textContent = ""; }
  else if (i < atual) atual--;
  desenhar();
}

function medirDuracao(f) {
  const a = new Audio(), u = URL.createObjectURL(f.blob);
  a.preload = "metadata";
  a.onloadedmetadata = () => { f.duracao = a.duration; URL.revokeObjectURL(u); bib.trocar(f); desenhar(); };
  a.onerror = () => URL.revokeObjectURL(u);
  a.src = u;
}

$("abrir").onclick = () => $("arquivos").click();
$("arquivos").onchange = async (e) => {
  const novos = await bib.adicionar(e.target.files);
  e.target.value = "";
  const comeco = faixas.length;
  faixas.push(...novos);
  novos.forEach(medirDuracao);
  if (atual < 0 && novos.length) tocar(comeco); else desenhar();
};
$("limpar").onclick = async () => {
  if (!faixas.length) return;
  await bib.limpar();
  faixas = []; atual = -1; audio.pause(); audio.removeAttribute("src"); audio.load();
  $("titulo").textContent = "Nenhuma música"; $("sub").textContent = "Toque em Abrir músicas para escolher arquivos do iPad";
  desenhar();
};
$("tocar").onclick = () => { if (atual < 0) return faixas.length && tocar(0); audio.paused ? audio.play() : audio.pause(); };
$("prox").onclick = () => proxima(true);
$("ant").onclick = anterior;
$("aleat").onclick = () => { aleat = !aleat; $("aleat").classList.toggle("on", aleat); };
$("rep").onclick = () => {
  rep = rep === "nao" ? "todas" : rep === "todas" ? "uma" : "nao";
  $("rep").classList.toggle("on", rep !== "nao");
  $("rep").textContent = rep === "uma" ? "🔂" : "🔁";
};
audio.addEventListener("play", () => ($("tocar").textContent = "⏸"));
audio.addEventListener("pause", () => ($("tocar").textContent = "▶"));
audio.addEventListener("ended", () => proxima(false));
audio.addEventListener("ratechange", () => { if (Math.abs(audio.playbackRate - cfg.vel) > 0.001) { cfg.vel = audio.playbackRate; mostrarAjustes(); salvar(); } });
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("nexttrack", () => proxima(true));
  navigator.mediaSession.setActionHandler("previoustrack", anterior);
}

// ---- Ajustes de áudio (Web Audio) ----
let ctx = null, filtros = [], ganho = null, pan = null;
function ligarAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const fonte = ctx.createMediaElementSource(audio);
  filtros = FREQS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? "lowshelf" : i === FREQS.length - 1 ? "highshelf" : "peaking";
    b.frequency.value = f; b.Q.value = 1.1; b.gain.value = cfg.eq[i];
    return b;
  });
  ganho = ctx.createGain();
  pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  let no = fonte;
  for (const b of filtros) { no.connect(b); no = b; }
  no.connect(ganho); no = ganho;
  if (pan) { no.connect(pan); no = pan; }
  no.connect(ctx.destination);
  aplicar();
}
function aplicar() {
  audio.playbackRate = cfg.vel;
  if (!ctx) return;
  filtros.forEach((b, i) => (b.gain.value = cfg.eq[i]));
  ganho.gain.value = Math.pow(10, cfg.ganho / 20);
  if (pan) pan.pan.value = cfg.bal;
}
const precisaWebAudio = () => cfg.eq.some((v) => v) || cfg.ganho || cfg.bal;

const eq = $("eq");
FREQS.forEach((f, i) => {
  const d = document.createElement("div");
  d.innerHTML = '<input type="range" min="-12" max="12" step="1"><span></span>';
  d.querySelector("span").textContent = f >= 1000 ? f / 1000 + "k" : f;
  d.querySelector("input").oninput = (e) => { cfg.eq[i] = +e.target.value; ligarAudio(); aplicar(); salvar(); };
  eq.appendChild(d);
});
Object.keys(PRESETS).forEach((nome) => {
  const b = document.createElement("button");
  b.className = "ink-btn"; b.textContent = nome;
  b.onclick = () => { cfg.eq = PRESETS[nome].slice(); if (precisaWebAudio()) ligarAudio(); aplicar(); mostrarAjustes(); salvar(); };
  $("presets").appendChild(b);
});
$("ganho").oninput = (e) => { cfg.ganho = +e.target.value; ligarAudio(); aplicar(); mostrarAjustes(); salvar(); };
$("bal").oninput = (e) => { cfg.bal = +e.target.value; ligarAudio(); aplicar(); mostrarAjustes(); salvar(); };
$("vel").oninput = (e) => { cfg.vel = +e.target.value; aplicar(); mostrarAjustes(); salvar(); };
function mostrarAjustes() {
  [...eq.querySelectorAll("input")].forEach((r, i) => (r.value = cfg.eq[i]));
  $("ganho").value = cfg.ganho; $("oganho").textContent = (cfg.ganho > 0 ? "+" : "") + cfg.ganho + " dB";
  $("bal").value = cfg.bal; $("obal").textContent = Math.abs(cfg.bal) < 0.05 ? "centro" : (cfg.bal < 0 ? "esq. " : "dir. ") + Math.round(Math.abs(cfg.bal) * 100) + "%";
  $("vel").value = cfg.vel; $("ovel").textContent = cfg.vel.toFixed(2).replace(".", ",") + "×";
}
$("bajustes").onclick = () => {
  const ab = $("ajustes").classList.toggle("md-hide");
  $("bajustes").classList.toggle("on", !ab);
};
// O Web Audio só pode começar depois de um toque; se já houver ajustes salvos,
// ele liga no primeiro "tocar".
audio.addEventListener("play", () => { if (precisaWebAudio()) ligarAudio(); });
mostrarAjustes();

bib.listar().then((itens) => {
  faixas = itens;
  let ultimo = null;
  try { ultimo = +localStorage.getItem("inkterminal-musica-atual"); } catch (_) {}
  const i = faixas.findIndex((f) => f.id === ultimo);
  if (faixas.length) carregar(i >= 0 ? i : 0, false); else desenhar();
  faixas.filter((f) => !f.duracao).forEach(medirDuracao);
});
