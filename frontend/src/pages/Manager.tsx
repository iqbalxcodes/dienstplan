// Manager: Crew cards, Pending Shift Approval, Complaints, Leave Request.
// Edit = inline edit mode (Edit->Done, Approve->Delete).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleArrowOutUpRight, CircleArrowRight, Clock, FileText, MapPin } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { addDays, duration, fmtDT, parseDate, toLocalInput } from "../lib/dates";
import { fetchEvidence } from "../lib/complaints";
import { findShiftConflicts } from "../lib/shifts";
import { LEAVE_LABELS, type LeaveType, type Membership } from "../lib/types";
import { Modal } from "../components/Modal";

const now = () => new Date().toISOString();
const uid = async () => (await supabase.auth.getUser()).data.user?.id ?? null;
const Empty = ({ text }: { text: string }) => <p className="entry-empty">{text}</p>;
const split = (full: string) => { const p = full.trim().split(/\s+/); const last = p.pop() ?? ""; return { first: p.join(" "), last }; };
const dmy = (s: string) => s.split("-").reverse().join(".");
const ROLE: Record<string, string> = { employee: "Crew", manager: "Manager", admin: "Admin" };

function Head({ title, exp = true }: { title: string; exp?: boolean }) {
    const { say } = useStatus();
    return (
        <div className="dsh-h split">
            <h2>{title}</h2>
            {exp && <button className="ro-export" onClick={() => say("Export: coming soon", "info")}>Export</button>}
        </div>
    );
}

// ---------------- shared time-entry actions ----------------

function useEntryOps(reload: () => void) {
    const log = useLog();
    return {
        async save(e: any, inn: string, out: string) {
            const { error } = await supabase.from("time_entries")
                .update({ clock_in: inn, clock_out: out, source: "manager", updated_at: now() }).eq("id", e.id);
            if (error) { alert(error.message); return; }
            await log("time.manual_edit", "Manual time edit applied",
                { before_in: e.clock_in, before_out: e.clock_out, after_in: inn, after_out: out }, "time_entry", e.id);
            reload();
        },
        async approve(id: string) {
            const { error } = await supabase.from("time_entries")
                .update({ status: "approved", approved_by: await uid(), approved_at: now() }).eq("id", id);
            if (error) alert(error.message);
            reload();
        }
    };
}

interface RowProps {
    e: any;                                   // time_entry + memberships + shifts
    text: ReactNode;
    onSave: (inn: string, out: string) => Promise<void>;
    onApprove: () => void;
    onDelete: () => void;
}

/** One entry card. Edit mode: times editable, Edit->Done, Approve->Delete. */
function EntryRow({ e, text, onSave, onApprove, onDelete }: RowProps) {

    const [edit, setEdit] = useState(false);
    const [inn, setInn] = useState("");
    const [out, setOut] = useState("");

    const start = () => {
        setInn(e.clock_in ? toLocalInput(e.clock_in) : "");
        setOut(e.clock_out ? toLocalInput(e.clock_out) : "");
        setEdit(true);
    };
    async function done() {
        if (inn && out) await onSave(new Date(inn).toISOString(), new Date(out).toISOString());
        setEdit(false);
    }

    const a = edit ? inn : e.clock_in, b = edit ? out : e.clock_out;
    const area = [e.area_label ?? e.shifts?.area_label, e.role_label ?? e.shifts?.role_label].filter(Boolean).join(" - ");

    return (
        <div className="entry-card" style={{ "--c": "#dba43d" } as React.CSSProperties}>
            <strong>{e.memberships?.full_name ?? "Unknown"}</strong>
            <b>{e.shift_code ?? e.shifts?.shift_code ?? "\u2014"}</b>
            <span className="entry-item"><MapPin size={22} />{area || "\u2014"}</span>
            {edit ? (
                <>
                    <span className="entry-item"><CircleArrowRight size={22} /><input className="mg-in" type="datetime-local" value={inn} onChange={x => setInn(x.target.value)} /></span>
                    <span className="entry-item"><CircleArrowOutUpRight size={22} /><input className="mg-in" type="datetime-local" value={out} onChange={x => setOut(x.target.value)} /></span>
                </>
            ) : (
                <>
                    <span className="entry-item"><CircleArrowRight size={22} />{fmtDT(e.clock_in)}</span>
                    <span className="entry-item"><CircleArrowOutUpRight size={22} />{fmtDT(e.clock_out)}</span>
                </>
            )}
            <span className="entry-item"><Clock size={22} />{a && b ? duration(a, b) : "\u2014"}</span>
            <span className="entry-item"><FileText size={22} /><span className="entry-note">{text || "-"}</span></span>
            <div className="mg-act">
                <button className="mg-btn" onClick={edit ? done : start}>{edit ? "Done" : "Edit"}</button>
                <button className="mg-btn" onClick={edit ? onDelete : onApprove}>{edit ? "Delete" : "Approve"}</button>
            </div>
        </div>
    );
}

