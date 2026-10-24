// Quadro branco do InkDOS Hub: o Excalidraw (MIT) abaixo da barra comum, com o
// desenho guardado neste navegador. Abrir/Salvar/Exportar vêm do próprio Excalidraw.
import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "../node_modules/@excalidraw/excalidraw/dist/prod/index.css";

const KEY = "inkdoshub-quadro";
let initialData = null;
try {
  const s = JSON.parse(localStorage.getItem(KEY) || "null");
  if (s) initialData = { elements: s.elements, appState: { viewBackgroundColor: s.bg }, files: s.files };
} catch {}

let timer;
function onChange(elements, appState, files) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ elements, bg: appState.viewBackgroundColor, files }));
    } catch {}
  }, 500);
}

function App() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* O tema segue o do InkDOS Hub (assets/tema.js) e o idioma, o pacote escolhido (assets/idioma.js) */}
      <Excalidraw initialData={initialData} onChange={onChange} langCode={window.InkIdioma ? InkIdioma.excalidraw() : "en"} theme={window.inkTema ? inkTema.atual() : "light"}>
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
