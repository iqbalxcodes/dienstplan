import { useCallback, useEffect, useState } from "react";
import { Page, Section } from "../components/Page";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { fmt, toLocalInput } from "../lib/dates";
import { fetchEvidence } from "../lib/complaints";
import { findShiftConflicts } from "../lib/shifts";
import { LEAVE_LABELS, type Membership, type TimeEntry } from "../lib/types";

const now = () => new Date().toISOString();
const Empty = ({ text }: { text: string }) => <p style={{ color: "#888" }}>{text}</p>;

async function uid() {
    return (await supabase.auth.getUser()).data.user?.id ?? null;
}

// ---------------- Approvals: time entries + shift change requests ----------------

function Approvals() {

    const { org } = useAuth();
    const log = useLog();
    const [entries, setEntries] = useState<any[]>([]);
    const [changes, setChanges] = useState<any[]>([]);
    const [edit, setEdit] = useState<{ id: string; inn: string; out: string; note: string; before: TimeEntry } | null>(null);

    const load = useCallback(async () => {
        const [e, c] = await Promise.all([
            supabase.from("time_entries").select("*, memberships:membership_id(full_name)")
                .eq("organization_id", org!.id).eq("status", "pending").order("created_at", { ascending: false }),
            supabase.from("shift_change_requests").select("*, memberships:requested_by_membership_id(full_name)")
                .eq("organization_id", org!.id).eq("status", "pending").order("created_at", { ascending: false })
        ]);
        setEntries(e.data ?? []);
        setChanges(c.data ?? []);
    }, [org]);

    useEffect(() => { void load(); }, [load]);

    const review = async (id: string, status: "approved" | "rejected") => {
        await supabase.from("time_entries").update({ status, approved_by: await uid(), approved_at: now() }).eq("id", id);
        void load();
    };

    async function saveEdit() {
        if (!edit || !edit.inn || !edit.out) return;
        const inIso = new Date(edit.inn).toISOString();
        const outIso = new Date(edit.out).toISOString();

        await supabase.from("time_entries").update({
            clock_in: inIso, clock_out: outIso, source: "manager", status: "approved",
            manager_note: edit.note || null, approved_by: await uid(), approved_at: now(), updated_at: now()
        }).eq("id", edit.id);

        await log("time.manual_edit", "Manual time edit applied", {
            before_in: edit.before.clock_in, before_out: edit.before.clock_out,
            after_in: inIso, after_out: outIso, note: edit.note
        }, "time_entry", edit.id);

        setEdit(null);
        void load();
    }

    async function approveChange(req: any) {
        const { data: shift } = await supabase.from("shifts").select("membership_id").eq("id", req.shift_id).single();
        if (!shift) return;

        const { conflicts, error } = await findShiftConflicts(
            req.organization_id, shift.membership_id, req.proposed_shift_date,
            req.proposed_start_time, req.proposed_end_time, req.shift_id
        );
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
            <h3 className="dash-sub">Pending Check-in / Check-out</h3>
            {entries.length === 0 ? <Empty text="Nothing pending." /> : entries.map(e => (
                <div key={e.id} className="plan-entry-card status-pending">
                    <div>
                        <strong>{e.memberships?.full_name ?? "Unknown"}</strong>
                        <div className="plan-entry-meta">In: {fmt(e.clock_in)} · Out: {fmt(e.clock_out)}</div>
                        {e.employee_note && <div className="plan-entry-meta">Note: {e.employee_note}</div>}
                    </div>
                    <div className="plan-entry-actions">
                        <button className="btn-approve" onClick={() => review(e.id, "approved")}>Approve</button>
                        <button onClick={() => setEdit({
                            id: e.id, before: e, note: "",
                            inn: e.clock_in ? toLocalInput(e.clock_in) : "", out: e.clock_out ? toLocalInput(e.clock_out) : ""
                        })}>Edit</button>
                        <button className="btn-reject" onClick={() => review(e.id, "rejected")}>Reject</button>
                    </div>
                </div>
            ))}

            <h3 className="dash-sub">Pending Shift Change Requests</h3>
            {changes.length === 0 ? <Empty text="Nothing pending." /> : changes.map(r => (
                <div key={r.id} className="plan-entry-card status-pending">
                    <div>
                        <strong>{r.memberships?.full_name ?? "Unknown"}</strong>
                        <div className="plan-entry-meta">
                            Proposed: {r.proposed_shift_date} · {r.proposed_start_time.slice(0, 5)}–{r.proposed_end_time.slice(0, 5)}
                        </div>
                    </div>
                    <div className="plan-entry-actions">
                        <button className="btn-approve" onClick={() => approveChange(r)}>Approve</button>
                        <button className="btn-reject" onClick={() => rejectChange(r.id)}>Reject</button>
                    </div>
                </div>
            ))}

            {edit && (
                <Modal title="Set Time Manually" onClose={() => setEdit(null)} onSubmit={saveEdit}>
                    <label>Clock In</label>
                    <input type="datetime-local" value={edit.inn} onChange={e => setEdit({ ...edit, inn: e.target.value })} />
                    <label>Clock Out</label>
                    <input type="datetime-local" value={edit.out} onChange={e => setEdit({ ...edit, out: e.target.value })} />
                    <label>Manager note (shown to employee)</label>
                    <textarea placeholder="Explain the adjustment" value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} />
                </Modal>
            )}
        </>
    );
}