// ---------------- Pending Shift Approval ----------------

function Approvals() {

    const { org } = useAuth();
    const log = useLog();
    const [entries, setEntries] = useState<any[]>([]);
    const [changes, setChanges] = useState<any[]>([]);

    const load = useCallback(async () => {
        const [e, c] = await Promise.all([
            supabase.from("time_entries").select("*, memberships:membership_id(full_name), shifts:shift_id(*)")
                .eq("organization_id", org!.id).eq("status", "pending").not("clock_out", "is", null)
                .order("created_at", { ascending: false }),
            supabase.from("shift_change_requests").select("*, memberships:requested_by_membership_id(full_name)")
                .eq("organization_id", org!.id).eq("status", "pending").order("created_at", { ascending: false })
        ]);
        setEntries(e.data ?? []);
        setChanges(c.data ?? []);
    }, [org]);

    useEffect(() => { void load(); }, [load]);
    const ops = useEntryOps(load);

    async function remove(id: string) {
        if (!confirm("Delete this entry permanently?")) return;
        const { error } = await supabase.from("time_entries").delete().eq("id", id);
        if (error) { alert(error.message); return; }
        void load();
    }

    async function approveChange(req: any) {
        const { data: shift } = await supabase.from("shifts").select("membership_id").eq("id", req.shift_id).single();
        if (!shift) return;
        const { conflicts, error } = await findShiftConflicts(
            req.organization_id, shift.membership_id, req.proposed_shift_date,
            req.proposed_start_time, req.proposed_end_time, req.shift_id);
        if (error) { alert("Failed to check for conflicts"); return; }
        if (conflicts.length) { alert("Cannot approve \u2014 this overlaps another shift"); return; }

        await supabase.from("shifts").update({
            shift_date: req.proposed_shift_date, start_time: req.proposed_start_time,
            end_time: req.proposed_end_time, updated_at: now()
        }).eq("id", req.shift_id);
        await supabase.from("shift_change_requests")
            .update({ status: "approved", reviewed_by: await uid(), reviewed_at: now() }).eq("id", req.id);
        await log("shift.change_approved", `Shift change approved for ${req.proposed_shift_date}`, {
            proposed_date: req.proposed_shift_date, proposed_start: req.proposed_start_time, proposed_end: req.proposed_end_time
        }, "shift", req.shift_id);
        void load();
    }

    async function rejectChange(id: string) {
        await supabase.from("shift_change_requests")
            .update({ status: "rejected", reviewed_by: await uid(), reviewed_at: now() }).eq("id", id);
        void load();
    }

    return (
        <>
            {entries.length === 0 && changes.length === 0 && <Empty text="Nothing pending." />}

            {entries.map(e => (
                <EntryRow key={e.id} e={e} text={e.employee_note}
                    onSave={(i, o) => ops.save(e, i, o)} onApprove={() => ops.approve(e.id)} onDelete={() => remove(e.id)} />
            ))}

            {changes.map(r => (
                <div key={r.id} className="entry-card" style={{ "--c": "#dba43d" } as React.CSSProperties}>
                    <strong>{r.memberships?.full_name ?? "Unknown"}</strong>
                    <span className="entry-item">Shift change: {dmy(r.proposed_shift_date)} · {r.proposed_start_time.slice(0, 5)}–{r.proposed_end_time.slice(0, 5)}</span>
                    <div className="mg-act">
                        <button className="mg-btn" onClick={() => rejectChange(r.id)}>Reject</button>
                        <button className="mg-btn" onClick={() => approveChange(r)}>Approve</button>
                    </div>
                </div>
            ))}
        </>
    );
}

// ---------------- Complaints ----------------
// Approve = time entry approved + complaint resolved. Delete = complaint rejected (closed).

