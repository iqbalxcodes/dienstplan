import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { useStatus } from "../lib/status";
import { LoginOverlay } from "./LoginOverlay";

const NAV = [
    { label: "nav.dashboard", to: "/" },
    { label: "nav.schedule", to: "/schedule" },
    { label: "nav.hours", to: "/hours" },
    { label: "nav.manager", to: "/manager", roles: ["manager", "admin"] },
    { label: "nav.admin", to: "/admin", roles: ["admin"] },
    { label: "nav.history", to: "/history", roles: ["manager", "admin"] },
    { label: "nav.settings", to: "/settings" }
];

function HeaderBar() {

    const { org, me } = useAuth();
    const [hello, setHello] = useState(true);
    const [now, setNow] = useState(new Date());

    // greeting shows 3s after login, then the org name
    useEffect(() => {
        setHello(true);
        const id = setTimeout(() => setHello(false), 3000);
        return () => clearTimeout(id);
    }, [me?.id]);

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    const h = now.getHours();
    const greeting = h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
    const text = me && hello ? `${greeting}, ${me.full_name.split(" ")[0]}!` : (org?.name ?? "Dienstplan");

    return (
        <div id="pageHeaderBar" className="page-header-bar">
            <span className="page-greeting">{text}</span>
            <div className="page-header-right">
                <Link to="/settings" className="page-gear-btn" title="Settings" aria-label="Settings">&#9881;</Link>
                <div className="page-header-clock">
                    <span id="pageClockDate">{now.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
                    <span id="pageClockTime">{now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
            </div>
        </div>
    );
}

function Nav() {
    const { me } = useAuth();
    const { t } = useSettings();
    return (
        <div id="pageNavigation" className="rack-tabs">
            {NAV.filter(n => !n.roles || (me && n.roles.includes(me.role))).map(n => (
                <NavLink key={n.to} to={n.to} end
                    className={({ isActive }) => "rack-tab" + (isActive ? " active" : "")}>
                    {t(n.label)}
                </NavLink>
            ))}
        </div>
    );
}

function StatusBar() {
    const { me, logout } = useAuth();
    const { msg, setInfoEl, setNavEl } = useStatus();
    return (
        <div id="statusBar">
            <div id="userArea">
                {me
                    ? <><span>{me.full_name} · {me.role}</span><button style={{ marginLeft: 8 }} onClick={logout}>Logout</button></>
                    : <span className="plan-entry-meta">Not signed in</span>}
            </div>
            <div id="contextArea">
                {msg && <span className={`status-msg-${msg.kind}`}>{msg.text}</span>}
            </div>
            <div id="paginationInfo" ref={setInfoEl} />
            <div id="paginationNav" ref={setNavEl} />
        </div>
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
            <HeaderBar />
            <Nav />
            {me ? <Outlet /> : <div className="table-container" />}
            <StatusBar />
            {ready && !me && (choices ? <OrgChooser /> : <LoginOverlay />)}
        </>
    );
}

