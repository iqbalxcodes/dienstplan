// User settings (language, notifications). Same panel style as Admin.
import { useState } from "react";
import { Field, Panel } from "../components/Panel";
import { useAuth } from "../lib/auth";
import { tr, useSettings, type Language } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { disablePush, enablePush, isPushSupported } from "../lib/push";

export default function Settings() {

    const { org, me } = useAuth();
    const { settings, update } = useSettings();
    const { say } = useStatus();
    const [busy, setBusy] = useState(false);
    const enabled = settings.notificationsEnabled;

    async function toggle(on: boolean) {
        setBusy(true);
        if (!on) {
            await disablePush();
            update({ notificationsEnabled: false });
        } else {
            update({ notificationsEnabled: await enablePush(org!.id, me!.id) });
        }
        say(tr("Changes saved"), "success");
        setBusy(false);
    }

    const note = !isPushSupported()
        ? tr("Push notifications are not supported in this browser.")
        : enabled && Notification.permission === "denied"
            ? tr("Notifications are blocked in your browser settings - enable them for this site to receive reminders.")
            : tr("Get a notification 15 minutes before your shift starts or ends - even when the app is closed.");

    return (
        <div className="dsh">
            <div className="dsh-h"><h2>{tr("settings.title")}</h2></div>

            <div className="ad-stack">
                <Panel title={tr("settings.language")}>
                    <Field label={tr("settings.saveNote")}>
                        <select value={settings.language} onChange={e => { update({ language: e.target.value as Language }); }}>
                            <option value="de">Deutsch</option>
                            <option value="en">English</option>
                            <option value="id">Bahasa Indonesia</option>
                        </select>
                    </Field>
                </Panel>

                <Panel title={tr("Shift Reminders")}>
                    <div className="settings-toggle-row" aria-busy={busy}>
                        <button className={"settings-toggle-btn" + (enabled ? " active" : "")} disabled={busy} onClick={() => toggle(true)}>{tr("On")}</button>
                        <button className={"settings-toggle-btn" + (!enabled ? " active" : "")} disabled={busy} onClick={() => toggle(false)}>{tr("Off")}</button>
                    </div>
                    <span className="plan-entry-meta">{note}</span>
                </Panel>
            </div>
        </div>
    );
}