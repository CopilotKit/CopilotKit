import { describe, it, expect, expectTypeOf } from "vitest";
import type { BrowserPoolBudget } from "../probes/helpers/browser-pool.js";
import type { ProbeResult } from "../types/index.js";
import type { ProbeRunSummary } from "../probes/run-history.js";
import {
  POOL_COMM_ERROR_KINDS,
  isPoolCommErrorKind,
  commErrorToStatusSignal,
  commErrorFromStatusSignal,
  fleetSurfaceState,
  probeResultsForServiceJobResult,
  runSummaryForServiceJobResult,
  isWorkerStale,
  workerCapacityFromBudget,
  terminalJobStatus,
  FLEET_COMM_ERROR_SIGNAL_KEY,
  WORKERS_COLLECTION,
} from "./contracts.js";
import type {
  PoolCommError,
  ServiceJobResult,
  WorkerCapacity,
  FleetStatusRow,
} from "./contracts.js";

/**
 * Pins the fleet shared CONTRACTS (S2 gate): the comm-error taxonomy (REQ-B)
 * and its round-trip into a status-row signal, the result↔storage mappers that
 * preserve the EXISTING dashboard row shape, worker capacity/staleness, and the
 * terminal-status mapper the worker hands to S0's releaseJob.
 */

function makeResult(
  overrides: Partial<ServiceJobResult> = {},
): ServiceJobResult {
  return {
    jobId: "j1",
    probeKey: "e2e_d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "green",
    aggregateKey: "e2e_d6:langgraph-python",
    aggregateSignal: { failedCount: 0 },
    cells: [
      {
        cellId: "shared-state",
        cellKey: "d6:langgraph-python/shared-state",
        state: "green",
        signal: { ok: true },
        observedAt: "2026-06-04T00:00:01.000Z",
      },
    ],
    rollup: { total: 1, passed: 1, failed: 0 },
    finishedAt: "2026-06-04T00:00:02.000Z",
    ...overrides,
  };
}

const SAMPLE_COMM_ERROR: PoolCommError = {
  kind: "worker-unreachable",
  message: "connect ECONNREFUSED 10.0.0.4:8090",
  workerId: "worker-7",
  jobId: "j1",
  observedAt: "2026-06-04T00:00:00.000Z",
};

describe("PoolCommError taxonomy (REQ-B)", () => {
  it("enumerates the six comm-error kinds", () => {
    expect(POOL_COMM_ERROR_KINDS).toEqual([
      "worker-unreachable",
      "claim-comm-failure",
      "worker-protocol-timeout",
      "worker-crashed-mid-job",
      "worker-protocol-violation",
      "worker-reclaimed-pending",
    ]);
  });

  it("isPoolCommErrorKind accepts members and rejects non-members", () => {
    expect(isPoolCommErrorKind("worker-crashed-mid-job")).toBe(true);
    expect(isPoolCommErrorKind("red")).toBe(false);
    expect(isPoolCommErrorKind(undefined)).toBe(false);
  });
});

describe("comm-error ↔ status-row signal round-trip", () => {
  it("embeds under the well-known signal key", () => {
    const sig = commErrorToStatusSignal(SAMPLE_COMM_ERROR);
    expect(sig[FLEET_COMM_ERROR_SIGNAL_KEY]).toEqual(SAMPLE_COMM_ERROR);
  });

  it("round-trips a full comm error out of a signal blob", () => {
    const sig = commErrorToStatusSignal(SAMPLE_COMM_ERROR);
    expect(commErrorFromStatusSignal(sig)).toEqual(SAMPLE_COMM_ERROR);
  });

  it("round-trips a minimal comm error (no optional workerId/jobId)", () => {
    const minimal: PoolCommError = {
      kind: "claim-comm-failure",
      message: "fetch failed",
      observedAt: "2026-06-04T00:00:00.000Z",
    };
    const back = commErrorFromStatusSignal(commErrorToStatusSignal(minimal));
    expect(back).toEqual(minimal);
  });

  it("returns undefined for a signal with no comm error", () => {
    expect(commErrorFromStatusSignal({ failedCount: 0 })).toBeUndefined();
    expect(commErrorFromStatusSignal(null)).toBeUndefined();
    expect(commErrorFromStatusSignal("nope")).toBeUndefined();
  });

  it("rejects a malformed embedded comm error (bad kind / missing fields)", () => {
    expect(
      commErrorFromStatusSignal({
        [FLEET_COMM_ERROR_SIGNAL_KEY]: {
          kind: "bogus",
          message: "x",
          observedAt: "t",
        },
      }),
    ).toBeUndefined();
    expect(
      commErrorFromStatusSignal({
        [FLEET_COMM_ERROR_SIGNAL_KEY]: { kind: "worker-unreachable" },
      }),
    ).toBeUndefined();
  });
});

