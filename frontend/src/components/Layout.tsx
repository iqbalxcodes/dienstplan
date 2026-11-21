import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, ChevronDown, Clock, Settings, TriangleAlert } from "lucide-react";
import pkg from "../../package.json";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { supabase } from "../lib/supabase";
import { LoginOverlay } from "./LoginOverlay";

/** Button + popover. Closes on outside click or when an item is clicked. */
function Menu({ button, className, active, align = "left", children }:
    { button: ReactNode; className: string; active?: boolean; align?: "left" | "right"; children: ReactNode }) {

    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
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
    const { t } = useSettings();
    const { pathname } = useLocation();
    const [pending, setPending] = useState({ approvals: 0, complaints: 0, leave: 0 });

    // bell: pending work for managers (refreshed on every page change)
    useEffect(() => {
        if (!isManager || !org) return;
        const count = (table: string, col: string, val: string) =>
            supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org.id).eq(col, val).then(r => r.count ?? 0);
        Promise.all([
            count("time_entries", "status", "pending"), count("shift_change_requests", "status", "pending"),
            count("complaints", "status", "open"), count("leave_requests", "status", "pending")
        ]).then(([a, b, c, d]) => setPending({ approvals: a + b, complaints: c, leave: d }));
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
                    {me && <button onClick={logout}>Logout</button>}
                </Menu>

                {me && (
                    <nav className="hdr-nav">
                        <NavLink to="/" end className={link}>{t("nav.dashboard")}</NavLink>
                        <NavLink to="/schedule" className={link}>{t("nav.schedule")}</NavLink>
                        <Menu className={"hdr-link" + (timesActive ? " active" : "")} active={timesActive}
                            button={<>{t("nav.hours")} <ChevronDown size={16} /></>}>
                            <Link to="/zeiterfassung">{t("nav.timesheet")}</Link>
                            <Link to="/hours">{t("nav.leave")}</Link>
                        </Menu>
                        {isManager && (
                            <Menu className={"hdr-link" + (managerActive ? " active" : "")} active={managerActive}
                                button={<>{t("nav.manager")} <ChevronDown size={16} /></>}>
                                <Link to="/manager">{t("nav.manager")}</Link>
                                {isAdmin && <Link to="/admin">{t("nav.admin")}</Link>}
                            </Menu>
                        )}
                    </nav>
                )}

                {me && (
                    <div className="hdr-icons">
                        {isManager && <NavLink to="/history" className={icon} title={t("nav.history")}><Clock size={26} /></NavLink>}
                        <Menu className="hdr-icon" align="right" button={<><Bell size={26} />{total > 0 && <i className="hdr-dot" />}</>}>
                            {total === 0 && <span className="hdr-empty">No new notifications</span>}
                            {pending.approvals > 0 && <Link to="/manager">{pending.approvals} approval(s) pending</Link>}
                            {pending.complaints > 0 && <Link to="/manager">{pending.complaints} open complaint(s)</Link>}
                            {pending.leave > 0 && <Link to="/manager">{pending.leave} leave request(s)</Link>}
                        </Menu>
                        <NavLink to="/settings" className={icon} title={t("nav.settings")}><Settings size={26} /></NavLink>
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
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    const h = now.getHours();
    const greeting = h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";

    return (
        <div className="hdr-strip">
            <span>{me && `${greeting} ${me.full_name.split(" ")[0]}!`}</span>
            <span>
                {now.toLocaleDateString("de-DE", { weekday: "long" })}, den {now.toLocaleDateString("de-DE")} - {now.toLocaleTimeString("de-DE")}
            </span>
        </div>
    );
}

/** Footer = status/notification bar (left) + History pagination + version (right). */
function Footer() {
    const { msg, notice, setInfoEl, setNavEl } = useStatus();
    return (
        <footer id="statusBar">
            <div id="contextArea">
                {msg
                    ? <span className={`status-msg-${msg.kind}`}>{msg.text}</span>
                    : notice && <span className="footer-notice"><TriangleAlert size={20} />{notice}</span>}
            </div>
            <div id="paginationInfo" ref={setInfoEl} />
            <div id="paginationNav" ref={setNavEl} />
            <div className="app-version">Dienstplan v. {pkg.version}</div>
        </footer>
    );
}

function OrgChooser() {
    const { choices, choose } = useAuth();
    return (
        <div className="plan-modal-backdrop">
            <div className="plan-modal auth-card">
                <h3>Choose your workplace</h3>
                <p className="auth-hint">You belong to more than one organization.</p>
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