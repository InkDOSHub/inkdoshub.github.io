(function(global){'use strict';
// Keeps the reading place. Every PDF remembers its page on this device, so opening it again (from the start screen's
// Recent list after Safari reloaded the tab, or any time later) resumes there. The PDF itself is not kept: the Recent
// list (shared/tab-resume.js) holds only its name and a small picture of the page in view. Opening a PDF over an open
// one offers to keep both, the new one in a new tab.
const NS=global.InkDOS2PdfP4=global.InkDOS2PdfP4||{};
const PAGES='inkdos2:pdf:pages',MAX_PAGES=60,PICTURE_WIDTH=900;
const shared=()=>global.InkDOSTabResume||null;
function read(store,k){try{const v=JSON.parse(store.getItem(k)||'null');return v&&typeof v==='object'?v:null}catch(_){return null}}
function write(store,k,v){try{store.setItem(k,JSON.stringify(v))}catch(_){}}
function openDb(name,store){return new Promise((resolve,reject)=>{if(!global.indexedDB)return reject(new Error('IndexedDB unavailable'));const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function idb(name,store,mode,fn){const d=await openDb(name,store);try{return await new Promise((resolve,reject)=>{const tx=d.transaction(store,mode),req=fn(tx.objectStore(store));tx.oncomplete=()=>resolve(req?.result);tx.onerror=tx.onabort=()=>reject(tx.error)})}finally{d.close()}}
try{global.indexedDB?.deleteDatabase('inkdos-pdf-resume')}catch(_){} // the first version kept whole PDFs
function create({session,layout,chrome}={}){
 let readyKey=null,pictureTimer=0,ownFile=false;
 const size=()=>session.sourceFile?.size??session.sourceBytes?.length??0;
 const keyOf=(name,bytes)=>String(name||'')+'|'+Number(bytes||0);
 const currentKey=()=>session.active?keyOf(session.fileName,size()):null;
 // A small JPEG of the page in view, redrawn a moment after the reader stops on a page.
 function picture(){clearTimeout(pictureTimer);pictureTimer=setTimeout(()=>{const src=layout.getShell?.(layout.currentPage)?.querySelector('canvas');if(!src||!src.width||!shared()||!session.active||!ownFile)return;const name=session.fileName,bytes=size();const k=Math.min(1,PICTURE_WIDTH/src.width),c=document.createElement('canvas');c.width=Math.max(1,Math.round(src.width*k));c.height=Math.max(1,Math.round(src.height*k));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(src,0,0,c.width,c.height);c.toBlob(b=>{c.width=c.height=0;if(b)shared().remember(name,bytes,{picture:b})},'image/jpeg',.72)},1500)}
 function remember(page){const key=currentKey();if(!key||key!==readyKey)return;const pages=read(localStorage,PAGES)||{};delete pages[key];pages[key]=page;const keys=Object.keys(pages);for(const k of keys.slice(0,Math.max(0,keys.length-MAX_PAGES)))delete pages[k];write(localStorage,PAGES,pages);picture()}
 function install(){const base=layout.onPageChange;layout.onPageChange=n=>{base(n);remember(n)}}
 // Called once a document is shown: it goes back to its page. An edited copy made inside the app keeps its own.
 function opened(info){const key=currentKey();readyKey=key;ownFile=!info?.internal;if(!key||info?.internal)return;const page=Number((read(localStorage,PAGES)||{})[key])||1;if(page>1&&page<=layout.pageCount)layout.goToPage(page).catch(e=>console.error(e));picture()}
 // Opening a PDF over an open one: keep the open one here and show the new one in a new tab, or replace it.
 async function chooseTab(file){if(!session.active)return 'replace';const keep=await chrome.confirm({title:'Open another PDF',message:'Keep the open PDF in this tab and open the new one in a new tab?',confirmLabel:'New tab',cancelLabel:'Replace'});if(!keep)return 'replace';let w=null;try{w=global.open('','_blank')}catch(_){}if(!w){chrome.status('New tab blocked · opening here');return 'replace'}const id=global.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2);try{await idb('inkdos-launch-handoff','files','readwrite',s=>s.put({data:file,name:file.name,type:file.type||'application/pdf',lastModified:file.lastModified||Date.now()},id));w.location.href=global.location.pathname+global.location.search+'#inkdos-launch='+id;return 'tab'}catch(e){console.warn('New tab handoff failed',e);try{w.close()}catch(_){}return 'replace'}}
 return Object.freeze({install,opened,chooseTab})
}
NS.ReadingResume=Object.freeze({create});
})(globalThis);
