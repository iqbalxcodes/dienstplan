import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { tr } from "../lib/i18n";

export function RequireRole({ admin, children }: { admin?: boolean; children: ReactNode }) {
    const { isManager, isAdmin } = useAuth();
    if (admin ? isAdmin : isManager) return <>{children}</>;
    return (
        <div className="table-container detail-card">
            <p className="auth-error" style={{ margin: 24 }}>
                {tr(admin ? "Admin access required." : "Manager access required.")}
            </p>
        </div>
    );
}