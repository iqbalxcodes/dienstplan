import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SettingsProvider, useSettings } from "./lib/i18n";
import { AuthProvider } from "./lib/auth";
import { StatusProvider } from "./lib/status";
import "./styles/app.css";

// tr() reads the language from a module variable (no hook needed anywhere):
// a new language = a fresh tree, so every tr() call runs again
function Root() {
    const { settings } = useSettings();
    return <App key={settings.language} />;
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <SettingsProvider>
                <AuthProvider>
                    <StatusProvider>
                        <Root />
                    </StatusProvider>
                </AuthProvider>
            </SettingsProvider>
        </BrowserRouter>
    </StrictMode>
);