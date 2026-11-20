// Web Push: registers /sw.js and stores the subscription in Supabase so the
// server-side cron (Edge Function) can notify even when no tab is open.
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

export const isPushSupported = () => "serviceWorker" in navigator && "PushManager" in window;

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const b64 = (base64 + "=".repeat((4 - base64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function enablePush(orgId: string, membershipId: string): Promise<boolean> {

    if (!isPushSupported()) return false;
    if (await Notification.requestPermission() !== "granted") return false;

    try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const sub = (await reg.pushManager.getSubscription())
            ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });

        const json = sub.toJSON();

        const { error } = await supabase.from("push_subscriptions").upsert({
            membership_id: membershipId,
            organization_id: orgId,
            endpoint: json.endpoint!,
            p256dh: json.keys!.p256dh,
            auth: json.keys!.auth
        }, { onConflict: "endpoint" });

        if (error) { console.error("Failed to store push subscription:", error); return false; }
        return true;
    } catch (err) {
        console.error("Push subscription failed:", err);
        return false;
    }
}

export async function disablePush(): Promise<void> {

    if (!isPushSupported()) return;

    try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (sub) {
            const endpoint = sub.endpoint;
            await sub.unsubscribe();
            await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
        }
    } catch (err) {
        console.error("Failed to disable push:", err);
    }
}
