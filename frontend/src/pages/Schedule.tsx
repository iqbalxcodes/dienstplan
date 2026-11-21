// Roster (weekly + monthly). Employees select free dates and send requests; managers assign directly,
// edit/delete shifts and approve/reject requests. Every change can be undone.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Modal } from "../components/Modal";
import { AssignPopup, type PopupSpec } from "../components/schedule/AssignPopup";
import { Week } from "../components/schedule/Week";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { addDays, isoWeek, isSameDay, iso, parseDate, startOfMonth, startOfToday, startOfWeek } from "../lib/dates";
import {
    buildWeeks, insertShifts, isOff, lastName, NO_CODE_COLOR, OFF_END, OFF_START,
    setDraft, shiftTypesOf, updateShift, viewOf, type RosterForm
} from "../lib/roster";
import { findShiftConflicts } from "../lib/shifts";
import { DEFAULT_AREAS, DEFAULT_ROLES, type Membership, type RosterNote, type Shift, type ShiftRequest } from "../lib/types";

export interface Entry { key: string; code: string | null; member?: Membership; shift?: Shift; req?: ShiftRequest; dirty?: boolean; del?: boolean; }
interface Data { members: Membership[]; shifts: Shift[]; requests: ShiftRequest[]; notes: RosterNote[]; }
const EMPTY: Data = { members: [], shifts: [], requests: [], notes: [] };

interface CellProps {
    date: Date; other: boolean; alt: boolean; weekend: boolean; today: boolean; selected: boolean;
    cols: number; slots: number; entries: Entry[]; info: string; manager: boolean;
    color: (code: string | null) => string;
    onToggle: () => void;
    onShift: (s: Shift) => void;
    onReq: (r: ShiftRequest) => void;
    onGroup: (title: string, list: Entry[]) => void;
}

