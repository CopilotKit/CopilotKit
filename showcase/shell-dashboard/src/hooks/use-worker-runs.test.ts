/**
 * Tests for the worker-runs data layer (runviz T10):
 *   - `useWorkerRunsPoll` — the §6.1 poll hook with the three-way
 *     unavailable classification (misdeploy-404 / unreachable /
 *     history-backend) and last-good retention.
 *   - `WorkerRunsContext` / `useWorkerRuns` — the no-provider contract
 *     (NEVER throws; returns the no-data default) that T13's cell-pieces
 *     consumers depend on (`cell-pieces.signal-degrade.test.tsx` renders
 *     `CellStatus` with no provider and asserts not.toThrow).
 *   - `isFamilySilent` / `familyForProbeKey` — the shared §7.3/§7.4 pure
 *     helpers (server periodMs verbatim, null-lastSuccessAt fallback,
 *     payload probeKeyPrefix mapping).
 *
 * `fetchWorkerRuns` is mocked (the wire contract is covered in
 * `ops-api.test.ts`); the real `OpsApiHttpError` class is kept via
 * importOriginal so instanceof-based 404 classification is exercised
 * against the genuine error type.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("../lib/ops-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ops-api")>();
  return { ...actual, fetchWorkerRuns: vi.fn() };
});

import * as opsApi from "../lib/ops-api";
import { OpsApiHttpError } from "../lib/ops-api";
import type {
  WorkerRunsResponse,
  WorkerFamilySummary,
  WorkerRunBatch,
} from "../lib/ops-api";
import {
  EXPECT_WORKER_RUNS_ENDPOINT,
  useWorkerRunsPoll,
} from "./use-worker-runs";
import type { WorkerRunsStatus } from "./use-worker-runs";
import {
  WorkerRunsProvider,
  useWorkerRuns,
  isFamilySilent,
  familyForProbeKey,
} from "../lib/worker-runs-context";

const fetchWorkerRunsMock = opsApi.fetchWorkerRuns as unknown as ReturnType<
  typeof vi.fn
>;

function okBody(): WorkerRunsResponse {
  return {
    families: [
      {
        family: "d5",
        label: "D5 e2e-deep",
        probeKeyPrefix: "d5-single-pill-e2e",
        schedule: "*/30 * * * *",
        periodMs: 1_800_000,
        nextRunAt: null,
        lastRun: null,
        inflight: null,
        lastSuccessAt: null,
      },
    ],
    workers: [],
  };
}

function degradedBody(): WorkerRunsResponse {
  const body = okBody();
  body.families.push({
    family: "d6",
    label: "D6 all-pills",
    probeKeyPrefix: "d6",
    error: "history_unavailable",
  });
  return body;
}

