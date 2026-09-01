// ======================================================
// sw.js — Service Worker
// Handles push events even when no tab is open, and click
// events on the notification (focuses/opens the app).
// ======================================================

self.addEventListener("push", (event) => {

    let payload = { title: "Dienstplan", body: "You have a new notification." };

    try {
        payload = event.data.json();
    } catch(err) {
        console.error("Push payload parse failed:", err);
    }

    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: "favicon.ico",
            badge: "favicon.ico",
            data: { url: payload.url || "/" }
        })
    );

});

self.addEventListener("notificationclick", (event) => {

    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: "window" }).then((clientList) => {

            const targetUrl = event.notification.data?.url || "/";

            for(const client of clientList){
                if(client.url.includes(targetUrl) && "focus" in client){
                    return client.focus();
                }
            }

            if(clients.openWindow){
                return clients.openWindow(targetUrl);
            }

        })
    );

});