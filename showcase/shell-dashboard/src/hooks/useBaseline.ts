"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { pb, pbIsMisconfigured, PB_MISCONFIG_MESSAGE } from "../lib/pb";
import type {
  BaselineCell,
  BaselineStatus,
  BaselineTag,
} from "../lib/baseline-types";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type BaselineConnection = "connecting" | "live" | "error";

export interface UseBaselineResult {
  cells: Map<string, BaselineCell>;
  status: BaselineConnection;
  error: string | null;
  updateCell: (
    key: string,
    status: BaselineStatus,
    tags: BaselineTag[],
  ) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

// Baseline has ~825 records — fetch in a single request to avoid
// sequential round-trip latency (5 × 200 = 5 round trips to Railway PB).
const PAGE_SIZE = 1000;
const MAX_PAGES = 2;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BACKOFF_BASE_MS = 1000;
const RECONNECT_BACKOFF_MAX_MS = 8000;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Subscribes to the `baseline` collection. Returns a Map of
 * BaselineCell keyed by `cell.key`, connection status, and an
 * optimistic `updateCell` function for inline edits.
 *
 * Follows the same paginated-fetch + SSE subscribe + exponential
 * backoff pattern as `useLiveStatus`.
 */
export function useBaseline(): UseBaselineResult {
  const [cells, setCells] = useState<Map<string, BaselineCell>>(new Map());
  const [status, setStatus] = useState<BaselineConnection>("connecting");
  const [error, setError] = useState<string | null>(null);

  // Ref to the current cells map so updateCell always sees latest state
  // without needing cells in its dependency array.
  const cellsRef = useRef<Map<string, BaselineCell>>(cells);
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  useEffect(() => {
    if (pbIsMisconfigured) {
      setCells(new Map());
      setStatus("error");
      setError(PB_MISCONFIG_MESSAGE);
      return;
    }

    let alive = true;
    let attempts = 0;
    let cancel: (() => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnecting = false;

    function teardownSubscription(): void {
      if (cancel) {
        try {
          cancel();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.debug("[useBaseline] unsubscribe failed (best-effort)", {
            err,
          });
        }
        cancel = null;
      }
    }

    function clearReconnectTimer(): void {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function startReconnect(reason: string, err?: unknown): void {
      if (reconnecting) return;
      reconnecting = true;
      setStatus("connecting");
      if (err !== undefined) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError(reason);
      }
      clearReconnectTimer();
      teardownSubscription();
      void connect();
    }

    async function fetchInitial(): Promise<Map<string, BaselineCell>> {
      // getFullList auto-paginates internally — single call, no manual loop.
      const items = await pb
        .collection("baseline")
        .getFullList<BaselineCell>({ batch: 1000 });
      const result = new Map<string, BaselineCell>();
      for (const item of items) {
        result.set(item.key, item);
      }
      return result;
    }

    async function connect(): Promise<void> {
      try {
        const initial = await fetchInitial();
        if (!alive) return;
        setCells(initial);
        setStatus("live");
        setError(null);
        attempts = 0;

        // Batch SSE updates to avoid per-event re-renders (825 records
        // seeding = 825 individual SSE events = 825 Map clones + grid
        // re-renders without batching). Buffer events and flush every 100ms.
        const sseBuf: Array<{ action: string; record: BaselineCell }> = [];
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        function flushSseBuf() {
          flushTimer = null;
          if (sseBuf.length === 0 || !alive) return;
          const batch = sseBuf.splice(0);
          setCells((prev) => {
            const next = new Map(prev);
            for (const evt of batch) {
              if (evt.action === "delete") {
                next.delete(evt.record.key);
              } else {
                next.set(evt.record.key, evt.record);
              }
            }
            return next;
          });
        }

        const unsub = await pb
          .collection("baseline")
          .subscribe<BaselineCell>("*", (e) => {
            try {
              if (!alive) return;
              sseBuf.push({ action: e.action, record: e.record });
              if (!flushTimer) {
                flushTimer = setTimeout(flushSseBuf, 100);
              }
            } catch (cbErr) {
              // eslint-disable-next-line no-console
              console.error("[useBaseline] subscribe callback threw", cbErr);
            }
          });

        if (!alive) {
          try {
            await unsub();
          } catch (unsubErr) {
            // eslint-disable-next-line no-console
            console.debug(
              "[useBaseline] orphan unsubscribe failed (best-effort)",
              { err: unsubErr },
            );
          }
          reconnecting = false;
          return;
        }
        cancel = (): void => {
          void unsub();
        };
        reconnecting = false;
      } catch (err) {
        if (!alive) {
          reconnecting = false;
          return;
        }
        attempts += 1;
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          setCells(new Map());
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
          reconnecting = false;
          return;
        }
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
      clearReconnectTimer();
      teardownSubscription();
    };
  }, []);

  const updateCell = useCallback(
    async (
      key: string,
      newStatus: BaselineStatus,
      newTags: BaselineTag[],
    ): Promise<void> => {
      const current = cellsRef.current.get(key);
      if (!current) {
        throw new Error(`No baseline cell found for key "${key}"`);
      }

      const previousCell = { ...current };
      const now = new Date().toISOString();

      // Optimistic update
      const optimistic: BaselineCell = {
        ...current,
        status: newStatus,
        tags: newTags,
        updated_at: now,
        updated_by: "dashboard",
      };
      setCells((prev) => {
        const next = new Map(prev);
        next.set(key, optimistic);
        return next;
      });

      try {
        await pb.collection("baseline").update(current.id, {
          status: newStatus,
          tags: newTags,
          updated_at: now,
          updated_by: "dashboard",
        });
      } catch (err) {
        // Revert optimistic update
        setCells((prev) => {
          const next = new Map(prev);
          next.set(key, previousCell);
          return next;
        });
        throw err;
      }
    },
    [],
  );

  return { cells, status, error, updateCell };
}
