// Login, first login (magic link) and business onboarding (account -> business -> team).
import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";
import { DEFAULT_SHIFT_TYPES } from "../lib/roster";
import { DEFAULT_AREAS, DEFAULT_ROLES } from "../lib/types";

const REMEMBER_KEY = "dienstplan_remember";

const EYE = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
);
const EYE_OFF = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

const slugify = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6);

// ---------------- login ----------------

function LoginCard({ onRegister }: { onRegister: () => void }) {

    const { reload } = useAuth();
    const { t } = useSettings();
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const [show, setShow] = useState(false);
    const [remember, setRemember] = useState(true);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [forgot, setForgot] = useState(false);
    const [fEmail, setFEmail] = useState("");
    const [fMsg, setFMsg] = useState("");
    const [fBusy, setFBusy] = useState(false);

    async function login() {
        setErr(""); setInfo("");
        if (!email.trim() || !pass) { setErr("Please fill in email and password."); return; }
        localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
        if (error) { setErr(error.message); return; }
        await reload();
    }

    // invited by a manager (email already on the crew list): the link creates the account and logs in
    async function firstLogin() {
        setErr(""); setInfo("");
        if (!email.trim()) { setErr("Enter the email your manager added, then tap again."); return; }
        localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
        const { error } = await supabase.auth.signInWithOtp({
            email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: window.location.origin }
        });
        if (error) setErr(error.message); else setInfo(`Login link sent to ${email.trim()} - open it on this device.`);
    }

    async function sendReset() {
        if (!fEmail.trim()) return;
        setFBusy(true);
        const { error } = await supabase.auth.resetPasswordForEmail(fEmail.trim(), { redirectTo: `${window.location.origin}/reset` });
        setFMsg(error ? error.message : "Recovery email sent - check your inbox (and spam folder).");
        setFBusy(false);
    }

    return (
        <div className="plan-modal auth-card">
            <h3>{t("login.title")}</h3>

            <label>{t("login.email")}</label>
            <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />

            <label>{t("login.password")}</label>
            <div className="auth-pass-row">
                <input type={show ? "text" : "password"} autoComplete="current-password" value={pass}
                    onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
                <button type="button" className="auth-eye" onClick={() => setShow(!show)}
                    title={show ? "Hide password" : "Show password"} aria-label={show ? "Hide password" : "Show password"}>
                    {show ? EYE_OFF : EYE}
                </button>
            </div>

            <div className="auth-actions-row">
                <label className="auth-check">
                    <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                    <span>{t("login.remember")}</span>
                </label>
                <button className="primary" onClick={login}>{t("login.submit")}</button>
            </div>

            {err && <div className="auth-error">{err}</div>}
            {info && <div className="reset-msg ok">{info}</div>}

            <p className="auth-hint">
                <a href="#" onClick={e => { e.preventDefault(); void firstLogin(); }}>First login? Send me a login link</a> ·{" "}
                <a href="#" onClick={e => { e.preventDefault(); setForgot(!forgot); }}>{t("login.forgot")}</a>
            </p>
            <p className="auth-hint">
                <span>{t("login.noAccount")}</span>{" "}
                <a href="#" onClick={e => { e.preventDefault(); onRegister(); }}>{t("login.registerBusiness")}</a>
            </p>

            {forgot && (
                <div>
                    <hr />
                    <label>{t("login.forgotEmailLabel")}</label>
                    <div className="auth-forgot-row">
                        <input type="email" autoComplete="email" value={fEmail} onChange={e => setFEmail(e.target.value)} />
                        <button type="button" disabled={fBusy} onClick={sendReset}>{t("login.reset")}</button>
                    </div>
                    <p className="auth-hint">{fMsg}</p>
                </div>
            )}
        </div>
    );
}

// ---------------- signed in, but no workplace linked ----------------

