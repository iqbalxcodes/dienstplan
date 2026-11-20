import { useCallback, useEffect, useState } from "react";
import { Page } from "../components/Page";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { addDays, startOfToday } from "../lib/dates";
import { computeHours, formatHours } from "../lib/hours";
import { LEAVE_LABELS, type HoursSummary, type LeaveType, type Membership } from "../lib/types";

type Row = { member: Membership; s: HoursSummary };

export default function Hours() {

    const { org, me, isManager } = useAuth();
    const { t } = useSettings();
    const { say } = useStatus();
    const [rows, setRows] = useState<Row[]>([]);
    const [leave, setLeave] = useState<{ type: LeaveType; from: string; to: string; reason: string } | null>(null);

    const load = useCallback(async () => {
        // current week (Mon-Sun)
        const today = startOfToday();
        const monday = addDays(today, -((today.getDay() + 6) % 7));
        const sunday = addDays(monday, 6);

        let members: Membership[] = [me!];
        if (isManager) {
            const { data } = await supabase.from("memberships").select("*")
                .eq("organization_id", org!.id).eq("active", true).order("full_name");
            members = (data ?? []) as Membership[];
        }

        setRows(await Promise.all(members.map(async member => ({
            member, s: await computeHours(org!.id, member, monday, sunday)
        }))));
    }, [org, me, isManager]);

    useEffect(() => { void load(); }, [load]);

    async function submitLeave() {
        if (!leave || !leave.from || !leave.to) return;
        if (leave.to < leave.from) { alert("End date can't be before start date"); return; }

        const { error } = await supabase.from("leave_requests").insert({
            organization_id: org!.id, membership_id: me!.id, type: leave.type,
            date_start: leave.from, date_end: leave.to, reason: leave.reason, status: "pending"
        });

        say(error ? error.message : `${LEAVE_LABELS[leave.type]} request submitted`, error ? "error" : "success");
        setLeave(null);
    }

    const open = (type: LeaveType) => setLeave({ type, from: "", to: "", reason: "" });

    return (
        <Page title="Hours" right={<>
            <button className="header-action-btn" onClick={() => open("freiwunsch")}>{t("hours.freiwunsch")}</button>
            <button className="header-action-btn" onClick={() => open("urlaub")}>{t("hours.urlaub")}</button>
        </>}>
            <div id="hoursSummaryPanel">
                <table>
                    <thead><tr><th>Staff</th><th>Soll</th><th>Ist</th><th>Überstunden</th></tr></thead>
                    <tbody>
                        {rows.map(({ member, s }) => (
                            <tr key={member.id}>
                                <td>{member.full_name}</td>
                                <td>{formatHours(s.sollHours)}</td>
                                <td>{formatHours(s.istHours)}</td>
                                <td className={s.ueberstunden >= 0 ? "status-msg-success" : "status-msg-error"}>{formatHours(s.ueberstunden)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {leave && (
                <Modal title={`Request ${LEAVE_LABELS[leave.type]}`} onClose={() => setLeave(null)} onSubmit={submitLeave} submitLabel="Submit">
                    <label>From</label>
                    <input type="date" value={leave.from} onChange={e => setLeave({ ...leave, from: e.target.value })} />
                    <label>To</label>
                    <input type="date" value={leave.to} onChange={e => setLeave({ ...leave, to: e.target.value })} />
                    <label>Reason (optional)</label>
                    <textarea value={leave.reason} onChange={e => setLeave({ ...leave, reason: e.target.value })} />
                </Modal>
            )}
        </Page>
    );
}