// ---------------- Complaints ----------------

function Complaints() {

    const { org } = useAuth();
    const [list, setList] = useState<any[]>([]);

    const load = useCallback(async () => {
        const { data } = await supabase.from("complaints")
            .select("*, memberships:membership_id(full_name), time_entries:time_entry_id(clock_in, clock_out, original_clock_in, original_clock_out)")
            .eq("organization_id", org!.id).order("created_at", { ascending: false });

        setList(await Promise.all((data ?? []).map(async (c: any) => ({ ...c, evidence: await fetchEvidence(c.id) }))));
    }, [org]);

    useEffect(() => { void load(); }, [load]);

    async function resolve(id: string, outcome: "resolved" | "rejected") {
        const note = window.prompt("Resolution note (visible to the employee):") ?? "";
        const { error } = await supabase.from("complaints").update({
            status: outcome, resolution_note: note, resolved_by: await uid(), resolved_at: now()
        }).eq("id", id);
        if (error) { alert(error.message); return; }
        void load();
    }

    if (list.length === 0) return <Empty text="No complaints filed." />;

    return (
        <>
            {list.map(c => (
                <div key={c.id} className="plan-complaint-card">
                    <strong>{c.memberships?.full_name ?? "Unknown"}</strong>{" "}
                    <span className={`status-badge status-${c.status}`}>{c.status}</span>
                    <p>{c.message}</p>
                    <div className="plan-entry-meta">
                        Approved time — In: {fmt(c.time_entries?.clock_in)}, Out: {fmt(c.time_entries?.clock_out)}
                        <br />
                        Original submission — In: {fmt(c.time_entries?.original_clock_in)}, Out: {fmt(c.time_entries?.original_clock_out)}
                    </div>
                    <div>
                        {c.evidence.map((ev: any) => (
                            <a key={ev.id} href={ev.url} target="_blank" rel="noreferrer">
                                <img className="evidence-thumb" src={ev.url} alt={ev.file_name} />
                            </a>
                        ))}
                    </div>
                    {c.status === "open"
                        ? (
                            <div className="plan-entry-actions" style={{ marginTop: 8 }}>
                                <button className="btn-approve" onClick={() => resolve(c.id, "resolved")}>Mark Resolved</button>
                                <button className="btn-reject" onClick={() => resolve(c.id, "rejected")}>Reject</button>
                            </div>
                        )
                        : c.resolution_note && <div className="plan-entry-meta">Resolution: {c.resolution_note}</div>}
                </div>
            ))}
        </>
    );
}

// ---------------- Leave requests ----------------

