"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
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
  | {
      status: number;
      /**
       * ⚠️ THE DISCRIMINATOR, and the only one. Neither `status === 200` nor
       * `"pack" in outcome` can carry it: `status`'s other arm is the general
       * `number`, which overlaps `200`, and `pack` is ABSENT from a publish
       * whose 2xx body would not parse — a pack that IS written. Keying
       * success on the pack's presence read exactly that case as a refusal,
       * so the card printed "Publish refused: publish pack succeeded…" over a
       * published pack and the agent's retry filed a duplicate. Ask whether
       * it published; never whether the receipt arrived.
       */
      published: true;
      /** The published pack — absent only when its 2xx body was unreadable. */
      pack?: BoardPack;
      /**
       * Why this publish has no `pack`, in the caller's words to relay. Set
       * only on that arm, so `note` being present IS "the write landed, the
       * receipt did not".
       */
      note?: string;
      error?: never;
    }
  | {
      status: number;
      published?: false;
      pack?: never;
      note?: never;
      error: string;
      /**
       * The refusal's own human sentence, when the route sent one. Beside
       * `error` rather than in place of it: the CODE is what the agent reads
       * (beat 6's teach loop turns on the literal `UNEXPLAINED_VARIANCE`),
       * the MESSAGE is what the room reads. `EMPTY_DASHBOARD` is why this is
       * not optional-in-practice — `tools.tsx`'s `REFUSAL_PHRASES` has no
       * wording of its own for that code, so the store's sentence is its
       * whole explanation. `BAD_COUNTERSIGN` still arrives with neither this
       * nor `breaches`.
       */
      message?: string;
      breaches?: Exception[];
    };

