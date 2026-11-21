import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { SettingsProvider } from "./lib/i18n";
import { AuthProvider } from "./lib/auth";
import { StatusProvider } from "./lib/status";
import "./styles/style.css";
import "./styles/dienstplan.css";
import "./styles/shell.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <SettingsProvider>
                <AuthProvider>
                    <StatusProvider>
                        <App />
                    </StatusProvider>
                </AuthProvider>
            </SettingsProvider>
        </BrowserRouter>
    </StrictMode>
);
