"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { FRONTENDS, type FrontendId } from "./data";

// The frontend is chosen in the page, remembered across pages, and can be
// pinned in a link with ?frontend=vue (also what an agent would request).

const KEY = "cpk-proto-frontend";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
    window.removeEventListener("popstate", cb);
  };
}

function isFrontend(v: string | null): v is FrontendId {
  return !!v && FRONTENDS.some((f) => f.id === v);
}

function read(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("frontend");
  if (isFrontend(fromUrl)) return fromUrl;
  return localStorage.getItem(KEY) ?? "";
}

interface FrontendContextValue {
  frontend: FrontendId;
  chosen: boolean;
  ready: boolean;
  setFrontend: (id: FrontendId) => void;
}

const FrontendContext = createContext<FrontendContextValue | null>(null);

export function FrontendProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  const setFrontend = useCallback((id: FrontendId) => {
    localStorage.setItem(KEY, id);
    const url = new URL(window.location.href);
    if (url.searchParams.has("frontend")) {
      url.searchParams.set("frontend", id);
      window.history.replaceState(null, "", url);
    }
    for (const l of listeners) l();
  }, []);
  const value = useMemo<FrontendContextValue>(
    () => ({
      frontend: isFrontend(raw ?? null) ? (raw as FrontendId) : "react",
      chosen: isFrontend(raw ?? null),
      ready: raw !== undefined,
      setFrontend,
    }),
    [raw, setFrontend],
  );
  return <FrontendContext value={value}>{children}</FrontendContext>;
}

export function useFrontend(): FrontendContextValue {
  const v = useContext(FrontendContext);
  if (!v) throw new Error("useFrontend must be used inside <FrontendProvider>");
  return v;
}
