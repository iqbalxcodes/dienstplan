// ======================================================
// supabaseClient.ts
// Connects to the DIENSTPLAN Supabase project — this is a
// separate project from Hotel PMS's Supabase, on purpose:
// staff scheduling data (wages, complaints, evidence files)
// shouldn't live in the same project as guest/reservation data.
//
// When embedding this module INSIDE Hotel PMS later, just
// import this client alongside the existing hotel-pms one —
// two `createClient()` instances can happily coexist in the
// same page.
// ======================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// TODO: replace with your Dienstplan project's values
// (Project Settings -> API in the Supabase dashboard).
// These are safe to expose client-side; RLS does the real work.
const DIENSTPLAN_SUPABASE_URL = "https://rutuoolvofndmjjboosv.supabase.co";
const DIENSTPLAN_SUPABASE_ANON_KEY = "sb_publishable_KWUNWEx-b9kM6qIxxlbgDA_DvTqjjcZ";

export const supabaseClient: SupabaseClient = createClient(
    DIENSTPLAN_SUPABASE_URL,
    DIENSTPLAN_SUPABASE_ANON_KEY
);

// ======================================================
// Tenant resolution
// Multi-tenant via a `?org=slug` query param (works for a
// single static deployment shared by many organizations) OR
// a subdomain (resto1.dienstplan.app) if you set up DNS/hosting
// for that later. Query param is the zero-config option, so
// it's the default here.
// ======================================================
// ======================================================
// Tenant resolution — org dipilih SEKALI (?org= atau lewat
// picker), lalu diingat di localStorage sehingga URL tetap
// bersih di kunjungan berikutnya.
// ======================================================

const ORG_STORAGE_KEY = "dienstplan_org_slug";

export function getStoredOrgSlug(): string | null {
    return localStorage.getItem(ORG_STORAGE_KEY);
}

export function setStoredOrgSlug(slug: string): void {
    localStorage.setItem(ORG_STORAGE_KEY, slug);
}

export function forgetOrgSlug(): void {
    localStorage.removeItem(ORG_STORAGE_KEY);
}

export function resolveOrgSlugFromUrl(): string | null {

    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("org");

    if(fromQuery){
        setStoredOrgSlug(fromQuery);

        // bersihkan ?org= dari address bar biar URL cantik
        try {
            params.delete("org");
            const qs = params.toString();
            window.history.replaceState(
                {}, "",
                window.location.pathname + (qs ? "?" + qs : "") + window.location.hash
            );
        } catch { /* ignore (mis. file://) */ }

        return fromQuery;
    }

    return getStoredOrgSlug();

}