// ======================================================
// activityLog.ts - fire-and-forget audit trail writer.
// Every state-changing action funnels through here so the
// History page has a complete record of who did what and
// when. Errors are logged, never thrown: audit logging must
// not block the main user flow.
// ======================================================

import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership } from "./auth.js";

export async function logActivity(
    action: string,
    summary: string,
    details: Record<string, unknown> = {},
    entityType?: string,
    entityId?: string
): Promise<void> {

    if(!currentOrg || !currentMembership){
        console.warn("logActivity skipped - no active session context");
        return;
    }

    const { error } = await supabaseClient.from("activity_log").insert({
        organization_id: currentOrg.id,
        actor_membership_id: currentMembership.id,
        action,
        entity_type: entityType ?? null,
        entity_id: entityId ?? null,
        summary,
        details: {
            actor_role: currentMembership.role,
            ...details
        }
    });

    if(error){
        console.error("activity_log insert failed:", error);
    }

}
