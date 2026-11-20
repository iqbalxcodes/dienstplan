// Fire-and-forget audit trail. Errors are logged, never thrown.
import { useCallback } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export function useLog() {

    const { org, me } = useAuth();

    return useCallback(async (
        action: string,
        summary: string,
        details: Record<string, unknown> = {},
        entityType?: string,
        entityId?: string
    ) => {
        if (!org || !me) { console.warn("logActivity skipped - no active session context"); return; }

        const { error } = await supabase.from("activity_log").insert({
            organization_id: org.id,
            actor_membership_id: me.id,
            action,
            entity_type: entityType ?? null,
            entity_id: entityId ?? null,
            summary,
            details: { actor_role: me.role, ...details }
        });

        if (error) console.error("activity_log insert failed:", error);
    }, [org, me]);
}
