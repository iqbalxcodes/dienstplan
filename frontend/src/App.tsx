import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireRole } from "./components/RequireRole";
import Dashboard from "./pages/Dashboard";
import Schedule from "./pages/Schedule";
import Hours from "./pages/Hours";
import Manager from "./pages/Manager";
import Admin from "./pages/Admin";
import History from "./pages/History";
import Settings from "./pages/Settings";
import ResetPassword from "./pages/ResetPassword";
import Zeiterfassung from "./pages/Zeiterfassung";

export default function App() {
    return (
        <Routes>
            <Route path="/reset" element={<ResetPassword />} />
            <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="schedule" element={<Schedule />} />
                <Route path="hours" element={<Hours />} />
                <Route path="zeiterfassung" element={<Zeiterfassung />} />
                <Route path="manager" element={<RequireRole><Manager /></RequireRole>} />
                <Route path="admin" element={<RequireRole admin><Admin /></RequireRole>} />
                <Route path="history" element={<RequireRole><History /></RequireRole>} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}