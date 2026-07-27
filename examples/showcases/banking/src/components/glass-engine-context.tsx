"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

const STORAGE_KEY = "northwind.glassEngine";

interface GlassEngineContextValue {
  /** Deployment-level gate (server-provided). When false, Glass Engine is absent. */
  available: boolean;
  /** Presenter's per-session on/off (localStorage). Meaningful only when available. */
  enabled: boolean;
  /** The render condition for the pane: available AND enabled. */
  active: boolean;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
}

const GlassEngineContext = createContext<GlassEngineContextValue | undefined>(
  undefined,
);

export function GlassEngineProvider({
  available,
  children,
}: {
  available: boolean;
  children: React.ReactNode;
}) {
  // Default off; standard mode is the default experience. Read the persisted
  // value lazily so SSR renders `false` and the client hydrates to the stored
  // value on mount.
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Client-only hydration from localStorage (an external system): SSR renders
    // the `false` default and the client syncs the persisted value post-mount. A
    // lazy initializer would read window during SSR and cause a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional localStorage hydration
    setEnabledState(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    }
  }, []);

  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  // `active` is the security-relevant render gate: it can never be true on a
  // deployment that did not opt in, regardless of what localStorage holds.
  const active = available && enabled;

  return (
    <GlassEngineContext.Provider
      value={{ available, enabled, active, setEnabled, toggle }}
    >
      {children}
    </GlassEngineContext.Provider>
  );
}

export function useGlassEngine(): GlassEngineContextValue {
  const ctx = useContext(GlassEngineContext);
  if (!ctx) {
    throw new Error("useGlassEngine must be used within a GlassEngineProvider");
  }
  return ctx;
}
