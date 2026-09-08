"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Operator, PeopleStoreState } from "./types";

/**
 * Rowan's single client-side source of truth.
 *
 * Mounted in the skin's `RuntimeProviders` — i.e. ABOVE `CopilotKitProvider` —
 * for one specific reason: `useRuntimeProperties` reads the signed-in operator
 * out of this context, and `properties` is a PROP of `CopilotKitProvider`, so
 * its source has to exist before that provider's first commit. A child racing
 * an imperative `setProperties` after mount is the exact bug the contract's
 * `RuntimeProviders` slot exists to prevent.
 *
 * Because it sits above the provider it is also visible to everything below —
 * `Tools`, the layout, and every page — so the roster, the ladder, the queue
 * and the agent's readables all read the SAME snapshot. That consistency is
 * load-bearing for beat 3b: the agent is asked to describe what is literally on
 * screen, and it cannot do that if a panel and a readable are one fetch apart.
 */

interface LedgerContextValue {
  data: PeopleStoreState;
  /** Re-fetch after a mutation. Every write path calls this. */
  refresh: () => Promise<void>;
  operator: Operator;
  setOperatorId: (id: string) => void;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

const EMPTY: PeopleStoreState = {
  employees: [],
  bands: [],
  requests: [],
  compRequests: [],
  bandExceptions: [],
  onboardingTasks: [],
  packets: [],
  operators: [],
};

export function PeopleLedgerProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PeopleStoreState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [operatorId, setOperatorId] = useState<string>("op-maya");

  // Note the `await` comes FIRST: nothing here sets state synchronously, which
  // is what keeps the mount effect below off React's cascading-render path
  // (`react-hooks/set-state-in-effect`). An in-flight flag set before the fetch
  // would put it straight back on it, and no consumer wanted one.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/people/v1/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
      setData((await res.json()) as PeopleStoreState);
    } catch (error) {
      // Surfacing this as a thrown error would blank the whole app mid-demo for
      // what is almost always a dev-server restart. Log it, keep the last good
      // snapshot on screen, and let the next mutation's refresh recover.
      console.error("[people] ledger refresh failed", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  // The FIRST load is inlined as a promise chain rather than a call to
  // `refresh`, mirroring `logistics/components/planner-auth-context.tsx`.
  // `react-hooks/set-state-in-effect` traces through the callback boundary, so
  // invoking any setState-calling function synchronously in an effect body
  // trips it — setting state inside a `.then` does not. The `cancelled` guard
  // is the second reason to prefer this shape: it stops a slow first fetch from
  // setting state after the provider has already unmounted.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/people/v1/ledger", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
        return res.json() as Promise<PeopleStoreState>;
      })
      .then((snapshot) => {
        if (cancelled) return;
        setData(snapshot);
        setLoaded(true);
      })
      .catch((error) => {
        console.error("[people] initial ledger fetch failed", error);
        // Still mark loaded: children must mount even on a failed first fetch,
        // or a dev-server hiccup leaves the whole skin rendering nothing with
        // no indication of why.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const operator = useMemo(
    () =>
      data.operators.find((o) => o.id === operatorId) ??
      data.operators[0] ?? {
        id: "op-maya",
        name: "Maya Lindqvist",
        role: "people-ops-lead" as const,
        team: "People Ops" as const,
      },
    [data.operators, operatorId],
  );

  const value = useMemo<LedgerContextValue>(
    () => ({ data, refresh, operator, setOperatorId }),
    [data, refresh, operator],
  );

  // Render nothing until the first load resolves. This looks heavy-handed for a
  // provider, but it is what makes the runtime identity correct on the FIRST
  // run of a session: `useRuntimeProperties` reads `operator` from here, so
  // mounting children early would hand CopilotKitProvider a placeholder
  // operator and scope the opening messages of a demo to the wrong memory
  // bucket — which then looks like "memory didn't work".
  if (!loaded) return null;

  return (
    <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
  );
}

/**
 * Read the ledger. Throws when used outside the provider rather than returning
 * an empty snapshot: a silently-empty roster renders as "no employees", which
 * is indistinguishable from a real empty state and would send someone hunting
 * through the seed file instead of the provider tree.
 */
export function usePeopleLedger(): LedgerContextValue {
  const ctx = useContext(LedgerContext);
  if (!ctx) {
    throw new Error(
      "usePeopleLedger must be used inside <PeopleLedgerProvider>",
    );
  }
  return ctx;
}
