"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { A2UIOp } from "@/skins/exec/blocks/build-block-ops";
import type {
  BoardPack,
  Dashboard,
  DashboardBlock,
  DashboardId,
  Exception,
  LedgerSnapshot,
  MetricId,
  Narrative,
  NarrativeCode,
} from "./types";

/**
 * The exec skin's single client-side source of truth, mirroring people's
 * `ledger-context.tsx` (`src/skins/people/data/ledger-context.tsx`) beat for
 * beat: one `GET` snapshot, an inlined first-load promise chain with a
 * `cancelled` guard, a `refresh` whose `await` comes first, and nothing
 * rendered below until that first load resolves.
 */

/** One dashboard's blocks, enriched with the A2UI ops the GET route derives. */
export interface ExecLedgerDashboard extends Omit<Dashboard, "blocks"> {
  blocks: (DashboardBlock & { ops: A2UIOp[] })[];
}

/**
 * `LedgerSnapshot` (`@/skins/exec/data/types`) as returned by the store, with
 * `dashboards` widened to the shape `/api/exec/v1/ledger` actually sends:
 * each block enriched with its `ops`, derived fresh on every read rather than
 * stored — see that route's doc comment. Pages and the block grid consume
 * THIS type, not the bare `LedgerSnapshot`.
 */
export interface ExecLedgerSnapshot extends Omit<LedgerSnapshot, "dashboards"> {
  dashboards: Record<DashboardId, ExecLedgerDashboard>;
}

export interface FileNarrativeInput {
  metricId: MetricId;
  period: string;
  code: NarrativeCode;
  body: string;
  source?: "typed" | "ingested-memo";
}

/**
 * `publishPack` forwards `/api/exec/v1/packs`' response VERBATIM rather than
 * throwing on a non-OK status: `BAD_COUNTERSIGN` and `UNEXPLAINED_VARIANCE`
 * are both states the publish-pack page renders a gate for, not exceptional
 * failures — see that route's doc comment on why `code` must reach the
 * client as the literal string.
 */
export type PublishPackResult =
  | { status: 200; pack: BoardPack }
  // `pack?: never` keeps the union narrowable on `status === 200` alone, so a
  // consumer never needs an `in` check to reach `pack`.
  | { status: number; pack?: never; error: string; breaches?: Exception[] };

interface ExecLedgerContextValue {
  snapshot: ExecLedgerSnapshot;
  /** Re-fetch after a mutation. Every write path calls this. */
  refresh: () => Promise<void>;
  addBlock: (dashboardId: DashboardId, blockId: string) => Promise<void>;
  removeBlock: (dashboardId: DashboardId, blockId: string) => Promise<void>;
  moveBlock: (
    dashboardId: DashboardId,
    blockId: string,
    direction: "up" | "down",
  ) => Promise<void>;
  fileNarrative: (input: FileNarrativeInput) => Promise<Narrative>;
  publishPack: (
    dashboardId: DashboardId,
    countersignPin: string,
  ) => Promise<PublishPackResult>;
  resetDemo: () => Promise<void>;
}

const ExecLedgerContext = createContext<ExecLedgerContextValue | null>(null);

const EMPTY: ExecLedgerSnapshot = {
  metricDefs: [],
  points: [],
  initiatives: [],
  narratives: [],
  dashboards: {
    ceo: { id: "ceo", title: "", blocks: [] },
    cfo: { id: "cfo", title: "", blocks: [] },
  },
  packs: [],
  exceptions: [],
};