function Complaints() {

    const { org } = useAuth();
    const [list, setList] = useState<any[]>([]);

    const load = useCallback(async () => {
        const { data } = await supabase.from("complaints")
            .select("*, memberships:membership_id(full_name), time_entries:time_entry_id(*, shifts:shift_id(*))")
            .eq("organization_id", org!.id).eq("status", "open").order("created_at", { ascending: false });
        setList(await Promise.all((data ?? []).map(async (c: any) => ({ ...c, evidence: await fetchEvidence(c.id) }))));
    }, [org]);

    useEffect(() => { void load(); }, [load]);
    const ops = useEntryOps(load);

    async function close(id: string, status: "resolved" | "rejected") {
        const { error } = await supabase.from("complaints")
            .update({ status, resolved_by: await uid(), resolved_at: now() }).eq("id", id);
        if (error) alert(error.message);
    }

    if (list.length === 0) return <Empty text="No open complaints." />;

    return (
        <>
            {list.map(c => {
                const e = { ...c.time_entries, memberships: c.memberships };
                return (
                    <EntryRow key={c.id} e={e}
                        text={<>{c.message}{c.evidence.map((ev: any, i: number) => (
                            <a key={ev.id} href={ev.url} target="_blank" rel="noreferrer"> [{i + 1}]</a>
                        ))}</>}
                        onSave={(i, o) => ops.save(e, i, o)}
                        onApprove={async () => { await ops.approve(c.time_entry_id); await close(c.id, "resolved"); void load(); }}
                        onDelete={async () => { if (!confirm("Delete this complaint?")) return; await close(c.id, "rejected"); void load(); }} />
                );
            })}
        </>
    );
}

// ---------------- Leave Request ----------------

function LeavePanel() {

    const { org } = useAuth();
    const [list, setList] = useState<any[]>([]);

    const load = useCallback(async () => {
        const { data } = await supabase.from("leave_requests").select("*, memberships:membership_id(full_name)")
            .eq("organization_id", org!.id).eq("status", "pending").order("created_at", { ascending: false });
        setList(data ?? []);
    }, [org]);

    useEffect(() => { void load(); }, [load]);

    async function review(id: string, approve: boolean) {
        await supabase.from("leave_requests")
            .update({ status: approve ? "approved" : "rejected", reviewed_by: await uid(), reviewed_at: now() }).eq("id", id);
        void load();
    }

    const count = (a: string, b: string, type: string) => {
        let n = 0;
        for (let d = parseDate(a), e = parseDate(b); d <= e; d = addDays(d, 1)) if (type !== "urlaub" || d.getDay() % 6) n++;
        return n;
    };

    if (list.length === 0) return <Empty text="No pending leave requests." />;

    return (
        <>
            {list.map(r => (
                <div key={r.id} className="entry-card" style={{ "--c": "#dba43d" } as React.CSSProperties}>
                    <strong>{LEAVE_LABELS[r.type as LeaveType]}</strong>
                    <strong>{r.memberships?.full_name ?? "Unknown"}</strong>
                    <span className="entry-item">Start {dmy(r.date_start)}</span>
                    <span className="entry-item">End {dmy(r.date_end)}</span>
                    <span className="entry-item">Duration {count(r.date_start, r.date_end, r.type)} Days</span>
                    <span className="entry-item"><FileText size={22} /><span className="entry-note">{r.reason || "-"}</span></span>
                    <div className="mg-act">
                        <button className="mg-btn" onClick={() => review(r.id, false)}>Reject</button>
                        <button className="mg-btn" onClick={() => review(r.id, true)}>Approve</button>
                    </div>
                </div>
            ))}
        </>
    );
}

// ---------------- Crew ----------------

const BLANK = { first: "", last: "", role: "employee", contract: "", hours: "40", job: "", phone: "", email: "" };

