import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, ChevronDown, Clock, Settings, TriangleAlert, WifiOff } from "lucide-react";
import pkg from "../../package.json";
import { useAuth } from "../lib/auth";
import { tr, useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { LoginOverlay } from "./LoginOverlay";

/** Button + popover. Closes on outside tap/click or when an item is clicked. */
function Menu({ button, className, active, align = "left", children }:
    { button: ReactNode; className: string; active?: boolean; align?: "left" | "right"; children: ReactNode }) {

    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);

    return (
        <div className="hdr-menu" ref={ref}>
            <button className={className + (open || active ? " active" : "")} onClick={() => setOpen(o => !o)}>{button}</button>
            {open && <div className={`hdr-pop ${align}`} onClick={() => setOpen(false)}>{children}</div>}
        </div>
    );
}

function Header() {

    const { org, me, isManager, isAdmin, logout } = useAuth();
    const { pathname } = useLocation();
    const [pending, setPending] = useState({ approvals: 0, complaints: 0, leave: 0 });

    // bell: pending work for managers (refreshed on every page change)
    useEffect(() => {
        if (!isManager || !org) return;
        const q = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org.id);
        const n = (b: PromiseLike<{ count: number | null }>) => b.then(r => r.count ?? 0);
        Promise.all([
            n(q("time_entries").eq("status", "pending").not("clock_out", "is", null)),   // a running check-in is not "waiting for approval"
            n(q("shift_change_requests").eq("status", "pending")),
            n(q("complaints").eq("status", "open")),
            n(q("leave_requests").eq("status", "pending"))
        ]).then(([a, b, c, d]) => setPending({ approvals: a + b, complaints: c, leave: d }))
            .catch(() => undefined);   // offline: keep the old numbers
    }, [org, isManager, pathname]);

    const total = pending.approvals + pending.complaints + pending.leave;
    const link = ({ isActive }: { isActive: boolean }) => "hdr-link" + (isActive ? " active" : "");
    const icon = ({ isActive }: { isActive: boolean }) => "hdr-icon" + (isActive ? " active" : "");
    const managerActive = pathname.startsWith("/manager") || pathname.startsWith("/admin");
    const timesActive = pathname.startsWith("/hours") || pathname.startsWith("/zeiterfassung");

    return (
        <header className="app-header">
            <div className="hdr-top">

                <Menu className="hdr-profile" button={<>
                    <span className="hdr-avatar">{me?.full_name.charAt(0).toUpperCase()}</span>
                    <span className="hdr-who">
                        <strong>{me ? `${me.role === "employee" ? "CREW" : me.role.toUpperCase()} - ${me.full_name.split(" ")[0]}` : "Dienstplan"}</strong>
                        <span>{org?.name}</span>
                    </span></>}>
                    {me && <button onClick={logout}>{tr("Logout")}</button>}
                </Menu>

                {me && (
                    <nav className="hdr-nav">
                        <NavLink to="/" end className={link}>{tr("nav.dashboard")}</NavLink>
                        <NavLink to="/schedule" className={link}>{tr("nav.schedule")}</NavLink>
                        <Menu className={"hdr-link" + (timesActive ? " active" : "")} active={timesActive}
                            button={<>{tr("nav.hours")} <ChevronDown size={16} /></>}>
                            <Link to="/zeiterfassung">{tr("nav.timesheet")}</Link>
                            <Link to="/hours">{tr("nav.leave")}</Link>
                        </Menu>
                        {isManager && (
                            <Menu className={"hdr-link" + (managerActive ? " active" : "")} active={managerActive}
                                button={<>{tr("nav.manager")} <ChevronDown size={16} /></>}>
                                <Link to="/manager">{tr("nav.manager")}</Link>
                                {isAdmin && <Link to="/admin">{tr("nav.admin")}</Link>}
                            </Menu>
                        )}
                    </nav>
                )}

                {me && (
                    <div className="hdr-icons">
                        {isManager && <NavLink to="/history" className={icon} title={tr("nav.history")}><Clock size={26} /></NavLink>}
                        <Menu className="hdr-icon" align="right" button={<><Bell size={26} />{total > 0 && <i className="hdr-dot" />}</>}>
                            {total === 0 && <span className="hdr-empty">{tr("No new notifications")}</span>}
                            {pending.approvals > 0 && <Link to="/manager">{tr("{n} approval(s) pending", { n: pending.approvals })}</Link>}
                            {pending.complaints > 0 && <Link to="/manager">{tr("{n} open complaint(s)", { n: pending.complaints })}</Link>}
                            {pending.leave > 0 && <Link to="/manager">{tr("{n} leave request(s)", { n: pending.leave })}</Link>}
                        </Menu>
                        <NavLink to="/settings" className={icon} title={tr("nav.settings")}><Settings size={26} /></NavLink>
                    </div>
                )}
            </div>

            <Strip />
        </header>
    );
}

/** Thin strip under the header: greeting | (active-tab notch) | date + live clock. */
function Strip() {

    const { me } = useAuth();
    const { settings } = useSettings();
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    const h = now.getHours();
    const greeting = tr(h < 11 ? "Good morning" : h < 18 ? "Good day" : "Good evening");

    return (
        <div className="hdr-strip">
            <span>{me && `${greeting} ${me.full_name.split(" ")[0]}!`}</span>
            <span>
                {tr("{weekday}, {date} - {time}", {
                    weekday: new Intl.DateTimeFormat(settings.language, { weekday: "long" }).format(now),
                    date: now.toLocaleDateString("de-DE"),
                    time: now.toLocaleTimeString("de-DE")
                })}
            </span>
        </div>
    );
}

function useOnline() {
    const [on, setOn] = useState(navigator.onLine);
    useEffect(() => {
        const up = () => setOn(true), down = () => setOn(false);
        window.addEventListener("online", up);
        window.addEventListener("offline", down);
        return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
    }, []);
    return on;
}

/** Footer = status/notification bar (left) + History pagination + offline notice + version (right). */
function Footer() {
    const { msg, notice, setInfoEl, setNavEl } = useStatus();
    const online = useOnline();
    return (
        <footer id="statusBar">
            <div id="contextArea">
                {msg
                    ? <span className={`status-msg-${msg.kind}`}>{msg.text}</span>
                    : notice && <span className="footer-notice"><TriangleAlert size={20} />{notice}</span>}
            </div>
            <div id="paginationInfo" ref={setInfoEl} />
            <div id="paginationNav" ref={setNavEl} />
            {!online && (
                <div className="footer-offline">
                    <WifiOff size={18} />{tr("Offline! Data shown may not be accurate. Connect to the internet.")}
                </div>
            )}
            <div className="app-version">Dienstplan v. {pkg.version}</div>
        </footer>
    );
}

function OrgChooser() {
    const { choices, choose } = useAuth();
    return (
        <div className="plan-modal-backdrop">
            <div className="plan-modal auth-card">
                <h3>{tr("Choose your workplace")}</h3>
                <p className="auth-hint">{tr("You belong to more than one organization.")}</p>
                {choices!.map(c => (
                    <div key={c.id} className="plan-entry-actions" style={{ marginTop: 10 }}>
                        <button style={{ width: "100%" }} onClick={() => choose(c.id)}>
                            {c.organization?.name ?? c.full_name}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function Layout() {
    const { ready, me, choices } = useAuth();
    return (
        <>
            <Header />
            <main className="app-main">{me && <Outlet />}</main>
            <Footer />
            {ready && !me && (choices ? <OrgChooser /> : <LoginOverlay />)}
        </>
    );
}