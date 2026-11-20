import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { Page, Section } from "../components/Page";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { addDays, DOW, fmt, iso, MONTHS, parseDate } from "../lib/dates";
import { fileComplaint } from "../lib/complaints";
import { DEFAULT_ROLES, type Shift, type TimeEntry } from "../lib/types";

// bundlers break Leaflet's default icon lookup
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

type LL = [number, number];

function haversine(a: LL, b: LL): number {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

const two = (n: number) => String(n).padStart(2, "0");
const hms = (sec: number) => `${two(Math.floor(sec / 3600))}:${two(Math.floor(sec % 3600 / 60))}:${two(sec % 60)}`;

/** Both pins always visible: map auto-frames user + workplace, no zoom controls. */
function MapView({ wp, pos }: { wp: LL | null; pos: LL | null }) {

    const el = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const userPin = useRef<L.CircleMarker | null>(null);
    const workPin = useRef<L.Marker | null>(null);
    const lastFit = useRef<LL | null>(null);

    useEffect(() => {
        const m = L.map(el.current!, { zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(m);
        m.setView([-6.2, 106.816666], 13);
        map.current = m;
        setTimeout(() => m.invalidateSize(), 200);
        const onResize = () => m.invalidateSize();
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
            m.remove();
            map.current = userPin.current = workPin.current = null;
            lastFit.current = null;
        };
    }, []);

    useEffect(() => {
        const m = map.current!;

        if (wp) {
            if (!workPin.current) workPin.current = L.marker(wp).addTo(m).bindPopup("Workplace");
            else workPin.current.setLatLng(wp);
        }

        if (pos) {
            if (!userPin.current) userPin.current = L.circleMarker(pos, { radius: 10, color: "#1565c0", fillOpacity: 0.8 }).addTo(m).bindPopup("You are here");
            else userPin.current.setLatLng(pos);
        }

        if (wp && pos) {
            if (!lastFit.current || haversine(lastFit.current, pos) > 50) {
                m.fitBounds(L.latLngBounds([wp, pos]).pad(0.4), { animate: true });
                lastFit.current = pos;
            }
        } else if (pos) {
            m.setView(pos, 16, { animate: true });
        } else if (wp) {
            m.setView(wp, 15);
        }
    }, [wp, pos]);

    return <div ref={el} id="map" className="att-map" />;
}

function MyEntries({ refreshKey }: { refreshKey: number }) {

    const { org, me } = useAuth();
    const { say } = useStatus();
    const [list, setList] = useState<TimeEntry[]>([]);
    const [complaint, setComplaint] = useState<{ entryId: string; message: string; files: File[] } | null>(null);

    useEffect(() => {
        supabase.from("time_entries").select("*")
            .eq("organization_id", org!.id).eq("membership_id", me!.id)
            .order("created_at", { ascending: false }).limit(10)
            .then(({ data }) => setList((data ?? []) as TimeEntry[]));
    }, [org, me, refreshKey]);

    async function submit() {
        if (!complaint || !complaint.message.trim()) return;
        const err = await fileComplaint(org!.id, me!.id, complaint.entryId, complaint.message, complaint.files);
        say(err ?? "Complaint filed — a manager will review it", err ? "error" : "success");
        setComplaint(null);
    }

    if (list.length === 0) return <p style={{ color: "#888" }}>No entries yet.</p>;

    return (
        <>
            {list.map(e => (
                <div key={e.id} className={`plan-entry-card status-${e.status}`}>
                    <div>
                        <span className={`status-badge status-${e.status}`}>{e.status}</span>
                        <div className="plan-entry-meta">In: {fmt(e.clock_in)} · Out: {fmt(e.clock_out)}</div>
                        {e.manager_note && <div className="plan-entry-meta">Manager note: {e.manager_note}</div>}
                    </div>
                    {e.status !== "pending" && (
                        <div className="plan-entry-actions">
                            <button onClick={() => setComplaint({ entryId: e.id, message: "", files: [] })}>File Complaint</button>
                        </div>
                    )}
                </div>
            ))}

            {complaint && (
                <Modal title="File Complaint" onClose={() => setComplaint(null)} onSubmit={submit} submitLabel="Submit">
                    <label>What is wrong with this entry?</label>
                    <textarea value={complaint.message} onChange={e => setComplaint({ ...complaint, message: e.target.value })} />
                    <label>Evidence (optional photo / PDF)</label>
                    <input type="file" multiple onChange={e => setComplaint({ ...complaint, files: Array.from(e.target.files ?? []) })} />
                </Modal>
            )}
        </>
    );
}

export default function Dashboard() {

    const { org, me } = useAuth();
    const log = useLog();
    const [upcoming, setUpcoming] = useState<Shift[]>([]);
    const [open, setOpen] = useState<TimeEntry | null>(null);
    const [pos, setPos] = useState<LL | null>(null);
    const [geoMsg, setGeoMsg] = useState("");
    const [comment, setComment] = useState("");
    const [role, setRole] = useState("");
    const [now, setNow] = useState(Date.now());
    const [entriesKey, setEntriesKey] = useState(0);

    const settings = org!.settings ?? {};
    const labels = settings.role_labels ?? DEFAULT_ROLES;
    const nearM = settings.checkin_radius_m ?? 150;
    const strict = settings.checkin_strict ?? "warn";
    const wp: LL | null = settings.workplace_lat && settings.workplace_lng ? [settings.workplace_lat, settings.workplace_lng] : null;

    const todayIso = iso(new Date());
    const todayShift = upcoming.find(s => s.shift_date === todayIso) ?? null;
    const checkedIn = open !== null;

    const refresh = useCallback(async () => {
        const [shifts, entry] = await Promise.all([
            supabase.from("shifts").select("*")
                .eq("organization_id", org!.id).eq("membership_id", me!.id)
                .gte("shift_date", iso(new Date())).lte("shift_date", iso(addDays(new Date(), 13)))
                .order("shift_date"),
            supabase.from("time_entries").select("*")
                .eq("organization_id", org!.id).eq("membership_id", me!.id)
                .is("clock_out", null).order("clock_in", { ascending: false }).limit(1).maybeSingle()
        ]);
        setUpcoming((shifts.data ?? []) as Shift[]);
        setOpen((entry.data as TimeEntry) ?? null);
        setEntriesKey(k => k + 1);
    }, [org, me]);

    useEffect(() => { void refresh(); }, [refresh]);

    useEffect(() => {
        if (!navigator.geolocation) { setGeoMsg("Geolocation not supported \u2014 showing workplace."); return; }
        const id = navigator.geolocation.watchPosition(
            p => setPos([p.coords.latitude, p.coords.longitude]),
            () => setGeoMsg("Location permission denied \u2014 showing workplace only."),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
        return () => navigator.geolocation.clearWatch(id);
    }, []);

    useEffect(() => {
        if (!open) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [open]);

    useEffect(() => { setRole(todayShift?.role_label ?? labels[0]); }, [todayShift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const dist = wp && pos ? Math.round(haversine(pos, wp)) : null;
    const elapsedSec = open?.clock_in ? Math.max(0, Math.floor((now - Date.parse(open.clock_in)) / 1000)) : 0;

    const sub = checkedIn
        ? `Since ${new Date(open!.clock_in!).toLocaleTimeString("de-DE")}`
        : dist !== null
            ? (dist <= nearM ? `At workplace (~${dist} m away)` : `Not at workplace (~${dist} m away)`)
            : (geoMsg || (pos ? "" : "Locating you…"));

    async function checkIn() {
        if (strict === "enforce" && dist !== null && dist > nearM) {
            alert(`Check-in blocked \u2014 you are ~${dist} m from the workplace.`);
            return;
        }
        const t = new Date().toISOString();
        const { data: entry, error } = await supabase.from("time_entries").insert({
            organization_id: org!.id,
            membership_id: me!.id,
            shift_id: todayShift?.id ?? null,
            role_label: todayShift?.role_label ?? role,
            clock_in: t,
            original_clock_in: t,
            source: "employee",
            status: "pending",
            employee_note: comment.trim() || null
        }).select("id").single();

        if (error) { alert(error.message); return; }

        void log("attendance.check_in", `Checked in${wp ? " at workplace" : ""}`,
            { workplace: org!.name, distance_m: dist }, "time_entry", entry.id);

        setComment("");
        await refresh();
    }

    async function checkOut() {
        const t = new Date().toISOString();
        const c = comment.trim();

        const { error } = await supabase.from("time_entries").update({
            clock_out: t,
            original_clock_out: t,
            status: "pending",
            employee_note: c ? `${open!.employee_note ?? ""} ${c}`.trim() : open!.employee_note
        }).eq("id", open!.id);

        if (error) { alert(error.message); return; }

        void log("attendance.check_out", `Checked out after ${hms(elapsedSec)}`,
            { workplace: org!.name, elapsed: hms(elapsedSec) }, "time_entry", open!.id);

        setComment("");
        await refresh();
    }

    const roleOptions = [...new Set([...labels, ...(todayShift?.role_label ? [todayShift.role_label] : [])])];

    return (
        <Page title="Dashboard">
            <div className="dash-stack">

                <Section title="My Shift">
                    <div className="shift-strip">
                        {upcoming.length === 0 && <p className="plan-entry-meta" style={{ padding: "0 12px" }}>No shifts scheduled.</p>}
                        {upcoming.map(s => {
                            const d = parseDate(s.shift_date);
                            return (
                                <div key={s.id} className={"shift-mini" + (s.shift_date === todayIso ? " is-today" : "")}>
                                    <div className="shift-mini-dow">{DOW[d.getDay()]}</div>
                                    <div className="shift-mini-date">{s.shift_date.slice(8)} {MONTHS[d.getMonth()]}</div>
                                    <div className="shift-mini-role">{s.role_label ?? labels[0]}</div>
                                    <div className="shift-mini-time">{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</div>
                                </div>
                            );
                        })}
                    </div>
                </Section>

                <Section title={todayShift
                    ? (checkedIn ? "Check Out" : "Check In")
                    : (checkedIn ? "Extra Shift \u2014 Check Out" : "Working extra shift today?")}>
                    <p className="plan-entry-meta" style={{ marginTop: 2 }}>{sub}</p>

                    <MapView wp={wp} pos={pos} />

                    <div className="att-info">
                        <div>
                            <span className="plan-entry-meta">Role</span>
                            <select value={role} disabled={checkedIn || !!todayShift} onChange={e => setRole(e.target.value)}>
                                {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <div>
                            <span className="plan-entry-meta">Scheduled</span>
                            <strong>{todayShift ? `${todayShift.start_time.slice(0, 5)}\u2013${todayShift.end_time.slice(0, 5)}` : "\u2014"}</strong>
                        </div>
                        <div>
                            <span className="plan-entry-meta">Elapsed</span>
                            <strong>{hms(elapsedSec)}</strong>
                        </div>
                    </div>

                    <label className="att-label" htmlFor="attComment">Comment (optional)</label>
                    <textarea id="attComment" rows={2} placeholder="e.g. forgot to check in earlier…"
                        value={comment} onChange={e => setComment(e.target.value)} />

                    <button className={"att-btn" + (checkedIn ? " checkout" : "")} onClick={checkedIn ? checkOut : checkIn}>
                        {checkedIn ? "Check Out" : "Check In"}
                    </button>
                </Section>

                <Section title="Recent Entries">
                    <MyEntries refreshKey={entriesKey} />
                </Section>

            </div>
        </Page>
    );
}
