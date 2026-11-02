// Service worker for the private budget PWA.
// Caches only the app shell (page, script, styles, icons) so the app opens instantly and shows a
// friendly offline screen. Budget data (/api/) is NEVER cached: it stays on the server, behind sign-in.
const CACHE = "budget-shell-v1";
const SHELL = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return; // network only
  // Network first so updates appear straight away; the cached copy is only an offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request.mode === "navigate" ? "index.html" : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request.mode === "navigate" ? "index.html" : e.request, { ignoreSearch: true })),
  );
});
