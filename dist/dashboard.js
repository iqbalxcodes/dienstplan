// ======================================================
// dashboard.ts — mobile-first attendance card:
// shift strip, live map, check-in/out with timer.
// Reads admin-configurable values (check-in radius, strict
// mode, staff role labels) from organizations.settings.
// Location tracking uses navigator.geolocation.watchPosition.
// Map behavior: BOTH pins (user + workplace) are always
// visible — the map auto-zooms in/out to frame them, no
// manual zoom controls.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership, authReady } from "./auth.js";
import { initPageHeader } from "./pageHeader.js";
// ======================================================
// Audit trail writer — inlined (not imported) so this
// module has zero external dependencies for logging.
// ======================================================
async function logActivity(action, summary, details = {}, entityType, entityId) {
    if (!currentOrg || !currentMembership) {
        console.warn("logActivity skipped \u2014 no active session context");
        return;
    }
    const { error } = await supabaseClient.from("activity_log").insert({
        organization_id: currentOrg.id,
        actor_membership_id: currentMembership.id,
        action,
        entity_type: entityType ?? null,
        entity_id: entityId ?? null,
        summary,
        details: {
            actor_role: currentMembership.role,
            ...details
        }
    });
    if (error) {
        console.error("activity_log insert failed:", error);
    }
}
// ======================================================
const DEFAULT_ROLES = ["Service crew", "Kitchen", "Bar", "Cashier", "Runner"];
let todayShift = null;
let upcomingShifts = [];
let openEntry = null;
let userPos = null;
let map = null;
let userMarker = null;
let workMarker = null;
let timerHandle;
let geoWatchId = null;
let lastFitPos = null;
function nearMeters() {
    return currentOrg?.settings?.checkin_radius_m ?? 150;
}
function strictMode() {
    return currentOrg?.settings?.checkin_strict ?? "warn";
}
function roleLabels() {
    return currentOrg?.settings?.role_labels ?? DEFAULT_ROLES;
}
document.addEventListener("DOMContentLoaded", async () => {
    const loggedIn = await authReady;
    initPageHeader();
    if (!loggedIn || !currentOrg || !currentMembership) {
        document.getElementById("shiftStrip").innerHTML = "";
        document.getElementById("myEntriesList").innerHTML = "";
        document.getElementById("attSub").textContent =
            "Log in to record your attendance.";
        return;
    }
    fillRoleSelect();
    initMap();
    setTimeout(() => map?.invalidateSize(), 200);
    window.addEventListener("resize", () => map?.invalidateSize());
    void refresh();
    document.getElementById("attBtn").addEventListener("click", onMainButton);
});
function fillRoleSelect() {
    const sel = document.getElementById("attRole");
    sel.innerHTML = "";
    roleLabels().forEach(r => {
        const o = document.createElement("option");
        o.value = r;
        o.textContent = r;
        sel.appendChild(o);
    });
}
async function refresh() {
    await Promise.all([loadUpcomingShifts(), loadOpenEntry()]);
    renderShiftStrip();
    renderAttendance();
}
async function loadUpcomingShifts() {
    const todayIso = formatDateISO(new Date());
    const endIso = formatDateISO(addDays(new Date(), 13));
    const { data } = await supabaseClient
        .from("shifts")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("membership_id", currentMembership.id)
        .gte("shift_date", todayIso)
        .lte("shift_date", endIso)
        .order("shift_date");
    upcomingShifts = (data ?? []);
    todayShift = upcomingShifts.find(s => s.shift_date === todayIso) ?? null;
}
async function loadOpenEntry() {
    const { data } = await supabaseClient
        .from("time_entries")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("membership_id", currentMembership.id)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle();
    openEntry = data ?? null;
}
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function renderShiftStrip() {
    const wrap = document.getElementById("shiftStrip");
    const todayIso = formatDateISO(new Date());
    if (upcomingShifts.length === 0) {
        wrap.innerHTML = `<p class="plan-entry-meta" style="padding:0 12px;">No shifts scheduled.</p>`;
        return;
    }
    wrap.innerHTML = upcomingShifts.map(s => `
        <div class="shift-mini ${s.shift_date === todayIso ? "is-today" : ""}">
            <div class="shift-mini-dow">${DOW[parseDateOnly(s.shift_date).getDay()]}</div>
            <div class="shift-mini-date">${s.shift_date.slice(8)} ${MONTH_ABBR[parseDateOnly(s.shift_date).getMonth()]}</div>
            <div class="shift-mini-role">${escapeHtml(s.role_label ?? roleLabels()[0])}</div>
            <div class="shift-mini-time">${s.start_time.slice(0, 5)}\u2013${s.end_time.slice(0, 5)}</div>
        </div>
    `).join("");
}
function initMap() {
    map = L.map("map", {
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    const wp = workplacePos();
    if (wp) {
        map.setView(wp, 15);
    }
    else {
        map.setView([-6.2, 106.816666], 13);
    }
    if (!navigator.geolocation) {
        document.getElementById("attSub").textContent =
            "Geolocation not supported \u2014 showing workplace.";
        drawWorkPinOnly();
        return;
    }
    geoWatchId = navigator.geolocation.watchPosition(onPositionUpdate, () => {
        document.getElementById("attSub").textContent =
            "Location permission denied \u2014 showing workplace only.";
        drawWorkPinOnly();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}
function onPositionUpdate(pos) {
    const isFirstFix = userPos === null;
    userPos = [pos.coords.latitude, pos.coords.longitude];
    updateUserPin();
    autoFitView(isFirstFix);
    renderAttendance();
}
function updateUserPin() {
    if (!userPos)
        return;
    if (!userMarker) {
        userMarker = L.circleMarker(userPos, {
            radius: 10, color: "#1565c0", fillOpacity: 0.8
        }).addTo(map).bindPopup("You are here");
    }
    else {
        userMarker.setLatLng(userPos);
    }
}
function autoFitView(force = false) {
    if (!userPos || !map)
        return;
    const wp = workplacePos();
    if (!wp) {
        updateUserPin();
        map.setView(userPos, 16, { animate: true });
        lastFitPos = null;
        return;
    }
    if (!workMarker) {
        workMarker = L.marker(wp).addTo(map).bindPopup("Workplace");
    }
    updateUserPin();
    const movedFar = force
        || !lastFitPos
        || haversineMeters(lastFitPos, userPos) > 50;
    if (movedFar) {
        map.fitBounds(L.latLngBounds([wp, userPos]).pad(0.4), { animate: true });
        lastFitPos = [userPos[0], userPos[1]];
    }
}
function drawWorkPinOnly() {
    const c = workplacePos();
    if (!c)
        return;
    workMarker = L.marker(c).addTo(map).bindPopup("Workplace");
    map.setView(c, 15);
}
function workplacePos() {
    const s = currentOrg?.settings;
    if (!s?.workplace_lat || !s?.workplace_lng)
        return null;
    return [s.workplace_lat, s.workplace_lng];
}
function renderAttendance() {
    const title = document.getElementById("attTitle");
    const sub = document.getElementById("attSub");
    const roleEl = document.getElementById("attRole");
    const hrsEl = document.getElementById("attHours");
    const btn = document.getElementById("attBtn");
    const checkedIn = openEntry !== null;
    if (todayShift) {
        title.textContent = checkedIn ? "Check Out" : "Check In";
        hrsEl.textContent = `${todayShift.start_time.slice(0, 5)}\u2013${todayShift.end_time.slice(0, 5)}`;
        roleEl.value = todayShift.role_label ?? "";
        if (roleEl.selectedIndex === -1)
            roleEl.selectedIndex = 0;
    }
    else {
        title.textContent = checkedIn ? "Extra Shift \u2014 Check Out" : "Working extra shift today?";
        hrsEl.textContent = "\u2014";
    }
    roleEl.disabled = checkedIn;
    const wp = workplacePos();
    const dist = (wp && userPos) ? Math.round(haversineMeters(userPos, wp)) : null;
    sub.textContent = checkedIn
        ? `Since ${new Date(openEntry.clock_in).toLocaleTimeString("de-DE")}`
        : (dist !== null
            ? (dist <= nearMeters()
                ? `At workplace (~${dist} m away)`
                : `Not at workplace (~${dist} m away)`)
            : "");
    btn.textContent = checkedIn ? "Check Out" : "Check In";
    btn.classList.toggle("checkout", checkedIn);
    startOrStopTimer();
}
function startOrStopTimer() {
    const el = document.getElementById("attTimer");
    if (timerHandle !== undefined) {
        clearInterval(timerHandle);
        timerHandle = undefined;
    }
    if (!openEntry) {
        el.textContent = "00:00:00";
        return;
    }
    const startedAt = Date.parse(openEntry.clock_in);
    const tick = () => {
        const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        el.textContent =
            String(Math.floor(sec / 3600)).padStart(2, "0") + ":" +
                String(Math.floor(sec % 3600 / 60)).padStart(2, "0") + ":" +
                String(sec % 60).padStart(2, "0");
    };
    tick();
    timerHandle = window.setInterval(tick, 1000);
}
async function onMainButton() {
    if (openEntry) {
        await doCheckOut();
    }
    else {
        await doCheckIn();
    }
}
async function doCheckIn() {
    const comment = document.getElementById("attComment").value.trim() || null;
    const roleSel = document.getElementById("attRole").value;
    const wp = workplacePos();
    const dist = (wp && userPos) ? haversineMeters(userPos, wp) : null;
    if (strictMode() === "enforce"
        && wp && dist !== null && dist > nearMeters()) {
        alert(`Check-in blocked \u2014 you are ~${Math.round(dist)} m from the workplace.`);
        return;
    }
    const now = new Date().toISOString();
    const { data: entry, error } = await supabaseClient
        .from("time_entries")
        .insert({
        organization_id: currentOrg.id,
        membership_id: currentMembership.id,
        shift_id: todayShift?.id ?? null,
        role_label: todayShift?.role_label ?? roleSel,
        clock_in: now,
        original_clock_in: now,
        source: "employee",
        status: "pending",
        employee_note: comment
    })
        .select("id")
        .single();
    if (error) {
        alert(error.message);
        return;
    }
    void logActivity("attendance.check_in", `Checked in${wp ? " at workplace" : ""}`, { workplace: currentOrg?.name, distance_m: dist ? Math.round(dist) : null }, "time_entry", entry.id);
    document.getElementById("attComment").value = "";
    await refresh();
}
async function doCheckOut() {
    const comment = document.getElementById("attComment").value.trim();
    const now = new Date().toISOString();
    const elapsed = openEntry?.clock_in
        ? formatElapsed(Date.now() - Date.parse(openEntry.clock_in))
        : "unknown duration";
    const { error } = await supabaseClient
        .from("time_entries")
        .update({
        clock_out: now,
        original_clock_out: now,
        status: "pending",
        employee_note: comment
            ? `${openEntry.employee_note ?? ""} ${comment}`.trim()
            : openEntry.employee_note
    })
        .eq("id", openEntry.id);
    if (error) {
        alert(error.message);
        return;
    }
    void logActivity("attendance.check_out", `Checked out after ${elapsed}`, { workplace: currentOrg?.name, elapsed });
    await refresh();
}
function formatElapsed(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const la1 = a[0] * Math.PI / 180, la2 = b[0] * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}
function parseDateOnly(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
}
function showGreeting() {
    const el = document.getElementById("orgNameLabel");
    if (!el || !currentMembership)
        return;
    const hour = new Date().getHours();
    let greeting;
    if (hour < 12)
        greeting = "Good Morning";
    else if (hour < 18)
        greeting = "Good Afternoon";
    else
        greeting = "Good Evening";
    const firstName = currentMembership.full_name.split(" ")[0];
    const orgName = currentOrg?.name ?? "Dienstplan";
    el.textContent = `${greeting}, ${firstName}!`;
    setTimeout(() => {
        el.textContent = `${orgName} \u2014 Dienstplan`;
    }, 3000);
}
function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s ?? "";
    return div.innerHTML;
}
//# sourceMappingURL=dashboard.js.map