"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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

/** What a design system loads before it can draw. Material's stylesheet and font are fetched on first pick. */
const ASSETS: Partial<Record<DesignSystemId, () => Promise<unknown>>> = {
  material: () => import("./material-assets"),
};

/**
 * Holds the design system for the playground and remembers it for this viewer. `?ds=chatcn` (or `material`,
 * `byoc`) in the URL picks one for a shared link. A design system with assets switches once they have
 * loaded, so its components never paint unstyled; `draws={false}` (a page that draws no surface) skips them.
 */
export function DesignSystemProvider({
  children,
  draws = true,
}: {
  children: ReactNode;
  draws?: boolean;
}) {
  const [id, setState] = useState<DesignSystemId>(DEFAULT_DESIGN_SYSTEM);
  // Each pick waits for its assets; only the latest one may apply, so a slow load never undoes a later pick.
  const latest = useRef(0);
  const apply = useCallback(
    async (next: DesignSystemId) => {
      const pick = ++latest.current;
      const load = draws ? ASSETS[next] : undefined;
      if (load) {
        try {
          await load();
        } catch (error) {
          console.error(`Could not load the ${next} design system`, error);
          return false;
        }
      }
      if (pick !== latest.current) return false;
      setState(next);
      return true;
    },
    [draws],
  );
  useEffect(() => {
    const stored = readStoredDesignSystem();
    if (stored) void apply(stored);
  }, [apply]);
  const setId = useCallback(
    async (next: DesignSystemId) => {
      if (!(await apply(next))) return;
      try {
        localStorage.setItem(STORAGE_KEY, next);
        // A shared `?ds=` link picked the first one; a later pick wins, so the URL must not bring the old one back.
        const url = new URL(window.location.href);
        if (url.searchParams.has("ds")) {
          url.searchParams.delete("ds");
          history.replaceState(history.state, "", url);
        }
      } catch {}
    },
    [apply],
  );
  return (
    <DesignSystemContext.Provider value={{ id, setId }}>
      {children}
    </DesignSystemContext.Provider>
  );
}
