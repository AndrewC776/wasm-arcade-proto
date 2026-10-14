// Package cache: content-addressed package files (packages/<name>/<version>/...) are
// served cache-first. Everything else goes to the network so engine/UI updates land.
const CACHE = 'arcade-packages-v1'; // must match PACKAGE_CACHE in web/loader.js

const isPackageUrl = (url) => url.origin === self.location.origin && url.pathname.includes('/packages/');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && isPackageUrl(url)) event.respondWith(cacheFirst(event.request));
});

// Warm prefetch: download listed URLs into the cache one at a time, skipping hits.
async function warm(urls, client) {
  const cache = await caches.open(CACHE);
  let done = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      if (!(await cache.match(url))) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await cache.put(url, res);
      }
      done += 1;
    } catch {
      failed += 1;
    }
    client?.postMessage({ type: 'warm-progress', done, failed, total: urls.length });
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm') return;
  event.waitUntil(warm(event.data.urls ?? [], event.source));
});