beforeEach(() => {
  fetchWorkerRunsMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────
// EXPECT_WORKER_RUNS_ENDPOINT — §6.1 source-level constant
// ─────────────────────────────────────────────────────────────────────────

describe("EXPECT_WORKER_RUNS_ENDPOINT", () => {
  it("ships as a source-level true constant (no env/build-config indirection)", () => {
    expect(EXPECT_WORKER_RUNS_ENDPOINT).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// useWorkerRunsPoll — classification + last-good retention
// ─────────────────────────────────────────────────────────────────────────

describe("useWorkerRunsPoll", () => {
  it("yields status ok with the body and a fetch timestamp on success", async () => {
    fetchWorkerRunsMock.mockResolvedValue(okBody());
    const { result } = renderHook(() => useWorkerRunsPoll());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    const status = result.current!;
    expect(status.status).toBe("ok");
    if (status.status === "ok") {
      expect(status.data).toEqual(okBody());
      expect(typeof status.fetchedAt).toBe("number");
    }
  });

  it("a 404 yields unavailable kind misdeploy-404 on a cold first poll (lastGood null)", async () => {
    fetchWorkerRunsMock.mockRejectedValue(
      new OpsApiHttpError(404, "Not Found", "/api/ops/runs"),
    );
    const { result } = renderHook(() => useWorkerRunsPoll());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      status: "unavailable",
      kind: "misdeploy-404",
      lastGood: null,
    });
  });

  it("a 404 after a prior success yields misdeploy-404 with lastGood retained", async () => {
    vi.useFakeTimers();
    fetchWorkerRunsMock
      .mockResolvedValueOnce(okBody())
      .mockRejectedValueOnce(
        new OpsApiHttpError(404, "Not Found", "/api/ops/runs"),
      );
    const { result } = renderHook(() => useWorkerRunsPoll());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current?.status).toBe("ok");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const status = result.current!;
    expect(status.status).toBe("unavailable");
    if (status.status === "unavailable") {
      expect(status.kind).toBe("misdeploy-404");
      expect(status.lastGood?.data).toEqual(okBody());
      expect(typeof status.lastGood?.fetchedAt).toBe("number");
    }
  });

  it("a 200 body with one family entry carrying history_unavailable yields kind history-backend", async () => {
    fetchWorkerRunsMock.mockResolvedValue(degradedBody());
    const { result } = renderHook(() => useWorkerRunsPoll());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      status: "unavailable",
      kind: "history-backend",
      lastGood: null,
    });
  });

  it("a degraded 200 after a prior success retains lastGood under history-backend", async () => {
    vi.useFakeTimers();
    fetchWorkerRunsMock
      .mockResolvedValueOnce(okBody())
      .mockResolvedValueOnce(degradedBody());
    const { result } = renderHook(() => useWorkerRunsPoll());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current?.status).toBe("ok");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const status = result.current!;
    expect(status.status).toBe("unavailable");
    if (status.status === "unavailable") {
      expect(status.kind).toBe("history-backend");
      expect(status.lastGood?.data).toEqual(okBody());
    }
  });

  it("a 5xx failure yields kind unreachable", async () => {
    fetchWorkerRunsMock.mockRejectedValue(
      new OpsApiHttpError(502, "Bad Gateway", "/api/ops/runs"),
    );
    const { result } = renderHook(() => useWorkerRunsPoll());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      status: "unavailable",
      kind: "unreachable",
      lastGood: null,
    });
  });

  it("a network/parse failure yields kind unreachable", async () => {
    fetchWorkerRunsMock.mockRejectedValue(new TypeError("fetch failed"));
    const { result } = renderHook(() => useWorkerRunsPoll());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      status: "unavailable",
      kind: "unreachable",
      lastGood: null,
    });
  });

  it("the next successful poll clears unavailable (automatic recovery, no debounce)", async () => {
    vi.useFakeTimers();
    fetchWorkerRunsMock
      .mockRejectedValueOnce(
        new OpsApiHttpError(404, "Not Found", "/api/ops/runs"),
      )
      .mockResolvedValueOnce(okBody());
    const { result } = renderHook(() => useWorkerRunsPoll());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current?.status).toBe("unavailable");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current?.status).toBe("ok");
  });

  it("polls on the default 10s cadence", async () => {
    vi.useFakeTimers();
    fetchWorkerRunsMock.mockResolvedValue(okBody());
    renderHook(() => useWorkerRunsPoll());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchWorkerRunsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchWorkerRunsMock).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// WorkerRunsContext — the no-provider contract (load-bearing for T13)
// ─────────────────────────────────────────────────────────────────────────

describe("useWorkerRuns (context consumer)", () => {
  it("NEVER throws absent a provider and returns the no-data default (null)", () => {
    let rendered: ReturnType<typeof renderHook<unknown, unknown>> | null = null;
    expect(() => {
      rendered = renderHook(() => useWorkerRuns());
    }).not.toThrow();
    expect(rendered!.result.current).toBeNull();
  });

  it("returns the provider-supplied status when mounted under WorkerRunsProvider", () => {
    const status: WorkerRunsStatus = {
      status: "unavailable",
      kind: "unreachable",
      lastGood: null,
    };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(WorkerRunsProvider, { value: status, children });
    const { result } = renderHook(() => useWorkerRuns(), { wrapper });
    expect(result.current).toBe(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isFamilySilent / familyForProbeKey — §7.3/§7.4 pure helpers
// ─────────────────────────────────────────────────────────────────────────

const NOW = Date.parse("2026-06-10T12:00:00.000Z");

function batch(over: Partial<WorkerRunBatch> = {}): WorkerRunBatch {
  return {
    runId: "01JXRUN",
    triggered: false,
    enqueuedAt: "2026-06-10T11:00:00.000Z",
    finishedAt: "2026-06-10T11:06:00.000Z",
    durationMs: 360_000,
    outcome: "completed",
    jobs: { total: 4, done: 4, failed: 0, reclaimed: 0 },
    cells: { total: 32, passed: 32, failed: 0 },
    redsIntroduced: null,
    redsCleared: null,
    errorSummary: null,
    commErrorKinds: [],
    ...over,
  };
}

function familyEntry(
  over: Partial<WorkerFamilySummary> = {},
): WorkerFamilySummary {
  return {
    family: "d5",
    label: "D5 e2e-deep",
    probeKeyPrefix: "d5-single-pill-e2e",
    schedule: "*/30 * * * *",
    periodMs: 900_000, // predicate-math fixture: kept at 15min so the 2x=1_800_000 boundary assertions below stay valid (not real d5 cadence)
    nextRunAt: null,
    lastRun: null,
    inflight: null,
    lastSuccessAt: null,
    ...over,
  };
}

describe("isFamilySilent", () => {
  it("is silent only past 2x the server periodMs (consumed verbatim — no client cron parsing)", () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    // Exactly 2 periods old: NOT yet silent (strictly-older-than threshold).
    expect(
      isFamilySilent(familyEntry({ lastSuccessAt: at(1_800_000) }), NOW),
    ).toBe(false);
    // 1ms past 2 periods: silent.
    expect(
      isFamilySilent(familyEntry({ lastSuccessAt: at(1_800_001) }), NOW),
    ).toBe(true);
    // A non-default periodMs shifts the threshold — server value verbatim.
    expect(
      isFamilySilent(
        familyEntry({ periodMs: 60_000, lastSuccessAt: at(120_001) }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isFamilySilent(
        familyEntry({ periodMs: 60_000, lastSuccessAt: at(119_999) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("null lastSuccessAt falls back to the oldest known batch's enqueuedAt", () => {
    const oldEnqueue = new Date(NOW - 2_000_000).toISOString(); // > 2x 900s
    expect(
      isFamilySilent(
        familyEntry({
          lastSuccessAt: null,
          lastRun: batch({ enqueuedAt: oldEnqueue, outcome: "failed" }),
        }),
        NOW,
      ),
    ).toBe(true);
    const freshEnqueue = new Date(NOW - 60_000).toISOString();
    expect(
      isFamilySilent(
        familyEntry({
          lastSuccessAt: null,
          lastRun: batch({ enqueuedAt: freshEnqueue, outcome: "failed" }),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("an inflight-only family (never completed) falls back to the inflight enqueuedAt", () => {
    expect(
      isFamilySilent(
        familyEntry({
          lastSuccessAt: null,
          lastRun: null,
          inflight: {
            runId: "01JXNEW",
            triggered: false,
            enqueuedAt: new Date(NOW - 2_000_000).toISOString(),
            elapsedMs: 2_000_000,
            stalled: true,
            jobs: { pending: 4, claimed: 0, running: 0, done: 0, failed: 0 },
          },
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("zero batches → never silent (fresh env before the first producer tick)", () => {
    expect(
      isFamilySilent(
        familyEntry({ lastSuccessAt: null, lastRun: null, inflight: null }),
        NOW,
      ),
    ).toBe(false);
  });

  it("a degraded entry (history_unavailable, no periodMs) is never classified silent", () => {
    expect(
      isFamilySilent(
        {
          family: "d6",
          label: "D6 all-pills",
          probeKeyPrefix: "d6",
          error: "history_unavailable",
        },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("familyForProbeKey", () => {
  const families: WorkerFamilySummary[] = [
    familyEntry({
      family: "d6",
      label: "D6 all-pills",
      probeKeyPrefix: "d6",
    }),
    familyEntry({
      family: "d5",
      label: "D5 e2e-deep",
      probeKeyPrefix: "d5-single-pill-e2e",
    }),
    familyEntry({
      family: "e2e-demos",
      label: "E2E demos",
      probeKeyPrefix: "e2e-demos",
    }),
    familyEntry({
      family: "e2e-smoke",
      label: "E2E smoke",
      probeKeyPrefix: "d4",
    }),
  ];

  it("maps d4:<slug> to the e2e-smoke family via the payload probeKeyPrefix", () => {
    expect(familyForProbeKey("d4:lg-py", families)?.family).toBe("e2e-smoke");
  });

  it("maps d5-single-pill-e2e:<slug> to the d5 family", () => {
    expect(familyForProbeKey("d5-single-pill-e2e:agno", families)?.family).toBe(
      "d5",
    );
  });

  it("matches the exact prefix segment, never a partial prefix", () => {
    // "d6x:<slug>" must NOT match the "d6" family.
    expect(familyForProbeKey("d6x:slug", families)).toBeUndefined();
  });

  it("returns undefined for unknown prefixes and keys without a colon", () => {
    expect(familyForProbeKey("starter_smoke", families)).toBeUndefined();
    expect(familyForProbeKey("unknown:slug", families)).toBeUndefined();
  });
});
