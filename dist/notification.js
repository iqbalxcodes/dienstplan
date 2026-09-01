// ======================================================
// notifications.ts
// In-browser shift reminders (Check In / Check Out) via the
// Notification API. Polls every 60s while any Dienstplan tab
// is open and the setting is enabled + permission granted.
//
// LIMITATION: this is NOT true push — it only fires while a
// tab is open. Real push (works with the app fully closed)
// needs a service worker + push subscription + a server that
// sends the push, none of which exists in this app yet.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership } from "./auth.js";
import { loadSettings } from "./settings.js";
const REMINDER_WINDOW_MINUTES = 15;
const CHECK_INTERVAL_MS = 60 * 1000;
const NOTIFIED_KEY_PREFIX = "dienstplan_notified_";
let checkerHandle;
export function isNotificationSupported() {
    return typeof Notification !== "undefined";
}
export async function requestNotificationPermission() {
    if (!isNotificationSupported())
        return "denied";
    return Notification.requestPermission();
}
export function startShiftReminders() {
    if (!isNotificationSupported())
        return;
    if (Notification.permission !== "granted")
        return;
    if (checkerHandle !== undefined)
        return;
    checkCurrentShift();
    checkerHandle = window.setInterval(checkCurrentShift, CHECK_INTERVAL_MS);
}
export function stopShiftReminders() {
    if (checkerHandle !== undefined) {
        window.clearInterval(checkerHandle);
        checkerHandle = undefined;
    }
}
function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function alreadyNotified(key) {
    return sessionStorage.getItem(NOTIFIED_KEY_PREFIX + key) === "1";
}
function markNotified(key) {
    sessionStorage.setItem(NOTIFIED_KEY_PREFIX + key, "1");
}
function combineDateTime(dateStr, timeStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [h, min] = timeStr.split(":").map(Number);
    return new Date(y, m - 1, d, h, min);
}
function fireNotification(title, body) {
    try {
        new Notification(title, { body, icon: "favicon.ico" });
    }
    catch (err) {
        console.error("Failed to show notification:", err);
    }
}
async function checkCurrentShift() {
    if (!loadSettings().notificationsEnabled)
        return;
    if (!currentOrg || !currentMembership)
        return;
    if (!isNotificationSupported() || Notification.permission !== "granted")
        return;
    const todayIso = formatDateISO(new Date());
    const { data, error } = await supabaseClient
        .from("shifts")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("membership_id", currentMembership.id)
        .eq("shift_date", todayIso);
    if (error || !data)
        return;
    const now = new Date();
    data.forEach(shift => {
        const start = combineDateTime(shift.shift_date, shift.start_time);
        const end = combineDateTime(shift.shift_date, shift.end_time);
        const minutesToStart = (start.getTime() - now.getTime()) / 60000;
        const minutesToEnd = (end.getTime() - now.getTime()) / 60000;
        if (minutesToStart > 0 && minutesToStart <= REMINDER_WINDOW_MINUTES) {
            const key = `${shift.id}_start`;
            if (!alreadyNotified(key)) {
                fireNotification("Upcoming shift", `Your shift starts in ${Math.round(minutesToStart)} min — don't forget to check in.`);
                markNotified(key);
            }
        }
        if (minutesToEnd > 0 && minutesToEnd <= REMINDER_WINDOW_MINUTES) {
            const key = `${shift.id}_end`;
            if (!alreadyNotified(key)) {
                fireNotification("Shift ending soon", `Your shift ends in ${Math.round(minutesToEnd)} min — don't forget to check out.`);
                markNotified(key);
            }
        }
    });
}
//# sourceMappingURL=notification.js.map