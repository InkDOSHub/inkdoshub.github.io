// Player de vídeo do InkDOS Hub: <video> nativo do Safari, com lista guardada
// neste aparelho. "Editar" abre o vídeo atual no editor simples (cortar/).
// "Extrair som" tira só o áudio (.m4a, para a Música) de um vídeo escolhido, sem guardar o vídeo
// aqui: serve para gravações longas (uma aula de 1 h), que ocupariam gigabytes.
const $ = (id) => document.getElementById(id);
const t = InkIdioma.t;
const video = $("video"), lista = $("lista");
const bib = InkBiblioteca("inkdoshub-video");
let itens = [], atual = -1, url = null;
let posicoes = {};
try { posicoes = JSON.parse(localStorage.getItem("inkdoshub-video-posicoes") || "{}"); } catch (_) {}

function desenhar() {
  lista.innerHTML = "";
  $("editar").disabled = atual < 0;
  if (!itens.length) { lista.innerHTML = '<li style="cursor:default;color:var(--muted)"></li>'; lista.firstChild.textContent = t("No videos."); return; }
  itens.forEach((v, i) => {
    const li = document.createElement("li");
    if (i === atual) li.className = "atual";
    li.innerHTML = '<span class="n"></span><span class="t"></span><span class="d"></span><button class="x">' + inkIcone("fechar") + '</button>';
    li.querySelector(".x").title = t("Remove from list");
    li.querySelector(".x").setAttribute("aria-label", t("Remove from list"));
    if (i === atual) li.querySelector(".n").innerHTML = inkIcone("play"); else li.querySelector(".n").textContent = i + 1;
    li.querySelector(".t").textContent = v.nome;
    li.querySelector(".d").textContent = v.duracao ? inkTempo(v.duracao) : inkTamanho(v.tamanho);
    li.onclick = (e) => (e.target.classList.contains("x") ? tirar(i) : abrir(i, true));
    lista.appendChild(li);
  });
}

function abrir(i, tocar) {
  if (i < 0 || i >= itens.length) return;
  guardarPosicao();
  atual = i;
  const v = itens[i];
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(v.blob);
  video.src = url;
  const pos = posicoes[v.id];
  video.addEventListener("loadedmetadata", function m() {
    video.removeEventListener("loadedmetadata", m);
    if (!v.duracao && isFinite(video.duration)) { v.duracao = video.duration; bib.trocar(v); desenhar(); }
    if (pos && pos < video.duration - 5) video.currentTime = pos;
  });
  $("titulo").textContent = v.nome;
  $("sub").textContent = inkTamanho(v.tamanho);
  document.title = t("{name} · Video", { name: v.nome });
  try { localStorage.setItem("inkdoshub-video-atual", String(v.id)); } catch (_) {}
  desenhar();
  if (tocar) video.play().catch(() => {});
}
function guardarPosicao() {
  const v = itens[atual];
  if (!v || !isFinite(video.currentTime)) return;
  posicoes[v.id] = video.ended ? 0 : Math.floor(video.currentTime);
  try { localStorage.setItem("inkdoshub-video-posicoes", JSON.stringify(posicoes)); } catch (_) {}
}
let ultimoSalvo = 0;
video.addEventListener("timeupdate", () => { if (Date.now() - ultimoSalvo > 4000) { ultimoSalvo = Date.now(); guardarPosicao(); } });
video.addEventListener("pause", guardarPosicao);
video.addEventListener("ended", () => { guardarPosicao(); if (atual + 1 < itens.length) abrir(atual + 1, true); });
addEventListener("pagehide", guardarPosicao);

async function tirar(i) {
  const v = itens[i];
  await bib.remover(v.id);
  delete posicoes[v.id];
  itens.splice(i, 1);
  if (i === atual) { video.pause(); video.removeAttribute("src"); video.load(); atual = -1; $("titulo").textContent = t("No video"); $("sub").textContent = ""; }
  else if (i < atual) atual--;
  desenhar();
}

$("abrir").onclick = () => $("arquivos").click();
$("arquivos").onchange = async (e) => {
  const novos = await bib.adicionar(e.target.files);
  e.target.value = "";
  const comeco = itens.length;
  itens.push(...novos);
  if (novos.length) abrir(comeco, true); else desenhar();
};
$("limpar").onclick = async () => {
  if (!itens.length) return;
  await bib.limpar();
  itens = []; atual = -1; posicoes = {}; video.pause(); video.removeAttribute("src"); video.load();
  $("titulo").textContent = t("No video"); $("sub").textContent = "";
  try { localStorage.removeItem("inkdoshub-video-posicoes"); } catch (_) {}
  desenhar();
};
$("blista").onclick = () => { const h = $("lado").classList.toggle("md-hide"); $("blista").classList.toggle("on", !h); };
$("blista").classList.add("on");
$("editar").onclick = () => {
  const v = itens[atual];
  if (!v) return;
  video.pause(); guardarPosicao();
  location.href = "cortar/?id=" + v.id;
};

