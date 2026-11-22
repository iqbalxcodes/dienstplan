import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { CircleArrowOutUpRight, CircleArrowRight, Clock, FileText, MapPin } from "lucide-react";
import { Modal } from "../components/Modal";
import { useAuth } from "../lib/auth";
import { useLog } from "../lib/activity";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { addDays, duration, fmtDT, hm, iso, parseDate } from "../lib/dates";
import { useSettings } from "../lib/i18n";
import { fileComplaint } from "../lib/complaints";
import { findShiftConflicts } from "../lib/shifts";
import { DEFAULT_AREAS, DEFAULT_ROLES, DEFAULT_SHIFT_COLOR, type Shift, type TimeEntry } from "../lib/types";

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

    return <div ref={el} id="map" className="dsh-map" />;
}

const STATUS_COLOR: Record<string, string> = { pending: "#dba43d", rejected: "#cc3535", approved: "#17a53a" };

function MyEntries({ refreshKey }: { refreshKey: number }) {

    const { org, me } = useAuth();
    const { say } = useStatus();
    const [list, setList] = useState<TimeEntry[]>([]);
    const [complaint, setComplaint] = useState<{ entryId: string; message: string; files: File[] } | null>(null);

    // finished shifts only (checked out)
    useEffect(() => {
        supabase.from("time_entries").select("*, shifts:shift_id(*)")
            .eq("organization_id", org!.id).eq("membership_id", me!.id)
            .not("clock_out", "is", null)
            .order("created_at", { ascending: false }).limit(10)
            .then(({ data }) => setList((data ?? []) as TimeEntry[]));
    }, [org, me, refreshKey]);

    async function submit() {
        if (!complaint || !complaint.message.trim()) return;
        const err = await fileComplaint(org!.id, me!.id, complaint.entryId, complaint.message, complaint.files);
        say(err ?? "Complaint filed — a manager will review it", err ? "error" : "success");
        setComplaint(null);
    }

    if (list.length === 0) return <p className="entry-empty">No entries yet.</p>;

    return (
        <>
            {list.map(e => {
                const area = [e.area_label ?? e.shifts?.area_label, e.role_label ?? e.shifts?.role_label].filter(Boolean).join(" - ");
                return (
                    <div key={e.id} className="entry-card" style={{ "--c": STATUS_COLOR[e.status] } as React.CSSProperties}>
                        <span className="entry-pill">{e.status}</span>
                        <strong>{e.shift_code ?? e.shifts?.shift_code ?? "\u2014"}</strong>
                        <span className="entry-item"><MapPin size={22} />{area || "\u2014"}</span>
                        <span className="entry-item"><CircleArrowRight size={22} />{fmtDT(e.clock_in)}</span>
                        <span className="entry-item"><CircleArrowOutUpRight size={22} />{fmtDT(e.clock_out)}</span>
                        <span className="entry-item"><Clock size={22} />{e.clock_in && e.clock_out ? duration(e.clock_in, e.clock_out) : "\u2014"}</span>
                        <span className="entry-item" title={e.employee_note ?? ""}><FileText size={22} /><span className="entry-note">{e.employee_note || "-"}</span></span>
                        {e.status === "rejected" && (
                            <button className="entry-btn" onClick={() => setComplaint({ entryId: e.id, message: "", files: [] })}>File Complaint</button>
                        )}
                    </div>
                );
            })}

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
    const { settings: user } = useSettings();
    const { say } = useStatus();
    const log = useLog();
    const [upcoming, setUpcoming] = useState<Shift[]>([]);
    const [openShifts, setOpenShifts] = useState<Shift[]>([]);
    const [claimed, setClaimed] = useState<Set<string>>(new Set());   // open shifts I already applied for
    const [ask, setAsk] = useState<Shift | null>(null);               // non-null = "send request?" popup
    const [open, setOpen] = useState<TimeEntry | null>(null);
    const [pos, setPos] = useState<LL | null>(null);
    const [geo, setGeo] = useState<"wait" | "ok" | "denied" | "unsupported">("wait");
    const [geoKey, setGeoKey] = useState(0);
    const [comment, setComment] = useState("");
    const [area, setArea] = useState("");
    const [role, setRole] = useState("");
    const [now, setNow] = useState(Date.now());
    const [entriesKey, setEntriesKey] = useState(0);

    const settings = org!.settings ?? {};
    const labels = settings.role_labels ?? DEFAULT_ROLES;
    const areas = settings.areas?.length ? settings.areas : DEFAULT_AREAS;
    const nearM = settings.checkin_radius_m ?? 150;
    const strict = settings.checkin_strict ?? "warn";
    const wp: LL | null = settings.workplace_lat && settings.workplace_lng ? [settings.workplace_lat, settings.workplace_lng] : null;
    const colorOf = (code?: string | null) => settings.shift_types?.find(t => t.code === code)?.color ?? DEFAULT_SHIFT_COLOR;
    const weekday = new Intl.DateTimeFormat(user.language, { weekday: "long" });

    const todayIso = iso(new Date());
    const todayShift = upcoming.find(s => s.shift_date === todayIso) ?? null;
    const checkedIn = open !== null;
    // a published shift (or a running entry) locks area/role; extra shifts choose their own
    const locked = checkedIn || !!todayShift;

    const refresh = useCallback(async () => {
        await supabase.rpc("resolve_open_shifts", { p_org: org!.id });   // auto-assign single applicants (H-N)

        const [shifts, entry, openQ, claims] = await Promise.all([
            supabase.from("shifts").select("*")
                .eq("organization_id", org!.id).eq("membership_id", me!.id)
                .eq("status", "published")
                .gte("shift_date", iso(new Date())).lte("shift_date", iso(addDays(new Date(), 13)))
                .order("shift_date").order("start_time"),
            supabase.from("time_entries").select("*")
                .eq("organization_id", org!.id).eq("membership_id", me!.id)
                .is("clock_out", null).order("clock_in", { ascending: false }).limit(1).maybeSingle(),
            supabase.from("shifts").select("*")
                .eq("organization_id", org!.id).eq("is_open", true).eq("status", "published")
                .gte("shift_date", iso(new Date())).lte("shift_date", iso(addDays(new Date(), 13)))
                .order("shift_date").order("start_time"),
            supabase.from("open_shift_claims").select("shift_id")
                .eq("membership_id", me!.id).eq("status", "pending")
        ]);
        setUpcoming((shifts.data ?? []) as Shift[]);
        setOpen((entry.data as TimeEntry) ?? null);
        setOpenShifts((openQ.data ?? []) as Shift[]);
        setClaimed(new Set((claims.data ?? []).map((c: any) => c.shift_id as string)));
        setEntriesKey(k => k + 1);
    }, [org, me]);

    useEffect(() => { void refresh(); }, [refresh]);

    useEffect(() => {
        if (!navigator.geolocation) { setGeo("unsupported"); return; }
        const id = navigator.geolocation.watchPosition(
            p => { setPos([p.coords.latitude, p.coords.longitude]); setGeo("ok"); },
            () => setGeo("denied"),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
        return () => navigator.geolocation.clearWatch(id);
    }, [geoKey]);

    useEffect(() => {
        if (!open) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [open]);

    useEffect(() => {
        const src = open ?? todayShift;
        setArea(src?.area_label ?? areas[0]);
        setRole(src?.role_label ?? labels[0]);
    }, [open?.id, todayShift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const dist = wp && pos ? Math.round(haversine(pos, wp)) : null;
    const elapsedSec = open?.clock_in ? Math.max(0, Math.floor((now - Date.parse(open.clock_in)) / 1000)) : 0;
    const code = todayShift?.shift_code ?? open?.shift_code;

    function allow() {
        setGeoKey(k => k + 1);
        say("If nothing happens, enable location for this site in your browser settings.", "info");
    }

    async function claim() {
        const s = ask!;
        setAsk(null);
        const { conflicts } = await findShiftConflicts(org!.id, me!.id, s.shift_date, s.start_time, s.end_time);
        if (conflicts.length) { say("You already have an overlapping shift", "error"); return; }
        const { error } = await supabase.from("open_shift_claims")
            .insert({ organization_id: org!.id, shift_id: s.id, membership_id: me!.id, status: "pending" });
        say(error ? error.message : "Request sent — waiting for approval", error ? "error" : "success");
        await refresh();
    }

    async function checkIn() {
        if (strict === "enforce" && dist !== null && dist > nearM) {
            alert(`Check-in blocked \u2014 you are ~${dist} m from the workplace.`);
            return;
        }
        const t = new Date().toISOString();
        const row = {
            organization_id: org!.id,
            membership_id: me!.id,
            shift_id: todayShift?.id ?? null,
            shift_code: todayShift?.shift_code ?? null,
            area_label: area,
            role_label: role,
            clock_in: t,
            original_clock_in: t,
            source: "employee",
            status: "pending",
            employee_note: comment.trim() || null
        };

        let res = await supabase.from("time_entries").insert(row).select("id").single();
        if (res.error?.code === "PGRST204") {   // migration 001 not applied yet: retry without the new columns
            const { shift_code: _c, area_label: _a, ...legacy } = row;
            res = await supabase.from("time_entries").insert(legacy).select("id").single();
        }
        if (res.error) { alert(res.error.message); return; }

        void log("attendance.check_in", `Checked in${wp ? " at workplace" : ""}`,
            { workplace: org!.name, distance_m: dist }, "time_entry", res.data.id);

        setComment("");
        say("Checked in", "success");
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
        say("Checked out — waiting for approval", "success");
        await refresh();
    }

    const Go = checkedIn ? CircleArrowOutUpRight : CircleArrowRight;

    return (
        <div className="dsh">

            <div className="dsh-h"><h2>My Shift</h2></div>
            <div className="shift-strip">
                {upcoming.length === 0 && <p className="entry-empty">No shifts scheduled.</p>}
                {upcoming.map(s => (
                    <div key={s.id} className={"shift-card" + (s.shift_date === todayIso ? " is-today" : "")}
                        style={{ "--c": colorOf(s.shift_code) } as React.CSSProperties}>
                        <div className="shift-card-top">
                            <span>{weekday.format(parseDate(s.shift_date))}</span>
                            <span>{s.shift_date.slice(8)}.{s.shift_date.slice(5, 7)}.</span>
                        </div>
                        <div className="shift-card-time">{hm(s.start_time)} - {hm(s.end_time)}</div>
                        <div className="shift-card-area">{[s.area_label, s.role_label].filter(Boolean).join(" - ") || "\u2014"}</div>
                    </div>
                ))}
            </div>

            {openShifts.length > 0 && (
                <>
                    <div className="dsh-h"><h2>Open Shift</h2></div>
                    <div className="shift-strip">
                        {openShifts.map(s => {
                            const wait = claimed.has(s.id);
                            const day = weekday.format(parseDate(s.shift_date));
                            const date = `${s.shift_date.slice(8)}.${s.shift_date.slice(5, 7)}.`;
                            return (
                                <div key={s.id} className={"shift-card" + (wait ? "" : " click")}
                                    style={{ "--c": wait ? STATUS_COLOR.pending : colorOf(s.shift_code) } as React.CSSProperties}
                                    onClick={() => { if (!wait) setAsk(s); }}>
                                    <div className="shift-card-top">
                                        {wait
                                            ? <><span>Pending</span><span>{day}, {date}</span></>
                                            : <><span>{day}</span><span>{date}</span></>}
                                    </div>
                                    <div className="shift-card-time">{hm(s.start_time)} - {hm(s.end_time)}</div>
                                    <div className="shift-card-area">{[s.area_label, s.role_label].filter(Boolean).join(" - ") || "\u2014"}</div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            <div className="dsh-h">
                <h2>{todayShift || checkedIn ? "Today\u2019s Shift" : "Extra Shift"}{code ? ` - ${code}` : ""}</h2>
                <span className="dsh-note">
                    {geo === "denied" && <>Location permission denied - showing workplace only. <button onClick={allow}>Allow</button></>}
                    {geo === "unsupported" && "Geolocation not supported - showing workplace only."}
                    {geo === "wait" && "Locating you…"}
                    {geo === "ok" && dist !== null && (dist <= nearM ? `At workplace (~${dist} m away)` : `Not at workplace (~${dist} m away)`)}
                </span>
            </div>

            <MapView wp={wp} pos={pos} />

            <div className="att-grid">
                <div className="att-field">
                    <label htmlFor="attArea">Area</label>
                    <select id="attArea" value={area} disabled={locked} onChange={e => setArea(e.target.value)}>
                        {[...new Set([...areas, area])].filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                </div>
                <div className="att-field">
                    <label htmlFor="attRole">Role</label>
                    <select id="attRole" value={role} disabled={locked} onChange={e => setRole(e.target.value)}>
                        {[...new Set([...labels, role])].filter(Boolean).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                <div className="att-field">
                    <label>Scheduled</label>
                    <input readOnly value={todayShift ? `${hm(todayShift.start_time)} - ${hm(todayShift.end_time)}` : "\u2014"} />
                </div>
                <div className="att-field">
                    <label>Elapsed</label>
                    <input readOnly value={hms(elapsedSec)} />
                </div>

                <div className="att-field comment">
                    <label htmlFor="attComment">Comment<small>optional</small></label>
                    <textarea id="attComment" value={comment} onChange={e => setComment(e.target.value)} />
                </div>

                <button className={"att-go" + (checkedIn ? " checkout" : "")} onClick={checkedIn ? checkOut : checkIn}>
                    <Go size={44} strokeWidth={1.5} />
                    {checkedIn ? "Check-out" : "Check-in"}
                </button>
            </div>

            <div className="dsh-h"><h2>Recent Entries</h2></div>
            <MyEntries refreshKey={entriesKey} />

            {ask && (
                <Modal title="Open Shift" onClose={() => setAsk(null)} onSubmit={claim} submitLabel="Yes" cancelLabel="No">
                    <p>Send request to work on {ask.shift_date.slice(8)}.{ask.shift_date.slice(5, 7)}. ({hm(ask.start_time)} - {hm(ask.end_time)})?</p>
                </Modal>
            )}

        </div>
    );
}