function DayCell(p: CellProps) {

    // too many people for the cell -> one card per shift: "N Mitarbeiter" (hover = names)
    const grouped = p.entries.length > p.slots;
    const groups = new Map<string, Entry[]>();
    if (grouped) p.entries.forEach(e => {
        const k = `${e.req ? "r" : "s"}:${e.code}`;
        groups.set(k, [...(groups.get(k) ?? []), e]);
    });

    const cls = "ro-cell" + (p.weekend ? " we" : p.alt ? " alt" : "") + (p.other ? " other" : "") + (p.today ? " today" : "") + (p.selected ? " sel" : "");
    const open = (e: Entry) => (e.shift ? p.onShift(e.shift) : e.req && p.manager ? p.onReq(e.req) : undefined);

    return (
        <div className={cls} onClick={p.onToggle}>
            <div className="ro-cards" style={{ "--cols": p.cols } as React.CSSProperties}>
                <div className="ro-card ro-date">
                    <b>{p.date.getDate()}</b>
                    {p.info && <span title={p.info}><Info size={15} /></span>}
                </div>

                {!grouped && p.entries.map(e => (
                    <div key={e.key} className={"ro-card" + (e.req ? " ghost" : "") + (e.dirty ? " draft" : "") + (e.del ? " del" : "")} style={{ background: p.color(e.code) }}
                        title={`${e.member?.full_name} · ${e.code ?? "?"}${e.req ? " (request)" : e.del ? " (deleted — publish to apply)" : e.dirty ? " (draft)" : ""}`}
                        onClick={ev => { ev.stopPropagation(); if (p.manager) open(e); }}>
                        {lastName(e.member)}
                    </div>
                ))}

                {grouped && [...groups.entries()].map(([k, list]) => (
                    <div key={k} className={"ro-card" + (list[0].req ? " ghost" : "")} style={{ background: p.color(list[0].code) }}
                        title={`${list[0].code}: ${list.map(e => e.member?.full_name).join(", ")}`}
                        onClick={ev => { ev.stopPropagation(); if (p.manager) p.onGroup(`${list[0].code} — ${iso(p.date)}`, list); }}>
                        {list.length} Mitarbeiter
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function Schedule() {

    const { org, me, isManager } = useAuth();
    const { settings: user } = useSettings();
    const { say, setNotice } = useStatus();
    const [mode, setMode] = useState<"week" | "month">("week");
    const [date, setDate] = useState(startOfToday);   // any day inside the shown week/month
    const [width, setWidth] = useState(window.innerWidth);
    const [data, setData] = useState<Data>(EMPTY);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [selMember, setSelMember] = useState<string | null>(null);   // week mode: selection is one row only
    const [popup, setPopup] = useState<PopupSpec | null>(null);
    const [group, setGroup] = useState<{ title: string; list: Entry[] } | null>(null);
    const [undo, setUndo] = useState<(() => Promise<unknown>)[]>([]);

    const settings = org!.settings ?? {};
    const types = shiftTypesOf(settings);
    const areas = settings.areas?.length ? settings.areas : DEFAULT_AREAS;
    const roles = settings.role_labels ?? DEFAULT_ROLES;
    const typeOf = (c?: string | null) => types.find(t => t.code === c);
    const colorOf = (c: string | null) => typeOf(c)?.color ?? NO_CODE_COLOR;
    const uid = me!.user_id;

    // cards per day (month): wide 6 (3x2) · medium 4 (2x2) · phone 2 (1 col)
    const cap = width > 1100 ? 6 : width > 700 ? 4 : 2;
    const cols = cap === 6 ? 3 : cap === 4 ? 2 : 1;
    const month = startOfMonth(date);
    const weekStart = startOfWeek(date);
    // week mode = one row of 7 days; load() only needs weeks[0][0] .. weeks[last][6]
    const weeks = useMemo(() => mode === "month"
        ? buildWeeks(startOfMonth(date))
        : [Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date), i))], [mode, date]);

    useEffect(() => {
        let t: number;
        const onResize = () => { window.clearTimeout(t); t = window.setTimeout(() => setWidth(window.innerWidth), 200); };
        window.addEventListener("resize", onResize);
        return () => { window.removeEventListener("resize", onResize); window.clearTimeout(t); };
    }, []);

    const load = useCallback(async () => {
        const from = iso(weeks[0][0]), to = iso(weeks[weeks.length - 1][6]);
        let reqQ = supabase.from("shift_requests").select("*").eq("organization_id", org!.id).eq("status", "pending")
            .gte("request_date", from).lte("request_date", to);
        if (!isManager) reqQ = reqQ.eq("membership_id", me!.id);

        const [m, s, r, n] = await Promise.all([
            supabase.from("memberships").select("*").eq("organization_id", org!.id).eq("active", true).order("full_name"),
            supabase.from("shifts").select("*").eq("organization_id", org!.id).gte("shift_date", from).lte("shift_date", to),
            reqQ,                                                  // table may not exist yet (migration 002) -> empty
            supabase.from("roster_notes").select("*").eq("organization_id", org!.id)
        ]);
        setData({
            members: (m.data ?? []) as Membership[],
            shifts: ((s.data ?? []) as Shift[]).filter(x => isManager || x.status === "published"),   // drafts: managers only until published
            requests: (r.data ?? []) as ShiftRequest[], notes: (n.data ?? []) as RosterNote[]
        });
    }, [org, me, isManager, weeks]);

    useEffect(() => { void load(); }, [load]);

    const byDate = useMemo(() => {
        const map = new Map<string, Entry[]>();
        const add = (d: string, e: Entry) => { if (e.member) map.set(d, [...(map.get(d) ?? []), e]); };
        const member = (id: string) => data.members.find(x => x.id === id);
        data.shifts.forEach(raw => {
            const s = viewOf(raw);
            add(s.shift_date, { key: s.id, code: s.shift_code ?? null, member: member(s.membership_id), shift: s, dirty: raw.status === "draft" || !!raw.draft, del: !!raw.draft?._delete });
        });
        data.requests.forEach(r => add(r.request_date, { key: r.id, code: r.shift_code, member: member(r.membership_id), req: r }));
        const rank = (c: string | null) => { const i = types.findIndex(t => t.code === c); return i < 0 ? 99 : i; };
        map.forEach(l => l.sort((a, b) => rank(a.code) - rank(b.code) || lastName(a.member).localeCompare(lastName(b.member))));
        return map;
    }, [data, types]);

    // "Employee works 6 days non stop!"
    const warnings = useMemo(() => {
        const out: string[] = [];
        const days = new Map<string, Set<string>>();
        data.shifts.forEach(raw => {
            const s = viewOf(raw);
            if (raw.draft?._delete || isOff(typeOf(s.shift_code))) return;
            days.set(s.membership_id, (days.get(s.membership_id) ?? new Set()).add(s.shift_date));
        });
        days.forEach((set, id) => {
            let run = 0, prev = 0;
            [...set].sort().forEach(d => {
                const t = parseDate(d).getTime();
                run = t - prev === 86400000 ? run + 1 : 1;
                prev = t;
                if (run === 6) out.push(`${lastName(data.members.find(m => m.id === id))} works 6 days non stop!`);
            });
        });
        return out;
    }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setNotice(warnings.length ? warnings.slice(0, 3).join("  ·  ") + (warnings.length > 3 ? `  ·  +${warnings.length - 3}` : "") : null);
        return () => setNotice(null);
    }, [warnings, setNotice]);

    const drafts = data.shifts.filter(x => x.status === "draft" || !!x.draft);   // unpublished changes

    const pushUndo = (fn: () => Promise<unknown>) => setUndo(u => [...u, fn]);

    async function doUndo() {
        const fn = undo[undo.length - 1];
        if (!fn) return;
        setUndo(u => u.slice(0, -1));
        await fn();
        await load();
        say("Undone", "info");
    }

    async function publish() {
        if (!drafts.length) { say("Nothing to publish", "info"); return; }
        if (!confirm(`Publish ${drafts.length} change(s)? Employees will see them. This is final and cannot be undone.`)) return;
        const errs = await Promise.all(drafts.map(async x => {
            if (x.draft?._delete) return (await supabase.from("shifts").delete().eq("id", x.id)).error;
            const { _delete, ...fields } = x.draft ?? {};
            return updateShift(x.id, { ...fields, status: "published", draft: null });
        }));
        const bad = errs.find(Boolean);
        if (bad) { say(bad.message, "error"); await load(); return; }
        setUndo([]);   // published = final: nothing before this point can be undone anymore
        say(`Published ${drafts.length} change(s)`, "success");
        await load();
    }

    // ---------- navigation ----------

    const step = (n: number) => setDate(d => mode === "week" ? addDays(d, 7 * n) : new Date(d.getFullYear(), d.getMonth() + n, 1));

    function switchMode() {
        setSelected(new Set());
        setSelMember(null);
        // week -> month keeps the date; month -> week jumps to today when it is inside the shown month
        setDate(d => {
            const t = startOfToday();
            return mode === "month" && t.getMonth() === d.getMonth() && t.getFullYear() === d.getFullYear() ? t : d;
        });
        setMode(m => (m === "week" ? "month" : "week"));
    }

    // mid = member row (week mode only); month mode passes null
    function toggle(d: string, mid: string | null = null) {
        if (!isManager && mid && mid !== me!.id) return;   // employees: own row only
        // employees can only pick days where they have nothing yet
        if (!isManager && (byDate.get(d) ?? []).some(e => e.member?.id === me!.id)) {
            say("You already have an entry on that day", "info");
            return;
        }
        setSelMember(mid);
        setSelected(s => { const n = new Set(mid === selMember ? s : []); if (!n.delete(d)) n.add(d); return n; });
    }

    // ---------- writes (return an error string, or null on success) ----------

    function rowOf(f: RosterForm, date: string) {
        const off = isOff(typeOf(f.code));
        return {
            organization_id: org!.id, membership_id: f.membershipId, shift_date: date,
            start_time: off ? OFF_START : f.start + ":00", end_time: off ? OFF_END : f.end + ":00",
            shift_code: f.code, area_label: off ? null : f.area || null, role_label: off ? null : f.role || null
        };
    }

    async function overlap(f: RosterForm, dates: string[], exclude?: string): Promise<string | null> {
        const r = rowOf(f, dates[0]);
        for (const d of dates) {
            const { conflicts, error } = await findShiftConflicts(org!.id, f.membershipId, d, r.start_time, r.end_time, exclude);
            if (error) return "Failed to check for conflicts";
            if (conflicts.length) return `Overlaps another shift on ${d.slice(8)}.${d.slice(5, 7)}.`;
        }
        return null;
    }

    async function submit(spec: PopupSpec, f: RosterForm, dates: string[]): Promise<string | null> {

        if (spec.mode === "assign" && !isManager) {                       // employee -> request (F = Frei = freiwunsch)
            const off = isOff(typeOf(f.code));
            const rows = dates.map(d => ({
                organization_id: org!.id, membership_id: me!.id, request_date: d, shift_code: f.code,
                area_label: off ? null : f.area || null, role_label: off ? null : f.role || null,
                start_time: off ? OFF_START : f.start + ":00", end_time: off ? OFF_END : f.end + ":00", status: "pending"
            }));
            const { data: ins, error } = await supabase.from("shift_requests").insert(rows).select("id");
            if (error) return error.code === "PGRST205" ? "Table shift_requests missing — run backend/sql/002_roster.sql." : error.message;
            const ids = ins!.map(x => x.id);
            pushUndo(async () => { await supabase.from("shift_requests").delete().in("id", ids); });
            say("Request sent — waiting for approval", "success");

        } else if (spec.mode === "assign") {                              // manager -> applied at once
            const err = await overlap(f, dates);
            if (err) return err;
            const { data: ins, error } = await insertShifts(dates.map(d => ({ ...rowOf(f, d), status: "draft", created_by: uid, updated_by: uid })));
            if (error) return error.message;
            const ids = ins!.map(x => x.id);
            pushUndo(async () => { await supabase.from("shifts").delete().in("id", ids); });
            say("Shift assigned", "success");

        } else if (spec.mode === "edit") {
            const old = data.shifts.find(x => x.id === spec.shift.id)!;   // raw row (spec.shift is the manager view)
            const err = await overlap(f, [f.date], old.id);
            if (err) return err;
            const { organization_id: _o, ...patch } = rowOf(f, f.date);
            if (old.status === "draft") {                                  // never published: edit directly
                const e = await updateShift(old.id, { ...patch, updated_by: uid });
                if (e) return e.message;
                pushUndo(async () => {
                    await updateShift(old.id, {
                        shift_date: old.shift_date, membership_id: old.membership_id, start_time: old.start_time, end_time: old.end_time,
                        shift_code: old.shift_code ?? null, area_label: old.area_label ?? null, role_label: old.role_label
                    });
                });
            } else {                                                       // published: pending change until Publish
                const prev = old.draft ?? null;
                const e = await setDraft(old.id, patch);
                if (e) return e;
                pushUndo(async () => { await setDraft(old.id, prev); });
            }
            say("Shift updated — publish to apply", "success");

        } else {                                                          // approve (as is, or edited)
            const req = spec.req;
            const err = await overlap(f, [f.date]);
            if (err) return err;
            const { data: ins, error } = await insertShifts([{ ...rowOf(f, f.date), status: "draft", created_by: uid, updated_by: uid }]);
            if (error) return error.message;
            const sid = ins![0].id;
            await supabase.from("shift_requests").update({ status: "approved", reviewed_by: uid, reviewed_at: new Date().toISOString() }).eq("id", req.id);
            pushUndo(async () => {
                await supabase.from("shifts").delete().eq("id", sid);
                await supabase.from("shift_requests").update({ status: "pending", reviewed_by: null, reviewed_at: null }).eq("id", req.id);
            });
            say("Request approved", "success");
        }

        setSelected(new Set());
        setSelMember(null);
        await load();
        return null;
    }

    async function removeOrReject(spec: PopupSpec): Promise<string | null> {
        if (spec.mode === "edit") {
            const old = data.shifts.find(x => x.id === spec.shift.id)!;
            if (old.status === "draft") {                                  // never published: delete for real
                const { error } = await supabase.from("shifts").delete().eq("id", old.id);
                if (error) return error.message;
                pushUndo(async () => { await insertShifts([old as unknown as Record<string, unknown>]); });
                say("Shift deleted", "success");
            } else {                                                       // published: marked until Publish
                const prev = old.draft ?? null;
                const e = await setDraft(old.id, { _delete: true });
                if (e) return e;
                pushUndo(async () => { await setDraft(old.id, prev); });
                say("Shift marked for deletion — publish to apply", "success");
            }
        } else if (spec.mode === "request") {
            const req = spec.req;
            const { error } = await supabase.from("shift_requests").delete().eq("id", req.id);
            if (error) return error.message;
            pushUndo(async () => { await supabase.from("shift_requests").insert(req); });
            say("Request rejected", "success");
        }
        await load();
        return null;
    }

    // ---------- render ----------

    const weekdayName = (i: number) =>   // 2024-01-01 is a Monday
        new Intl.DateTimeFormat(user.language, { weekday: width > 700 ? "long" : "short" }).format(new Date(2024, 0, 1 + i));
    const monthName = new Intl.DateTimeFormat(user.language, { month: "long", year: "numeric" }).format(month);
    const today = startOfToday();
    const sorted = [...selected].sort();

    return (
        <div className="dsh fill">
            <div className="dsh-h split">
                <h2>Roster</h2>
                <button className="ro-export" onClick={() => say("Export: coming soon", "info")}>Export</button>
            </div>

            <div className="ro-panel">
                <div className="ro-bar">
                    <div className="ro-side"><h2>{mode === "week" ? `KW ${isoWeek(weekStart)}` : monthName}</h2></div>

                    <div className="ro-side">
                        <button className="ro-btn" onClick={() => step(-1)}>Prev.</button>
                        <button className="ro-btn" onClick={() => step(1)}>Next</button>
                        <button className="ro-btn" onClick={switchMode}>{mode === "week" ? "Weekly" : "Monthly"}</button>
                    </div>

                    <div className="ro-side">
                        <button className="ro-btn" onClick={() => say("Filter: coming soon", "info")}>Filter</button>
                    </div>
                </div>

                {mode === "week" ? (
                    <Week days={weeks[0]} members={data.members} byDate={byDate} notes={data.notes} types={types}
                        manager={isManager} lang={user.language} today={today} selected={selected} selMember={selMember}
                        onToggle={toggle}
                        onShift={s => setPopup({ mode: "edit", shift: s })}
                        onReq={r => setPopup({ mode: "request", req: r })} />
                ) : (
                    <div className="ro-grid">
                        <div className="ro-row ro-head">
                            {Array.from({ length: 7 }, (_, i) => <div key={i} className={i >= 5 ? "we" : i % 2 ? "alt" : ""}>{weekdayName(i)}</div>)}
                        </div>

                        <div className="ro-row ro-notes">
                            {Array.from({ length: 7 }, (_, i) => (
                                <div key={i} className={i >= 5 ? "we" : i % 2 ? "alt" : ""}>
                                    {data.notes.filter(n => n.weekday === i + 1).map(n => n.text).join(" · ")}
                                </div>
                            ))}
                        </div>

                        {weeks.map((w, wi) => (
                            <div key={wi} className="ro-row ro-wk">
                                {w.map((d, i) => {
                                    const key = iso(d);
                                    return (
                                        <DayCell key={key} date={d} other={d.getMonth() !== month.getMonth()} alt={i % 2 === 1} weekend={i >= 5}
                                            today={isSameDay(d, today)} selected={selected.has(key)} cols={cols} slots={cap - 1}
                                            entries={byDate.get(key) ?? []} manager={isManager} color={colorOf}
                                            info={data.notes.filter(n => n.note_date === key).map(n => n.text).join("\n")}
                                            onToggle={() => toggle(key)}
                                            onShift={s => setPopup({ mode: "edit", shift: s })}
                                            onReq={r => setPopup({ mode: "request", req: r })}
                                            onGroup={(title, list) => setGroup({ title, list })} />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}

                <div className="ro-foot">
                    <div className="ro-side">
                        <button className="ro-btn" onClick={() => setPopup({ mode: "assign", dates: sorted, membershipId: selMember ?? undefined })}>
                            Assign{sorted.length ? ` (${sorted.length})` : ""}
                        </button>
                        {undo.length > 0 && <button className="ro-btn" onClick={doUndo}>Undo</button>}
                    </div>
                    <div className="ro-side">
                        {isManager && <button className="ro-btn" onClick={publish}>Publish{drafts.length ? ` (${drafts.length})` : ""}</button>}
                    </div>
                </div>
            </div>

            {popup && (
                <AssignPopup key={popup.mode + (popup.mode === "edit" ? popup.shift.id : popup.mode === "request" ? popup.req.id : "")}
                    spec={popup} members={data.members} types={types} areas={areas} roles={roles}
                    isManager={isManager} meId={me!.id} onClose={() => setPopup(null)}
                    onSubmit={(f, d) => submit(popup, f, d)}
                    onDelete={popup.mode === "assign" ? undefined : () => removeOrReject(popup)} />
            )}

            {group && (
                <Modal title={group.title} onClose={() => setGroup(null)}>
                    {group.list.map(e => (
                        <button key={e.key} className="ro-pick" onClick={() => {
                            setGroup(null);
                            setPopup(e.shift ? { mode: "edit", shift: e.shift } : { mode: "request", req: e.req! });
                        }}>{e.member?.full_name}{e.req ? " (request)" : ""}</button>
                    ))}
                </Modal>
            )}
        </div>
    );
}