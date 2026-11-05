// LoopgramChannel service worker: offline shell + stale-while-revalidate for content API, assets and images.
const V = "lg-v4";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"])).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("lg-") && k !== V).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/~oauth")) return;
  if (e.request.mode === "navigate") {
    // Network-first for pages so deploys are never stuck; cached shell only when offline.
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put("/", c)); return r; }).catch(() => caches.match("/")));
    return;
  }
  const same = u.origin === location.origin;
  const cacheable = (same && u.pathname.startsWith("/assets/")) || u.hostname.endsWith("r2.dev");
  if (!cacheable) return;
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit || Response.error());
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
