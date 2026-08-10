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

/**
 * Who is shopping. Two personas, and the contrast between them IS the memory
 * beat (spec §2, §9): Maya has a seeded preference in durable memory, Guest has
 * none, so clicking the SAME pill as each produces two different answers. A
 * single persona would reduce "memory is scoped per shopper" to "the agent knows
 * a fact", which an audience reads as a system-prompt trick.
 */
export interface Shopper {
  id: string;
  name: string;
  /** Forwarded as `userRole`. Both shoppers are shoppers — there is no staff role here. */
  role: string;
}

export const SHOPPERS: readonly Shopper[] = Object.freeze([
  { id: "maya", name: "Maya Okonkwo", role: "shopper" },
  { id: "guest", name: "Guest", role: "shopper" },
]);

/** Maya is first because the demo opens as the shopper who is already known. */
const DEFAULT_SHOPPER = SHOPPERS[0];

export const SHOPPER_STORAGE_KEY = "bookstore.shopper";

/**
 * A `Map`, not a plain object: the id can arrive from `localStorage`, which is
 * user-writable, and a plain-object lookup walks the prototype chain — so
 * `"constructor"` would resolve truthy and hand a `Function` to code that
 * declares a `Shopper`. `Map.get` only ever sees own entries.
 */
const BY_ID: Map<string, Shopper> = new Map(SHOPPERS.map((s) => [s.id, s]));

interface ShopperContextValue {
  shopper: Shopper;
  shoppers: readonly Shopper[];
  setShopperId: (id: string) => void;
}

const ShopperContext = createContext<ShopperContextValue | null>(null);

/**
 * A tiny external store over `localStorage`, consumed via
 * `useSyncExternalStore` — the same shape as the shell's
 * `createPreferencesStore` (src/shell/layout/layout-preferences.tsx).
 *
 * Why not `useState` + a hydration effect: reading storage in a `useState`
 * initialiser makes the server and client markup disagree, and writing state
 * from an effect is both a lint error here (`react-hooks/set-state-in-effect`)
 * and a cascading-render hazard. `useSyncExternalStore` is the sanctioned way to
 * read an external system, and `getServerSnapshot` gives SSR a defined value —
 * so hydration still never happens during render, and React reconciles to the
 * client snapshot without a mismatch.
 *
 * The snapshot is cached because `getSnapshot` must return a stable value
 * between commits; recomputing it on every call would loop React.
 */
function createShopperStore() {
  let snapshot: string | null = null;
  const listeners = new Set<() => void>();

  function getSnapshot(): string {
    if (snapshot !== null) return snapshot;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(SHOPPER_STORAGE_KEY);
    } catch {
      // Privacy-mode browsers throw on access. This store sits in
      // `RuntimeProviders`, ABOVE `CopilotKitProvider` — an uncaught throw here
      // would take down the whole skin subtree, so never let one escape.
    }
    // Validate before accepting: the key is user-writable, so a stale or
    // hand-edited value must not mint a shopper — and therefore a memory scope
    // — that is not in the roster.
    snapshot = stored && BY_ID.has(stored) ? stored : DEFAULT_SHOPPER.id;
    return snapshot;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    /** SSR has no storage, so the server always renders the default shopper. */
    getServerSnapshot(): string {
      return DEFAULT_SHOPPER.id;
    },
    commit(id: string) {
      // Same roster check as `getSnapshot`: validation has to live on BOTH
      // paths, because either one can be handed a prototype-chain key.
      if (!BY_ID.has(id)) return;
      snapshot = id;
      try {
        window.localStorage.setItem(SHOPPER_STORAGE_KEY, id);
      } catch {
        // A non-persisted shopper choice is cosmetic; never break the app.
      }
      for (const listener of listeners) listener();
    },
  };
}

export function ShopperProvider({ children }: { children: ReactNode }) {
  // One store per provider instance — keeps test cases isolated from each other
  // (a module-level store would leak a cached snapshot between them). Held in
  // `useState` with a lazy initialiser: constructed exactly once, and legal to
  // read during render, unlike a lazily-assigned ref.
  const [store] = useState(createShopperStore);

  const shopperId = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const select = useCallback((id: string) => store.commit(id), [store]);

  const value = useMemo<ShopperContextValue>(
    () => ({
      shopper: BY_ID.get(shopperId) ?? DEFAULT_SHOPPER,
      shoppers: SHOPPERS,
      setShopperId: select,
    }),
    [shopperId, select],
  );

  return (
    <ShopperContext.Provider value={value}>{children}</ShopperContext.Provider>
  );
}

export function useShopper(): ShopperContextValue {
  const value = useContext(ShopperContext);
  if (!value) {
    throw new Error("useShopper must be used inside <ShopperProvider>");
  }
  return value;
}

/**
 * The skin's `RuntimeProviders` — mounted by the shell ABOVE
 * `CopilotKitProvider`.
 *
 * Why above, not below: `properties` is a PROP of `CopilotKitProvider`, so its
 * source must already exist when the provider first commits. Mounting the
 * shopper context above it makes the provider the sole owner of the property
 * bag from render one, rather than a child racing an imperative
 * `setProperties` after mount — which would make identity "eventually correct
 * if effects fire in the right order" instead of correct from the first run.
 */
export function BookstoreRuntimeProviders({
  children,
}: {
  children: ReactNode;
}) {
  return <ShopperProvider>{children}</ShopperProvider>;
}

/**
 * The skin's `useRuntimeProperties`. The property NAMES are fixed by the server
 * contract (`IdentifyRunUser` in src/shell/agent-registry.ts takes
 * `{ userRole?, userId? }`), so do not rename them to shopper-flavoured ones —
 * `intelligence/user-id.ts` reads exactly these two.
 *
 * Memoized on the shopper's id and role so the object identity is stable across
 * renders and a run re-scopes only when the shopper actually changes. The shell
 * sets `a2uiCatalogAvailable` itself, so it is deliberately not set here.
 */
export function useBookstoreRuntimeProperties(): Record<string, unknown> {
  const { shopper } = useShopper();
  return useMemo(
    () => ({ userId: shopper.id, userRole: shopper.role }),
    [shopper.id, shopper.role],
  );
}
