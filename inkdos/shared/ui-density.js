(function(root){'use strict';
// Interface density: always the desktop density (owner, 2026-10-10). The density choice (Auto/Desktop/phone) and the mobile
// layout were removed; data-ui-density="desktop" stays on <html> for the stylesheets keyed on it, and the API stays
// (set/resolve/apply always answer 'desktop'). This file also registers the offline worker for a workspace page and
// loads the shared settings (localization) there.
const SUITE_STORAGE_KEY='inkdos2:ui-density',ATTR='data-ui-density',PREF_ATTR='data-ui-density-preference',DENSITY='desktop',APPS=new Set(['documents','spreadsheets','presentations','pdf','epub','txt']);
const doc=typeof document!=='undefined'?document:null;
function workspaceContext(){let parts=[];try{parts=decodeURIComponent(root.location?.pathname||'').split('/').filter(Boolean)}catch(_){}return parts.find(part=>APPS.has(part))||null}
const WORKSPACE=workspaceContext(),STORAGE_KEY=WORKSPACE?'inkdos2:'+WORKSPACE+':ui-density':SUITE_STORAGE_KEY;
function resolve(){return DENSITY}
function apply(){const element=doc?.documentElement;if(element){element.setAttribute(ATTR,DENSITY);element.setAttribute(PREF_ATTR,DENSITY)}return DENSITY}
function set(){return apply()}
function sharedBase(){if(!doc)return'';const src=doc.currentScript?.src||'';return src?src.slice(0,src.lastIndexOf('/')+1):''}
const SHARED_BASE=sharedBase();
/* InkDOS Hub: sem o service-worker.js do InkDOS (a cópia offline é a do Hub, sw-portal.js); o registro dava 404 em toda abertura */
function ensureStyle(href,id){if(!doc||!href||doc.getElementById(id))return;const link=doc.createElement('link');link.id=id;link.rel='stylesheet';link.href=href;(doc.head||doc.documentElement).appendChild(link)}
function ensureScript(src,id){if(!doc||!src)return Promise.resolve(null);const existing=doc.getElementById(id);if(existing){if(existing.dataset.loaded==='true')return Promise.resolve(existing);return new Promise((resolve,reject)=>{existing.addEventListener('load',()=>resolve(existing),{once:true});existing.addEventListener('error',reject,{once:true})})}return new Promise((resolve,reject)=>{const script=doc.createElement('script');script.id=id;script.src=src;script.async=false;script.addEventListener('load',()=>{script.dataset.loaded='true';resolve(script)},{once:true});script.addEventListener('error',reject,{once:true});(doc.head||doc.documentElement).appendChild(script)})}
function bootstrapWorkspaceSettings(){if(!doc||!WORKSPACE||!SHARED_BASE)return;ensureStyle(SHARED_BASE+'localization/localization.css','inkdosLocalizationStyles');ensureScript(SHARED_BASE+'localization/ui-localization.js','inkdosLocalizationRuntime').catch(()=>{});ensureScript(SHARED_BASE+'localization/settings-strip.js','inkdosSettingsStripRuntime').catch(()=>{})}
if(doc?.documentElement)apply();
if(doc){bootstrapWorkspaceSettings()}
root.InkDOSUiDensity=Object.freeze({STORAGE_KEY,SUITE_STORAGE_KEY,resolve,apply,set,get workspace(){return WORKSPACE},get preference(){return DENSITY},get effective(){return DENSITY}});
})(globalThis);
