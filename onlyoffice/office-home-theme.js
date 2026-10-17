// InkDOS Office: the InkDOS appearance before first paint (same key as the InkDOS workspaces on this site) and the
// matching editor theme; InkDOS passes ?inkdos-theme= and ?lang= when it links here.
(function () {
  'use strict';
  // This site is only the engine InkDOS calls (ONLYOFFICE, BentoPDF, the Offline tools panel framed by the InkDOS
  // Home with ?embed=1). Opened on its own, its Home sends the visitor to InkDOS.
  if (!/[?&]embed=1/.test(location.search) && /^\/(index\.html)?$/.test(location.pathname)) {
    // ?engine=light: an older InkDOS Home still cached on a device (with the Light/Full switch) would otherwise send
    // the visitor straight back here; that parameter makes it stay, so its update can install.
    // back to the InkDOS page that handed a document over as a separate page (site/inkdos-handoff.js), else Home
    var back = null;
    try { back = sessionStorage.getItem('inkdos-return'); } catch (_) {}
    location.replace(back && back.indexOf('https://vfydr2m9wk-ops.github.io/') === 0 ? back : 'https://vfydr2m9wk-ops.github.io/InkDOS/?engine=light');
    return;
  }
  var root = document.documentElement, params = new URLSearchParams(location.search), mode = 'system';
  function store(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  try { mode = localStorage.getItem('inkdos2:appearance') || 'system'; } catch (_) {}
  var given = params.get('inkdos-theme');
  if (/^(light|dark|system)$/.test(given || '')) { mode = given; store('inkdos2:appearance', mode); }
  if (!/^(light|dark|system)$/.test(mode)) mode = 'system';
  var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = root.dataset.appearance = root.dataset.appearanceResolved = dark ? 'dark' : 'light';
  root.dataset.appearanceMode = mode;
  root.style.colorScheme = dark ? 'dark' : 'light';
  // the ONLYOFFICE editors stay classic light whatever the InkDOS theme (owner, 2026-10-09)
  store('ran-theme', 'light');
  var lang = params.get('lang');
  if (lang) store('inkdos2:language', lang);
})();
