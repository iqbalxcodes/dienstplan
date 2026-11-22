// Session + organization/membership resolution. After login the app finds the
// user's organization(s) itself; multi-org users get a chooser (see Layout).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { bust } from "./cache";
import type { Membership, Organization } from "./types";

const REMEMBER_KEY = "dienstplan_remember";
const TAB_ALIVE_KEY = "dienstplan_tab_alive";

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

    const apply = (row: Row | null) => {
        setMe(row ? (({ organization: _o, ...m }) => m as Membership)(row) : null);
        setOrg(row?.organization ?? null);
        setChoices(null);
    };

    const reload = useCallback(async () => {

        // "Don't remember me": no tab sentinel = all windows were closed -> drop session
        if (localStorage.getItem(REMEMBER_KEY) === "0") {
            if (!sessionStorage.getItem(TAB_ALIVE_KEY)) { bust(); await supabase.auth.signOut(); }
            sessionStorage.setItem(TAB_ALIVE_KEY, "1");
        }

        const { data: { session } } = await supabase.auth.getSession();
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
        
        if (error || !mine || mine.length === 0) {
            if (error) console.error("Failed to load memberships", error);
            apply(null);
        } else if (mine.length === 1) {
            apply(mine[0] as Row);
        } else {
            apply(null);
            setChoices(mine as Row[]);
        }

        setReady(true);
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    const choose = (id: string) => apply(choices?.find(c => c.id === id) ?? null);

    const logout = async () => {
        bust();   // cache holds emails/phones: remove on logout
        try { await supabase.auth.signOut(); }
        catch (err) { console.error("signOut failed, clearing local state anyway:", err); }
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