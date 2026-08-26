// ======================================================
// dashboard.ts — mobile-first attendance card:
// shift strip, live map, check-in/out with timer.
// Reads admin-configurable values (check-in radius, strict
// mode, staff role labels) from organizations.settings.
// Location tracking uses navigator.geolocation.watchPosition:
// the map auto-pans / auto-zooms to keep the user's pin in
// view — no manual zoom controls.
// ======================================================

import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership, authReady } from "./auth.js";
import type { Shift, TimeEntry } from "./types.js";

declare const L: any;

// fallback only — the real list comes from Admin Settings
const DEFAULT_ROLES = ["Service crew", "Kitchen", "Bar", "Cashier", "Runner"];

let todayShift: Shift | null = null;
let upcomingShifts: Shift[] = [];
let openEntry: TimeEntry | null = null;
let userPos: [number, number] | null = null;
let map: any = null;
let userMarker: any = null;
let workMarker: any = null;
let timerHandle: number | undefined;
let geoWatchId: number | null = null;


// ---- settings readers (with sane defaults) ----

function nearMeters(): number {
    return currentOrg?.settings?.checkin_radius_m ?? 150;
}

function strictMode(): "off" | "warn" | "enforce" {
    return currentOrg?.settings?.checkin_strict ?? "warn";
}

function roleLabels(): string[] {
    return currentOrg?.settings?.role_labels ?? DEFAULT_ROLES;
}


document.addEventListener("DOMContentLoaded", async () => {

    const loggedIn = await authReady;

    if(!loggedIn || !currentOrg || !currentMembership){
        // not authenticated: leave NOTHING behind for DOM tamperers
        document.getElementById("shiftStrip")!.innerHTML = "";
        document.getElementById("myEntriesList")!.innerHTML = "";
        document.getElementById("attSub")!.textContent =
            "Log in to record your attendance.";
        return;
    }

    fillRoleSelect();
    initMap();
    setTimeout(() => map?.invalidateSize(), 200);
    window.addEventListener("resize", () => map?.invalidateSize());
    void refresh();

    document.getElementById("attBtn")!.addEventListener("click", onMainButton);

});

function fillRoleSelect(): void {

    const sel = document.getElementById("attRole") as HTMLSelectElement;

    sel.innerHTML = "";
    roleLabels().forEach(r => {
        const o = document.createElement("option");
        o.value = r;
        o.textContent = r;
        sel.appendChild(o);
    });

}

async function refresh(): Promise<void> {
    await Promise.all([loadUpcomingShifts(), loadOpenEntry()]);
    renderShiftStrip();
    renderAttendance();
}

// ---------------- data ----------------

async function loadUpcomingShifts(): Promise<void> {

    const todayIso = formatDateISO(new Date());
    const endIso = formatDateISO(addDays(new Date(), 13));

    const { data } = await supabaseClient
        .from("shifts")
        .select("*")
        .eq("organization_id", currentOrg!.id)
        .eq("membership_id", currentMembership!.id)
        .gte("shift_date", todayIso)
        .lte("shift_date", endIso)
        .order("shift_date");

    upcomingShifts = (data ?? []) as Shift[];
    todayShift = upcomingShifts.find(s => s.shift_date === todayIso) ?? null;

}

async function loadOpenEntry(): Promise<void> {

    const { data } = await supabaseClient
        .from("time_entries")
        .select("*")
        .eq("organization_id", currentOrg!.id)
        .eq("membership_id", currentMembership!.id)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle();

    openEntry = (data as TimeEntry) ?? null;

}

// ---------------- card 1: shift strip ----------------

