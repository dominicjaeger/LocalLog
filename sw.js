// LocalLog service worker: keeps the app files for offline use.
// IMPORTANT: VERSION must match APP_VERSION in js/version.js. Bump both together; a new
// version changes this file, which makes the browser install the new worker and fresh files.
const VERSION = '0.3.0';
const CACHE_NAME = 'locallog-' + VERSION;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/pip.css',
  './js/app.js',
  './js/version.js',
  './js/i18n.js',
  './js/state.js',
  './js/storage.js',
  './js/backup.js',
  './js/timer.js',
  './js/ambient.js',
  './js/core/time.js',
  './js/core/rounding.js',
  './js/core/format.js',
  './js/core/csv.js',
  './js/core/export.js',
  './js/core/backup.js',
  './js/core/validate.js',
  './js/core/report.js',
  './js/core/adjacent.js',
  './js/ui/dom.js',
  './js/ui/picker.js',
  './js/ui/entries.js',
  './js/ui/entry-editor.js',
  './js/ui/boundary-dialog.js',
  './js/ui/export.js',
  './js/ui/day.js',
  './js/ui/weekly.js',
  './js/ui/catalog.js',
  './js/ui/status.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // 'reload' bypasses the browser's HTTP cache so that a new version never caches old files.
      .then((cache) => cache.addAll(ASSETS_TO_CACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
