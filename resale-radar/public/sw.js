// Resale Radar service worker: push notifications and an offline fallback. App data is never cached.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response("<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:system-ui;background:#16171c;color:#eee;padding:24px'><h1>Offline</h1><p>Resale Radar needs a connection to load live deal data.</p></body>", { headers: { "Content-Type": "text/html" } }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Resale Radar", body: "", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if (c.url === url && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
