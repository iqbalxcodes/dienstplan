// Weekly roster: one row per member (+ Open Shift row), 7 day columns. Same select/open mechanics as the month grid.
import { iso, isSameDay } from "../../lib/dates";
import { tr } from "../../lib/i18n";
import { isOff, NO_CODE_COLOR, OPEN } from "../../lib/roster";
import { getShiftRange } from "../../lib/shifts";
import { useCompact } from "../../lib/useCompact";
import type { Membership, RosterNote, Shift, ShiftRequest, ShiftType } from "../../lib/types";
import type { Entry } from "../../pages/Schedule";

interface Props {
    days: Date[];
    members: Membership[];
    byDate: Map<string, Entry[]>;
    notes: RosterNote[];
    types: ShiftType[];
    manager: boolean;
    lang: string;
    today: Date;
    selected: Set<string>;
    selMember: string | null;
    onToggle: (date: string, memberId: string) => void;
    onShift: (s: Shift) => void;
    onReq: (r: ShiftRequest) => void;
    onNote: (date: string) => void;
}

const hm = (t: string) => t.slice(0, 5);
const hours = (s: Shift) => { const r = getShiftRange(s.shift_date, s.start_time, s.end_time); return Math.max(0, r.end - r.start - (s.break_minutes ?? 0)) / 60; };
const p2 = (n: number) => String(n).padStart(2, "0");

export function Week(p: Props) {

    const c = useCompact();
    const typeOf = (code?: string | null) => p.types.find(t => t.code === code);
    const colorOf = (code?: string | null) => typeOf(code)?.color ?? NO_CODE_COLOR;
    const weekday = new Intl.DateTimeFormat(p.lang, { weekday: c ? "short" : "long" });   // de short = Mo. Di. Mi.
    const cols = (i: number) => (i >= 5 ? "we" : "");

    // managers always see the Open Shift row (to assign into it); employees only when this week has one
    const hasOpen = p.days.some(d => (p.byDate.get(iso(d)) ?? []).some(e => e.open));
    const rows: Membership[] = p.manager || hasOpen
        ? [{ id: OPEN, full_name: "Open Shift", weekly_target_hours: 0 } as Membership, ...p.members]
        : p.members;

    return (
        <div className="ro-grid wk">
            <div className="ro-row wk-row ro-head">
                <div />
                {p.days.map((d, i) => {
                    const dd = `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.`;
                    return (
                        <div key={i} className={cols(i)}>
                            {c ? <><b>{weekday.format(d)}</b><span>{dd}</span></> : `${weekday.format(d)}, ${dd}`}
                        </div>
                    );
                })}
            </div>

            <div className="ro-row wk-row ro-notes">
                <div />
                {p.days.map((d, i) => (
                    <div key={i} className={cols(i) + (p.manager ? " edit" : "")} onClick={() => p.manager && p.onNote(iso(d))}>
                        {p.notes.filter(n => n.note_date === iso(d)).map(n => n.text).join(" · ")}
                    </div>
                ))}
            </div>

            {rows.length === 0 && <div style={{ padding: 16, color: "#888" }}>{tr("No staff found")}</div>}

            {rows.map(m => {
                const isOpen = m.id === OPEN;
                const parts = m.full_name.trim().split(/\s+/);
                const last = parts.pop(), first = parts.join(" ");
                const mine = p.days.map(d => (p.byDate.get(iso(d)) ?? []).filter(e => (isOpen ? e.open : e.member?.id === m.id)));
                const total = mine.flat().reduce((sum, e) =>
                    e.shift && !e.del && !isOff(typeOf(e.code)) ? sum + hours(e.shift) : sum, 0);

                return (
                    <div key={m.id} className="ro-row wk-row wk-member">
                        <div className="wk-name">
                            {isOpen ? <b>{tr("Open Shift")}</b> : (
                                <>
                                    <b>{last}{first && ","}</b>
                                    <b>{first}</b>
                                    <span>{total.toFixed(2)}/{Number(m.weekly_target_hours).toFixed(2)}</span>
                                </>
                            )}
                        </div>

                        {p.days.map((d, i) => {
                            const key = iso(d);
                            const sel = p.selMember === m.id && p.selected.has(key);
                            return (
                                <div key={key} className={"wk-cell " + cols(i) + (sel ? " sel" : "") + (isSameDay(d, p.today) ? " today" : "")}
                                    onClick={() => p.onToggle(key, m.id)}>
                                    {mine[i].map(e => {
                                        const off = isOff(typeOf(e.code));
                                        const open = (ev: React.MouseEvent) => {
                                            ev.stopPropagation();
                                            if (!p.manager) return;
                                            if (e.shift) p.onShift(e.shift); else if (e.req) p.onReq(e.req);
                                        };
                                        const cls = "wk-card" + (off ? " off" : "") + (e.req ? " ghost" : "") + (e.dirty ? " draft" : "") + (e.del ? " del" : "");
                                        const s = e.shift ?? e.req;
                                        return off || !s ? (
                                            <div key={e.key} className={cls} onClick={open}>{e.code ?? "?"}</div>
                                        ) : (
                                            <div key={e.key} className={cls} style={{ "--c": colorOf(e.code) } as React.CSSProperties} onClick={open}
                                                title={`${e.open ? tr("Open Shift") : m.full_name} · ${e.code ?? "?"}${e.req ? " " + tr("(request)") : ""}`}>
                                                <div className="wk-top">
                                                    <span>{e.code}{e.open && e.claims ? ` (${e.claims})` : ""}</span>
                                                    <span>{e.shift ? hours(e.shift).toFixed(2) : ""}</span>
                                                </div>
                                                <div className="wk-time">{hm(s.start_time)}{c ? "-" : " - "}{hm(s.end_time)}</div>
                                                <div className="wk-area">{[s.area_label, s.role_label].filter(Boolean).join(" - ")}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}