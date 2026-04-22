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
  /**
   * Whether the browser exposes usable localStorage. Lets consumers
   * distinguish "user has never picked a framework" (`storedFramework`
   * null, `storageAvailable` true) from "storage is unavailable so we
   * can't know" (`storedFramework` null, `storageAvailable` false).
   * Without this tri-state, a private-mode / cookies-disabled browser
   * would look identical to a fresh visitor, and UIs that want to warn
   * about lost persistence have no signal.
   */
  storageAvailable: boolean;
  /** All known framework slugs derived from the registry. */
  knownFrameworks: string[];
  /** Persist a new framework preference (does not navigate). */
  setStoredFramework: (slug: string | null) => void;
}

const FrameworkContext = createContext<FrameworkContextValue | null>(null);

const STORAGE_KEY = "selectedFramework";

// Log each failure mode once per session so we don't spam the console
// on repeated reads/writes when localStorage is unavailable (SSR, private
// mode, storage disabled), but we still surface the failure to devs the
// first time it happens.
let readLogged = false;
let writeLogged = false;

interface ReadResult {
  value: string | null;
  /**
   * False when localStorage threw (private mode, cookies disabled,
   * storage quota blown, etc). Callers MUST treat this as a separate
   * signal from `value === null` — the latter is "never set", the
   * former is "we can't tell".
   */
  available: boolean;
}

function readStoredFramework(): ReadResult {
  if (typeof window === "undefined") return { value: null, available: false };
  try {
    return {
      value: window.localStorage.getItem(STORAGE_KEY),
      available: true,
    };
  } catch (err) {
    if (!readLogged) {
      console.warn("[framework-provider] localStorage read failed", err);
      readLogged = true;
    }
    return { value: null, available: false };
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
  // Start false on both server and initial client render to keep SSR
  // and hydration output identical. Flipped to the real value in the
  // mount effect below.
  const [storageAvailable, setStorageAvailable] = useState<boolean>(false);

  // Hydrate stored framework on client mount.
  //
  // Covered by: first client render reads localStorage once and seeds
  // both `stored` and `storageAvailable`; in private-mode browsers
  // where the read throws, `storageAvailable` stays false so consumers
  // can branch on "we can't persist your pick".
  //
  // Validate the retrieved slug against the known registry — same
  // contract as `setStoredFramework` and the cross-tab `storage` handler.
  // A stale localStorage entry from a framework slug that was later
  // removed from the registry must not seed `stored`, otherwise
  // RouterPivot would redirect users to a non-existent framework page.
  // Clear the poisoned key so it stops haunting subsequent loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const result = readStoredFramework();
    setStorageAvailable(result.available);
    if (result.value !== null && !knownFrameworks.includes(result.value)) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[framework-provider] ignoring stored framework with unknown slug "${result.value}" — clearing`,
        );
      }
      writeStoredFramework(null);
      setStored(null);
      return;
    }
    setStored(result.value);
  }, []);

  // Cross-tab sync — when ANOTHER tab writes `selectedFramework`, our
  // current tab's `stored` falls out of sync until a full reload.
  // `storage` events fire on every tab EXCEPT the one that wrote, so
  // this is safe against self-echo loops.
  //
  // Covered by: Tab A picks langgraph-python; Tab B (already open on
  // /docs/foo) immediately updates its StoredFrameworkHighlight badge
  // and RouterPivot redirects without a reload. Clearing storage in
  // Tab A (`e.newValue === null`) likewise clears Tab B's `stored`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      // Scoped reads can pass null for e.newValue when the key is
      // removed; that's legitimately "cleared" and should null out
      // our state rather than be ignored.
      //
      // Validate non-null values against the known registry — same
      // contract as `setStoredFramework` below. A cross-tab write of an
      // arbitrary string (stale tab, browser extension, dev tools) must
      // not poison this tab's state.
      if (e.newValue !== null && !knownFrameworks.includes(e.newValue)) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[framework-provider] ignoring cross-tab storage write with unknown slug "${e.newValue}"`,
          );
        }
        return;
      }
      setStored(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [knownFrameworks]);

  // Whenever the URL asserts a framework, persist it so the preference
  // follows the user when they navigate back to /docs/*.
  //
  // `stored` is intentionally NOT a dep: including it causes this effect
  // to re-run every time we update stored from within (infinite-ish
  // ping-pong with the state setter below). We only care about URL
  // changes as the trigger. The internal `!== stored` check short-circuits
  // the no-op case using the latest closed-over value.
  //
  // Covered by: navigating /docs/foo → /langgraph-python/foo persists
  // once and does NOT re-fire when the setter updates `stored`; subsequent
  // navigation to /langgraph-python/bar (same framework) is a no-op.
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
    storageAvailable,
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
