/* Lista de apps da área de trabalho.
   peso: memória estimada em MB quando o app está carregado (o Safari não informa o valor real).
   salvaSozinho: o app guarda o próprio estado o tempo todo, então pode ser descarregado sem perguntar.
   externo: abre numa aba nova e nunca dentro de uma janela. O InkDOS fica isolado em outro site, e o
   Office precisa do modo isolado do navegador (COOP/COEP), que uma janela dentro da mesa não tem;
   numa aba própria ele também ganha a memória dele, fora do limite da mesa. */
window.INK_APPS = [
  { id: "terminal", nome: "Linux terminal", url: "../terminal/?embed=1", salvaSozinho: false,
    // o modo "limitada" do terminal (640 MB + swap) deixa a aba perto de 1 GB; o normal usa 256 MB no Linux
    peso: function () { var m; try { m = localStorage.getItem("inkterminal-memoria"); } catch (_) {} return m === "limitada" ? 900 : 350; },
    descricao: "Alpine Linux no navegador.",
    icone: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9l3 3-3 3M12.5 15H17"/>' },
  { id: "foto", nome: "Fotos", url: "../apps/foto/", peso: 180, salvaSozinho: false,
    descricao: "Galeria e editor (miniPaint).",
    icone: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>' },
  { id: "video", nome: "Vídeo", url: "../apps/video/", peso: 350, salvaSozinho: false,
    descricao: "Player e editor (omniclip).",
    icone: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/>' },
  { id: "codigo", nome: "Código", url: "../apps/codigo/", peso: 300, salvaSozinho: false,
    descricao: "VS Code para web.",
    icone: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14"/>' },
  { id: "quadro", nome: "Quadro branco", url: "../apps/quadro/", peso: 150, salvaSozinho: true,
    descricao: "Excalidraw, salva sozinho.",
    icone: '<path d="M4 18c3-6 5 2 8-4s5 1 8-5"/><rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/>' },
  { id: "musica", nome: "Música", url: "../apps/musica/", peso: 60, salvaSozinho: true,
    descricao: "Player com lista e equalizador.",
    icone: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>' },
  { id: "office", nome: "Office", url: "../apps/office/", externo: true, peso: 0,
    descricao: "LibreOffice: textos, planilhas e apresentações (abre numa aba nova).",
    icone: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
  { id: "inkdos", nome: "InkDOS", url: "https://vfydr2m9wk-ops.github.io/InkDOS/", externo: true, peso: 0,
    descricao: "Documentos (abre numa aba nova).",
    icone: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>' },
];

window.inkSvg = function (corpo) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + corpo + "</svg>";
};
