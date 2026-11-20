import { useMemo, useState } from "react";
import { Page, Section } from "../components/Page";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { supabase } from "../lib/supabase";
import { DEFAULT_ROLES } from "../lib/types";

// Supports: /@lat,lng,z · ?q|ll|query=lat,lng · raw "lat, lng"
function parseMapsInput(raw: string): [number, number] | null {
    const s = decodeURIComponent(raw.trim());
    const m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
        ?? s.match(/[?&](?:q|ll|query)=(-?\d{1,3}\.\d+)(?:%2C|,)+(-?\d{1,3}\.\d+)/i)
        ?? s.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function Admin() {

    const { org, patchOrg } = useAuth();
    const log = useLog();
    const s = org!.settings ?? {};

    const zones = useMemo<string[]>(() => {
        const list = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
        return [...(list ?? ["Europe/Berlin", "Europe/London", "UTC", "Asia/Jakarta"])].sort();
    }, []);

    const [f, setF] = useState({
        name: org!.name,
        timezone: org!.timezone,
        lat: String(s.workplace_lat ?? ""),
        lng: String(s.workplace_lng ?? ""),
        radius: String(s.checkin_radius_m ?? 150),
        strict: s.checkin_strict ?? "warn",
        roles: (s.role_labels ?? DEFAULT_ROLES).join("\n"),
        cutoff: String(s.leave_cutoff_days ?? 14),
        min: String(s.shift_min_hours ?? 1),
        max: String(s.shift_max_hours ?? 16)
    });
    const [mapsUrl, setMapsUrl] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);

    const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

    function extract() {
        const c = parseMapsInput(mapsUrl);
        if (!c) { setStatus("\u26a0 Could not find coordinates in that link/text."); return; }
        setF({ ...f, lat: String(c[0]), lng: String(c[1]) });
        setStatus(`Extracted: ${c[0]}, ${c[1]} \u2014 remember to Save.`);
    }

    async function save() {
        setBusy(true);
        setStatus("Saving…");

        const roleLabels = f.roles.split("\n").map(x => x.trim()).filter(Boolean);
        const settings = {
            ...s,
            workplace_lat: num(f.lat),
            workplace_lng: num(f.lng),
            checkin_radius_m: num(f.radius) ?? 150,
            checkin_strict: f.strict,
            role_labels: roleLabels.length ? roleLabels : null,
            leave_cutoff_days: num(f.cutoff),
            shift_min_hours: num(f.min),
            shift_max_hours: num(f.max)
        };

        const { error } = await supabase.from("organizations")
            .update({ name: f.name.trim(), timezone: f.timezone, settings })
            .eq("id", org!.id);

        setBusy(false);
        if (error) { setStatus(""); alert(error.message); return; }

        await log("settings.update", "Organization settings updated", { settings });
        patchOrg({ name: f.name.trim(), timezone: f.timezone, settings: settings as any });
        setStatus(`Saved ✓ ${new Date().toLocaleTimeString("de-DE")}`);
    }

    return (
        <Page title="Admin — Settings">
            <div className="dash-stack">

                <Section title="Organization">
                    <div className="settings-grid">
                        <div><span className="plan-entry-meta">Name</span><input type="text" value={f.name} onChange={set("name")} /></div>
                        <div><span className="plan-entry-meta">Slug (URL)</span><input type="text" value={org!.slug} disabled /></div>
                        <div>
                            <span className="plan-entry-meta">Timezone</span>
                            <select value={f.timezone} onChange={set("timezone")}>
                                {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                            </select>
                        </div>
                    </div>
                </Section>

                <Section title="Location & Check-in">
                    <div className="settings-grid">
                        <div><span className="plan-entry-meta">Workplace latitude</span><input type="number" step="any" value={f.lat} onChange={set("lat")} /></div>
                        <div><span className="plan-entry-meta">Workplace longitude</span><input type="number" step="any" value={f.lng} onChange={set("lng")} /></div>
                        <div><span className="plan-entry-meta">Check-in radius (meters)</span><input type="number" min="10" value={f.radius} onChange={set("radius")} /></div>
                        <div>
                            <span className="plan-entry-meta">Outside-radius behavior</span>
                            <select value={f.strict} onChange={set("strict")}>
                                <option value="off">Allow silently</option>
                                <option value="warn">Warn only</option>
                                <option value="enforce">Block check-in</option>
                            </select>
                        </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                        <span className="plan-entry-meta">Paste a Google Maps link or “lat, lng” — coordinates are extracted automatically</span>
                        <div className="auth-pass-row" style={{ marginTop: 4 }}>
                            <input type="text" placeholder="https://maps.google.com/… or -6.2562, 106.6641"
                                value={mapsUrl} onChange={e => setMapsUrl(e.target.value)} />
                            <button type="button" className="header-action-btn" onClick={extract} title="Extract coordinates">Extract</button>
                        </div>
                    </div>
                </Section>

                <Section title="Staff Role Labels">
                    <span className="plan-entry-meta">One per line — these fill the role dropdown on the Dashboard.</span>
                    <textarea id="setRoles" rows={5} value={f.roles} onChange={set("roles")} />
                </Section>

                <Section title="Scheduling Rules">
                    <div className="settings-grid">
                        <div><span className="plan-entry-meta">Leave request cut-off (days ahead)</span><input type="number" min="0" value={f.cutoff} onChange={set("cutoff")} /></div>
                        <div><span className="plan-entry-meta">Min shift duration (hours)</span><input type="number" min="1" value={f.min} onChange={set("min")} /></div>
                        <div><span className="plan-entry-meta">Max shift duration (hours)</span><input type="number" min="1" value={f.max} onChange={set("max")} /></div>
                    </div>
                </Section>

                <div className="plan-entry-meta">{status}</div>
                <button className="att-btn" disabled={busy} onClick={save}>Save Settings</button>
            </div>
        </Page>
    );
}