interface ExecLedgerContextValue {
  snapshot: ExecLedgerSnapshot;
  /**
   * Re-fetch after a mutation. Every write path calls this. NEVER rejects —
   * failures become the provider's own first-load panel or stale-view banner,
   * so awaiting this is not confirmation that the view is current. See the
   * implementation's doc comment.
   */
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
 * Throws a mutation's failure with the SERVER's message, not just its status.
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
 * The narratives route uses the same envelope for the same reason — its 400
 * `message` is the field-specific "Period must be \"YYYY-MM\"" or "Narrative
 * body cannot be empty", and beat 6's filing form (`pages/board-packs.tsx`)
 * renders the thrown string as the form's note. It deliberately does NOT
 * enumerate the accepted narrative codes; forwarding its `message` forwards
 * only what that route chose to say.
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
 * One block id, as a single URL path SEGMENT.
 *
 * Ids are strings the store hands out and `render_metric_block` relays, not a
 * closed vocabulary this client validates — interpolated raw, an id carrying a
 * `/` grows the URL an extra segment and one carrying a `#` truncates it into
 * a fragment, so the DELETE lands on a route nobody wrote (or, worse, on a
 * different block). `dashboardId` needs no such treatment: it is the
 * `DashboardId` union, `"ceo" | "cfo"`.
 */
function blockPath(blockId: string): string {
  return encodeURIComponent(blockId);
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
  // True while a `refresh` is in flight. Exists so a retry that ends in the
  // BYTE-IDENTICAL error string it ended in last time still repaints — see
  // `refresh`'s doc comment.
  const [refreshing, setRefreshing] = useState(false);
  // `loaded` again, as a ref, because `refresh` needs to read it at CATCH
  // time rather than at bind time. Reading the state variable instead put
  // `loaded` in the callback's dependency list, which re-created `refresh`
  // (and with it every mutation and the whole context value) the moment the
  // first load landed — and, worse, let a refresh that STARTED before that
  // first load report its late failure to the first-load panel off the
  // `false` it captured, blowing away a tree that had since mounted.
  const loadedRef = useRef(false);

  /**
   * Re-fetch the ledger after a mutation, or as the first-load panel's retry.
   *
   * NEVER rejects. Every failure is caught here and turned into on-screen
   * state — the loud first-load panel when no snapshot has ever landed, the
   * dismissible "may be stale" banner once one has. So `await refresh()`
   * tells a caller NOTHING about whether the re-read worked, and callers must
   * not treat it as confirmation: a mutation's own success or failure comes
   * from ITS response, and the staleness of the view that follows is this
   * provider's story to tell, not the caller's. (That is deliberate — a write
   * that succeeded must not be reported as failed just because the re-read
   * after it didn't.)
   *
   * `refreshing` flips SYNCHRONOUSLY, before the first `await`, so that every
   * invocation produces an observable state transition: React bails out of a
   * re-render that sets state to the value it already holds, so re-setting an
   * identical `firstLoadError` repainted nothing and the panel's Retry button
   * read as dead. The cost of that synchronous setState is that `refresh`
   * must never be called from an effect BODY
   * (`react-hooks/set-state-in-effect`) — which is why the mount effect below
   * inlines its own fetch instead of calling this.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/exec/v1/ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`ledger fetch failed: ${res.status}`);
      setSnapshot((await res.json()) as ExecLedgerSnapshot);
      loadedRef.current = true;
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
      if (!loadedRef.current) {
        setFirstLoadError(message);
      } else {
        setRefreshError(`saved, but the view may be stale: ${message}`);
      }
    } finally {
      setRefreshing(false);
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
        // Both, in step — `refresh`'s catch reads the ref (see above) and
        // would keep routing failures to the first-load panel without it.
        loadedRef.current = true;
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
        `/api/exec/v1/dashboards/${dashboardId}/blocks/${blockPath(blockId)}`,
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
        `/api/exec/v1/dashboards/${dashboardId}/blocks/${blockPath(blockId)}`,
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
      // Same envelope, same reason as the block mutations: this route's 400
      // carries the field-specific `message` (and `issues`) that says WHICH
      // field was wrong, and the filing form renders the thrown string. A
      // bare status put "file narrative failed: 400" on beat 6's form with
      // nothing to act on.
      //
      // Gated on `res.ok`, like every sibling mutation above — the route
      // answers 201 today, and insisting on that ONE code would turn a route
      // that later answers 200 into "file narrative failed: 200" over a
      // filing that worked.
      if (!res.ok) await throwWithBodyMessage("file narrative", res);
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
        // `.catch(() => null)`, not a bare `res.json()`: a 500 from the
        // framework or a proxy in front of it is an HTML page, and parsing it
        // rejected with a `SyntaxError` — a REJECTION, which is precisely
        // what this function's contract says it does not produce, and which
        // the HITL publish card (`tools.tsx`'s `onSubmit`) has no arm for.
        const body = (await res.json().catch(() => null)) as {
          error?: unknown;
          message?: unknown;
          breaches?: unknown;
        } | null;
        return {
          status: res.status,
          // Validated, not cast. `tools.tsx` compares this against the
          // literal codes `BAD_COUNTERSIGN`/`UNEXPLAINED_VARIANCE` and
          // otherwise forwards it to the agent, so an `undefined` off a body
          // that had no `error` settled the card with nothing to say. Any
          // shape other than a string becomes a message that at least names
          // the status.
          error:
            typeof body?.error === "string"
              ? body.error
              : `publish pack failed: ${res.status}`,
          // Guarded the same way `error` is, and for the same reason: the
          // body is parsed, never validated. A non-string (or blank)
          // `message` is treated as ABSENT so the publish card falls back to
          // its own phrasing rather than printing "undefined" at the climax
          // of the demo. The key is omitted entirely when there is none —
          // `BAD_COUNTERSIGN`'s `{ error }` must stay `{ error }`.
          ...(typeof body?.message === "string" && body.message.trim().length
            ? { message: body.message.trim() }
            : {}),
          ...(Array.isArray(body?.breaches)
            ? { breaches: body.breaches as Exception[] }
            : {}),
        };
      }
      const pack = (await res.json().catch(() => null)) as BoardPack | null;
      // The pack IS published at this point whether or not its body parsed,
      // so the snapshot's `packs` is behind either way.
      await refresh();
      if (!pack) {
        // A LOST RECEIPT, NOT A FAILED PUBLISH. This arm used to return the
        // failure shape, which the card read as a refusal — so a pack that was
        // written got "Publish refused" on screen, and the agent, reading the
        // same settle, published a second one. The honest answer is the
        // publish plus the caveat that this view may not show it yet.
        return {
          status: res.status,
          published: true,
          note: `The pack published, but the ledger returned an unreadable receipt (${res.status}), so this view may be stale.`,
        };
      }
      return { status: res.status, published: true, pack };
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
      // Refresh unless the response PROVES nothing changed. The route's only
      // exit BEFORE `store.reset()` is the 403 FORBIDDEN gate; every later
      // failure leaves the store already restored while the screen still
      // shows pre-reset data. That includes an unhandled throw mid-route,
      // which answers with no JSON body at all — so the earlier guard here,
      // keyed on the 502 body's `reset` array, silently skipped exactly the
      // case with no body to key on. `refresh()` never throws (it logs and
      // keeps the last good snapshot on a failed fetch), so best-effort
      // refetching a failure that turns out to have changed nothing costs one
      // wasted GET and nothing else.
      //
      // KNOWN GAP, elsewhere: `handleReset` in `layout.tsx` still picks its
      // "data was reset, memory seeding failed" wording off
      // `Array.isArray(err.body?.reset)`, so a bodiless 500 alerts with the
      // bare "Reset failed" even though the store did reset and this
      // refreshed.
      const untouched = res.status === 403 && body?.error === "FORBIDDEN";
      if (!untouched) await refresh();
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
        {/*
          `aria-busy`/`disabled`/the label are all driven off `refreshing`
          because a retry that fails the SAME way as the last one sets an
          identical `firstLoadError` — React bails out, nothing repaints, and
          the operator concludes the button is broken. The in-flight state is
          what makes every click land visibly, whatever it ends in.
        */}
        <button
          type="button"
          data-testid="ledger-retry"
          disabled={refreshing}
          aria-busy={refreshing}
          className="rounded-full border border-hairline bg-surface px-4 py-1.5 text-xs font-medium text-ink transition hover:bg-surface-muted disabled:opacity-60"
          onClick={() => void refresh()}
        >
          {refreshing ? "Retrying…" : "Retry"}
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
