(function(){'use strict';
// Full screen ("Tela cheia") for the InkDOS apps: hides the top and bottom chrome (title bar, toolbars, rulers,
// status bars, side panels) and leaves only the document. One X button stays in the top-right corner; it is
// invisible until the pointer passes over that corner, or a tap lands there. Esc also leaves full screen.
if(window.__inkTelaCheia)return;window.__inkTelaCheia=true;
const ICON_IN='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';
const ICON_X='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg>';
const CSS=`
html.ink-tc [data-ink-tc-oculto]{display:none!important}
html.ink-tc,html.ink-tc body{overflow:hidden}
html.ink-tc .ink-tc-conteudo{flex:1 1 auto!important;min-height:0!important;height:auto;max-height:none!important}
.ink-tc-entrar svg{width:20px;height:20px}
.ink-tc-zona{position:fixed;top:0;right:0;width:96px;height:96px;z-index:2147483000;display:none;
  padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);box-sizing:content-box;-webkit-tap-highlight-color:transparent}
html.ink-tc .ink-tc-zona{display:block}
.ink-tc-sair{position:absolute;top:calc(14px + env(safe-area-inset-top));right:calc(14px + env(safe-area-inset-right));
  width:44px;height:44px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;cursor:pointer;
  color:#fff;background:rgba(20,20,24,.72);box-shadow:0 4px 16px rgba(0,0,0,.28);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);opacity:0;transform:scale(.88);
  transition:opacity .18s ease,transform .18s ease;-webkit-tap-highlight-color:transparent}
.ink-tc-sair svg{width:20px;height:20px}
.ink-tc-zona.visivel .ink-tc-sair,.ink-tc-sair:focus-visible{opacity:1;transform:none}
@media (hover:hover){.ink-tc-zona:hover .ink-tc-sair{opacity:1;transform:none}}
`;
const t=(pt,en)=>((document.documentElement.lang||navigator.language||'').toLowerCase().startsWith('pt')?pt:en);
let ativo=false,ocultos=[],timer=0,zona=null,conteudo=null;

function acharConteudo(){
  return document.querySelector('#contentViewport')||document.querySelector('main#viewport')||
    document.querySelector('.content-viewport')||document.querySelector('main');
}
function sobreposicao(el){ // drawers, dialogs, popovers, backdrops: leave them alone
  const cs=getComputedStyle(el);return cs.position==='fixed'||el.tagName==='DIALOG';
}
function ocultarAoRedor(alvo){
  ocultos=[];
  for(let no=alvo;no&&no!==document.body;no=no.parentElement){
    const pai=no.parentElement;if(!pai)break;
    for(const irmao of pai.children){
      if(irmao===no||irmao===zona||/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(irmao.tagName))continue;
      if(irmao.hasAttribute('data-ink-tc-oculto')||sobreposicao(irmao))continue;
      if(getComputedStyle(irmao).display==='none')continue;
      irmao.setAttribute('data-ink-tc-oculto','');ocultos.push(irmao);
    }
  }
}
function mostrarX(ms){
  if(!zona)return;zona.classList.add('visivel');clearTimeout(timer);
  timer=setTimeout(()=>zona.classList.remove('visivel'),ms||2200);
}
function avisarLayout(){
  requestAnimationFrame(()=>{window.dispatchEvent(new Event('resize'));});
}
function entrar(){
  if(ativo)return;conteudo=acharConteudo();if(!conteudo)return;
  ativo=true;ocultarAoRedor(conteudo);conteudo.classList.add('ink-tc-conteudo');
  document.documentElement.classList.add('ink-tc');
  const de=document.documentElement,req=de.requestFullscreen||de.webkitRequestFullscreen;
  if(req){try{const p=req.call(de);if(p&&p.catch)p.catch(()=>{});}catch(e){}}
  mostrarX(2200);avisarLayout();
}
function sair(){
  if(!ativo)return;ativo=false;
  for(const el of ocultos)el.removeAttribute('data-ink-tc-oculto');ocultos=[];
  if(conteudo)conteudo.classList.remove('ink-tc-conteudo');
  document.documentElement.classList.remove('ink-tc');zona&&zona.classList.remove('visivel');
  const fe=document.fullscreenElement||document.webkitFullscreenElement;
  const ex=document.exitFullscreen||document.webkitExitFullscreen;
  if(fe&&ex){try{const p=ex.call(document);if(p&&p.catch)p.catch(()=>{});}catch(e){}}
  avisarLayout();
}
function montar(){
  if(!acharConteudo())return;
  const st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);
  // Enter button: next to the Home button, using the same button style as the app.
  const casa=document.querySelector('.inkdos-hub-link');
  const btn=document.createElement('button');btn.type='button';
  btn.className=((casa&&casa.className)||'menu-btn').replace('inkdos-hub-link','').trim()+' ink-tc-entrar';
  const rot=t('Tela cheia','Full screen');btn.title=rot;btn.setAttribute('aria-label',rot);btn.innerHTML=ICON_IN;
  btn.style.color='inherit';btn.addEventListener('click',entrar);
  const direita=document.querySelector('.frame-right');
  if(direita){direita.removeAttribute('aria-hidden');direita.appendChild(btn);}
  else{const barra=document.querySelector('header.framebar,header.topbar,header');if(!barra)return;btn.style.marginLeft='auto';barra.appendChild(btn);}
  // Exit zone: invisible corner; hover or tap reveals the X.
  zona=document.createElement('div');zona.className='ink-tc-zona';
  const x=document.createElement('button');x.type='button';x.className='ink-tc-sair';
  const rx=t('Sair da tela cheia','Exit full screen');x.title=rx;x.setAttribute('aria-label',rx);x.innerHTML=ICON_X;
  zona.appendChild(x);document.body.appendChild(zona);
  zona.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse')return;
    if(!zona.classList.contains('visivel')||e.target!==x&&!x.contains(e.target)){e.preventDefault();mostrarX(3000);x.dataset.armado='1';}
    else x.dataset.armado='';
  });
  zona.addEventListener('click',e=>{
    if(x.dataset.armado==='1'){x.dataset.armado='';return;}
    if(e.target===x||x.contains(e.target))sair();else mostrarX(3000);
  });
  zona.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')zona.classList.add('visivel');});
  zona.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){clearTimeout(timer);zona.classList.remove('visivel');}});
  document.addEventListener('keydown',e=>{if(ativo&&e.key==='Escape')sair();});
  const aoMudar=()=>{if(ativo&&!(document.fullscreenElement||document.webkitFullscreenElement))sair();};
  let tinhaFs=false;
  const fsMudou=()=>{const fs=!!(document.fullscreenElement||document.webkitFullscreenElement);if(tinhaFs&&!fs)aoMudar();tinhaFs=fs;};
  document.addEventListener('fullscreenchange',fsMudou);document.addEventListener('webkitfullscreenchange',fsMudou);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',montar);else montar();
window.InkTelaCheia={entrar,sair,ativo:()=>ativo};
})();
