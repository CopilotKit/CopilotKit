"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { getPb, pbIsMisconfigured, PB_MISCONFIG_MESSAGE } from "../lib/pb";
import type { ConnectionStatus, StatusRow } from "../lib/live-status";
import {
  STATUS_LIST_FIELDS,
  FLEET_COMM_AGGREGATE_DIMENSIONS,
  upsertByKey,
} from "../lib/live-status";

// Back-compat alias: the connection-status union is owned by `live-status.ts`
// as `ConnectionStatus` (the single source of truth shared with resolveCell /
// the badge resolvers). This alias preserves the historical
// `LiveStatusConnection` name for any external importer; the members are
// re-exported by reference, not re-declared, so the two can never drift.
export type LiveStatusConnection = ConnectionStatus;

export interface UseLiveStatusResult {
  rows: StatusRow[];
  status: ConnectionStatus;
  /**
   * `true` when the live feed is flapping: the heartbeat has forced more than
   * `FLAPPING_THRESHOLD` reconnects within the trailing `FLAPPING_WINDOW_MS`
   * window. A flapping feed still reports `status: "live"` between drops (each
   * reconnect re-establishes), but the rapid churn means rows are repeatedly
   * stale-then-fresh — consumers surface a "degraded / reconnecting" hint
   * rather than a confident "live". This is a SEPARATE signal from
   * `ConnectionStatus`: a connection can be `live` AND `degraded` at once.
   */
  degraded: boolean;
  error: string | null;
}

const MAX_RECONNECT_ATTEMPTS = 3;
// PocketBase clamps `perPage` to 500 server-side regardless of what the client
// asks for, so 500 is the largest page the REST API will actually return. The
// `status` collection holds ~2455 rows across all probe dimensions (smoke,
// health, agent, e2e per-cell, d5/d6 per-feature, chat, tools, starter,
// image-drift, etc.), so the initial fetch spans ~5 pages. We fetch page 1
// alone, then — because `skipTotal` drops `totalPages` from the response (we no
// longer pay for the COUNT(*) query) — fan out the remaining pages in
// LENGTH-bounded concurrent waves (see fetchInitial): keep going until a page
// comes back shorter than `INITIAL_PAGE_SIZE`.
const INITIAL_PAGE_SIZE = 500;
// Size of each concurrent fan-out wave AFTER page 1. With `skipTotal` we can't
// learn the page count up front, so we issue pages in waves of this many at
// once and stop as soon as a wave yields a short (< INITIAL_PAGE_SIZE) page.
// This is purely a WIRE-EFFICIENCY knob — NOT load-bearing for correctness: the
// merge (see fetchInitial) is correct for ANY batch size, since it locates the
// first short page in a wave and appends up to AND INCLUDING it, dropping any
// over-fetched empty tail pages. The constant only trades request concurrency
// against wasted fetches past the end: kept at 2 so a wave over-fetches past
// the first short page by at most one (empty) request — and for the real
// ~5-page collection even that never happens (page 5 is short and ends its own
// wave). A larger batch only requests more empty pages on a short final page;
// it can never corrupt the merge.
const INITIAL_FANOUT_BATCH = 2;
// Flapping detector (A.4). We keep a sliding window of the timestamps at which
// the HEARTBEAT forced a reconnect; if more than FLAPPING_THRESHOLD of them
// fall inside the trailing FLAPPING_WINDOW_MS, the feed is flapping and
// `degraded` flips true. With a 30s heartbeat, a healthy feed produces ZERO
// reconnects in any window; a genuinely flapping feed (socket repeatedly
// dropping) produces one per heartbeat tick. Threshold 3 over a 5-minute
// window means "more than 3 heartbeat-driven reconnects in 5 minutes" — well
// clear of the zero a healthy feed sees, but reached quickly once the socket
// starts churning. `degraded` clears on its own as old timestamps age out of
// the window (no manual reset needed).
const FLAPPING_THRESHOLD = 3;
const FLAPPING_WINDOW_MS = 5 * 60_000;
// Sort key for the initial paged fetch. PocketBase's default order is
// `created DESC`, which is NOT stable as rows are inserted: a row created
// between two concurrent page reads shifts every later row down a slot, so a
// boundary row can drop off one page and reappear at the top of the next. We
// pin `sort: "id"` so all concurrent page requests share the SAME ordering and
// a stable collection paginates cleanly across the fan-out (no drop/duplicate
// at a boundary). This is NOT a growth-completeness guarantee — PocketBase
// `id` is a RANDOM 15-char string, not monotonic, so a row inserted mid-fetch
// sorts into a random position and can still shift a boundary. The initial
// fetch is therefore a best-effort consistent snapshot; rows created in the
// brief fetch→subscribe window are reconciled by the live SSE subscription.
const INITIAL_SORT = "id";
// Heartbeat interval for detecting silent SSE drops. PB's realtime client
// auto-reconnects internally but gives no explicit error callback; if the
// SSE socket dies and reconnect ultimately fails, record updates stop
// arriving with no surface signal. A cheap `getList(1,1)` ping is enough
// to confirm the REST endpoint is reachable.
const HEARTBEAT_INTERVAL_MS = 30_000;
// Reconnect backoff: 1s, 2s, 4s, capped at 8s (parity across retry chain).
const RECONNECT_BACKOFF_BASE_MS = 1000;
const RECONNECT_BACKOFF_MAX_MS = 8000;
// Coalesce SSE deltas that arrive within this window into a single React
// commit. PocketBase realtime fires the subscribe callback once per record;
// when the harness publishes many rows in quick succession (probe finishing
// dozens of services, initial-state burst on reconnect), unbuffered setRows
// calls force the page to re-render the matrix once per record. ~16ms is
// roughly one frame — short enough to feel "live" to operators, long enough
// to fold a burst of deltas into one render.
const SUBSCRIBE_FLUSH_INTERVAL_MS = 16;

