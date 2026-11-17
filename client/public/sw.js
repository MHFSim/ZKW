// Einfacher Service Worker: Seite zuerst aus dem Netz (immer aktuell), sonst aus dem Speicher.
// Dateien mit Hash im Namen (assets/) kommen zuerst aus dem Speicher – schneller Start.
const CACHE = 'undead-week-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const hashed = /\/assets\//.test(req.url);
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (hashed) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
