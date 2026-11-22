(function(global){'use strict';
// Keeps the reading place. iOS Safari drops a background tab and reloads it when the reader comes back, which used to
// lose the open PDF and its page. The last PDF opened is kept on this device (IndexedDB) and reopened at its page when
// the app starts without another file to open; every PDF also remembers its own page, so reopening it later resumes.
const NS=global.InkDOS2PdfP4=global.InkDOS2PdfP4||{};
const DB='inkdos-pdf-resume',STORE='files',LAST='last',PAGES='inkdos2:pdf:pages',META='inkdos2:pdf:last';
const MAX_BYTES=300*1024*1024,MAX_PAGES=60,KEEP_MS=30*864e5;
function readJson(k,fallback){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&typeof v==='object'?v:fallback}catch(_){return fallback}}
function writeJson(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}}
function db(){return new Promise((resolve,reject)=>{if(!global.indexedDB)return reject(new Error('IndexedDB unavailable'));const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function idb(mode,fn){const d=await db();try{return await new Promise((resolve,reject)=>{const tx=d.transaction(STORE,mode),req=fn(tx.objectStore(STORE));tx.oncomplete=()=>resolve(req?.result);tx.onerror=tx.onabort=()=>reject(tx.error)})}finally{d.close()}}
function create({session,layout,fileOpen}={}){
 let readyKey=null,restoring=false;
 const size=()=>session.sourceFile?.size??session.sourceBytes?.length??0;
 const keyOf=(name,bytes)=>String(name||'')+'|'+Number(bytes||0);
 const currentKey=()=>session.active?keyOf(session.fileName,size()):null;
 function remember(page){const key=currentKey();if(!key||key!==readyKey)return;const pages=readJson(PAGES,{});delete pages[key];pages[key]=page;const keys=Object.keys(pages);for(const k of keys.slice(0,Math.max(0,keys.length-MAX_PAGES)))delete pages[k];writeJson(PAGES,pages);const meta=readJson(META,null);if(meta&&meta.key===key){meta.at=Date.now();writeJson(META,meta)}}
 function install(){const base=layout.onPageChange;layout.onPageChange=n=>{base(n);remember(n)}}
 // Called once a document is shown. A file the reader opened is kept as the one to reopen; an edited copy made
 // inside the app only keeps its page.
 function opened(info){const key=currentKey();readyKey=key;if(!key||info?.internal)return;const page=Number(readJson(PAGES,{})[key])||1;if(page>1&&page<=layout.pageCount)layout.goToPage(page).catch(e=>console.error(e));const meta=readJson(META,null);if(restoring||meta?.key===key){if(meta?.key===key){meta.at=Date.now();writeJson(META,meta)}return}
  const file=session.sourceFile,blob=file||(session.sourceBytes?.length?new Blob([session.sourceBytes],{type:'application/pdf'}):null);if(!blob||blob.size>MAX_BYTES)return;
  idb('readwrite',s=>s.put({blob,name:session.fileName,type:'application/pdf',lastModified:file?.lastModified||Date.now()},LAST)).then(()=>writeJson(META,{key,name:session.fileName,at:Date.now()})).catch(e=>console.warn('PDF resume copy not kept',e))}
 // Reopens the last PDF unless the app was started to open another file, or a PDF is already open.
 async function restore(){const meta=readJson(META,null);if(!meta?.key||Date.now()-(Number(meta.at)||0)>KEEP_MS||session.active||global.__inkdosLaunchPending)return false;let v=null;try{v=await idb('readonly',s=>s.get(LAST))}catch(_){return false}if(!v?.blob||session.active||global.__inkdosLaunchPending)return false;const file=new File([v.blob],v.name||meta.name||'document.pdf',{type:'application/pdf',lastModified:v.lastModified||Date.now()});if(keyOf(file.name,file.size)!==meta.key)return false;restoring=true;try{return !!(await fileOpen.openFile(file,{authorized:true}))}catch(e){console.warn('PDF resume failed',e);return false}finally{restoring=false}}
 return Object.freeze({install,opened,restore})
}
NS.ReadingResume=Object.freeze({create});
})(globalThis);
