/**
 * Tests for `useProbes`, `useProbeDetail`, and `useTriggerProbe`.
 *
 * These hooks wrap the `lib/ops-api` client and add 10s polling +
 * AbortController-based cancellation. We mock the client module so the
 * tests focus on hook semantics (interval cadence, abort-on-unmount,
 * error surfaces, refetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import type {
  ProbesResponse,
  ProbeScheduleEntry,
  ProbeRun,
  TriggerResponse,
} from "../lib/ops-api";

// Mocked module — the hooks under test consume this.
vi.mock("../lib/ops-api", () => {
  return {
    fetchProbes: vi.fn(),
    fetchProbeDetail: vi.fn(),
    triggerProbe: vi.fn(),
  };
});

import * as opsApi from "../lib/ops-api";
import {
  useProbes,
  useProbeDetail,
  useTriggerProbe,
} from "./use-probes";

const fetchProbesMock = opsApi.fetchProbes as unknown as ReturnType<typeof vi.fn>;
const fetchProbeDetailMock = opsApi.fetchProbeDetail as unknown as ReturnType<
  typeof vi.fn
>;
const triggerProbeMock = opsApi.triggerProbe as unknown as ReturnType<typeof vi.fn>;

function emptyProbes(): ProbesResponse {
  return { probes: [] };
}

function entry(id: string): ProbeScheduleEntry {
  return {
    id,
    kind: id,
    schedule: "*/5 * * * *",
    nextRunAt: null,
    lastRun: null,
    inflight: null,
    config: { timeout_ms: 60_000, max_concurrency: 5, discovery: null },
  };
}

function run(id: string): ProbeRun {
  return {
    id,
    probeId: "smoke",
    startedAt: "2026-04-25T11:55:00Z",
    finishedAt: "2026-04-25T11:55:30Z",
    durationMs: 30_000,
    triggered: false,
    summary: { total: 1, passed: 1, failed: 0 },
  };
}

beforeEach(() => {
  fetchProbesMock.mockReset();
  fetchProbeDetailMock.mockReset();
  triggerProbeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useProbes", () => {
  it("fetches once on mount and exposes the data", async () => {
    fetchProbesMock.mockResolvedValue({ probes: [entry("smoke")] });
    const { result } = renderHook(() => useProbes());
    expect(result.current.loading).toBe(true);
    await waitFor(() =>
      expect(result.current.data?.probes).toHaveLength(1),
    );
    expect(result.current.loading).toBe(false);
    expect(fetchProbesMock).toHaveBeenCalledTimes(1);
  });

  it("polls on the configured interval (default 10s)", async () => {
    vi.useFakeTimers();
    fetchProbesMock.mockResolvedValue(emptyProbes());
    const { result } = renderHook(() => useProbes());
    await vi.waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetchProbesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchProbesMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchProbesMock).toHaveBeenCalledTimes(3);
  });

  it("honors a custom intervalMs", async () => {
    vi.useFakeTimers();
    fetchProbesMock.mockResolvedValue(emptyProbes());
    const { result } = renderHook(() => useProbes({ intervalMs: 1000 }));
    await vi.waitFor(() => expect(result.current.data).not.toBeNull());
    const before = fetchProbesMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fetchProbesMock.mock.calls.length).toBeGreaterThanOrEqual(
      before + 3,
    );
  });

  it("surfaces errors on the `error` field without throwing", async () => {
    fetchProbesMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useProbes());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.loading).toBe(false);
  });

  it("refetch triggers an immediate fetch", async () => {
    fetchProbesMock.mockResolvedValue(emptyProbes());
    const { result } = renderHook(() => useProbes());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetchProbesMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchProbesMock).toHaveBeenCalledTimes(2);
  });

  it("aborts inflight fetch on unmount", async () => {
    fetchProbesMock.mockImplementation(
      ({ signal }: { signal?: AbortSignal } = {}) =>
        new Promise<ProbesResponse>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const { unmount } = renderHook(() => useProbes());
    await waitFor(() => expect(fetchProbesMock).toHaveBeenCalled());
    const init = fetchProbesMock.mock.calls[0]![0] as {
      signal?: AbortSignal;
    };
    expect(init.signal).toBeDefined();
    unmount();
    expect(init.signal?.aborted).toBe(true);
  });

  it("does not surface a state update after unmount", async () => {
    let resolve: ((v: ProbesResponse) => void) | null = null;
    fetchProbesMock.mockImplementation(
      () =>
        new Promise<ProbesResponse>((r) => {
          resolve = r;
        }),
    );
    const { result, unmount } = renderHook(() => useProbes());
    await waitFor(() => expect(fetchProbesMock).toHaveBeenCalled());
    unmount();
    // After unmount, resolve the pending fetch; the hook must not crash.
    resolve!(emptyProbes());
    // No assertion on result.current after unmount — just confirm no throw.
    expect(result.current.data).toBeNull();
  });

  it("forwards baseUrl to the client", async () => {
    fetchProbesMock.mockResolvedValue(emptyProbes());
    renderHook(() => useProbes({ baseUrl: "http://ops.test" }));
    await waitFor(() => expect(fetchProbesMock).toHaveBeenCalled());
    const arg = fetchProbesMock.mock.calls[0]![0] as { baseUrl?: string };
    expect(arg.baseUrl).toBe("http://ops.test");
  });
});

