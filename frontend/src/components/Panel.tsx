import type { ReactNode } from "react";

/** Blue header + white body, shared by Admin and Settings. */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="ro-panel ad-panel">
            <div className="ro-bar"><div className="ro-side"><h2>{title}</h2></div></div>
            <div className="ad-body">{children}</div>
        </div>
    );
}

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="ad-f"><label>{label}</label>{children}</div>
);