"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useOptionalSkin } from "@/shell/skin-provider";

import {
  DEFAULT_LAYOUT_PREFERENCES,
  LAYOUT_PREFERENCES_KEY,
  parseLayoutPreferences,
  serializeLayoutPreferences,
} from "./layout-preferences-storage";
import type {
  SidebarSide,
  StoredLayoutPreferences,
} from "./layout-preferences-storage";

export interface LayoutPreferencesValue extends StoredLayoutPreferences {
  toggleSidebarSide: () => void;
  setSidebarOpen: (open: boolean) => void;
}

const LayoutPreferencesContext = createContext<LayoutPreferencesValue | null>(
  null,
);

/**
 * A tiny external store over `localStorage`, consumed via
 * `useSyncExternalStore`.
 *
 * Why not `useState` + a hydration effect: reading storage in a `useState`
 * initialiser makes the server and client markup disagree, and writing state
 * from an effect is both a lint error here (`react-hooks/set-state-in-effect`)
 * and a cascading-render hazard. `useSyncExternalStore` is the sanctioned way to
 * read an external system, and its `getServerSnapshot` gives us a defined SSR
 * value — React then reconciles to the client snapshot without a mismatch.
 *
 * The snapshot is cached because `getSnapshot` must return a stable reference
 * between changes; returning a fresh object each call would loop React.
 */
function createPreferencesStore(
  key: string = LAYOUT_PREFERENCES_KEY,
  defaults: StoredLayoutPreferences = DEFAULT_LAYOUT_PREFERENCES,
) {
  let snapshot: StoredLayoutPreferences | null = null;
  const listeners = new Set<() => void>();

  function getSnapshot(): StoredLayoutPreferences {
    if (snapshot) return snapshot;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      // Privacy-mode browsers throw on access; the defaults are fine.
    }
    snapshot = stored ? parseLayoutPreferences(stored) : defaults;
    return snapshot;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    /** SSR has no storage, so the server always renders the defaults. */
    getServerSnapshot(): StoredLayoutPreferences {
      return defaults;
    },
    /**
     * Write-through: storage is only touched by a deliberate user action, so the
     * defaults are never persisted as though they were a choice.
     */
    commit(next: StoredLayoutPreferences) {
      snapshot = next;
      try {
        window.localStorage.setItem(key, serializeLayoutPreferences(next));
      } catch {
        // A non-persisted layout is cosmetic; never break the app over it.
      }
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Shell-global layout preferences: one set shared across every skin, so
 * switching skins mid-demo never rearranges the workspace.
 */
export function LayoutPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  // One store per provider instance — keeps test runs isolated from each other
  // (a module-level store would leak a cached snapshot between cases). Held in
  // `useState` with a lazy initialiser: constructed exactly once, and legal to
  // read during render, unlike a lazily-assigned ref.
  // A skin that declares `layoutDefaults` keeps its own preference under its
  // own key, so its default (and the presenter's ⇆ choice on it) never moves
  // another skin's chat.
  const skin = useOptionalSkin();
  const [store] = useState(() =>
    skin?.layoutDefaults
      ? createPreferencesStore(`${LAYOUT_PREFERENCES_KEY}:${skin.id}`, {
          ...DEFAULT_LAYOUT_PREFERENCES,
          sidebarSide:
            skin.layoutDefaults.chatSide ??
            DEFAULT_LAYOUT_PREFERENCES.sidebarSide,
        })
      : createPreferencesStore(),
  );

  const preferences = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  // Read current state at call time rather than closing over `preferences`, so
  // these keep a stable identity across renders.
  const toggleSidebarSide = useCallback(() => {
    const current = store.getSnapshot();
    store.commit({
      ...current,
      sidebarSide: current.sidebarSide === "left" ? "right" : "left",
    });
  }, [store]);

  const setSidebarOpen = useCallback(
    (open: boolean) => {
      store.commit({ ...store.getSnapshot(), sidebarOpen: open });
    },
    [store],
  );

  const value = useMemo<LayoutPreferencesValue>(
    () => ({ ...preferences, toggleSidebarSide, setSidebarOpen }),
    [preferences, toggleSidebarSide, setSidebarOpen],
  );

  return (
    <LayoutPreferencesContext.Provider value={value}>
      {children}
    </LayoutPreferencesContext.Provider>
  );
}

/**
 * Read the shell's layout preferences.
 *
 * Returns inert defaults outside the provider rather than throwing, so a stray
 * render — an isolated component test, a component mounted outside the shell —
 * never crashes. This mirrors `useChatInbox`'s fallback, and `ChatPanelHeader`
 * depends on it. Do not "harden" this into an invariant error.
 */
export function useLayoutPreferences(): LayoutPreferencesValue {
  const context = useContext(LayoutPreferencesContext);
  if (context) return context;
  return {
    ...DEFAULT_LAYOUT_PREFERENCES,
    toggleSidebarSide: () => {},
    setSidebarOpen: () => {},
  };
}

export type { SidebarSide };
