// Admin settings. Same look as the other pages: blue panels (ro-panel) + white body.
import { useMemo, useState } from "react";
import { Field, Panel } from "../components/Panel";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { shiftTypesOf } from "../lib/roster";
import { DEFAULT_AREAS, DEFAULT_ROLES, type ShiftType } from "../lib/types";

// Supports: /@lat,lng,z · ?q|ll|query=lat,lng · raw "lat, lng"
function parseMapsInput(raw: string): [number, number] | null {
    const s = decodeURIComponent(raw.trim());
    const m = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
        ?? s.match(/[?&](?:q|ll|query)=(-?\d{1,3}\.\d+)(?:%2C|,)+(-?\d{1,3}\.\d+)/i)
        ?? s.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Shift presets (F, FX, M, U, Sch ...) + areas. Stored in organizations.settings. */
function Presets() {

    const { org, patchOrg } = useAuth();
    const log = useLog();
    const { say } = useStatus();
    const s = org!.settings ?? {};
    const [types, setTypes] = useState<ShiftType[]>(() => shiftTypesOf(s).map(t => ({ ...t })));
    const [areas, setAreas] = useState((s.areas?.length ? s.areas : DEFAULT_AREAS).join("\n"));
    const [busy, setBusy] = useState(false);

    const edit = (i: number, patch: Partial<ShiftType>) => setTypes(t => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));

    async function save() {
        setBusy(true);
        const shift_types = types.filter(t => t.code.trim()).map(t => ({
            code: t.code.trim(), name: t.name.trim() || t.code.trim(), color: t.color, kind: t.kind ?? "work",
            ...((t.kind ?? "work") === "work" ? { start: t.start, end: t.end } : {})
        }));
        const settings = { ...s, shift_types, areas: areas.split("\n").map(x => x.trim()).filter(Boolean) };

        const { error } = await supabase.from("organizations").update({ settings }).eq("id", org!.id);
        setBusy(false);
        if (error) { say(error.message, "error"); return; }

        patchOrg({ settings });
        void log("settings.update", "Shift presets updated", { shift_types: shift_types.length });
        say("Saved", "success");
    }

    return (
        <>
            <span className="plan-entry-meta">Code · name · color · type · default start/end. “Off” types (e.g. U, Sch) fill the whole day.</span>
            <div>
                {types.map((t, i) => (
                    <div key={i} className="preset-row">
                        <input placeholder="Code" value={t.code} onChange={e => edit(i, { code: e.target.value })} />
                        <input placeholder="Name" value={t.name} onChange={e => edit(i, { name: e.target.value })} />
                        <input type="color" value={t.color} onChange={e => edit(i, { color: e.target.value })} />
                        <select value={t.kind ?? "work"} onChange={e => edit(i, { kind: e.target.value as ShiftType["kind"] })}>
                            <option value="work">Work</option>
                            <option value="off">Off</option>
                        </select>
                        <input type="time" disabled={t.kind === "off"} value={t.start ?? ""} onChange={e => edit(i, { start: e.target.value })} />
                        <input type="time" disabled={t.kind === "off"} value={t.end ?? ""} onChange={e => edit(i, { end: e.target.value })} />
                        <button type="button" onClick={() => setTypes(x => x.filter((_, j) => j !== i))} title="Remove">✕</button>
                    </div>
                ))}
                <button type="button" className="preset-add" onClick={() => setTypes(t => [...t, { code: "", name: "", color: "#6b7280", kind: "work", start: "09:00", end: "17:00" }])}>+ Add shift</button>
            </div>

            <Field label="Areas - one per line">
                <textarea rows={4} value={areas} onChange={e => setAreas(e.target.value)} />
            </Field>

            <div><button className="mg-btn" disabled={busy} onClick={save}>Save presets</button></div>
        </>
    );
}

