"use client";
import { useEffect, useState } from "react";
import { pb, pbIsMisconfigured, PB_MISCONFIG_MESSAGE } from "../lib/pb";
import type { StatusRow } from "../lib/live-status";
import { upsertByKey } from "../lib/live-status";

export type LiveStatusConnection = "connecting" | "live" | "error";

export interface UseLiveStatusResult {
  rows: StatusRow[];
  status: LiveStatusConnection;
  error: string | null;
}

const MAX_RECONNECT_ATTEMPTS = 3;
// Hard cap on initial fetch size so the dashboard doesn't blow up on load if
// the `status` collection grows to thousands of rows. 500 comfortably covers
// the current surface (17 integrations * ~40 features * 4 dimensions ≈ 2.7k,
// bounded further by dimension filter) and keeps first-paint snappy.
// Implemented via a paginated `getList` loop (NOT `getFullList({ batch })` —
// pb's `batch` is per-request page size, not an overall cap).
const INITIAL_CAP = 500;
const INITIAL_PAGE_SIZE = 200;
// Heartbeat interval for detecting silent SSE drops. PB's realtime client
// auto-reconnects internally but gives no explicit error callback; if the
// SSE socket dies and reconnect ultimately fails, record updates stop
// arriving with no surface signal. A cheap `getList(1,1)` ping is enough
// to confirm the REST endpoint is reachable.
const HEARTBEAT_INTERVAL_MS = 30_000;
// Reconnect backoff: 1s, 2s, 4s, capped at 8s (parity across retry chain).
const RECONNECT_BACKOFF_BASE_MS = 1000;
const RECONNECT_BACKOFF_MAX_MS = 8000;

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
    if (pbIsMisconfigured) {
      // Clear any previously-cached rows so downstream consumers (resolveCell)
      // don't render stale-green lies behind an offline banner (spec §5.3).
      setRows([]);
      setStatus("error");
      setError(PB_MISCONFIG_MESSAGE);
      return;
    }

    let alive = true;
    let attempts = 0;
    let cancel: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnecting = false;
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
          console.debug(
            "[useLiveStatus] unsubscribe failed (best-effort)",
            { topic: dimension ?? "<all>", err },
          );
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
      // Paginated fetch with a hard total cap. `getFullList({batch})`
      // would keep pulling every page of matching rows; we instead loop
      // `getList` and break once we hit INITIAL_CAP.
      const collected: StatusRow[] = [];
      let page = 1;
      while (collected.length < INITIAL_CAP) {
        const remaining = INITIAL_CAP - collected.length;
        const perPage = Math.min(INITIAL_PAGE_SIZE, remaining);
        const resp = await pb
          .collection("status")
          .getList<StatusRow>(page, perPage, { filter });
        if (!resp.items || resp.items.length === 0) break;
        collected.push(...resp.items);
        if (collected.length >= resp.totalItems) break;
        page += 1;
      }
      return collected;
    }

    async function connect(): Promise<void> {
      try {
        const initial = await fetchInitial();
        if (!alive) return;
        setRows(initial);
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
              if (e.action === "delete") {
                setRows((prev) => prev.filter((r) => r.key !== e.record.key));
              } else {
                setRows((prev) => upsertByKey(prev, e.record));
              }
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
      teardownSubscription();
    };
  }, [dimension]);

  return { rows, status, error };
}
