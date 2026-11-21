// Zeiterfassung: UI only. TODO backend: replace STATS / ROWS / TOTALS with data from time_entries.
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { startOfMonth, startOfToday } from "../lib/dates";

const STATS = [
    "Soll-Stunden", "Ist-Stunden", "Plan Stunden", "Differenz", "Übertrag Vormonat", "Gesamtsaldo",
    "Überstunden", "Minusstunden", "Ausbezahlte Urlaub", "Freizeitausgleich", "Manuelle Korrektur",
    "Verfallene Stunden", "Urlaubsstunden", "Krankheitsstunden", "Feiertagsstunden", "Nachtstunden",
    "Sonn- & Feiertagsstunden", "Pausenzeit"
].map(label => ({ label, value: "0:00" }));

const COLUMNS = ["Dates", "Shift", "Check-in", "Pause", "Check-out", "Elapsed", "Soll", "Balance", "Notes"];

const ROWS = Array.from({ length: 12 }, (_, i) => ({
    date: `${String(i + 1).padStart(2, "0")}.11.2026`, shift: "FX", in: "6:35:00", pause: "0:30:00",
    out: "15:00:00", elapsed: "7:55:00", soll: "8:00:00", balance: "- 0:05:00", note: "-"
}));

const TOTALS = { elapsed: "164:00:00", soll: "164:00:00", balance: "0:00:00" };

export default function Zeiterfassung() {

    const { isManager } = useAuth();
    const { settings: user } = useSettings();
    const { say } = useStatus();
    const [month, setMonth] = useState(() => startOfMonth(startOfToday()));

    const step = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));
    const monthName = new Intl.DateTimeFormat(user.language, { month: "long", year: "numeric" }).format(month);
    const soon = (what: string) => say(`${what}: coming soon`, "info");

    return (
        <div className="dsh">
            <div className="dsh-h split">
                <h2>Zeiterfassung</h2>
                <button className="ro-export" onClick={() => soon("Export")}>Export</button>
            </div>

            <div className="zt">
                <aside className="zt-stats">
                    {STATS.map(s => <div key={s.label}><b>{s.label}</b><span>{s.value}</span></div>)}
                </aside>

                <div className="ro-panel">
                    <div className="ro-bar">
                        <div className="ro-side"><h2>{monthName}</h2></div>
                        <div className="ro-side">
                            <button className="ro-btn" onClick={() => step(-1)}>Prev.</button>
                            <button className="ro-btn" onClick={() => step(1)}>Next</button>
                        </div>
                        <div className="ro-side">
                            <button className="ro-btn" onClick={() => soon("Filter")}>Filter</button>
                        </div>
                    </div>

                    <div className="zt-table">
                        <table>
                            <thead><tr>{COLUMNS.map(c => <th key={c}>{c}</th>)}</tr></thead>
                            <tbody>
                                {ROWS.map((r, i) => (
                                    <tr key={i}>
                                        <td>{r.date}</td><td>{r.shift}</td><td>{r.in}</td><td>{r.pause}</td><td>{r.out}</td>
                                        <td>{r.elapsed}</td><td>{r.soll}</td><td>{r.balance}</td><td>{r.note}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="ro-foot">
                        <div className="ro-side">
                            {isManager && <button className="ro-btn" onClick={() => soon("Edit")}>Edit</button>}
                        </div>
                        <div className="ro-side zt-totals">
                            <span>Total Elapsed = {TOTALS.elapsed}</span>
                            <span>Total Soll = {TOTALS.soll}</span>
                            <span>Total Balance = {TOTALS.balance}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}