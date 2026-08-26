// ======================================================
// adminSettings.ts — technical organization settings
// (admin role only): identity, location, role labels,
// scheduling rules. Persists into organizations.settings.
// ======================================================

import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, authReady, isAdmin } from "./auth.js";

document.addEventListener("DOMContentLoaded", async () => {

    await authReady;

    const root = document.getElementById("settingsRoot")!;

    if(!isAdmin() || !currentOrg){
        root.innerHTML = `<p class="auth-error">Admin access required.</p>`;
        return;
    }
    populateTimezones();
    populate();
    document.getElementById("saveSettingsBtn")!.addEventListener("click", save);

});

function populateTimezones(): void {

    const sel = document.getElementById("setTimezone") as HTMLSelectElement;

    // full IANA list from the browser itself (fallback: short list)
    const list: string[] =
        ((Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined)
        ?? ["Europe/Berlin", "Europe/London", "UTC", "Asia/Jakarta"];

    sel.innerHTML = "";
    [...list].sort().forEach(tz => {
        const o = document.createElement("option");
        o.value = tz;
        o.textContent = tz.replace(/_/g, " ");
        sel.appendChild(o);
    });

}

function populate(): void {

    const s = currentOrg!.settings ?? {};

    (document.getElementById("setName")     as HTMLInputElement).value = currentOrg!.name;
    (document.getElementById("setSlug")     as HTMLInputElement).value = currentOrg!.slug;
    populateTimezones();
    const tzSel = document.getElementById("setTimezone") as HTMLSelectElement;
    tzSel.value = currentOrg!.timezone;
    if(!tzSel.value && tzSel.options.length) tzSel.selectedIndex = 0;   // fallback

    (document.getElementById("setLat")    as HTMLInputElement).value = String(s.workplace_lat ?? "");
    (document.getElementById("setLng")    as HTMLInputElement).value = String(s.workplace_lng ?? "");
    (document.getElementById("setRadius") as HTMLInputElement).value = String(s.checkin_radius_m ?? 150);
    (document.getElementById("setStrict") as HTMLSelectElement).value = s.checkin_strict ?? "warn";

    const labels: string[] = s.role_labels ?? ["Service crew","Kitchen","Bar","Cashier","Runner"];
    (document.getElementById("setRoles") as HTMLTextAreaElement).value = labels.join("\n");

    (document.getElementById("setLeaveCutoff") as HTMLInputElement).value = String(s.leave_cutoff_days ?? 14);
    (document.getElementById("setShiftMin")    as HTMLInputElement).value = String(s.shift_min_hours ?? 1);
    (document.getElementById("setShiftMax")    as HTMLInputElement).value = String(s.shift_max_hours ?? 16);

}

async function save(): Promise<void> {

    const btn  = document.getElementById("saveSettingsBtn") as HTMLButtonElement;
    const stat = document.getElementById("saveStatus")!;
    btn.disabled = true;
    stat.textContent = "Saving…";

    const val = (id: string) => {
        const raw = (document.getElementById(id) as HTMLInputElement).value.trim();
        return raw === "" ? null : Number(raw);
    };

    const roleLabels = (document.getElementById("setRoles") as HTMLTextAreaElement).value
        .split("\n").map(x => x.trim()).filter(Boolean);

    const newSettings = {
        ...(currentOrg!.settings ?? {}),
        workplace_lat:    val("setLat"),
        workplace_lng:    val("setLng"),
        checkin_radius_m: val("setRadius") ?? 150,
        checkin_strict:   (document.getElementById("setStrict") as HTMLSelectElement).value,
        role_labels:      roleLabels.length ? roleLabels : null,
        leave_cutoff_days: val("setLeaveCutoff"),
        shift_min_hours:  val("setShiftMin"),
        shift_max_hours:  val("setShiftMax")
    };

    const { error } = await supabaseClient
        .from("organizations")
        .update({
            name:     (document.getElementById("setName") as HTMLInputElement).value.trim(),
            timezone: (document.getElementById("setTimezone") as HTMLInputElement).value.trim(),
            settings: newSettings
        })
        .eq("id", currentOrg!.id);

    if(error){
        stat.textContent = "";
        alert(error.message);
        btn.disabled = false;
        return;
    }

    // keep the in-memory copy fresh for other modules
    Object.assign(currentOrg!, {
        name: (document.getElementById("setName") as HTMLInputElement).value.trim(),
        settings: newSettings
    });

    stat.textContent = `Saved ✓ ${new Date().toLocaleTimeString("de-DE")}`;
    btn.disabled = false;

}

// Supports: /@lat,lng,z · ?q|ll|query=lat,lng · raw "lat, lng"
function parseMapsInput(raw: string): [number, number] | null {

    const s = decodeURIComponent(raw.trim());

    let m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
    if(!m) m = s.match(/[?&](?:q|ll|query)=(-?\d{1,3}\.\d+)(?:%2C|,)+(-?\d{1,3}\.\d+)/i);
    if(!m) m = s.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);

    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;

}

function wireCoordinateExtractor(): void {

    const btn = document.getElementById("extractCoordsBtn") as HTMLButtonElement | null;
    if(!btn) return;

    btn.addEventListener("click", () => {

        const raw = (document.getElementById("setMapsUrl") as HTMLInputElement).value;
        const stat = document.getElementById("saveStatus")!;

        const c = parseMapsInput(raw);

        if(!c){
            stat.textContent = "\u26a0 Could not find coordinates in that link/text.";
            return;
        }

        (document.getElementById("setLat") as HTMLInputElement).value = String(c[0]);
        (document.getElementById("setLng") as HTMLInputElement).value = String(c[1]);
        stat.textContent = `Extracted: ${c[0]}, ${c[1]} \u2014 remember to Save.`;

    });

}