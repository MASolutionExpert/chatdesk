// NOTE: the literal CACHE_VERSION below is rewritten at build time by the
// `chatdesk-sw-cache-version` plugin in vite.config.js (dist/sw.js only — the
// dev server keeps serving this fallback so `vite dev` still works). A unique
// value per build makes CACHE_NAME unique per deploy, so the activate handler
// below actually prunes the hashed /assets/* bundles of previous deploys
// instead of accumulating them forever under one static cache name.
const CACHE_VERSION = "1.1.0";
const CACHE_NAME = `chatdesk-${CACHE_VERSION}`;
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icons/icon-192.png?v=chatdesk",
  "/icons/icon-512.png?v=chatdesk",
];

const isCacheableAssetPath = (pathname) => {
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.startsWith("/icons/")) return true;
  return (
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  );
};

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => null),
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("chatdesk-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Signature of the last successfully cached index.html (etag or
// last-modified). APP_SHELL_UPDATED is only posted when this changes, so the
// in-app "updating" flash no longer appears on every navigation — only after
// an actual deploy. null means "nothing cached yet in this SW lifetime": the
// very first navigation after install/activate must not post.
let lastIndexSignature = null;
const getIndexSignature = (response) =>
  response?.headers?.get("etag") || response?.headers?.get("last-modified") || null;

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js") return;
  const isNavigation = event.request.mode === "navigate";
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      if (isNavigation) {
        const network = await fetch(event.request, { cache: "no-store" })
          .then((response) => {
            if (response && response.ok && response.status === 200) {
              // The navigation response is what keeps the offline shell
              // correct, so the put is awaited via waitUntil (and must never
              // produce an unhandled rejection — e.g. put rejecting on a
              // 206/vary response).
              event.waitUntil(
                cache.put("/index.html", response.clone()).catch(() => null),
              );
              // Only announce the new shell when index.html actually changed.
              const signature = getIndexSignature(response);
              if (
                signature &&
                lastIndexSignature !== null &&
                signature !== lastIndexSignature
              ) {
                self.clients
                  .matchAll({ type: "window", includeUncontrolled: true })
                  .then((clientsArr) => {
                    clientsArr.forEach((client) =>
                      client.postMessage({ type: "APP_SHELL_UPDATED" }),
                    );
                  })
                  .catch(() => null);
              }
              if (signature) lastIndexSignature = signature;
            }
            return response;
          })
          .catch(() => null);
        if (network) return network;
        const cachedIndex = await cache.match("/index.html");
        return cachedIndex || Response.error();
      }

      if (!isCacheableAssetPath(url.pathname)) {
        return fetch(event.request).catch(() => Response.error());
      }

      const cached = await cache.match(event.request);
      const revalidate = fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.status === 200) {
            // Catch is essential: cache.put rejects for opaque/206/vary-*
            // responses and an unhandled rejection would crash the worker.
            cache.put(event.request, response.clone()).catch(() => null);
          }
          return response;
        })
        .catch(() => null);
      event.waitUntil(revalidate);
      if (cached) return cached;
      const network = await revalidate;
      return network || cached || Response.error();
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "ChatDesk", body: event.data?.text?.() || "" };
  }
  const data = payload.data || {};

  // Call pushes are handled before the generic message path. The dismiss
  // branch must always run — even when a window is focused. The incoming
  // branch suppresses display when a window is focused: the realtime
  // call:incoming ring covers focused windows (same trade-off as messages).
  if (data.callPush === "incoming" || data.callPush === "dismiss") {
    const callTag = `call-${data.chatId || "unknown"}`;
    event.waitUntil(
      (async () => {
        if (data.callPush === "dismiss") {
          try {
            const existing = await self.registration.getNotifications({
              tag: callTag,
            });
            existing.forEach((notification) => notification.close());
          } catch {
            // a dismiss that cannot run must not throw
          }
          return;
        }
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const appFocused = clients.some((client) =>
          "focused" in client
            ? Boolean(client.focused)
            : false,
        );
        if (appFocused) {
          // A focused ChatDesk window rings in-app via realtime.
          return;
        }
        await self.registration.showNotification(payload.title || "ChatDesk", {
          body: payload.body || "",
          data,
          tag: callTag,
          renotify: true,
          requireInteraction: true,
          badge: "/icons/icon-192.png?v=chatdesk",
          icon: "/icons/icon-192.png?v=chatdesk",
        });
      })(),
    );
    return;
  }

  const title = payload.title || "ChatDesk";
  const body = payload.body || "New message";
  const badgeCount = Number(payload.badge || 0);
  const tag = data.chatId ? `chat-${data.chatId}` : "chatdesk";
  const options = {
    body,
    data,
    tag,
    renotify: true,
    badge: "/icons/icon-192.png?v=chatdesk",
    icon: "/icons/icon-192.png?v=chatdesk",
  };
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const appFocused = clients.some((client) =>
        "focused" in client
          ? Boolean(client.focused)
          : false,
      );
      if (appFocused) {
        // A focused ChatDesk window handles unread state in-app.
        return;
      }
      try {
        if (badgeCount > 0 && navigator?.setAppBadge) {
          navigator.setAppBadge(badgeCount).catch(() => null);
        }
      } catch {
        // ignore badge errors; must not affect notification delivery
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        const existing = clientsArr.find((client) =>
          client.url.includes(self.location.origin),
        );
        if (existing) {
          existing.focus();
          existing.navigate(target);
          return;
        }
        self.clients.openWindow(target);
      }),
  );
});
