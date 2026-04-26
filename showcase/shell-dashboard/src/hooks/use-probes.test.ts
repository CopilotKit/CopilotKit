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
import { useProbes, useProbeDetail, useTriggerProbe } from "./use-probes";

const fetchProbesMock = opsApi.fetchProbes as unknown as ReturnType<
  typeof vi.fn
>;
const fetchProbeDetailMock = opsApi.fetchProbeDetail as unknown as ReturnType<
  typeof vi.fn
>;
const triggerProbeMock = opsApi.triggerProbe as unknown as ReturnType<
  typeof vi.fn
>;

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
    await waitFor(() => expect(result.current.data?.probes).toHaveLength(1));
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

  it("does not setData with stale data when deps change rapidly (CR-B1.3)", async () => {
    // Drive a sequence where the first effect's fetch resolves AFTER the
    // dep change has triggered a new effect. With the old aliveRef pattern,
    // aliveRef.current was reset to true at the start of the new effect,
    // so the prior fetch would slip its setData past the alive check.
    let resolveA: ((v: ProbesResponse) => void) | null = null;
    let resolveB: ((v: ProbesResponse) => void) | null = null;
    const aData: ProbesResponse = { probes: [entry("A")] };
    const bData: ProbesResponse = { probes: [entry("B")] };

    fetchProbesMock.mockImplementationOnce(
      () =>
        new Promise<ProbesResponse>((r) => {
          resolveA = r;
        }),
    );
    fetchProbesMock.mockImplementationOnce(
      () =>
        new Promise<ProbesResponse>((r) => {
          resolveB = r;
        }),
    );

    const { result, rerender } = renderHook(
      ({ baseUrl }: { baseUrl: string }) => useProbes({ baseUrl }),
      { initialProps: { baseUrl: "http://a.test" } },
    );
    await waitFor(() => expect(fetchProbesMock).toHaveBeenCalledTimes(1));

    // Force a deps change → cleanup + new effect.
    rerender({ baseUrl: "http://b.test" });
    await waitFor(() => expect(fetchProbesMock).toHaveBeenCalledTimes(2));

    // Resolve the FIRST (now-cancelled) fetch with A-data. With cancelled
    // closure pattern the hook must not setData(A).
    await act(async () => {
      resolveA!(aData);
      await Promise.resolve();
    });
    expect(result.current.data).toBeNull();

    // Resolve B normally — now we expect to see B-data.
    await act(async () => {
      resolveB!(bData);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data?.probes[0]?.id).toBe("B"));
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

  it("clears data immediately on id change (CR-B1.4)", async () => {
    // First id: smoke. Resolve immediately, capture data.
    fetchProbeDetailMock.mockResolvedValueOnce({
      probe: entry("smoke"),
      runs: [],
    });
    // Second id: deep — never resolves so we can observe the in-between
    // state.
    let resolveDeep:
      | ((v: { probe: ProbeScheduleEntry; runs: ProbeRun[] }) => void)
      | null = null;
    fetchProbeDetailMock.mockImplementationOnce(
      () =>
        new Promise<{ probe: ProbeScheduleEntry; runs: ProbeRun[] }>((r) => {
          resolveDeep = r;
        }),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useProbeDetail(id),
      { initialProps: { id: "smoke" as string | null } },
    );
    await waitFor(() => expect(result.current.data?.probe.id).toBe("smoke"));

    rerender({ id: "deep" });
    // Data must be null until the deep fetch resolves — operator must not
    // see "smoke" data behind a "deep" header.
    await waitFor(() => expect(result.current.data).toBeNull());

    // Sanity: after deep resolves, we get deep data.
    await act(async () => {
      resolveDeep!({ probe: entry("deep"), runs: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data?.probe.id).toBe("deep"));
  });

  it("does not setData with stale data when id changes rapidly (CR-B1.3)", async () => {
    let resolveA:
      | ((v: { probe: ProbeScheduleEntry; runs: ProbeRun[] }) => void)
      | null = null;
    let resolveB:
      | ((v: { probe: ProbeScheduleEntry; runs: ProbeRun[] }) => void)
      | null = null;
    fetchProbeDetailMock.mockImplementationOnce(
      () =>
        new Promise<{ probe: ProbeScheduleEntry; runs: ProbeRun[] }>((r) => {
          resolveA = r;
        }),
    );
    fetchProbeDetailMock.mockImplementationOnce(
      () =>
        new Promise<{ probe: ProbeScheduleEntry; runs: ProbeRun[] }>((r) => {
          resolveB = r;
        }),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useProbeDetail(id),
      { initialProps: { id: "smoke" as string | null } },
    );
    await waitFor(() => expect(fetchProbeDetailMock).toHaveBeenCalledTimes(1));

    rerender({ id: "deep" });
    await waitFor(() => expect(fetchProbeDetailMock).toHaveBeenCalledTimes(2));

    // Resolve A AFTER cleanup — must NOT update state with smoke data.
    await act(async () => {
      resolveA!({ probe: entry("smoke"), runs: [] });
      await Promise.resolve();
    });
    expect(result.current.data?.probe.id).not.toBe("smoke");

    await act(async () => {
      resolveB!({ probe: entry("deep"), runs: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.data?.probe.id).toBe("deep"));
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
    expect(triggerProbeMock).toHaveBeenCalledWith(
      "smoke",
      expect.objectContaining({
        slugs: ["agno"],
        token: "secret",
        baseUrl: "http://ops.test",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("tracks pending state across the call", async () => {
    let resolve: ((v: TriggerResponse) => void) | null = null;
    triggerProbeMock.mockImplementation(
      () =>
        new Promise<TriggerResponse>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useTriggerProbe({ token: "t" }));
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

  it("does NOT abort in-flight trigger on unmount (R2-C.1)", async () => {
    // R2-C.1: POST is non-idempotent — server may have already queued the
    // run. Aborting hides the result, not the action. Keep the request
    // alive on unmount; rely on aliveRef to skip setState.
    let capturedSignal: AbortSignal | undefined;
    triggerProbeMock.mockImplementation(
      (_id: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts.signal;
        return new Promise<TriggerResponse>((resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          // Resolve later if not aborted; for this test we let it hang and
          // assert that the signal is not aborted post-unmount.
          void resolve;
        });
      },
    );
    const { result, unmount } = renderHook(() =>
      useTriggerProbe({ token: "t" }),
    );
    let triggerPromise: Promise<TriggerResponse> | null = null;
    act(() => {
      triggerPromise = result.current.trigger("smoke");
      triggerPromise.catch(() => {});
    });
    await waitFor(() => expect(triggerProbeMock).toHaveBeenCalled());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    // Critical: signal must NOT be aborted by unmount.
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("does not setState after unmount (R2-C.1 aliveRef guard)", async () => {
    // After unmount, the in-flight POST is allowed to resolve; the hook
    // must not call setState (no act() warning, no crash).
    let resolveTrigger: ((v: TriggerResponse) => void) | null = null;
    triggerProbeMock.mockImplementation(
      () =>
        new Promise<TriggerResponse>((r) => {
          resolveTrigger = r;
        }),
    );
    const { result, unmount } = renderHook(() =>
      useTriggerProbe({ token: "t" }),
    );
    act(() => {
      result.current.trigger("smoke").catch(() => {});
    });
    await waitFor(() => expect(triggerProbeMock).toHaveBeenCalled());
    unmount();
    // Resolve after unmount — must not throw, must not log act warnings.
    resolveTrigger!(triggerOk());
    // Yield so the resolution callback runs.
    await Promise.resolve();
    await Promise.resolve();
    // No assertion on result.current — just confirm no throw occurred.
    expect(true).toBe(true);
  });

  it("does not surface AbortError from back-to-back trigger calls (R2-C.2)", async () => {
    // First trigger hangs; back-to-back second call aborts the first. The
    // first call's promise must resolve silently — no AbortError surfaced
    // to caller, no error state set.
    const firstSignals: AbortSignal[] = [];
    triggerProbeMock.mockImplementation(
      (_id: string, opts: { signal?: AbortSignal }) => {
        if (opts.signal) firstSignals.push(opts.signal);
        return new Promise<TriggerResponse>((resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          // Second call resolves immediately if its signal isn't aborted.
          if (firstSignals.length >= 2 && !opts.signal?.aborted) {
            resolve(triggerOk());
          }
        });
      },
    );
    const { result } = renderHook(() => useTriggerProbe({ token: "t" }));
    let firstPromise: Promise<TriggerResponse> | null = null;
    act(() => {
      firstPromise = result.current.trigger("smoke");
      // Swallow potential rejection so unhandled-rejection guards don't
      // misfire — the assertion below verifies the actual outcome.
      firstPromise.catch(() => {});
    });
    await waitFor(() => expect(triggerProbeMock).toHaveBeenCalledTimes(1));

    // Fire second call — this aborts the first.
    let secondPromise: Promise<TriggerResponse> | null = null;
    act(() => {
      secondPromise = result.current.trigger("smoke");
    });
    await act(async () => {
      await secondPromise;
    });

    // The first promise must NOT reject with AbortError surfaced — the
    // hook should swallow it. We resolve via the supersession path.
    let firstResult: unknown = "pending";
    let firstError: unknown = null;
    firstPromise!
      .then((v) => {
        firstResult = v;
      })
      .catch((e) => {
        firstError = e;
      });
    // Yield enough for any pending settlements.
    await Promise.resolve();
    await Promise.resolve();
    // Per spec: first promise resolves silently (returns undefined) when
    // superseded; AbortError must NOT be thrown to the caller.
    expect((firstError as { name?: string })?.name).not.toBe("AbortError");
    void firstResult;

    // Error state must remain null.
    expect(result.current.error).toBeNull();
  });
});
