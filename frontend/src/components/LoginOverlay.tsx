// Login card, password recovery and business onboarding (register org + admin).
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useSettings } from "../lib/i18n";

const REMEMBER_KEY = "dienstplan_remember";
const ONBOARD_PENDING_KEY = "dienstplan_onboard_pending_name";

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

function LoginCard({ onRegister }: { onRegister: () => void }) {

    const { reload } = useAuth();
    const { t } = useSettings();
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const [show, setShow] = useState(false);
    const [remember, setRemember] = useState(true);
    const [err, setErr] = useState("");
    const [forgot, setForgot] = useState(false);
    const [fEmail, setFEmail] = useState("");
    const [fMsg, setFMsg] = useState("");
    const [fBusy, setFBusy] = useState(false);

    async function login() {
        setErr("");
        if (!email.trim() || !pass) { setErr("Please fill in email and password."); return; }
        localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
        if (error) { setErr(error.message); return; }
        await reload();
    }

    async function sendReset() {
        if (!fEmail.trim()) return;
        setFBusy(true);
        const { error } = await supabase.auth.resetPasswordForEmail(fEmail.trim(), { redirectTo: `${window.location.origin}/reset` });
        setFMsg(error ? error.message : "Recovery email sent \u2014 check your inbox (and spam folder).");
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

            <p className="auth-hint">
                <span>{t("login.noAccount")}</span>{" "}
                <a href="#" onClick={e => { e.preventDefault(); onRegister(); }}>{t("login.registerBusiness")}</a> ·{" "}
                <a href="#" onClick={e => { e.preventDefault(); setForgot(!forgot); }}>{t("login.forgot")}</a>
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

interface CrewRow { role: string; name: string; email: string; }

function OnboardCard({ onBack }: { onBack: () => void }) {

    const { user, reload } = useAuth();
    // signed in (email confirmed) but no membership yet -> resume at step 2
    const pendingName = localStorage.getItem(ONBOARD_PENDING_KEY);
    const [step, setStep] = useState<1 | 2>(user && pendingName ? 2 : 1);
    const [name, setName] = useState(pendingName ?? "");
    const [email, setEmail] = useState("");
    const [pass, setPass] = useState("");
    const [orgName, setOrgName] = useState("");
    const [crew, setCrew] = useState<CrewRow[]>([{ role: "employee", name: "", email: "" }]);
    const [err, setErr] = useState("");

    const setRow = (i: number, patch: Partial<CrewRow>) => setCrew(c => c.map((r, j) => (j === i ? { ...r, ...patch } : r)));

    async function next() {
        setErr("");
        if (!name.trim() || !email.trim() || pass.length < 6) { setErr("Please fill in all fields (password min. 6 characters)."); return; }

        const { data, error } = await supabase.auth.signUp({
            email: email.trim(), password: pass, options: { emailRedirectTo: window.location.origin }
        });
        if (error) { setErr(error.message); return; }

        if (!data.session) {
            localStorage.setItem(ONBOARD_PENDING_KEY, name.trim());
            setErr("Account created — check your email to confirm it. You'll come back here automatically.");
            return;
        }
        setStep(2);
    }

    async function finish() {
        setErr("");
        if (!orgName.trim()) { setErr("Organization name is required."); return; }

        const { data: { user: u } } = await supabase.auth.getUser();
        if (!u) { setErr("Session expired — please log in again."); return; }

        const { data: org, error: orgErr } = await supabase
            .from("organizations").insert({ name: orgName.trim(), slug: slugify(orgName.trim()) }).select().single();
        if (orgErr || !org) { setErr(orgErr?.message ?? "Failed to create organization."); return; }

        const { error: memErr } = await supabase.from("memberships").insert({
            organization_id: org.id, user_id: u.id, role: "admin", full_name: name.trim(), email: u.email
        });
        if (memErr) { setErr(memErr.message); return; }

        // extra crew: no login yet (user_id null) — they get a recovery link later.
        // Creating other people's auth accounts needs a service key the client never has.
        for (const r of crew.filter(r => r.name.trim())) {
            await supabase.from("memberships").insert({
                organization_id: org.id, user_id: null, role: r.role, full_name: r.name.trim(),
                email: r.email.trim() || null, weekly_target_hours: 40
            });
        }

        localStorage.removeItem(ONBOARD_PENDING_KEY);
        await reload();
    }

    return (
        <div className="plan-modal auth-card" id="onboardCard">
            <h3>Register Your Business</h3>

            {step === 1 ? (
                <div>
                    <label>Your Name</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)} />
                    <label>Email</label>
                    <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
                    <label>Password</label>
                    <input type="password" autoComplete="new-password" value={pass} onChange={e => setPass(e.target.value)} />
                    {err && <div className="auth-error">{err}</div>}
                    <div className="auth-actions-row">
                        <a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Back to login</a>
                        <button className="primary" onClick={next}>Next</button>
                    </div>
                </div>
            ) : (
                <div>
                    <label>Organization Name</label>
                    <input type="text" value={orgName} onChange={e => setOrgName(e.target.value)} />
                    <p className="auth-hint" style={{ textAlign: "left", margin: "4px 0 0" }}>Location can be set later in Admin settings.</p>

                    <hr />
                    <label>Team Members (optional — you can add these later too)</label>
                    <div id="obCrewRows">
                        {crew.map((r, i) => (
                            <div key={i} className="plan-entry-actions" style={{ marginTop: 6 }}>
                                <select style={{ flex: "0 0 110px" }} value={r.role} onChange={e => setRow(i, { role: e.target.value })}>
                                    <option value="employee">Employee</option>
                                    <option value="manager">Manager</option>
                                </select>
                                <input type="text" placeholder="Full name" style={{ flex: 1 }} value={r.name} onChange={e => setRow(i, { name: e.target.value })} />
                                <input type="email" placeholder="Email (optional)" style={{ flex: 1 }} value={r.email} onChange={e => setRow(i, { email: e.target.value })} />
                                <button type="button" className="ob-crew-remove" onClick={() => setCrew(c => c.filter((_, j) => j !== i))}>✕</button>
                            </div>
                        ))}
                    </div>
                    <button type="button" id="obAddCrewRow" style={{ marginTop: 6 }}
                        onClick={() => setCrew(c => [...c, { role: "employee", name: "", email: "" }])}>+ Add member</button>
                    <p className="auth-hint" style={{ textAlign: "left" }}>
                        Only email is needed here — each member gets a "reset password" link once they're ready to log in themselves.
                    </p>

                    {err && <div className="auth-error">{err}</div>}
                    <div className="auth-actions-row">
                        <a href="#" onClick={e => { e.preventDefault(); setStep(1); }}>Back</a>
                        <button className="primary" onClick={finish}>Finish Setup</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function LoginOverlay() {
    const { user } = useAuth();
    const [onboarding, setOnboarding] = useState(() => !!(user && localStorage.getItem(ONBOARD_PENDING_KEY)));
    return (
        <div id="loginOverlay" className="plan-modal-backdrop">
            {onboarding ? <OnboardCard onBack={() => setOnboarding(false)} /> : <LoginCard onRegister={() => setOnboarding(true)} />}
        </div>
    );
}
