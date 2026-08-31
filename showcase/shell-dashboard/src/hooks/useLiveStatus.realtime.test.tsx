/**
 * Realtime-path tests for `useLiveStatus` (mocked PocketBase SDK, per spec §7).
 *
 * Sibling to `useLiveStatus.test.tsx` — that file owns the initial-fetch and
 * reconnect-cadence coverage; THIS file owns the realtime SSE hardening landed
 * in the dashboard-robustness follow-up:
 *
 *   - A.1 flush-after-teardown guard: a buffered delta whose flush timer fires
 *     after the connection is torn down / mid-reconnect must NOT mutate state,
 *     and the pending buffer is dropped.
 *   - A.5 delete identity: a delete event legitimately has no `dimension` and
 *     may carry only an `id` (no `key`); it must NOT be skipped by the
 *     missing-dimension guard and must remove the matching row by key OR id.
 *   - A.4 degraded flapping detector: repeated heartbeat-driven reconnects
 *     inside the sliding window flip `degraded` true; a quiet feed stays false.
 *
 * The mock exposes `mockState.listener` so a test can synchronously inject SSE
 * events, and a `heartbeatFailRemaining` hook to drive reconnects — the same
 * seams the sibling mocked test uses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Action = "create" | "update" | "delete";
type Listener = (e: {
  action: Action;
  record: Record<string, unknown>;
}) => void;

const PB_PAGE_SIZE = 500;

const mockState = {
  initial: [] as Record<string, unknown>[],
  listener: null as Listener | null,
  heartbeatFailRemaining: 0,
  // Make the INITIAL paged fetch (perPage > 1) fail on demand so the reconnect
  // chain can be driven to terminal error.
  failRemaining: 0,
  getListCalls: 0,
  subscribeCalls: 0,
  unsubscribeCalls: 0,
};

function pageResponse(
  page: number,
  perPage: number,
): {
  items: Record<string, unknown>[];
  page: number;
  perPage: number;
} {
  const effPerPage = Math.min(perPage, PB_PAGE_SIZE);
  const start = (page - 1) * effPerPage;
  // skipTotal contract: no totalItems / totalPages in the response.
  return {
    items: mockState.initial.slice(start, start + effPerPage),
    page,
    perPage: effPerPage,
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
      getList: vi.fn(async (page: number, perPage: number) => {
        mockState.getListCalls += 1;
        if (perPage === 1) {
          if (mockState.heartbeatFailRemaining > 0) {
            mockState.heartbeatFailRemaining -= 1;
            throw new Error("heartbeat-fail");
          }
          return pageResponse(1, 1);
        }
        if (mockState.failRemaining > 0) {
          mockState.failRemaining -= 1;
          throw new Error("pb-unreachable");
        }
        return pageResponse(page, perPage);
      }),
      subscribe: vi.fn(async (_topic: string, cb: Listener) => {
        mockState.subscribeCalls += 1;
        mockState.listener = cb;
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

function row(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "1",
    key: "smoke:a/b",
    dimension: "smoke",
    state: "green",
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
    ...over,
  };
}

describe("useLiveStatus (realtime hardening)", () => {
  beforeEach(() => {
    mockState.initial = [];
    mockState.listener = null;
    mockState.heartbeatFailRemaining = 0;
    mockState.failRemaining = 0;
    mockState.getListCalls = 0;
    mockState.subscribeCalls = 0;
    mockState.unsubscribeCalls = 0;
  });

  it("A.5: applies a delete event that carries only an id (no dimension/key)", async () => {
    // A delete legitimately has no `dimension` (PB delete events deliver only
    // the record id), so it must be exempt from the missing-dimension guard,
    // and the pending-delta flush must match the existing row by id when the
    // event carries no key.
    mockState.initial = [row({ id: "1", key: "smoke:a/b" })];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => {
      // PB delete payload: id only, no dimension, no key.
      mockState.listener?.({ action: "delete", record: { id: "1" } });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
  });

  it("A.5: does not crash and skips a non-delete event missing any identity", async () => {
    mockState.initial = [row({ id: "1", key: "smoke:a/b" })];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      // update with no key and no id — undefined identity, must be skipped
      // without throwing or buffering a bogus op.
      mockState.listener?.({
        action: "update",
        record: { dimension: "smoke", state: "red" },
      });
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]!.state).toBe("green");
    // The missing-identity event must be skipped SILENTLY — not throw, not log.
    // Assert the error spy stayed untouched so a future regression that lets the
    // callback throw (and get caught + logged) is caught here.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("A-race: update→delete→update for the same row in ONE flush nets to the LAST update", async () => {
    // The id-only delete keys its buffer slot by `id`, the upserts by `key`.
    // Before the fix, these occupy DIFFERENT Map slots so BOTH survive a single
    // 16ms flush and apply in insertion order: the delete (buffered 2nd) lands
    // AFTER the final upsert's value was folded into the key-slot, so it deletes
    // a row the producer's LATEST event re-asserted. With per-row identity
    // normalization (id → key) the delete collapses into the upsert's slot and
    // the LAST-arrived op (the 2nd update) wins.
    mockState.initial = [row({ id: "1", key: "smoke:a/b", state: "green" })];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => {
      // All three land in the SAME flush window (16ms timer not yet fired).
      mockState.listener?.({
        action: "update",
        record: row({ id: "1", key: "smoke:a/b", state: "red" }),
      });
      // id-only delete (no key) for the same logical row.
      mockState.listener?.({ action: "delete", record: { id: "1" } });
      // Producer re-asserts the row with a fresh value — this is the LAST event.
      mockState.listener?.({
        action: "update",
        record: row({ id: "1", key: "smoke:a/b", state: "degraded" }),
      });
    });
    // Net result must equal the LAST event: row present, state "degraded".
    // Assert on the CHANGED state directly so waitFor polls until the 16ms
    // flush lands — a length check alone is satisfied by the stale initial row.
    await waitFor(() => expect(result.current.rows[0]!.state).toBe("degraded"));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]!.key).toBe("smoke:a/b");
  });

  it("A-race: update→delete (intent delete) in ONE flush nets to row absent", async () => {
    // The mirror case: when the LAST event for the row is the (id-only) delete,
    // the row must end ABSENT — the delete must not be superseded/swallowed by
    // the earlier upsert collapsing into the same slot.
    mockState.initial = [row({ id: "1", key: "smoke:a/b", state: "green" })];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => {
      mockState.listener?.({
        action: "update",
        record: row({ id: "1", key: "smoke:a/b", state: "red" }),
      });
      // id-only delete is the LAST event for this row.
      mockState.listener?.({ action: "delete", record: { id: "1" } });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
  });

  it("A.5: a delete matching no existing row does not drop a sibling upsert in the same flush", async () => {
    // Guards the flushPending delete-by-key-or-id branch: an unmatched delete
    // (findIndex === -1) must `continue` past WITHOUT consuming or skipping
    // sibling ops batched in the same flush. Here a delete for a non-existent
    // id is interleaved with a real upsert; the upsert must still land.
    mockState.initial = [row({ id: "1", key: "smoke:a/b", state: "green" })];
    const { result } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => {
      // Delete event whose id/key matches NO existing row.
      mockState.listener?.({
        action: "delete",
        record: { id: "does-not-exist" },
      });
      // Real upsert for a brand-new row, batched into the same flush window.
      mockState.listener?.({
        action: "create",
        record: row({ id: "2", key: "smoke:c/d", state: "red" }),
      });
    });
    // The unmatched delete must be a no-op; the sibling upsert must survive.
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((r) => r.key).sort()).toEqual([
      "smoke:a/b",
      "smoke:c/d",
    ]);
  });

  it("A.1: a flush scheduled before teardown does not mutate state after unmount", async () => {
    mockState.initial = [row({ id: "1", key: "smoke:a/b" })];
    const { result, unmount } = renderHook(() => useLiveStatus("smoke"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    const rowsBefore = result.current.rows;
    // Buffer a delta but DO NOT advance the 16ms flush timer yet.
    act(() => {
      mockState.listener?.({
        action: "update",
        record: row({ id: "1", key: "smoke:a/b", state: "red" }),
      });
    });
    // Tear down before the flush timer fires.
    unmount();
    // Let any pending timers run.
    await new Promise((r) => setTimeout(r, 30));
    // State must be untouched — the post-teardown flush is a no-op.
    expect(result.current.rows).toBe(rowsBefore);
    expect(result.current.rows[0]!.state).toBe("green");
  });

  it("A.1: no stale heartbeat / flush timer fires after a terminal error", async () => {
    vi.useFakeTimers();
    try {
      mockState.initial = [row({ id: "1", key: "smoke:a/b" })];
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));

      // Force the reconnect chain to exhaust: heartbeat fails, then every
      // retry initial-fetch also fails until MAX_RECONNECT_ATTEMPTS → error.
      mockState.heartbeatFailRemaining = 1;
      mockState.failRemaining = 100;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await vi.waitFor(() => expect(result.current.status).toBe("error"));

      // After the terminal error, no heartbeat timer may survive — advancing
      // well past several heartbeat intervals must not issue any more getList
      // calls (a stale heartbeat pinging a dead connection).
      const callsAtError = mockState.getListCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(mockState.getListCalls).toBe(callsAtError);
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it("A.4: degraded stays false on a quiet feed", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      // No heartbeat failures: advance through several intervals.
      for (let i = 0; i < 6; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
      }
      expect(result.current.status).toBe("live");
      expect(result.current.degraded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("A.4: degraded flips true after rapid repeated heartbeat reconnects", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(result.current.degraded).toBe(false);

      // Drive several heartbeat-triggered reconnects in quick succession. Each
      // heartbeat tick fails once, forces a reconnect that immediately
      // re-establishes (initial fetch + subscribe succeed), then the next
      // heartbeat fails again. Enough of these inside the sliding window must
      // exceed FLAPPING_THRESHOLD and flip `degraded`.
      for (let i = 0; i < 5; i++) {
        mockState.heartbeatFailRemaining = 1;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
        await vi.waitFor(() => expect(result.current.status).toBe("live"));
      }
      expect(result.current.degraded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("A.4: degraded boundary — exactly FLAPPING_THRESHOLD reconnects stay false, the next flips true", async () => {
    // Pins the `> FLAPPING_THRESHOLD` (not `>=`) semantics: with threshold 3,
    // exactly 3 heartbeat-driven reconnects inside the window must keep
    // `degraded === false`, and only the 4th flips it `true`. A `>`→`>=`
    // regression would trip degraded one reconnect early and fail here.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(result.current.degraded).toBe(false);

      // Drive exactly 3 (== FLAPPING_THRESHOLD) heartbeat-driven reconnects.
      for (let i = 0; i < 3; i++) {
        mockState.heartbeatFailRemaining = 1;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
        await vi.waitFor(() => expect(result.current.status).toBe("live"));
      }
      // At exactly the threshold, `> FLAPPING_THRESHOLD` is still false.
      expect(result.current.degraded).toBe(false);

      // The 4th reconnect pushes the window PAST the threshold → flips true.
      mockState.heartbeatFailRemaining = 1;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(result.current.degraded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("A.4: degraded clears once flapping stops and the window ages out", async () => {
    // Regression (A1): `degraded` must be RECOMPUTED on a non-failure cadence,
    // not only on a heartbeat FAILURE. Once the feed recovers and heartbeats
    // succeed, the reconnect-timestamp window must prune and `degraded` must
    // return to false on its own — without needing another failure to trigger
    // the recompute. Previously `setDegraded` ran only inside
    // recordHeartbeatReconnect (failure-only), so a recovered feed was stuck
    // `degraded === true` forever.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(result.current.degraded).toBe(false);

      // Flip `degraded` true with rapid heartbeat-driven reconnects.
      for (let i = 0; i < 5; i++) {
        mockState.heartbeatFailRemaining = 1;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
        await vi.waitFor(() => expect(result.current.status).toBe("live"));
      }
      expect(result.current.degraded).toBe(true);

      // Feed recovers: heartbeats now SUCCEED. Advance past FLAPPING_WINDOW_MS
      // (5 min) so every stamp ages out. `degraded` must clear WITHOUT any
      // further failure driving the recompute.
      mockState.heartbeatFailRemaining = 0;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000 + 31_000);
      });
      expect(result.current.status).toBe("live");
      expect(result.current.degraded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("C-F4a + G1: a feed that dies while degraded clears degraded, empties rows, and sets error", async () => {
    // C-F4a: `degraded` must NOT stay stuck `true` after a TERMINAL connection
    // error. The only thing that lowers `degraded` (pruneAndRecomputeDegraded)
    // is driven by the heartbeat success path, but the terminal-error branch
    // calls clearHeartbeat() — so a feed that was flapping (degraded === true)
    // and then exhausts MAX_RECONNECT_ATTEMPTS into status: "error" would keep
    // degraded === true forever. A dead connection is offline, not flapping;
    // the terminal-error branch must reset degraded to false.
    //
    // G1: the same terminal-error branch clears setRows([]) (anti-stale-green,
    // §5.3) and sets `error`. Assert rows are emptied and error is set after
    // reaching "error".
    vi.useFakeTimers();
    try {
      mockState.initial = [row({ id: "1", key: "smoke:a/b" })];
      const { result } = renderHook(() => useLiveStatus("smoke"));
      await vi.waitFor(() => expect(result.current.status).toBe("live"));
      expect(result.current.degraded).toBe(false);
      await vi.waitFor(() => expect(result.current.rows).toHaveLength(1));

      // Phase 1: flip `degraded` true with rapid heartbeat-driven reconnects.
      // Each heartbeat tick fails once, forces a reconnect that immediately
      // re-establishes, then the next heartbeat fails — enough churn inside the
      // sliding window to exceed FLAPPING_THRESHOLD.
      for (let i = 0; i < 5; i++) {
        mockState.heartbeatFailRemaining = 1;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000);
        });
        await vi.waitFor(() => expect(result.current.status).toBe("live"));
      }
      expect(result.current.degraded).toBe(true);

      // Phase 2: drive the connection to TERMINAL error. The next heartbeat
      // fails AND every reconnect initial-fetch also fails until the chain
      // exhausts MAX_RECONNECT_ATTEMPTS → status: "error".
      mockState.heartbeatFailRemaining = 1;
      mockState.failRemaining = 100;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await vi.waitFor(() => expect(result.current.status).toBe("error"));

      // C-F4a: a terminally-offline feed is offline, not degraded.
      expect(result.current.degraded).toBe(false);
      // G1: anti-stale-green — rows emptied, error surfaced.
      expect(result.current.rows).toEqual([]);
      expect(result.current.error).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it("StrictMode: a keyless delete resolves id→key against COMMITTED rows after a prior flush mutated state", async () => {
    // Behavioral companion to the source-level React-purity test below. The
    // id→key resolution mirror used by the SSE callback for a keyless delete
    // MUST track the actually-committed `rows`. The fix moved that mirror out of
    // the `setRows` updater body (where it was an impure closure assignment)
    // into a `useRef` updated by a post-commit effect. This test renders the
    // hook under React.StrictMode (double-invoked updater, mount→unmount→remount
    // effect cycle) and asserts the keyless-delete path is still correct under
    // that stricter runtime — locking that the ref + post-commit effect mirror
    // stays in lockstep with committed state across a StrictMode remount. (The
    // DETERMINISTIC red-green that fails on the impure in-reducer assignment is
    // the source-purity test below; jsdom/RTL re-invokes the updater with the
    // SAME prev, so it cannot force the concurrent-replay desync at runtime.)
    //
    // Scenario that requires the COMMITTED-state mirror (NOT the same-window
    // pendingByKey scan): a row arrives via an upsert flush in window #1 (its
    // pending op is gone once that flush commits), THEN a keyless delete for
    // that same row arrives in a SEPARATE window #2 — its key is no longer in
    // pendingByKey, so it can only resolve via the committed-rows mirror. If the
    // mirror desynced under StrictMode's double-invoke, the delete resolves
    // nothing and the row wrongly survives.
    mockState.initial = [];
    const { result } = renderHook(() => useLiveStatus("smoke"), {
      wrapper: StrictMode,
    });
    await waitFor(() => expect(result.current.status).toBe("live"));

    // Window #1: upsert a brand-new row (id "9", key "smoke:x/y"). Let the 16ms
    // flush commit so the row lands in state and the post-commit effect syncs
    // the mirror — and the upsert's pending op is cleared from pendingByKey.
    act(() => {
      mockState.listener?.({
        action: "create",
        record: row({ id: "9", key: "smoke:x/y", state: "green" }),
      });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]!.key).toBe("smoke:x/y");

    // Window #2 (separate flush): keyless delete carrying ONLY the id. Its key
    // must resolve from the committed-rows mirror (pendingByKey no longer holds
    // the upsert). With the pure ref+effect mirror this resolves correctly and
    // the row is removed; an impure desynced mirror would miss it.
    act(() => {
      mockState.listener?.({ action: "delete", record: { id: "9" } });
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
  });

  it("React-purity: no setRows updater body assigns to a closure mirror (reducer is pure)", () => {
    // Deterministic guard for the React-purity fix. The bug being fixed was an
    // IMPURE `setRows` updater that advanced a closure mirror (`latestRows`)
    // INSIDE its body (`setRows(prev => { ...; latestRows = next; return ... })`).
    // Under StrictMode double-invoke / a discarded concurrent render the updater
    // can run multiple times or be discarded, so a side-effecting assignment in
    // the body leaves the mirror diverged from committed state. A runtime React
    // test in jsdom cannot deterministically force the concurrent-replay that
    // exposes the desync (StrictMode re-invokes the updater with the SAME prev,
    // masking it), so we lock the invariant at the SOURCE: every `setRows(...)`
    // call's updater body must be PURE — it may read closures, but must not
    // ASSIGN to one. This is RED if the `latestRows = ...`-in-updater pattern is
    // reintroduced and GREEN with the ref + post-commit-effect mirror.
    // Resolve the hook source relative to this test file's directory. Vitest
    // sets the working dir to the package root and exposes the test dir on
    // `import.meta.dirname`.
    const src = readFileSync(
      join(import.meta.dirname, "useLiveStatus.ts"),
      "utf8",
    );
    // Extract every functional-updater body: `setRows((prev) => { ... })`.
    // Match the balanced-ish block conservatively up to the closing `});` that
    // terminates the setRows call (the updater bodies here are single-statement
    // or brace blocks ending in `});`).
    const updaterBodies = [
      ...src.matchAll(
        /setRows\(\s*\(\s*\w+\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/g,
      ),
    ].map((m) => m[1]!);
    expect(updaterBodies.length).toBeGreaterThan(0);
    for (const body of updaterBodies) {
      // Strip line comments so a comment that merely MENTIONS the old pattern
      // doesn't trip the assertion.
      const code = body.replace(/\/\/.*$/gm, "");
      // A bare assignment to an outer closure variable (NOT `let`/`const`/`var`
      // declaration, NOT a comparison/arrow) is the impurity we forbid. We
      // specifically forbid assigning to the historical `latestRows` mirror or
      // any `*Rows`/`*Ref` closure from inside the updater body.
      expect(code).not.toMatch(/latestRows\s*=/);
      expect(code).not.toMatch(/\browsRef\b/);
    }
  });
});
