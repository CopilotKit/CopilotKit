"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { hasDocs } from "@/lib/frontends";
import type { FrontendId } from "@/lib/frontends";

// The frontend is chosen in the page, remembered across pages, and can be
// pinned in a link with ?frontend=vue (also what an agent would request).
// Only a frontend with docs is ever remembered (`hasDocs`): picking one in
// early access opens its landing page and leaves the reader's docs stack as
// it was, and a pin or a stored value naming one (from an older build) is
// ignored.

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

/** The one rule for what can be stored or read as the reader's frontend. */
const isFrontend = (v: string | null | undefined): v is FrontendId =>
  hasDocs(v);

/** The remembered frontend: the `?frontend=` pin, else the stored one; "" for none. */
export function readFrontend(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("frontend");
  if (isFrontend(fromUrl)) return fromUrl;
  const stored = localStorage.getItem(KEY);
  return isFrontend(stored) ? stored : "";
}

/**
 * Makes `id` the reader's frontend (and the `?frontend=` pin, when the URL
 * has one), and says whether it did: a frontend without docs is ignored.
 */
export function chooseFrontend(id: FrontendId): boolean {
  if (!isFrontend(id)) return false;
  localStorage.setItem(KEY, id);
  const url = new URL(window.location.href);
  if (url.searchParams.has("frontend")) {
    url.searchParams.set("frontend", id);
    window.history.replaceState(null, "", url);
  }
  for (const l of listeners) l();
  return true;
}

/**
 * Remembers the frontend of the docs page being read (`/vue/...` is Vue, a
 * URL with no frontend is React), so links on the pages that aren't per
 * frontend (the home, the reference, the cookbook) keep the reader on it.
 * The `?frontend=` pin wins while it is in the URL.
 */
export function rememberFrontend(id: FrontendId) {
  if (!isFrontend(id) || localStorage.getItem(KEY) === id) return;
  localStorage.setItem(KEY, id);
  for (const l of listeners) l();
}

/**
 * The saved frontend, or null before the reader has one, without the
 * provider: for UI mounted outside the docs layout (the search dialog).
 */
export function useSavedFrontend(): FrontendId | null {
  const raw = useSyncExternalStore(subscribe, readFrontend, () => "");
  return isFrontend(raw) ? raw : null;
}

interface FrontendContextValue {
  frontend: FrontendId;
  chosen: boolean;
  ready: boolean;
  /** `chooseFrontend`: ignores a frontend without docs. */
  setFrontend: (id: FrontendId) => boolean;
}

const FrontendContext = createContext<FrontendContextValue | null>(null);

export function FrontendProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readFrontend, () => undefined);
  const value = useMemo<FrontendContextValue>(
    () => ({
      frontend: isFrontend(raw ?? null) ? (raw as FrontendId) : "react",
      chosen: isFrontend(raw ?? null),
      ready: raw !== undefined,
      setFrontend: chooseFrontend,
    }),
    [raw],
  );
  return <FrontendContext value={value}>{children}</FrontendContext>;
}

export function useFrontend(): FrontendContextValue {
  const v = useContext(FrontendContext);
  if (!v) throw new Error("useFrontend must be used inside <FrontendProvider>");
  return v;
}
