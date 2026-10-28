// Fotos do InkDOS Hub: visualizador com <img> nativo (zoom, giro, lista) e
// edição como segunda opção, no editor simples daqui (editor.js), que devolve uma cópia nova.
const $ = (id) => document.getElementById(id);
const t = InkIdioma.t;
const bib = InkBiblioteca("inkdoshub-fotos");
let fotos = [], atual = -1, urls = new Map(), zoom = 0, giro = 0; // zoom 0 = ajustar à tela

const urlDe = (f) => { if (!urls.has(f.id)) urls.set(f.id, URL.createObjectURL(f.blob)); return urls.get(f.id); };
function soltar(f) { const u = urls.get(f.id); if (u) { URL.revokeObjectURL(u); urls.delete(f.id); } }

function grade() {
  const g = $("grade");
  g.innerHTML = "";
  $("status").textContent = fotos.length ? (fotos.length === 1 ? t("1 photo") : t("{n} photos", { n: fotos.length.toLocaleString(InkIdioma.atual) })) : "";
  fotos.forEach((f, i) => {
    const b = document.createElement("button");
    const img = document.createElement("img");
    img.loading = "lazy"; img.decoding = "async"; img.alt = f.nome; img.src = urlDe(f);
    b.title = f.nome;
    b.append(img);
    b.onclick = () => ver(i);
    g.appendChild(b);
  });
}
function modo(v) {
  $("tgrade").classList.toggle("md-hide", v);
  $("tver").classList.toggle("md-hide", !v);
  $("limpar").classList.toggle("md-hide", v || !fotos.length);
}
function ver(i) {
  if (!fotos.length) { atual = -1; modo(false); return; }
  atual = (i + fotos.length) % fotos.length;
  const f = fotos[atual], img = $("foto");
  zoom = 0; giro = 0;
  img.onload = () => { $("sub").textContent = img.naturalWidth + " × " + img.naturalHeight + " · " + inkTamanho(f.tamanho); aplicar(); };
  img.src = urlDe(f);
  $("titulo").textContent = f.nome;
  $("sub").textContent = inkTamanho(f.tamanho);
  modo(true);
  aplicar();
}
function aplicar() {
  const img = $("foto"), v = $("ver");
  v.classList.toggle("ajustar", zoom === 0);
  img.style.transform = giro ? "rotate(" + giro + "deg)" : "";
  if (zoom === 0) { img.style.width = img.style.height = ""; $("zajustar").textContent = t("Fit"); return; }
  img.style.width = Math.round(img.naturalWidth * zoom) + "px";
  img.style.height = Math.round(img.naturalHeight * zoom) + "px";
  $("zajustar").textContent = Math.round(zoom * 100).toLocaleString(InkIdioma.atual) + "%";
}
function escalaAjustada() {
  const img = $("foto"), v = $("ver");
  return Math.min(v.clientWidth / img.naturalWidth, v.clientHeight / img.naturalHeight, 1) || 1;
}
function mudarZoom(fator, cx, cy) {
  const v = $("ver"), antes = zoom || escalaAjustada();
  const novo = Math.min(8, Math.max(0.05, antes * fator));
  const rx = (v.scrollLeft + (cx ?? v.clientWidth / 2)) / (v.scrollWidth || 1);
  const ry = (v.scrollTop + (cy ?? v.clientHeight / 2)) / (v.scrollHeight || 1);
  zoom = novo <= escalaAjustada() + 0.001 ? 0 : novo;
  aplicar();
  v.scrollLeft = rx * v.scrollWidth - (cx ?? v.clientWidth / 2);
  v.scrollTop = ry * v.scrollHeight - (cy ?? v.clientHeight / 2);
}
$("zmais").onclick = () => mudarZoom(1.5);
$("zmenos").onclick = () => mudarZoom(1 / 1.5);
$("zajustar").onclick = () => { zoom = zoom === 0 ? 1 : 0; aplicar(); };
$("girar").onclick = () => { giro = (giro + 90) % 360; aplicar(); };
$("ver").addEventListener("dblclick", (e) => { if (zoom === 0) { const r = $("ver").getBoundingClientRect(); zoom = 0; mudarZoom(1 / escalaAjustada(), e.clientX - r.left, e.clientY - r.top); } else { zoom = 0; aplicar(); } });
// pinça no iPad (eventos de gesto do Safari) e Ctrl+roda no computador
let base = 1;
$("ver").addEventListener("gesturestart", (e) => { e.preventDefault(); base = zoom || escalaAjustada(); });
$("ver").addEventListener("gesturechange", (e) => { e.preventDefault(); const alvo = base * e.scale, agora = zoom || escalaAjustada(); mudarZoom(alvo / agora); });
$("ver").addEventListener("wheel", (e) => { if (!e.ctrlKey) return; e.preventDefault(); mudarZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
// deslizar para o lado troca de foto (só quando a foto está ajustada à tela)
let toque = null;
$("ver").addEventListener("touchstart", (e) => { toque = e.touches.length === 1 && zoom === 0 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
$("ver").addEventListener("touchend", (e) => {
  if (!toque) return;
  const t = e.changedTouches[0], dx = t.clientX - toque[0], dy = t.clientY - toque[1];
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) ver(atual + (dx < 0 ? 1 : -1));
  toque = null;
});
addEventListener("keydown", (e) => {
  if (atual < 0 || !$("edicao").classList.contains("md-hide")) return;
  if (e.key === "ArrowRight") ver(atual + 1);
  else if (e.key === "ArrowLeft") ver(atual - 1);
  else if (e.key === "Escape") modo(false);
});
$("ant").onclick = () => ver(atual - 1);
$("prox").onclick = () => ver(atual + 1);
$("bgrade").onclick = () => modo(false);
$("limpar").onclick = async () => {
  if (!fotos.length || !confirm(t("Remove all photos from this gallery?"))) return;
  await bib.limpar();
  fotos.forEach(soltar); fotos = []; atual = -1;
  grade(); modo(false);
};

$("abrir").onclick = () => $("arquivos").click();
$("arquivos").onchange = async (e) => {
  const novos = await bib.adicionar(e.target.files);
  e.target.value = "";
  fotos.push(...novos);
  grade();
  if (novos.length === 1) ver(fotos.length - 1); else modo(false);
};
$("apagar").onclick = async () => {
  const f = fotos[atual];
  if (!f) return;
  await bib.remover(f.id);
  soltar(f);
  fotos.splice(atual, 1);
  grade();
  if (fotos.length) ver(Math.min(atual, fotos.length - 1)); else modo(false);
};
$("partilhar").onclick = async () => {
  const f = fotos[atual];
  if (!f) return;
  const arq = new File([f.blob], f.nome, { type: f.tipo || f.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [arq] })) {
    try { await navigator.share({ files: [arq] }); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = urlDe(f); a.download = f.nome; a.click();
};

// ---- Edição (editor.js) ----
$("editar").onclick = () => {
  const orig = fotos[atual];
  if (!orig) return;
  InkEditorFoto.abrir(urlDe(orig), (canvas) => {
    if (!canvas) return;
    const jpeg = /jpe?g|heic|heif/i.test(orig.tipo || orig.nome || "");
    canvas.toBlob(async (blob) => {
      if (!blob) { alert(t("The photo could not be saved.")); return; }
      const nome = t("{name} (edited)", { name: orig.nome.replace(/\.[^.]+$/, "") }) + "." + (jpeg ? "jpg" : "png");
      const [novo] = await bib.adicionar([new File([blob], nome, { type: blob.type })]);
      const i = fotos.indexOf(orig) + 1;
      fotos.splice(i, 0, novo);
      grade();
      ver(i);
    }, jpeg ? "image/jpeg" : "image/png", 0.92);
  });
};

$("zajustar").textContent = t("Fit");
bib.listar().then((lst) => { fotos = lst; grade(); modo(false); });