function LeavePanel() {

    const { org } = useAuth();
    const [list, setList] = useState<any[]>([]);

    const load = useCallback(async () => {
        const { data } = await supabase.from("leave_requests").select("*, memberships:membership_id(full_name)")
            .eq("organization_id", org!.id).order("created_at", { ascending: false });
        setList(data ?? []);
    }, [org]);

    useEffect(() => { void load(); }, [load]);

    async function review(id: string, approve: boolean) {
        await supabase.from("leave_requests")
            .update({ status: approve ? "approved" : "rejected", reviewed_by: await uid(), reviewed_at: now() }).eq("id", id);
        void load();
    }

    if (list.length === 0) return <Empty text="No leave requests." />;

    return (
        <>
            {list.map(r => (
                <div key={r.id} className={`plan-entry-card status-${r.status}`}>
                    <div>
                        <strong>{r.memberships?.full_name ?? "Unknown"}</strong> — {LEAVE_LABELS[r.type as keyof typeof LEAVE_LABELS]}
                        <div className="plan-entry-meta">{r.date_start} → {r.date_end}</div>
                        {r.reason && <div className="plan-entry-meta">{r.reason}</div>}
                    </div>
                    {r.status === "pending" && (
                        <div className="plan-entry-actions">
                            <button className="btn-approve" onClick={() => review(r.id, true)}>Approve</button>
                            <button className="btn-reject" onClick={() => review(r.id, false)}>Reject</button>
                        </div>
                    )}
                </div>
            ))}
        </>
    );
}

// ---------------- Crew ----------------
// Members can exist WITHOUT a login (user_id = null); they get one later via "Resend Recovery".

