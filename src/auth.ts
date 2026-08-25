// ======================================================
// auth.ts
// Session handling + resolves which organization and which
// membership (role) the logged-in user has in that org.
// Mirrors the role-gating pattern from Hotel PMS's auth.js
// (".auth-required" buttons get disabled/locked), extended
// with per-role gating since Dienstplan has 3 roles instead
// of Hotel PMS's simple logged-in/out check.
// ======================================================

import type { Organization, Membership, MembershipRole } from "./types.js";
import { supabaseClient, resolveOrgSlugFromUrl, getStoredOrgSlug, setStoredOrgSlug } from "./supabaseClient.js";

export let currentOrg: Organization | null = null;
export let currentMembership: Membership | null = null;
const REMEMBER_KEY = "dienstplan_remember";
const TAB_ALIVE_KEY = "dienstplan_tab_alive";

export async function initAuthContext(): Promise<boolean> {
    
    if(localStorage.getItem(REMEMBER_KEY) === "0"){
        if(!sessionStorage.getItem(TAB_ALIVE_KEY)){
            await supabaseClient.auth.signOut();
        }
        sessionStorage.setItem(TAB_ALIVE_KEY, "1");
    }
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
        applyAuthVisibility();
        return false;
    }

    const { data: org, error: orgError } = await supabaseClient
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();

    if(orgError || !org){
        console.error("Organization not found for slug:", slug, orgError);
        applyAuthVisibility();
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
            window.location.reload();
        });

        return;

    }

    showLoginOverlay();

}

// ======================================================
// Centered login card (first visit / logged out)
// ======================================================

function showLoginOverlay(): void {

    if(document.getElementById("loginOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "loginOverlay";
    overlay.className = "plan-modal-backdrop";

    overlay.innerHTML = `
        <div class="plan-modal auth-card">

            <h3>Dienstplan Login</h3>

            <label>Email</label>
            <input type="email" id="authEmail" autocomplete="username">

            <label>Password</label>
            <input type="password" id="authPassword" autocomplete="current-password">

            <label class="auth-check">
                <input type="checkbox" id="authRemember" checked>
                Remember me on this device
            </label>

            <div id="authError" class="auth-error" style="display:none;"></div>

            <div class="plan-modal-footer">
                <button class="primary" id="authLoginBtn">Log in</button>
            </div>

            <p class="auth-hint">No account yet? Please ask your admin / boss.</p>
            <p class="auth-link"><a href="#" id="forgotToggle">Forgot password?</a></p>

            <div id="forgotSection" style="display:none;">
                <hr>
                <label>Email for the recovery link</label>
                <input type="email" id="forgotEmail" autocomplete="email">
                <div class="plan-modal-footer">
                    <button id="forgotResetBtn">Reset</button>
                </div>
                <p class="auth-hint" id="forgotMsg"></p>
            </div>

            <p class="auth-hint auth-org-row">
                Organization: <strong>${escapeHtml(getStoredOrgSlug() ?? "(not set)")}</strong>
                \u00b7 <a href="#" id="orgChangeToggle">change</a>
            </p>
            <div id="orgChangeSection" style="display:none;">
                <input type="text" id="orgChangeInput" placeholder="e.g. inselcafe">
                <div class="plan-modal-footer">
                    <button id="orgChangeBtn">Use</button>
                </div>
            </div>

        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("authLoginBtn")!.addEventListener("click", handleLoginSubmit);
    document.getElementById("authPassword")!.addEventListener("keydown", e => {
        if(e.key === "Enter") handleLoginSubmit();
    });

    document.getElementById("forgotToggle")!.addEventListener("click", e => {
        e.preventDefault();
        const sec = document.getElementById("forgotSection")!;
        sec.style.display = sec.style.display === "none" ? "" : "none";
    });

    document.getElementById("forgotResetBtn")!.addEventListener("click", handleForgotSubmit);

    document.getElementById("orgChangeToggle")!.addEventListener("click", e => {
        e.preventDefault();
        const sec = document.getElementById("orgChangeSection")!;
        sec.style.display = sec.style.display === "none" ? "" : "none";
    });

    document.getElementById("orgChangeBtn")!.addEventListener("click", () => {
        const val = (document.getElementById("orgChangeInput") as HTMLInputElement).value.trim().toLowerCase();
        if(!val) return;
        setStoredOrgSlug(val);
        window.location.reload();
    });

}

async function handleLoginSubmit(): Promise<void> {

    const emailEl = document.getElementById("authEmail") as HTMLInputElement;
    const passEl  = document.getElementById("authPassword") as HTMLInputElement;
    const remEl   = document.getElementById("authRemember") as HTMLInputElement;
    const errEl   = document.getElementById("authError")!;

    errEl.style.display = "none";

    if(!emailEl.value.trim() || !passEl.value){
        errEl.textContent = "Please fill in email and password.";
        errEl.style.display = "";
        return;
    }

    localStorage.setItem(REMEMBER_KEY, remEl.checked ? "1" : "0");

    const { error } = await supabaseClient.auth.signInWithPassword({
        email: emailEl.value.trim(),
        password: passEl.value
    });

    if(error){
        errEl.textContent = error.message;
        errEl.style.display = "";
        return;
    }

    window.location.reload();

}

async function handleForgotSubmit(): Promise<void> {

    const emailEl = document.getElementById("forgotEmail") as HTMLInputElement;
    const msgEl   = document.getElementById("forgotMsg")!;
    const btn     = document.getElementById("forgotResetBtn") as HTMLButtonElement;

    if(!emailEl.value.trim()) return;

    btn.disabled = true;

    const { error } = await supabaseClient.auth.resetPasswordForEmail(
        emailEl.value.trim(),
        { redirectTo: `${window.location.origin}/reset.html` }
    );

    msgEl.textContent = error
        ? error.message
        : "Recovery email sent \u2014 check your inbox (and spam folder).";

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
