// ======================================================
// dashboard.ts — mobile-first attendance card:
// shift strip, live map, check-in/out with timer.
// ======================================================

import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership } from "./auth.js";
import type { Shift, TimeEntry } from "./types.js";

declare const L: any;

const ROLE_OPTIONS = ["Service crew", "Kitchen", "Bar", "Cashier", "Runner"];
const NEAR_METERS = 150;

let todayShift: Shift | null = null;
let upcomingShifts: Shift[] = [];
let openEntry: TimeEntry | null = null;
let userPos: [number, number] | null = null;
let map: any = null;
let userMarker: any = null;
let workMarker: any = null;
let timerHandle: number | undefined;

document.addEventListener("DOMContentLoaded", () => {

    if(!currentOrg || !currentMembership){
        document.getElementById("attSub")!.textContent =
            "Log in to record your attendance.";
        return;
    }

    fillRoleSelect();
    initMap();
    void refresh();

    document.getElementById("attBtn")!.addEventListener("click", onMainButton);

});

function fillRoleSelect(): void {
    const sel = document.getElementById("attRole") as HTMLSelectElement;
    ROLE_OPTIONS.forEach(r => {
        const o = document.createElement("option");
        o.value = r; o.textContent = r;
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
            <div class="shift-mini-role">${escapeHtml(s.role_label ?? "Service crew")}</div>
            <div class="shift-mini-time">${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</div>
        </div>
    `).join("");

}

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ---------------- card 2: attendance ----------------

function initMap(): void {

    map = L.map("map").setView([-6.2, 106.816666], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    if(!navigator.geolocation){
        document.getElementById("attSub")!.textContent =
            "Geolocation not supported — showing workplace.";
        drawWorkPinOnly();
        return;
    }

    navigator.geolocation.getCurrentPosition(

        pos => {
            userPos = [pos.coords.latitude, pos.coords.longitude];
            map.setView(userPos, 16);
            renderMarkers();
            renderAttendance();   // subtitle depends on distance
        },

        () => {
            document.getElementById("attSub")!.textContent =
                "Location permission denied — showing workplace only.";
            drawWorkPinOnly();
        },

        { enableHighAccuracy: true, timeout: 10000 }

    );

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

function renderMarkers(): void {

    // clear old pins
    if(userMarker){ map.removeLayer(userMarker); userMarker = null; }
    if(workMarker){ map.removeLayer(workMarker); workMarker = null; }

    if(userMarker === null && userPos){
        userMarker = L.circleMarker(userPos, {
            radius: 10, color: "#1565c0", fillOpacity: .8
        }).addTo(map).bindPopup("You are here");
    }

    const wp = workplacePos();
    const dist = (wp && userPos) ? haversineMeters(userPos, wp) : Infinity;

    if(wp && dist <= NEAR_METERS){
        workMarker = L.marker(wp).addTo(map).bindPopup("Workplace");
        map.fitBounds(L.latLngBounds([wp, userPos!]).pad(0.4));
    }
    // kalau jauh -> pin tempat kerja sengaja tidak digambar

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
        hrsEl.textContent = `${todayShift.start_time.slice(0,5)}–${todayShift.end_time.slice(0,5)}`;
        roleEl.value = todayShift.role_label ?? "Service crew";
    } else {
        title.textContent = checkedIn ? "Extra Shift — Check Out" : "Working extra shift today?";
        hrsEl.textContent = "—";
    }
    roleEl.disabled = checkedIn;   // role dibekukan saat sudah check-in

    // ---- subtitle ----
    const wp = workplacePos();
    const dist = (wp && userPos) ? Math.round(haversineMeters(userPos, wp)) : null;
    sub.textContent = checkedIn
        ? `Since ${new Date(openEntry!.clock_in!).toLocaleTimeString("de-DE")}`
        : (dist !== null
            ? (dist <= NEAR_METERS
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
    const la1 = a[0]*Math.PI/180, la2 = b[0]*Math.PI/180;
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