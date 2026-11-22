// One popup for: Assign (new), Edit Shift (manager), Request (manager approves/rejects).
import { useState } from "react";
import { isOff, OPEN, type RosterForm } from "../../lib/roster";
import type { Membership, Shift, ShiftRequest, ShiftType } from "../../lib/types";

export type PopupSpec =
    | { mode: "assign"; dates: string[]; membershipId?: string }
    | { mode: "edit"; shift: Shift }
    | { mode: "request"; req: ShiftRequest };

interface Props {
    spec: PopupSpec;
    members: Membership[];
    types: ShiftType[];
    areas: string[];
    roles: string[];
    isManager: boolean;
    meId: string;
    onClose: () => void;
    onSubmit: (f: RosterForm, dates: string[]) => Promise<string | null>;
    onDelete?: () => Promise<string | null>;   // Delete (edit) / Reject (request)
}

function initialOf(spec: PopupSpec, isManager: boolean, meId: string): RosterForm {
    if (spec.mode === "assign")
        return { date: spec.dates[0] ?? "", membershipId: isManager ? (spec.membershipId ?? "") : meId, code: "", area: "", role: "", start: "", end: "" };
    if (spec.mode === "edit") {
        const s = spec.shift;
        return { date: s.shift_date, membershipId: s.membership_id ?? OPEN, code: s.shift_code ?? "", area: s.area_label ?? "", role: s.role_label ?? "", start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) };
    }
    const r = spec.req;
    return { date: r.request_date, membershipId: r.membership_id, code: r.shift_code ?? "", area: r.area_label ?? "", role: r.role_label ?? "", start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) };
}

const short = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}.`;
const withCurrent = (list: string[], cur: string) => [...new Set([...list, cur])].filter(Boolean);

export function AssignPopup(p: Props) {

    const [initial] = useState(() => initialOf(p.spec, p.isManager, p.meId));
    const [f, setF] = useState(initial);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);

    const dates = p.spec.mode === "assign" ? p.spec.dates : [];
    const multi = dates.length > 1;
    const ds = multi ? dates : f.date ? [f.date] : [];
    const off = isOff(p.types.find(t => t.code === f.code));
    const set = (patch: Partial<RosterForm>) => setF(x => ({ ...x, ...patch }));

    const missing = [
        ds.length === 0 && "date", !f.membershipId && "employee", !f.code && "shift",
        ...(off ? [] : [!f.area && "area", !f.role && "role", !f.start && "start time", !f.end && "end time"])
    ].filter(Boolean) as string[];
    const valid = missing.length === 0;
    const dirty = JSON.stringify(f) !== JSON.stringify(initial);

    const title = p.spec.mode === "assign" ? "Assign" : p.spec.mode === "edit" ? "Edit Shift" : "Request";
    const submitLabel = p.spec.mode === "assign" ? (p.isManager ? "Save" : "Send request")
        : p.spec.mode === "edit" ? "Save" : (dirty ? "Save" : "Approve");

    function pickShift(code: string) {
        const t = p.types.find(x => x.code === code);
        set({ code, ...(t && !isOff(t) ? { start: t.start ?? f.start, end: t.end ?? f.end } : {}) });
    }

    async function run(fn: () => Promise<string | null>) {
        setBusy(true);
        setErr("");
        const e = await fn();
        setBusy(false);
        if (e) setErr(e); else p.onClose();
    }

    return (
        <div className="plan-modal-backdrop">
            <div className="plan-modal">
                <h3>{title}</h3>

                <label>Date</label>
                {multi
                    ? <input disabled value={dates.map(short).join(", ")} />
                    : <input type="date" value={f.date} onChange={e => set({ date: e.target.value })} />}

                <label>Employee</label>
                <select value={f.membershipId} disabled={!p.isManager} onChange={e => set({ membershipId: e.target.value })}>
                    <option value="">- select -</option>
                    {p.isManager && p.spec.mode !== "request" && <option value={OPEN}>Open Shift</option>}
                    {p.members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>

                <label>Shift</label>
                <select value={f.code} onChange={e => pickShift(e.target.value)}>
                    <option value="">- select -</option>
                    {withCurrent(p.types.map(t => t.code), f.code).map(c => {
                        const t = p.types.find(x => x.code === c);
                        return <option key={c} value={c}>{t ? `${c} - ${t.name}` : c}</option>;
                    })}
                </select>

                {!off && (
                    <>
                        <label>Area</label>
                        <select value={f.area} onChange={e => set({ area: e.target.value })}>
                            <option value="">- select -</option>
                            {withCurrent(p.areas, f.area).map(a => <option key={a} value={a}>{a}</option>)}
                        </select>

                        <label>Role</label>
                        <select value={f.role} onChange={e => set({ role: e.target.value })}>
                            <option value="">- select -</option>
                            {withCurrent(p.roles, f.role).map(r => <option key={r} value={r}>{r}</option>)}
                        </select>

                        <label>Start time</label>
                        <input type="time" value={f.start} onChange={e => set({ start: e.target.value })} />
                        <label>End time</label>
                        <input type="time" value={f.end} onChange={e => set({ end: e.target.value })} />
                    </>
                )}

                {!valid && <div className="plan-entry-meta" style={{ marginTop: 12, color: "#c62828" }}>Please fill in all fields (missing: {missing.join(", ")}).</div>}
                {err && <div className="auth-error">{err}</div>}

                <div className="plan-modal-footer">
                    {p.onDelete && (
                        <button className="danger" disabled={busy} onClick={() => {
                            if (p.spec.mode === "edit" && !confirm("Delete this shift?")) return;
                            void run(p.onDelete!);
                        }}>{p.spec.mode === "edit" ? "Delete" : "Reject"}</button>
                    )}
                    <button onClick={p.onClose}>Cancel</button>
                    <button className="primary" disabled={!valid || busy} onClick={() => run(() => p.onSubmit(f, ds))}>{submitLabel}</button>
                </div>
            </div>
        </div>
    );
}