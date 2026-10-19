#!/usr/bin/env python3
"""Adapta a cópia dos apps do InkDOS (inkdos/) ao InkTerminal. Rode depois de tools/copiar_inkdos.sh.

Três mudanças:
1. Cada app (index.html) carrega assets/gerenciador-app.js (abas dos apps, aviso de memória no
   Safari e o editor ONLYOFFICE local).
2. "Editar com ONLYOFFICE": no InkDOS original o botão abre os editores do site inkdos-tools.github.io
   numa aba nova. Aqui o documento vai para a cópia dos editores em onlyoffice/, na aba nova que o
   botão já abre (InkPaginas.abrirEditor, em assets/gerenciador-app.js).
3. Idioma: os apps seguem o pacote de idioma do InkTerminal (assets/idioma.js, carregado no começo
   de cada app). Os menus de idioma do InkDOS abrem o aviso de pacotes do InkTerminal, em vez de
   trocar só aquele app.
"""
import glob, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARCA = "/* InkTerminal: editor ONLYOFFICE local */"

FUNCAO = MARCA + r"""
function inkTerminal(){return g.InkPaginas&&g.InkPaginas.abrirEditor?g.InkPaginas:null}
function toInkTerminal(it,file,win){
 const id=g.crypto?.randomUUID?g.crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2,10);
 const lang=String(g.InkDOSLocalization?.currentLanguage||doc.documentElement.lang||g.navigator?.language||'en');
 const LOCALE={pt:'pt',es:'es',de:'de',ja:'ja',zh:'zh-CN',fr:'fr',ru:'ru'}[lang.toLowerCase().split('-')[0]];
 return file.arrayBuffer().then(bytes=>new Promise((resolve,reject)=>{const req=g.indexedDB.open('inkdos-tool-handoff',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result,tx=db.transaction('files','readwrite'),st=tx.objectStore('files');st.put({bytes,type:file.type||'',name:file.name,at:Date.now()},id);
  /* documentos passados ao editor há mais de 7 dias */const c=st.openCursor();c.onsuccess=()=>{const k=c.result;if(!k)return;if(k.key!==id&&Date.now()-(k.value?.at||0)>7*864e5)k.delete();k.continue()};tx.oncomplete=()=>{db.close();resolve()};tx.onerror=tx.onabort=()=>reject(tx.error)}}))
  .then(()=>{it.abrirEditor({id,nome:file.name,locale:LOCALE||''},win);return true});
}
function openInOffice(file,light,win){
 const it=inkTerminal();
 if(it){toInkTerminal(it,file,win).catch(error=>{win?.close?.();console.error('InkDOS: could not hand the document to ONLYOFFICE',error)});return true}
 return openInOfficeOriginal(file,light,win);
}
function openInOfficeOriginal(file,light,win){"""

TROCAS = [("function openInOffice(file,light,win){", FUNCAO)]

SCRIPT = '<script src="../../../assets/gerenciador-app.js?v=7"></script>'
IDIOMA = '<script src="../../../assets/idioma.js?v=1"></script>'

# (arquivo, trecho original, trecho novo); a marca no trecho novo evita aplicar duas vezes
IDIOMA_TROCAS = [
    ("inkdos/shared/localization/ui-localization.js",
     "function readLanguage(key,legacyKeys=legacyStorageKeys){storageKey=typeof key==='string'?key:storageKey;",
     "function readLanguage(key,legacyKeys=legacyStorageKeys){storageKey=typeof key==='string'?key:storageKey;/* InkTerminal: pacote de idioma */if(root.InkIdioma)return normalizeLanguage(root.InkIdioma.atual);"),
    ("inkdos/shared/localization/settings-strip.js",
     "function showLanguage(anchor){",
     "function showLanguage(anchor){/* InkTerminal: pacote de idioma */if(root.InkIdioma){closePopover();root.InkIdioma.escolher();return}"),
    ("inkdos/shared/localization/settings-strip.js",
     "const api=root.InkDOSLocalization;if(api){section('Language');for(const language of api.languages){",
     "const api=root.InkDOSLocalization;if(api&&root.InkIdioma){/* InkTerminal: pacote de idioma */section('Language');const o=option(root.InkIdioma.nome(),'idioma',()=>{closePopover();root.InkIdioma.escolher()});o.classList.add('active');popover.appendChild(o)}else if(api){section('Language');for(const language of api.languages){"),
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
    for p in sorted(glob.glob(os.path.join(RAIZ, "inkdos/apps/*/index.html"))):
        s = open(p, encoding="utf-8").read()
        if "assets/gerenciador-app.js" in s:
            continue
        if s.count("</head>") != 1:
            sys.exit(f"{os.path.relpath(p, RAIZ)}: </head> não encontrado")
        open(p, "w", encoding="utf-8").write(s.replace("</head>", SCRIPT + "</head>"))
        print("controle de memória:", os.path.relpath(p, RAIZ))
    for rel, velho, novo in IDIOMA_TROCAS:
        p = os.path.join(RAIZ, rel)
        s = open(p, encoding="utf-8").read()
        if novo in s:
            continue
        if s.count(velho) != 1:
            sys.exit(f"{rel}: trecho não encontrado (o InkDOS mudou?): {velho[:50]}")
        open(p, "w", encoding="utf-8").write(s.replace(velho, novo))
        print("idioma:", rel)
    for p in sorted(glob.glob(os.path.join(RAIZ, "inkdos/apps/*/index.html"))):
        s = open(p, encoding="utf-8").read()
        if "assets/idioma.js" in s:
            continue
        if s.count("<head>") != 1:
            sys.exit(f"{os.path.relpath(p, RAIZ)}: <head> não encontrado")
        open(p, "w", encoding="utf-8").write(s.replace("<head>", "<head>" + IDIOMA))
        print("idioma:", os.path.relpath(p, RAIZ))

if __name__ == "__main__":
    main()
