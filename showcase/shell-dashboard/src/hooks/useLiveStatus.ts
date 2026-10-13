"use client";
import { startTransition, useEffect, useRef, useState } from "react";
import { getPb, pbIsMisconfigured, PB_MISCONFIG_MESSAGE } from "../lib/pb";
import type { ConnectionStatus, StatusRow } from "../lib/live-status";
import {
  STATUS_LIST_FIELDS,
  FLEET_COMM_AGGREGATE_DIMENSIONS,
  upsertByKey,
} from "../lib/live-status";

// Compatibility alias for callers using the previous connection-status type name.
export type LiveStatusConnection = ConnectionStatus;

export interface UseLiveStatusResult {
  rows: StatusRow[];
  status: ConnectionStatus;
  /**
   * True when heartbeat failures exceed FLAPPING_THRESHOLD in FLAPPING_WINDOW_MS.
   * Independent of status: a reconnected feed can be live while still degraded.
   */
  degraded: boolean;
  error: string | null;
}

const MAX_RECONNECT_ATTEMPTS = 3;
// PocketBase returns at most 500 rows per page. Both initial reads use this size.
// Dated payload and timing measurements are kept in the internal measurement record:
// https://app.notion.com/p/3f13aa38185281248901eedbec5afc35
const INITIAL_PAGE_SIZE = 500;
// After page 1, read two pages concurrently. Retain results in page order and
// stop at the first short page; a wave may request one unnecessary tail page.
const INITIAL_FANOUT_BATCH = 2;
// Bounds each initial read to 10,000 retained rows. A full final page triggers
// one lookahead request to determine whether more rows remain.
// Bulk truncation fails the load; supplemental truncation keeps partial signal
// data and warns. See the two callers of fetchStatusPages for these policies.
export const MAX_INITIAL_FETCH_PAGES = 20;
// Supplemental rows replace or extend the bulk result, so they need every
// StatusRow field, not just key and signal. Derive the projection from the bulk
// fields to keep both reads aligned while excluding unrelated database metadata.
const STATUS_SIGNAL_FIELDS = `${STATUS_LIST_FIELDS},signal`;
// More than three heartbeat-driven reconnects within five minutes marks the
// feed degraded. Successful heartbeats let old failures age out of the window.
const FLAPPING_THRESHOLD = 3;
const FLAPPING_WINDOW_MS = 5 * 60_000;
// Use the same ordering for every page. Inserts can still shift page boundaries;
// this is not an atomic snapshot, and subscribing afterward can miss intervening
// changes until those rows receive another live update.
const INITIAL_SORT = "id";
// A REST heartbeat failure triggers reconnection. Success does not prove that
// the SSE stream is delivering updates; a quiet collection alone is not an error.
const HEARTBEAT_INTERVAL_MS = 30_000;
// Retry delay doubles from the base, subject to the retry count and delay cap.
const RECONNECT_BACKOFF_BASE_MS = 1000;
const RECONNECT_BACKOFF_MAX_MS = 8000;
// Batch arriving SSE events into roughly one frame of updates to avoid
// re-rendering the matrix once per record during a burst.
const SUBSCRIBE_FLUSH_INTERVAL_MS = 16;

/**
 * Reject a supplemental row only when its observed_at is strictly older.
 * Equal or unparseable timestamps prefer the row carrying signal.
 *
 * Keep a newer bulk row intact: combining its fields with an older signal would
 * mix observations. Leaving signal absent also lets upsertByKey recognize a
 * later signal-bearing update even when its other compared fields are unchanged.
 */
function supplementalRowIsOlder(full: StatusRow, bulkRow: StatusRow): boolean {
  const fullTs = Date.parse(full.observed_at);
  const bulkTs = Date.parse(bulkRow.observed_at);
  if (Number.isNaN(fullTs) || Number.isNaN(bulkTs)) return false;
  return fullTs < bulkTs;
}

/**
 * Reads one page using the caller's fixed filter, projection, sort and options.
 */
type StatusPageReader = (page: number) => Promise<StatusRow[]>;

/** Result of `paginateStatusPages`; see there for what `truncated` means. */
export interface StatusPagesResult {
  rows: StatusRow[];
  /**
   * True when the lookahead finds more rows, or fails to establish completeness.
   */
  truncated: boolean;
}