/**
 * `true` when the supplemental comm-aggregate row (`full`) is STRICTLY older
 * than its projected bulk twin (`bulkRow`) — the freshness guard for the
 * cold-load merge in `fetchInitial` (CF8 F3).
 *
 * The supplemental fetch runs CONCURRENTLY with the bulk pages, so the bulk
 * copy of an aggregate row can be NEWER (the row's state changed between the
 * two reads). Replacing it with the supplemental snapshot would regress
 * `state`/`observed_at` to stale values until the row's next SSE delta —
 * which for slow-cadence aggregate rows can be a long time. "Fresher wins" is
 * judged on `observed_at`, the row's last-SEEN marker (it moves on every
 * producer tick, while `transitioned_at` only moves on state change — so it is
 * the strictly-later of the two and the right recency key; the staleness fold
 * in cell-model.ts keys off the same field).
 *
 * Tie/parse semantics, both deliberate:
 *   - EQUAL timestamps → NOT older → the supplemental row wins. It is the
 *     field-complete twin of the same snapshot (it carries `signal`, which the
 *     bulk projection drops), so preferring it is what makes the cold-load
 *     comm-error overlay visible at all (CF7-F3 #1).
 *   - UNPARSEABLE timestamp on either side → NOT older → supplemental wins.
 *     We only suppress the replace when the supplemental row is POSITIVELY
 *     known to be stale; an undecidable comparison falls back to the
 *     signal-bearing row, the same eventual-consistency posture as before
 *     (the SSE subscription reconciles either way).
 *
 * When the bulk row IS newer we keep it INTACT — we do NOT graft the older
 * supplemental `signal` onto it. A chimera row (newer core fields + stale
 * signal) is worse than a signal-less one: the reducer's no-op check
 * (`rowsAreNoop`, live-status.ts) compares signal PRESENCE only, so the next
 * SSE delta carrying the same core fields but the REAL current signal would be
 * swallowed as a no-op and the stale signal would persist indefinitely. A
 * signal-less bulk row instead makes that delta's `undefined → defined`
 * presence flip observable, so the live subscription restores `signal` safely.
 */
function supplementalRowIsOlder(full: StatusRow, bulkRow: StatusRow): boolean {
  // `Date.parse` yields NaN for a malformed value; NaN comparisons are false,
  // but we gate explicitly so the fallback direction is documented, not an
  // accident of IEEE semantics.
  const fullTs = Date.parse(full.observed_at);
  const bulkTs = Date.parse(bulkRow.observed_at);
  if (Number.isNaN(fullTs) || Number.isNaN(bulkTs)) return false;
  return fullTs < bulkTs;
}

/**
 * Subscribes to the `status` collection, scoped by `dimension`. Exposes
 * (rows, connection-status). Does NOT fall back to any cached bundle —
 * stale-green lies are worse than an offline banner (§5.3).
 */
