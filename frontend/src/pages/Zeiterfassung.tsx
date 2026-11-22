// Zeiterfassung: one member, one month. With /manager/crew/:id it is the crew detail page
// (profile card + same timesheet). Data from lib/timesheet.ts.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { startOfMonth, startOfToday } from "../lib/dates";
import { ADJ, clock, dmy, hmm, hms, loadSheet, saveAdjustment, type AdjKind, type Sheet } from "../lib/timesheet";
import type { Membership } from "../lib/types";

const COLUMNS = ["Dates", "Shift", "Check-in", "Pause", "Check-out", "Elapsed", "Soll", "Balance", "Notes"];
const KINDS = Object.keys(ADJ) as AdjKind[];
type AdjForm = Record<AdjKind, { h: string; note: string }>;

const split = (full: string) => { const p = full.trim().split(/\s+/); const last = p.pop() ?? ""; return { first: p.join(" "), last }; };
const toForm = (m: Membership) => ({
    ...(({ first, last }) => ({ first, last }))(split(m.full_name)),
    contract: m.contract ?? "", role: m.role, hours: String(m.weekly_target_hours), phone: m.phone ?? "", email: m.email ?? ""
});

export default function Zeiterfassung() {

    const { id } = useParams();
    const detail = !!id;
    const nav = useNavigate();
    const log = useLog();
    const { org, me, isManager, isAdmin } = useAuth();
    const { settings: user } = useSettings();
    const { say } = useStatus();
    const [month, setMonth] = useState(() => startOfMonth(startOfToday()));
    const [members, setMembers] = useState<Membership[]>([me!]);
    const [target, setTarget] = useState(id ?? me!.id);
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [tick, setTick] = useState(0);
    const [edit, setEdit] = useState<AdjForm | null>(null);
    const [editing, setEditing] = useState(false);
    const [f, setF] = useState(toForm(me!));

    const m = members.find(x => x.id === target) ?? (detail ? null : me!);
    // admin edits everyone, manager only employees
    const canEdit = !!m && (isAdmin || (isManager && m.role === "employee"));

    const loadMembers = useCallback(async () => {
        if (!isManager) return;
        const q = supabase.from("memberships").select("*").eq("organization_id", org!.id);
        const { data } = detail ? await q.eq("id", id!) : await q.eq("active", true).order("full_name");
        setMembers((data ?? []) as Membership[]);
    }, [org, isManager, detail, id]);

    useEffect(() => { setTarget(id ?? me!.id); }, [id, me]);
    useEffect(() => { void loadMembers(); }, [loadMembers]);
    useEffect(() => { if (m) { setF(toForm(m)); setEditing(false); } }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!m) return;
        let stale = false;
        loadSheet(org!.id, m, month, org!.settings ?? {})
            .then(s => { if (!stale) setSheet(s); })
            .catch(e => { console.error(e); say("Failed to load timesheet", "error"); });
        return () => { stale = true; };
    }, [org, m, month, tick]); // eslint-disable-line react-hooks/exhaustive-deps

    const step = (n: number) => setMonth(d => new Date(d.getFullYear(), d.getMonth() + n, 1));
    const monthName = new Intl.DateTimeFormat(user.language, { month: "long", year: "numeric" }).format(month);
    const soon = (what: string) => say(`${what}: coming soon`, "info");
    const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));

    // ---------- profile card ----------

    async function done() {
        const full = `${f.first} ${f.last}`.trim();
        const email = f.email.trim().toLowerCase();
        if (!full || !email) { alert("Name and email are required."); return; }
        const patch = {
            full_name: full, weekly_target_hours: Number(f.hours) || 40, role: m!.role === "admin" ? "admin" : f.role,
            contract: f.contract || null, phone: f.phone.trim() || null, email
        };
        const { error } = await supabase.from("memberships").update(patch).eq("id", m!.id);
        if (error) { alert(error.message); return; }
        setEditing(false);
        if (m!.role !== patch.role) {
            await log("crew.role_changed", `${full}: ${m!.role} \u2192 ${patch.role}`,
                { member_email: email, before_role: m!.role, after_role: patch.role }, "membership", m!.id);
        } else {
            await log("crew.update", `Crew updated: ${full}`, { after: patch }, "membership", m!.id);
        }
        await loadMembers();
        setTick(t => t + 1);
    }

    async function toggleActive() {
        const activate = !m!.active;
        if (m!.role !== "employee" && !activate) {
            const { count } = await supabase.from("memberships").select("id", { count: "exact", head: true })
                .eq("organization_id", org!.id).eq("active", true).neq("role", "employee");
            if ((count ?? 0) <= 1) { alert("Organization must keep at least one active manager/admin."); return; }
        }
        const { error } = await supabase.from("memberships").update({ active: activate }).eq("id", m!.id);
        if (error) { alert(error.message); return; }
        await log(activate ? "crew.reactivate" : "crew.deactivate",
            `${m!.full_name} ${activate ? "reactivated" : "deactivated"}`, {}, "membership", m!.id);
        await loadMembers();
    }

    async function recover() {
        if (!m!.email) { alert("This member has no email yet \u2014 add one first."); return; }
        const { error } = await supabase.auth.resetPasswordForEmail(m!.email, { redirectTo: `${window.location.origin}/reset` });
        if (error) { alert(error.message); return; }
        await supabase.rpc("log_recovery_sent", { p_email: m!.email });
        say(`Recovery email sent to ${m!.email}`, "success");
    }

    // ---------- adjustments (Edit in footer) ----------

    function openEdit() {
        const a = {} as AdjForm;
        KINDS.forEach(k => {
            const s = sheet?.stats.find(x => x.kind === k);
            a[k] = { h: s && s.value ? String(s.value / 3600) : "", note: s?.note ?? "" };
        });
        setEdit(a);
    }

    async function saveEdit() {
        for (const k of KINDS) {
            const hours = Number(edit![k].h.replace(",", ".")) || 0;
            const err = await saveAdjustment(org!.id, m!.id, month, k, hours, edit![k].note, me!.user_id);
            if (err) { say(err, "error"); return; }
        }
        setEdit(null);
        say("Saved", "success");
        setTick(t => t + 1);
    }

    if (!m) return <div className="dsh"><p className="entry-empty">Loading…</p></div>;

    const rows = sheet?.rows ?? [];
    const t = sheet?.totals ?? { elapsed: 0, soll: 0, balance: 0 };
    const roleEditable = canEdit && editing;
    const lock = !editing;

    return (
        <div className="dsh">
            <div className="dsh-h split">
                <h2>{detail ? m.full_name : `Zeiterfassung${isManager && m.id !== me!.id ? ` — ${m.full_name}` : ""}`}</h2>
                <div className="ro-side">
                    {isManager && !detail && (
                        <select className="ro-btn" value={target} onChange={e => setTarget(e.target.value)}>
                            {members.map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}
                        </select>
                    )}
                    {detail && <button className="ro-export" onClick={() => nav("/manager")}>Back</button>}
                    <button className="ro-export" onClick={() => soon("Export")}>Export</button>
                </div>
            </div>

            <div className="zt">
                <div className="zt-left">
                    {detail && (
                        <div className="zt-prof">
                            <div className="zt-prof-top">
                                <span className="mg-av big">{m.full_name.charAt(0).toUpperCase()}</span>
                                <div className="mg-btns">
                                    <button className="mg-btn" disabled={!canEdit} onClick={() => (editing ? done() : setEditing(true))}>{editing ? "Done" : "Edit"}</button>
                                    <button className="mg-btn" disabled={!(m.email && m.active)} onClick={recover}>Recover</button>
                                    <button className="mg-btn" disabled={!canEdit} onClick={toggleActive}>{m.active ? "Deactivate" : "Reactivate"}</button>
                                </div>
                            </div>
                            <label>Last Name</label>
                            <input disabled={lock} value={f.last} onChange={set("last")} />
                            <label>First Name</label>
                            <input disabled={lock} value={f.first} onChange={set("first")} />
                            <label>Contract</label>
                            <select disabled={lock} value={f.contract} onChange={set("contract")}>
                                <option value="">—</option>
                                <option value="vollzeit">Vollzeit</option>
                                <option value="teilzeit">Teilzeit</option>
                                <option value="minijob">Minijob</option>
                            </select>
                            <label>Std/Woche</label>
                            <input disabled={lock} type="number" value={f.hours} onChange={set("hours")} />
                            <label>Role</label>
                            <select disabled={!roleEditable || m.role === "admin"} value={f.role} onChange={set("role")}>
                                <option value="employee">Crew</option>
                                <option value="manager">Manager</option>
                                {m.role === "admin" && <option value="admin">Admin</option>}
                            </select>
                            <label>Phone</label>
                            <input disabled={lock} value={f.phone} onChange={set("phone")} />
                            <label>Email</label>
                            <input disabled={lock} type="email" value={f.email} onChange={set("email")} />
                        </div>
                    )}

                    <aside className="zt-stats">
                        {(sheet?.stats ?? []).map(s => <div key={s.label}><b>{s.label}</b><span>{hmm(s.value)}</span></div>)}
                    </aside>
                </div>

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
        </div>
    );
}