(function(global){'use strict';
// Page-by-page PDF reading with the ePub reader's page turn: one page at a time fitted to the screen, turned by a
// horizontal swipe, the arrow keys or the toolbar arrows. The turn style is the ePub reader's own preference
// (Turn / Slide / Off), so both readers turn pages the same way. The turn works on the pages already drawn (the
// neighbours are kept drawn but hidden), so it copies no canvas and costs no extra memory.
const NS=global.InkDOS2PdfP4=global.InkDOS2PdfP4||{};
const KEY='inkdos2:pdf:singlePage',TURN_KEY='inkdos2:epub:pageTurn';
function create({layout,zoom,zoomControls,viewport,stack,button,isEditing}={}){
 let on=false,busyUntil=0,active=null,touch=null;
 const baseNext=layout.next.bind(layout),basePrev=layout.prev.bind(layout);
 // Default by device: iPhone and iPad turn pages, a computer (and XeOS) scrolls. A choice made in the zoom menu wins.
 const touchApple=()=>{const n=global.navigator||{},ua=n.userAgent||'';return /iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&(n.maxTouchPoints||0)>1)};
 const stored=()=>{try{const v=localStorage.getItem(KEY);if(v==='1'||v==='0')return v==='1'}catch(_){}return touchApple()};
 const store=v=>{try{localStorage.setItem(KEY,v?'1':'0')}catch(_){}};
 const style=()=>{try{const v=localStorage.getItem(TURN_KEY);return v==='slide'||v==='none'?v:'book'}catch(_){return 'book'}};
 const reduced=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches}catch(_){return false}};
 const clear=(...hosts)=>{for(const h of hosts)h?.classList.remove('turn-sheet','turn-base')};
 function part(cls){const e=document.createElement('div');e.className=cls;e.setAttribute('aria-hidden','true');return e}
 // Same flat fold as the ePub reader: the turning page is clipped at the fold line while its back folds towards the
 // spine. Next folds the current page away; previous unfolds the previous page back over the current one.
 function animate(sheet,next,kind,dur,finish){
  const shell=sheet.querySelector('.pdf-page-shell')||sheet,sr=shell.getBoundingClientRect(),kr=stack.getBoundingClientRect(),vr=viewport.getBoundingClientRect();
  const W=sr.width,x0=sr.left-kr.left,y0=sr.top-kr.top,D=Math.max(W,sr.right-vr.left+12);
  let flap=null,fold=null,frame=0;
  if(kind==='book'){fold=part('pdf-turn-fold');flap=part('pdf-turn-flap');for(const e of[fold,flap]){e.style.top=y0+'px';e.style.height=sr.height+'px';stack.append(e)}}
  const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2,start=performance.now();
  const paint=t=>{const k=ease(next?t:1-t);if(kind!=='book'){sheet.style.transform=`translateX(${-D*k}px)`;return}const d=W*k,f=W-d,fl=Math.max(0,W-2*d),clip=`inset(0 ${d}px 0 0)`,show=d>1&&f>1?'1':'0';shell.style.clipPath=clip;shell.style.webkitClipPath=clip;flap.style.left=(x0+fl)+'px';flap.style.width=Math.max(0,f-fl)+'px';flap.style.opacity=show;fold.style.left=(x0+f)+'px';fold.style.width=Math.min(d,48)+'px';fold.style.opacity=show};
  const done=()=>{cancelAnimationFrame(frame);shell.style.clipPath='';shell.style.webkitClipPath='';sheet.style.transform='';flap?.remove();fold?.remove();finish();if(active===done)active=null};
  const step=now=>{const t=Math.min(1,(now-start)/dur);paint(t);if(t<1)frame=requestAnimationFrame(step);else done()};
  paint(0);frame=requestAnimationFrame(step);active=done
 }
 async function turn(dir){
  if(!on)return dir>0?baseNext():basePrev();
  if(!layout.pageCount)return;
  const from=layout.currentPage,to=layout.normalize(from+dir);if(to===from)return;
  if(performance.now()<busyUntil)return;
  active?.();
  const kind=reduced()?'none':style(),old=layout.views.get(from)?.host;
  if(kind==='none'||!old?.isConnected)return layout.goToPage(to);
  const next=dir>0;busyUntil=performance.now()+1500;
  // The page being left stays on screen while the target is drawn, so the reader never sees a blank page.
  old.classList.add(next?'turn-sheet':'turn-base');
  try{await layout.goToPage(to)}catch(e){clear(old);busyUntil=0;throw e}
  const neu=layout.views.get(to)?.host;
  if(!on||layout.currentPage!==to||!neu||!old.isConnected){clear(old,neu);busyUntil=0;return}
  if(!next)neu.classList.add('turn-sheet');
  const dur=kind==='book'?680:420;busyUntil=performance.now()+dur+40;
  animate(next?old:neu,next,kind,dur,()=>clear(old,neu))
 }
 // A swipe turns the page only when the page fits across the screen, or is already scrolled to that edge.
 function canTurn(dx){const max=viewport.scrollWidth-viewport.clientWidth;if(max<=1)return true;return dx<0?viewport.scrollLeft>=max-1:viewport.scrollLeft<=1}
 function sync(){if(!button)return;button.classList.toggle('active',on);button.setAttribute('aria-checked',String(on))}
 function set(v,persist=true){v=!!v;if(persist)store(v);if(v===on)return sync();on=v;active?.();for(const h of stack.querySelectorAll('.turn-sheet,.turn-base'))clear(h);zoom.mode=on?'fit-page':'fit-width';layout.setSingle(on,zoom.mode);zoomControls?.sync();sync()}
 function install(){
  layout.next=()=>turn(1);layout.prev=()=>turn(-1);
  button?.addEventListener('click',()=>{set(!on);const pop=document.getElementById('zoomPopover');if(pop)pop.hidden=true;document.getElementById('zoomMenuBtn')?.setAttribute('aria-expanded','false')});
  viewport.addEventListener('touchstart',e=>{touch=on&&e.touches.length===1&&!isEditing?.()?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null},{passive:true});
  // iOS Safari pans the page sideways on a horizontal swipe; cancel that so only the page turn runs.
  viewport.addEventListener('touchmove',e=>{if(!touch||!on||e.touches.length!==1){touch=null;return}const dx=e.touches[0].clientX-touch.x,dy=e.touches[0].clientY-touch.y;if(Math.abs(dx)>Math.abs(dy)&&canTurn(dx)&&e.cancelable)e.preventDefault()},{passive:false});
  viewport.addEventListener('touchend',e=>{const t=touch;touch=null;if(!t||!on||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-t.x,dy=e.changedTouches[0].clientY-t.y;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.35&&canTurn(dx))turn(dx<0?1:-1).catch(err=>console.error(err))},{passive:true});
  viewport.addEventListener('touchcancel',()=>{touch=null},{passive:true});
  document.addEventListener('keydown',e=>{if(!on||e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;const dir=e.key==='ArrowRight'||e.key==='PageDown'?1:e.key==='ArrowLeft'||e.key==='PageUp'?-1:0;if(!dir)return;e.preventDefault();turn(dir).catch(err=>console.error(err))});
  if(stored())set(true,false);else sync()
 }
 return Object.freeze({install,set,turn,get enabled(){return on}})
}
NS.PageTurn=Object.freeze({create});
})(globalThis);
