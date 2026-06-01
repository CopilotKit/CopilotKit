"use client";

// FrameworkProvider — tracks the currently "active" agentic backend.
//
// IMPORTANT: `framework` is STRICTLY URL-derived. It's non-null only when
// the user is actually on a framework-scoped route (`/<framework>/...`).
// On `/docs/...`, `/`, and other non-scoped routes, `framework` is null
// and the page renders the "no agentic backend selected" state.
//
// `storedFramework` is a separate, advisory signal: the user's last
// remembered choice from localStorage. Consumers use it to mark "this
// was your last pick" (e.g. highlight that card in the framework picker)
// WITHOUT treating it as the active framework. Visiting `/docs/` after
// previously picking LangChain must still show the unselected state —
// only explicit navigation to `/langgraph-python/...` (or clicking the
// card) makes LangChain active.
//
// Whenever the URL asserts a framework, we persist it as the new
// storedFramework so the preference carries.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

export interface FrameworkContextValue {
  /**
   * Currently ACTIVE framework — strictly URL-derived. Non-null only on
   * `/<framework>/...` routes. Consumers that render "is this a
   * framework-scoped view?" chrome (selectors, banners, snippets) should
   * branch on this field.
   */
  framework: string | null;
  /**
   * Last REMEMBERED framework from localStorage — advisory, does NOT
   * auto-activate. Use to mark the user's last pick in a picker UI
   * without implying the current view is scoped to it.
   */
  storedFramework: string | null;
  /** All known framework slugs derived from the registry. */
  knownFrameworks: string[];
  /** Persist a new framework preference (does not navigate). */
  setStoredFramework: (slug: string | null) => void;
}

const FrameworkContext = createContext<FrameworkContextValue | null>(null);

const STORAGE_KEY = "selectedFramework";

function readStoredFramework(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredFramework(slug: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (slug === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, slug);
    }
  } catch {
    // localStorage may be unavailable (SSR, private mode, etc.) — silent no-op
  }
}

export function FrameworkProvider({
  children,
  knownFrameworks,
}: {
  children: React.ReactNode;
  knownFrameworks: string[];
}) {
  const pathname = usePathname() ?? "";
  const urlFramework = useMemo(() => {
    const first = pathname.split("/").filter(Boolean)[0];
    if (first && knownFrameworks.includes(first)) return first;
    return null;
  }, [pathname, knownFrameworks]);

  const [stored, setStored] = useState<string | null>(null);

  // Hydrate stored framework on client mount
  useEffect(() => {
    setStored(readStoredFramework());
  }, []);

  // Whenever the URL asserts a framework, persist it so the preference
  // follows the user when they navigate back to /docs/*
  useEffect(() => {
    if (urlFramework && urlFramework !== stored) {
      writeStoredFramework(urlFramework);
      setStored(urlFramework);
    }
  }, [urlFramework, stored]);

  // ACTIVE framework is strictly URL-derived. localStorage NEVER promotes
  // itself into `framework` — it lives in `storedFramework` where it can
  // be shown as "your last pick" without implying the current view is
  // scoped to it.
  const framework = urlFramework;

  const setStoredFramework = (slug: string | null) => {
    writeStoredFramework(slug);
    setStored(slug);
  };

  const value: FrameworkContextValue = {
    framework,
    storedFramework: stored,
    knownFrameworks,
    setStoredFramework,
  };

  return (
    <FrameworkContext.Provider value={value}>
      {children}
    </FrameworkContext.Provider>
  );
}

export function useFramework(): FrameworkContextValue {
  const ctx = useContext(FrameworkContext);
  if (!ctx) {
    // Graceful fallback for trees that forgot to wrap in the provider —
    // return a neutral, read-only value rather than throwing.
    return {
      framework: null,
      storedFramework: null,
      knownFrameworks: [],
      setStoredFramework: () => {},
    };
  }
  return ctx;
}
