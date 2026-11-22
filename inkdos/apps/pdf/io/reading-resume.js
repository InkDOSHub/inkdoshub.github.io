(function(global){'use strict';
// Keeps the reading place of this tab. iOS Safari drops a background tab and reloads it when the reader comes back,
// which used to lose the open PDF and its page. Each tab keeps a copy of its PDF on this device (IndexedDB) and its
// page in sessionStorage, which survives that reload but not closing the tab or the app: a reloaded tab reopens its
// PDF at the same page, a newly opened app starts empty. Every PDF also remembers its page across tabs, so opening it
// again later resumes there. Opening another PDF over an open one offers to keep both, the new one in a new tab.
const NS=global.InkDOS2PdfP4=global.InkDOS2PdfP4||{};
const TAB_KEY='inkdos2:pdf:tab',DOC_KEY='inkdos2:pdf:tabdoc',PAGES='inkdos2:pdf:pages';
const MAX_PAGES=60,APP='pdf';
// Copies live in the shared InkDOS tab store (shared/tab-resume.js), which keeps them within a fixed budget.
const store=()=>global.InkDOSTabResume?.store||null;
try{global.indexedDB?.deleteDatabase('inkdos-pdf-resume')}catch(_){} // first version kept its own copies
function read(store,k){try{const v=JSON.parse(store.getItem(k)||'null');return v&&typeof v==='object'?v:null}catch(_){return null}}
function write(store,k,v){try{store.setItem(k,JSON.stringify(v))}catch(_){}}
function tabId(){try{let id=sessionStorage.getItem(TAB_KEY);if(!id){id=global.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);sessionStorage.setItem(TAB_KEY,id)}return id}catch(_){return null}}
function openDb(name,store){return new Promise((resolve,reject)=>{if(!global.indexedDB)return reject(new Error('IndexedDB unavailable'));const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function idb(name,store,mode,fn){const d=await openDb(name,store);try{return await new Promise((resolve,reject)=>{const tx=d.transaction(store,mode),req=fn(tx.objectStore(store));tx.oncomplete=()=>resolve(req?.result);tx.onerror=tx.onabort=()=>reject(tx.error)})}finally{d.close()}}
function create({session,layout,fileOpen,chrome}={}){
 const tab=tabId();let readyKey=null,restoring=false;
 const size=()=>session.sourceFile?.size??session.sourceBytes?.length??0;
 const keyOf=(name,bytes)=>String(name||'')+'|'+Number(bytes||0);
 const currentKey=()=>session.active?keyOf(session.fileName,size()):null;
 function remember(page){const key=currentKey();if(!key||key!==readyKey)return;const pages=read(localStorage,PAGES)||{};delete pages[key];pages[key]=page;const keys=Object.keys(pages);for(const k of keys.slice(0,Math.max(0,keys.length-MAX_PAGES)))delete pages[k];write(localStorage,PAGES,pages);const doc=read(sessionStorage,DOC_KEY);if(doc?.key===key){doc.page=page;write(sessionStorage,DOC_KEY,doc)}}
 function install(){const base=layout.onPageChange;layout.onPageChange=n=>{base(n);remember(n)};document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&session.active&&tab)store()?.touch(tab)})}
 // Called once a document is shown. A file the reader opened becomes this tab's document; an edited copy made
 // inside the app only keeps its page.
 function opened(info){const key=currentKey();readyKey=key;if(!key||info?.internal)return;const doc=read(sessionStorage,DOC_KEY),page=restoring&&doc?.key===key?Number(doc.page)||1:Number((read(localStorage,PAGES)||{})[key])||1;if(page>1&&page<=layout.pageCount)layout.goToPage(page).catch(e=>console.error(e));if(restoring||!tab)return;
  write(sessionStorage,DOC_KEY,{key,page});const file=session.sourceFile||(session.sourceBytes?.length?new File([session.sourceBytes],session.fileName,{type:'application/pdf'}):null);if(file)store()?.put(tab,file,APP)}
 // Reopens this tab's PDF after the browser reloaded it, unless the tab was opened to show another file.
 async function restore(){const doc=read(sessionStorage,DOC_KEY);if(!tab||!doc?.key||session.active||global.__inkdosLaunchPending)return false;const file=await store()?.get(tab,APP);if(!file||keyOf(file.name,file.size)!==doc.key||session.active||global.__inkdosLaunchPending)return false;restoring=true;try{return !!(await fileOpen.openFile(file,{authorized:true}))}catch(e){console.warn('PDF resume failed',e);return false}finally{restoring=false}}
 // Opening a PDF over an open one: keep the open one here and show the new one in a new tab, or replace it.
 async function chooseTab(file){if(!session.active)return 'replace';const keep=await chrome.confirm({title:'Open another PDF',message:'Keep the open PDF in this tab and open the new one in a new tab?',confirmLabel:'New tab',cancelLabel:'Replace'});if(!keep)return 'replace';let w=null;try{w=global.open('','_blank')}catch(_){}if(!w){chrome.status('New tab blocked · opening here');return 'replace'}const id=global.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);try{await idb('inkdos-launch-handoff','files','readwrite',s=>s.put({data:file,name:file.name,type:file.type||'application/pdf',lastModified:file.lastModified||Date.now()},id));w.location.href=global.location.pathname+global.location.search+'#inkdos-launch='+id;return 'tab'}catch(e){console.warn('New tab handoff failed',e);try{w.close()}catch(_){}return 'replace'}}
 return Object.freeze({install,opened,restore,chooseTab})
}
NS.ReadingResume=Object.freeze({create});
})(globalThis);
