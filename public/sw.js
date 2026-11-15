// LifeOS service worker: does not cache anything (a cached page could be an old build). Clears caches left by older builds.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', () => {});
