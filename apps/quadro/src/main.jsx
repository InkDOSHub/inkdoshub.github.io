// Quadro branco do InkDOS Hub: o Excalidraw (MIT) abaixo da barra comum, com o
// desenho guardado neste navegador. Abrir/Salvar/Exportar vêm do próprio Excalidraw.
import React from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "../node_modules/@excalidraw/excalidraw/dist/prod/index.css";

// O desenho fica no IndexedDB (sem o limite de ~5 MB do localStorage). Um desenho antigo do localStorage
// é trazido na primeira abertura. Se a gravação falhar, um aviso aparece no canto da tela.
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
    gravar({ elements, bg: appState.viewBackgroundColor, files })
      .then(() => aviso(""))
      .catch(() => aviso(window.InkIdioma && InkIdioma.t ? InkIdioma.t("The drawing could not be saved in this browser.") : "The drawing could not be saved in this browser."));
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
  if (s) initialData = { elements: s.elements, appState: { viewBackgroundColor: s.bg }, files: s.files };
  createRoot(document.getElementById("root")).render(<App />);
})();
