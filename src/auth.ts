// ======================================================
// auth.ts
// Session handling + automatic organization detection:
// after login the app looks up which organization(s) the
// user belongs to — no org slug in URLs, no manual input.
// Multi-org users get a one-click chooser instead.
// Also owns the centered login card ("remember me" +
// password recovery with SVG eye toggle) and role-based
// visibility gating.
// ======================================================

import type { Organization, Membership, MembershipRole } from "./types.js";
import { supabaseClient } from "./supabaseClient.js";

export let currentOrg: Organization | null = null;
export let currentMembership: Membership | null = null;

// Resolves once initAuthContext() has finished — lets other
// modules wait for auth instead of racing against it.
export let authReady: Promise<boolean> = Promise.resolve(false);

export function bootstrapAuth(): Promise<boolean> {
    authReady = initAuthContext();
    return authReady;
}

const REMEMBER_KEY = "dienstplan_remember";
const TAB_ALIVE_KEY = "dienstplan_tab_alive";

export async function initAuthContext(): Promise<boolean> {

    // "Don't remember me": if the tab-sentinel is gone, every
    // browser window was closed -> wipe the stored session.
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

    // Auto-detect: which organization(s) is this user registered in?
    const { data: mine, error: mineError } = await supabaseClient
        .from("memberships")
        .select("*, organization:organizations(*)")
        .eq("user_id", session.user.id)
        .eq("active", true);

    if(mineError || !mine || mine.length === 0){
        console.error("User is not an active member of any organization", mineError);
        currentOrg = null;
        currentMembership = null;
        applyAuthVisibility();
        return false;
    }

    let chosen = mine[0];

    // Belongs to more than one organization -> let them pick
    if(mine.length > 1){
        const pickedId = await promptOrgChoice(
            mine.map((m: any) => ({
                id: m.id,
                label: m.organization?.name ?? m.full_name ?? "Organization"
            }))
        );

        if(!pickedId){
            // closed without choosing -> treat as logged out
            currentOrg = null;
            currentMembership = null;
            applyAuthVisibility();
            return false;
        }

        const found = mine.find((m: any) => m.id === pickedId);
        if(!found){
            currentOrg = null;
            currentMembership = null;
            applyAuthVisibility();
            return false;
        }

        chosen = found;
    }

    currentMembership = chosen as Membership;
    currentOrg = (chosen as any).organization as Organization;

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

export async function logout(): Promise<void> {

    await supabaseClient.auth.signOut();
    currentOrg = null;
    currentMembership = null;
    applyAuthVisibility();

}


// ======================================================
// Inline SVG eye icons (Feather-style, stroke=currentColor)
// ======================================================

const EYE_OPEN_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_OFF_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;


// ======================================================
// Status bar user area — identity + logout when logged in;
// falls back to the centered login card when not.
// ======================================================

export function renderUserArea(): void {

    const area = document.getElementById("userArea");
    const overlay = document.getElementById("loginOverlay");

    if(!area) return;

    if(currentMembership){

        overlay?.remove();          // logged in -> drop the login card

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

    area.innerHTML = `<span class="plan-entry-meta">Not signed in</span>`;
    wireLoginOverlay();

}


// ======================================================
// Wire the STATIC login card from HTML (no injection ->
// no flash of visible app behind)
// ======================================================

function wireLoginOverlay(): void {

    const overlay = document.getElementById("loginOverlay");
    if(!overlay || overlay.dataset.wired === "1") return;
    overlay.dataset.wired = "1";

    document.getElementById("authLoginBtn")!.addEventListener("click", handleLoginSubmit);

    document.getElementById("authPassword")!.addEventListener("keydown", e => {
        if(e.key === "Enter") handleLoginSubmit();
    });

    // eye toggle: show / hide password (icon reflects resulting state)
    const passInput = document.getElementById("authPassword") as HTMLInputElement;
    const eyeBtn    = document.getElementById("authEyeBtn") as HTMLButtonElement;

    const syncEye = () => {
        const hidden = passInput.type === "password";
        eyeBtn.innerHTML   = hidden ? EYE_OPEN_SVG : EYE_OFF_SVG;
        eyeBtn.title       = hidden ? "Show password" : "Hide password";
        eyeBtn.setAttribute("aria-label", eyeBtn.title);
    };

    syncEye();   // draw the initial icon

    eyeBtn.addEventListener("click", () => {
        passInput.type = passInput.type === "password" ? "text" : "password";
        syncEye();
    });

    document.getElementById("forgotToggle")!.addEventListener("click", e => {
        e.preventDefault();
        const sec = document.getElementById("forgotSection")!;
        sec.style.display = sec.style.display === "none" ? "" : "none";
    });

    document.getElementById("forgotResetBtn")!.addEventListener("click", handleForgotSubmit);

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


// ======================================================
// Multi-org users pick where to log in to
// ======================================================

function promptOrgChoice(options: { id: string; label: string }[]): Promise<string | null> {
    return new Promise(resolve => {

        const overlay = document.createElement("div");
        overlay.className = "plan-modal-backdrop";

        overlay.innerHTML = `
            <div class="plan-modal auth-card">
                <h3>Choose your workplace</h3>
                <p class="auth-hint">You belong to more than one organization.</p>
                ${options.map(o => `
                    <div class="plan-entry-actions" style="margin-top:10px;">
                        <button style="width:100%;" data-mid="${o.id}">${escapeHtml(o.label)}</button>
                    </div>
                `).join("")}
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelectorAll<HTMLButtonElement>("button[data-mid]").forEach(btn => {
            btn.addEventListener("click", () => {
                overlay.remove();
                resolve(btn.dataset.mid ?? null);
            });
        });

    });
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