// Zeiterfassung: one member, one month. TimesheetBody is reused by the Manager page.
import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { getMembers } from "../lib/cache";
import { startOfMonth, startOfToday } from "../lib/dates";
import { ADJ, clock, dmy, hmm, hms, loadSheet, saveAdjustment, type AdjKind, type Sheet } from "../lib/timesheet";
import type { Membership } from "../lib/types";

const COLUMNS = ["Dates", "Shift", "Check-in", "Pause", "Check-out", "Elapsed", "Soll", "Balance", "Notes"];
const KINDS = Object.keys(ADJ) as AdjKind[];
type AdjForm = Record<AdjKind, { h: string; note: string }>;

export function TimesheetBody({ m }: { m: Membership }) {

    const { org, me, isManager, isAdmin } = useAuth();
    const { settings: user } = useSettings();
    const { say } = useStatus();
    const [month, setMonth] = useState(() => startOfMonth(startOfToday()));
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [tick, setTick] = useState(0);
    const [edit, setEdit] = useState<AdjForm | null>(null);

    // admin edits everyone, manager only employees
    const canEdit = isAdmin || (isManager && m.role === "employee");

    useEffect(() => {
        let stale = false;
        loadSheet(org!.id, m, month, org!.settings ?? {})
            .then(s => { if (!stale) setSheet(s); })
            .catch(e => { console.error(e); say("Failed to load timesheet", "error"); });
        return () => { stale = true; };
    }, [org, m, month, tick]); // eslint-disable-line react-hooks/exhaustive-deps

    const step = (n: number) => setMonth(d => new Date(d.getFullYear(), d.getMonth() + n, 1));
    const monthName = new Intl.DateTimeFormat(user.language, { month: "long", year: "numeric" }).format(month);
    const soon = (what: string) => say(`${what}: coming soon`, "info");

    function openEdit() {
        const f = {} as AdjForm;
        KINDS.forEach(k => {
            const s = sheet?.stats.find(x => x.kind === k);
            f[k] = { h: s && s.value ? String(s.value / 3600) : "", note: s?.note ?? "" };
        });
        setEdit(f);
    }

    async function saveEdit() {
        for (const k of KINDS) {
            const hours = Number(edit![k].h.replace(",", ".")) || 0;
            const err = await saveAdjustment(org!.id, m.id, month, k, hours, edit![k].note, me!.user_id);
            if (err) { say(err, "error"); return; }
        }
        setEdit(null);
        say("Saved", "success");
        setTick(t => t + 1);
    }

    const rows = sheet?.rows ?? [];
    const t = sheet?.totals ?? { elapsed: 0, soll: 0, balance: 0 };

    return (
        <>
            <div className="zt">
                <aside className="zt-stats">
                    {(sheet?.stats ?? []).map(s => <div key={s.label}><b>{s.label}</b><span>{hmm(s.value)}</span></div>)}
                </aside>

                <div className="ro-panel">
                    <div className="ro-bar">
                        <div className="ro-side"><h2>{monthName}</h2></div>
                        <div className="ro-side">
                            <button className="ro-btn" onClick={() => step(-1)}>Prev.</button>
                            <button className="ro-btn" onClick={() => step(1)}>Next</button>
                        </div>
                        <div className="ro-side">
                            <button className="ro-btn" onClick={() => soon("Filter")}>Filter</button>
                        </div>
                    </div>

                    <div className="zt-table">
                        <table>
                            <thead><tr>{COLUMNS.map(c => <th key={c}>{c}</th>)}</tr></thead>
                            <tbody>
                                {rows.length === 0 && <tr><td colSpan={COLUMNS.length} style={{ color: "#888" }}>No entries.</td></tr>}
                                {rows.map(r => (
                                    <tr key={r.e.id} className={r.counted ? "" : "off"} title={r.counted ? "" : `Status: ${r.e.status}`}>
                                        <td>{r.e.clock_in ? dmy(r.e.clock_in) : "\u2014"}</td>
                                        <td>{r.e.shift_code ?? r.e.shifts?.shift_code ?? "\u2014"}</td>
                                        <td>{clock(r.e.clock_in)}</td>
                                        <td>{hms(r.pause)}</td>
                                        <td>{clock(r.e.clock_out)}</td>
                                        <td>{hms(r.elapsed)}</td>
                                        <td>{hms(r.soll)}</td>
                                        <td>{hms(r.balance)}</td>
                                        <td>{r.e.employee_note || "-"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="ro-foot">
                        <div className="ro-side">
                            {canEdit && <button className="ro-btn" onClick={openEdit}>Edit</button>}
                        </div>
                        <div className="ro-side zt-totals">
                            <span>Total Elapsed = {hms(t.elapsed)}</span>
                            <span>Total Soll = {hms(t.soll)}</span>
                            <span>Total Balance = {hms(t.balance)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {edit && (
                <Modal title={`Edit — ${monthName}`} onClose={() => setEdit(null)} onSubmit={saveEdit}>
                    <p className="plan-entry-meta">Hours (e.g. 1.5). Korrektur may be negative. 0 = delete.</p>
                    {KINDS.map(k => (
                        <div key={k}>
                            <label>{ADJ[k]}</label>
                            <div className="plan-entry-actions">
                                <input type="number" step="0.25" style={{ flex: "0 0 100px" }} value={edit[k].h}
                                    onChange={e => setEdit({ ...edit, [k]: { ...edit[k], h: e.target.value } })} />
                                <input type="text" placeholder="Note" style={{ flex: 1 }} value={edit[k].note}
                                    onChange={e => setEdit({ ...edit, [k]: { ...edit[k], note: e.target.value } })} />
                            </div>
                        </div>
                    ))}
                </Modal>
            )}
        </>
    );
}

export default function Zeiterfassung() {

    const { org, me, isManager } = useAuth();
    const { say } = useStatus();
    const [members, setMembers] = useState<Membership[]>([me!]);
    const [target, setTarget] = useState(me!.id);
    const m = members.find(x => x.id === target) ?? me!;

    useEffect(() => {
        if (!isManager) return;
        void getMembers(org!.id, true, setMembers);
    }, [org, isManager]);

    return (
        <div className="dsh">
            <div className="dsh-h split">
                <h2>Zeiterfassung{isManager && m.id !== me!.id ? ` — ${m.full_name}` : ""}</h2>
                <div className="ro-side">
                    {isManager && (
                        <select className="ro-btn" value={target} onChange={e => setTarget(e.target.value)}>
                            {members.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                        </select>
                    )}
                    <button className="ro-export" onClick={() => say("Export: coming soon", "info")}>Export</button>
                </div>
            </div>
            <TimesheetBody m={m} />
        </div>
    );
}