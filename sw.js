// 离线缓存 + 点击通知回到应用
const CACHE = 'time-ledger-v5';
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'db.js', 'parser.js', 'voice.js',
  'ui.js', 'sheet.js', 'views.js', 'settings.js', 'analytics.js', 'ai.js', 'receipt.js', 'accounts.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// 先用缓存秒开，同时后台拉新版本
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.notification.data?.action || 'record';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      wins[0].postMessage({ type: 'nudge-action', action });
      return wins[0].focus();
    }
    return self.clients.openWindow('./?action=' + action);
  })());
});
