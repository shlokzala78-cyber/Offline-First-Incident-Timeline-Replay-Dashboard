const PREFIX = 'traceback-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE = PREFIX + 'v1';
const ASSETS = [
  './', './index.html', './app.css', './manifest.webmanifest', './icons/icon.svg',
  './js/app.js', './js/core.js', './js/db.js', './js/history.js',
  './js/view-state.js', './js/processor.js', './js/processor.worker.js',
  './js/components.js', './js/virtual-list.js', './data/sample-incident.json'
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  // An incomplete download must not replace a working offline shell.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const shell = await cache.match(new URL('./index.html', self.registration.scope).href);
      return shell || fetch(request);
    })());
  } else if (ASSETS.includes(url.origin + url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
    })());
  }
});
