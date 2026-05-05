/**
 * Tests for `useBaseline` — PocketBase data hook for the Baseline tab.
 * Mocked PB JS SDK (same pattern as useLiveStatus.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/* ------------------------------------------------------------------ */
/*  Mock state                                                         */
/* ------------------------------------------------------------------ */

type Action = "create" | "update" | "delete";
type Listener = (e: {
  action: Action;
  record: Record<string, unknown>;
}) => void;

const mockState = {
  initial: [] as Record<string, unknown>[],
  listener: null as Listener | null,
  failRemaining: 0,
  getFullListCalls: 0,
  subscribeCalls: 0,
  unsubscribeCalls: 0,
  updateCalls: [] as Array<{ id: string; data: Record<string, unknown> }>,
  updateFailNext: false,
};

// Updated: useBaseline now calls getFullList({batch: 1000}) instead of
// paginated getList. Mock returns a plain array (same as useLiveStatus pattern).
vi.mock("../../lib/pb", () => {
  return {
    pbIsMisconfigured: false,
    PB_MISCONFIG_MESSAGE: "Dashboard misconfigured (test stub)",
    pb: {
      collection: (_name: string) => ({
        getFullList: vi.fn(async () => {
          mockState.getFullListCalls += 1;
          if (mockState.failRemaining > 0) {
            mockState.failRemaining -= 1;
            throw new Error("PB getFullList failed");
          }
          return [...mockState.initial];
        }),
        subscribe: vi.fn(async (_topic: string, cb: Listener) => {
          mockState.subscribeCalls += 1;
          mockState.listener = cb;
          return async () => {
            mockState.unsubscribeCalls += 1;
            mockState.listener = null;
          };
        }),
        update: vi.fn(async (id: string, data: Record<string, unknown>) => {
          mockState.updateCalls.push({ id, data });
          if (mockState.updateFailNext) {
            mockState.updateFailNext = false;
            throw new Error("PB update failed");
          }
          return { ...data, id };
        }),
      }),
    },
  };
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resetMock(): void {
  mockState.initial = [];
  mockState.listener = null;
  mockState.failRemaining = 0;
  mockState.getFullListCalls = 0;
  mockState.subscribeCalls = 0;
  mockState.unsubscribeCalls = 0;
  mockState.updateCalls = [];
  mockState.updateFailNext = false;
}

function makeCell(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec_1",
    key: "langchain-python::beautiful-chat",
    partner: "langchain-python",
    feature: "beautiful-chat",
    status: "works",
    tags: [],
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: "seed",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Import after mock                                                  */
/* ------------------------------------------------------------------ */

import { useBaseline } from "../useBaseline";

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("useBaseline", () => {
  beforeEach(() => {
    resetMock();
  });

  it("is exported as a function", () => {
    expect(typeof useBaseline).toBe("function");
  });

  it("transitions connecting -> live and exposes initial cells", async () => {
    const cell = makeCell();
    mockState.initial = [cell];

    const { result } = renderHook(() => useBaseline());

    expect(result.current.status).toBe("connecting");

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    expect(result.current.cells.size).toBe(1);
    expect(result.current.cells.get(cell.key as string)).toMatchObject({
      key: cell.key,
      status: "works",
    });
    expect(result.current.error).toBeNull();
  });

  // Updated: SSE events are now batched with a 100ms flush timer, so we
  // need waitFor to allow the async flush to complete before asserting.
  it("handles SSE create events", async () => {
    mockState.initial = [makeCell()];

    const { result } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    const newCell = makeCell({
      id: "rec_2",
      key: "mastra::reasoning",
      partner: "mastra",
      feature: "reasoning",
    });

    act(() => {
      mockState.listener?.({ action: "create", record: newCell });
    });

    await waitFor(() => {
      expect(result.current.cells.size).toBe(2);
    });
    expect(result.current.cells.get("mastra::reasoning")).toMatchObject({
      partner: "mastra",
    });
  });

  it("handles SSE update events", async () => {
    const cell = makeCell();
    mockState.initial = [cell];

    const { result } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    const updated = { ...cell, status: "impossible" };
    act(() => {
      mockState.listener?.({ action: "update", record: updated });
    });

    await waitFor(() => {
      expect(result.current.cells.get(cell.key as string)).toMatchObject({
        status: "impossible",
      });
    });
  });

  it("handles SSE delete events", async () => {
    const cell = makeCell();
    mockState.initial = [cell];

    const { result } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    act(() => {
      mockState.listener?.({ action: "delete", record: cell });
    });

    await waitFor(() => {
      expect(result.current.cells.size).toBe(0);
    });
  });

  it("enters error state after max reconnect attempts", async () => {
    // All 3 attempts will fail (connect, retry 1, retry 2)
    mockState.failRemaining = 10;

    const { result } = renderHook(() => useBaseline());

    await waitFor(
      () => {
        expect(result.current.status).toBe("error");
      },
      { timeout: 15000 },
    );
    expect(result.current.cells.size).toBe(0);
    expect(result.current.error).toBeTruthy();
  });

  it("updateCell performs optimistic update and calls PB", async () => {
    const cell = makeCell();
    mockState.initial = [cell];

    const { result } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    await act(async () => {
      await result.current.updateCell(cell.key as string, "possible", ["cpk"]);
    });

    expect(result.current.cells.get(cell.key as string)).toMatchObject({
      status: "possible",
      tags: ["cpk"],
    });
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0].id).toBe("rec_1");
    expect(mockState.updateCalls[0].data.status).toBe("possible");
  });

  it("updateCell reverts on PB error", async () => {
    const cell = makeCell();
    mockState.initial = [cell];

    const { result } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    mockState.updateFailNext = true;

    await act(async () => {
      try {
        await result.current.updateCell(cell.key as string, "impossible", []);
      } catch {
        // Expected
      }
    });

    // Should revert to original
    expect(result.current.cells.get(cell.key as string)).toMatchObject({
      status: "works",
      tags: [],
    });
  });

  it("updateCell throws for unknown key", async () => {
    mockState.initial = [];

    const { result } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    await expect(
      result.current.updateCell("nonexistent::key", "works", []),
    ).rejects.toThrow(/No baseline cell found/);
  });

  it("cleans up subscription on unmount", async () => {
    mockState.initial = [makeCell()];

    const { result, unmount } = renderHook(() => useBaseline());

    await waitFor(() => {
      expect(result.current.status).toBe("live");
    });

    unmount();

    expect(mockState.unsubscribeCalls).toBe(1);
  });
});