/**
 * Shared pagination for bulk and supplemental status reads. With skipTotal,
 * page length determines completion instead of totalItems/totalPages.
 *
 * Read page 1, then concurrent waves. Retain results in page order through the
 * first short page, regardless of response order.
 *
 * If the last allowed page is full, read one extra page without retaining it:
 * empty means the result ended exactly at the cap; non-empty means truncated.
 * A failed lookahead also reports truncated because completeness is unknown.
 * The caller decides whether truncation is fatal.
 */
export async function paginateStatusPages(
  readPage: StatusPageReader,
): Promise<StatusPagesResult> {
  const pages: StatusRow[][] = [];
  const first = await readPage(1);
  pages.push(first);
  let lastPageFull = first.length === INITIAL_PAGE_SIZE;
  let nextPage = 2;
  let truncated = false;
  while (lastPageFull) {
    // An empty wave means the cap was reached with a full final page.
    const wave: Promise<StatusRow[]>[] = [];
    for (
      let i = 0;
      i < INITIAL_FANOUT_BATCH && nextPage + i <= MAX_INITIAL_FETCH_PAGES;
      i++
    ) {
      wave.push(readPage(nextPage + i));
    }
    if (wave.length === 0) {
      // Check for remaining rows without retaining anything beyond the cap.
      try {
        const lookahead = await readPage(MAX_INITIAL_FETCH_PAGES + 1);
        truncated = lookahead.length > 0;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[useLiveStatus] page-cap lookahead failed; reporting the read as " +
            "truncated because completeness is unproven",
          { page: MAX_INITIAL_FETCH_PAGES + 1, err },
        );
        truncated = true;
      }
      break;
    }
    const waveResults = await Promise.all(wave);
    const shortIdx = waveResults.findIndex(
      (items) => items.length < INITIAL_PAGE_SIZE,
    );
    const lastIdx = shortIdx === -1 ? waveResults.length - 1 : shortIdx;
    for (let i = 0; i <= lastIdx; i++) {
      pages.push(waveResults[i]!);
    }
    lastPageFull = shortIdx === -1;
    nextPage += wave.length;
  }
  return { rows: pages.flat(), truncated };
}

/**
 * Loads status rows, then subscribes to live updates, optionally scoped by
 * dimension. Terminal read/retry failure clears rows instead of using a cached
 * fallback.
 */
