"use client";
import { startTransition, useEffect, useState } from "react";
import { getPb, pbIsMisconfigured, PB_MISCONFIG_MESSAGE } from "../lib/pb";
import type { StatusRow } from "../lib/live-status";
import { upsertByKey } from "../lib/live-status";

export type LiveStatusConnection = "connecting" | "live" | "error";

export interface UseLiveStatusResult {
  rows: StatusRow[];
  status: LiveStatusConnection;
  error: string | null;
}

const MAX_RECONNECT_ATTEMPTS = 3;
// PocketBase clamps `perPage` to 500 server-side regardless of what the client
// asks for, so 500 is the largest page the REST API will actually return. The
// `status` collection holds ~2455 rows across all probe dimensions (smoke,
// health, agent, e2e per-cell, d5/d6 per-feature, chat, tools, starter,
// image-drift, etc.), so the initial fetch spans ~5 pages. We fetch page 1 to
// learn `totalPages`, then fan out pages 2..N CONCURRENTLY (see fetchInitial).
const INITIAL_PAGE_SIZE = 500;
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
 * Subscribes to the `status` collection, scoped by `dimension`. Exposes
 * (rows, connection-status). Does NOT fall back to any cached bundle —
 * stale-green lies are worse than an offline banner (§5.3).
 */
export function useLiveStatus(dimension?: string): UseLiveStatusResult {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [status, setStatus] = useState<LiveStatusConnection>("connecting");
  const [error, setError] = useState<string | null>(null);

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
    // Per-key buffer for incoming SSE deltas. The latest event for a given
    // key supersedes earlier ones (last-write-wins on a single key during
    // the same flush window — multiple producers updating the same row
    // within 16ms is vanishingly rare and the latest one is always the
    // intended state). Keeping a Map keyed by `record.key` keeps the
    // buffer O(unique_keys_in_burst) rather than O(events_in_burst).
    type PendingOp = { op: "upsert"; row: StatusRow } | { op: "delete" };
    const pendingByKey = new Map<string, PendingOp>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
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
    }

    function flushPending(): void {
      flushTimer = null;
      if (!alive || pendingByKey.size === 0) return;
      const ops = Array.from(pendingByKey);
      pendingByKey.clear();
      setRows((prev) => {
        let next = prev;
        let mutated = false;
        for (const [key, op] of ops) {
          if (op.op === "delete") {
            const idx = next.findIndex((r) => r.key === key);
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
        await pb.collection("status").getList(1, 1, { filter });
      } catch (err) {
        if (!alive) return;
        // SSE socket is probably dead too — re-establish the whole
        // subscription.
        startReconnect("heartbeat failed", err);
        return;
      }
      // REST heartbeat succeeded. No silence-check / zombie-detection
      // to run here — see the comment at the top of the effect for why.
    }

    function startHeartbeat(): void {
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        void heartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    }

    async function fetchInitial(): Promise<StatusRow[]> {
      // Best-effort consistent snapshot via a stable-sorted CONCURRENT paged
      // fetch.
      //
      // The `status` collection spans ~5 pages (PB clamps perPage to 500), so a
      // single `getFullList` paginates in N SERIAL round-trips — each page
      // awaited before the next — and blocks first paint for the full chain.
      // Instead:
      //
      //   1. Fetch page 1, which also reports `totalPages`.
      //   2. If there is more than one page, fan out pages 2..totalPages and
      //      `await Promise.all(...)` — all in flight at once.
      //   3. Merge `[first, ...rest]` by ARRAY INDEX (page order), independent
      //      of which HTTP response resolves first.
      //
      // `sort: "id"` is forwarded to EVERY page request so all the concurrent
      // reads share the same ordering: for a STABLE collection that means no
      // boundary row is dropped or duplicated across the fan-out (PB's default
      // `created DESC` is NOT stable under inserts). This is a snapshot, NOT a
      // growth-completeness guarantee — PocketBase `id` is a RANDOM string, not
      // monotonic, so a row inserted in the brief fetch→subscribe window sorts
      // into a random position and is reconciled by the live SSE subscription
      // (which delivers all future deltas), not by this fetch.
      const listOpts = filter
        ? { filter, sort: INITIAL_SORT }
        : { sort: INITIAL_SORT };
      const first = await pb
        .collection("status")
        .getList<StatusRow>(1, INITIAL_PAGE_SIZE, listOpts);
      if (first.totalPages <= 1) {
        return first.items;
      }
      // Fan out the remaining pages concurrently. `Promise.all` preserves
      // request (array-index) order regardless of resolution order, so the
      // merge below is deterministic page order — not resolution order.
      const restRequests: Promise<{ items: StatusRow[] }>[] = [];
      for (let page = 2; page <= first.totalPages; page++) {
        restRequests.push(
          pb
            .collection("status")
            .getList<StatusRow>(page, INITIAL_PAGE_SIZE, listOpts),
        );
      }
      const rest = await Promise.all(restRequests);
      return [first, ...rest].flatMap((r) => r.items);
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
              if (dimension && e.record.dimension !== dimension) return;
              // Buffer the op rather than calling setRows directly. A burst
              // of deltas (probe finishes 50 services in the same SSE frame,
              // initial-state replay on reconnect, etc.) folds into a single
              // React commit on the next flush tick — without this, the
              // matrix re-renders once per record and freezes the main
              // thread on large bursts.
              if (e.action === "delete") {
                pendingByKey.set(e.record.key, { op: "delete" });
              } else {
                pendingByKey.set(e.record.key, { op: "upsert", row: e.record });
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

  return { rows, status, error };
}
