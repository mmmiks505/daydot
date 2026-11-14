// Daydot service worker: lets the page show reminder notifications on phones,
// and opens the app when a notification is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow("./#todo");
  })());
});

// A reminder sent by the online reminder sender while Daydot is closed.
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "Daydot reminder", {
    body: data.body || "",
    tag: data.tag,
    icon: "icon.svg",
    badge: "icon.svg",
  }));
});