/* ---------- Extrair só o som, sem guardar o vídeo ---------- */
function painel(titulo, texto, parte, botoes) {
  $("progresso").classList.add("on");
  $("p-titulo").textContent = titulo;
  $("p-texto").textContent = texto || "";
  $("p-barra").style.display = parte == null ? "none" : "";
  $("p-barra").firstChild.style.width = Math.round((parte || 0) * 100) + "%";
  const b = $("p-botoes"); b.innerHTML = "";
  (botoes || []).forEach((x) => {
    const e = document.createElement("button");
    e.className = "ink-btn" + (x.principal ? " principal" : "");
    e.textContent = x.texto; e.onclick = x.acao;
    b.appendChild(e);
  });
}
const fecharPainel = () => $("progresso").classList.remove("on");
function duracaoDe(arquivo) {
  // a duração só serve para a barra de progresso; se o Safari não souber ler, segue sem ela
  return new Promise((ok) => {
    const v = document.createElement("video"), u = URL.createObjectURL(arquivo);
    const fim = (d) => { clearTimeout(tempo); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(u); ok(d); };
    const tempo = setTimeout(() => fim(0), 8000);
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = () => fim(isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => fim(0);
    v.src = u;
  });
}
function partilhar(arq) {
  if (navigator.canShare && navigator.canShare({ files: [arq] })) { navigator.share({ files: [arq] }).catch(() => {}); return; }
  const a = document.createElement("a"), u = URL.createObjectURL(arq);
  a.href = u; a.download = arq.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
let worker = null;
const cancelar = () => { if (worker) { worker.terminate(); worker = null; } fecharPainel(); };
$("extrair").onclick = () => $("arquivo-som").click();
$("arquivo-som").onchange = async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = "";
  if (!arquivo) return;
  video.pause();
  painel(t("Extract sound"), t("Preparing (sound only)…"), 0, [{ texto: t("Cancel"), acao: cancelar }]);
  const dur = await duracaoDe(arquivo), t0 = Date.now();
  worker = new Worker("cortar/cortar-worker.js?v=3", { type: "module" });
  worker.onmessage = (ev) => {
    const d = ev.data;
    if (d.tipo === "progresso") {
      painel(t("Extract sound"), t("Extracting the sound · {percent}% · {seconds} s", {
        percent: Math.round(d.parte * 100).toLocaleString(InkIdioma.atual),
        seconds: Math.round((Date.now() - t0) / 1000).toLocaleString(InkIdioma.atual),
      }), dur ? d.parte : null, [{ texto: t("Cancel"), acao: cancelar }]);
    }
    if (d.tipo === "erro") {
      worker.terminate(); worker = null;
      painel(t("Could not extract the sound"), d.codigo === "semaudio" ? t("This video has no sound, or its sound could not be read.") : d.texto, null, [{ texto: t("OK"), acao: fecharPainel }]);
    }
    if (d.tipo === "pronto") {
      worker.terminate(); worker = null;
      const arq = new File([d.blob], arquivo.name.replace(/\.[^.]+$/, "") + d.ext, { type: d.blob.type });
      InkBiblioteca("inkdoshub-musica").adicionar([arq]).then((novos) => {
        try { localStorage.setItem("inkdoshub-musica-atual", String(novos[0].id)); } catch (_) {}
        painel(t("Done"), t("{name} ({size}) is in the Music list. The video was not stored here: if you no longer need it, delete it from Photos or Files.", { name: arq.name, size: inkTamanho(arq.size) }), null, [
          { texto: t("Save to device"), acao: () => partilhar(arq) },
          { texto: t("Open in Music"), principal: true, acao: () => { location.href = "../musica/"; } },
        ]);
      });
    }
  };
  worker.onerror = (ev) => painel(t("Could not extract the sound"), ev.message || t("ffmpeg error"), null, [{ texto: t("OK"), acao: fecharPainel }]);
  // fim enorme quando a duração não é conhecida: o ffmpeg para no fim do arquivo
  worker.postMessage({ arquivo, ini: 0, fim: dur || 360000, som: true, soSom: true, altura: 0 });
};

/* ---------- Controles próprios (o player nativo não responde em alguns navegadores, como o XeOS) ---------- */
const pos = $("pos");
let arrastando = false;
function mostrarTempo() {
  const d = isFinite(video.duration) ? video.duration : 0;
  $("tatual").textContent = inkTempo(video.currentTime || 0);
  $("ttotal").textContent = inkTempo(d);
  if (!arrastando) pos.value = d ? Math.round((video.currentTime / d) * 1000) : 0;
}
["timeupdate", "loadedmetadata", "emptied"].forEach((ev) => video.addEventListener(ev, mostrarTempo));
pos.addEventListener("input", () => { arrastando = true; if (isFinite(video.duration)) $("tatual").textContent = inkTempo((pos.value / 1000) * video.duration); });
pos.addEventListener("change", () => { arrastando = false; if (isFinite(video.duration)) video.currentTime = (pos.value / 1000) * video.duration; });
const alternar = () => { if (!video.src) return; video.paused ? video.play().catch(() => {}) : video.pause(); };
$("tocar").onclick = alternar;
video.addEventListener("click", alternar);
video.addEventListener("play", () => ($("tocar").innerHTML = inkIcone("pause")));
video.addEventListener("pause", () => ($("tocar").innerHTML = inkIcone("play")));
$("tela-cheia").onclick = () => {
  const el = document.querySelector(".tela");
  if (document.fullscreenElement || document.webkitFullscreenElement) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  if (el.requestFullscreen) el.requestFullscreen().catch(() => video.webkitEnterFullscreen && video.webkitEnterFullscreen());
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
};
addEventListener("keydown", (e) => { if (e.key === " " && e.target === document.body) { e.preventDefault(); alternar(); } });

$("titulo").textContent = t("No video");
bib.listar().then((lst) => {
  itens = lst;
  let ultimo = null;
  try { ultimo = +localStorage.getItem("inkdoshub-video-atual"); } catch (_) {}
  const i = itens.findIndex((v) => v.id === ultimo);
  if (itens.length) abrir(i >= 0 ? i : 0, false); else desenhar();
});
