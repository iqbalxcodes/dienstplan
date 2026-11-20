import { useState } from "react";
import { Modal } from "../Modal";
import { useAuth } from "../../lib/auth";
import { DEFAULT_ROLES, type Membership, type Shift, type ShiftChangeRequest } from "../../lib/types";
import type { PopupSpec } from "./Month";

interface Props {
    spec: PopupSpec;
    members: Membership[];
    shifts: Shift[];
    changes: ShiftChangeRequest[];
    onClose: () => void;
    onSave: (shift: Shift, f: { start: string; end: string; role: string }) => void;
    onCreate: (membershipId: string, date: string, start: string, end: string, role: string) => void;
}

export function ShiftPopup({ spec, members, shifts, changes, onClose, onSave, onCreate }: Props) {

    const { org, isManager } = useAuth();
    const roles = org?.settings?.role_labels ?? DEFAULT_ROLES;

    const shift = shifts.find(s => s.id === spec.shiftId);
    const req = changes.find(r => r.id === spec.requestId);

    const [employee, setEmployee] = useState(members[0]?.id ?? "");
    const [role, setRole] = useState(shift?.role_label ?? roles[0]);
    const [start, setStart] = useState((shift?.start_time ?? req?.proposed_start_time ?? "09:00").slice(0, 5));
    const [end, setEnd] = useState((shift?.end_time ?? req?.proposed_end_time ?? "17:00").slice(0, 5));

    const readOnly = !!req;
    const adding = !shift && !req;
    const who = members.find(m => m.id === (shift?.membership_id ?? req?.requested_by_membership_id))?.full_name ?? "";
    const title = readOnly ? "Pending Change" : adding ? "Add Shift" : "Edit Shift";

    function submit() {
        if (!start || !end) return;
        if (shift) onSave(shift, { start, end, role });
        else if (spec.date && employee) onCreate(employee, spec.date, start + ":00", end + ":00", role);
        onClose();
    }

    return (
        <Modal title={title} onClose={onClose} onSubmit={readOnly ? undefined : submit}>
            <div className="plan-entry-meta" style={{ marginBottom: 8 }}>{who}</div>

            {adding && (
                <>
                    <label>Employee</label>
                    <select value={employee} onChange={e => setEmployee(e.target.value)}>
                        {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                </>
            )}

            <label>Role</label>
            {/* role isn't part of a change request, so only managers can change it */}
            <select value={role} disabled={readOnly || !isManager} onChange={e => setRole(e.target.value)}>
                {[...new Set([...roles, role])].map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <label>Start time</label>
            <input type="time" value={start} disabled={readOnly} onChange={e => setStart(e.target.value)} />
            <label>End time</label>
            <input type="time" value={end} disabled={readOnly} onChange={e => setEnd(e.target.value)} />

            {readOnly && <div className="plan-entry-meta" style={{ marginTop: 8, color: "#e65100" }}>Waiting for manager approval.</div>}
            {shift && !isManager && <div className="plan-entry-meta" style={{ marginTop: 8, color: "#e65100" }}>Your change will be sent for manager approval.</div>}
        </Modal>
    );
}
