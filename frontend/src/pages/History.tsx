// Audit trail viewer. Manager: read-only. Admin: also delete entries.
// Server-side sort/search/filter, resizable columns, expandable rows, CSV export.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Page } from "../components/Page";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { DOW, iso } from "../lib/dates";

const WIDTH_KEY = "history_col_widths_v1";

const COLUMNS = [
    { key: "time", label: "Time", dbKey: "created_at", width: 200 },
    { key: "member", label: "Member", dbKey: "memberships(full_name)", width: 150 },
    { key: "action", label: "Action", dbKey: "action", width: 180 },
    { key: "summary", label: "Summary", dbKey: "summary", width: 360 }
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

function loadWidths(): Record<number, number> {
    try { return JSON.parse(localStorage.getItem(WIDTH_KEY) ?? "{}"); } catch { return {}; }
}

export default function History() {

    const { org, isAdmin } = useAuth();
    const log = useLog();
    const { infoEl, navEl } = useStatus();

    const [rows, setRows] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(20);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [action, setAction] = useState("all");
    const [member, setMember] = useState("all");
    const [members, setMembers] = useState<{ id: string; full_name: string }[]>([]);
    const [sortCol, setSortCol] = useState("time");
    const [sortDir, setSortDir] = useState<Record<string, "asc" | "desc">>({ time: "desc" });
    const [expanded, setExpanded] = useState<string | null>(null);
    const [widths, setWidths] = useState(loadWidths);
    const scrollRef = useRef<HTMLDivElement>(null);

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    const base = useCallback((forCount: boolean) => {
        let b = supabase.from("activity_log")
            .select("*, memberships:actor_membership_id(full_name)", forCount ? { count: "exact", head: true } : undefined)
            .eq("organization_id", org!.id);
        if (member !== "all") b = b.eq("actor_membership_id", member);
        if (action !== "all") b = b.eq("action", action);
        const kw = search.trim();
        if (kw) b = b.or(`summary.ilike.%${kw}%,action.ilike.%${kw}%`);
        return b;
    }, [org, member, action, search]);

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

            const pg = Math.min(page, Math.max(1, Math.ceil((count ?? 0) / perPage)));
            const from = (pg - 1) * perPage;
            const { data, error } = await sorted(base(false)).range(from, from + perPage - 1);
            if (stale) return;
            if (error) { console.error(error); return; }
            if (pg !== page) setPage(pg);
            setRows(data ?? []);
            setExpanded(null);
        })();
        return () => { stale = true; };
    }, [base, sorted, page, perPage]);

    useEffect(() => {
        supabase.from("memberships").select("id, full_name").eq("organization_id", org!.id).order("full_name")
            .then(({ data }) => setMembers(data ?? []));
    }, [org]);

    // adaptive rows-per-page following viewport height
    useEffect(() => {
        let t: number;
        const onResize = () => {
            window.clearTimeout(t);
            t = window.setTimeout(() => {
                const sc = scrollRef.current;
                if (!sc) return;
                const sample = sc.querySelector("tbody tr:not(.detail-row)");
                const rowH = sample ? sample.getBoundingClientRect().height : 48;
                const target = Math.max(5, Math.floor((sc.clientHeight - 45) / rowH));
                setPerPage(p => (target !== p ? target : p));
            }, 300);
        };
        window.addEventListener("resize", onResize);
        return () => { window.removeEventListener("resize", onResize); window.clearTimeout(t); };
    }, []);

    const resetPage = () => { setPage(1); };

    function sortBy(key: string) {
        setSortDir(d => ({ ...d, [key]: d[key] === "asc" ? "desc" : "asc" }));
        setSortCol(key);
        resetPage();
    }

    function startResize(e: React.MouseEvent, i: number) {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = widths[i] ?? COLUMNS[i].width;
        let latest = widths;
        const move = (ev: MouseEvent) => {
            latest = { ...latest, [i]: Math.max(90, startW + ev.clientX - startX) };
            setWidths(latest);
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            localStorage.setItem(WIDTH_KEY, JSON.stringify(latest));
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    }

    async function deleteEntry(id: string) {
        if (!confirm("Delete this history entry permanently?")) return;
        const { error } = await supabase.from("activity_log").delete().eq("id", id);
        if (error) { alert(error.message); return; }
        setRows(r => r.filter(x => x.id !== id));
        setTotal(t => t - 1);
        setExpanded(null);
    }

    async function exportCsv() {
        // everything matching current filter+sort, 1000 rows/request
        const all: any[] = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sorted(base(false)).range(from, from + 999);
            if (error) { alert(error.message); return; }
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

        await log("export.performed", `Exported ${all.length} history entries (CSV)`, { rows: all.length, filter: action, search });
    }

    const span = COLUMNS.length;

    return (
        <Page title="Activity">
            <div className="hist-role-hint">
                {isAdmin ? "Admin mode: you may delete entries from the expanded view." : "Read-only view."}
            </div>

            <div className="hist-toolbar">
                <input type="search" className="hist-search-short" placeholder="Search…" value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setSearch(searchInput); resetPage(); } }} />
                <select value={action} onChange={e => { setAction(e.target.value); resetPage(); }}>
                    <option value="all">All actions</option>
                    {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={member} onChange={e => { setMember(e.target.value); resetPage(); }}>
                    <option value="all">All users</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
                <button className="btn-export" onClick={exportCsv}>Export CSV</button>
            </div>

            <div className="table-scroll" ref={scrollRef}>
                <table>
                    <colgroup>
                        {COLUMNS.map((c, i) => <col key={c.key} style={{ width: (widths[i] ?? c.width) + "px" }} />)}
                    </colgroup>
                    <thead>
                        <tr>
                            {COLUMNS.map((c, i) => (
                                <th key={c.key} style={{ width: (widths[i] ?? c.width) + "px" }}>
                                    <span className="col-header-label" onClick={() => sortBy(c.key)}>
                                        {c.label}{sortCol === c.key ? (sortDir[c.key] === "asc" ? " \u25b2" : " \u25bc") : ""}
                                    </span>
                                    <span className="col-resize-handle" onMouseDown={e => startResize(e, i)} />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr><td colSpan={span} style={{ padding: 16, color: "#888" }}>No activity found.</td></tr>
                        )}
                        {rows.map(r => {
                            const when = new Date(r.created_at);
                            const open = expanded === r.id;
                            const name = r.memberships?.full_name ?? "\u2014";
                            return (
                                <Fragment key={r.id}>
                                    <tr className={"history-row" + (open ? " expanded" : "")} onClick={() => setExpanded(open ? null : r.id)}>
                                        <td>
                                            <div>{DOW[when.getDay()]}, {when.toLocaleDateString("de-DE")}</div>
                                            <div className="plan-entry-meta">{when.toLocaleTimeString("de-DE")}</div>
                                        </td>
                                        <td>{name}</td>
                                        <td><span className={`action-badge ${actionClass(r.action)}`}>{ACTION_LABELS[r.action] ?? r.action}</span></td>
                                        <td>{r.summary}</td>
                                    </tr>
                                    {open && (
                                        <tr className="detail-row">
                                            <td colSpan={span}>
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
                                                    <div className="plan-entry-actions" style={{ marginTop: 10 }}>
                                                        <button className="btn-reject" onClick={() => deleteEntry(r.id)}>Delete Entry</button>
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

            {infoEl && createPortal(total > 0 ? `${total} entries \u00b7 Page ${page}/${totalPages}` : "No entries", infoEl)}
            {navEl && totalPages > 1 && createPortal(
                <>
                    <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{"\u2039 Prev"}</button>
                    <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{"Next \u203a"}</button>
                </>, navEl)}
        </Page>
    );
}
