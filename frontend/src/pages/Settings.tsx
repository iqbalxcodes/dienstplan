import { useState } from "react";
import { Page, Section } from "../components/Page";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useSettings, type Language } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { disablePush, enablePush, isPushSupported } from "../lib/push";
import { shiftTypesOf } from "../lib/roster";
import { DEFAULT_AREAS, type ShiftType } from "../lib/types";

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
        say("Änderungen gespeichert", "success");
    }

    return (
        <>
            <span className="plan-entry-meta">Code · name · color · type · default start/end. “Off” types (e.g. U, Sch) fill the whole day.</span>
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

            <span className="plan-entry-meta" style={{ display: "block", marginTop: 14 }}>Areas — one per line</span>
            <textarea id="setRoles" rows={4} value={areas} onChange={e => setAreas(e.target.value)} />

            <button className="att-btn" disabled={busy} onClick={save}>Save presets</button>
        </>
    );
}

export default function Settings() {

    const { org, me, isManager } = useAuth();
    const { settings, update, t } = useSettings();
    const { say } = useStatus();
    const [busy, setBusy] = useState(false);
    const enabled = settings.notificationsEnabled;

    async function toggle(on: boolean) {
        setBusy(true);
        if (!on) {
            await disablePush();
            update({ notificationsEnabled: false });
        } else {
            update({ notificationsEnabled: await enablePush(org!.id, me!.id) });
        }
        say("Änderungen gespeichert", "success");
        setBusy(false);
    }

    const note = !isPushSupported()
        ? "Push notifications are not supported in this browser."
        : enabled && Notification.permission === "denied"
            ? "Notifications are blocked in your browser settings — enable them for this site to receive reminders."
            : "Get a notification 15 minutes before your shift starts or ends — even when the app is closed.";

    return (
        <Page title={t("settings.title")}>
            <div className="dash-stack">
                <Section title={t("settings.language")}>
                    <select value={settings.language} onChange={e => { update({ language: e.target.value as Language }); say("Änderungen gespeichert", "success"); }}>
                        <option value="de">Deutsch</option>
                        <option value="en">English</option>
                        <option value="id">Bahasa Indonesia</option>
                    </select>
                    <p className="plan-entry-meta" style={{ marginTop: 8 }}>{t("settings.saveNote")}</p>
                </Section>

                <Section title="Shift Reminders">
                    <div className="settings-toggle-row" aria-busy={busy}>
                        <button className={"settings-toggle-btn" + (enabled ? " active" : "")} disabled={busy} onClick={() => toggle(true)}>On</button>
                        <button className={"settings-toggle-btn" + (!enabled ? " active" : "")} disabled={busy} onClick={() => toggle(false)}>Off</button>
                    </div>
                    <p className="plan-entry-meta" style={{ marginTop: 8 }}>{note}</p>
                </Section>

                {isManager && <Section title="Shift Presets"><Presets /></Section>}
            </div>
        </Page>
    );
}