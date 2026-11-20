import type { ReactNode } from "react";

interface Props {
    title: string;
    onClose: () => void;
    onSubmit?: () => void;          // omit to hide the primary button
    submitLabel?: string;
    children: ReactNode;
}

export function Modal({ title, onClose, onSubmit, submitLabel = "Save", children }: Props) {
    return (
        <div className="plan-modal-backdrop">
            <div className="plan-modal">
                <h3>{title}</h3>
                {children}
                <div className="plan-modal-footer">
                    <button onClick={onClose}>Cancel</button>
                    {onSubmit && <button className="primary" onClick={onSubmit}>{submitLabel}</button>}
                </div>
            </div>
        </div>
    );
}
