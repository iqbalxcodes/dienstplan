import { useCallback, useEffect, useRef, useState } from "react";
import { Page } from "../components/Page";
import { Rack } from "../components/schedule/Rack";
import { Month, buildWeeks, type PopupSpec } from "../components/schedule/Month";
import { ShiftPopup } from "../components/schedule/ShiftPopup";
import { useAuth } from "../lib/auth";
import { useShiftEdit } from "../lib/shiftEdit";
import { supabase } from "../lib/supabase";
import { addDays, iso, MONTHS, startOfMonth, startOfToday } from "../lib/dates";
import type { LeaveRequest, Membership, Shift, ShiftChangeRequest } from "../lib/types";

const MODE_KEY = "dienstplan_view_mode_v1";
const MODES: [string, string, string][] = [["month", "Month", "Month"], ["3", "3D", "3 Days"], ["7", "7D", "7 Days"], ["30", "30D", "30 Days"], ["auto", "Auto", "Auto"]];

interface Data {
    members: Membership[];
    shifts: Shift[];
    pending: Record<string, number>;
    leave: LeaveRequest[];
    changes: ShiftChangeRequest[];
}

const EMPTY: Data = { members: [], shifts: [], pending: {}, leave: [], changes: [] };

export default function Schedule() {

    const { org } = useAuth();
    const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || "auto");
    const [width, setWidth] = useState(window.innerWidth);
    const [start, setStart] = useState(startOfToday);
    const [selected, setSelected] = useState(startOfToday);
    const [monthDate, setMonthDate] = useState(() => startOfMonth(startOfToday()));
    const [data, setData] = useState<Data>(EMPTY);
    const [popup, setPopup] = useState<PopupSpec | null>(null);
    const dateRef = useRef<HTMLInputElement>(null);

    // phone: 3 days, tablet: 7, wide: up to 30 (unless a fixed mode is chosen)
    const fixed = mode !== "auto" && mode !== "month";
    const dayCount = fixed ? Number(mode) : width <= 700 ? 3 : width <= 1100 ? 7 : width <= 1700 ? 14 : 30;
    const colW = width <= 700 ? Math.floor((width - 128) / Math.max(1, dayCount)) : width <= 1100 ? 96 : width <= 1700 ? 76 : 60;
    const isMonth = mode === "month";

    useEffect(() => {
        let t: number;
        const onResize = () => { window.clearTimeout(t); t = window.setTimeout(() => setWidth(window.innerWidth), 300); };
        window.addEventListener("resize", onResize);
        return () => { window.removeEventListener("resize", onResize); window.clearTimeout(t); };
    }, []);

    const center = useCallback((date: Date) => {
        setSelected(date);
        setStart(addDays(date, -Math.floor((dayCount - 1) / 2)));
    }, [dayCount]);

    // initial centering + re-center whenever the visible day count changes
    useEffect(() => { center(selected); }, [dayCount]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (dateRef.current && document.activeElement !== dateRef.current) dateRef.current.value = iso(selected);
    }, [selected]);

    const startKey = iso(start);
    const monthKey = iso(monthDate);

    const load = useCallback(async () => {

        const orgId = org!.id;
        const membersQ = supabase.from("memberships").select("*").eq("organization_id", orgId).eq("active", true).order("full_name");

        if (isMonth) {
            const weeks = buildWeeks(monthDate);
            const from = iso(weeks[0][0]), to = iso(weeks[weeks.length - 1][6]);
            const [m, s, c] = await Promise.all([
                membersQ,
                supabase.from("shifts").select("*").eq("organization_id", orgId).gte("shift_date", from).lte("shift_date", to),
                supabase.from("shift_change_requests").select("*").eq("organization_id", orgId).eq("status", "pending")
                    .gte("proposed_shift_date", from).lte("proposed_shift_date", to)
            ]);
            setData({ ...EMPTY, members: (m.data ?? []) as Membership[], shifts: (s.data ?? []) as Shift[], changes: (c.data ?? []) as ShiftChangeRequest[] });
            return;
        }

        const end = addDays(start, dayCount - 1);
        const [m, s, e, l] = await Promise.all([
            membersQ,
            supabase.from("shifts").select("*").eq("organization_id", orgId).gte("shift_date", iso(start)).lte("shift_date", iso(end)),
            supabase.from("time_entries").select("membership_id").eq("organization_id", orgId).eq("status", "pending")
                .gte("clock_in", start.toISOString()).lte("clock_in", addDays(end, 1).toISOString()),
            supabase.from("leave_requests").select("*").eq("organization_id", orgId)
                .lte("date_start", iso(end)).gte("date_end", iso(start))
        ]);

        const pending: Record<string, number> = {};
        (e.data ?? []).forEach((x: any) => { pending[x.membership_id] = (pending[x.membership_id] ?? 0) + 1; });

        setData({ members: (m.data ?? []) as Membership[], shifts: (s.data ?? []) as Shift[], pending, leave: (l.data ?? []) as LeaveRequest[], changes: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [org, isMonth, startKey, monthKey, dayCount]);

    useEffect(() => { void load(); }, [load]);

    const { save, create } = useShiftEdit(load);

    function changeMode(m: string) {
        if (m === "month" && mode !== "month") setMonthDate(startOfMonth(selected));
        setMode(m);
        localStorage.setItem(MODE_KEY, m);
    }

    function onDateInput(value: string) {
        const [y, m, d] = value.split("-").map(Number);
        // ignore partial input while typing (don't rewrite the field)
        if (!y || !m || !d || y < 1900 || y > 2200) return;
        center(new Date(y, m - 1, d));
    }

    const stepDays = (n: number) => { const s = addDays(start, n); setStart(s); setSelected(s); };
    const stepMonth = (n: number) => setMonthDate(d => new Date(d.getFullYear(), d.getMonth() + n, 1));

    const thisYear = new Date().getFullYear();
    const years = Array.from({ length: 11 }, (_, i) => thisYear - 5 + i);

    const centerBar = isMonth ? (
        <div id="monthNavBar" className="month-nav">
            <button className="rack-nav-btn" onClick={() => stepMonth(-1)} title="Previous month">&#9664;</button>
            <select className="month-picker-select" value={monthDate.getMonth()}
                onChange={e => setMonthDate(new Date(monthDate.getFullYear(), Number(e.target.value), 1))}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select className="month-picker-select" value={monthDate.getFullYear()}
                onChange={e => setMonthDate(new Date(Number(e.target.value), monthDate.getMonth(), 1))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button className="rack-nav-btn" onClick={() => stepMonth(1)} title="Next month">&#9654;</button>
        </div>
    ) : (
        <input type="date" ref={dateRef} className="sched-date-input" defaultValue={iso(selected)}
            onChange={e => onDateInput(e.target.value)} />
    );

    const right = (
        <>
            <div className="rack-view-toggle">
                {MODES.map(([v, label]) => (
                    <button key={v} className={"rack-view-btn" + (mode === v ? " active" : "")} onClick={() => changeMode(v)}>{label}</button>
                ))}
            </div>
            <select className="rack-view-select-mobile" value={mode} onChange={e => changeMode(e.target.value)}>
                {MODES.map(([v, , long]) => <option key={v} value={v}>{long}</option>)}
            </select>
        </>
    );

    return (
        <Page title="Schedule" className="rack-page" center={centerBar} right={right}>

            {isMonth ? (
                <Month monthDate={monthDate} members={data.members} shifts={data.shifts} changes={data.changes}
                    onPopup={setPopup} onStep={stepMonth} save={save} />
            ) : (
                <Rack days={Array.from({ length: dayCount }, (_, i) => addDays(start, i))} colW={colW}
                    members={data.members} shifts={data.shifts} pending={data.pending} leave={data.leave}
                    onShift={stepDays} save={save} />
            )}

            {popup && (
                <ShiftPopup spec={popup} members={data.members} shifts={data.shifts} changes={data.changes}
                    onClose={() => setPopup(null)} onCreate={create}
                    onSave={(s, f) => save(s.id, s.membership_id, {
                        shift_date: s.shift_date, start_time: f.start + ":00", end_time: f.end + ":00", role_label: f.role
                    })} />
            )}
        </Page>
    );
}