function Crew() {

    const { org } = useAuth();
    const log = useLog();
    const [list, setList] = useState<Membership[]>([]);
    const [add, setAdd] = useState({ name: "", email: "", role: "employee", hours: "" });
    const [edit, setEdit] = useState<Membership | null>(null);

    const load = useCallback(async () => {
        const { data } = await supabase.from("memberships").select("*").eq("organization_id", org!.id).order("full_name");
        setList((data ?? []) as Membership[]);
    }, [org]);

    useEffect(() => { void load(); }, [load]);

    async function addMember() {
        const fullName = add.name.trim();
        const email = add.email.trim().toLowerCase();
        const hours = Number(add.hours) || 40;
        if (!fullName || !email) { alert("Full name and email are required."); return; }

        const { error } = await supabase.from("memberships").insert({
            organization_id: org!.id, user_id: null, email, role: add.role, full_name: fullName, weekly_target_hours: hours
        });
        if (error) { alert(error.message); return; }

        await log("crew.add", `Crew added: ${fullName}`, { email, role: add.role, weekly_hours: hours });
        setAdd({ ...add, name: "", email: "" });
        void load();
    }

    async function saveEdit() {
        if (!edit) return;
        const before = list.find(m => m.id === edit.id)!;
        const patch = {
            full_name: edit.full_name.trim(),
            weekly_target_hours: Number(edit.weekly_target_hours) || 40,
            role: edit.role,
            email: (edit.email ?? "").trim().toLowerCase()
        };
        if (!patch.full_name || !patch.email) { alert("Name and email are required."); return; }

        setEdit(null);
        const { error } = await supabase.from("memberships").update(patch).eq("id", edit.id);
        if (error) { alert(error.message); void load(); return; }

        // role changes are the most security-sensitive action: logged separately
        if (before.role !== patch.role) {
            await log("crew.role_changed", `${patch.full_name}: ${before.role} \u2192 ${patch.role}`,
                { member_email: patch.email, before_role: before.role, after_role: patch.role }, "membership", edit.id);
        } else {
            await log("crew.update", `Crew updated: ${patch.full_name}`, { after: patch }, "membership", edit.id);
        }
        void load();
    }

    async function toggleActive(m: Membership, activate: boolean) {
        // client-side mirror of the "keep at least one active manager/admin" rule
        if (m.role !== "employee" && !activate) {
            const leaders = list.filter(x => x.active && x.role !== "employee");
            if (leaders.length <= 1) { alert("Organization must keep at least one active manager/admin."); return; }
        }

        const { error } = await supabase.from("memberships").update({ active: activate }).eq("id", m.id);
        if (error) { alert(error.message); void load(); return; }

        await log(activate ? "crew.reactivate" : "crew.deactivate",
            `${m.full_name} ${activate ? "reactivated" : "deactivated"}`, {}, "membership", m.id);
        void load();
    }

    async function resendRecovery(m: Membership) {
        if (!m.email) { alert("This member has no email yet \u2014 add one first."); return; }

        const { error } = await supabase.auth.resetPasswordForEmail(m.email, { redirectTo: `${window.location.origin}/reset` });
        if (error) { alert(error.message); return; }

        // recorded server-side (works even when the target has no session)
        await supabase.rpc("log_recovery_sent", { p_email: m.email });
        alert(`Recovery email sent to ${m.email}.`);
    }

    return (
        <>
            <Section title="Add Crew Member">
            <p className="plan-entry-meta" style={{ marginTop: 0 }}>
                Members appear on the roster immediately. Login accounts can be provisioned later by the Admin — until then
                their status shows “login not set up”.
            </p>
            <div className="manager-form-row manager-required" style={{ marginTop: 10 }}>
                <input type="text" placeholder="Full name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
                <input type="email" placeholder="Email (for login later)" value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} />
                <select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}>
                    <option value="employee">Crew</option>
                    <option value="manager">Chief/Bos</option>
                </select>
                <input type="number" placeholder="Weekly hours (e.g. 40)" value={add.hours} onChange={e => setAdd({ ...add, hours: e.target.value })} />
                <button onClick={addMember}>Add</button>
            </div>

            </Section>

            <Section title="Crew Members">
            <div id="crewList">
                {list.map(m => (
                    <div key={m.id} className={"plan-entry-card" + (m.active ? "" : " status-rejected")}>
                        <div>
                            <strong>{m.full_name}</strong>{" "}
                            <span title={m.user_id ? "Has login" : "Login not set up yet"}>{m.user_id ? "\ud83d\udfe2" : "\ud83d\udfe1"}</span>{" "}
                            <span className="status-badge">{m.role}</span>{" "}
                            {!m.active && <span className="status-badge status-rejected">inactive</span>}
                            <div className="plan-entry-meta">{m.email ?? "no email"} · {m.weekly_target_hours}h/week</div>
                        </div>
                        <div className="plan-entry-actions">
                            <button onClick={() => setEdit({ ...m })}>Edit</button>
                            <button disabled={!(m.email && m.active)} onClick={() => resendRecovery(m)}>Resend Recovery</button>
                            <button onClick={() => toggleActive(m, !m.active)}>{m.active ? "Deactivate" : "Reactivate"}</button>
                        </div>
                    </div>
                ))}
            </div>
            </Section>

            {edit && (
                <Modal title="Edit Crew Member" onClose={() => setEdit(null)} onSubmit={saveEdit}>
                    <label>Full name</label>
                    <input type="text" value={edit.full_name} onChange={e => setEdit({ ...edit, full_name: e.target.value })} />
                    <label>Weekly target hours</label>
                    <input type="number" value={edit.weekly_target_hours} onChange={e => setEdit({ ...edit, weekly_target_hours: e.target.value as any })} />
                    <label>Role</label>
                    {/* admin accounts cannot be edited here: clamp display to manager */}
                    <select value={edit.role === "admin" ? "manager" : edit.role} onChange={e => setEdit({ ...edit, role: e.target.value as Membership["role"] })}>
                        <option value="employee">Crew</option>
                        <option value="manager">Chief/Bos</option>
                    </select>
                    <label>Email (for login &amp; recovery)</label>
                    <input type="email" value={edit.email ?? ""} onChange={e => setEdit({ ...edit, email: e.target.value })} />
                </Modal>
            )}
        </>
    );
}

export default function Manager() {
    return (
        <Page title="Manager">
            <div className="dash-stack">
                <Section title="Pending Approvals"><Approvals /></Section>
                <Section title="Complaints"><Complaints /></Section>
                <Section title="Leave Requests"><LeavePanel /></Section>
                <Crew />
            </div>
        </Page>
    );
}
