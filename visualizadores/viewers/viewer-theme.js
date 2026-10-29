// Shared by the InkDOS-tools viewers: follow the InkDOS appearance (light / dark / system; InkDOS is
// another origin and passes it as ?inkdos-theme=) and mark embedded use (?embed=1), where an InkDOS
// workspace supplies the surrounding chrome.
(function () {
  'use strict';
  var root = document.documentElement, mode = 'system';
  // InkDOS is another origin and passes its appearance as ?inkdos-theme=; it is kept for later pages
  var given = /[?&]inkdos-theme=(light|dark|system)\b/.exec(location.search);
  try { if (given) localStorage.setItem('inkdos2:appearance', given[1]); } catch (_) {}
  try { mode = localStorage.getItem('inkdos2:appearance') || 'system'; } catch (_) {}
  if (given) mode = given[1];
  if (!/^(light|dark|system)$/.test(mode)) mode = 'system';
  var dark = mode === 'dark' || (mode === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  if (/[?&]embed=1\b/.test(location.search)) root.dataset.embed = '1';
})();
