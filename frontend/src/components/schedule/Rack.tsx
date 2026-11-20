// Gantt-style staff rack: one row per member, shift bars positioned by real clock time.
import type { MouseEvent as RMouseEvent } from "react";
import { useAuth } from "../../lib/auth";
import { useStatus } from "../../lib/status";
import { DOW, isSameDay, iso, MONTHS, parseDate, startOfToday } from "../../lib/dates";
import { getShiftRange, rangeToShiftFields, type MinuteRange } from "../../lib/shifts";
import type { ShiftFields } from "../../lib/shiftEdit";
import { LEAVE_LABELS, type LeaveRequest, type Membership, type Shift } from "../../lib/types";

interface Props {
    days: Date[];
    colW: number;
    members: Membership[];
    shifts: Shift[];
    pending: Record<string, number>;   // membership id -> pending time entries
    leave: LeaveRequest[];
    onShift: (days: number) => void;
    save: (shiftId: string, ownerId: string, f: ShiftFields) => void | Promise<void>;
}

export function Rack({ days, colW, members, shifts, pending, leave, onShift, save }: Props) {

    const { me, isManager } = useAuth();
    const { say } = useStatus();
    const today = startOfToday();
    const width = colW * days.length;
    const rangeStart = getShiftRange(iso(days[0]), "00:00", "00:00").start;
    const rangeEnd = getShiftRange(iso(days[days.length - 1]), "00:00", "00:00").start + 1440;
    const pxPerMin = colW / 1440;

    function onDown(e: RMouseEvent) {

        const target = e.target as HTMLElement;
        const bar = target.closest(".plan-shift-bar") as HTMLElement | null;
        if (!bar || e.button !== 0) return;

        const owner = bar.dataset.membershipId!;
        if (!isManager && owner !== me?.id) return;   // others' shifts are read-only

        e.preventDefault();

        const handle = target.closest(".bar-resize-handle");
        const type = handle ? (handle.classList.contains("left") ? "resize-left" : "resize-right") : "move";
        const range = getShiftRange(bar.dataset.shiftDate!, bar.dataset.startTime!, bar.dataset.endTime!);
        const originLeft = parseFloat(bar.style.left);
        const originWidth = parseFloat(bar.style.width);
        const startX = e.clientX;
        let moved = false;

        const place = (ev: { clientX: number; clientY: number }) => {
            if (ghost) ghost.style.transform = `translate(${ev.clientX - originWidth / 2}px, ${ev.clientY - 16}px)`;
        };

        let ghost: HTMLElement | null = null;
        if (type === "move") {
            ghost = bar.cloneNode(true) as HTMLElement;
            ghost.classList.add("rack-drag-ghost");
            Object.assign(ghost.style, {
                position: "fixed", left: "0px", top: "0px", width: originWidth + "px",
                height: bar.getBoundingClientRect().height + "px", pointerEvents: "none"
            });
            document.body.appendChild(ghost);
            place(e);
        }

        const snapPx = colW / 96; // 15-minute steps

        const move = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            if (Math.abs(dx) > 4) moved = true;

            if (type === "move") { place(ev); return; }

            const steps = Math.round(dx / snapPx);
            if (type === "resize-left") {
                const w = originWidth - steps * snapPx;
                if (w < snapPx * 2) return;
                bar.style.left = originLeft + steps * snapPx + "px";
                bar.style.width = w + "px";
            } else {
                const w = originWidth + steps * snapPx;
                if (w < snapPx * 2) return;
                bar.style.width = w + "px";
            }
        };

        const up = (ev: MouseEvent) => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            ghost?.remove();

            // React won't repaint a bar whose props didn't change: undo the live resize ourselves
            bar.style.left = originLeft + "px";
            bar.style.width = originWidth + "px";

            if (!moved) return;

            const delta = Math.round(((ev.clientX - startX) / pxPerMin) / 15) * 15;
            const next: MinuteRange = { ...range };
            if (type === "resize-left") next.start += delta;
            else if (type === "resize-right") next.end += delta;
            else { next.start += delta; next.end += delta; }

            if (next.end - next.start < 15) { say("Shift must be at least 15 minutes", "error"); return; }

            void save(bar.dataset.shiftId!, owner, rangeToShiftFields(next));
        };

        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    }

    return (
        <div className="rack-scroll" id="rackScroll">

            <div id="rackHeaderRow" className="rack-header-row">
                <div className="rack-header-label">
                    <span>STAFF</span>
                    <button className="rack-nav-btn rack-nav-prev" onClick={() => onShift(-1)} title="Previous">{"\u25c0"}</button>
                </div>
                {days.map(d => (
                    <div key={iso(d)} style={{ width: colW }}
                        className={"rack-header-cell" + (isSameDay(d, today) ? " is-today" : "") + ([0, 6].includes(d.getDay()) ? " is-weekend" : "")}>
                        <div className="rack-header-dow">{DOW[d.getDay()]}</div>
                        <div className="rack-header-date">{String(d.getDate()).padStart(2, "0")} {MONTHS[d.getMonth()]}</div>
                    </div>
                ))}
                <div className="rack-header-end">
                    <button className="rack-nav-btn" onClick={() => onShift(1)} title="Next">{"\u25b6"}</button>
                </div>
            </div>

            <div id="rackBody" onMouseDown={onDown}>
                {members.length === 0 && <div style={{ padding: 16, color: "#888" }}>No staff found</div>}

                {members.map(m => (
                    <div key={m.id} className="rack-row plan-row">
                        <div className="rack-room-label">
                            {pending[m.id] > 0 && <span className="rack-conflict-flag" title={`${pending[m.id]} pending approval`}>{"\u26a0"}</span>}
                            <span className="rack-room-number">{m.full_name}</span>
                            {m.id === me?.id && <span className="rack-status-dot status-clean" title="You">{"\u25cf"}</span>}
                        </div>

                        <div className="rack-timeline" style={{ width }}>
                            {days.map(d => (
                                <div key={iso(d)} className={"rack-cell" + ([0, 6].includes(d.getDay()) ? " is-weekend" : "")} style={{ width: colW }} />
                            ))}

                            <div className="rack-bars-layer" style={{ width }}>
                                {shifts.filter(s => s.membership_id === m.id).map(s => {
                                    const r = getShiftRange(s.shift_date, s.start_time, s.end_time);
                                    const a = Math.max(r.start, rangeStart), b = Math.min(r.end, rangeEnd);
                                    if (b <= a) return null;

                                    const cutL = r.start < rangeStart, cutR = r.end > rangeEnd;
                                    const canDrag = isManager || m.id === me?.id;
                                    const meta = [s.role_label, `${s.start_time.slice(0, 5)}\u2013${s.end_time.slice(0, 5)}`, s.is_night_shift ? "Nachtdienst" : null]
                                        .filter(Boolean).join(" \u00b7 ");

                                    return (
                                        <div key={s.id}
                                            className={"reservation-bar plan-shift-bar" + (cutL ? " cut-left" : "") + (cutR ? " cut-right" : "")}
                                            style={{ left: (a - rangeStart) * pxPerMin + 3, width: (b - a) * pxPerMin - 6, top: 2, height: "calc(100% - 4px)" }}
                                            title={`${m.full_name} \u00b7 ${meta}`}
                                            data-shift-id={s.id} data-membership-id={m.id} data-shift-date={s.shift_date}
                                            data-start-time={s.start_time} data-end-time={s.end_time}>
                                            {canDrag && !cutL && <div className="bar-resize-handle left" />}
                                            <span className="bar-guest">{m.full_name}</span>
                                            <span className="bar-meta">{meta}</span>
                                            {canDrag && !cutR && <div className="bar-resize-handle right" />}
                                        </div>
                                    );
                                })}

                                {leave.filter(l => l.membership_id === m.id).flatMap(l => {
                                    const from = parseDate(l.date_start), to = parseDate(l.date_end);
                                    return days.map((d, i) => d >= from && d <= to && (
                                        <div key={`${l.id}-${i}`}
                                            className={`plan-leave-chip leave-status-${l.status} leave-type-${l.type}`}
                                            style={{ left: i * colW + 3, width: colW - 6 }}
                                            title={`${LEAVE_LABELS[l.type]} \u00b7 ${l.status}`}>
                                            {LEAVE_LABELS[l.type]}
                                        </div>
                                    ));
                                })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
