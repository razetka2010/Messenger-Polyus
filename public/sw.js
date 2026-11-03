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
      data: {
        conversationId: payload.conversationId || "",
        accountUserId: payload.accountUserId || ""
      }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId || "";
  const accountUserId = event.notification.data?.accountUserId || "";
  const target = new URL("/", self.location.origin);
  if (conversationId) target.searchParams.set("conversation", conversationId);
  if (accountUserId) target.searchParams.set("accountUserId", accountUserId);
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