export function ExecLedgerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ExecLedgerSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  // Note the `await` comes FIRST: nothing here sets state synchronously, which
  // is what keeps the mount effect below off React's cascading-render path
  // (`react-hooks/set-state-in-effect`).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/exec/v1/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
      setSnapshot((await res.json()) as ExecLedgerSnapshot);
    } catch (error) {
      // Surfacing this as a thrown error would blank the whole app mid-demo
      // for what is almost always a dev-server restart. Log it, keep the
      // last good snapshot on screen, and let the next mutation's refresh
      // recover.
      console.error("[exec] ledger refresh failed", error);
    }
  }, []);

  // The FIRST load is inlined as a promise chain rather than a call to
  // `refresh`, mirroring people's provider: invoking any setState-calling
  // function synchronously in an effect body trips
  // `react-hooks/set-state-in-effect` — setting state inside a `.then` does
  // not. The `cancelled` guard stops a slow first fetch from setting state
  // after the provider has already unmounted.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/exec/v1/ledger", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
        return res.json() as Promise<ExecLedgerSnapshot>;
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setLoaded(true);
      })
      .catch((error) => {
        console.error("[exec] initial ledger fetch failed", error);
        // Still mark loaded: children must mount even on a failed first
        // fetch, or a dev-server hiccup leaves the whole skin rendering
        // nothing with no indication of why.
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addBlock = useCallback(
    async (dashboardId: DashboardId, blockId: string) => {
      const res = await fetch(`/api/exec/v1/dashboards/${dashboardId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId }),
      });
      if (!res.ok) {
        // Read the body before throwing: the route answers a bad blockId
        // with 404 `{ error: "NOT_FOUND", message }`, and that message is
        // the only thing that says WHICH id had no draft behind it. A bare
        // status code sends the reader to the network tab instead.
        const body = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(`add block failed: ${body?.message ?? res.status}`);
      }
      await refresh();
    },
    [refresh],
  );

  const removeBlock = useCallback(
    async (dashboardId: DashboardId, blockId: string) => {
      const res = await fetch(
        `/api/exec/v1/dashboards/${dashboardId}/blocks/${blockId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`remove block failed: ${res.status}`);
      await refresh();
    },
    [refresh],
  );

  const moveBlock = useCallback(
    async (
      dashboardId: DashboardId,
      blockId: string,
      direction: "up" | "down",
    ) => {
      const res = await fetch(
        `/api/exec/v1/dashboards/${dashboardId}/blocks/${blockId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction }),
        },
      );
      if (!res.ok) throw new Error(`move block failed: ${res.status}`);
      await refresh();
    },
    [refresh],
  );

  const fileNarrative = useCallback(
    async (input: FileNarrativeInput): Promise<Narrative> => {
      const res = await fetch("/api/exec/v1/narratives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.status !== 201) {
        throw new Error(`file narrative failed: ${res.status}`);
      }
      const filed = (await res.json()) as Narrative;
      await refresh();
      return filed;
    },
    [refresh],
  );

  // Publishing is gated on countersign PIN and unexplained variance, in that
  // order (see `store.publishPack`'s doc comment) — a non-OK response here is
  // an expected gate the page renders, not a failure, so it is parsed and
  // returned rather than thrown.
  const publishPack = useCallback(
    async (
      dashboardId: DashboardId,
      countersignPin: string,
    ): Promise<PublishPackResult> => {
      const res = await fetch("/api/exec/v1/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardId, countersignPin }),
      });
      if (!res.ok) {
        const body = (await res.json()) as {
          error: string;
          breaches?: Exception[];
        };
        return { status: res.status, ...body };
      }
      const pack = (await res.json()) as BoardPack;
      await refresh();
      return { status: 200, pack };
    },
    [refresh],
  );

  const resetDemo = useCallback(async () => {
    const res = await fetch("/api/exec/v1/dev/reset", { method: "POST" });
    if (!res.ok) throw new Error(`reset demo failed: ${res.status}`);
    await refresh();
  }, [refresh]);

  const value = useMemo<ExecLedgerContextValue>(
    () => ({
      snapshot,
      refresh,
      addBlock,
      removeBlock,
      moveBlock,
      fileNarrative,
      publishPack,
      resetDemo,
    }),
    [
      snapshot,
      refresh,
      addBlock,
      removeBlock,
      moveBlock,
      fileNarrative,
      publishPack,
      resetDemo,
    ],
  );

  // Render nothing until the first load resolves — every page under this
  // provider reads dashboards/metrics/packs off `snapshot` and a placeholder
  // EMPTY snapshot would render as "no data" indistinguishably from a real
  // empty demo state.
  if (!loaded) return null;

  return (
    <ExecLedgerContext.Provider value={value}>
      {children}
    </ExecLedgerContext.Provider>
  );
}

/**
 * Read the ledger. Throws when used outside the provider rather than
 * returning an empty snapshot: a silently-empty ledger renders as "no
 * dashboards", which is indistinguishable from a real empty state and would
 * send someone hunting through the store's seed data instead of the provider
 * tree.
 */
export function useExecLedger(): ExecLedgerContextValue {
  const ctx = useContext(ExecLedgerContext);
  if (!ctx) {
    throw new Error("useExecLedger must be used inside <ExecLedgerProvider>");
  }
  return ctx;
}
