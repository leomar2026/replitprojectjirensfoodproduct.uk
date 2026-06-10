// Cache version — bump this string any time you need to force a full cache clear.
const CACHE = 'jirens-v3';

// Only pre-cache static image assets — never the HTML page itself.
const PRECACHE = [
  '/manifest.json',
  '/jirens-logo.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// On activate, delete ALL old caches (including jirens-v1 which cached the HTML).
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept non-GET or API requests.
  if (request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  // HTML requests (navigation) — always fetch fresh from network.
  // This ensures code changes are reflected immediately.
  if (request.mode === 'navigate' ||
      request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Static assets (images, fonts, etc.) — cache first, then network.
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
          caches.open(CACHE).then(c => c.put(request, response.clone()));
        }
        return response;
      });
    })
  );
});
