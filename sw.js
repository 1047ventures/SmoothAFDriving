// Smooth AF — tiny service worker.
// App-shell cache so the PWA opens offline once installed.

const CACHE = 'smoothaf-v20';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  ev.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        // Cache CDN tiles + leaflet images opportunistically
        try {
          const url = new URL(req.url);
          if (url.hostname.endsWith('cartocdn.com') || url.hostname.endsWith('unpkg.com')){
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
        } catch {}
        return res;
      }).catch(() => hit);
    })
  );
});
