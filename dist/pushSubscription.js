// ======================================================
// pushSubscription.ts
// Registers the service worker and subscribes the browser
// to Web Push, storing the subscription in Supabase so the
// server-side cron job can send notifications even when no
// tab is open.
//
// REQUIRED SETUP (done once, outside this code):
//   1. Run: npx web-push generate-vapid-keys
//   2. Paste the PUBLIC key into VAPID_PUBLIC_KEY below.
//   3. Set the PRIVATE key as an env var on the Edge Function
//      (see supabase/functions/send-shift-reminders).
//   4. Deploy sw.js at the project root (same level as index.html).
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership } from "./auth.js";
// Replace with YOUR public key from `npx web-push generate-vapid-keys`
const VAPID_PUBLIC_KEY = "PBGOv09OGe_Wwgx9jPpqpt9015RDaOdubmqspWNsokMtiTREGOyPuXkL6UIrhFMEnCMbvYKWx7PEJ9dVC7ZBfodE";
export function isPushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window;
}
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        bytes[i] = rawData.charCodeAt(i);
    }
    return bytes.buffer;
}
export async function enablePushNotifications() {
    if (!isPushSupported())
        return false;
    if (!currentOrg || !currentMembership)
        return false;
    const permission = await Notification.requestPermission();
    if (permission !== "granted")
        return false;
    try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }
        const json = subscription.toJSON();
        const { error } = await supabaseClient
            .from("push_subscriptions")
            .upsert({
            membership_id: currentMembership.id,
            organization_id: currentOrg.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth
        }, { onConflict: "endpoint" });
        if (error) {
            console.error("Failed to store push subscription:", error);
            return false;
        }
        return true;
    }
    catch (err) {
        console.error("Push subscription failed:", err);
        return false;
    }
}
export async function disablePushNotifications() {
    if (!isPushSupported())
        return;
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            await supabaseClient.from("push_subscriptions").delete().eq("endpoint", endpoint);
        }
    }
    catch (err) {
        console.error("Failed to disable push:", err);
    }
}
//# sourceMappingURL=pushSubscription.js.map