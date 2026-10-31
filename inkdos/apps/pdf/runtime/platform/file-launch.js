// Diagnóstico do Hub (☰ > Diagnostics): anota as etapas da abertura em localStorage "inkdoshub-diag".
var inkDiag=(function(){function m(n){try{var k='inkdoshub-diag',d=JSON.parse(localStorage.getItem(k)||'null');if(!d||Date.now()-d.t0>120000)d={t0:Math.round(performance.timeOrigin||Date.now()),etapas:[]};d.etapas.push({nome:n,t:Date.now(),pagina:location.pathname.split('/').slice(-3).join('/')});localStorage.setItem(k,JSON.stringify(d))}catch(_){}}if(/(?:^#|&)inkdos-launch=/.test(location.hash)||window.launchQueue){m('app: page started');document.addEventListener('DOMContentLoaded',function(){m('app: HTML ready')});addEventListener('load',function(){m('app: page fully loaded')});addEventListener('error',function(e){m('app: error '+String(e.message||e.type).slice(0,120))})}return m})();
(function(g){'use strict';
const doc=typeof document!=='undefined'?document:null;
let openHandler=null,pendingLaunchFiles=[];
function extension(name){const m=String(name||'').toLowerCase().match(/\.([^.\\/]+)$/);return m?m[1]:''}
function acceptTokens(accept){return String(accept||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)}
function extensionsFromAccept(accept){return new Set(acceptTokens(accept).filter(token=>token.startsWith('.')&&token.length>1).map(token=>token.slice(1)))}
function acceptsFile(input,file){const tokens=acceptTokens(input?.accept);if(!tokens.length)return true;const ext=extension(file?.name),mime=String(file?.type||'').toLowerCase();for(const token of tokens){if(token.startsWith('.')&&ext===token.slice(1))return true;if(token.endsWith('/*')&&mime.startsWith(token.slice(0,-1)))return true;if(token.includes('/')&&mime===token)return true}return false}
function compatibleInput(file){if(!doc)return null;for(const input of doc.querySelectorAll('input[type="file"]'))if(acceptsFile(input,file))return input;return null}
function dispatchError(error){try{doc?.dispatchEvent(new CustomEvent('inkdos:file-launch-error',{detail:{message:String(error?.message||error||'File launch failed')}}))}catch(_){}}
async function injectFile(file,input=compatibleInput(file)){if(!file)return false;if(!input||!acceptsFile(input,file))throw new Error('Unsupported file format for this InkDOS workspace.');if(typeof g.DataTransfer!=='function'||typeof g.File!=='function')throw new Error('This host cannot inject a file into the workspace.');const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true}
// "Edit with ArtCraft" (view-only notice of Documents, Spreadsheets and Presentations): the document goes to the
// ArtCraft editors (apps/*craft/) through IndexedDB "inkdos-tool-handoff" and InkPaginas.abrirEditor
// (assets/gerenciador-app.js). InkDOS Hub: the old InkDOS Office site and its "Edit with ArtCraft" header button are gone.
const OFFICE_EXT=new Set(['docx','doc','odt','rtf','xlsx','xls','ods','csv','pptx','ppt','odp','docm','dotx','dot','fodt','xlsm','xltx','fods','pptm','ppsx','pps','potx','fodp']);
function inkDOSHub(){return g.InkPaginas&&g.InkPaginas.abrirEditor?g.InkPaginas:null}
function toInkDOSHub(it,file,win){
 const id=g.crypto?.randomUUID?g.crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2,10);
 const lang=String(g.InkDOSLocalization?.currentLanguage||doc.documentElement.lang||g.navigator?.language||'en');
 const LOCALE={pt:'pt',es:'es',de:'de',ja:'ja',zh:'zh-CN',fr:'fr',ru:'ru'}[lang.toLowerCase().split('-')[0]];
 return file.arrayBuffer().then(bytes=>new Promise((resolve,reject)=>{const req=g.indexedDB.open('inkdos-tool-handoff',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{const db=req.result,tx=db.transaction('files','readwrite'),st=tx.objectStore('files');st.put({bytes,type:file.type||'',name:file.name,at:Date.now()},id);
  /* documentos passados ao editor há mais de 7 dias */const c=st.openCursor();c.onsuccess=()=>{const k=c.result;if(!k)return;if(k.key!==id&&Date.now()-(k.value?.at||0)>7*864e5)k.delete();k.continue()};tx.oncomplete=()=>{db.close();resolve()};tx.onerror=tx.onabort=()=>reject(tx.error)}}))
  .then(()=>{it.abrirEditor({id,nome:file.name,locale:LOCALE||''},win);return true});
}
function openInOffice(file,win){
 const it=inkDOSHub();
 if(!it)return false;
 toInkDOSHub(it,file,win).catch(error=>{win?.close?.();console.error('InkDOS: could not hand the document to ArtCraft',error)});return true;
}
async function lightRoute(file){if(!file)return false;setCurrentFile(file);if(openHandler)return !!(await openHandler(file));pendingLaunchFiles.push(file);return true}
async function routeFile(file){if(!file)return false;return lightRoute(file)}
async function drainPending(){if(!openHandler||!pendingLaunchFiles.length)return;const files=pendingLaunchFiles.splice(0);for(const file of files){try{await openHandler(file)}catch(error){console.error('InkDOS launched-file open failed:',error);dispatchError(error)}}}
function setOpenHandler(handler){openHandler=typeof handler==='function'?handler:null;if(openHandler)Promise.resolve().then(drainPending);return !!openHandler}
function rememberHandle(file,handle){try{const map=g.InkDOSFileHandles||(g.InkDOSFileHandles=new Map());map.set([file.name,file.size,file.lastModified].join('|'),handle)}catch(_){}}
// The writable original of the document now open (null when it came from a plain picker/drop).
function setCurrentFile(file){try{g.InkDOSCurrentHandle=file?(g.InkDOSFileHandles?.get([file.name,file.size,file.lastModified].join('|'))||null):null}catch(_){g.InkDOSCurrentHandle=null}}
async function openHandle(handle){if(!handle||handle.kind!=='file'||typeof handle.getFile!=='function')return false;const file=await handle.getFile();rememberHandle(file,handle);return routeFile(file)}
async function consume(params){inkDiag('XeOS sent the file straight to the app');for(const handle of params?.files||[]){if(await openHandle(handle))return true}return false}
function requestPicker(input){if(!input||typeof g.showOpenFilePicker!=='function')return false;let pending;try{pending=g.showOpenFilePicker({multiple:false})}catch(_){return false}Promise.resolve(pending).then(async handles=>{const handle=handles?.[0];if(!handle)return;const file=await handle.getFile();rememberHandle(file,handle);if(!acceptsFile(input,file))throw new Error('Unsupported file format for this InkDOS workspace.');await injectFile(file,input)}).catch(error=>{if(error?.name==='AbortError')return;console.error('InkDOS File System Access open failed:',error);dispatchError(error)});return true}
function install(){if(g.document)g.document.addEventListener('change',e=>{const t=e.target;if(t&&t.type==='file'&&t.files&&t.files[0]&&!/^image\//.test(String(t.accept||'').trim()))setCurrentFile(t.files[0])},true);const queue=g.launchQueue;if(!queue||typeof queue.setConsumer!=='function')return false;queue.setConsumer(params=>consume(params).catch(error=>{console.error('InkDOS launched-file open failed:',error);dispatchError(error)}));return true}
// Home hands a launched file over by storing it in IndexedDB and opening this page with #inkdos-launch=<id>.
function takeHandoff(){const m=/(?:^#|&)inkdos-launch=([A-Za-z0-9-]+)/.exec(g.location?.hash||'');if(!m||!g.indexedDB)return false;const id=m[1];try{g.history.replaceState(g.history.state,'',g.location.pathname+g.location.search)}catch(_){}let req;try{req=g.indexedDB.open('inkdos-launch-handoff',1)}catch(error){dispatchError(error);return false}req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onerror=()=>dispatchError(req.error);req.onsuccess=()=>{const db=req.result;let tx;try{tx=db.transaction('files','readwrite')}catch(error){db.close();dispatchError(error);return}const store=tx.objectStore('files'),get=store.get(id);get.onsuccess=()=>{const v=get.result;store.delete(id);inkDiag('app: file read from storage'+(v?'':' (missing!)'));if(!v)return;const file=new File([v.data],v.name,{type:v.type||'',lastModified:v.lastModified||Date.now()});routeFile(file).then(()=>inkDiag('app: file opened'),e=>{inkDiag('app: open failed');throw e}).catch(error=>{console.error('InkDOS launched-file open failed:',error);dispatchError(error)})};tx.oncomplete=tx.onabort=()=>db.close()};return true}
install();
takeHandoff();
g.InkDOSFileLaunch=Object.freeze({openInOffice:file=>OFFICE_EXT.has(extension(file?.name))&&openInOffice(file),officeExtensions:OFFICE_EXT,install,consume,openHandle,routeFile,injectFile,compatibleInput,acceptsFile,extensionsFromAccept,requestPicker,setOpenHandler});
})(globalThis);
