// Tecnofra Lab service worker — gestisce solo le push notifications.
// NON intercetta navigazioni / fetch (per non rompere l'app in iframe / preview).

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    data = { title: "Tecnofra Lab", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Tecnofra Lab";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "tecnofra",
    data: { url: data.url || "/" },
    requireInteraction: !!data.urgent,
    vibrate: data.urgent ? [200, 100, 200] : [100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      try { await c.focus(); c.postMessage({ type: "navigate", url }); return; } catch (_) {}
    }
    await self.clients.openWindow(url);
  })());
});