const DOW = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function renderShiftStrip(): void {

    const wrap = document.getElementById("shiftStrip")!;
    const todayIso = formatDateISO(new Date());

    if(upcomingShifts.length === 0){
        wrap.innerHTML = `<p class="plan-entry-meta" style="padding:0 12px;">No shifts scheduled.</p>`;
        return;
    }

    wrap.innerHTML = upcomingShifts.map(s => `
        <div class="shift-mini ${s.shift_date === todayIso ? "is-today" : ""}">
            <div class="shift-mini-dow">${DOW[parseDateOnly(s.shift_date).getDay()]}</div>
            <div class="shift-mini-date">${s.shift_date.slice(8)} ${MONTH_ABBR[parseDateOnly(s.shift_date).getMonth()]}</div>
            <div class="shift-mini-role">${escapeHtml(s.role_label ?? roleLabels()[0])}</div>
            <div class="shift-mini-time">${s.start_time.slice(0,5)}\u2013${s.end_time.slice(0,5)}</div>
        </div>
    `).join("");

}

// ---------------- card 2: attendance & live map ----------------

function initMap(): void {

    map = L.map("map", {
        zoomControl:     false,   // no manual +/- buttons
        scrollWheelZoom: false,   // no wheel zooming
        doubleClickZoom: false,
        touchZoom:       false,
        boxZoom:         false,
        keyboard:        false
        // dragging stays enabled for peeking around,
        // but every location update snaps the view back
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    // start centered on workplace when known, else a neutral view
    const wp = workplacePos();
    if(wp){ map.setView(wp, 15); } else { map.setView([-6.2, 106.816666], 13); }

    if(!navigator.geolocation){
        document.getElementById("attSub")!.textContent =
            "Geolocation not supported \u2014 showing workplace.";
        drawWorkPinOnly();
        return;
    }

    // continuous tracking: userPos stays fresh while the tab is open
    geoWatchId = navigator.geolocation.watchPosition(
        onPositionUpdate,

        () => {
            document.getElementById("attSub")!.textContent =
                "Location permission denied \u2014 showing workplace only.";
            drawWorkPinOnly();
        },

        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

}

// Called on EVERY location fix (first one and subsequent moves)
function onPositionUpdate(pos: GeolocationPosition): void {

    userPos = [pos.coords.latitude, pos.coords.longitude];

    updateUserPin();
    autoFitView();
    renderAttendance();   // subtitle distance refresh

}

function updateUserPin(): void {

    if(!userPos) return;

    if(!userMarker){
        // create once…
        userMarker = L.circleMarker(userPos, {
            radius: 10, color: "#1565c0", fillOpacity: 0.8
        }).addTo(map).bindPopup("You are here");
    } else {
        // …then just move it smoothly
        userMarker.setLatLng(userPos);
    }

}

// Auto zoom: frame BOTH pins when near the workplace,
// otherwise center on the user at street level.
function autoFitView(): void {

    if(!userPos || !map) return;

    const wp = workplacePos();
    const dist = wp ? haversineMeters(userPos, wp) : Infinity;

    if(wp && dist <= nearMeters()){

        if(!workMarker){
            workMarker = L.marker(wp).addTo(map).bindPopup("Workplace");
        }
        // zoom automatically so both pins stay inside the card
        map.fitBounds(L.latLngBounds([wp, userPos]).pad(0.4), { animate: true });

    } else {

        // far away: workplace pin hidden, camera follows the user
        if(workMarker){ map.removeLayer(workMarker); workMarker = null; }
        map.setView(userPos, 16, { animate: true });

    }

}

function drawWorkPinOnly(): void {
    const c = workplacePos();
    if(!c) return;
    workMarker = L.marker(c).addTo(map).bindPopup("Workplace");
    map.setView(c, 15);
}

function workplacePos(): [number, number] | null {
    const s = currentOrg?.settings;
    if(!s?.workplace_lat || !s?.workplace_lng) return null;
    return [s.workplace_lat, s.workplace_lng];
}


function renderAttendance(): void {

    const title  = document.getElementById("attTitle")!;
    const sub    = document.getElementById("attSub")!;
    const roleEl = document.getElementById("attRole") as HTMLSelectElement;
    const hrsEl  = document.getElementById("attHours")!;
    const btn    = document.getElementById("attBtn") as HTMLButtonElement;

    const checkedIn = openEntry !== null;

    // ---- title & scheduled row ----
    if(todayShift){
        title.textContent = checkedIn ? "Check Out" : "Check In";
        hrsEl.textContent = `${todayShift.start_time.slice(0,5)}\u2013${todayShift.end_time.slice(0,5)}`;
        roleEl.value = todayShift.role_label ?? "";
        if(roleEl.selectedIndex === -1) roleEl.selectedIndex = 0;   // unknown label -> first option
    } else {
        title.textContent = checkedIn ? "Extra Shift \u2014 Check Out" : "Working extra shift today?";
        hrsEl.textContent = "\u2014";
    }
    roleEl.disabled = checkedIn;   // role is frozen once checked in

    // ---- subtitle ----
    const wp = workplacePos();
    const dist = (wp && userPos) ? Math.round(haversineMeters(userPos, wp)) : null;
    sub.textContent = checkedIn
        ? `Since ${new Date(openEntry!.clock_in!).toLocaleTimeString("de-DE")}`
        : (dist !== null
            ? (dist <= nearMeters()
                ? `At workplace (~${dist} m away)`
                : `Not at workplace (~${dist} m away)` )
            : "");

    // ---- button ----
    btn.textContent = checkedIn ? "Check Out" : "Check In";
    btn.classList.toggle("checkout", checkedIn);

    startOrStopTimer();

}

function startOrStopTimer(): void {

    const el = document.getElementById("attTimer")!;

    if(timerHandle !== undefined){
        clearInterval(timerHandle);
        timerHandle = undefined;
    }

    if(!openEntry) { el.textContent = "00:00:00"; return; }

    const startedAt = Date.parse(openEntry.clock_in!);
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

async function onMainButton(): Promise<void> {

    if(openEntry){ await doCheckOut(); } else { await doCheckIn(); }

}

async function doCheckIn(): Promise<void> {

    const comment = (document.getElementById("attComment") as HTMLTextAreaElement).value.trim() || null;
    const roleSel = (document.getElementById("attRole") as HTMLSelectElement).value;

    // strict mode: block check-in when outside the allowed radius
    const wp   = workplacePos();
    const dist = (wp && userPos) ? haversineMeters(userPos, wp) : null;

    if(strictMode() === "enforce"
       && wp && dist !== null && dist > nearMeters()){
        alert(`Check-in blocked \u2014 you are ~${Math.round(dist)} m from the workplace.`);
        return;
    }

    const now = new Date().toISOString();

    const { error } = await supabaseClient.from("time_entries").insert({
        organization_id: currentOrg!.id,
        membership_id: currentMembership!.id,
        shift_id: todayShift?.id ?? null,
        role_label: todayShift?.role_label ?? roleSel,
        clock_in: now,
        original_clock_in: now,
        source: "employee",
        status: "pending",
        employee_note: comment
    });

    if(error){
        alert(error.message);
        return;
    }

    (document.getElementById("attComment") as HTMLTextAreaElement).value = "";
    await refresh();

}

async function doCheckOut(): Promise<void> {

    const comment = (document.getElementById("attComment") as HTMLTextAreaElement).value.trim();

    const now = new Date().toISOString();

    const { error } = await supabaseClient
        .from("time_entries")
        .update({
            clock_out: now,
            original_clock_out: now,
            status: "pending",
            employee_note: comment
                ? `${openEntry!.employee_note ?? ""} ${comment}`.trim()
                : openEntry!.employee_note
        })
        .eq("id", openEntry!.id);

    if(error){
        alert(error.message);
        return;
    }

    await refresh();

}

// ---------------- utils ----------------

function haversineMeters(a: [number,number], b: [number,number]): number {
    const R = 6371000;
    const dLat = (b[0]-a[0]) * Math.PI/180;
    const dLon = (b[1]-a[1]) * Math.PI/180;
    const la1 = a[0]*Math.PI/180, la2 = b[1]*Math.PI/180;
    const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDateISO(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function addDays(d: Date, n: number): Date {
    const x = new Date(d); x.setDate(x.getDate()+n); return x;
}

function parseDateOnly(s: string): Date {
    const [y,m,d] = s.split("-").map(Number);
    return new Date(y, m-1, d);
}

function escapeHtml(s: string | null | undefined): string {
    const div = document.createElement("div");
    div.textContent = s ?? "";
    return div.innerHTML;
}