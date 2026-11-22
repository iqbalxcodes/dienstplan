// Persistent cache (localStorage) with stale-while-revalidate:
// stored data is shown instantly, then refreshed from the DB in the background.
// Survives reloads and days; removed only by the user (clear site data), bust(), or logout.
import { supabase } from "./supabase";
import type { Membership } from "./types";

const PREFIX = "dp_cache:";
const mem = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function read<T>(key: string): T | undefined {
    if (mem.has(key)) return mem.get(key) as T;
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return undefined;
        const v = JSON.parse(raw) as T;
        mem.set(key, v);
        return v;
    } catch { return undefined; }
}

function write(key: string, v: unknown) {
    mem.set(key, v);
    try { localStorage.setItem(PREFIX + key, JSON.stringify(v)); } catch { /* quota full: memory only */ }
}

/**
 * Stored value is returned/emitted immediately; a fresh fetch always runs and calls onData again
 * when the result differs. No stored value: waits for the fetch. Parallel calls share one request.
 */
export async function swr<T>(key: string, fn: () => PromiseLike<T>, onData?: (v: T) => void): Promise<T> {
    const old = read<T>(key);

    let fresh = inflight.get(key) as Promise<T> | undefined;
    if (!fresh) {
        fresh = Promise.resolve(fn()).then(v => { write(key, v); return v; }).finally(() => inflight.delete(key));
        inflight.set(key, fresh);
    }

    if (old !== undefined) {
        onData?.(old);
        fresh.then(v => { if (JSON.stringify(v) !== JSON.stringify(old)) onData?.(v); })
            .catch(e => console.error("cache refresh failed (showing stored data):", e));
        return old;
    }

    const v = await fresh;
    onData?.(v);
    return v;
}

/** Remove entries whose key starts with prefix (no prefix = everything). */
export function bust(prefix = "") {
    for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
    try {
        for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX + prefix)) localStorage.removeItem(k);
    } catch { /* ignore */ }
}

/** Org members. Shared object: treat as read-only. */
export const getMembers = (orgId: string, activeOnly = false, onData?: (v: Membership[]) => void) =>
    swr<Membership[]>(`members:${orgId}:${activeOnly}`, async () => {
        let q = supabase.from("memberships").select("*").eq("organization_id", orgId);
        if (activeOnly) q = q.eq("active", true);
        const { data, error } = await q.order("full_name");
        if (error) throw error;
        return (data ?? []) as Membership[];
    }, onData);