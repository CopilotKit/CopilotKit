import { describe, it, expect, expectTypeOf } from "vitest";
import type { BrowserPoolBudget } from "../probes/helpers/browser-pool.js";
import type { ProbeResult } from "../types/index.js";
import type { ProbeRunSummary } from "../probes/run-history.js";
import {
  POOL_COMM_ERROR_KINDS,
  isPoolCommErrorKind,
  commErrorToStatusSignal,
  commErrorFromStatusSignal,
  statusSignalHasCommErrorKey,
  fleetSurfaceState,
  probeResultsForServiceJobResult,
  runSummaryForServiceJobResult,
  isWorkerStale,
  heartbeatParseable,
  deriveHealth,
  workerCapacityFromBudget,
  terminalJobStatus,
  probeKeyFamily,
  FLEET_COMM_ERROR_SIGNAL_KEY,
  WORKERS_COLLECTION,
} from "./contracts.js";
import type {
  PoolCommError,
  ServiceJobResult,
  WorkerCapacity,
  FleetStatusRow,
  FleetSurfaceState,
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
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "green",
    aggregateKey: "d6:langgraph-python",
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

  it("rejects an ARRAY embedded under the signal key (arrays are typeof object)", () => {
    // A plain array decodes to undefined already (no .kind property), but an
    // array carrying comm-error fields as EXPANDO properties passes the bare
    // `typeof raw === "object"` check and would decode as if it were a
    // well-formed PoolCommError — an array is never a valid wire shape, so
    // Array.isArray must reject it explicitly.
    expect(
      commErrorFromStatusSignal({ [FLEET_COMM_ERROR_SIGNAL_KEY]: [] }),
    ).toBeUndefined();
    expect(
      commErrorFromStatusSignal({
        [FLEET_COMM_ERROR_SIGNAL_KEY]: Object.assign([], SAMPLE_COMM_ERROR),
      }),
    ).toBeUndefined();
  });

  it("rejects an ARRAY at the TOP LEVEL (the signal blob itself an array)", () => {
    // Same rationale one level up: a top-level array is typeof "object" and
    // non-null, so it passes the bare first guard — and an array carrying the
    // signal key as an EXPANDO property would then decode a comm error out of
    // a blob that is never a valid wire shape. Array.isArray must reject the
    // signal blob itself, not only the nested value.
    expect(commErrorFromStatusSignal([])).toBeUndefined();
    expect(
      commErrorFromStatusSignal(
        Object.assign([], { [FLEET_COMM_ERROR_SIGNAL_KEY]: SAMPLE_COMM_ERROR }),
      ),
    ).toBeUndefined();
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

  it("statusSignalHasCommErrorKey distinguishes 'key present but undecodable' from 'absent' (version-skew hazard)", () => {
    // The decode returns undefined for BOTH a signal that carries no comm
    // error AND one whose embedded value is malformed/unknown — so a REQ-B
    // overlay written by a NEWER producer (e.g. a new kind rolled out
    // write-side first) silently drops on an older reader. The companion lets
    // consumers count/log those drops without changing the decode contract.
    //
    // Key present, kind unknown to this reader (the version-skew case):
    const unknownKind = {
      [FLEET_COMM_ERROR_SIGNAL_KEY]: {
        kind: "some-future-kind",
        message: "x",
        observedAt: "2026-06-04T00:00:00.000Z",
      },
    };
    expect(commErrorFromStatusSignal(unknownKind)).toBeUndefined();
    expect(statusSignalHasCommErrorKey(unknownKind)).toBe(true);
    //
    // Key present, required field RENAMED (message -> msg):
    const renamedField = {
      [FLEET_COMM_ERROR_SIGNAL_KEY]: {
        kind: "worker-unreachable",
        msg: "connect ECONNREFUSED",
        observedAt: "2026-06-04T00:00:00.000Z",
      },
    };
    expect(commErrorFromStatusSignal(renamedField)).toBeUndefined();
    expect(statusSignalHasCommErrorKey(renamedField)).toBe(true);
    //
    // Key present and well-formed: both sides agree.
    const wellFormed = commErrorToStatusSignal(SAMPLE_COMM_ERROR);
    expect(commErrorFromStatusSignal(wellFormed)).toEqual(SAMPLE_COMM_ERROR);
    expect(statusSignalHasCommErrorKey(wellFormed)).toBe(true);
  });

  it("statusSignalHasCommErrorKey is false when the key is genuinely absent (or the blob is no wire shape)", () => {
    expect(statusSignalHasCommErrorKey({ failedCount: 0 })).toBe(false);
    expect(statusSignalHasCommErrorKey(null)).toBe(false);
    expect(statusSignalHasCommErrorKey(undefined)).toBe(false);
    expect(statusSignalHasCommErrorKey("nope")).toBe(false);
    // Arrays are never a valid wire shape — even with the key as an expando
    // property (mirrors the decoder's top-level Array.isArray rejection).
    expect(statusSignalHasCommErrorKey([])).toBe(false);
    expect(
      statusSignalHasCommErrorKey(
        Object.assign([], { [FLEET_COMM_ERROR_SIGNAL_KEY]: SAMPLE_COMM_ERROR }),
      ),
    ).toBe(false);
  });
});

describe("fleetSurfaceState", () => {
  const row: FleetStatusRow = {
    key: "d6:langgraph-python",
    dimension: "d6",
    state: "green",
    signal: {},
    observedAt: "2026-06-04T00:00:00.000Z",
  };

  const RECLAIM_COMM_ERROR: PoolCommError = {
    kind: "worker-reclaimed-pending",
    message: "lease expired; job re-queued to pending",
    jobId: "j1",
    observedAt: "2026-06-04T00:00:00.000Z",
  };

  it("returns the probe colour when there is no comm error", () => {
    expect(fleetSurfaceState(row)).toBe("green");
  });

  it("returns 'unreachable' when a crash-kind comm error overlays the row", () => {
    expect(fleetSurfaceState({ ...row, commError: SAMPLE_COMM_ERROR })).toBe(
      "unreachable",
    );
  });

  it("routes every non-reclaim comm-error kind to 'unreachable'", () => {
    for (const kind of POOL_COMM_ERROR_KINDS) {
      if (kind === "worker-reclaimed-pending") continue;
      expect(
        fleetSurfaceState({
          ...row,
          commError: { ...SAMPLE_COMM_ERROR, kind },
        }),
      ).toBe("unreachable");
    }
  });

  it("routes worker-reclaimed-pending on a GREEN row to the NEUTRAL 'pending' surface", () => {
    // The sweep boundary cannot tell a real crash from a routine platform
    // teardown — either way the job is re-queued (back in flight), so on a
    // healthy (green) row the surface is the neutral gray "pending", NEVER
    // the red "unreachable" overlay (see POOL_COMM_ERROR_KINDS; mirrors the
    // dashboard derivation).
    expect(fleetSurfaceState({ ...row, commError: RECLAIM_COMM_ERROR })).toBe(
      "pending",
    );
  });

  it("worker-reclaimed-pending must NOT mask ANY non-green failure state (red/degraded/error pass through)", () => {
    // Mirrors the dashboard's cell-model derivation and the A2 rank
    // principle (an unrecognized/error state ranks ABOVE red): every
    // non-green last-known state is a GENUINE failure the neutral pending
    // overlay must not hide — only green becomes "pending".
    for (const state of ["red", "degraded", "error"] as const) {
      expect(
        fleetSurfaceState({
          ...row,
          state,
          commError: RECLAIM_COMM_ERROR,
        }),
      ).toBe(state);
    }
  });

  it("worker-reclaimed-pending passes an OUT-OF-VOCABULARY runtime state through (never masks)", () => {
    // `FleetStatusRow.state` is typed ProbeState, but a runtime row can carry
    // an out-of-vocabulary value; the A2 never-swallow rule ranks it above
    // red, so the neutral overlay must pass it through, not mask it.
    const outOfVocab = "flapping" as unknown as FleetStatusRow["state"];
    expect(
      fleetSurfaceState({
        ...row,
        state: outOfVocab,
        commError: RECLAIM_COMM_ERROR,
      }),
    ).toBe(outOfVocab);
  });

  it("type-level: the union carries the 'pending' member alongside 'unreachable'", () => {
    expectTypeOf<"pending">().toMatchTypeOf<FleetSurfaceState>();
    expectTypeOf<"unreachable">().toMatchTypeOf<FleetSurfaceState>();
  });
});

describe("result ↔ storage mappers (preserve dashboard row shape)", () => {
  it("projects a service result into primary + per-cell ProbeResults", () => {
    const results = probeResultsForServiceJobResult(makeResult());
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      key: "d6:langgraph-python",
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

  it("clamps a negative budget.available to 0 (WorkerCapacity.available is documented never-negative)", () => {
    // A pool budget computed mid-teardown (or from a racy snapshot) can
    // transiently report available < 0; the capacity CONTRACT documents
    // `available` as "never negative", so the mapper must enforce it rather
    // than leak the racy value to the registry/heartbeat consumers.
    const budget: BrowserPoolBudget = {
      inUse: 9,
      available: -1,
      max: 8,
      pidsCurrent: 120,
      pidsMax: 1000,
    };
    expect(workerCapacityFromBudget(budget).available).toBe(0);
  });

  it("isWorkerStale flags a heartbeat older than the window", () => {
    const now = Date.parse("2026-06-04T00:01:00.000Z");
    expect(isWorkerStale("2026-06-04T00:00:00.000Z", now, 30_000)).toBe(true);
    expect(isWorkerStale("2026-06-04T00:00:45.000Z", now, 30_000)).toBe(false);
  });

  it("isWorkerStale treats an unparseable timestamp as not-yet-stale", () => {
    expect(isWorkerStale("not-a-date", Date.now(), 1_000)).toBe(false);
  });

  it("isWorkerStale parses the PB space-separated date form (normalized to ISO 'T')", () => {
    // PB stores datetimes as `YYYY-MM-DD HH:MM:SS.sssZ` (space separator). A
    // heartbeat read back in that form must be parsed via the SAME anchored
    // space→'T' normalization the queue-client applies to lease timestamps —
    // not left to engine-specific Date.parse leniency.
    const now = Date.parse("2026-06-04T00:01:00.000Z");
    expect(isWorkerStale("2026-06-04 00:00:00.000Z", now, 30_000)).toBe(true);
    expect(isWorkerStale("2026-06-04 00:00:45.000Z", now, 30_000)).toBe(false);
  });

  it("isWorkerStale ISO boundaries: exactly-at-window is NOT stale, one ms past is", () => {
    const now = Date.parse("2026-06-04T00:01:00.000Z");
    // age === staleAfterMs → not stale (strict >)
    expect(isWorkerStale("2026-06-04T00:00:30.000Z", now, 30_000)).toBe(false);
    // age === staleAfterMs + 1 → stale
    expect(isWorkerStale("2026-06-04T00:00:29.999Z", now, 30_000)).toBe(true);
  });

  it("heartbeatParseable distinguishes a corrupt heartbeat from a fresh one (fleet-health observability)", () => {
    // `isWorkerStale` deliberately returns false for an unparseable timestamp
    // (never flap the fleet offline on one bad row) — but that makes a corrupt
    // heartbeat INDISTINGUISHABLE from a fresh one ("never stale forever").
    // The companion lets fleet-health (S10) count/warn on unparseable rows.
    expect(heartbeatParseable("not-a-date")).toBe(false);
    expect(heartbeatParseable("")).toBe(false);
    expect(heartbeatParseable("2026-06-04T00:00:00.000Z")).toBe(true);
    // The PB space form is parseable AFTER the anchored normalization.
    expect(heartbeatParseable("2026-06-04 00:00:00.000Z")).toBe(true);
  });
});

describe("deriveHealth (worker liveness from heartbeat age)", () => {
  // Injected clock + a non-default window so the 1x/2x boundaries are
  // explicit: with staleAfterMs = 1000, online ≤ 1000ms old, stale is
  // (1000, 2000], offline > 2000ms.
  const STALE_AFTER_MS = 1_000;
  const nowMs = Date.parse("2026-06-04T00:01:00.000Z");
  const beatAgedMs = (ageMs: number) => new Date(nowMs - ageMs).toISOString();

  it('deriveHealth returns "online" for heartbeat ≤ staleAfterMs old', () => {
    expect(deriveHealth(beatAgedMs(0), nowMs, STALE_AFTER_MS)).toBe("online");
    // exact 1x boundary is NOT stale (isWorkerStale is strictly >)
    expect(deriveHealth(beatAgedMs(1_000), nowMs, STALE_AFTER_MS)).toBe(
      "online",
    );
  });

  it('deriveHealth returns "stale" for heartbeat > 1x and ≤ 2x staleAfterMs', () => {
    expect(deriveHealth(beatAgedMs(1_001), nowMs, STALE_AFTER_MS)).toBe(
      "stale",
    );
    // exact 2x boundary is still stale, not offline (strictly >)
    expect(deriveHealth(beatAgedMs(2_000), nowMs, STALE_AFTER_MS)).toBe(
      "stale",
    );
  });

  it('deriveHealth returns "offline" for heartbeat > 2x staleAfterMs', () => {
    expect(deriveHealth(beatAgedMs(2_001), nowMs, STALE_AFTER_MS)).toBe(
      "offline",
    );
    expect(deriveHealth(beatAgedMs(60_000), nowMs, STALE_AFTER_MS)).toBe(
      "offline",
    );
  });

  it('deriveHealth returns "online" for an unparseable timestamp (inherited lenient default — display surfaces MUST pre-check parseability, see run-view)', () => {
    expect(deriveHealth("not-a-date", nowMs, STALE_AFTER_MS)).toBe("online");
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

describe("probeKeyFamily", () => {
  it("extracts the prefix before the first ':'", () => {
    expect(probeKeyFamily("d6:langgraph-python")).toBe("d6");
    expect(probeKeyFamily("e2e-demos:agno")).toBe("e2e-demos");
    expect(probeKeyFamily("d6:agno:extra")).toBe("d6");
  });

  it("returns the whole key when no ':' is present", () => {
    expect(probeKeyFamily("standalone")).toBe("standalone");
  });

  it("treats a leading-colon key as having NO family prefix (whole key, never '')", () => {
    // A key beginning with ':' would otherwise yield the EMPTY-STRING family,
    // which flows into countPendingForFamily and the claimNext fairness
    // partition as a phantom real bucket.
    expect(probeKeyFamily(":weird")).toBe(":weird");
    expect(probeKeyFamily(":")).toBe(":");
  });

  it("a leading-colon key with FURTHER colons is still its own whole-key family", () => {
    // Pins the equality-only invariant documented on probeKeyFamily: the
    // family of ':foo:bar' is the whole ':foo:bar', NOT ':foo' — so a
    // consumer expanding family ':foo' with a prefix-LIKE '<family>:%'
    // pattern (queue-client familyInclusionClause/familyExclusionClause)
    // would wrongly fold ':foo:bar' under ':foo'. Whole-key (colon-bearing)
    // families must be matched by equality only.
    expect(probeKeyFamily(":foo:bar")).toBe(":foo:bar");
    expect(probeKeyFamily(probeKeyFamily(":foo:bar"))).toBe(":foo:bar");
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
