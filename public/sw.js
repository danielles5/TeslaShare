// Network-first navigation. Cache only this origin's static shell, never API/auth data.
const PREFIX = `tesla-share:${new URL(self.registration.scope).pathname}:`;
const CACHE = PREFIX + "v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.includes("/auth/")
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (
          response.ok &&
          (request.mode === "navigate" ||
            url.pathname.includes("/_next/static/") ||
            /\.(png|svg|woff2)$/.test(url.pathname))
        )
          await cache.put(request, response.clone());
        return response;
      } catch {
        const saved = await cache.match(request);
        return (
          saved ||
          new Response(
            "You are offline. Reconnect to open Tesla Share. No changes have been saved.",
            { status: 503, headers: { "Content-Type": "text/plain" } },
          )
        );
      }
    })(),
  );
});
