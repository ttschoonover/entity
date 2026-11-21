// sw-basic.js · the fallback service worker, for browsers that cannot run a
// module service worker (interface/sw.js). It cannot open a sealed notice, so
// it shows only that there is something new; the page opens the notice.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Something new', { body: 'Open the page to see it.', data: { url: '#/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
    for (const c of open) if (new URL(c.url).origin === new URL(target).origin) return c.focus();
    return self.clients.openWindow(target);
  }));
});
