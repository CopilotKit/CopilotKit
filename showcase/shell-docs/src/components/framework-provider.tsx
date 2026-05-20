"use client";

// FrameworkProvider — tracks the currently "active" agentic backend.
//
// Three fields, three different jobs:
//
// - `framework` — STRICTLY URL-derived. Non-null only on `/<framework>/...`
//   routes. Use this when chrome legitimately needs to know "is the URL
//   scoped to a framework?" (e.g. RouterPivot's redirect-target logic, or
//   a banner that only shows when the URL is genuinely scoped).
//
// - `storedFramework` — last REMEMBERED choice from localStorage. Use to
//   mark the user's last pick in a picker UI (e.g. ring around their card)
//   without treating it as the active selection.
//
// - `effectiveFramework` — what the page renders as. Falls back through
//   URL → stored → DEFAULT_FRAMEWORK so it's never null. This is the
//   field every snippet renderer, sidebar link, and "Continue with X"
//   pointer should read. Treating no-choice as Built-in Agent removes
//   the dead-end where fresh visitors saw a forced picker before any
//   working code.
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
   * URL-derived framework. Non-null only on `/<framework>/...` routes.
   * Use only when chrome needs to know "is the URL scoped to a
   * framework?" (e.g. redirect logic). For rendering content, prefer
   * `effectiveFramework`.
   */
  framework: string | null;
  /**
   * Last remembered framework from localStorage — advisory only. Use to
   * mark the user's last pick in a picker UI without implying the
   * current view is scoped to it.
   */
  storedFramework: string | null;
  /**
   * Framework the page should render as — never null. Falls through
   * URL → stored → DEFAULT_FRAMEWORK. Snippet renderers, sidebar links,
   * and "Continue with X" affordances should read this.
   */
  effectiveFramework: string;
  /** All known framework slugs derived from the registry. */
  knownFrameworks: string[];
  /** Persist a new framework preference (does not navigate). */
  setStoredFramework: (slug: string | null) => void;
}

const FrameworkContext = createContext<FrameworkContextValue | null>(null);

const STORAGE_KEY = "selectedFramework";

/**
 * Built-in Agent is the default integration: zero config, runs in-process
 * via the Next.js runtime, no external agent server. Treating fresh
 * visitors as if they'd picked it removes the forced-picker dead end and
 * gives them working code on first paint.
 */
export const DEFAULT_FRAMEWORK = "built-in-agent";

// Log each failure mode once per session so we don't spam the console
// on repeated reads/writes when localStorage is unavailable (SSR, private
// mode, storage disabled), but we still surface the failure to devs the
// first time it happens.
let readLogged = false;
let writeLogged = false;

function readStoredFramework(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    if (!readLogged) {
      console.warn("[framework-provider] localStorage read failed", err);
      readLogged = true;
    }
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
  } catch (err) {
    // localStorage may be unavailable (SSR, private mode, etc.) — log
    // once per session so the failure isn't completely silent.
    if (!writeLogged) {
      console.warn("[framework-provider] localStorage write failed", err);
      writeLogged = true;
    }
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
  // follows the user when they navigate back to /docs/*.
  //
  // `stored` is intentionally NOT a dep: including it causes this effect
  // to re-run every time we update stored from within (infinite-ish
  // ping-pong with the state setter below). We only care about URL
  // changes as the trigger. The internal `!== stored` check short-circuits
  // the no-op case using the latest closed-over value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (urlFramework && urlFramework !== stored) {
      writeStoredFramework(urlFramework);
      setStored(urlFramework);
    }
  }, [urlFramework]);

  // ACTIVE framework is strictly URL-derived. localStorage NEVER promotes
  // itself into `framework` — it lives in `storedFramework` where it can
  // be shown as "your last pick" without implying the current view is
  // scoped to it.
  const framework = urlFramework;

  // Effective framework falls through URL → stored → default so content
  // always has a target to render against. Validate `stored` against the
  // known registry before honouring it, so a stale entry from a renamed
  // or removed integration doesn't poison the render.
  const storedIsValid = stored !== null && knownFrameworks.includes(stored);
  const effectiveFramework =
    framework ?? (storedIsValid ? stored! : DEFAULT_FRAMEWORK);

  const setStoredFramework = (slug: string | null) => {
    // Validate the slug against the known registry. Callers passing a
    // slug we don't recognise would poison the stored preference (e.g.
    // leaking a route segment like "docs"). Drop + warn instead.
    if (slug !== null && !knownFrameworks.includes(slug)) {
      console.warn(
        `[framework-provider] setStoredFramework called with unknown slug "${slug}" — ignoring`,
      );
      return;
    }
    writeStoredFramework(slug);
    setStored(slug);
  };

  const value: FrameworkContextValue = {
    framework,
    storedFramework: stored,
    effectiveFramework,
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
    // Fail loudly: a silent fallback masks wiring bugs (components
    // rendered outside the provider tree would silently report "no
    // framework" forever). Matches every other context pattern in the
    // app.
    throw new Error("useFramework must be used within FrameworkProvider");
  }
  return ctx;
}
