"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { CommerceStoreState, Operator } from "./types";

/**
 * Bellwether's single client-side source of truth.
 *
 * Mounted in the skin's `RuntimeProviders` — i.e. ABOVE `CopilotKitProvider` —
 * for one specific reason: `useRuntimeProperties` reads the signed-in operator
 * out of this context, and `properties` is a PROP of `CopilotKitProvider`, so
 * its source has to exist before that provider's first commit. A child racing
 * an imperative `setProperties` after mount is the exact bug the contract's
 * `RuntimeProviders` slot exists to prevent.
 *
 * Because it sits above the provider it is also visible to everything below —
 * `Tools`, the layout, and every page — so the order queue, the ladder, the
 * promotions table and the agent's readables all read the SAME snapshot. That
 * consistency is load-bearing for beat 3b: the agent is asked to describe what
 * is literally on screen, and it cannot do that if a panel and a readable are
 * one fetch apart.
 */

interface LedgerContextValue {
  data: CommerceStoreState;
  /**
   * Re-fetch after a mutation. Every write path calls this.
   *
   * Resolves `true` ONLY when a fresh snapshot was actually committed to this
   * context — `false` when the fetch failed, or when the provider unmounted
   * before the response landed. Any caller that goes on to tell the user (or the
   * agent) that the write is done MUST check it: a `false` means the rows on
   * screen are still the pre-mutation ones, and "done" printed over them is
   * indistinguishable from a slow network.
   */
  refresh: () => Promise<boolean>;
  operator: Operator;
  setOperatorId: (id: string) => void;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

const EMPTY: CommerceStoreState = {
  products: [],
  floors: [],
  orders: [],
  notifications: [],
  returns: [],
  promotions: [],
  waivers: [],
  plans: [],
  operators: [],
};

const FALLBACK_OPERATOR: Operator = {
  id: "op-nadia",
  name: "Nadia Okonjo",
  role: "merch-lead",
  team: "Merchandising",
};

export function CommerceLedgerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CommerceStoreState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [operatorId, setOperatorId] = useState<string>(FALLBACK_OPERATOR.id);

  /**
   * ONE liveness flag for EVERY async path in this provider — the mount fetch
   * below and `refresh` both consult it before touching state, and the mount
   * effect's cleanup is what clears it.
   *
   * It is provider-lifetime rather than per-effect on purpose. `refresh` is
   * called from click handlers and tool handlers, not from an effect, so it has
   * no cleanup of its own to hang a local `cancelled` off; and the shell
   * remounts the entire runtime subtree keyed by skin id, so a skin switch while
   * a mutation's refresh is still in flight unmounts this provider. That is
   * routine operation, not a rare race.
   */
  const live = useRef(true);

  // Note the `await` comes FIRST: nothing here sets state synchronously, which
  // is what keeps the mount effect below off React's cascading-render path
  // (`react-hooks/set-state-in-effect`). An in-flight flag set before the fetch
  // would put it straight back on it, and no consumer wanted one.
  //
  // It reports failure by RESOLVING FALSE rather than rejecting. Rejecting would
  // blank the app mid-demo for what is almost always a dev-server restart, and
  // would turn sixteen bare `await refresh()` call sites into unhandled
  // rejections. Resolving `void` — the shape this replaced — was the other
  // extreme: every one of those call sites went on to report success over rows
  // that had never been re-fetched.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/commerce/v1/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
      const snapshot = (await res.json()) as CommerceStoreState;
      // Unmounted while the fetch was in flight: setting state here is the
      // React warning, and claiming success is the worse half — nothing was
      // committed, so the answer is `false`.
      if (!live.current) return false;
      setData(snapshot);
      setLoaded(true);
      return true;
    } catch (error) {
      // Keep the last good snapshot on screen and let the next mutation's
      // refresh recover; the caller is told, so it can stop short of claiming
      // the screen is current.
      console.error("[commerce] ledger refresh failed", error);
      if (live.current) setLoaded(true);
      return false;
    }
  }, []);

  // The FIRST load is inlined as a promise chain rather than a call to
  // `refresh`. `react-hooks/set-state-in-effect` traces through the callback
  // boundary, so invoking any setState-calling function synchronously in an
  // effect body trips it — setting state inside a `.then` does not. The `live`
  // guard is the second reason to prefer this shape: it stops a slow first fetch
  // from setting state after the provider has already unmounted.
  useEffect(() => {
    live.current = true;
    fetch("/api/commerce/v1/ledger", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
        return res.json() as Promise<CommerceStoreState>;
      })
      .then((snapshot) => {
        if (!live.current) return;
        setData(snapshot);
        setLoaded(true);
      })
      .catch((error) => {
        console.error("[commerce] initial ledger fetch failed", error);
        // Still mark loaded: children must mount even on a failed first fetch,
        // or a dev-server hiccup leaves the whole skin rendering nothing with no
        // indication of why.
        if (live.current) setLoaded(true);
      });
    return () => {
      live.current = false;
    };
  }, []);

  const operator = useMemo(
    () =>
      data.operators.find((o) => o.id === operatorId) ??
      data.operators[0] ??
      FALLBACK_OPERATOR,
    [data.operators, operatorId],
  );

  const value = useMemo<LedgerContextValue>(
    () => ({ data, refresh, operator, setOperatorId }),
    [data, refresh, operator],
  );

  // Render nothing until the first load resolves. This looks heavy-handed for a
  // provider, but it is what makes the runtime identity correct on the FIRST run
  // of a session: `useRuntimeProperties` reads `operator` from here, so mounting
  // children early would hand CopilotKitProvider a placeholder operator and
  // scope the opening messages of a demo to the wrong memory bucket — which then
  // looks like "memory didn't work".
  if (!loaded) return null;

  return (
    <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
  );
}

/**
 * Read the ledger. Throws when used outside the provider rather than returning
 * an empty snapshot: a silently-empty catalog renders as "no products", which is
 * indistinguishable from a real empty state and would send someone hunting
 * through the seed file instead of the provider tree.
 */
export function useCommerceLedger(): LedgerContextValue {
  const ctx = useContext(LedgerContext);
  if (!ctx) {
    throw new Error(
      "useCommerceLedger must be used inside <CommerceLedgerProvider>",
    );
  }
  return ctx;
}
