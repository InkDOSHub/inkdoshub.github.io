// InkDOS-tools: keep the Python terminal on this device (scope: python/). build.py writes the build version and the
// file lists. Install stores the terminal (Pyodide, its standard library, the InkDOS bar and skins) and then every
// bundled package (numpy, pandas, ...), so the terminal and `import` work with no network; a package that could not be
// stored then is stored the first time it is loaded. Pages ask the network first (so a new build reaches them) and
// fall back to the stored copy; every other file comes from the stored copy. A new build replaces the old copy.
'use strict';
const VERSION = '__VERSION__';
const CACHE = 'inkdos-python-' + VERSION;
const CORE = __CORE__;
const PACKAGES = __PACKAGES__;
const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(scoped)); // the terminal itself must be complete
    for (const file of PACKAGES) { // packages: best effort, one at a time (memory on iPad)
      try { await cache.add(scoped(file)); } catch (_) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('inkdos-python-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return; // the page also loads the shared skins
  if (request.mode === 'navigate') {
    if (!url.href.startsWith(self.registration.scope)) return;
    event.respondWith((async () => {
      const page = new URL(url.pathname, url.origin).href; // stored without the query (?inkdos-theme=)
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put(page, response.clone());
        return response;
      } catch (error) {
        const stored = await caches.match(page, { cacheName: CACHE });
        if (stored) return stored;
        throw error;
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = await cache.match(request, { ignoreSearch: true });
    if (stored) return stored;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  })());
});
