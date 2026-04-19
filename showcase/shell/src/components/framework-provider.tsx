"use client";

// FrameworkProvider — tracks the currently selected "agentic backend" via
// URL-first, localStorage-fallback semantics.
//
// Resolution order:
//   1. The first URL path segment, if it matches a known integration slug
//      (e.g. `/langgraph-python/agentic-chat-ui` → `langgraph-python`)
//   2. `localStorage["selectedFramework"]`
//   3. `null` (no framework selected)
//
// The URL case is the authoritative one — when the user visits a
// framework-scoped page we persist that slug back into localStorage so
// the preference carries across later visits to non-scoped pages like
// `/docs/...`.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

export interface FrameworkContextValue {
  /** Currently active framework slug, or null when none is selected. */
  framework: string | null;
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

  const framework = urlFramework ?? stored;

  const setStoredFramework = (slug: string | null) => {
    writeStoredFramework(slug);
    setStored(slug);
  };

  const value: FrameworkContextValue = {
    framework,
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
      knownFrameworks: [],
      setStoredFramework: () => {},
    };
  }
  return ctx;
}
