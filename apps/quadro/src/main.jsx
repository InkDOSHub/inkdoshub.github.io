// InkDOS Hub whiteboard: Excalidraw (MIT) below the common bar, with the
// drawing stored in this browser. Open/Save/Export come from Excalidraw itself.
import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "../node_modules/@excalidraw/excalidraw/dist/prod/index.css";

// The drawing lives in IndexedDB (no ~5 MB localStorage limit). An old drawing in localStorage
// is brought over on first open. If saving fails, a notice appears in the corner of the screen.
const KEY = "inkdoshub-quadro";
function banco() {
  return new Promise((ok, falha) => {
    const r = indexedDB.open("inkdoshub-quadro", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("desenho");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
async function ler() {
  const db = await banco();
  const v = await new Promise((ok, falha) => {
    const g = db.transaction("desenho").objectStore("desenho").get("atual");
    g.onsuccess = () => ok(g.result);
    g.onerror = () => falha(g.error);
  });
  db.close();
  return v;
}
async function gravar(valor) {
  const db = await banco();
  await new Promise((ok, falha) => {
    const tx = db.transaction("desenho", "readwrite");
    tx.objectStore("desenho").put(valor, "atual");
    tx.oncomplete = ok;
    tx.onerror = tx.onabort = () => falha(tx.error);
  });
  db.close();
}
function aviso(texto) {
  let el = document.getElementById("quadro-aviso");
  if (!el) {
    el = document.createElement("div");
    el.id = "quadro-aviso";
    el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:10;padding:8px 12px;border-radius:10px;background:#b3261e;color:#fff;font:14px system-ui,sans-serif";
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.hidden = !texto;
}

let timer;
function onChange(elements, appState, files) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    gravar({ elements, bg: appState.viewBackgroundColor, files, pen: !!appState.penMode })
      .then(() => aviso(""))
      .catch(() => aviso(window.InkIdioma && InkIdioma.t ? InkIdioma.t("The drawing could not be saved in this browser.") : "The drawing could not be saved in this browser."));
  }, 500);
}

// Apple Pencil / stylus: the first time a pen touches the board, pen mode turns on (the pen draws with
// pressure, the finger moves and zooms the board, the palm is ignored) and the pen tool is picked.
// Excalidraw's own pen-mode button turns it off; the choice is remembered with the drawing.
let api = null;
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "pen" || !api) return;
  const st = api.getAppState();
  if (st.penMode) return;
  api.updateScene({ appState: { penMode: true } });
  if (["selection", "hand"].includes(st.activeTool && st.activeTool.type)) api.setActiveTool({ type: "freedraw" });
}, true);

function App() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* O tema segue o do InkDOS Hub (assets/tema.js) e o idioma, o pacote escolhido (assets/idioma.js) */}
      <Excalidraw excalidrawAPI={(a) => { api = a; }} initialData={initialData} onChange={onChange} langCode={window.InkIdioma ? InkIdioma.excalidraw() : "en"} theme={window.inkTema ? inkTema.atual() : "light"}>
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
let initialData = null;
(async () => {
  let s = null;
  try { s = await ler(); } catch {}
  if (!s) {
    try {
      s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s) { await gravar(s); localStorage.removeItem(KEY); }
    } catch {}
  }
  if (s) initialData = { elements: s.elements, appState: { viewBackgroundColor: s.bg, penMode: !!s.pen }, files: s.files };
  createRoot(document.getElementById("root")).render(<App />);
})();
