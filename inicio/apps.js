/* Apps que abrem dentro da tela inicial (em tela cheia, cada um num iframe do próprio site).
   peso: memória estimada em MB quando o app está carregado (o Safari não informa o valor real).
   salvaSozinho: o app guarda o próprio estado o tempo todo, então pode ser descarregado sem perguntar.
   Os apps do InkDOS são a cópia em inkdos/ (veja inkdos/UPSTREAM-SOURCE.txt). */
window.INK_APPS = [
  { id: "terminal", nome: "Linux terminal", url: "terminal/", salvaSozinho: false,
    // o modo "limitada" do terminal (640 MB + swap) deixa a aba perto de 1 GB; o normal usa 256 MB no Linux
    peso: function () { var m; try { m = localStorage.getItem("inkterminal-memoria"); } catch (_) {} return m === "limitada" ? 900 : 350; } },
  { id: "foto", nome: "Fotos", url: "apps/foto/", peso: 180, salvaSozinho: false },
  { id: "video", nome: "Vídeo", url: "apps/video/", peso: 350, salvaSozinho: false },
  { id: "codigo", nome: "Código", url: "apps/codigo/", peso: 300, salvaSozinho: false },
  { id: "quadro", nome: "Quadro branco", url: "apps/quadro/", peso: 150, salvaSozinho: true },
  { id: "musica", nome: "Música", url: "apps/musica/", peso: 60, salvaSozinho: true },
  // Boxedwine: começa com 512 MB de memória e cresce, mais o sistema do Wine (~220 MB)
  { id: "wine", nome: "Wine (teste)", url: "apps/wine/", peso: 950, salvaSozinho: false },
  // apps do InkDOS (cópia em inkdos/); suite=1 mostra o botão Home, que volta para esta tela
  { id: "documentos", nome: "Documentos", url: "inkdos/apps/documents/index.html?suite=1", peso: 200, salvaSozinho: false },
  { id: "planilhas", nome: "Planilhas", url: "inkdos/apps/spreadsheets/index.html?suite=1", peso: 220, salvaSozinho: false },
  { id: "apresentacoes", nome: "Apresentações", url: "inkdos/apps/presentations/index.html?suite=1", peso: 220, salvaSozinho: false },
  { id: "pdf", nome: "PDF", url: "inkdos/apps/pdf/index.html?suite=1", peso: 250, salvaSozinho: false },
  { id: "texto", nome: "Texto simples", url: "inkdos/apps/txt/index.html?suite=1", peso: 60, salvaSozinho: false },
  { id: "epub", nome: "Leitor EPUB", url: "inkdos/apps/epub/index.html?suite=1", peso: 120, salvaSozinho: false },
];
