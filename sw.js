// Hosted builds use network-versioned assets. This worker retires
// older offline installations without touching localStorage or IndexedDB data.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("brandmaster-")).map((key) => caches.delete(key)))),
    self.registration.unregister(),
  ]).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then((clients) => Promise.all(clients.map((client) => {
    const url = new URL(client.url);
    url.searchParams.set("ui_refresh", Date.now().toString());
    return client.navigate(url.toString());
  }))));
});
