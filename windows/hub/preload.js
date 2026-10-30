// Ponte mínima entre a tela inicial do site e o app do Windows (janela isolada, sem Node na página).
// offline.js usa window.inkHubNativo para guardar os apps no disco em vez do cache do navegador.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkHubNativo', {
  versao: () => ipcRenderer.invoke('hub:versao'),
  reiniciarAtualizando: () => ipcRenderer.invoke('hub:reiniciar'),
  atualizarApp: progresso => {
    const ouvir = (_e, p) => { try { if (progresso) progresso(p); } catch (_) {} };
    ipcRenderer.on('hub:progresso-app', ouvir);
    return ipcRenderer.invoke('hub:atualizar-app').finally(() => ipcRenderer.removeListener('hub:progresso-app', ouvir));
  },
  estado: () => ipcRenderer.invoke('hub:estado'),
  espaco: () => ipcRenderer.invoke('hub:espaco'),
  sincronizar: (ids, progresso) => {
    const ouvir = (_e, p) => { try { if (progresso) progresso(p); } catch (_) {} };
    ipcRenderer.on('hub:progresso', ouvir);
    return ipcRenderer.invoke('hub:sincronizar', ids).finally(() => ipcRenderer.removeListener('hub:progresso', ouvir));
  }
});

// Código: o VS Code nativo é bem mais leve que a versão web; um aviso discreto, que some ao fechar.
window.addEventListener('DOMContentLoaded', () => {
  if (!location.pathname.startsWith('/apps/codigo/')) return;
  try { if (localStorage.getItem('inkhub-aviso-vscode') === '0') return; } catch (_) {}
  const pt = /^pt/i.test(navigator.language);
  const barra = document.createElement('div');
  barra.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:10px;align-items:center;padding:8px 10px 8px 14px;border-radius:10px;background:#1f2937;color:#fff;font:13px -apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)';
  const txt = document.createElement('span');
  txt.textContent = pt ? 'Para mais desempenho, use o VS Code nativo do Windows.' : 'For better performance, use the native VS Code for Windows.';
  const baixar = document.createElement('a');
  baixar.href = 'https://code.visualstudio.com/download';
  baixar.textContent = pt ? 'Baixar' : 'Download';
  baixar.style.cssText = 'color:#93c5fd;text-decoration:none;font-weight:600';
  const x = document.createElement('button');
  x.textContent = '✕';
  x.setAttribute('aria-label', pt ? 'Fechar' : 'Close');
  x.style.cssText = 'border:0;background:transparent;color:#cbd5e1;cursor:pointer;font-size:14px';
  x.onclick = () => { barra.remove(); try { localStorage.setItem('inkhub-aviso-vscode', '0'); } catch (_) {} };
  barra.append(txt, baixar, x);
  document.body.appendChild(barra);
});
