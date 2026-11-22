import { useSyncExternalStore } from "react";

export const COMPACT_Q = "(max-width: 900px), (pointer: coarse) and (max-width: 1200px)";
const sub = (cb: () => void) => {
    const m = matchMedia(COMPACT_Q);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
};
export const useCompact = () => useSyncExternalStore(sub, () => matchMedia(COMPACT_Q).matches);