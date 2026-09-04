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
  // `pack?: never` does NOT let `status === 200` alone narrow this union —
  // `status`'s other arm is the general `number`, which overlaps `200`, so TS
  // can narrow the success arm IN on `status === 200` but can never exclude
  // it FROM the arm below. The real discriminator is `"pack" in outcome` (or
  // any check for `pack` being present) — see `tools.tsx`'s `onSubmit`.
  // `pack?: never` only makes THAT check type-safe, by giving the failure arm
  // an (absent) `pack` property for the `in` check to test against.
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

/**
 * Throws a block mutation's failure with the SERVER's message, not just its
 * status.
 *
 * Every `blocks` route answers a coded refusal as `{ error, message }` (see
 * `@/skins/exec/data/store-errors`), and that message is the only thing that
 * says WHICH block id, and which dashboard, was involved: `NOT_FOUND` on a
 * DELETE means the id is not on that dashboard, `ALREADY_PINNED` on a POST
 * names the dashboard already holding it. `dashboard-grid.tsx` and the chat's
 * `AddToDashboard` control both render this string verbatim, so dropping it
 * for a bare status code puts "remove block failed: 404" on screen and sends
 * the reader to the network tab.
 *
 * Returns `Promise<never>` so a call site can `await` it as its whole failure
 * branch — the awaited value is uninhabited, so nothing downstream can
 * accidentally treat a non-OK response as usable.
 */
async function throwWithBodyMessage(
  action: string,
  res: Response,
): Promise<never> {
  const body = (await res.json().catch(() => null)) as {
    message?: string;
  } | null;
  throw new Error(`${action} failed: ${body?.message ?? res.status}`);
}

/**
 * Thrown by `resetDemo` on a non-OK response, carrying the parsed body so the
 * caller (`handleReset` in `layout.tsx`) can say WHY rather than just THAT it
 * failed. `POST /api/exec/v1/dev/reset` answers 502 with `seeded`,
 * `expectedSeeds` and a redacted `memoryError` when the store reset but
 * memory seeding fell short — a bare `Error` here would throw that detail
 * away and leave the alert saying only "reset failed: 502".
 */
export class ResetDemoError extends Error {
  /** The parsed response body, or `null` when it was missing or not JSON. */
  readonly body: Record<string, unknown> | null;

  constructor(message: string, body: Record<string, unknown> | null) {
    super(message);
    this.name = "ResetDemoError";
    this.body = body;
  }
}

export function ExecLedgerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ExecLedgerSnapshot>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  // Set the FIRST time (and only the first time) the ledger has never
  // successfully loaded — this is what gates children from ever mounting
  // over the `EMPTY` snapshot. `useExecLedger`'s own doc comment forbids a
  // silently-empty ledger from rendering as "no dashboards"; this is that
  // rule enforced at the provider that would otherwise do exactly that.
  const [firstLoadError, setFirstLoadError] = useState<string | null>(null);
  // Set when a POST-first-load refresh fails (always from a mutation's
  // `await refresh()`, since that mutation already wrote server-side). The
  // last good snapshot stays on screen; this is what says it might be stale.
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Note the `await` comes FIRST: nothing here sets state synchronously, which
  // is what keeps the mount effect below off React's cascading-render path
  // (`react-hooks/set-state-in-effect`).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/exec/v1/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
      setSnapshot((await res.json()) as ExecLedgerSnapshot);
      setLoaded(true);
      setFirstLoadError(null);
      setRefreshError(null);
    } catch (error) {
      console.error("[exec] ledger refresh failed", error);
      const message = error instanceof Error ? error.message : String(error);
      // Two very different situations share this catch. If the ledger has
      // NEVER loaded, there is no "last good snapshot" to fall back to — this
      // IS the outage, and it belongs on the loud first-load panel (also the
      // path the panel's own retry button re-enters). Otherwise, a mutation
      // already succeeded server-side; the honest message is that the write
      // happened but the view may not reflect it yet, surfaced as a
      // dismissible banner while the last good snapshot stays on screen.
      if (!loaded) {
        setFirstLoadError(message);
      } else {
        setRefreshError(`saved, but the view may be stale: ${message}`);
      }
    }
  }, [loaded]);

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
        // NOT `setLoaded(true)`: that used to wave the EMPTY snapshot through
        // to children, which renders as a plausible empty demo — the exact
        // state `useExecLedger`'s doc comment forbids, with only a console
        // line to say otherwise. Record the failure instead so the render
        // below can show a loud panel in place of children.
        if (!cancelled) {
          setFirstLoadError(
            error instanceof Error ? error.message : String(error),
          );
        }
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
      if (!res.ok) await throwWithBodyMessage("add block", res);
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
      if (!res.ok) await throwWithBodyMessage("remove block", res);
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
      if (!res.ok) await throwWithBodyMessage("move block", res);
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
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      // Every non-OK body except the 403 FORBIDDEN gate carries a `reset`
      // array, because the route's FIRST act after that gate is
      // `store.reset()` — so its presence is what tells this apart from a
      // refusal that touched nothing. `refresh()` never throws (it logs and
      // keeps the last good snapshot on a failed fetch), so calling it here
      // is a safe best-effort refresh of state that DID already change —
      // without it the screen would keep showing pre-reset data while the
      // store behind it had already been restored.
      if (Array.isArray(body?.reset)) await refresh();
      throw new ResetDemoError(`reset demo failed: ${res.status}`, body);
    }
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

  // A failed first load NEVER falls through to children over the `EMPTY`
  // snapshot — every page under this provider reads dashboards/metrics/packs
  // off `snapshot`, and that placeholder would render as "no data"
  // indistinguishable from a real empty demo state. Say so instead, loudly,
  // in place of the whole tree, with a way back in.
  if (firstLoadError) {
    return (
      <div
        data-testid="ledger-first-load-error"
        role="alert"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-negative bg-negative-soft p-8 text-center"
      >
        <p className="text-sm font-semibold text-negative">
          Could not load the exec ledger
        </p>
        <p className="max-w-md text-xs text-ink">{firstLoadError}</p>
        <button
          type="button"
          className="rounded-full border border-hairline bg-surface px-4 py-1.5 text-xs font-medium text-ink transition hover:bg-surface-muted"
          onClick={() => void refresh()}
        >
          Retry
        </button>
      </div>
    );
  }

  // Render nothing until the first load resolves — every page under this
  // provider reads dashboards/metrics/packs off `snapshot` and a placeholder
  // EMPTY snapshot would render as "no data" indistinguishably from a real
  // empty demo state.
  if (!loaded) return null;

  return (
    <ExecLedgerContext.Provider value={value}>
      {refreshError && (
        <div
          data-testid="ledger-refresh-error"
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-negative bg-negative-soft px-4 py-2 text-xs text-negative"
        >
          <span>{refreshError}</span>
          <button
            type="button"
            aria-label="Dismiss stale-view warning"
            className="rounded-full border border-hairline bg-surface px-2 py-0.5 text-ink-muted transition hover:bg-surface-muted hover:text-ink"
            onClick={() => setRefreshError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
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
