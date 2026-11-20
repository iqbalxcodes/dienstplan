import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function ResetPassword() {

    const nav = useNavigate();
    const hasToken = window.location.hash.includes("access_token") || window.location.search.includes("code=");
    const [state, setState] = useState<"loading" | "invalid" | "form" | "done">(hasToken ? "loading" : "invalid");
    const [p1, setP1] = useState("");
    const [p2, setP2] = useState("");
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);

    // supabase-js (detectSessionInUrl) exchanges the link token for a session itself
    useEffect(() => {
        if (!hasToken) return;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((ev, session) => {
            if (ev === "PASSWORD_RECOVERY" || (ev === "SIGNED_IN" && session)) setState("form");
        });
        supabase.auth.getSession().then(({ data }) => { if (data.session) setState("form"); });
        const timeout = setTimeout(() => setState(s => (s === "loading" ? "invalid" : s)), 8000);
        return () => { subscription.unsubscribe(); clearTimeout(timeout); };
    }, [hasToken]);

    async function submit(e: FormEvent) {
        e.preventDefault();
        setErr("");
        if (p1.length < 6) { setErr("Password must be at least 6 characters."); return; }
        if (p1 !== p2) { setErr("Passwords do not match."); return; }

        setBusy(true);
        const { error } = await supabase.auth.updateUser({ password: p1 });
        if (error) { setErr(error.message); setBusy(false); return; }

        setState("done");
        setTimeout(() => nav("/", { replace: true }), 2000);
    }

    return (
        <div className="reset-wrap">
            <div className="plan-modal auth-card reset-card">
                <h3>{state === "form" ? "Set New Password" : state === "done" ? "Done!" : "Reset Password"}</h3>

                {state === "loading" && <div className="reset-loading">Verifying your link…</div>}
                {state === "invalid" && <div className="reset-loading">Link expired or invalid. Please request a new recovery email.</div>}

                {state === "form" && (
                    <form onSubmit={submit}>
                        <label htmlFor="newPassword">New password</label>
                        <input id="newPassword" type="password" placeholder="At least 6 characters" autoComplete="new-password"
                            value={p1} onChange={e => setP1(e.target.value)} />
                        <label htmlFor="confirmPassword">Confirm password</label>
                        <input id="confirmPassword" type="password" placeholder="Repeat your new password" autoComplete="new-password"
                            value={p2} onChange={e => setP2(e.target.value)} />
                        <button type="submit" disabled={busy}>{busy ? "Updating…" : "Update Password"}</button>
                        {err && <div className="reset-msg err">{err}</div>}
                    </form>
                )}

                {state === "done" && <div className="reset-msg ok">Password updated. Redirecting to login…</div>}
            </div>
        </div>
    );
}
