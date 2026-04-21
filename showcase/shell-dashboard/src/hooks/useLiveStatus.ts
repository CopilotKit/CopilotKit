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
// If heartbeat REST succeeds but no SSE record update has been observed
// for this long, assume the subscription is a zombie and force-reconnect.
// 2× heartbeat interval is the conventional "missed two beats" rule.
const STREAM_SILENCE_LIMIT_MS = HEARTBEAT_INTERVAL_MS * 2;

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
      setStatus("error");
      setError(PB_MISCONFIG_MESSAGE);
      return;
    }

    let alive = true;
    let attempts = 0;
    let cancel: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnecting = false;
    // Wall-clock of the last SSE record update observed. Used to detect
    // silent mid-stream drops: REST (heartbeat) still reachable while the
    // subscription has silently died.
    let lastRowUpdateAt = Date.now();

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
        } catch {
          // swallow: best-effort cleanup
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

    function startReconnect(reason: string, err?: unknown): void {
      // Mark reconnecting BEFORE any async work so a concurrent heartbeat
      // tick can't slip in and double-dispatch `connect()`.
      reconnecting = true;
      attempts = 0;
      setStatus("connecting");
      if (err !== undefined) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError(reason);
      }
      clearHeartbeat();
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
        // subscription. Reset attempts so the backoff starts fresh.
        startReconnect("heartbeat failed", err);
        return;
      }
      // REST heartbeat passed. Check for silent SSE death: if we're
      // subscribed but haven't seen any record update in 2× heartbeat
      // intervals, the stream is a zombie — tear it down + reconnect.
      if (
        cancel !== null &&
        Date.now() - lastRowUpdateAt > STREAM_SILENCE_LIMIT_MS
      ) {
        startReconnect("sse silent beyond stream-silence limit");
      }
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
        lastRowUpdateAt = Date.now();
        // Reset the reconnect counter on a successful connection so a
        // later drop (detected via heartbeat) gets a fresh 3-attempt budget.
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
              lastRowUpdateAt = Date.now();
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
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
          // Terminal failure: the reconnect chain has given up.
          reconnecting = false;
          return;
        }
        // Exponential backoff: 1s, 2s, 4s. Stay `reconnecting` across the
        // entire retry chain so overlapping heartbeat ticks can't fork a
        // parallel reconnect.
        const delay = Math.min(1000 * 2 ** (attempts - 1), 8000);
        setTimeout(() => {
          if (alive) void connect();
          else reconnecting = false;
        }, delay);
      }
    }

    void connect();

    return () => {
      alive = false;
      clearHeartbeat();
      teardownSubscription();
    };
  }, [dimension]);

  return { rows, status, error };
}
