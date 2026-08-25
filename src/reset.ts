import { supabaseClient } from "./supabaseClient.js";

document.addEventListener("DOMContentLoaded", () => {

    const status = document.getElementById("resetStatus")!;
    const form   = document.getElementById("resetForm")!;
    const errEl  = document.getElementById("resetError")!;
    const btn    = document.getElementById("resetSaveBtn") as HTMLButtonElement;

    const url = new URL(window.location.href);
    const valid = url.hash.includes("access_token") || url.searchParams.has("code");

    if(!valid){
        status.textContent = "This link is invalid or has expired. Please request a new one.";
        return;
    }

    status.textContent = "";
    form.style.display = "";

    btn.addEventListener("click", async () => {

        const p1 = (document.getElementById("newPassword") as HTMLInputElement).value;
        const p2 = (document.getElementById("newPassword2") as HTMLInputElement).value;

        errEl.style.display = "none";

        if(p1.length < 8){
            errEl.textContent = "Password must be at least 8 characters.";
            errEl.style.display = "";
            return;
        }
        if(p1 !== p2){
            errEl.textContent = "Passwords do not match.";
            errEl.style.display = "";
            return;
        }

        btn.disabled = true;

        const { error } = await supabaseClient.auth.updateUser({ password: p1 });

        if(error){
            errEl.textContent = error.message;
            errEl.style.display = "";
            btn.disabled = false;
            return;
        }

        status.style.color = "#2e7d32";
        status.textContent = "Password updated! Redirecting\u2026";
        setTimeout(() => { window.location.href = "/index.html"; }, 1500);

    });

});