// Status-bar message + portal targets (History renders pagination into the bar).
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Kind = "info" | "success" | "error";

interface Ctx {
    msg: { text: string; kind: Kind } | null;
    say: (text: string, kind?: Kind) => void;
    infoEl: HTMLElement | null;
    navEl: HTMLElement | null;
    setInfoEl: (el: HTMLElement | null) => void;
    setNavEl: (el: HTMLElement | null) => void;
}

const StatusCtx = createContext<Ctx>(null!);
export const useStatus = () => useContext(StatusCtx);

export function StatusProvider({ children }: { children: ReactNode }) {

    const [msg, setMsg] = useState<Ctx["msg"]>(null);
    const [infoEl, setInfoEl] = useState<HTMLElement | null>(null);
    const [navEl, setNavEl] = useState<HTMLElement | null>(null);
    const timer = useRef<number>(undefined);

    const say = useCallback((text: string, kind: Kind = "info") => {
        setMsg({ text, kind });
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setMsg(null), 4000);
    }, []);

    return (
        <StatusCtx.Provider value={{ msg, say, infoEl, navEl, setInfoEl, setNavEl }}>
            {children}
        </StatusCtx.Provider>
    );
}