function Crew() {

    const { org } = useAuth();
    const log = useLog();
    const { say } = useStatus();
    const [list, setList] = useState<Membership[]>([]);
    const [edit, setEdit] = useState<Membership | null>(null);
    const [d, setD] = useState(BLANK);

    const load = useCallback(async () => {
        const { data } = await supabase.from("memberships").select("*").eq("organization_id", org!.id).order("full_name");
        setList((data ?? []) as Membership[]);
    }, [org]);

    useEffect(() => { void load(); }, [load]);

    const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setD(x => ({ ...x, [k]: e.target.value }));

    function start(m: Membership) {
        const n = split(m.full_name);
        setEdit(m);
        setD({
            first: n.first, last: n.last, role: m.role, contract: m.contract ?? "", hours: String(m.weekly_target_hours),
            job: m.job_title ?? "", phone: m.phone ?? "", email: m.email ?? ""
        });
    }

    async function done() {
        const m = edit!;
        const full = `${d.first} ${d.last}`.trim();
        const email = d.email.trim().toLowerCase();
        if (!full || !email) { alert("Name and email are required."); return; }

        const patch = {
            full_name: full, weekly_target_hours: Number(d.hours) || 40, role: m.role === "admin" ? "admin" : d.role,
            contract: d.contract || null, job_title: d.job.trim() || null, phone: d.phone.trim() || null, email
        };
        const { error } = await supabase.from("memberships").update(patch).eq("id", m.id);
        if (error) { alert(error.message); return; }
        setEdit(null);

        if (m.role !== patch.role) {
            await log("crew.role_changed", `${full}: ${m.role} \u2192 ${patch.role}`,
                { member_email: email, before_role: m.role, after_role: patch.role }, "membership", m.id);
        } else {
            await log("crew.update", `Crew updated: ${full}`, { after: patch }, "membership", m.id);
        }
        void load();
    }

    async function toggleActive(m: Membership) {
        const activate = !m.active;
        if (m.role !== "employee" && !activate && list.filter(x => x.active && x.role !== "employee").length <= 1) {
            alert("Organization must keep at least one active manager/admin.");
            return;
        }
        const { error } = await supabase.from("memberships").update({ active: activate }).eq("id", m.id);
        if (error) { alert(error.message); return; }
        await log(activate ? "crew.reactivate" : "crew.deactivate",
            `${m.full_name} ${activate ? "reactivated" : "deactivated"}`, {}, "membership", m.id);
        void load();
    }

    async function recover(m: Membership) {
        if (!m.email) { alert("This member has no email yet \u2014 add one first."); return; }
        const { error } = await supabase.auth.resetPasswordForEmail(m.email, { redirectTo: `${window.location.origin}/reset` });
        if (error) { alert(error.message); return; }
        await supabase.rpc("log_recovery_sent", { p_email: m.email });
        say(`Recovery email sent to ${m.email}`, "success");
    }

    return (
        <div className="ro-panel">
            <div className="ro-bar">
                <div className="ro-side"><button className="ro-btn" onClick={() => say("Add: coming soon", "info")}>Add</button></div>
                <div className="ro-side"><button className="ro-btn" onClick={() => say("Filter: coming soon", "info")}>Filter</button></div>
            </div>

            <div className="mg-crew">
                {list.map(m => {
                    const n = split(m.full_name);
                    return (
                        <div key={m.id} className={"mg-card" + (m.active ? "" : " off")}>
                            <span className="mg-av">{m.full_name.charAt(0).toUpperCase()}</span>

                            <div className="mg-head">
                                <div>{m.active ? "Active" : "Deactivated"} - {ROLE[m.role]}</div>
                                <div>{n.last.toUpperCase()}{n.first && ","} {n.first.toUpperCase()}</div>
                            </div>

                            <div className="mg-body">
                                <div>{[m.contract?.toUpperCase(), `${m.weekly_target_hours} Std/Woche`, m.job_title].filter(Boolean).join(" - ")}</div>
                                <div>{[m.phone, m.email].filter(Boolean).join(" - ") || "\u2014"}</div>
                            </div>

                            <div className="mg-btns">
                                <button className="mg-btn" onClick={() => start(m)}>Edit</button>
                                <button className="mg-btn" disabled={!(m.email && m.active)} onClick={() => recover(m)}>Recover</button>
                                <button className="mg-btn" onClick={() => toggleActive(m)}>{m.active ? "Deactivate" : "Reactivate"}</button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {edit && (
                <Modal title="Edit Crew Member" onClose={() => setEdit(null)} onSubmit={done} submitLabel="Done">
                    {edit.role !== "admin" && (
                        <>
                            <label>Role</label>
                            <select value={d.role} onChange={set("role")}>
                                <option value="employee">Crew</option>
                                <option value="manager">Manager</option>
                            </select>
                        </>
                    )}
                    <label>First name</label>
                    <input type="text" value={d.first} onChange={set("first")} />
                    <label>Last name</label>
                    <input type="text" value={d.last} onChange={set("last")} />
                    <label>Vertrag</label>
                    <select value={d.contract} onChange={set("contract")}>
                        <option value="">—</option>
                        <option value="vollzeit">Vollzeit</option>
                        <option value="teilzeit">Teilzeit</option>
                        <option value="minijob">Minijob</option>
                    </select>
                    <label>Std/Woche</label>
                    <input type="number" value={d.hours} onChange={set("hours")} />
                    <label>Job (e.g. Servicefachkraft)</label>
                    <input type="text" value={d.job} onChange={set("job")} />
                    <label>Phone</label>
                    <input type="text" placeholder="+49…" value={d.phone} onChange={set("phone")} />
                    <label>Email</label>
                    <input type="email" value={d.email} onChange={set("email")} />
                </Modal>
            )}
        </div>
    );
}

export default function Manager() {
    return (
        <div className="dsh">
            <Head title="Crew" />
            <Crew />
            <Head title="Pending Shift Approval" />
            <Approvals />
            <Head title="Complaints" />
            <Complaints />
            <Head title="Leave Request" exp={false} />
            <LeavePanel />
        </div>
    );
}