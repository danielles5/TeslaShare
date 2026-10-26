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

// Push handling is additive; the existing shell cache and fetch behavior above
// remain unchanged. Clicks always use this installation's GitHub Pages scope.
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || payload.title !== "TeslaTrack" || typeof payload.body !== "string") return;
    const driveId = typeof payload.driveId === "string" && /^[0-9a-f-]{36}$/i.test(payload.driveId) ? payload.driveId : null;
    const tag = driveId ? `teslatrack-drive-${driveId}` : "teslatrack-test";
    if (driveId && (await self.registration.getNotifications({ tag })).length) return;
    await self.registration.showNotification("TeslaTrack", {
      body: payload.body,
      icon: new URL("teslasharelogo.png", self.registration.scope).href,
      tag,
      renotify: false,
      data: { driveId },
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    // Navigating the existing app opens its normal Home/active-drive interface.
    // Never accept an arbitrary URL from a notification payload.
    const target = new URL(self.registration.scope);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin === target.origin && current.pathname.startsWith(target.pathname)) {
        const navigated = await client.navigate(target.href);
        if (navigated) { await navigated.focus(); return; }
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
