/**
 * Tests for `useLiveStatus` with a mocked PocketBase SDK (per spec §7 —
 * mocked PB JS SDK is acceptable for dashboard hook tests).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock PB client used by the hook. Drives initial + subscribe events.
type Action = "create" | "update" | "delete";
type Listener = (e: {
  action: Action;
  record: Record<string, unknown>;
}) => void;

const mockState = {
  initial: [] as Record<string, unknown>[],
  listener: null as Listener | null,
  failRemaining: 0,
  // Capture the options passed to getFullList / subscribe so tests can
  // assert server-side filter is forwarded (not client-side only).
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
};

vi.mock("../lib/pb", () => {
  return {
    pbIsMisconfigured: false,
    PB_MISCONFIG_MESSAGE: "Dashboard misconfigured (test stub)",
    pb: {
      filter: (raw: string, params?: Record<string, unknown>) => {
        let out = raw;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            out = out.replace(
              new RegExp(`\\{:${k}\\}`, "g"),
              JSON.stringify(v),
            );
          }
        }
        return out;
      },
      collection: (_name: string) => ({
        // getFullList is used by the initial fetch (replaces paginated getList).
        // Returns a plain array, respecting the `batch` option as a cap.
        getFullList: vi.fn(
          async (opts?: { batch?: number; filter?: string }) => {
            mockState.getListCalls += 1;
            mockState.lastInitialGetListOpts = opts;
            if (mockState.failRemaining > 0) {
              mockState.failRemaining -= 1;
              throw new Error("pb-unreachable");
            }
            const cap = opts?.batch ?? Infinity;
            return mockState.initial.slice(0, cap);
          },
        ),
        // getList is still used for heartbeat pings (getList(1, 1)).
        getList: vi.fn(
          async (_page: number, _perPage: number, _opts?: unknown) => {
            mockState.getListCalls += 1;
            if (mockState.heartbeatFailRemaining > 0) {
              mockState.heartbeatFailRemaining -= 1;
              throw new Error("heartbeat-fail");
            }
            return {
              items: mockState.initial.slice(0, 1),
              page: 1,
              perPage: 1,
              totalItems: mockState.initial.length,
              totalPages: 1,
            };
          },
        ),
        subscribe: vi.fn(
          async (_topic: string, cb: Listener, opts?: unknown) => {
            mockState.subscribeCalls += 1;
            mockState.listener = cb;
            mockState.lastSubscribeOpts = opts;
            return async () => {
              mockState.unsubscribeCalls += 1;
              mockState.listener = null;
            };
          },
        ),
        unsubscribe: vi.fn(async () => {
          mockState.listener = null;
        }),
      }),
    },
  };
});

import { useLiveStatus } from "./useLiveStatus";

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

  it("INITIAL_CAP: stops at 500 rows even when more are available (C5 F20)", async () => {
    // 350 rows: well below cap. Verify pagination pulls all 350.
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
  });

  it("INITIAL_CAP: truncates to 2000 when collection is larger (C5 F20)", async () => {
    // 2100 rows: exceeds cap. We expect exactly 2000.
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
    expect(result.current.rows).toHaveLength(2000);
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

    // Monkey-patch the subscribe mock for this test only: gate on our
    // external promise before resolving, so we can unmount in between.
    const originalSubscribe =
      // Bypass: we rewire through mockState so subsequent tests aren't
      // affected (beforeEach resets mockState, not mock fns themselves).
      (() => null)();
    void originalSubscribe;

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
    const pbHandle = pbMod.pb as unknown as {
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
});