export default function Admin() {

    const { org, patchOrg } = useAuth();
    const log = useLog();
    const { say } = useStatus();
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
        max: String(s.shift_max_hours ?? 16),
        vac: String(s.vacation_days ?? 30)
    });
    const [mapsUrl, setMapsUrl] = useState("");
    const [busy, setBusy] = useState(false);

    const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

    function extract() {
        const c = parseMapsInput(mapsUrl);
        if (!c) { say("Could not find coordinates in that link/text.", "error"); return; }
        setF({ ...f, lat: String(c[0]), lng: String(c[1]) });
        say(`Extracted: ${c[0]}, ${c[1]} - remember to Save.`, "info");
    }

    async function save() {
        setBusy(true);

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
            shift_max_hours: num(f.max),
            vacation_days: num(f.vac) ?? 30
        };

        const { error } = await supabase.from("organizations")
            .update({ name: f.name.trim(), timezone: f.timezone, settings })
            .eq("id", org!.id);

        setBusy(false);
        if (error) { say(error.message, "error"); return; }

        await log("settings.update", "Organization settings updated", { settings });
        patchOrg({ name: f.name.trim(), timezone: f.timezone, settings: settings as any });
        say("Saved", "success");
    }

    return (
        <div className="dsh">
            <div className="dsh-h split">
                <h2>Admin</h2>
                <button className="ro-export" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            </div>

            <div className="ad-stack">
                <Panel title="Organization">
                    <div className="ad-grid">
                        <Field label="Name"><input type="text" value={f.name} onChange={set("name")} /></Field>
                        <Field label="Slug (URL)"><input type="text" value={org!.slug} disabled /></Field>
                        <Field label="Timezone">
                            <select value={f.timezone} onChange={set("timezone")}>
                                {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                            </select>
                        </Field>
                    </div>
                </Panel>

                <Panel title="Location & Check-in">
                    <div className="ad-grid">
                        <Field label="Workplace latitude"><input type="number" step="any" value={f.lat} onChange={set("lat")} /></Field>
                        <Field label="Workplace longitude"><input type="number" step="any" value={f.lng} onChange={set("lng")} /></Field>
                        <Field label="Check-in radius (meters)"><input type="number" min="10" value={f.radius} onChange={set("radius")} /></Field>
                        <Field label="Outside-radius behavior">
                            <select value={f.strict} onChange={set("strict")}>
                                <option value="off">Allow silently</option>
                                <option value="warn">Warn only</option>
                                <option value="enforce">Block check-in</option>
                            </select>
                        </Field>
                    </div>
                    <Field label="Google Maps link or “lat, lng” - coordinates are extracted automatically">
                        <div className="ad-row">
                            <input type="text" placeholder="https://maps.google.com/… or -6.2562, 106.6641"
                                value={mapsUrl} onChange={e => setMapsUrl(e.target.value)} />
                            <button type="button" className="mg-btn" onClick={extract}>Extract</button>
                        </div>
                    </Field>
                </Panel>

                <Panel title="Staff Role Labels">
                    <Field label="One per line - these fill the role dropdown on the Dashboard.">
                        <textarea rows={5} value={f.roles} onChange={set("roles")} />
                    </Field>
                </Panel>

                <Panel title="Scheduling Rules">
                    <div className="ad-grid">
                        <Field label="Leave request cut-off (days ahead)"><input type="number" min="0" value={f.cutoff} onChange={set("cutoff")} /></Field>
                        <Field label="Min shift duration (hours)"><input type="number" min="1" value={f.min} onChange={set("min")} /></Field>
                        <Field label="Max shift duration (hours)"><input type="number" min="1" value={f.max} onChange={set("max")} /></Field>
                        <Field label="Jahresurlaub (days per year)"><input type="number" min="0" value={f.vac} onChange={set("vac")} /></Field>
                    </div>
                </Panel>

                <Panel title="Shift Presets"><Presets /></Panel>
            </div>
        </div>
    );
}