export function useLiveStatus(dimension?: string): UseLiveStatusResult {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  // Flapping signal (A.4). SEPARATE from `status` — a feed can be `live`
  // (currently connected) yet `degraded` (churning). See UseLiveStatusResult.
  const [degraded, setDegraded] = useState(false);

  // Commit-phase mirror of the rows currently in React state. The SSE callback
  // runs OUTSIDE the setRows updater and has no synchronous access to committed
  // state, but it must resolve a keyless delete's stable identity by `id` →
  // `key` at buffer time. We keep this mirror in a ref updated by the
  // post-commit effect below (NOT inside a setRows updater body — that would be
  // an impure side effect that StrictMode's double-invoke / a discarded
  // concurrent render could leave diverged from the committed `rows`). The
  // flush is debounced ~16ms so the commit-phase effect has normally already
  // run by the time a keyless delete needs to resolve; for the brief
  // pre-commit window (and a row created+deleted within one flush) the
  // `pendingByKey` scan in the callback is the fallback.
  const rowsRef = useRef<StatusRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    // Fast-fail path for the build-time misconfig: no point hammering the
    // sentinel URL with retries. Surface a clear user-facing error to the
    // UI banner immediately so operators see the actual root cause rather
    // than a generic DNS failure.
    if (pbIsMisconfigured()) {
      // Clear any previously-cached rows so downstream consumers (resolveCell)
      // don't render stale-green lies behind an offline banner (spec §5.3).
      setRows([]);
      setStatus("error");
      setError(PB_MISCONFIG_MESSAGE);
      return;
    }

    const pb = getPb();
    let alive = true;
    let attempts = 0;
    let cancel: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnecting = false;
    // Per-row buffer for incoming SSE deltas. The latest event for a given
    // logical row supersedes earlier ones (last-write-wins during the same
    // flush window — multiple producers updating the same row within 16ms is
    // vanishingly rare and the latest one is always the intended state).
    // Keeping a Map keyed by the row's stable identity keeps the buffer
    // O(unique_rows_in_burst) rather than O(events_in_burst).
    //
    // CRITICAL INVARIANT: the Map slot is the row's STABLE identity — the
    // `key` whenever it is resolvable. An upsert always carries `key`. A delete
    // event legitimately carries no `dimension` and may carry only an `id` (no
    // `key`); for a keyless delete we resolve the row's `key` from the rows we
    // currently hold (the row is present iff it's being deleted) so the delete
    // collides into the SAME slot as any pending/future upsert for that row.
    // Without this, an upsert (slot=key) and an id-only delete (slot=id) would
    // occupy DIFFERENT slots and BOTH survive one 16ms flush, breaking the
    // per-row last-write-wins contract (an update→delete→update burst could net
    // to a deleted row the producer's latest event re-asserted, or vice-versa).
    // Only when no `key` is resolvable (the row isn't in state) do we fall back
    // to the `id` slot; the flush still matches such a delete by key OR id (A.5).
    type PendingOp =
      | { op: "upsert"; row: StatusRow }
      | { op: "delete"; key: string | undefined; id: string | undefined };
    const pendingByKey = new Map<string, PendingOp>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    // Sliding window of timestamps at which the HEARTBEAT forced a reconnect
    // (A.4 flapping detector). Pruned to the trailing FLAPPING_WINDOW_MS on
    // every record; `degraded` is recomputed from its size. We track only
    // heartbeat-driven reconnects (genuine socket churn), NOT the cold-start
    // connect or a dimension-change reconnect — those are not "flapping".
    const reconnectStamps: number[] = [];

    // Prune stamps that have aged out of the trailing FLAPPING_WINDOW_MS and
    // recompute `degraded` from what survives. This is the SINGLE source of the
    // `degraded` value and must be driven on a NON-failure cadence too — see
    // the call in heartbeat()'s success path. If it were only invoked on a
    // heartbeat FAILURE (as an earlier revision did), a feed that stopped
    // flapping would keep `degraded === true` forever because nothing pruned
    // the window once the failures stopped (the JSDoc on
    // UseLiveStatusResult.degraded promises it "clears on its own as old
    // timestamps age out"). `degraded` is true once MORE THAN
    // FLAPPING_THRESHOLD reconnects remain inside the window.
    function pruneAndRecomputeDegraded(): void {
      const cutoff = Date.now() - FLAPPING_WINDOW_MS;
      while (reconnectStamps.length > 0 && reconnectStamps[0]! < cutoff) {
        reconnectStamps.shift();
      }
      setDegraded(reconnectStamps.length > FLAPPING_THRESHOLD);
    }

    function recordHeartbeatReconnect(): void {
      reconnectStamps.push(Date.now());
      pruneAndRecomputeDegraded();
    }
    // Zombie-detection note: an earlier revision tracked
    // `lastRowUpdateAt` and force-reconnected if no SSE delta arrived
    // within 2× heartbeat interval. That produced a reconnect storm on
    // idle/quiet collections (no rows changing for minutes at a time is
    // normal), so it was removed. Today, subscription health is inferred
    // from the heartbeat REST probe — if REST works, we assume SSE does
    // too; if REST fails, we proactively reconnect. True REST-alive +
    // SSE-dead zombie detection would require an out-of-band ping PB
    // doesn't expose (C5 F3).

    // Server-side filter. `pb.filter()` quotes/escapes via placeholder so
    // the value is never interpolated raw, even though callers today pass
    // hard-coded dimensions. Defense in depth.
    const filter = dimension
      ? pb.filter("dimension = {:dim}", { dim: dimension })
      : "";

    // SUPPLEMENTAL comm-error aggregate filter (CF7-F3 #1). The bulk initial
    // fetch projects `signal` away (STATUS_LIST_FIELDS), but
    // `decodeCellCommError` (cell-model.ts) reads `row.signal` per cell at
    // render to derive the REQ-B unreachable/pending overlay — so on a cold
    // load every active overlay was invisible until an SSE delta happened to
    // re-deliver the row. We re-fetch ONLY the comm-error candidate AGGREGATE
    // rows WITH `signal`: the FLEET_COMM_AGGREGATE_DIMENSIONS dimensions
    // (`d6`/`d4`/`e2e-demos`/`d5-single-pill-e2e`), restricted to
    // integration-level aggregate keys (`key !~ "%/%"` — no `/<featureId>`
    // segment), which is where the harness mirrors comm errors. That is a few
    // rows per integration (~4 × #slugs), so the bulk projection's ~61%
    // payload win is preserved; the per-cell rows under the same dimensions
    // carry the heavy parity-diff signals and are deliberately NOT re-fetched
    // (a stale per-cell comm error is only ever a same/lower-severity
    // tie-break candidate against the aggregate mirror — see the
    // decodeCellCommError scan doc).
    //
    // The dimension literals come from our own `as const` list (never caller
    // input), so inline interpolation is safe; a caller-scoped `dimension` is
    // honored by narrowing to the MATCHED literal (scopes outside the
    // aggregate set skip the fetch entirely — their rows can't carry a
    // mirrored comm error the dashboard would read).
    const matchedCommDim =
      dimension === undefined
        ? undefined
        : FLEET_COMM_AGGREGATE_DIMENSIONS.find((d) => d === dimension);
    const commAggregateFilter: string | null =
      dimension === undefined
        ? `(${FLEET_COMM_AGGREGATE_DIMENSIONS.map(
            (d) => `dimension = "${d}"`,
          ).join(" || ")}) && key !~ "%/%"`
        : matchedCommDim !== undefined
          ? `dimension = "${matchedCommDim}" && key !~ "%/%"`
          : null;

    function teardownSubscription(): void {
      if (cancel) {
        try {
          cancel();
        } catch (err) {
          // Best-effort cleanup: the SDK's unsubscribe can reject if the
          // socket is already torn down, Node is shutting down, etc. We
          // don't want to re-throw here (that would crash the component on
          // unmount), but the silent `catch {}` that previously stood here
          // hid real SDK errors (e.g., an unsubscribe implementation bug)
          // from everyone. Debug-level log preserves the evidence without
          // polluting the default console.
          // eslint-disable-next-line no-console
          console.debug("[useLiveStatus] unsubscribe failed (best-effort)", {
            topic: dimension ?? "<all>",
            err,
          });
        }
        cancel = null;
      }
    }

    function clearHeartbeat(): void {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function clearReconnectTimer(): void {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function clearFlushTimer(): void {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingByKey.clear();
      // NOTE: the id→key resolution mirror (`rowsRef`) is NOT cleared here. It
      // tracks committed React state via the post-commit effect, so it follows
      // whatever `setRows` lands (a terminal error clears `rows` to [], and the
      // effect then empties `rowsRef`). A keyless delete buffered before that
      // commit lands simply falls back to its id slot (harmless — the flush
      // matches by key OR id), and the `pendingByKey` scan covers an in-window
      // create+delete. There is no per-subscription mirror state to reset.
    }

    function flushPending(): void {
      flushTimer = null;
      // Teardown / mid-reconnect guard (A.1): if the connection is gone
      // (`!alive`), torn down (`cancel === null`), or mid-reconnect
      // (`reconnecting`), a flush scheduled before the teardown must NOT land
      // its buffered deltas — they belong to a now-doomed subscription and
      // would either mutate post-unmount state or interleave with the
      // post-reconnect initial fetch. Drop the buffer and bail.
      if (!alive || reconnecting || cancel === null) {
        pendingByKey.clear();
        return;
      }
      if (pendingByKey.size === 0) return;
      const ops = Array.from(pendingByKey.values());
      pendingByKey.clear();
      setRows((prev) => {
        let next = prev;
        let mutated = false;
        for (const op of ops) {
          if (op.op === "delete") {
            // Match by key OR id: a PB delete event may deliver only the id
            // (no key), so we fall back to id when the key didn't resolve a
            // row (A.5).
            const idx = next.findIndex(
              (r) =>
                (op.key !== undefined && r.key === op.key) ||
                (op.id !== undefined && r.id === op.id),
            );
            if (idx === -1) continue;
            if (!mutated) {
              next = next.slice();
              mutated = true;
            }
            next.splice(idx, 1);
          } else {
            const candidate = upsertByKey(next, op.row);
            if (candidate !== next) {
              next = candidate;
              mutated = true;
            }
          }
        }
        // PURE updater: no side effects. The id→key resolution mirror
        // (`rowsRef`) is updated by the post-commit effect, NOT here — a
        // closure assignment inside this updater would diverge from committed
        // state under StrictMode double-invoke / a discarded concurrent render.
        return mutated ? next : prev;
      });
    }

    function scheduleFlush(): void {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(flushPending, SUBSCRIBE_FLUSH_INTERVAL_MS);
    }

    function startReconnect(reason: string, err?: unknown): void {
      // Idempotency guard: if we're already mid-reconnect (e.g. overlapping
      // heartbeat tick, onError callback), drop the redundant kickoff so we
      // don't fork parallel connect chains or reset `attempts` out from
      // under an in-flight retry (C5 F6).
      if (reconnecting) return;
      // Mark reconnecting BEFORE any async work so a concurrent heartbeat
      // tick can't slip in and double-dispatch `connect()`.
      reconnecting = true;
      // NOTE: we do NOT reset `attempts` here. Resetting on every reconnect
      // kickoff produced an infinite retry loop that bypassed
      // MAX_RECONNECT_ATTEMPTS — every heartbeat-triggered reconnect wiped
      // the counter before the previous chain exhausted it (C5 F4).
      // `attempts` is cleared to 0 only in connect()'s success path, which
      // is the true "fresh start" signal.
      setStatus("connecting");
      if (err !== undefined) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError(reason);
      }
      clearHeartbeat();
      clearReconnectTimer();
      // Drop any buffered deltas tied to the (now-doomed) subscription —
      // applying them after teardown would either land stale rows on the
      // freshly-cleared state on terminal error, or interleave with the
      // post-reconnect initial fetch and confuse rollup state.
      clearFlushTimer();
      teardownSubscription();
      // `connect()` chains its own setTimeout-based retries internally,
      // so `reconnecting` must stay `true` for the entire retry chain,
      // not just until the first `connect()` call resolves. `connect()`
      // clears the flag on terminal success AND terminal failure.
      void connect();
    }

    async function heartbeat(): Promise<void> {
      if (!alive || reconnecting) return;
      try {
        // `requestKey: null` for the same reason as fetchInitial: this ping
        // hits the SAME path (`/api/collections/status/records`), so the
        // SDK's default auto-key would let a heartbeat and an in-flight
        // initial/fan-out read cancel each other.
        await pb
          .collection("status")
          .getList(1, 1, { filter, requestKey: null });
      } catch (err) {
        if (!alive) return;
        // Record this heartbeat-driven reconnect in the flapping window (A.4)
        // BEFORE kicking the reconnect, so a feed that keeps dropping flips
        // `degraded` true once the churn exceeds FLAPPING_THRESHOLD. Only
        // heartbeat reconnects count — cold-start / dimension-change connects
        // are not "flapping".
        recordHeartbeatReconnect();
        // SSE socket is probably dead too — re-establish the whole
        // subscription.
        startReconnect("heartbeat failed", err);
        return;
      }
      // REST heartbeat succeeded. No silence-check / zombie-detection
      // to run here — see the comment at the top of the effect for why.
      // Prune the flapping window on this NON-failure cadence so a feed that
      // has stopped dropping returns `degraded` to false on its own as old
      // reconnect stamps age out — without waiting for another failure (A1).
      pruneAndRecomputeDegraded();
    }

    function startHeartbeat(): void {
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        void heartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Fetch the comm-error candidate AGGREGATE rows WITH `signal` (no
     * `fields` projection) — the narrow companion to the bulk projected
     * fetch; see the `commAggregateFilter` doc above (CF7-F3 #1). Returns
     * `[]` without a request when the hook's dimension scope cannot
     * intersect the aggregate set. Length-bounded serial pagination: the
     * result is ~4 rows per integration, so page 1 is essentially always the
     * only page — the loop is a correctness guard, not a hot path.
     */
    async function fetchCommAggregateRows(): Promise<StatusRow[]> {
      if (commAggregateFilter === null) return [];
      // `requestKey: null` for the same reason as the bulk fetch: this hits
      // the SAME path (`/api/collections/status/records`) concurrently with
      // the bulk pages, so the SDK's default auto-key would cancel one or
      // the other.
      const opts = {
        filter: commAggregateFilter,
        sort: INITIAL_SORT,
        skipTotal: true,
        requestKey: null,
      };
      const rows: StatusRow[] = [];
      let page = 1;
      for (;;) {
        const res = await pb
          .collection("status")
          .getList<StatusRow>(page, INITIAL_PAGE_SIZE, opts);
        rows.push(...res.items);
        if (res.items.length < INITIAL_PAGE_SIZE) break;
        page += 1;
      }
      return rows;
    }

    async function fetchInitial(): Promise<StatusRow[]> {
      // Best-effort consistent snapshot via a stable-sorted, LENGTH-bounded
      // CONCURRENT paged fetch.
      //
      // The `status` collection spans ~5 pages (PB clamps perPage to 500), so a
      // single `getFullList` paginates in N SERIAL round-trips — each page
      // awaited before the next — and blocks first paint for the full chain.
      // Instead:
      //
      //   1. Fetch page 1.
      //   2. While the last page came back FULL (== INITIAL_PAGE_SIZE, so there
      //      may be more), fan out the next wave of INITIAL_FANOUT_BATCH pages
      //      CONCURRENTLY via `Promise.all(...)`. Stop the moment a wave yields
      //      a SHORT page (< INITIAL_PAGE_SIZE) — that is the last page.
      //   3. Merge pages by ARRAY INDEX (page order), independent of which HTTP
      //      response resolves first.
      //
      // We paginate by LENGTH, not `totalPages`, because `skipTotal: true` (set
      // below) tells PocketBase to skip the COUNT(*) query — the response then
      // carries NO `totalItems`/`totalPages`. That count query is pure overhead
      // for a fetch that is only ever a best-effort snapshot (the SSE
      // subscription reconciles anything created mid-fetch), so we drop it.
      //
      // `fields: STATUS_LIST_FIELDS` projects every StatusRow field EXCEPT the
      // heavy `signal` blob (~61% of the payload), the dominant transfer-size
      // win for first paint; the SSE subscription still delivers full rows
      // (signal included) for every subsequent delta, and the SUPPLEMENTAL
      // comm-error aggregate fetch (kicked off below, CF7-F3 #1) restores
      // `signal` on the few aggregate rows the comm-error overlay reads at
      // render time.
      //
      // `sort: "id"` is forwarded to EVERY page request so all the concurrent
      // reads share the same ordering: for a STABLE collection that means no
      // boundary row is dropped or duplicated across the fan-out (PB's default
      // `created DESC` is NOT stable under inserts). This is a snapshot, NOT a
      // growth-completeness guarantee — PocketBase `id` is a RANDOM string, not
      // monotonic, so a row inserted in the brief fetch→subscribe window sorts
      // into a random position and is reconciled by the live SSE subscription
      // (which delivers all future deltas), not by this fetch.
      //
      // `requestKey: null` DISABLES the PocketBase SDK's auto-cancellation. By
      // default the SDK derives a request key from the HTTP method + path and
      // auto-cancels any in-flight request that shares it. Our fan-out fires
      // pages at the SAME path (`/api/collections/status/records`)
      // concurrently, so every page after the first would cancel its
      // predecessor — the cancelled promises reject and `Promise.all` rejects,
      // dropping the whole hook to OFFLINE. Opting out per-request lets all
      // concurrent same-path reads complete. Forwarded to page 1 too so it
      // can't be cancelled by the fan-out either.
      const listOpts = filter
        ? {
            filter,
            sort: INITIAL_SORT,
            fields: STATUS_LIST_FIELDS,
            skipTotal: true,
            requestKey: null,
          }
        : {
            sort: INITIAL_SORT,
            fields: STATUS_LIST_FIELDS,
            skipTotal: true,
            requestKey: null,
          };

      // Kick off the supplemental comm-error aggregate fetch (CF7-F3 #1)
      // CONCURRENTLY with the bulk pages — it is independent of the page
      // chain and its rows are merged in after the bulk completes. A no-op
      // (resolved []) when the dimension scope can't intersect the aggregate
      // set.
      const commAggregatePromise = fetchCommAggregateRows();
      const pages: StatusRow[][] = [];
      try {
        const first = await pb
          .collection("status")
          .getList<StatusRow>(1, INITIAL_PAGE_SIZE, listOpts);
        pages.push(first.items);
        // Page 1 short ⇒ single-page collection, no fan-out.
        let lastPageFull = first.items.length === INITIAL_PAGE_SIZE;
        let nextPage = 2;
        while (lastPageFull) {
          // Fan out one wave of consecutive pages CONCURRENTLY. `Promise.all`
          // preserves request (array-index) order regardless of resolution
          // order, so the merge stays deterministic page order.
          const wave: Promise<{ items: StatusRow[] }>[] = [];
          for (let i = 0; i < INITIAL_FANOUT_BATCH; i++) {
            const page = nextPage + i;
            wave.push(
              pb
                .collection("status")
                .getList<StatusRow>(page, INITIAL_PAGE_SIZE, listOpts),
            );
          }
          const waveResults = await Promise.all(wave);
          // Merge the wave in strict page (array-index) order, stopping at the
          // FIRST short page. This is correct for ANY INITIAL_FANOUT_BATCH, not
          // just 2: PocketBase pagination is monotonic, so once a page returns
          // fewer than INITIAL_PAGE_SIZE items it is the LAST page with data and
          // every page issued AFTER it in the same wave is past the end (empty).
          // We locate that boundary, append pages up to AND INCLUDING it, and
          // append nothing after — so no empty tail page is ever merged and no
          // real tail row is ever dropped, regardless of how many pages a wave
          // over-fetched past the end. (A larger batch only over-FETCHES extra
          // empty pages on the wire; it can never corrupt the merge. This guards
          // against silently reintroducing the #4504 over-fetch-past-end bug if
          // the constant is tuned.)
          const shortIdx = waveResults.findIndex(
            (result) => result.items.length < INITIAL_PAGE_SIZE,
          );
          const lastIdx = shortIdx === -1 ? waveResults.length - 1 : shortIdx;
          for (let i = 0; i <= lastIdx; i++) {
            pages.push(waveResults[i]!.items);
          }
          // The wave ended the collection iff it contained a short page.
          lastPageFull = shortIdx === -1;
          nextPage += INITIAL_FANOUT_BATCH;
        }
      } catch (err) {
        // The bulk fetch failed — connect() retries the WHOLE initial fetch,
        // supplemental included. Detach the in-flight supplemental promise so
        // its eventual rejection (the backend is likely down for it too)
        // can't surface as an unhandled rejection; its rows are useless
        // without the bulk rows anyway.
        commAggregatePromise.catch(() => {});
        throw err;
      }
      const bulk = pages.flat();
      // Merge the supplemental signal-bearing aggregate rows over their
      // projected bulk twins, BY KEY (CF7-F3 #1). A supplemental row replaces
      // the projected row in place (preserving the bulk's deterministic page
      // order) — UNLESS the bulk twin is strictly fresher (CF8 F3): the two
      // fetches run concurrently, so the bulk copy can carry a newer state
      // than the supplemental snapshot, and "fresher wins" must hold in both
      // directions (see `supplementalRowIsOlder` for the recency key, the
      // equal-timestamp preference for the signal-bearing row, and why the
      // newer bulk row is kept intact rather than grafted with the older
      // signal). An aggregate row the bulk snapshot didn't carry (created
      // between the two reads) is appended — the same eventual-consistency
      // posture as the SSE reconciliation. A supplemental FAILURE intentionally
      // propagates: a cold load that silently misses active comm-error
      // overlays is the exact bug this fetch exists to fix, so it retries
      // through the same connect() chain as the bulk fetch (fail loud, not
      // fail half-blind).
      const commAggregates = await commAggregatePromise;
      if (commAggregates.length === 0) return bulk;
      const fullByKey = new Map(commAggregates.map((r) => [r.key, r] as const));
      const merged = bulk.map((r) => {
        const full = fullByKey.get(r.key);
        if (full === undefined) return r;
        fullByKey.delete(r.key);
        // Freshness guard (CF8 F3): if the supplemental snapshot is STRICTLY
        // older than its bulk twin, the bulk row's core fields are newer —
        // keep it intact (signal-less) rather than regressing state/observed_at
        // or grafting a stale signal onto a newer row. See
        // `supplementalRowIsOlder` for tie/parse semantics and the chimera
        // rationale.
        if (supplementalRowIsOlder(full, r)) return r;
        return full;
      });
      for (const leftover of fullByKey.values()) {
        merged.push(leftover);
      }
      return merged;
    }

    async function connect(): Promise<void> {
      try {
        const initial = await fetchInitial();
        if (!alive) return;
        // The first time real data lands, every cell in the matrix has to
        // re-render: the empty-map → populated-map transition invalidates the
        // per-key memo checks on every cell, so this is a hundreds-of-cells
        // walk in one synchronous React commit. Flag it as a transition so
        // React 19 can yield to user input (scroll, click, keyboard) mid-walk
        // instead of blocking the main thread for the whole render. `setStatus`
        // stays URGENT so the "connecting → live" indicator flips immediately,
        // before the heavy commit lands — and so the loading-state guard in the
        // column tallies (connecting + empty map) releases as soon as data is
        // live. The initial rows come from `fetchInitial`'s stable-sorted
        // CONCURRENT paged fetch (page 1 + Promise.all over the remaining
        // pages, merged in strict page order). That is the real latency win —
        // the serial getFullList page chain blocked first paint. The merge
        // order is deterministic (page order, not resolution order); the fetch
        // is a best-effort consistent snapshot and the live SSE subscription
        // reconciles any rows created in the brief fetch→subscribe window. This
        // is where #4504's reverted resolution-order merge + early length
        // `break` was not safe.
        //
        // The id→key resolution mirror (`rowsRef`) is updated by the
        // post-commit effect after this `setRows(initial)` lands — not seeded
        // here. The initial fetch is wrapped in `startTransition`, so the
        // commit may be deferred; until it lands, a keyless delete that arrives
        // in the fetch→commit window falls back to its id slot OR resolves via
        // the `pendingByKey` scan (a brand-new row's pending upsert carries the
        // key). Both are correct, so no synchronous seed is needed.
        startTransition(() => {
          setRows(initial);
        });
        setStatus("live");
        setError(null);
        // Reset the reconnect counter on a SUCCESSFUL connection. This is
        // the only place `attempts` is cleared — resetting in
        // `startReconnect` would allow an infinite retry loop (C5 F4).
        attempts = 0;
        // Server-side filter on subscribe so PB doesn't stream unrelated
        // dimensions. We still defensively filter client-side below in case
        // a server missing filter support echoes everything.
        const unsub = await pb.collection("status").subscribe<StatusRow>(
          "*",
          (e) => {
            // Any sync throw from this callback must not kill the subscription
            // (and must not surface as an unhandled promise rejection in the
            // SDK internals). Swallow + log; the subscription itself stays up.
            try {
              if (!alive) return;
              const isDelete = e.action === "delete";
              // PB delete events deliver only a PARTIAL record (typically just
              // the id) — no `dimension`, often no `key`. The SDK still types
              // `e.record` as the full `StatusRow`, so read the identity fields
              // through a `Partial` view to honour what the wire actually
              // carries without an `as any`.
              const rec = e.record as Partial<StatusRow>;
              // Dimension guard: skip records for a dimension we don't own.
              // A DELETE is EXEMPT (A.5) — a delete has no `dimension`, so
              // requiring a match would wrongly drop every delete. We instead
              // reconcile a delete against rows we already hold (match by key
              // OR id at flush time), which is inherently dimension-scoped.
              if (!isDelete && dimension && rec.dimension !== dimension) return;
              // Stable identity for the per-row buffer slot. An upsert always
              // carries `key`. A delete may carry only `id`; resolve its `key`
              // from the rows we currently hold (id → key) so the delete lands
              // in the SAME slot as any pending/future upsert for that row and
              // per-row last-write-wins holds — without this, an upsert (slot=
              // key) and an id-only delete (slot=id) would occupy DIFFERENT
              // slots and BOTH apply in one flush. If no key is resolvable
              // (delete for a row we don't hold), fall back to `id`; the flush
              // still matches such a delete by key OR id (A.5). If BOTH are
              // missing there is nothing actionable, so skip it rather than
              // buffer an op under an `undefined` slot.
              let identity: string | undefined = rec.key;
              if (identity === undefined && isDelete && rec.id !== undefined) {
                // Resolve id → key from committed rows first (via the
                // commit-phase `rowsRef` mirror), then from any upsert already
                // buffered THIS window (a brand-new row created and deleted
                // inside one flush isn't in committed state yet, but its
                // pending upsert carries the key). Either source collapses the
                // delete into the upsert's slot.
                const deleteId = rec.id;
                let resolved = rowsRef.current.find(
                  (r) => r.id === deleteId,
                )?.key;
                if (resolved === undefined) {
                  for (const pending of pendingByKey.values()) {
                    if (
                      pending.op === "upsert" &&
                      pending.row.id === deleteId
                    ) {
                      resolved = pending.row.key;
                      break;
                    }
                  }
                }
                identity = resolved;
              }
              identity = identity ?? rec.id;
              if (identity === undefined) return;
              // Buffer the op rather than calling setRows directly. A burst
              // of deltas (probe finishes 50 services in the same SSE frame,
              // initial-state replay on reconnect, etc.) folds into a single
              // React commit on the next flush tick — without this, the
              // matrix re-renders once per record and freezes the main
              // thread on large bursts.
              if (isDelete) {
                pendingByKey.set(identity, {
                  op: "delete",
                  key: rec.key,
                  id: rec.id,
                });
              } else {
                pendingByKey.set(identity, { op: "upsert", row: e.record });
              }
              scheduleFlush();
            } catch (cbErr) {
              // eslint-disable-next-line no-console
              console.error("[useLiveStatus] subscribe callback threw", cbErr);
            }
          },
          filter ? { filter } : undefined,
        );
        // Cleanup-race guard (HF-C1): if the effect cleanup ran while
        // subscribe() was awaiting, `cancel` was never set and the
        // eventually-returned `unsub` would be leaked (orphan SSE
        // subscription that keeps receiving callbacks forever). Tear it
        // down right here and bail; callers already saw `alive=false` so
        // no further state transitions are needed.
        if (!alive) {
          try {
            await unsub();
          } catch (unsubErr) {
            // eslint-disable-next-line no-console
            console.debug(
              "[useLiveStatus] orphan unsubscribe failed (best-effort)",
              { topic: dimension ?? "<all>", err: unsubErr },
            );
          }
          reconnecting = false;
          return;
        }
        cancel = (): void => {
          void unsub();
        };
        startHeartbeat();
        // Terminal success: the reconnect chain is done.
        reconnecting = false;
      } catch (err) {
        if (!alive) {
          reconnecting = false;
          return;
        }
        attempts += 1;
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          // Clear cached rows on terminal error transition: downstream
          // consumers must not render stale-green lies behind the offline
          // banner (spec §5.3, F5.2). resolveCell's connection="error"
          // branch flips rollup to `error`, but per-badge tones would still
          // come from the stale rows if we left them in state.
          setRows([]);
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
          // A terminally-offline feed is OFFLINE, not flapping (C-F4a). Reset
          // the flapping signal: `degraded` is only ever LOWERED by
          // pruneAndRecomputeDegraded, which runs on the heartbeat SUCCESS
          // cadence — but clearHeartbeat() below stops the heartbeat, so a feed
          // that was flapping (degraded === true) and then exhausted
          // MAX_RECONNECT_ATTEMPTS into "error" would keep `degraded === true`
          // forever (nothing left to prune the window). A dead connection is
          // not "flapping", so we drop it to false here and discard the stale
          // reconnect-stamp window (it can never be pruned again, and a future
          // reconnect on a fresh connect() starts its own window).
          reconnectStamps.length = 0;
          setDegraded(false);
          // Defensive teardown of any surviving timers (A.1): no heartbeat or
          // buffered-delta flush may fire after the terminal error — they'd
          // ping a dead connection or land deltas on the cleared state. These
          // are normally already cleared by startReconnect, but the cold-start
          // failure path (initial connect never armed a heartbeat) and any
          // future caller reach this block too, so clear unconditionally.
          clearHeartbeat();
          clearFlushTimer();
          // Terminal failure: the reconnect chain has given up.
          reconnecting = false;
          return;
        }
        // Exponential backoff: 1s, 2s, 4s, capped at 8s. Stay
        // `reconnecting` across the entire retry chain so overlapping
        // heartbeat ticks can't fork a parallel reconnect. Track the
        // outstanding timer so a fresh startReconnect / teardown can
        // cancel it (C5 F6).
        const delay = Math.min(
          RECONNECT_BACKOFF_BASE_MS * 2 ** (attempts - 1),
          RECONNECT_BACKOFF_MAX_MS,
        );
        clearReconnectTimer();
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (alive) void connect();
          else reconnecting = false;
        }, delay);
      }
    }

    void connect();

    return () => {
      alive = false;
      clearHeartbeat();
      clearReconnectTimer();
      clearFlushTimer();
      teardownSubscription();
    };
  }, [dimension]);

  return { rows, status, degraded, error };
}