describe("fleetSurfaceState", () => {
  const row: FleetStatusRow = {
    key: "e2e_d6:langgraph-python",
    dimension: "e2e_d6",
    state: "green",
    signal: {},
    observedAt: "2026-06-04T00:00:00.000Z",
  };

  it("returns the probe colour when there is no comm error", () => {
    expect(fleetSurfaceState(row)).toBe("green");
  });

  it("returns 'unreachable' when a comm error overlays the row", () => {
    expect(fleetSurfaceState({ ...row, commError: SAMPLE_COMM_ERROR })).toBe(
      "unreachable",
    );
  });
});

describe("result ↔ storage mappers (preserve dashboard row shape)", () => {
  it("projects a service result into primary + per-cell ProbeResults", () => {
    const results = probeResultsForServiceJobResult(makeResult());
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      key: "e2e_d6:langgraph-python",
      state: "green",
      signal: { failedCount: 0 },
      observedAt: "2026-06-04T00:00:02.000Z",
    });
    expect(results[1]).toEqual({
      key: "d6:langgraph-python/shared-state",
      state: "green",
      signal: { ok: true },
      observedAt: "2026-06-04T00:00:01.000Z",
    });
  });

  it("maps the rollup onto the ProbeRunSummary shape", () => {
    const summary = runSummaryForServiceJobResult(
      makeResult({ rollup: { total: 3, passed: 2, failed: 1 } }),
    );
    expect(summary).toEqual({ total: 3, passed: 2, failed: 1 });
    // structurally assignable to the storage contract
    const asSummary: ProbeRunSummary = summary;
    expect(asSummary.total).toBe(3);
  });
});

describe("worker capacity + staleness", () => {
  it("copies a BrowserPoolBudget field-for-field", () => {
    const budget: BrowserPoolBudget = {
      inUse: 2,
      available: 6,
      max: 8,
      pidsCurrent: 120,
      pidsMax: 1000,
    };
    expect(workerCapacityFromBudget(budget)).toEqual(budget);
  });

  it("isWorkerStale flags a heartbeat older than the window", () => {
    const now = Date.parse("2026-06-04T00:01:00.000Z");
    expect(isWorkerStale("2026-06-04T00:00:00.000Z", now, 30_000)).toBe(true);
    expect(isWorkerStale("2026-06-04T00:00:45.000Z", now, 30_000)).toBe(false);
  });

  it("isWorkerStale treats an unparseable timestamp as not-yet-stale", () => {
    expect(isWorkerStale("not-a-date", Date.now(), 1_000)).toBe(false);
  });
});

describe("terminalJobStatus", () => {
  it("is done for an all-green result", () => {
    expect(terminalJobStatus(makeResult())).toBe("done");
  });

  it("is failed for a red aggregate", () => {
    expect(terminalJobStatus(makeResult({ aggregateState: "red" }))).toBe(
      "failed",
    );
  });

  it("is failed whenever a comm error is present, regardless of state", () => {
    expect(
      terminalJobStatus(makeResult({ commError: SAMPLE_COMM_ERROR })),
    ).toBe("failed");
  });
});

describe("type-level: contract assignability", () => {
  it("WorkerCapacity is structurally compatible with BrowserPoolBudget", () => {
    expectTypeOf<BrowserPoolBudget>().toMatchTypeOf<WorkerCapacity>();
    expectTypeOf<WorkerCapacity>().toMatchTypeOf<BrowserPoolBudget>();
  });

  it("probeResultsForServiceJobResult returns ProbeResult[]", () => {
    expectTypeOf(probeResultsForServiceJobResult).returns.toEqualTypeOf<
      ProbeResult[]
    >();
  });

  it("WORKERS_COLLECTION is the workers literal", () => {
    expect(WORKERS_COLLECTION).toBe("workers");
  });
});
