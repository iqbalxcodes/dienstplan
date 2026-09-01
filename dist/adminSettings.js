// ======================================================
// adminSettings.ts — technical organization settings
// (admin role only): identity, location, role labels,
// scheduling rules. Persists into organizations.settings.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, authReady, isAdmin } from "./auth.js";
import { logActivity } from "./activityLog.js";
document.addEventListener("DOMContentLoaded", async () => {
    await authReady;
    if (!isAdmin() || !currentOrg) {
        const container = document.querySelector(".table-container");
        if (container)
            container.innerHTML = `<p class="auth-error" style="margin:24px;">Admin access required.</p>`;
        return;
    }
    populateTimezones();
    populate();
    wireCoordinateExtractor();
    document.getElementById("saveSettingsBtn").addEventListener("click", save);
});
function populateTimezones() {
    const sel = document.getElementById("setTimezone");
    // full IANA list from the browser itself (fallback: short list)
    const list = Intl.supportedValuesOf?.("timeZone")
        ?? ["Europe/Berlin", "Europe/London", "UTC", "Asia/Jakarta"];
    sel.innerHTML = "";
    [...list].sort().forEach(tz => {
        const o = document.createElement("option");
        o.value = tz;
        o.textContent = tz.replace(/_/g, " ");
        sel.appendChild(o);
    });
}
function populate() {
    const s = currentOrg.settings ?? {};
    document.getElementById("setName").value = currentOrg.name;
    document.getElementById("setSlug").value = currentOrg.slug;
    populateTimezones();
    const tzSel = document.getElementById("setTimezone");
    tzSel.value = currentOrg.timezone;
    if (!tzSel.value && tzSel.options.length)
        tzSel.selectedIndex = 0; // fallback
    document.getElementById("setLat").value = String(s.workplace_lat ?? "");
    document.getElementById("setLng").value = String(s.workplace_lng ?? "");
    document.getElementById("setRadius").value = String(s.checkin_radius_m ?? 150);
    document.getElementById("setStrict").value = s.checkin_strict ?? "warn";
    const labels = s.role_labels ?? ["Service crew", "Kitchen", "Bar", "Cashier", "Runner"];
    document.getElementById("setRoles").value = labels.join("\n");
    document.getElementById("setLeaveCutoff").value = String(s.leave_cutoff_days ?? 14);
    document.getElementById("setShiftMin").value = String(s.shift_min_hours ?? 1);
    document.getElementById("setShiftMax").value = String(s.shift_max_hours ?? 16);
}
async function save() {
    const btn = document.getElementById("saveSettingsBtn");
    const stat = document.getElementById("saveStatus");
    btn.disabled = true;
    stat.textContent = "Saving…";
    const val = (id) => {
        const raw = document.getElementById(id).value.trim();
        return raw === "" ? null : Number(raw);
    };
    const roleLabels = document.getElementById("setRoles").value
        .split("\n").map(x => x.trim()).filter(Boolean);
    const newSettings = {
        ...(currentOrg.settings ?? {}),
        workplace_lat: val("setLat"),
        workplace_lng: val("setLng"),
        checkin_radius_m: val("setRadius") ?? 150,
        checkin_strict: document.getElementById("setStrict").value,
        role_labels: roleLabels.length ? roleLabels : null,
        leave_cutoff_days: val("setLeaveCutoff"),
        shift_min_hours: val("setShiftMin"),
        shift_max_hours: val("setShiftMax")
    };
    const { error } = await supabaseClient
        .from("organizations")
        .update({
        name: document.getElementById("setName").value.trim(),
        timezone: document.getElementById("setTimezone").value.trim(),
        settings: newSettings
    })
        .eq("id", currentOrg.id);
    if (error) {
        stat.textContent = "";
        alert(error.message);
        btn.disabled = false;
        return;
    }
    await logActivity("settings.update", "Organization settings updated", { settings: newSettings });
    Object.assign(currentOrg, {
        name: document.getElementById("setName").value.trim(),
        settings: newSettings
    });
    stat.textContent = `Saved ✓ ${new Date().toLocaleTimeString("de-DE")}`;
    btn.disabled = false;
}
// Supports: /@lat,lng,z · ?q|ll|query=lat,lng · raw "lat, lng"
function parseMapsInput(raw) {
    const s = decodeURIComponent(raw.trim());
    let m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
    if (!m)
        m = s.match(/[?&](?:q|ll|query)=(-?\d{1,3}\.\d+)(?:%2C|,)+(-?\d{1,3}\.\d+)/i);
    if (!m)
        m = s.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}
function wireCoordinateExtractor() {
    const btn = document.getElementById("extractCoordsBtn");
    if (!btn)
        return;
    btn.addEventListener("click", () => {
        const raw = document.getElementById("setMapsUrl").value;
        const stat = document.getElementById("saveStatus");
        const c = parseMapsInput(raw);
        if (!c) {
            stat.textContent = "\u26a0 Could not find coordinates in that link/text.";
            return;
        }
        document.getElementById("setLat").value = String(c[0]);
        document.getElementById("setLng").value = String(c[1]);
        stat.textContent = `Extracted: ${c[0]}, ${c[1]} \u2014 remember to Save.`;
    });
}
//# sourceMappingURL=adminSettings.js.map