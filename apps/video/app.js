// Player de vídeo do InkTerminal: <video> nativo do Safari, com lista guardada
// neste aparelho. "Editar" abre o vídeo atual no editor simples (cortar/).
const $ = (id) => document.getElementById(id);
const t = InkIdioma.t;
const video = $("video"), lista = $("lista");
const bib = InkBiblioteca("inkterminal-video");
let itens = [], atual = -1, url = null;
let posicoes = {};
try { posicoes = JSON.parse(localStorage.getItem("inkterminal-video-posicoes") || "{}"); } catch (_) {}

function desenhar() {
  lista.innerHTML = "";
  $("vazio").classList.toggle("md-hide", atual >= 0);
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
  try { localStorage.setItem("inkterminal-video-atual", String(v.id)); } catch (_) {}
  desenhar();
  if (tocar) video.play().catch(() => {});
}
function guardarPosicao() {
  const v = itens[atual];
  if (!v || !isFinite(video.currentTime)) return;
  posicoes[v.id] = video.ended ? 0 : Math.floor(video.currentTime);
  try { localStorage.setItem("inkterminal-video-posicoes", JSON.stringify(posicoes)); } catch (_) {}
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
  try { localStorage.removeItem("inkterminal-video-posicoes"); } catch (_) {}
  desenhar();
};
$("prox").onclick = () => itens.length && abrir((atual + 1) % itens.length, true);
$("ant").onclick = () => itens.length && abrir(atual > 0 ? atual - 1 : itens.length - 1, true);
$("blista").onclick = () => { const h = $("lado").classList.toggle("md-hide"); $("blista").classList.toggle("on", !h); };
$("blista").classList.add("on");
$("editar").onclick = () => {
  const v = itens[atual];
  if (!v) return;
  video.pause(); guardarPosicao();
  location.href = "cortar/?id=" + v.id;
};

$("titulo").textContent = t("No video");
bib.listar().then((lst) => {
  itens = lst;
  let ultimo = null;
  try { ultimo = +localStorage.getItem("inkterminal-video-atual"); } catch (_) {}
  const i = itens.findIndex((v) => v.id === ultimo);
  if (itens.length) abrir(i >= 0 ? i : 0, false); else desenhar();
});