function NoWorkplace({ onRegister }: { onRegister: () => void }) {

    const { user, reload, logout } = useAuth();
    const [busy, setBusy] = useState(false);

    return (
        <div className="plan-modal auth-card">
            <h3>No workplace yet</h3>
            <p className="auth-hint">Signed in as <b>{user?.email}</b>.</p>
            <p className="auth-hint">
                This email is not linked to a workplace. Ask your manager to add it under Manager → Crew, then check again -
                or register your own business.
            </p>
            <div className="auth-actions-row">
                <a href="#" onClick={e => { e.preventDefault(); void logout(); }}>Log out</a>
                <button className="primary" disabled={busy} onClick={async () => { setBusy(true); await reload(); setBusy(false); }}>Check again</button>
            </div>
            <p className="auth-hint"><a href="#" onClick={e => { e.preventDefault(); onRegister(); }}>Register a business instead</a></p>
        </div>
    );
}

// ---------------- onboarding: 1 account -> 2 business -> 3 team ----------------

interface CrewRow { role: string; name: string; email: string; }

function OnboardCard({ onBack }: { onBack: () => void }) {

    const { user, reload } = useAuth();
    const meta = (user?.user_metadata ?? {}) as { full_name?: string };
    const [step, setStep] = useState<1 | 2 | 3>(user ? 2 : 1);     // confirmed e-mail / existing login skips step 1
    const [name, setName] = useState(meta.full_name ?? "");
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const [pass2, setPass2] = useState("");
    const [orgName, setOrgName] = useState("");
    const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin");
    const [pos, setPos] = useState<[number, number] | null>(null);
    const [crew, setCrew] = useState<CrewRow[]>([]);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [busy, setBusy] = useState(false);

    const zones = useMemo<string[]>(() => {
        const list = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
        return [...(list ?? ["Europe/Berlin", "Europe/London", "UTC", "Asia/Jakarta"])].sort();
    }, []);

    const setRow = (i: number, patch: Partial<CrewRow>) => setCrew(c => c.map((r, j) => (j === i ? { ...r, ...patch } : r)));

    async function account() {
        setErr(""); setInfo("");
        if (!name.trim() || !email.trim()) { setErr("Please enter your name and email."); return; }
        if (pass.length < 6) { setErr("Password must be at least 6 characters."); return; }
        if (pass !== pass2) { setErr("Passwords do not match."); return; }

        setBusy(true);
        const { data, error } = await supabase.auth.signUp({
            email: email.trim(), password: pass,
            // metadata survives the e-mail confirmation (even on another device) -> we can resume at step 2
            options: { emailRedirectTo: window.location.origin, data: { full_name: name.trim(), onboarding: true } }
        });
        setBusy(false);

        if (error) { setErr(error.message); return; }
        if (data.user && data.user.identities?.length === 0) { setErr("This email is already registered - go back and log in."); return; }
        if (!data.session) { setInfo(`We sent a confirmation link to ${email.trim()}. Open it on this device - you will continue here automatically.`); return; }
        setStep(2);
    }

    async function resend() {
        const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
        setErr(error ? error.message : "");
        setInfo(error ? "" : "Confirmation email sent again.");
    }

    function business() {
        setErr("");
        if (user && !name.trim()) { setErr("Please enter your name."); return; }
        if (!orgName.trim()) { setErr("Organization name is required."); return; }
        setStep(3);
    }

    function locate() {
        setErr("");
        navigator.geolocation?.getCurrentPosition(
            p => setPos([p.coords.latitude, p.coords.longitude]),
            () => setErr("Location not available - you can set it later in Admin."),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    async function finish() {
        setErr("");
        setBusy(true);
        const settings = {
            shift_types: DEFAULT_SHIFT_TYPES, areas: DEFAULT_AREAS, role_labels: DEFAULT_ROLES,
            checkin_radius_m: 150, checkin_strict: "warn",
            ...(pos ? { workplace_lat: pos[0], workplace_lng: pos[1] } : {})
        };

        // one atomic DB call: organization + you as admin + crew (see backend/sql/006_onboarding.sql)
        const { error } = await supabase.rpc("create_organization", {
            p_name: orgName.trim(), p_slug: slugify(orgName.trim()), p_full_name: name.trim(),
            p_timezone: tz, p_settings: settings, p_crew: crew.filter(r => r.name.trim())
        });
        setBusy(false);

        if (error) { setErr(error.code === "PGRST202" ? "Missing DB function - run backend/sql/006_onboarding.sql." : error.message); return; }

        await supabase.auth.updateUser({ data: { onboarding: false } });   // best effort
        await reload();
    }

    return (
        <div className="plan-modal auth-card" id="onboardCard">
            <h3>Register Your Business</h3>
            <p className="auth-hint" style={{ margin: "-6px 0 6px" }}>Step {step} of 3</p>

            {step === 1 && (
                <div>
                    <label>Your Name</label>
                    <input type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
                    <label>Email</label>
                    <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
                    <label>Password</label>
                    <input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} />
                    <label>Repeat password</label>
                    <input type="password" autoComplete="new-password" value={pass2} onChange={e => setPass2(e.target.value)} />

                    {err && <div className="auth-error">{err}</div>}
                    {info && <div className="reset-msg ok">{info} <a href="#" onClick={e => { e.preventDefault(); void resend(); }}>Resend</a></div>}

                    <div className="auth-actions-row">
                        <a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Back to login</a>
                        <button className="primary" disabled={busy} onClick={account}>Next</button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div>
                    {user && (
                        <>
                            <label>Your Name</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} />
                        </>
                    )}
                    <label>Organization Name</label>
                    <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} />

                    <label>Timezone</label>
                    <select value={tz} onChange={e => setTz(e.target.value)}>
                        {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
                    </select>

                    <label>Workplace location (for check-in distance) - optional</label>
                    <div className="auth-pass-row">
                        <input readOnly value={pos ? `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}` : "not set"} />
                        <button type="button" className="auth-eye" style={{ width: "auto", padding: "0 12px" }} onClick={locate}>Use my location</button>
                    </div>
                    <p className="auth-hint" style={{ textAlign: "left", margin: "4px 0 0" }}>Stand at your workplace and tap the button, or set it later in Admin.</p>

                    {err && <div className="auth-error">{err}</div>}
                    <div className="auth-actions-row">
                        <a href="#" onClick={e => { e.preventDefault(); if (user) onBack(); else setStep(1); }}>Back</a>
                        <button className="primary" onClick={business}>Next</button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div>
                    <label>Team Members (optional - you can add them later in Manager → Crew)</label>
                    <div id="obCrewRows">
                        {crew.map((r, i) => (
                            <div key={i} className="plan-entry-actions" style={{ marginTop: 6 }}>
                                <select style={{ flex: "0 0 110px" }} value={r.role} onChange={e => setRow(i, { role: e.target.value })}>
                                    <option value="employee">Employee</option>
                                    <option value="manager">Manager</option>
                                </select>
                                <input type="text" placeholder="Full name" style={{ flex: 1 }} value={r.name} onChange={e => setRow(i, { name: e.target.value })} />
                                <input type="email" placeholder="Email" style={{ flex: 1 }} value={r.email} onChange={e => setRow(i, { email: e.target.value })} />
                                <button type="button" className="ob-crew-remove" onClick={() => setCrew(c => c.filter((_, j) => j !== i))}>✕</button>
                            </div>
                        ))}
                    </div>
                    <button type="button" id="obAddCrewRow" style={{ marginTop: 6 }}
                        onClick={() => setCrew(c => [...c, { role: "employee", name: "", email: "" }])}>+ Add member</button>
                    <p className="auth-hint" style={{ textAlign: "left" }}>
                        Members log in with the email you enter here: they tap “First login? Send me a login link”
                        on the login screen, or you press <b>Invite</b> on their card later. No email = no login.
                    </p>

                    {err && <div className="auth-error">{err}</div>}
                    <div className="auth-actions-row">
                        <a href="#" onClick={e => { e.preventDefault(); setStep(2); }}>Back</a>
                        <button className="primary" disabled={busy} onClick={finish}>{busy ? "Creating…" : "Finish Setup"}</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------- overlay ----------------

export function LoginOverlay() {
    const { user } = useAuth();
    // came back from the confirmation e-mail in the middle of onboarding -> resume
    const [onboarding, setOnboarding] = useState(() => !!user?.user_metadata?.onboarding);
    return (
        <div id="loginOverlay" className="plan-modal-backdrop">
            {onboarding ? <OnboardCard onBack={() => setOnboarding(false)} />
                : user ? <NoWorkplace onRegister={() => setOnboarding(true)} />
                : <LoginCard onRegister={() => setOnboarding(true)} />}
        </div>
    );
}