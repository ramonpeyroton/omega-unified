/* Omega service worker — Web Push.
 * Kept intentionally tiny: it only handles push delivery and clicks.
 * No offline caching (the app needs the network anyway). */

self.addEventListener('install', () => {
  // Activate immediately so a new SW version takes over on next load.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Omega', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Omega';
  const options = {
    body: data.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.tag || undefined,        // collapses duplicates with the same tag
    renotify: !!data.tag,
    data: { url: data.url || '/' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing window if the app is already open.
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url).catch(() => {});
          return;
        }
      }
      // Otherwise open a new window.
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
