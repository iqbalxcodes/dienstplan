// Weekly roster: one row per member, 7 day columns. Same select/open mechanics as the month grid.
import { iso, isSameDay } from "../../lib/dates";
import { isOff, NO_CODE_COLOR } from "../../lib/roster";
import { getShiftRange } from "../../lib/shifts";
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
}

const hm = (t: string) => t.slice(0, 5);
const hours = (s: Shift) => { const r = getShiftRange(s.shift_date, s.start_time, s.end_time); return Math.max(0, r.end - r.start - (s.break_minutes ?? 0)) / 60; };

export function Week(p: Props) {

    const typeOf = (c?: string | null) => p.types.find(t => t.code === c);
    const colorOf = (c?: string | null) => typeOf(c)?.color ?? NO_CODE_COLOR;
    const weekday = new Intl.DateTimeFormat(p.lang, { weekday: "long" });
    const cols = (i: number) => (i >= 5 ? "we" : "");

    return (
        <div className="ro-grid wk">
            <div className="ro-row wk-row ro-head">
                <div />
                {p.days.map((d, i) => (
                    <div key={i} className={cols(i)}>{weekday.format(d)}, {String(d.getDate()).padStart(2, "0")}.{String(d.getMonth() + 1).padStart(2, "0")}.</div>
                ))}
            </div>

            <div className="ro-row wk-row ro-notes">
                <div />
                {p.days.map((d, i) => (
                    <div key={i} className={cols(i)}>
                        {p.notes.filter(n => n.weekday === i + 1 || n.note_date === iso(d)).map(n => n.text).join(" · ")}
                    </div>
                ))}
            </div>

            {p.members.length === 0 && <div style={{ padding: 16, color: "#888" }}>No staff found</div>}

            {p.members.map(m => {
                const parts = m.full_name.trim().split(/\s+/);
                const last = parts.pop(), first = parts.join(" ");
                const mine = p.days.map(d => (p.byDate.get(iso(d)) ?? []).filter(e => e.member?.id === m.id));
                const total = mine.flat().reduce((sum, e) =>
                    e.shift && !e.del && !isOff(typeOf(e.code)) ? sum + hours(e.shift) : sum, 0);

                return (
                    <div key={m.id} className="ro-row wk-row wk-member">
                        <div className="wk-name">
                            <b>{last}{first && ","}</b>
                            <b>{first}</b>
                            <span>{total.toFixed(2)}/{Number(m.weekly_target_hours).toFixed(2)}</span>
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
                                                title={`${m.full_name} · ${e.code ?? "?"}${e.req ? " (request)" : ""}`}>
                                                <div className="wk-top"><span>{e.code}</span><span>{e.shift ? hours(e.shift).toFixed(2) : ""}</span></div>
                                                <div className="wk-time">{hm(s.start_time)} - {hm(s.end_time)}</div>
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