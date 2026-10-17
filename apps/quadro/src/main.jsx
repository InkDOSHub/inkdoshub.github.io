// Quadro branco do InkTerminal: o Excalidraw (MIT) numa página, com o
// desenho guardado neste navegador. Abrir/Salvar/Exportar vêm do próprio Excalidraw.
import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "../node_modules/@excalidraw/excalidraw/dist/prod/index.css";

const KEY = "inkterminal-quadro";
let initialData = null;
try {
  const s = JSON.parse(localStorage.getItem(KEY) || "null");
  if (s) initialData = { elements: s.elements, appState: { viewBackgroundColor: s.bg, theme: s.theme }, files: s.files };
} catch {}

let timer;
function onChange(elements, appState, files) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ elements, bg: appState.viewBackgroundColor, theme: appState.theme, files }));
    } catch {}
  }, 500);
}

function App() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Excalidraw initialData={initialData} onChange={onChange} langCode="pt-BR">
        <MainMenu>
          <MainMenu.Item onSelect={() => { location.href = "../../"; }}>‹ Voltar para o InkTerminal</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
