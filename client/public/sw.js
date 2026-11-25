const CACHE_VERSION = 'foldergram-v5';
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const APP_SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  if (IS_LOCALHOST) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (IS_LOCALHOST) {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/thumbnails/') ||
    url.pathname.startsWith('/previews/') ||
    url.pathname.startsWith('/originals/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    event.request.headers.has('range')
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        return cache.match('/') || Response.error();
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      const response = await fetch(event.request);

      if (
        !response.ok ||
        response.type === 'opaque' ||
        response.status === 206 ||
        response.headers.has('content-range') ||
        response.headers.get('cache-control')?.includes('no-store')
      ) {
        return response;
      }

      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(event.request, response.clone());
      return response;
    })
  );
});

const PUSH_TEXT = {
  en: ['Family gallery', 'New photographs are ready to view.'],
  de: ['Familiengalerie', 'Neue Fotos sind verfügbar.'],
  es: ['Galería familiar', 'Hay fotos nuevas disponibles.'],
  zh: ['家庭图库', '新照片已发布。']
};
self.addEventListener('push', (event) => {
  // Only our fixed generic alert is permitted. Never render arbitrary payload
  // content, remote images or navigation URLs on a lock screen.
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (payload?.kind !== 'new-photos') return;
  const lang = (self.navigator.language || 'en').split('-')[0];
  const [title, body] = PUSH_TEXT[lang] || PUSH_TEXT.en;
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/icon-192.png', tag: 'foldergram-new-photos',
    renotify: false, data: { kind: 'new-photos' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  if (event.notification.data?.kind !== 'new-photos') return;
  event.notification.close();
  event.waitUntil((async () => {
    const root = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing = windows.find(client=>new URL(client.url).origin===self.location.origin);
    if (existing) {
      await existing.navigate(root);
      await existing.focus();
    } else {
      await self.clients.openWindow(root);
    }
  })());
});