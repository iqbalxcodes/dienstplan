// Session + organization/membership resolution. After login the app finds the
// user's organization(s) itself; multi-org users get a chooser (see Layout).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { bust } from "./cache";
import type { Membership, Organization } from "./types";

const REMEMBER_KEY = "dienstplan_remember";
const TAB_ALIVE_KEY = "dienstplan_tab_alive";
const ORG_KEY = "dienstplan_org";

type Row = Membership & { organization: Organization };

interface Ctx {
    ready: boolean;
    user: User | null;               // signed in (may still lack a membership: onboarding)
    org: Organization | null;
    me: Membership | null;
    choices: Row[] | null;           // set when user belongs to >1 org and must pick
    isManager: boolean;              // manager OR admin
    isAdmin: boolean;
    reload: () => Promise<void>;
    choose: (membershipId: string) => void;
    logout: () => Promise<void>;
    patchOrg: (patch: Partial<Organization>) => void;
}

const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {

    const [ready, setReady] = useState(false);
    const [user, setUser] = useState<User | null>(null);
    const [org, setOrg] = useState<Organization | null>(null);
    const [me, setMe] = useState<Membership | null>(null);
    const [choices, setChoices] = useState<Row[] | null>(null);
    const uid = useRef<string | null>(null);                      // signed-in user id (to ignore duplicate SIGNED_IN events)
    const running = useRef<Promise<void> | null>(null);          // parallel reload() calls share one run

    const apply = (row: Row | null) => {
        setMe(row ? (({ organization: _o, ...m }) => m as Membership)(row) : null);
        setOrg(row?.organization ?? null);
        setChoices(null);
    };

    const run = useCallback(async () => {

        // "Don't remember me": a brand-new browser session (no tab sentinel) drops the stored login.
        // The sentinel is set BEFORE awaiting and on every load, so logging in later in this tab never signs you out.
        // scope "local": only this device, never the user's other sessions.
        if (localStorage.getItem(REMEMBER_KEY) === "0" && !sessionStorage.getItem(TAB_ALIVE_KEY)) {
            sessionStorage.setItem(TAB_ALIVE_KEY, "1");
            bust();
            await supabase.auth.signOut({ scope: "local" });
        }
        sessionStorage.setItem(TAB_ALIVE_KEY, "1");

        const { data: { session } } = await supabase.auth.getSession();
        uid.current = session?.user.id ?? null;
        setUser(session?.user ?? null);

        if (!session) { apply(null); setReady(true); return; }

        const find = () => supabase
            .from("memberships")
            .select("*, organization:organizations(*)")
            .eq("user_id", session.user.id)
            .eq("active", true);

        let { data: mine, error } = await find();

        // invited by e-mail: link the crew row(s) that carry this (confirmed) e-mail, then look again
        if (!error && mine?.length === 0) {
            const { data: linked } = await supabase.rpc("claim_membership");
            if (linked) ({ data: mine, error } = await find());
        }

        // network error (offline): keep what we already show, do NOT fall back to "no workplace"
        if (error) { console.error("Failed to load memberships", error); setReady(true); return; }

        const rows = (mine ?? []) as Row[];
        const saved = localStorage.getItem(ORG_KEY);
        const pick = rows.length === 1 ? rows[0] : rows.find(r => r.id === saved);

        if (pick) apply(pick);
        else { apply(null); if (rows.length) setChoices(rows); }

        setReady(true);
    }, []);

    const reload = useCallback(
        () => (running.current ??= run().finally(() => { running.current = null; })),
        [run]
    );

    useEffect(() => { void reload(); }, [reload]);

    // sign-out in another tab, expired session, login link opened in this tab
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((ev, session) => {
            if (ev === "SIGNED_OUT") { uid.current = null; bust(); setUser(null); apply(null); }
            else if (ev === "SIGNED_IN" && session && session.user.id !== uid.current) setTimeout(() => void reload(), 0);   // never await supabase inside this callback
        });
        return () => subscription.unsubscribe();
    }, [reload]);

    const choose = (id: string) => {
        localStorage.setItem(ORG_KEY, id);
        apply(choices?.find(c => c.id === id) ?? null);
    };

    const logout = async () => {
        bust();   // cache holds emails/phones: remove on logout
        try { await supabase.auth.signOut({ scope: "local" }); }
        catch (err) { console.error("signOut failed, clearing local state anyway:", err); }
        uid.current = null;
        setUser(null);
        apply(null);
    };

    const patchOrg = (patch: Partial<Organization>) => setOrg(o => (o ? { ...o, ...patch } : o));

    const value = useMemo<Ctx>(() => ({
        ready, user, org, me, choices,
        isManager: me?.role === "manager" || me?.role === "admin",
        isAdmin: me?.role === "admin",
        reload, choose, logout, patchOrg
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [ready, user, org, me, choices, reload]);

    return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}