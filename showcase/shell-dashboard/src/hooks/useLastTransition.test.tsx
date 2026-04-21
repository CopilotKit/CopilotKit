/**
 * `useLastTransition(key)` — lazy one-shot fetch of the newest
 * `status_history` row for a given PB key (spec §5.6).
 *
 * Fetches only when `enabled === true` (hover open). Cached per key for
 * the session; errors are cached for ~30s.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockState = {
  history: [] as Record<string, unknown>[],
  fetchCount: 0,
  shouldThrow: false,
};

vi.mock("../lib/pb", () => ({
  pbIsMisconfigured: false,
  PB_MISCONFIG_MESSAGE: "Dashboard misconfigured (test stub)",
  pb: {
    // pb.filter helper returns the rendered template for our tests.
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
      getList: vi.fn(
        async (
          _page: number,
          _perPage: number,
          _opts: { filter: string; sort: string },
        ) => {
          mockState.fetchCount += 1;
          if (mockState.shouldThrow) throw new Error("pb-unreachable");
          return {
            items: mockState.history,
            page: 1,
            perPage: 1,
            totalItems: 1,
            totalPages: 1,
          };
        },
      ),
    }),
  },
}));

import {
  useLastTransition,
  __clearLastTransitionCache,
  deriveFromTo,
} from "./useLastTransition";

describe("useLastTransition", () => {
  beforeEach(() => {
    __clearLastTransitionCache();
    mockState.history = [
      {
        id: "h1",
        key: "smoke:a/b",
        dimension: "smoke",
        transition: "green_to_red",
        state: "red",
        observed_at: "2026-04-20T14:02:00Z",
      },
    ];
    mockState.fetchCount = 0;
    mockState.shouldThrow = false;
  });

  it("does not fetch when enabled=false", async () => {
    renderHook(() => useLastTransition("smoke:a/b", false));
    await new Promise((r) => setTimeout(r, 10));
    expect(mockState.fetchCount).toBe(0);
  });

  it("fetches once when enabled=true and returns the newest row", async () => {
    const { result } = renderHook(() => useLastTransition("smoke:a/b", true));
    await waitFor(() => expect(result.current.row).not.toBeNull());
    expect(mockState.fetchCount).toBe(1);
    expect((result.current.row as { transition: string }).transition).toBe(
      "green_to_red",
    );
  });

  it("caches per key — second hover does not refetch", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLastTransition("smoke:a/b", enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.row).not.toBeNull());
    expect(mockState.fetchCount).toBe(1);

    // Toggle off then back on — cached, no refetch.
    act(() => {
      rerender({ enabled: false });
    });
    act(() => {
      rerender({ enabled: true });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockState.fetchCount).toBe(1);
  });

  it("returns null row when history is empty", async () => {
    mockState.history = [];
    const { result } = renderHook(() =>
      useLastTransition("smoke:nope/x", true),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.row).toBeNull();
  });

  it("caches error for ~30s — second hover does not re-fetch on failure", async () => {
    mockState.shouldThrow = true;
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLastTransition("smoke:err/x", enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(mockState.fetchCount).toBe(1);
    // Toggle off/on — should hit the error cache and NOT re-fetch.
    act(() => {
      rerender({ enabled: false });
    });
    act(() => {
      rerender({ enabled: true });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockState.fetchCount).toBe(1);
  });

  it("resets state when key changes while enabled=false", async () => {
    // Prime cache for key1 via an enabled fetch.
    mockState.history = [
      {
        id: "h1",
        key: "smoke:a/b",
        dimension: "smoke",
        transition: "green_to_red",
        state: "red",
        observed_at: "2026-04-20T14:02:00Z",
      },
    ];
    const { result, rerender } = renderHook(
      ({ k, e }: { k: string; e: boolean }) => useLastTransition(k, e),
      { initialProps: { k: "smoke:a/b", e: true } },
    );
    await waitFor(() =>
      expect(
        (result.current.row as { transition?: string } | null)?.transition,
      ).toBe("green_to_red"),
    );

    // Switch to a new key while enabled=false — the hook must clear the
    // stale row from the previous key rather than reporting it as ours.
    act(() => {
      rerender({ k: "smoke:other/x", e: false });
    });
    // Give the reset effect a tick to run.
    await waitFor(() => expect(result.current.row).toBeNull());
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("clears error state when a successful row replaces it", async () => {
    mockState.shouldThrow = true;
    const { result, rerender } = renderHook(
      ({ k, e }: { k: string; e: boolean }) => useLastTransition(k, e),
      { initialProps: { k: "smoke:k1", e: true } },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // Switch to a different key that succeeds — error for k1 must not leak
    // into the k2 result.
    mockState.shouldThrow = false;
    mockState.history = [
      {
        id: "h2",
        key: "smoke:k2",
        dimension: "smoke",
        transition: "red_to_green",
        state: "green",
        observed_at: "2026-04-20T14:05:00Z",
      },
    ];
    act(() => {
      rerender({ k: "smoke:k2", e: true });
    });
    await waitFor(() => expect(result.current.row).not.toBeNull());
    expect(result.current.error).toBeNull();
  });
});

describe("deriveFromTo", () => {
  it("parses green_to_red", () => {
    expect(deriveFromTo("green_to_red")).toEqual({ from: "green", to: "red" });
  });
  it("parses red_to_green", () => {
    expect(deriveFromTo("red_to_green")).toEqual({ from: "red", to: "green" });
  });
  it("sustained_* yields same-state pair", () => {
    expect(deriveFromTo("sustained_red")).toEqual({ from: "red", to: "red" });
    expect(deriveFromTo("sustained_green")).toEqual({
      from: "green",
      to: "green",
    });
  });
  it("first / error / unknown → nulls", () => {
    expect(deriveFromTo("first")).toEqual({ from: null, to: null });
    expect(deriveFromTo("error")).toEqual({ from: null, to: null });
    expect(deriveFromTo("what")).toEqual({ from: null, to: null });
  });
});
