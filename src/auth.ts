// ======================================================
// auth.ts
// Session handling + resolves which organization and which
// membership (role) the logged-in user has in that org.
// Mirrors the role-gating pattern from Hotel PMS's auth.js
// (".auth-required" buttons get disabled/locked), extended
// with per-role gating since Dienstplan has 3 roles instead
// of Hotel PMS's simple logged-in/out check.
// ======================================================

import { supabaseClient, resolveOrgSlugFromUrl } from "./supabaseClient.js";
import type { Organization, Membership, MembershipRole } from "./types.js";

export let currentOrg: Organization | null = null;
export let currentMembership: Membership | null = null;

export async function initAuthContext(): Promise<boolean> {

    const { data: { session } } = await supabaseClient.auth.getSession();

    if(!session){
        currentOrg = null;
        currentMembership = null;
        applyAuthVisibility();
        return false;
    }

    const slug = resolveOrgSlugFromUrl();

    if(!slug){
        console.error("No organization slug in URL (expected ?org=slug)");
        return false;
    }

    const { data: org, error: orgError } = await supabaseClient
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();

    if(orgError || !org){
        console.error("Organization not found for slug:", slug, orgError);
        return false;
    }

    currentOrg = org as Organization;

    const { data: membership, error: memberError } = await supabaseClient
        .from("memberships")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("user_id", session.user.id)
        .eq("active", true)
        .single();

    if(memberError || !membership){
        console.error("User is not an active member of this organization");
        currentMembership = null;
        applyAuthVisibility();
        return false;
    }

    currentMembership = membership as Membership;

    applyAuthVisibility();
    return true;

}

export function isLoggedIn(): boolean {
    return currentMembership !== null;
}

export function isManager(): boolean {
    return currentMembership?.role === "owner" || currentMembership?.role === "manager";
}

export function hasRole(...roles: MembershipRole[]): boolean {
    return currentMembership !== null && roles.includes(currentMembership.role);
}

export async function login(email: string, password: string): Promise<string | null> {

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if(error) return error.message;

    await initAuthContext();
    return null;

}

export async function logout(): Promise<void> {

    await supabaseClient.auth.signOut();
    currentOrg = null;
    currentMembership = null;
    applyAuthVisibility();

}

// ======================================================
// Visibility gating — same idea as Hotel PMS: elements with
// class "auth-required" need ANY logged-in membership.
// Elements with "manager-required" need owner/manager role
// specifically (e.g. the "approve" buttons, manual time edit).
// ======================================================

export function renderUserArea(): void {

    const area = document.getElementById("userArea");
    if(!area) return;

    if(currentMembership){

        area.innerHTML = `
            <span>${escapeHtml(currentMembership.full_name)} \u00b7 ${escapeHtml(currentMembership.role)}</span>
            <button id="logoutBtn" style="margin-left:8px;">Logout</button>
        `;

        document.getElementById("logoutBtn")!.addEventListener("click", async () => {
            await logout();
            renderUserArea();
            window.location.reload();
        });

    } else {

        area.innerHTML = `
            <span class="login-form">
                <input type="email" id="loginEmail" placeholder="Email">
                <input type="password" id="loginPassword" placeholder="Password">
                <button id="loginBtn">Login</button>
            </span>
        `;

        document.getElementById("loginBtn")!.addEventListener("click", async () => {

            const email = (document.getElementById("loginEmail") as HTMLInputElement).value;
            const password = (document.getElementById("loginPassword") as HTMLInputElement).value;

            const error = await login(email, password);

            if(error){
                alert(error);
                return;
            }

            renderUserArea();
            window.location.reload();

        });

    }

}

function escapeHtml(str: string | null | undefined): string {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

export function applyAuthVisibility(): void {

    const loggedIn = isLoggedIn();
    const manager = isManager();

    document.querySelectorAll<HTMLElement>(".auth-required").forEach(el => {

        el.classList.toggle("auth-locked", !loggedIn);

    });

    document.querySelectorAll<HTMLElement>(".manager-required").forEach(el => {

        el.classList.toggle("auth-locked", !manager);

    });

    document.querySelectorAll<HTMLElement>(".employee-only").forEach(el => {

        el.style.display = (loggedIn && !manager) ? "" : "none";

    });

}
