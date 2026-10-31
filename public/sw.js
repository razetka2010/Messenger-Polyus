self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Полюс", body: event.data?.text() || "" };
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || "Полюс", {
      body: payload.body || "",
      icon: "/logo.svg",
      badge: "/logo.svg",
      tag: payload.conversationId || "polus-message",
      data: { conversationId: payload.conversationId || "" }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId || "";
  const target = new URL("/", self.location.origin);
  if (conversationId) target.searchParams.set("conversation", conversationId);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
