// Activity log. Same look as Zeiterfassung (blue bar + zt-table + blue footer).
// Filter button opens the search/action/member filter. Click a row = details. Only admin can delete.
import { Fragment, useCallback, useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { iso } from "../lib/dates";

const PER_PAGE = 20;

const COLUMNS = [
    { key: "time", label: "Time", dbKey: "created_at" },
    { key: "member", label: "Member", dbKey: "memberships(full_name)" },
    { key: "action", label: "Action", dbKey: "action" },
    { key: "summary", label: "Summary", dbKey: "summary" }
];

const ACTION_LABELS: Record<string, string> = {
    "attendance.check_in": "Check In", "attendance.check_out": "Check Out",
    "settings.update": "Settings Changed",
    "crew.add": "Crew Added", "crew.update": "Crew Updated", "crew.deactivate": "Crew Deactivated",
    "crew.reactivate": "Crew Reactivated", "crew.role_changed": "Role Changed",
    "shift.reschedule": "Shift Moved", "shift.change_approved": "Shift Change Approved",
    "time.manual_edit": "Manual Time Edit",
    "leave.requested": "Leave Requested", "leave.approved": "Leave Approved", "leave.rejected": "Leave Rejected",
    "auth.login": "Login", "auth.logout": "Logout", "recovery.sent": "Recovery Sent", "export.performed": "Data Exported"
};

const actionClass = (a: string) => "act-" + (["attendance", "settings", "crew", "shift", "auth", "export"].find(p => a.startsWith(p + ".")) ?? "system");
const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const de = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

interface Filter { search: string; action: string; member: string; }
const NONE: Filter = { search: "", action: "all", member: "all" };

export default function History() {

    const { org, isAdmin } = useAuth();
    const log = useLog();
    const { say } = useStatus();

    const [rows, setRows] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<Filter>(NONE);
    const [draft, setDraft] = useState<Filter | null>(null);      // non-null = filter popup open
    const [members, setMembers] = useState<{ id: string; full_name: string }[]>([]);
    const [sortCol, setSortCol] = useState("time");
    const [sortDir, setSortDir] = useState<Record<string, "asc" | "desc">>({ time: "desc" });
    const [expanded, setExpanded] = useState<string | null>(null);

    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    const active = filter.search.trim() !== "" || filter.action !== "all" || filter.member !== "all";

    const base = useCallback((forCount: boolean) => {
        let b = supabase.from("activity_log")
            .select("*, memberships:actor_membership_id(full_name)", forCount ? { count: "exact", head: true } : undefined)
            .eq("organization_id", org!.id);
        if (filter.member !== "all") b = b.eq("actor_membership_id", filter.member);
        if (filter.action !== "all") b = b.eq("action", filter.action);
        const kw = filter.search.trim();
        if (kw) b = b.or(`summary.ilike.%${kw}%,action.ilike.%${kw}%`);
        return b;
    }, [org, filter]);

    const sorted = useCallback((b: any) => {
        const def = COLUMNS.find(c => c.key === sortCol)!;
        return b.order(def.dbKey, { ascending: sortDir[sortCol] === "asc" });
    }, [sortCol, sortDir]);

    useEffect(() => {
        let stale = false;
        (async () => {
            const { count } = await base(true) as any;
            if (stale) return;
            setTotal(count ?? 0);

            const pg = Math.min(page, Math.max(1, Math.ceil((count ?? 0) / PER_PAGE)));
            const from = (pg - 1) * PER_PAGE;
            const { data, error } = await sorted(base(false)).range(from, from + PER_PAGE - 1);
            if (stale) return;
            if (error) { console.error(error); return; }
            if (pg !== page) setPage(pg);
            setRows(data ?? []);
            setExpanded(null);
        })();
        return () => { stale = true; };
    }, [base, sorted, page]);

    useEffect(() => {
        supabase.from("memberships").select("id, full_name").eq("organization_id", org!.id).order("full_name")
            .then(({ data }) => setMembers(data ?? []));
    }, [org]);

    function sortBy(key: string) {
        setSortDir(d => ({ ...d, [key]: sortCol === key && d[key] === "desc" ? "asc" : "desc" }));
        setSortCol(key);
        setPage(1);
    }

    function applyFilter() {
        setFilter(draft!);
        setPage(1);
        setDraft(null);
    }

    async function deleteEntry(id: string) {
        if (!confirm("Delete this history entry permanently?")) return;
        const { error } = await supabase.from("activity_log").delete().eq("id", id);
        if (error) { say(error.message, "error"); return; }
        setRows(r => r.filter(x => x.id !== id));
        setTotal(t => t - 1);
        setExpanded(null);
    }

    async function exportCsv() {
        // everything matching current filter+sort, 1000 rows/request
        const all: any[] = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sorted(base(false)).range(from, from + 999);
            if (error) { say(error.message, "error"); return; }
            all.push(...(data ?? []));
            if (!data || data.length < 1000) break;
        }

        const lines = [["When", "Member", "Role", "Action", "Summary"].join(",")];
        all.forEach(r => lines.push([
            q(new Date(r.created_at).toLocaleString("de-DE")),
            q(r.memberships?.full_name),
            q(r.details?.actor_role),
            q(ACTION_LABELS[r.action] ?? r.action),
            q(r.summary)
        ].join(",")));

        const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `dienstplan-history-${iso(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        await log("export.performed", `Exported ${all.length} history entries (CSV)`, { rows: all.length, filter: filter.action, search: filter.search });
    }

    return (
        <div className="dsh">
            <div className="dsh-h split">
                <h2>Activity</h2>
                <button className="ro-export" onClick={exportCsv}>Export CSV</button>
            </div>

            <div className="ro-panel">
                <div className="ro-bar">
                    <div className="ro-side"><h2>{total} entries</h2></div>
                    <div className="ro-side">
                        <button className="ro-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev.</button>
                        <button className="ro-btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                    </div>
                    <div className="ro-side">
                        <button className="ro-btn" onClick={() => setDraft(filter)}>Filter{active ? " •" : ""}</button>
                    </div>
                </div>

                <div className="zt-table hs">
                    <table>
                        <thead>
                            <tr>
                                {COLUMNS.map(c => (
                                    <th key={c.key} className="hs-th" onClick={() => sortBy(c.key)}>
                                        {c.label}{sortCol === c.key ? (sortDir[c.key] === "asc" ? " \u25b2" : " \u25bc") : ""}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && <tr><td colSpan={COLUMNS.length} style={{ color: "#888" }}>No activity found.</td></tr>}
                            {rows.map((r, i) => {
                                const when = new Date(r.created_at);
                                const open = expanded === r.id;
                                const name = r.memberships?.full_name ?? "\u2014";
                                return (
                                    <Fragment key={r.id}>
                                        <tr className={"hs-row " + (i % 2 ? "r1" : "r0")} onClick={() => setExpanded(open ? null : r.id)}>
                                            <td>{de(when)} - {when.toLocaleTimeString("de-DE")}</td>
                                            <td>{name}</td>
                                            <td><span className={`action-badge ${actionClass(r.action)}`}>{ACTION_LABELS[r.action] ?? r.action}</span></td>
                                            <td>{r.summary}</td>
                                        </tr>
                                        {open && (
                                            <tr className="hs-detail">
                                                <td colSpan={COLUMNS.length}>
                                                    <div className="detail-grid-hist">
                                                        <div><span className="plan-entry-meta">Full timestamp</span> <strong>{when.toLocaleString("de-DE")}</strong></div>
                                                        <div><span className="plan-entry-meta">Member</span> <strong>{name}</strong></div>
                                                        <div><span className="plan-entry-meta">Actor role</span> <strong>{String(r.details?.actor_role ?? "\u2014")}</strong></div>
                                                        <div><span className="plan-entry-meta">Entity type</span> <strong>{r.entity_type ?? "\u2014"}</strong></div>
                                                        {Object.entries(r.details ?? {}).map(([k, v]) => (
                                                            <div key={k}>
                                                                <span className="plan-entry-meta">{k}</span>{" "}
                                                                <strong>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {isAdmin && (
                                                        <div className="mg-act" style={{ marginTop: 10, justifyContent: "flex-start" }}>
                                                            <button className="mg-btn" onClick={() => deleteEntry(r.id)}>Delete Entry</button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="ro-foot">
                    <div className="ro-side">{isAdmin ? "Admin: expand a row to delete it." : "Read-only view."}</div>
                    <div className="ro-side zt-totals"><span>Page {page} / {totalPages}</span></div>
                </div>
            </div>

            {draft && (
                <Modal title="Filter" onClose={() => setDraft(null)} onSubmit={applyFilter} submitLabel="Apply">
                    <label>Search</label>
                    <input type="search" placeholder="Search…" value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} />
                    <label>Action</label>
                    <select value={draft.action} onChange={e => setDraft({ ...draft, action: e.target.value })}>
                        <option value="all">All actions</option>
                        {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <label>User</label>
                    <select value={draft.member} onChange={e => setDraft({ ...draft, member: e.target.value })}>
                        <option value="all">All users</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                    <button type="button" className="mg-btn" style={{ marginTop: 14 }} onClick={() => setDraft(NONE)}>Reset</button>
                </Modal>
            )}
        </div>
    );
}