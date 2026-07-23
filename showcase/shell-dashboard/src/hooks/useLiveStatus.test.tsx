/**
 * Tests for `useLiveStatus` with a mocked PocketBase SDK (per spec §7 —
 * mocked PB JS SDK is acceptable for dashboard hook tests).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Track calls to React.startTransition without losing its real behavior. The
// hook wraps the heavy initial `setRows(initial)` commit in startTransition so
// React 19 can yield to user input mid-walk instead of blocking on the
// full-matrix re-render. We can't `vi.spyOn` a frozen ESM namespace export, so
// we partial-mock `react` and wrap the real implementation.
const startTransitionCalls = { count: 0 };
vi.mock("react", async (importActual) => {
  const actual = await importActual<typeof import("react")>();
  return {
    ...actual,
    startTransition: (cb: () => void) => {
      startTransitionCalls.count += 1;
      return actual.startTransition(cb);
    },
  };
});

// Mock PB client used by the hook. Drives initial + subscribe events.
type Action = "create" | "update" | "delete";
type Listener = (e: {
  action: Action;
  record: Record<string, unknown>;
}) => void;

// PocketBase clamps perPage to 500, so the paged initial fetch uses 500.
const PB_PAGE_SIZE = 500;

const mockState = {
  initial: [] as Record<string, unknown>[],
  listener: null as Listener | null,
  failRemaining: 0,
  // Capture the options passed to the initial getList(1, …) call / subscribe so
  // tests can assert server-side filter is forwarded (not client-side only).
  lastInitialGetListOpts: undefined as unknown,
  lastSubscribeOpts: undefined as unknown,
  // Make getList (heartbeat) fail on demand to drive reconnection.
  heartbeatFailRemaining: 0,
  // How many calls to `getList` have been made total (initial + heartbeat).
  getListCalls: 0,
  // Track how many times subscribe was called (counts fresh vs. reconnects).
  subscribeCalls: 0,
  // Track how many times the unsubscribe function returned by subscribe
  // was actually invoked — for teardown / dimension-change tests.
  unsubscribeCalls: 0,
  // Per-page resolution-delay map (page number → ms) so a test can make a
  // LATER page resolve BEFORE an earlier one, proving the merge is ordered by
  // request index, not by resolution order. Empty = all resolve immediately.
  pageResolveDelayMs: {} as Record<number, number>,
  // Records the order in which the initial getList page requests were ISSUED
  // (before any await), so tests can assert pages 2..N are dispatched
  // concurrently rather than awaited serially.
  initialPageRequestOrder: [] as number[],
  // Per-page options captured for EVERY initial getList page request (not just
  // the last), so a test can assert the hook forwards a stable `sort` to ALL
  // pages — offset pagination over a live-mutating collection drops/duplicates
  // rows without one.
  initialPageOpts: [] as { filter?: string; sort?: string }[],
  // Rows served to the SUPPLEMENTAL comm-error aggregate fetch (CF7-F3 #1) —
  // the narrow re-fetch of the FLEET_COMM_AGGREGATE_DIMENSIONS aggregate rows
  // WITH `signal`. Served verbatim (full rows), the way real PB answers a
  // request with no `fields` projection.
  commAggregateRows: [] as Record<string, unknown>[],
  // Supplemental comm-aggregate fetch instrumentation: call count + the last
  // options, so tests can assert the filter shape and the skip behavior for
  // dimension scopes outside the aggregate set.
  commFetchCalls: 0,
  lastCommFetchOpts: undefined as unknown,
};

// Build a PocketBase-style paged getList response over `mockState.initial`,
// honouring the 500-row perPage clamp PB enforces server-side. When a `sort`
// key is supplied, the rows are ordered by that field BEFORE slicing — exactly
// as PocketBase applies `?sort=` server-side. This makes the stable-sort
// assertion BEHAVIORAL: if the hook ever stopped forwarding `sort` to a page,
// that page would slice an unsorted view and the merged result would differ.
function pageResponse(
  page: number,
  perPage: number,
  sort?: string,
): {
  items: Record<string, unknown>[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
} {
  const effPerPage = Math.min(perPage, PB_PAGE_SIZE);
  const ordered = sort
    ? [...mockState.initial].sort((a, b) => {
        const av = String(a[sort] ?? "");
        const bv = String(b[sort] ?? "");
        return av < bv ? -1 : av > bv ? 1 : 0;
      })
    : mockState.initial;
  const total = ordered.length;
  const start = (page - 1) * effPerPage;
  return {
    items: ordered.slice(start, start + effPerPage),
    page,
    perPage: effPerPage,
    totalItems: total,
    totalPages: Math.max(1, Math.ceil(total / effPerPage)),
  };
}

vi.mock("../lib/pb", () => {
  const pb = {
    filter: (raw: string, params?: Record<string, unknown>) => {
      let out = raw;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          out = out.replace(new RegExp(`\\{:${k}\\}`, "g"), JSON.stringify(v));
        }
      }
      return out;
    },
    collection: (_name: string) => ({
      // getList serves three callers:
      //   - heartbeat ping       → getList(1, 1, …)            (perPage 1)
      //   - supplemental comm    → filter contains `key !~`    (CF7-F3 #1)
      //   - bulk initial fetch   → getList(page, PB_PAGE_SIZE, …) per page
      // The bulk fetch issues page 1 first, then fans out pages 2..N
      // concurrently. To prove the merge is order-safe, a test can set
      // `pageResolveDelayMs` so a LATER page resolves BEFORE an earlier one —
      // the hook must still return rows in page order.
      getList: vi.fn(
        async (
          page: number,
          perPage: number,
          opts?: { filter?: string; sort?: string; fields?: string },
        ) => {
          // Heartbeat ping: perPage 1. Keep its 1-row contract + fail hook.
          if (perPage === 1) {
            mockState.getListCalls += 1;
            if (mockState.heartbeatFailRemaining > 0) {
              mockState.heartbeatFailRemaining -= 1;
              throw new Error("heartbeat-fail");
            }
            return pageResponse(1, 1);
          }
          // Supplemental comm-error aggregate fetch (CF7-F3 #1), identified
          // by its aggregate-key filter marker (`key !~` — aggregate rows
          // carry no `/<featureId>` segment). Served from a dedicated fixture
          // VERBATIM (full rows, signal included — no `fields` projection is
          // sent) and deliberately NOT recorded into the bulk-fetch
          // instrumentation (initialPageRequestOrder / initialPageOpts /
          // lastInitialGetListOpts) so the fan-out order/count assertions
          // keep targeting the bulk fetch alone.
          if (
            typeof opts?.filter === "string" &&
            opts.filter.includes("key !~")
          ) {
            mockState.getListCalls += 1;
            mockState.commFetchCalls += 1;
            mockState.lastCommFetchOpts = opts;
            return {
              items: page === 1 ? mockState.commAggregateRows : [],
              page,
              perPage,
            };
          }
          // Initial paged fetch.
          mockState.getListCalls += 1;
          mockState.initialPageRequestOrder.push(page);
          mockState.lastInitialGetListOpts = opts;
          mockState.initialPageOpts.push(opts ?? {});
          if (mockState.failRemaining > 0) {
            mockState.failRemaining -= 1;
            throw new Error("pb-unreachable");
          }
          const delay = mockState.pageResolveDelayMs[page] ?? 0;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          // Apply the requested `sort` server-side (see pageResponse) so the
          // forwarded-sort contract is exercised behaviorally, not just by
          // inspecting the captured option string.
          const resp = pageResponse(page, perPage, opts?.sort);
          // Honour the `fields` projection like real PB: the hook's bulk
          // initial fetch projects `signal` away (STATUS_LIST_FIELDS), so the
          // rows it receives must NOT carry `signal` — the old mock returned
          // full rows here, which is exactly how the CF7-F3 #1 cold-fetch
          // overlay bug stayed invisible to this suite.
          const fields = opts?.fields;
          if (
            typeof fields === "string" &&
            fields.length > 0 &&
            !fields.split(",").includes("signal")
          ) {
            return {
              ...resp,
              items: resp.items.map(
                ({ signal: _signal, ...rest }) =>
                  rest as Record<string, unknown>,
              ),
            };
          }
          return resp;
        },
      ),
      subscribe: vi.fn(async (_topic: string, cb: Listener, opts?: unknown) => {
        mockState.subscribeCalls += 1;
        mockState.listener = cb;
        mockState.lastSubscribeOpts = opts;
        return async () => {
          mockState.unsubscribeCalls += 1;
          mockState.listener = null;
        };
      }),
      unsubscribe: vi.fn(async () => {
        mockState.listener = null;
      }),
    }),
  };
  return {
    pbIsMisconfigured: () => false,
    PB_MISCONFIG_MESSAGE: "Dashboard misconfigured (test stub)",
    getPb: () => pb,
  };
});

import { useLiveStatus } from "./useLiveStatus";
import { buildCellModel } from "../lib/cell-model";
import { mergeRowsToMap } from "../lib/live-status";

describe("useLiveStatus", () => {
  beforeEach(() => {
    mockState.initial = [];
    mockState.listener = null;
    mockState.failRemaining = 0;
    mockState.lastInitialGetListOpts = undefined;
    mockState.lastSubscribeOpts = undefined;
    mockState.heartbeatFailRemaining = 0;
    mockState.getListCalls = 0;
    mockState.subscribeCalls = 0;
    mockState.unsubscribeCalls = 0;
    mockState.pageResolveDelayMs = {};
    mockState.initialPageRequestOrder = [];
    mockState.initialPageOpts = [];
    mockState.commAggregateRows = [];
    mockState.commFetchCalls = 0;
    mockState.lastCommFetchOpts = undefined;
    // Reset the startTransition counter so the transition assertion can't pass
    // on stale state leaked from a prior test (A3).
    startTransitionCalls.count = 0;
  });

  it("transitions connecting → live and exposes initial rows", async () => {
    mockState.initial = [
      {
        id: "1",
        key: "smoke:a/b",
        dimension: "smoke",
        state: "green",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 0,
        first_failure_at: null,
      },
    ];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    expect(result.current.status).toBe("connecting");
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.rows).toHaveLength(1);
  });

  it("applies the initial full-matrix rows inside a React transition (non-blocking first paint)", async () => {
    // The first commit with real data invalidates per-key memo checks on EVERY
    // cell (empty map → populated map), a hundreds-of-cells synchronous render.
    // Wrapping `setRows(initial)` in startTransition lets React 19 yield to user
    // input mid-walk instead of freezing the main thread for the load. The
    // "connecting → live" status flip must stay urgent so the indicator updates
    // immediately. React.startTransition is wrapped (see the top-of-file mock):
    // it MUST be invoked when the initial rows land. The counter is reset in
    // beforeEach (A3) so this assertion can't pass on state leaked by a prior
    // test rather than this one's own initial-rows commit.
    mockState.initial = [
      {
        id: "1",
        key: "smoke:a/b",
        dimension: "smoke",
        state: "green",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 0,
        first_failure_at: null,
      },
    ];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.rows).toHaveLength(1);
    // The initial-rows commit must have gone through a transition.
    expect(startTransitionCalls.count).toBeGreaterThan(0);
  });

  it("passes server-side filter to the initial getList and subscribe", async () => {
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    const initOpts = mockState.lastInitialGetListOpts as { filter?: string };
    expect(initOpts.filter).toContain("dimension =");
    expect(initOpts.filter).toContain("smoke");
    const subOpts = mockState.lastSubscribeOpts as { filter?: string };
    expect(subOpts?.filter).toContain("dimension =");
  });

  it("upserts on subscribe event", async () => {
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => {
      mockState.listener?.({
        action: "update",
        record: {
          id: "1",
          key: "smoke:a/b",
          dimension: "smoke",
          state: "red",
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 1,
          first_failure_at: "2026-04-20T00:00:00Z",
        },
      });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]!.state).toBe("red");
  });

  it("removes row on delete event", async () => {
    mockState.initial = [
      {
        id: "1",
        key: "smoke:a/b",
        dimension: "smoke",
        state: "green",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 0,
        first_failure_at: null,
      },
    ];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => {
      mockState.listener?.({
        action: "delete",
        record: { key: "smoke:a/b", dimension: "smoke" },
      });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
  });

  it("moves to error after repeated fetch failures", async () => {
    mockState.failRemaining = 10;
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("error"), {
      timeout: 15000,
    });
    expect(result.current.error).toContain("pb-unreachable");
  }, 20000);

  it("clears cached rows on terminal error transition (R5 F5.2)", async () => {
    // Seed an initial green row so it's cached in hook state, then drive
    // repeated heartbeat failures until the reconnect chain exhausts and
    // the hook flips to status="error". Downstream consumers (resolveCell)
    // must not see stale green rows after that transition — the offline
    // banner would otherwise hide a silent stale-green lie (spec §5.3).
    vi.useFakeTimers();
    try {
      mockState.initial = [
        {
          id: "1",
          key: "smoke:a/b",
          dimension: "smoke",
          state: "green",
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 0,
          first_failure_at: null,
        },
      ];
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(result.current.rows).toHaveLength(1);

      // Arm failures for every subsequent reconnect attempt. Initial fetch
      // succeeded; now drive heartbeat failure + all retry initial fetches
      // to fail so the reconnect chain hits MAX_RECONNECT_ATTEMPTS=3.
      mockState.heartbeatFailRemaining = 1;
      mockState.failRemaining = 10;

      // Advance past heartbeat (30s) → startReconnect → connect() fails
      // repeatedly with 1s / 2s backoff → terminal error after MAX attempts.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await vi.waitFor(() => expect(result.current.status).toBe("error"));
      // Rows MUST be cleared — this is the core F5.2 guarantee.
      expect(result.current.rows).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it("tears down the old subscription when `dimension` prop changes", async () => {
    const { result, rerender } = renderHook(
      ({ dim }: { dim: string }) => useLiveStatus(dim),
      { initialProps: { dim: "smoke" } },
    );
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(mockState.subscribeCalls).toBe(1);
    expect(mockState.unsubscribeCalls).toBe(0);

    // Capture the stale listener so we can prove stale events are ignored
    // by the new subscription.
    const staleListener = mockState.listener;

    act(() => {
      rerender({ dim: "health" });
    });

    // Unsubscribe for the old dimension fires as part of effect cleanup.
    await waitFor(() => expect(mockState.unsubscribeCalls).toBe(1));
    // A fresh subscription is established for the new dimension.
    await waitFor(() => expect(mockState.subscribeCalls).toBe(2));
    await waitFor(() => expect(result.current.status).toBe("live"));

    // Emit a stale event via the captured old listener — the hook ignores
    // anything whose `dimension` does not match its current prop.
    const staleBefore = result.current.rows.length;
    act(() => {
      staleListener?.({
        action: "update",
        record: {
          id: "stale",
          key: "smoke:stale/x",
          dimension: "smoke",
          state: "red",
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 1,
          first_failure_at: "2026-04-20T00:00:00Z",
        },
      });
    });
    expect(result.current.rows).toHaveLength(staleBefore);
  });

  it("swallows a synchronous throw from the subscribe callback path", async () => {
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    // Construct a record whose getter throws when accessed — simulates an
    // SDK-level oddity (e.g., proxy with a bad trap) without patching the
    // hook's own logic. The hook should log + continue rather than
    // tearing down the subscription or surfacing an error state.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badRecord: Record<string, unknown> = {
      get dimension(): string {
        throw new Error("sync-throw-from-record");
      },
    };
    act(() => {
      mockState.listener?.({ action: "update", record: badRecord });
    });
    // State unchanged (no rows added, still live).
    expect(result.current.status).toBe("live");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("heartbeat failure triggers reconnect that restores live state", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      // Let initial async microtasks resolve.
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      const initialSubscribeCount = mockState.subscribeCalls;

      // Arm one heartbeat failure so the first tick triggers a reconnect.
      mockState.heartbeatFailRemaining = 1;
      // Advance past the 30s heartbeat interval.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      // Reconnect kicks in — transient connecting then back to live.
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(mockState.subscribeCalls).toBeGreaterThan(initialSubscribeCount);
      expect(mockState.unsubscribeCalls).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("idle dashboard: successful heartbeats do NOT trigger reconnect (C5 F3)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      const initialSubscribeCount = mockState.subscribeCalls;

      // Advance well past multiple heartbeat intervals with NO SSE row
      // updates and NO heartbeat failures — the hook must remain live
      // and NOT force a reconnect (previous impl did reconnect every
      // minute due to stream-silence detection, producing a storm).
      for (let i = 0; i < 6; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
      }
      expect(result.current.status).toBe("live");
      expect(mockState.subscribeCalls).toBe(initialSubscribeCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnect backoff cadence: 1s → 2s → give up at MAX (C5 F19)", async () => {
    vi.useFakeTimers();
    try {
      // Arm enough failures that every retry attempt throws. With
      // MAX_RECONNECT_ATTEMPTS=3 the hook should: initial fetch fails
      // (attempts=1), wait 1s, retry fails (attempts=2), wait 2s, retry
      // fails (attempts=3) → terminal error.
      mockState.failRemaining = 10;
      const { result } = renderHook(() => useLiveStatus("smoke"));
      // Kick initial connect (it fails synchronously via microtask).
      await vi.waitFor(() => expect(mockState.getListCalls).toBeGreaterThan(0));
      expect(result.current.status).toBe("connecting");

      // Advance 900ms — backoff has not elapsed, no new attempt.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      const callsAfter900 = mockState.getListCalls;

      // Advance another 200ms (1.1s total past failure) — first retry fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await vi.waitFor(() =>
        expect(mockState.getListCalls).toBeGreaterThan(callsAfter900),
      );

      // Advance past the 2s second-backoff, second retry fires → terminal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });
      await vi.waitFor(() => expect(result.current.status).toBe("error"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("single page: fetches all rows when the collection fits in one page", async () => {
    // 350 rows: below the 500/page clamp. getList(1, 500) reads page 1 and its
    // reported totalPages=1, so there is no fan-out and NO extra request — the
    // initial fetch is a single best-effort snapshot reconciled by SSE.
    mockState.initial = Array.from({ length: 350 }, (_, i) => ({
      id: `r${i}`,
      key: `smoke:int/f${i}`,
      dimension: "smoke",
      state: "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    }));
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.rows).toHaveLength(350);
    // Only page 1 is requested — totalPages=1 means no fan-out and no probe.
    expect(mockState.initialPageRequestOrder).toEqual([1]);
  });

  it("paged fetch: collects ALL pages (no INITIAL_CAP truncation)", async () => {
    // 2100 rows across 5 pages (500/page, last page 100). The previous
    // single-getFullList impl capped at INITIAL_CAP=2000, silently dropping
    // 100 late-created rows (e2e per-cell → D2-instead-of-D4 bug). The paged
    // fetch collects every page — all 2100 rows — with no length-based break.
    mockState.initial = Array.from({ length: 2100 }, (_, i) => ({
      id: `r${i}`,
      key: `smoke:int/f${i}`,
      dimension: "smoke",
      state: "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    }));
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.rows).toHaveLength(2100);
    // 5 data pages requested (page 1 + concurrent fan-out 2..5). No probe.
    expect(mockState.initialPageRequestOrder.sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("paged fetch is order-safe under out-of-order page resolution AND concurrent (perf regression fix)", async () => {
    // The reverted #4504 parallel fix pushed Promise.all page results into an
    // array IN RESOLUTION ORDER and had an early `break` on
    // `collected.length >= total` — a non-deterministic merge that could also
    // truncate before late pages landed. This asserts the order-safe contract:
    //
    //   (a) ALL pages present (no truncation), and
    //   (b) rows in deterministic PAGE order regardless of which page's HTTP
    //       response lands first, and
    //   (c) pages 2..N are dispatched CONCURRENTLY (page 2 issued before page 1
    //       has resolved), not awaited serially.
    //
    // We force page 1 to resolve LAST: page 1 is delayed 60ms while pages 2+
    // resolve immediately. A resolution-order merge would interleave/scramble;
    // an index-ordered `Promise.all` merge yields rows in strict page order.
    const TOTAL = 1300; // 3 pages: 500 + 500 + 300
    // Zero-pad `id` so that the page response's `sort: "id"` ordering (applied
    // server-side by the mock, mirroring PocketBase) matches the source array
    // index order — this isolates the assertion to page-MERGE order under
    // out-of-order HTTP resolution, not the sort itself.
    mockState.initial = Array.from({ length: TOTAL }, (_, i) => ({
      id: `r${String(i).padStart(4, "0")}`,
      key: `smoke:int/f${String(i).padStart(4, "0")}`,
      dimension: "smoke",
      state: "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    }));
    // Make the EARLIEST page resolve LAST: page 1 slow, later pages fast.
    mockState.pageResolveDelayMs = { 1: 60, 2: 10, 3: 0 };

    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"), {
      timeout: 5000,
    });

    // (a) Completeness: every page present, no truncation.
    expect(result.current.rows).toHaveLength(TOTAL);

    // (b) Determinism: rows in strict page order — identical to the source
    // order — even though page 1's response landed AFTER pages 2 & 3.
    const expectedKeys = mockState.initial.map((r) => r.key as string);
    expect(result.current.rows.map((r) => r.key)).toEqual(expectedKeys);

    // (c) Concurrency: data pages 1..3 were ISSUED (pushed to the request
    // order). Pages 2 and 3 are fanned out concurrently (not awaited serially).
    expect(mockState.initialPageRequestOrder.sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
    // Pages 2 and 3 were dispatched together in the fan-out (a serial await
    // chain would not have issued page 3 until page 2 resolved).
    expect(mockState.initialPageRequestOrder).toContain(2);
    expect(mockState.initialPageRequestOrder).toContain(3);
  }, 10000);

  it("forwards an explicit stable `sort` to EVERY initial getList page (A1)", async () => {
    // Offset pagination over the LIVE-mutating `status` collection drops or
    // duplicates rows across page boundaries unless every page request carries
    // the SAME stable sort key. PocketBase orders by `created DESC` by default,
    // which is NOT stable as rows are inserted — a row created between the
    // page-1 and page-2 reads shifts every subsequent row down a slot, so a row
    // can fall off the end of one page and reappear at the top of the next
    // (duplicate) or vanish entirely (drop). This asserts the contract
    // BEHAVIORALLY: the mock's pageResponse sorts `mockState.initial` by the
    // requested `sort` key before slicing (exactly as PB applies `?sort=`), so
    // a missing/inconsistent sort on any page would scramble the merged order.
    // The source rows are SHUFFLED here so the only way the merged result comes
    // back in `id` order is if the hook actually forwarded `sort: "id"` to
    // every page.
    const built = Array.from({ length: 1300 }, (_, i) => ({
      id: `r${String(i).padStart(4, "0")}`,
      key: `smoke:int/f${i}`,
      dimension: "smoke",
      state: "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    }));
    // Deterministic shuffle (reverse) so the source array is NOT pre-sorted by
    // id — the sorted page response must do the ordering work.
    mockState.initial = [...built].reverse();
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    // Exactly the 3 data pages were requested — no probe.
    expect(mockState.initialPageOpts).toHaveLength(3);
    // EVERY initial getList request must carry a non-empty sort key. Without
    // it, offset pagination over the live-mutating collection drops/duplicates
    // rows across boundaries.
    for (const opts of mockState.initialPageOpts) {
      expect(opts.sort).toBeTruthy();
    }
    // All requests must use the SAME sort key (mixing keys across pages would
    // itself reorder boundaries).
    const sortKeys = new Set(mockState.initialPageOpts.map((o) => o.sort));
    expect(sortKeys.size).toBe(1);
    // BEHAVIORAL proof: because the sort was forwarded to every page, the
    // merged rows come back in ascending `id` order even though the source
    // array was shuffled.
    const expectedIdOrder = built.map((r) => r.id);
    expect(result.current.rows.map((r) => r.id)).toEqual(expectedIdOrder);
  });

  it("unmount during pending subscribe() resolves cleanly (HF-C1)", async () => {
    // Hold the subscribe() promise open so we can unmount mid-await. The
    // hook captures the unsub into `cancel` only after the await resolves;
    // if the effect cleanup runs during the await, the previous impl left
    // `cancel` null and the eventually-returned unsub was leaked — an
    // orphan SSE subscription would keep firing callbacks forever.
    let resolveSubscribe: (() => void) | null = null;
    const subscribePending = new Promise<void>((resolve) => {
      resolveSubscribe = resolve;
    });

    // Seed one row so fetchInitial resolves quickly.
    mockState.initial = [
      {
        id: "1",
        key: "smoke:a/b",
        dimension: "smoke",
        state: "green",
        signal: {},
        observed_at: "2026-04-20T00:00:00Z",
        transitioned_at: "2026-04-20T00:00:00Z",
        fail_count: 0,
        first_failure_at: null,
      },
    ];

    // We already have a subscribe mock in place from vi.mock at module
    // scope. Wrap our own gating by swapping its implementation for this
    // test: await the gate, then return an unsub that increments
    // unsubscribeCalls. Use the fact that the hook calls
    // pb.collection("status").subscribe — reach through the module mock.
    const pbMod = await import("../lib/pb");
    const gatedSubscribe = vi.fn(
      async (_topic: string, cb: Listener, _opts?: unknown) => {
        mockState.subscribeCalls += 1;
        mockState.listener = cb;
        await subscribePending; // hold until the test opens the gate
        return async () => {
          mockState.unsubscribeCalls += 1;
          mockState.listener = null;
        };
      },
    );
    // Patch the collection().subscribe path on the mocked pb for this test.
    // The mocked pb.collection returns a minimal stub (see vi.mock above),
    // not a real PocketBase RecordService — casting through `unknown` to a
    // narrowed shape is the correct seam.
    const pbHandle = pbMod.getPb() as unknown as {
      collection: (name: string) => Record<string, unknown>;
    };
    const origCollection = pbHandle.collection;
    pbHandle.collection = (name: string) => {
      const base = origCollection(name);
      return { ...base, subscribe: gatedSubscribe };
    };

    try {
      const { unmount } = renderHook(() => useLiveStatus("smoke"));

      // Wait until subscribe has been invoked (await is in-flight).
      await waitFor(() => expect(gatedSubscribe).toHaveBeenCalled());
      expect(mockState.unsubscribeCalls).toBe(0);

      // Unmount while subscribe() is still awaiting.
      unmount();

      // Now resolve the subscribe() promise — the hook receives `unsub`
      // after cleanup has already run. The fix must invoke unsub itself.
      resolveSubscribe!();

      await waitFor(() => expect(mockState.unsubscribeCalls).toBe(1));
      // Listener must not remain wired up after the orphan tear-down.
      expect(mockState.listener).toBeNull();
    } finally {
      pbHandle.collection = origCollection;
    }
  });

  it("filters subscribe events by dimension (client-side defense)", async () => {
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.status).toBe("live"));
    act(() => {
      mockState.listener?.({
        action: "update",
        record: {
          id: "99",
          key: "health:a",
          dimension: "health",
          state: "red",
          signal: {},
          observed_at: "2026-04-20T00:00:00Z",
          transitioned_at: "2026-04-20T00:00:00Z",
          fail_count: 0,
          first_failure_at: null,
        },
      });
    });
    expect(result.current.rows).toHaveLength(0);
  });

  describe("supplemental comm-error aggregate fetch (CF7-F3 #1)", () => {
    // A fresh observedAt (relative to real Date.now(), which buildCellModel
    // defaults to) so the comm error sits well inside the E2E staleness
    // window from a cold load.
    const COMM_OBSERVED_AT = new Date(Date.now() - 60_000).toISOString();
    const COMM_SIGNAL = {
      __fleetCommError: {
        kind: "worker-unreachable",
        message: "connect refused",
        workerId: "fleet-worker-1",
        observedAt: COMM_OBSERVED_AT,
      },
    };
    // The d6:<slug> AGGREGATE row as it exists in the collection: the bulk
    // initial fetch returns it WITHOUT signal (projection), the supplemental
    // fetch returns it WITH signal.
    const aggregateRow = {
      id: "agg-acme",
      key: "d6:acme",
      dimension: "d6",
      state: "green",
      signal: COMM_SIGNAL,
      observed_at: COMM_OBSERVED_AT,
      transitioned_at: COMM_OBSERVED_AT,
      fail_count: 0,
      first_failure_at: null,
    };

    it("a mirrored comm error renders the overlay from a COLD initial fetch (no SSE delta)", async () => {
      // REGRESSION (CF7-F3 #1): decodeCellCommError derives the REQ-B
      // unreachable overlay from row.signal, but the bulk initial fetch
      // projects signal away (STATUS_LIST_FIELDS) — so on every page refresh
      // active overlays vanished until an SSE delta happened to re-deliver
      // the row. The supplemental aggregate fetch must restore the signal on
      // the comm-error candidate rows at cold-load time.
      mockState.initial = [aggregateRow];
      mockState.commAggregateRows = [aggregateRow];

      const { result } = renderHook(() => useLiveStatus());
      await waitFor(() => expect(result.current.status).toBe("live"));

      // The hook's rows must carry the aggregate row WITH its signal —
      // pre-fix the projected (signal-less) bulk row was all consumers saw.
      const agg = result.current.rows.find((r) => r.key === "d6:acme");
      expect(agg).toBeDefined();
      expect(agg?.signal).toEqual(COMM_SIGNAL);

      // End-to-end: the cell model derived from a cold fetch renders the
      // unreachable overlay (this is what buildCellModel does per cell at
      // render).
      const model = buildCellModel(mergeRowsToMap([...result.current.rows]), {
        slug: "acme",
        featureId: "agentic-chat",
        isSupported: true,
        isWired: true,
      });
      expect(model.commError?.kind).toBe("worker-unreachable");
      expect(model.surfaceState).toBe("unreachable");
    });

    it("requests ONLY aggregate-shaped keys for the comm-error dimensions (narrow filter)", async () => {
      mockState.commAggregateRows = [aggregateRow];
      const { result } = renderHook(() => useLiveStatus());
      await waitFor(() => expect(result.current.status).toBe("live"));
      expect(mockState.commFetchCalls).toBe(1);
      const opts = mockState.lastCommFetchOpts as {
        filter?: string;
        fields?: string;
      };
      // All four comm-error aggregate dimensions, aggregate keys only
      // (no `/<featureId>` segment).
      expect(opts.filter).toContain('dimension = "d6"');
      expect(opts.filter).toContain('dimension = "d4"');
      expect(opts.filter).toContain('dimension = "e2e-demos"');
      expect(opts.filter).toContain('dimension = "d5-single-pill-e2e"');
      expect(opts.filter).toContain('key !~ "%/%"');
      // Full rows: NO fields projection — signal must come back.
      expect(opts.fields).toBeUndefined();
    });

    it("a supplemental row OLDER than its bulk twin does NOT regress the newer bulk row (CF8 F3)", async () => {
      // The supplemental fetch is kicked off CONCURRENTLY with the bulk
      // pages, so the bulk copy of an aggregate row can be NEWER (the row's
      // state changed between the two reads). The merge must not replace the
      // newer bulk core fields with the supplemental response's older
      // snapshot — and must not graft the older signal onto the newer row
      // either: the reducer's no-op check compares signal PRESENCE only, so
      // a chimera row (newer core + stale signal) could swallow the next SSE
      // delta carrying the real current signal. The newer bulk row survives
      // intact (signal-less); the live SSE subscription restores `signal`.
      const NEWER_OBSERVED_AT = new Date(Date.now() - 30_000).toISOString();
      const newerBulkRow = {
        ...aggregateRow,
        state: "red",
        observed_at: NEWER_OBSERVED_AT,
        transitioned_at: NEWER_OBSERVED_AT,
        fail_count: 1,
        first_failure_at: NEWER_OBSERVED_AT,
      };
      // Bulk snapshot carries the NEWER row (mock strips `signal` via the
      // fields projection, like real PB); the supplemental response carries
      // the OLDER signal-bearing snapshot.
      mockState.initial = [newerBulkRow];
      mockState.commAggregateRows = [aggregateRow];

      const { result } = renderHook(() => useLiveStatus());
      await waitFor(() => expect(result.current.status).toBe("live"));

      const agg = result.current.rows.find((r) => r.key === "d6:acme");
      expect(agg).toBeDefined();
      // The newer bulk core fields survive the merge...
      expect(agg?.state).toBe("red");
      expect(agg?.observed_at).toBe(NEWER_OBSERVED_AT);
      expect(agg?.fail_count).toBe(1);
      // ...and the OLDER supplemental signal is NOT backfilled (unsafe — see
      // the chimera rationale above).
      expect(agg?.signal).toBeUndefined();
    });

    it("a dimension scope OUTSIDE the aggregate set skips the supplemental fetch entirely", async () => {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await waitFor(() => expect(result.current.status).toBe("live"));
      expect(mockState.commFetchCalls).toBe(0);
    });

    it("a dimension scope INSIDE the aggregate set narrows the supplemental fetch to that dimension", async () => {
      mockState.commAggregateRows = [aggregateRow];
      const { result } = renderHook(() => useLiveStatus("d6"));
      await waitFor(() => expect(result.current.status).toBe("live"));
      expect(mockState.commFetchCalls).toBe(1);
      const opts = mockState.lastCommFetchOpts as { filter?: string };
      expect(opts.filter).toContain('dimension = "d6"');
      expect(opts.filter).not.toContain("e2e-demos");
      const agg = result.current.rows.find((r) => r.key === "d6:acme");
      expect(agg?.signal).toEqual(COMM_SIGNAL);
    });
  });
});