export function useLiveStatus(dimension?: string): UseLiveStatusResult {
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  // Committed rows used to resolve id-only deletes in the SSE callback. Update
  // the ref in an effect, not inside a state updater, so a discarded render cannot
  // change it. The callback also checks pending upserts for rows not committed yet.
  const rowsRef = useRef<StatusRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    // Report a missing runtime PocketBase URL immediately instead of retrying it.
    if (pbIsMisconfigured()) {
      // Clear old rows so the error state cannot retain previous success indicators.
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
    // Keep the last arriving operation per row within each flush window. Resolve
    // id-only deletes to the row's key where possible so deletes and upserts share
    // one slot; otherwise flushPending can match the delete by id.
    type PendingOp =
      | { op: "upsert"; row: StatusRow }
      | { op: "delete"; key: string | undefined; id: string | undefined };
    const pendingByKey = new Map<string, PendingOp>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    // Count heartbeat-driven reconnects only, excluding initial/dimension loads.
    const reconnectStamps: number[] = [];

    // Called after successful heartbeats as well as failures, so degraded clears
    // when previous failures leave the window.
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

    // Use a placeholder to quote the optional dimension filter.
    const filter = dimension
      ? pb.filter("dimension = {:dim}", { dim: dimension })
      : "";

    // The bulk read omits signal. Restore it for two overlapping sets:
    // - All non-green rows, for infrastructure/product failure attribution. Using
    //   != "green" also includes unknown state values.
    // - Fleet communication aggregates, even when green, for communication overlays.
    //   Keys containing / are per-feature rows and excluded from this clause.
    //
    // A supplied dimension restricts both sets. Other green rows still lack signal
    // on initial load: failure classification does not need it for those rows, but
    // communication overlays stored only there are unavailable until a live update.
    // This filter does not guarantee complete signal coverage for the matrix.
    const matchedCommDim =
      dimension === undefined
        ? undefined
        : FLEET_COMM_AGGREGATE_DIMENSIONS.find((d) => d === dimension);
    const commAggregateClause: string | null =
      dimension === undefined
        ? `(${FLEET_COMM_AGGREGATE_DIMENSIONS.map(
            (d) => `dimension = "${d}"`,
          ).join(" || ")}) && key !~ "%/%"`
        : matchedCommDim !== undefined
          ? `dimension = "${matchedCommDim}" && key !~ "%/%"`
          : null;
    const nonGreenClause = `state != "green"`;
    const supplementalUnion =
      commAggregateClause === null
        ? nonGreenClause
        : `(${commAggregateClause}) || (${nonGreenClause})`;
    const supplementalFilter: string =
      dimension === undefined
        ? supplementalUnion
        : pb.filter(`dimension = {:dim} && (${supplementalUnion})`, {
            dim: dimension,
          });

    function teardownSubscription(): void {
      if (cancel) {
        try {
          cancel();
        } catch (err) {
          // Log cleanup failures without throwing from teardown.
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
      // rowsRef follows committed React state; clearing this buffer must not clear it.
    }

    function flushPending(): void {
      flushTimer = null;
      // Discard events from a subscription that was torn down or is reconnecting.
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
            // Delete events may contain only an id.
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
        // Keep this updater pure; the effect updates rowsRef after commit.
        return mutated ? next : prev;
      });
    }

    function scheduleFlush(): void {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(flushPending, SUBSCRIBE_FLUSH_INTERVAL_MS);
    }

    function startReconnect(reason: string, err?: unknown): void {
      // Allow one reconnect chain at a time.
      if (reconnecting) return;
      reconnecting = true;
      // Keep the attempt count across retries; connect resets it after the initial
      // read succeeds, before awaiting subscription setup.
      setStatus("connecting");
      if (err !== undefined) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        setError(reason);
      }
      clearHeartbeat();
      clearReconnectTimer();
      // Drop buffered events from the previous subscription before loading again.
      clearFlushTimer();
      teardownSubscription();
      // Keep reconnecting true across timer-based retries until success or exhaustion.
      void connect();
    }

    async function heartbeat(): Promise<void> {
      if (!alive || reconnecting) return;
      try {
        // Disable SDK auto-cancellation, as for the concurrent initial reads below.
        await pb
          .collection("status")
          .getList(1, 1, { filter, requestKey: null });
      } catch (err) {
        if (!alive) return;
        // Record the failure before reconnecting so repeated heartbeat failures
        // contribute to the degraded indicator.
        recordHeartbeatReconnect();
        startReconnect("heartbeat failed", err);
        return;
      }
      // Let previous failures expire even when no further failures occur.
      pruneAndRecomputeDegraded();
    }

    function startHeartbeat(): void {
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        void heartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Keep the same options on every page, including the cap lookahead.
     */
    async function fetchStatusPages(
      listOpts: Record<string, unknown>,
    ): Promise<StatusPagesResult> {
      return paginateStatusPages(async (page) => {
        const result = await pb
          .collection("status")
          .getList<StatusRow>(page, INITIAL_PAGE_SIZE, listOpts);
        return result.items;
      });
    }

    /**
     * Fetch signal-bearing rows selected by supplementalFilter. At the page cap,
     * warn and keep the rows returned; missing signals leave attribution and
     * communication overlays incomplete.
     */
    async function fetchSupplementalSignalRows(): Promise<StatusRow[]> {
      // Allow this read to share the status endpoint with bulk pages and heartbeats.
      const { rows, truncated } = await fetchStatusPages({
        filter: supplementalFilter,
        sort: INITIAL_SORT,
        fields: STATUS_SIGNAL_FIELDS,
        skipTotal: true,
        requestKey: null,
      });
      if (truncated) {
        // eslint-disable-next-line no-console
        console.warn(
          "[useLiveStatus] supplemental signal fetch truncated at the page cap; " +
            "rows beyond it render without `signal` (reds stay red)",
          {
            topic: dimension ?? "<all>",
            maxPages: MAX_INITIAL_FETCH_PAGES,
            rows: rows.length,
          },
        );
      }
      return rows;
    }

    async function fetchInitial(): Promise<StatusRow[]> {
      // Read the bulk projection without totals; paginateStatusPages handles
      // concurrent waves and completion. requestKey:null disables the SDK's default
      // method/path auto-cancellation so concurrent requests do not cancel each other.
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

      // Start both reads concurrently, then wait for both before publishing rows.
      // Catch supplemental failure immediately, including when the bulk read fails
      // first and this promise is never awaited. Preserve bulk rows on failure;
      // attribution and communication overlays may remain incomplete until live updates.
      const supplementalPromise = fetchSupplementalSignalRows().catch(
        (err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            "[useLiveStatus] supplemental signal fetch failed; rendering with " +
              "`signal` unknown (non-green rows stay red, comm-error overlays " +
              "wait for their next SSE delta)",
            { topic: dimension ?? "<all>", err },
          );
          return [] as StatusRow[];
        },
      );

      const { rows: bulk, truncated: bulkTruncated } =
        await fetchStatusPages(listOpts);
      if (bulkTruncated) {
        // A missing bulk page can hide whole cells. Retry rather than present an
        // incomplete read as complete. A failed cap lookahead takes this path too.
        throw new Error(
          `[useLiveStatus] bulk initial fetch exceeded ${MAX_INITIAL_FETCH_PAGES} pages ` +
            `(${bulk.length} rows) and rows remain unread past the cap`,
        );
      }
      // Merge full supplemental rows by key, keeping bulk page order. Prefer them
      // unless strictly older; append any keys absent from the bulk read.
      const supplementalRows = await supplementalPromise;
      if (supplementalRows.length === 0) return bulk;
      const fullByKey = new Map(
        supplementalRows.map((r) => [r.key, r] as const),
      );
      const merged = bulk.map((r) => {
        const full = fullByKey.get(r.key);
        if (full === undefined) return r;
        fullByKey.delete(r.key);
        // Keep the newer bulk observation intact; see supplementalRowIsOlder.
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
        // Allow React to defer the matrix update for responsiveness. The live
        // indicator updates separately and can appear before the rows are committed.
        // rowsRef is updated by the effect after that commit.
        startTransition(() => {
          setRows(initial);
        });
        setStatus("live");
        setError(null);
        // The initial read succeeded; reset the counter before subscription setup.
        attempts = 0;
        // Filter on the server and also check incoming dimensions below.
        const unsub = await pb.collection("status").subscribe<StatusRow>(
          "*",
          (e) => {
            // Log malformed events without letting a synchronous callback error escape.
            try {
              if (!alive) return;
              const isDelete = e.action === "delete";
              // Delete payloads may contain only an id despite the SDK's full-record type.
              const rec = e.record as Partial<StatusRow>;
              // Deletes may lack dimension; match them against held rows by key or id.
              if (!isDelete && dimension && rec.dimension !== dimension) return;
              // Resolve id-only deletes to the same buffer key used by upserts.
              // If the key is unavailable, retain the id for flushPending to match.
              let identity: string | undefined = rec.key;
              if (identity === undefined && isDelete && rec.id !== undefined) {
                // Check committed rows first, then upserts awaiting this flush.
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
              // Batch the last arriving operation for each row into the next flush.
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
        // Cleanup may have run while subscribe was pending, before cancel existed.
        // Unsubscribe the late result here to avoid leaving it active after unmount.
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
        reconnecting = false;
      } catch (err) {
        if (!alive) {
          reconnecting = false;
          return;
        }
        attempts += 1;
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          // Clear old results so the offline display cannot retain success indicators.
          setRows([]);
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
          // The heartbeat stops on terminal error, so clear its degraded flag and
          // reconnect history here rather than waiting for another pruning tick.
          reconnectStamps.length = 0;
          setDegraded(false);
          // Stop remaining timers and buffered updates on every terminal failure path.
          clearHeartbeat();
          clearFlushTimer();
          reconnecting = false;
          return;
        }
        // Track the backoff timer so reconnect or unmount cleanup can cancel it.
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
