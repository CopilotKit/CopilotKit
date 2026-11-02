"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_DESIGN_SYSTEM,
  isDesignSystem,
  type DesignSystemId,
} from "./registry";

const STORAGE_KEY = "a2ui-design-system";

type Choice = { id: DesignSystemId; setId: (id: DesignSystemId) => void };

const DesignSystemContext = createContext<Choice>({
  id: DEFAULT_DESIGN_SYSTEM,
  setId: () => {},
});

/** The design system surfaces draw with. Outside a provider (the component docs) it is CopilotKit's. */
export const useDesignSystem = () => useContext(DesignSystemContext);

/** The visitor's last pick, read after mount so the server render and the first client render agree. */
export function readStoredDesignSystem(): DesignSystemId | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("ds");
    if (isDesignSystem(fromUrl)) return fromUrl;
    const saved = localStorage.getItem(STORAGE_KEY);
    return isDesignSystem(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * Holds the design system for the playground and remembers it for this viewer. `?ds=chatcn` (or `byoc`) in
 * the URL picks one for a shared link.
 */
export function DesignSystemProvider({ children }: { children: ReactNode }) {
  const [id, setState] = useState<DesignSystemId>(DEFAULT_DESIGN_SYSTEM);
  useEffect(() => {
    const stored = readStoredDesignSystem();
    if (stored) setState(stored);
  }, []);
  const setId = useCallback((next: DesignSystemId) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      // A shared `?ds=` link picked the first one; a later pick wins, so the URL must not bring the old one back.
      const url = new URL(window.location.href);
      if (url.searchParams.has("ds")) {
        url.searchParams.delete("ds");
        history.replaceState(history.state, "", url);
      }
    } catch {}
  }, []);
  return (
    <DesignSystemContext.Provider value={{ id, setId }}>
      {children}
    </DesignSystemContext.Provider>
  );
}
