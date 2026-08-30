// ======================================================
// auth.ts
// Session handling + automatic organization detection:
// after login the app looks up which organization(s) the
// user belongs to — no org slug in URLs, no manual input.
// Multi-org users get a one-click chooser instead.
// Also owns the centered login card ("remember me" +
// password recovery with SVG eye toggle) and role-based
// visibility gating.
// Roles: employee < manager < admin (technical/IT)
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
const ONBOARD_PENDING_KEY = "dienstplan_onboard_pending_name";


// ======================================================
// Role helpers
// ======================================================

// business level: manager OR admin (admin inherits everything)
export function isManager(): boolean {
    return currentMembership?.role === "manager" || currentMembership?.role === "admin";
}

// technical level: admin only
export function isAdmin(): boolean {
    return currentMembership?.role === "admin";
}


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

export function hasRole(...roles: MembershipRole[]): boolean {
    return currentMembership !== null && roles.includes(currentMembership.role);
}

export async function logout(): Promise<void> {

    try {
        await supabaseClient.auth.signOut();
    } catch (err) {
        console.error("signOut failed, clearing local state anyway:", err);
    } finally {
        currentOrg = null;
        currentMembership = null;
        applyAuthVisibility();
    }

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

export async function renderUserArea(): Promise<void> {

    await injectAuthOverlay();

    const area = document.getElementById("userArea");
    const overlay = document.getElementById("loginOverlay");

    if(!area) return;

    if(currentMembership){

        if(overlay) overlay.style.display = "none";

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

    // Sudah login (email confirmed) tapi belum punya membership -> lagi
    // di tengah proses onboarding. Lanjutin ke step 2, jangan tampilin
    // login form biasa.
    const pendingName = localStorage.getItem(ONBOARD_PENDING_KEY);
    const { data: { session } } = await supabaseClient.auth.getSession();

    if(session && pendingName){

        area.innerHTML = `<span class="plan-entry-meta">Finishing setup\u2026</span>`;

        if(overlay) overlay.style.display = "";

        wireLoginOverlay();

        document.querySelector(".auth-card")!.setAttribute("style", "display:none;");

        const onboardCard = document.getElementById("onboardCard")!;
        onboardCard.style.display = "";

        (document.getElementById("obYourName") as HTMLInputElement).value = pendingName;
        document.getElementById("obStep1")!.style.display = "none";
        document.getElementById("obStep2")!.style.display = "";

        return;

    }

    // Not logged in: show overlay + status text
    area.innerHTML = `<span class="plan-entry-meta">Not signed in</span>`;

    if(overlay){
        overlay.style.display = "";
        wireLoginOverlay();
    }

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

    wireOnboarding();

}

async function injectAuthOverlay(): Promise<void> {

    const slot = document.getElementById("authOverlaySlot");
    if(!slot || slot.dataset.injected === "1") return;
    slot.dataset.injected = "1";

    try {
        const html = await fetch("auth-overlay.html").then(r => r.text());
        slot.outerHTML = html;

        const { loadSettings, applyLanguage } = await import("./settings.js");
        applyLanguage(loadSettings().language);

    } catch(err) {
        console.error("Failed to load auth overlay:", err);
    }

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

// ======================================================
// ONBOARDING — register new business + owner account.
// Additional members are created WITHOUT a login (user_id
// null, email only) same pattern as addCrewMember() in
// panels.ts — they get a proper account later via "Resend
// Recovery". We deliberately do NOT collect a password for
// them here: creating other people's auth accounts requires
// an admin/service key, which the client never has access to.
// ======================================================

function slugify(name: string): string {
    return name.toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        + "-" + Math.random().toString(36).slice(2, 6);
}

function wireOnboarding(): void {

    const overlay = document.getElementById("onboardCard");
    if(!overlay || overlay.dataset.wired === "1") return;
    overlay.dataset.wired = "1";

    document.getElementById("ownerToggle")!.addEventListener("click", e => {
        e.preventDefault();
        document.querySelector(".auth-card:not(#onboardCard)")!.parentElement!.querySelectorAll(".auth-card").forEach(c => (c as HTMLElement).style.display = "none");
        overlay.style.display = "";
    });

    document.getElementById("obBackToLogin")!.addEventListener("click", e => {
        e.preventDefault();
        overlay.style.display = "none";
        document.querySelector(".auth-card:not(#onboardCard)")!.setAttribute("style", "");
    });

    document.getElementById("obBackToStep1")!.addEventListener("click", e => {
        e.preventDefault();
        document.getElementById("obStep2")!.style.display = "none";
        document.getElementById("obStep1")!.style.display = "";
    });

    document.getElementById("obAddCrewRow")!.addEventListener("click", addCrewRow);
    addCrewRow(); // start with one row

    document.getElementById("obStep1Next")!.addEventListener("click", handleObStep1);
    document.getElementById("obFinishBtn")!.addEventListener("click", handleObFinish);

}

function addCrewRow(): void {

    const wrap = document.getElementById("obCrewRows")!;
    const row = document.createElement("div");
    row.className = "plan-entry-actions";
    row.style.marginTop = "6px";
    row.innerHTML = `
        <select class="ob-crew-role" style="flex:0 0 110px;">
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
        </select>
        <input type="text" class="ob-crew-name" placeholder="Full name" style="flex:1;">
        <input type="email" class="ob-crew-email" placeholder="Email (optional)" style="flex:1;">
        <button type="button" class="ob-crew-remove">✕</button>
    `;

    row.querySelector(".ob-crew-remove")!.addEventListener("click", () => row.remove());
    wrap.appendChild(row);

}

async function handleObStep1(): Promise<void> {

    const nameEl = document.getElementById("obYourName") as HTMLInputElement;
    const emailEl = document.getElementById("obEmail") as HTMLInputElement;
    const passEl = document.getElementById("obPassword") as HTMLInputElement;
    const errEl = document.getElementById("obStep1Error")!;

    errEl.style.display = "none";

    if(!nameEl.value.trim() || !emailEl.value.trim() || passEl.value.length < 6){
        errEl.textContent = "Please fill in all fields (password min. 6 characters).";
        errEl.style.display = "";
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
        email: emailEl.value.trim(),
        password: passEl.value,
        options: { emailRedirectTo: window.location.href }
    });

    if(error){
        errEl.textContent = error.message;
        errEl.style.display = "";
        return;
    }

    if(!data.session){
        localStorage.setItem(ONBOARD_PENDING_KEY, nameEl.value.trim());
        errEl.textContent = "Account created — check your email to confirm it. You'll come back here automatically.";
        errEl.style.display = "";
        return;
    }

    document.getElementById("obStep1")!.style.display = "none";
    document.getElementById("obStep2")!.style.display = "";

}

async function handleObFinish(): Promise<void> {

    const orgNameEl = document.getElementById("obOrgName") as HTMLInputElement;
    const yourNameEl = document.getElementById("obYourName") as HTMLInputElement;
    const errEl = document.getElementById("obStep2Error")!;

    errEl.style.display = "none";

    if(!orgNameEl.value.trim()){
        errEl.textContent = "Organization name is required.";
        errEl.style.display = "";
        return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if(!user){
        errEl.textContent = "Session expired — please log in again.";
        errEl.style.display = "";
        return;
    }

    const { data: org, error: orgError } = await supabaseClient
        .from("organizations")
        .insert({ name: orgNameEl.value.trim(), slug: slugify(orgNameEl.value.trim()) })
        .select()
        .single();

    if(orgError || !org){
        errEl.textContent = orgError?.message ?? "Failed to create organization.";
        errEl.style.display = "";
        return;
    }

    const { error: memError } = await supabaseClient
        .from("memberships")
        .insert({
            organization_id: org.id,
            user_id: user.id,
            role: "admin",
            full_name: yourNameEl.value.trim(),
            email: user.email
        });

    if(memError){
        errEl.textContent = memError.message;
        errEl.style.display = "";
        return;
    }

    // optional extra crew rows — best-effort, skip empty names
    const rows = document.querySelectorAll("#obCrewRows > div");
    for(const row of Array.from(rows)){
        const name = (row.querySelector(".ob-crew-name") as HTMLInputElement).value.trim();
        if(!name) continue;

        await supabaseClient.from("memberships").insert({
            organization_id: org.id,
            user_id: null,
            role: (row.querySelector(".ob-crew-role") as HTMLSelectElement).value,
            full_name: name,
            email: (row.querySelector(".ob-crew-email") as HTMLInputElement).value.trim() || null,
            weekly_target_hours: 40
        });
    }

    window.location.reload();

}