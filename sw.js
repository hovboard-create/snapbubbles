const CACHE = 'snapbubbles-v18';
const ASSETS = [
  './',
  './index.html',
  './how-to-play.html',
  './articles.html',
  './why-popping-bubble-wrap-relieves-stress.html',
  './history-of-bubble-wrap.html',
  './bubble-wrap-for-adhd-anxiety.html',
  './bubble-wrap-appreciation-day.html',
  './best-stress-relief-games-for-work.html',
  './bubble-wrap-for-kids-safety.html',
  './bubble-wrap-vs-fidget-toys.html',
  './why-bubble-wrap-makes-pop-sound.html',
  './bubble-wrap-stimming.html',
  './asmr-and-bubble-wrap.html',
  './style.css',
  './game.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/og-image.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests (HTML pages): network-first.
  // This avoids the "response served by service worker has redirections" error
  // that fires when an old cache held a redirected response (e.g. www -> apex).
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).then((res) => {
        // Only cache non-redirected, successful, same-origin responses
        if (res && res.ok && !res.redirected && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() =>
        caches.match(req).then((m) => m || caches.match('./index.html'))
      )
    );
    return;
  }

  // Static assets (CSS, JS, images): cache-first with background revalidation.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((res) => {
          if (res && res.ok && !res.redirected) {
            caches.open(CACHE).then((c) => c.put(req, res));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      });
    })
  );
});
