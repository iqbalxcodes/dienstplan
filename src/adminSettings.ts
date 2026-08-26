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

    populate();
    document.getElementById("saveSettingsBtn")!.addEventListener("click", save);

});

function populate(): void {

    const s = currentOrg!.settings ?? {};

    (document.getElementById("setName")     as HTMLInputElement).value = currentOrg!.name;
    (document.getElementById("setSlug")     as HTMLInputElement).value = currentOrg!.slug;
    (document.getElementById("setTimezone") as HTMLInputElement).value = currentOrg!.timezone;

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