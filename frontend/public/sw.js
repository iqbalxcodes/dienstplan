// Service worker: Web Push + notification click. Must live at site root.
self.addEventListener("push", (event) => {
    let payload = { title: "Dienstplan", body: "You have a new notification." };
    try { payload = event.data.json(); } catch (err) { console.error("Push payload parse failed:", err); }
    event.waitUntil(self.registration.showNotification(payload.title, {
        body: payload.body, icon: "/favicon.ico", badge: "/favicon.ico", data: { url: payload.url || "/" }
    }));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || "/";
    event.waitUntil(clients.matchAll({ type: "window" }).then((list) => {
        for (const c of list) if (c.url.includes(targetUrl) && "focus" in c) return c.focus();
        if (clients.openWindow) return clients.openWindow(targetUrl);
    }));
});
