import type { ReactNode } from "react";

interface Props {
    title: string;
    center?: ReactNode;
    right?: ReactNode;
    className?: string;
    children: ReactNode;
}

/** Card with the shared title / center / right header. */
export function Page({ title, center, right, className = "", children }: Props) {
    return (
        <div className={`table-container detail-card ${className}`}>
            <div className="reservation-header">
                <div className="header-title"><h3>{title}</h3></div>
                <div className="header-center">{center}</div>
                <div className="header-right">{right}</div>
            </div>
            {children}
        </div>
    );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
    return <section className="dash-section"><h3>{title}</h3>{children}</section>;
}
