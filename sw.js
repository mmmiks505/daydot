// Daydot service worker: keeps a copy of the app so it opens with no internet,
// shows reminder notifications on phones, and opens the app when one is tapped.
const CACHE = "daydot-v1";
const APP_FILES = [
  "./", "index.html", "style.css", "app.js", "sync.js", "manifest.json",
  "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The app's own files: use the internet when it answers quickly (so updates arrive),
// otherwise the saved copy. Fonts and the Firebase library: saved copy first.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameSite = url.origin === location.origin;
  const library = /^(www\.gstatic\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (sameSite) e.respondWith(networkFirst(req));
  else if (library) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 4000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? cache.match("index.html") : Response.error());
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
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
