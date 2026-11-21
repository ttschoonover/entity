// sw.js · the service worker: shows a member's notices when they arrive by push.
//
// A push payload is { v: 1, n: notice }, the notice sealed to the member's
// record key (kernel/notice.js). The browser has already removed the push
// layer (RFC 8291). Here the notice is opened with the member's record key,
// derived on this device from their key in IndexedDB (interface/js/keystore.js).
// When the key is locked with a password, held by a passkey, or not here, the
// notice cannot be opened: the device shows only "Something new", and the page
// opens it once the member is signed in.

import { openNotice } from './kernel/notice.js';
import { recordKeyFromSeed } from './kernel/sealing.js';
import { loadIdentity } from './interface/js/keystore.js';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// What a push shows: { title, options }.
async function render(data) {
  let n = null;
  try {
    const ident = data?.n ? await loadIdentity(data.n.entity) : null;
    if (ident?.seed && ident.id === data.n.to) n = await openNotice(data.n, (await recordKeyFromSeed(ident.seed)).sk);
  } catch { n = null; }
  const title = n ? (n.from && !n.generic ? `${n.from}: ${n.title}` : n.title) : 'Something new';
  const body = n ? (n.text || '') : 'Open the page to see it.';
  return { title, options: { body, tag: n?.seq ? `seq-${n.seq}` : undefined, data: { url: n?.url || '#/' } } };
}
async function show(data) { const { title, options } = await render(data); return self.registration.showNotification(title, options); }

self.addEventListener('push', (event) => {
  let data = null; try { data = event.data ? event.data.json() : null; } catch { data = null; }
  event.waitUntil(show(data));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/', self.registration.scope).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) if (new URL(c.url).origin === new URL(target).origin) { await c.focus(); return c.navigate ? c.navigate(target) : null; }
    return self.clients.openWindow(target);
  })());
});

// For tests: what a push payload would show, answered on the message's port
// (headless browsers refuse to display notifications at all).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'entity-notify-test') event.waitUntil(render(event.data.payload).then((r) => event.ports[0]?.postMessage(r)));
});
