// Google-Calendar-style month grid. Pointer events: same code for mouse and touch.
import { useRef, type PointerEvent as RPointerEvent } from "react";
import { useAuth } from "../../lib/auth";
import { addDays, isSameDay, iso, startOfMonth, startOfToday } from "../../lib/dates";
import type { ShiftFields } from "../../lib/shiftEdit";
import type { Membership, Shift, ShiftChangeRequest } from "../../lib/types";

export type PopupSpec = { shiftId?: string; requestId?: string; date?: string };

const HEAD = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function buildWeeks(monthDate: Date): Date[][] {
    const first = startOfMonth(monthDate);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const inMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((lead + inMonth) / 7);
    const start = addDays(first, -lead);
    return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

interface Props {
    monthDate: Date;
    members: Membership[];
    shifts: Shift[];
    changes: ShiftChangeRequest[];
    onPopup: (spec: PopupSpec) => void;
    onStep: (months: number) => void;
    save: (shiftId: string, ownerId: string, f: ShiftFields) => void | Promise<void>;
}

export function Month({ monthDate, members, shifts, changes, onPopup, onStep, save }: Props) {

    const { me, isManager } = useAuth();
    const dragging = useRef(false);
    const touch = useRef({ x: 0, y: 0 });
    const weeks = buildWeeks(monthDate);
    const today = startOfToday();
    const nameOf = (id: string) => members.find(m => m.id === id)?.full_name;

    function onDown(e: RPointerEvent) {

        const card = (e.target as HTMLElement).closest(".month-shift-card") as HTMLElement | null;
        if (!card) return;

        const isGhost = card.classList.contains("pending-ghost");
        const owner = card.dataset.membershipId!;
        const canEdit = !isGhost && (isManager || owner === me?.id);
        if (!canEdit && !isGhost) return; // others' shifts: not interactive

        const id = (isGhost ? card.dataset.requestId : card.dataset.shiftId)!;
        const startX = e.clientX, startY = e.clientY;
        let moved = false;
        dragging.current = true;

        let ghost: HTMLElement | null = null;
        const place = (ev: { clientX: number; clientY: number }) => {
            if (!ghost) return;
            ghost.style.left = ev.clientX - ghost.offsetWidth / 2 + "px";
            ghost.style.top = ev.clientY - 16 + "px";
        };

        if (canEdit) {
            ghost = card.cloneNode(true) as HTMLElement;
            ghost.classList.add("rack-drag-ghost");
            ghost.style.position = "fixed";
            ghost.style.width = card.getBoundingClientRect().width + "px";
            ghost.style.pointerEvents = "none";
            document.body.appendChild(ghost);
            place(e);
        }

        const clearTarget = () => document.querySelectorAll(".month-day-cell.drag-target").forEach(el => el.classList.remove("drag-target"));

        const move = (ev: PointerEvent) => {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) moved = true;
            if (!ghost) return;
            place(ev);
            clearTarget();
            document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".month-day-cell")?.classList.add("drag-target");
        };

        const up = (ev: PointerEvent) => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            dragging.current = false;
            clearTarget();
            ghost?.remove();

            if (!moved) { onPopup(isGhost ? { requestId: id } : { shiftId: id }); return; }
            if (isGhost) return; // pending requests can't be re-dated

            const date = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".month-day-cell") as HTMLElement | null)?.dataset.date;
            const shift = shifts.find(s => s.id === id);
            if (!date || !shift || date === shift.shift_date) return;

            void save(id, owner, { shift_date: date, start_time: shift.start_time, end_time: shift.end_time });
        };

        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    }

    return (
        <div className="month-view" id="monthView"
            onTouchStart={e => { if (!dragging.current) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
            onTouchEnd={e => {
                if (dragging.current) return;
                const dy = e.changedTouches[0].clientY - touch.current.y;
                const dx = e.changedTouches[0].clientX - touch.current.x;
                if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) onStep(dy < 0 ? 1 : -1); // swipe up = next month
            }}>

            <div className="month-header-row">{HEAD.map(d => <div key={d} className="month-header-cell">{d}</div>)}</div>

            <div className="month-grid" id="monthGrid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}
                onPointerDown={onDown}
                onClick={e => {
                    const t = e.target as HTMLElement;
                    if (t.closest(".month-shift-card") || !isManager) return;
                    const date = (t.closest(".month-day-cell") as HTMLElement | null)?.dataset.date;
                    if (date) onPopup({ date });
                }}>

                {weeks.flat().map(d => {
                    const key = iso(d);
                    const inMonth = d.getMonth() === monthDate.getMonth() && d.getFullYear() === monthDate.getFullYear();
                    return (
                        <div key={key} className={"month-day-cell" + (inMonth ? "" : " other-month")} data-date={key}>
                            <div className={"month-day-num" + (isSameDay(d, today) ? " is-today" : "")}>{d.getDate()}</div>
                            <div className="month-cards">
                                {shifts.filter(s => s.shift_date === key && nameOf(s.membership_id)).map(s => (
                                    <div key={s.id} className="month-shift-card"
                                        data-shift-id={s.id} data-membership-id={s.membership_id}>
                                        <span className="month-card-name">{nameOf(s.membership_id)}</span>
                                        <span className="month-card-meta">{s.role_label ?? ""} · {s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}</span>
                                    </div>
                                ))}
                                {changes.filter(r => r.proposed_shift_date === key && nameOf(r.requested_by_membership_id)).map(r => (
                                    <div key={r.id} className="month-shift-card pending-ghost"
                                        data-request-id={r.id} data-membership-id={r.requested_by_membership_id}>
                                        <span className="month-card-name">{nameOf(r.requested_by_membership_id)}</span>
                                        <span className="month-card-meta">{r.proposed_start_time.slice(0, 5)}-{r.proposed_end_time.slice(0, 5)} · pending</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
