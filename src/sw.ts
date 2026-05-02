/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  threadId?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let payload: PushPayload = {};
  try {
    payload = event.data.json() as PushPayload;
  } catch {
    payload = { title: "New email", body: event.data.text() };
  }
  const title = payload.title ?? "New email";
  const body = payload.body ?? "";
  const openUrl = payload.url ?? "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      tag: payload.threadId ? `thread-${payload.threadId}` : "new-email",
      renotify: true,
      data: { url: openUrl },
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  const targetUrl = new URL(url, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        const w = c as WindowClient;
        if (w.url.startsWith(self.location.origin)) {
          await w.focus();
          if (typeof w.navigate === "function") {
            await w.navigate(targetUrl);
            return;
          }
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