describe("useProbeDetail", () => {
  it("does NOT fetch when id is null", async () => {
    const { result } = renderHook(() => useProbeDetail(null));
    // Give microtasks a chance to flush.
    await Promise.resolve();
    expect(fetchProbeDetailMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("fetches when id is provided and exposes data", async () => {
    fetchProbeDetailMock.mockResolvedValue({
      probe: entry("smoke"),
      runs: [run("r1")],
    });
    const { result } = renderHook(() => useProbeDetail("smoke"));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.probe.id).toBe("smoke");
    expect(result.current.data?.runs).toHaveLength(1);
  });

  it("refetches on id change and aborts previous request", async () => {
    fetchProbeDetailMock.mockResolvedValue({
      probe: entry("smoke"),
      runs: [],
    });
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useProbeDetail(id),
      { initialProps: { id: "smoke" as string | null } },
    );
    await waitFor(() => expect(fetchProbeDetailMock).toHaveBeenCalled());
    const firstSignal = (
      fetchProbeDetailMock.mock.calls[0]![1] as { signal?: AbortSignal }
    ).signal;

    fetchProbeDetailMock.mockResolvedValue({
      probe: entry("e2e_demos"),
      runs: [],
    });
    rerender({ id: "e2e_demos" });
    await waitFor(() =>
      expect(fetchProbeDetailMock.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    // Previous signal must have been aborted by the id change.
    expect(firstSignal?.aborted).toBe(true);
  });

  it("polls on the configured interval", async () => {
    vi.useFakeTimers();
    fetchProbeDetailMock.mockResolvedValue({
      probe: entry("smoke"),
      runs: [],
    });
    const { result } = renderHook(() =>
      useProbeDetail("smoke", { intervalMs: 1000 }),
    );
    await vi.waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetchProbeDetailMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(fetchProbeDetailMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("surfaces errors on `error` field", async () => {
    fetchProbeDetailMock.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useProbeDetail("smoke"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("nope");
  });
});

describe("useTriggerProbe", () => {
  function triggerOk(): TriggerResponse {
    return {
      runId: "run-1",
      status: "queued",
      probe: "smoke",
      scope: [],
    };
  }

  it("invokes triggerProbe with id, slugs, token", async () => {
    triggerProbeMock.mockResolvedValue(triggerOk());
    const { result } = renderHook(() =>
      useTriggerProbe({ token: "secret", baseUrl: "http://ops.test" }),
    );
    const captured: { value: TriggerResponse | null } = { value: null };
    await act(async () => {
      captured.value = await result.current.trigger("smoke", ["agno"]);
    });
    expect(captured.value?.runId).toBe("run-1");
    expect(triggerProbeMock).toHaveBeenCalledWith("smoke", {
      slugs: ["agno"],
      token: "secret",
      baseUrl: "http://ops.test",
    });
  });

  it("tracks pending state across the call", async () => {
    let resolve: ((v: TriggerResponse) => void) | null = null;
    triggerProbeMock.mockImplementation(
      () =>
        new Promise<TriggerResponse>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() =>
      useTriggerProbe({ token: "t" }),
    );
    expect(result.current.pending).toBe(false);
    let p: Promise<TriggerResponse>;
    act(() => {
      p = result.current.trigger("smoke");
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    act(() => {
      resolve!(triggerOk());
    });
    await act(async () => {
      await p!;
    });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("surfaces error and rejects the call", async () => {
    triggerProbeMock.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHook(() => useTriggerProbe({ token: "t" }));
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.trigger("smoke");
      } catch (err) {
        caught = err;
      }
    });
    expect((caught as Error)?.message).toBe("forbidden");
    await waitFor(() =>
      expect(result.current.error?.message).toBe("forbidden"),
    );
    expect(result.current.pending).toBe(false);
  });

  it("throws if invoked without a token", async () => {
    const { result } = renderHook(() => useTriggerProbe());
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.trigger("smoke");
      } catch (err) {
        caught = err;
      }
    });
    expect((caught as Error)?.message).toMatch(/token/i);
  });
});
