// Freiwünsche & Urlaub: two blocks, same mechanics.
// Select days -> Assign (popup, type fixed) -> Send (inserts pending leave_requests).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { addDays, iso, parseDate, startOfMonth, startOfToday } from "../lib/dates";
import { buildWeeks } from "../lib/roster";
import type { EntryStatus, LeaveRequest, LeaveType } from "../lib/types";

interface Range { from: string; to: string; reason: string; }
type Item = Pick<LeaveRequest, "date_start" | "date_end"> & { status: string };

const STATUSES: EntryStatus[] = ["approved", "rejected", "pending"];
const dmy = (s: string) => `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const short = (s: string) => `${s.slice(8)}.${s.slice(5, 7)}.`;

function days(a: string, b: string, workOnly: boolean) {
    let n = 0;
    for (let d = parseDate(a), e = parseDate(b); d <= e; d = addDays(d, 1)) if (!workOnly || d.getDay() % 6) n++;
    return n;
}

/** sorted ISO dates -> runs of consecutive days */
const groups = (dates: string[]) => [...dates].sort().reduce<string[][]>((g, d) => {
    const last = g[g.length - 1];
    if (last && iso(addDays(parseDate(last[last.length - 1]), 1)) === d) last.push(d); else g.push([d]);
    return g;
}, []);

/** always 6 week rows so the height never jumps between months */
const sixWeeks = (month: Date) => {
    const w = buildWeeks(month);
    while (w.length < 6) w.push(Array.from({ length: 7 }, (_, i) => addDays(w[w.length - 1][6], i + 1)));
    return w;
};

interface SectionProps { type: LeaveType; title: string; label: string; list: LeaveRequest[]; stats?: [string, number][]; reload: () => void; }

function Section({ type, title, label, list, stats, reload }: SectionProps) {

    const { org, me } = useAuth();
    const { settings: user } = useSettings();
    const { say } = useStatus();
    const [month, setMonth] = useState(() => startOfMonth(startOfToday()));
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [staged, setStaged] = useState<Range[][]>([]);     // assigned, not sent yet (one batch per Assign)
    const [reason, setReason] = useState<string | null>(null);   // non-null = popup open
    const today = startOfToday();
    const weeks = useMemo(() => sixWeeks(month), [month]);
    const work = type === "urlaub";                           // Urlaub counts Mon-Fri only
    const flat = staged.flat();

    // rejected last so a newer request on the same day wins
    const items: Item[] = [
        ...flat.map(r => ({ date_start: r.from, date_end: r.to, status: "staged" })),
        ...list.filter(l => l.status !== "rejected"),
        ...list.filter(l => l.status === "rejected")
    ];
    const hit = (k: string) => items.find(l => l.date_start <= k && k <= l.date_end);

    function toggle(k: string) {
        if (parseDate(k) < today) { say("Date is in the past", "info"); return; }
        const h = hit(k);
        if (h && h.status !== "rejected") { say("There is already a request on that day", "info"); return; }
        setSel(s => { const n = new Set(s); if (!n.delete(k)) n.add(k); return n; });
    }

    function saveAssign() {
        setStaged(s => [...s, groups([...sel]).map(g => ({ from: g[0], to: g[g.length - 1], reason: reason! }))]);
        setSel(new Set());
        setReason(null);
    }

    async function send() {
        if (!flat.length) { say("Nothing to send", "info"); return; }
        const { error } = await supabase.from("leave_requests").insert(flat.map(r => ({
            organization_id: org!.id, membership_id: me!.id, type,
            date_start: r.from, date_end: r.to, reason: r.reason || null, status: "pending"
        })));
        if (error) { say(error.message, "error"); return; }
        setStaged([]);
        say(`${label} request sent — waiting for approval`, "success");
        reload();
    }

    const weekday = (i: number) => new Intl.DateTimeFormat(user.language, { weekday: "long" }).format(new Date(2024, 0, 1 + i));
    const monthName = new Intl.DateTimeFormat(user.language, { month: "long", year: "numeric" }).format(month);
    const col = (i: number) => (i >= 5 ? "we" : i % 2 ? "alt" : "");
    const step = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));

    return (
        <>
            <div className="dsh-h split">
                <h2>{title}</h2>
                <button className="ro-export" onClick={() => say("Export: coming soon", "info")}>Export</button>
            </div>

            <div className="zt lv">
                <div className="lv-side">
                    {stats && (
                        <aside className="zt-stats">
                            {stats.map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>)}
                        </aside>
                    )}
                    <div className="lv-card">
                        {STATUSES.map(s => {
                            const rows = list.filter(l => l.status === s);
                            return (
                                <div key={s}>
                                    <h3>{s[0].toUpperCase() + s.slice(1)}</h3>
                                    {rows.length === 0 && <p className="lv-empty">Nothing here</p>}
                                    {rows.map(l => (
                                        <div key={l.id} className={`lv-tag ${s}`}>
                                            {dmy(l.date_start)} - {dmy(l.date_end)} ({days(l.date_start, l.date_end, work)} Days)
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="ro-panel">
                    <div className="ro-bar">
                        <div className="ro-side"><h2>{monthName}</h2></div>
                        <div className="ro-side">
                            <button className="ro-btn" onClick={() => step(-1)}>Prev.</button>
                            <button className="ro-btn" onClick={() => step(1)}>Next</button>
                        </div>
                        <div className="ro-side">
                            <button className="ro-btn" onClick={() => say("Filter: coming soon", "info")}>Filter</button>
                        </div>
                    </div>

                    <div className="ro-grid">
                        <div className="ro-row ro-head">
                            {Array.from({ length: 7 }, (_, i) => <div key={i} className={col(i)}>{weekday(i)}</div>)}
                        </div>
                        {weeks.map((w, wi) => (
                            <div key={wi} className="ro-row ro-wk">
                                {w.map((d, i) => {
                                    const k = iso(d), h = hit(k);
                                    return (
                                        <div key={k} className={"ro-cell " + col(i) + (d.getMonth() !== month.getMonth() ? " other" : "") + (sel.has(k) ? " sel" : "")}
                                            onClick={() => toggle(k)}>
                                            <div className="lv-n">{d.getDate()}</div>
                                            {h && <div className={`lv-tag ${h.status}`}>{label}</div>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    <div className="ro-foot">
                        <div className="ro-side">
                            {sel.size > 0 && <button className="ro-btn" onClick={() => setReason("")}>Assign ({sel.size})</button>}
                            {staged.length > 0 && <button className="ro-btn" onClick={() => setStaged(s => s.slice(0, -1))}>Undo</button>}
                        </div>
                        <div className="ro-side">
                            {flat.length > 0 && <button className="ro-btn" onClick={send}>Send ({flat.length})</button>}
                        </div>
                    </div>
                </div>
            </div>

            {reason !== null && (
                <Modal title="Assign" onClose={() => setReason(null)} onSubmit={saveAssign} submitLabel="Save">
                    <label>Date</label>
                    <input disabled value={[...sel].sort().map(short).join(", ")} />
                    <label>Shift</label>
                    <input disabled value={type === "freiwunsch" ? "Frei" : "Urlaub"} />
                    <label>Reason (optional)</label>
                    <textarea value={reason} onChange={e => setReason(e.target.value)} />
                </Modal>
            )}
        </>
    );
}

export default function Hours() {

    const { org, me } = useAuth();
    const [list, setList] = useState<LeaveRequest[]>([]);

    const load = useCallback(async () => {
        const { data } = await supabase.from("leave_requests").select("*")
            .eq("organization_id", org!.id).eq("membership_id", me!.id).order("date_start");
        setList((data ?? []) as LeaveRequest[]);
    }, [org, me]);

    useEffect(() => { void load(); }, [load]);

    const year = String(new Date().getFullYear());
    const todayIso = iso(new Date());
    const vac = list.filter(l => l.type === "urlaub");
    const sum = (f: (l: LeaveRequest) => boolean) =>
        vac.filter(l => l.date_start.startsWith(year) && f(l)).reduce((s, l) => s + days(l.date_start, l.date_end, true), 0);

    const total = org!.settings?.vacation_days ?? 30;
    const taken = sum(l => l.status === "approved" && l.date_end < todayIso);
    const planned = sum(l => l.status === "approved" && l.date_end >= todayIso);
    const asked = sum(l => l.status === "pending");

    const stats: [string, number][] = [
        ["Jahresurlaub", total], ["Resturlaub", 0], ["Sonderurlaub", 0], ["Gesamtanspruch", total],
        ["Genommener Urlaub", taken], ["Geplanter Urlaub", planned], ["Beantragter Urlaub", asked],
        ["Resturlaub aktuell", total - taken - planned - asked]
    ];

    return (
        <div className="dsh">
            <Section type="freiwunsch" title="Freiwünsche" label="Frei" list={list.filter(l => l.type === "freiwunsch")} reload={load} />
            <Section type="urlaub" title="Urlaub" label="Urlaub" list={vac} stats={stats} reload={load} />
        </div>
    );
}