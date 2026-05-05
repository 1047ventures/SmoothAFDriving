// Smooth AF — tiny service worker.
// Network-first for app shell so updates land immediately when online.
// Cache-first fallback for offline + opportunistic CDN caching.

const CACHE = 'smoothaf-v40';
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

function isShellRequest(url){
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return p === '/' || p.endsWith('/') || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.json') || p.endsWith('.css');
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // Network-first for our own app shell — always grab the latest when online.
  if (isShellRequest(url)){
    ev.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for everything else (tiles, leaflet CDN, images).
  ev.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        try {
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
