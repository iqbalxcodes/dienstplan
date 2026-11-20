import { useState } from "react";
import { Page, Section } from "../components/Page";
import { useAuth } from "../lib/auth";
import { useSettings, type Language } from "../lib/i18n";
import { disablePush, enablePush, isPushSupported } from "../lib/push";

export default function Settings() {

    const { org, me } = useAuth();
    const { settings, update, t } = useSettings();
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
        setBusy(false);
    }

    const note = !isPushSupported()
        ? "Push notifications are not supported in this browser."
        : enabled && Notification.permission === "denied"
            ? "Notifications are blocked in your browser settings — enable them for this site to receive reminders."
            : "Get a notification 15 minutes before your shift starts or ends — even when the app is closed.";

    return (
        <Page title={t("settings.title")}>
            <div className="dash-stack">
                <Section title={t("settings.language")}>
                    <select value={settings.language} onChange={e => update({ language: e.target.value as Language })}>
                        <option value="de">Deutsch</option>
                        <option value="en">English</option>
                        <option value="id">Bahasa Indonesia</option>
                    </select>
                    <p className="plan-entry-meta" style={{ marginTop: 8 }}>{t("settings.saveNote")}</p>
                </Section>

                <Section title="Shift Reminders">
                    <div className="settings-toggle-row" aria-busy={busy}>
                        <button className={"settings-toggle-btn" + (enabled ? " active" : "")} disabled={busy} onClick={() => toggle(true)}>On</button>
                        <button className={"settings-toggle-btn" + (!enabled ? " active" : "")} disabled={busy} onClick={() => toggle(false)}>Off</button>
                    </div>
                    <p className="plan-entry-meta" style={{ marginTop: 8 }}>{note}</p>
                </Section>
            </div>
        </Page>
    );
}
