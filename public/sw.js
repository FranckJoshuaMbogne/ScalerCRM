/*
 * SCALER service worker.
 * - Offline: page navigations fall back to /offline, which shows the last copy
 *   of today's tasks saved from /api/tasks/today.
 * - Push: pushes carry no data (nothing personal goes through the push service);
 *   on a push the worker asks /api/notifications/latest what to show.
 * Signing out sends Clear-Site-Data, which removes this worker and its caches.
 */
const VERSION = "v1";
const SHELL = `scaler-shell-${VERSION}`;
const DATA = `scaler-data-${VERSION}`;
const OFFLINE_URL = "/offline";
const TASKS_URL = "/api/tasks/today";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === TASKS_URL) {
    // Network first; keep the last good copy for offline use. A 401 means signed out: forget it.
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          const cache = await caches.open(DATA);
          if (res.ok) await cache.put(TASKS_URL, res.clone());
          else if (res.status === 401) await cache.delete(TASKS_URL);
          return res;
        })
        .catch(async () => (await caches.match(TASKS_URL)) || Response.json({ tasks: [], offline: true }, { status: 503 })),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    // Content-hashed files never change: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then(async (res) => {
            if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    fetch("/api/notifications/latest", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((n) =>
        self.registration.showNotification(n?.title || "SCALER", {
          body: n?.body || "You have a new notification.",
          icon: "/icons/icon-192.png",
          badge: "/icons/badge-96.png",
          tag: n?.id ? `n-${n.id}` : "scaler",
          data: { url: n?.link || "/dashboard" },
        }),
      ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(target).then((w) => (w || open).focus());
      return self.clients.openWindow(target);
    }),
  );
});
