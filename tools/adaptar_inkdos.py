#!/usr/bin/env python3
"""Adapta a cópia dos apps do InkDOS (inkdos/) ao InkTerminal. Rode depois de tools/copiar_inkdos.sh.

Única mudança: "Editar com ONLYOFFICE". No InkDOS original o botão abre os editores do site
inkdos-tools.github.io numa aba nova. Aqui, dentro da tela inicial do InkTerminal, o documento vai
para a cópia dos editores em onlyoffice/, aberta em tela cheia pela tela inicial (InkInicio).
Fora da tela inicial (app aberto direto), o comportamento original continua.
"""
import glob, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARCA = "/* InkTerminal: editor ONLYOFFICE local */"

FUNCAO = MARCA + r"""
function inkTerminal(){try{return g.top!==g.self&&g.top.location.origin===g.location.origin&&g.top.InkInicio?g.top.InkInicio:null}catch(_){return null}}
function toInkTerminal(it,file){
 const id=g.crypto?.randomUUID?g.crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2,10);
 const lang=String(g.InkDOSLocalization?.currentLanguage||doc.documentElement.lang||g.navigator?.language||'en');
 const LOCALE={pt:'pt',es:'es',de:'de',ja:'ja',zh:'zh-CN',fr:'fr',ru:'ru'}[lang.toLowerCase().split('-')[0]];
 return file.arrayBuffer().then(bytes=>new Promise((resolve,reject)=>{const req=g.indexedDB.open('inkdos-tool-handoff',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result,tx=db.transaction('files','readwrite');tx.objectStore('files').put({bytes,type:file.type||'',name:file.name,at:Date.now()},id);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=tx.onabort=()=>reject(tx.error)}}))
  .then(()=>{it.abrirEditor({id,nome:file.name,locale:LOCALE||''});return true});
}
function openInOffice(file,light,win){
 const it=inkTerminal();
 if(it){win?.close?.();toInkTerminal(it,file).catch(error=>console.error('InkDOS: could not hand the document to ONLYOFFICE',error));return true}
 return openInOfficeOriginal(file,light,win);
}
function openInOfficeOriginal(file,light,win){"""

TROCAS = [
    ("function openInOffice(file,light,win){", FUNCAO),
    ("async function editInOffice(pt){let win=null;if(webEdition()){",
     "async function editInOffice(pt){let win=null;if(webEdition()&&!inkTerminal()){"),
]

def main():
    arquivos = sorted(glob.glob(os.path.join(RAIZ, "inkdos/apps/*/runtime/platform/file-launch.js")))
    if not arquivos:
        sys.exit("nenhum file-launch.js em inkdos/apps")
    for p in arquivos:
        s = open(p, encoding="utf-8").read()
        if MARCA in s:
            print("já adaptado:", os.path.relpath(p, RAIZ)); continue
        for velho, novo in TROCAS:
            if s.count(velho) != 1:
                sys.exit(f"{os.path.relpath(p, RAIZ)}: trecho não encontrado (o InkDOS mudou?): {velho[:50]}")
            s = s.replace(velho, novo)
        open(p, "w", encoding="utf-8").write(s)
        print("adaptado:", os.path.relpath(p, RAIZ))

if __name__ == "__main__":
    main()
