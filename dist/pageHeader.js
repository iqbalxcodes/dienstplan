// ======================================================
// pageHeader.ts
// Shared page-level header bar: greeting (left) + gear icon
// + live clock (right). ONE implementation used by every
// page — do not re-implement this locally elsewhere.
//
// The HTML only needs:
//   <div id="pageHeaderBar" class="page-header-bar"></div>
// This module builds the entire inner content (greeting
// span, gear link, clock spans) via JS — so changing the
// structure later only requires editing this one file,
// never touching per-page HTML again.
//
// Calling initPageHeader() more than once is safe: it
// always rebuilds the inner HTML fully and clears any
// previous timer first.
// ======================================================
import { currentOrg, currentMembership } from "./auth.js";
let clockIntervalHandle;
let greetingTimerHandle;
export function initPageHeader() {
    const bar = document.getElementById("pageHeaderBar");
    if (!bar)
        return;
    bar.innerHTML = `
        <span id="pageGreeting" class="page-greeting">Loading…</span>
        <div class="page-header-right">
            <a href="settings.html" class="page-gear-btn" title="Settings" aria-label="Settings">&#9881;</a>
            <div class="page-header-clock">
                <span id="pageClockDate"></span><span id="pageClockTime"></span>
            </div>
        </div>
    `;
    renderGreeting();
    startPageClock();
}
function renderGreeting() {
    const el = document.getElementById("pageGreeting");
    if (!el)
        return;
    window.clearTimeout(greetingTimerHandle);
    const orgName = currentOrg?.name ?? "Dienstplan";
    if (!currentMembership) {
        el.textContent = orgName;
        return;
    }
    const hour = new Date().getHours();
    let greeting;
    if (hour < 12)
        greeting = "Good Morning";
    else if (hour < 18)
        greeting = "Good Afternoon";
    else
        greeting = "Good Evening";
    const firstName = currentMembership.full_name.split(" ")[0];
    el.textContent = `${greeting}, ${firstName}!`;
    greetingTimerHandle = window.setTimeout(() => {
        el.textContent = orgName;
    }, 3000);
}
function startPageClock() {
    const dateEl = document.getElementById("pageClockDate");
    const timeEl = document.getElementById("pageClockTime");
    if (!dateEl && !timeEl)
        return;
    if (clockIntervalHandle !== undefined) {
        window.clearInterval(clockIntervalHandle);
    }
    function tick() {
        const now = new Date();
        if (dateEl)
            dateEl.textContent = now.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
        if (timeEl)
            timeEl.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    tick();
    clockIntervalHandle = window.setInterval(tick, 1000);
}
//# sourceMappingURL=pageHeader.js.map