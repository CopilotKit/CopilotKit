import { describe, it, expect, beforeEach } from "vitest";
import type {
  ProbeResult,
  State,
  WriteOutcome,
  Logger,
} from "../../types/index.js";
import type {
  ProbeRunSummary,
  ProbeRunWriter,
  ProbeRunRecord,
} from "../../probes/run-history.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import {
  FLEET_COMM_ERROR_SIGNAL_KEY,
  commErrorFromStatusSignal,
} from "../contracts.js";
import type { PoolCommError, ServiceJobResult } from "../contracts.js";
import { createResultAggregator } from "./result-aggregator.js";

/**
 * Pins the control-plane RESULT AGGREGATOR (S5): consuming a worker's
 * `ServiceJobResult` and WRITING it through the EXISTING status-writer
 * (per-cell + aggregate `ProbeResult`s) and run-history (`ProbeRunSummary`)
 * so the dashboard contract is unchanged, plus the REQ-B comm-error overlay.
 */

// ── Fakes ──────────────────────────────────────────────────────────────

interface RecordedWrite {
  result: ProbeResult<unknown>;
}

function makeFakeStatusWriter(): {
  writer: StatusWriter;
  writes: RecordedWrite[];
} {
  const writes: RecordedWrite[] = [];
  const writer: StatusWriter = {
    async write(result) {
      writes.push({ result });
      const outcome: WriteOutcome = {
        previousState: null,
        newState: result.state === "error" ? "error" : result.state,
        transition: "first",
        firstFailureAt: null,
        failCount: 0,
      };
      return outcome;
    },
  };
  return { writer, writes };
}

/**
 * A fake that mimics the REAL status-writer's error-path routing (see
 * `status-writer.ts` `doWrite`): a write whose `state === "error"` is routed to
 * `status_history` ONLY — its `signal` is NEVER persisted to the STATUS ROW.
 * Only a NON-error write lands the `signal` on the status row (`statusRows`).
 * This is the fake that actually reproduces the worker-self-report comm-error
 * bug: a naive fake that records EVERY write into one array (`makeFakeStatusWriter`)
 * silently passes even when the overlay never reaches the status row the
 * dashboard reads.
 */
function makeErrorRoutingFakeStatusWriter(): {
  writer: StatusWriter;
  /** What the dashboard reads back: key → the persisted status-row signal. */
  statusRows: Map<string, { state: State; signal: unknown }>;
  /** Every write, error or not (for write-count assertions). */
  writes: RecordedWrite[];
} {
  const statusRows = new Map<string, { state: State; signal: unknown }>();
  const writes: RecordedWrite[] = [];
  const writer: StatusWriter = {
    async write(result) {
      writes.push({ result });
      if (result.state === "error") {
        // REAL error-path: signal → status_history only. The STATUS ROW's
        // signal is NOT updated (status-writer only refreshes observed_at on
        // the error path, and only when a prior row exists). So the overlay
        // carried in this signal is LOST to the dashboard.
        const outcome: WriteOutcome = {
          previousState: statusRows.get(result.key)?.state ?? null,
          newState: "error",
          errorStatePrev: statusRows.get(result.key)?.state ?? "green",
          transition: "error",
          firstFailureAt: null,
          failCount: 0,
        };
        return outcome;
      }
      // Non-error: the signal lands on the status row the dashboard reads.
      statusRows.set(result.key, {
        state: result.state,
        signal: result.signal,
      });
      const outcome: WriteOutcome = {
        previousState: null,
        newState: result.state,
        transition: "first",
        firstFailureAt: null,
        failCount: 0,
      };
      return outcome;
    },
  };
  return { writer, statusRows, writes };
}

interface RunWriterCalls {
  start: {
    probeId: string;
    startedAt: number;
    triggered: boolean;
    jobId?: string;
  }[];
  update: { id: string; summary: ProbeRunSummary }[];
  finish: {
    id: string;
    finishedAt: number;
    state: "completed" | "failed";
    summary: ProbeRunSummary | null;
  }[];
}

/** A stateful run-row the fake tracks so findByJobId reflects start/finish. */
interface FakeRunRow {
  id: string;
  jobId?: string;
  terminal: boolean;
}

function makeFakeRunWriter(): {
  writer: ProbeRunWriter;
  calls: RunWriterCalls;
  rows: FakeRunRow[];
} {
  const calls: RunWriterCalls = { start: [], update: [], finish: [] };
  const rows: FakeRunRow[] = [];
  let seq = 0;
  const writer: ProbeRunWriter = {
    async start(opts) {
      calls.start.push(opts);
      seq += 1;
      const id = `run-row-${seq}`;
      rows.push({ id, jobId: opts.jobId, terminal: false });
      return { id };
    },
    async findByJobId(jobId) {
      if (!jobId) return null;
      // Newest-first, mirroring the real -started_at sort.
      const match = [...rows].toReversed().find((r) => r.jobId === jobId);
      return match ? { id: match.id, terminal: match.terminal } : null;
    },
    async update(opts) {
      calls.update.push(opts);
    },
    async finish(opts) {
      calls.finish.push(opts);
      const row = rows.find((r) => r.id === opts.id);
      if (row) row.terminal = true;
    },
    async recent(): Promise<ProbeRunRecord[]> {
      return [];
    },
  };
  return { writer, calls, rows };
}

function makeLogger(): Logger {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function makeResult(
  overrides: Partial<ServiceJobResult> = {},
): ServiceJobResult {
  return {
    jobId: "job-1",
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "red",
    aggregateKey: "d6:langgraph-python",
    aggregateSignal: { failedCount: 1 },
    cells: [
      {
        cellId: "shared-state",
        cellKey: "d6:langgraph-python/shared-state",
        state: "green",
        signal: { ok: true },
        observedAt: "2026-06-04T00:00:01.000Z",
      },
      {
        cellId: "human-in-the-loop",
        cellKey: "d6:langgraph-python/human-in-the-loop",
        state: "red",
        signal: { ok: false },
        observedAt: "2026-06-04T00:00:02.000Z",
      },
    ],
    rollup: { total: 2, passed: 1, failed: 1 },
    finishedAt: "2026-06-04T00:00:03.000Z",
    ...overrides,
  };
}

const SAMPLE_COMM_ERROR: PoolCommError = {
  kind: "worker-unreachable",
  message: "connect ECONNREFUSED 10.0.0.4:8090",
  workerId: "worker-7",
  jobId: "job-1",
  observedAt: "2026-06-04T00:00:05.000Z",
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("createResultAggregator", () => {
  let statusFake: ReturnType<typeof makeFakeStatusWriter>;
  let runFake: ReturnType<typeof makeFakeRunWriter>;
  let now: number;

  beforeEach(() => {
    statusFake = makeFakeStatusWriter();
    runFake = makeFakeRunWriter();
    now = 1_000;
  });

  function makeAggregator() {
    return createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
    });
  }

  it("writes the aggregate primary row + one side row per cell, preserving keys", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult());

    const keys = statusFake.writes.map((w) => w.result.key);
    // Primary aggregate row first, then one side row per cell.
    expect(keys).toEqual([
      "d6:langgraph-python",
      "d6:langgraph-python/shared-state",
      "d6:langgraph-python/human-in-the-loop",
    ]);

    const primary = statusFake.writes[0].result;
    expect(primary.state).toBe("red");
    expect(primary.signal).toEqual({ failedCount: 1 });
    expect(primary.observedAt).toBe("2026-06-04T00:00:03.000Z");

    const cellGreen = statusFake.writes[1].result;
    expect(cellGreen.state).toBe("green");
    expect(cellGreen.observedAt).toBe("2026-06-04T00:00:01.000Z");

    const cellRed = statusFake.writes[2].result;
    expect(cellRed.state).toBe("red");
  });

  it("persists the rollup to run-history under the aggregate key (state failed when red)", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult());

    expect(runFake.calls.start).toHaveLength(1);
    expect(runFake.calls.start[0].probeId).toBe("d6:langgraph-python");
    expect(runFake.calls.start[0].triggered).toBe(false);

    expect(runFake.calls.finish).toHaveLength(1);
    const finish = runFake.calls.finish[0];
    expect(finish.id).toBe("run-row-1");
    expect(finish.state).toBe("failed");
    expect(finish.summary).toEqual({ total: 2, passed: 1, failed: 0 + 1 });
  });

  it("marks the run completed when the aggregate state is green", async () => {
    const agg = makeAggregator();
    await agg.aggregate(
      makeResult({
        aggregateState: "green",
        rollup: { total: 2, passed: 2, failed: 0 },
        cells: [
          {
            cellId: "shared-state",
            cellKey: "d6:langgraph-python/shared-state",
            state: "green",
            signal: { ok: true },
            observedAt: "2026-06-04T00:00:01.000Z",
          },
        ],
      }),
    );
    expect(runFake.calls.finish[0].state).toBe("completed");
    expect(runFake.calls.finish[0].summary).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
    });
  });

  it("[REQ-B] merges the comm-error signal onto the primary row when commError is set", async () => {
    const agg = makeAggregator();
    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateSignal: { failedCount: 0 },
      }),
    );

    const primary = statusFake.writes[0].result;
    // The comm error must ride in the primary row signal under the
    // well-known key so the dashboard can re-surface "unreachable".
    const recovered = commErrorFromStatusSignal(primary.signal);
    expect(recovered).toEqual(SAMPLE_COMM_ERROR);
    // The original aggregate signal fields must be preserved alongside it.
    expect((primary.signal as Record<string, unknown>).failedCount).toBe(0);
    expect(
      Object.prototype.hasOwnProperty.call(
        primary.signal,
        FLEET_COMM_ERROR_SIGNAL_KEY,
      ),
    ).toBe(true);
  });

  it("[REQ-B] does NOT add a comm-error signal when commError is absent", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult());
    const primary = statusFake.writes[0].result;
    expect(commErrorFromStatusSignal(primary.signal)).toBeUndefined();
  });

  it("[REQ-B] still writes per-cell rows and run-history on a comm-error result", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult({ commError: SAMPLE_COMM_ERROR }));
    // primary + 2 cells
    expect(statusFake.writes).toHaveLength(3);
    // a comm error is a failed terminal run
    expect(runFake.calls.finish[0].state).toBe("failed");
  });

  it("[REQ-B] lands the worker-self-report comm-error overlay on the STATUS ROW (aggregateState=error must NOT route to history-only)", async () => {
    // The CRITICAL bug: a worker that self-reports a comm error sets
    // aggregateState:"error" (buildCommErrorResult/buildDriverErrorResult). If
    // the aggregator writes the primary row with state:"error", the REAL
    // status-writer routes it to status_history ONLY — the overlay never lands
    // on the STATUS ROW the dashboard reads (commErrorFromStatusSignal on the
    // live row). This fake reproduces that exact routing.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    // The dashboard reads the overlay off the persisted STATUS ROW. It MUST be
    // present — i.e. the primary row was written with a NON-error carried
    // colour so the signal landed on the status row, not history-only.
    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).not.toBe("error");
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("[REQ-B] does NOT carry a worker-reported 'green' aggregateState onto a comm-error primary row (corrupt/untrusted result must never fabricate green)", async () => {
    // CRITICAL false-green: a persisted/decoded result that carries a commError
    // but a (corrupt / untrusted) aggregateState:"green" must NOT write a GREEN
    // status row for a service we could not reach. A commError means we did NOT
    // get a trustworthy result, so the worker's "green" cannot be carried — we
    // fall back to the prior observed colour (none here) or "degraded", NEVER
    // green. This violates REQ-B's "never fabricate green for a service we
    // couldn't reach" invariant otherwise.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
      // No prior observed colour → must fall back to degraded, never green.
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "green",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).not.toBe("green");
    expect(persisted!.state).toBe("degraded");
    // The overlay still lands on the status row the dashboard reads.
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("[REQ-B] carries the PRIOR observed colour (not 'green') when a comm-error result reports aggregateState 'green'", async () => {
    // Same corrupt-green path, but with a prior observed colour available: a red
    // service whose decoded comm-error result claims green must stay red +
    // unreachable overlay, never flip to the untrusted green.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
      resolvePriorState: async (): Promise<State> => "red",
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "green",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(persisted!.state).not.toBe("green");
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("[REQ-B] preserves the prior status-row colour on a worker-self-report comm error (never stomps to green/error)", async () => {
    // When a prior colour is observable, the comm-error primary row keeps it
    // (a red service whose worker then reports a comm error stays red +
    // unreachable overlay) — never error, never a fabricated green.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
      resolvePriorState: async (): Promise<State> => "red",
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("returns the per-write outcomes and the run-row id", async () => {
    const agg = makeAggregator();
    const outcome = await agg.aggregate(makeResult());
    expect(outcome.runRowId).toBe("run-row-1");
    expect(outcome.statusOutcomes).toHaveLength(3);
    expect(outcome.skipped).toBe(false);
  });

  it("stamps the originating jobId on the run row so re-process can dedupe", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult({ jobId: "job-XYZ" }));
    expect(runFake.calls.start).toHaveLength(1);
    expect(runFake.calls.start[0].jobId).toBe("job-XYZ");
  });

  // ── REQ-B: control-plane-detected comm error (no worker result) ──────────
  describe("aggregateCommError (crash/lease-expiry overlay, no worker result)", () => {
    const SWEEP_ERR: PoolCommError = {
      kind: "worker-crashed-mid-job",
      message:
        "lease for job job-1 expired (worker worker-7 crashed mid-job); re-queued",
      workerId: "worker-7",
      jobId: "job-1",
      observedAt: "2026-06-04T00:00:09.000Z",
    };

    it("writes the comm-error overlay onto the aggregate (d6:<slug>) status row the dashboard reads", async () => {
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });

      // Exactly one status write, onto the d6:<slug> aggregate key.
      expect(statusFake.writes).toHaveLength(1);
      const written = statusFake.writes[0].result;
      expect(written.key).toBe("d6:langgraph-python");
      // The comm error rides in the signal under the well-known key so the
      // dashboard re-surfaces "unreachable" — this is the bug fix: previously
      // the sweep/fleet-health comm errors were DROPPED and this overlay was
      // NEVER written (the red state).
      expect(commErrorFromStatusSignal(written.signal)).toEqual(SWEEP_ERR);
      expect(
        Object.prototype.hasOwnProperty.call(
          written.signal,
          FLEET_COMM_ERROR_SIGNAL_KEY,
        ),
      ).toBe(true);
      // observed_at comes from the comm error.
      expect(written.observedAt).toBe("2026-06-04T00:00:09.000Z");
    });

    it("writes the no-data ('error') state for a never-observed key — NEVER fabricates green", async () => {
      // REQ-B: a never-observed key (no lastKnownState) must NOT invent a green
      // status row for a service that has never been probed. The no-data
      // representation is "error" (status-writer routes it to status_history
      // only), so the dashboard shows no fabricated colour.
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });
      const written = statusFake.writes[0].result;
      expect(written.state).toBe("error");
      expect(written.state).not.toBe("green");
    });

    it("preserves a red last-known colour on a crash (does NOT stomp it to green)", async () => {
      // The CRITICAL false-green bug: a red service whose worker crashes must
      // stay red + unreachable overlay, not flip to green.
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        lastKnownState: "red",
      });
      const written = statusFake.writes[0].result;
      expect(written.state).toBe("red");
      expect(written.state).not.toBe("green");
      expect(commErrorFromStatusSignal(written.signal)).toEqual(SWEEP_ERR);
    });

    it("carries an explicit last-known colour when supplied (comm error never reads as fresh red)", async () => {
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        lastKnownState: "red",
      });
      const written = statusFake.writes[0].result;
      // The row keeps the prior colour; the dashboard derives "unreachable"
      // from the overlay, not from the colour.
      expect(written.state).toBe("red");
      expect(commErrorFromStatusSignal(written.signal)).toEqual(SWEEP_ERR);
    });

    it("also overlays the per-cell row when a cellKey is supplied", async () => {
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python/shared-state",
      });
      const keys = statusFake.writes.map((w) => w.result.key);
      expect(keys).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/shared-state",
      ]);
      for (const w of statusFake.writes) {
        expect(commErrorFromStatusSignal(w.result.signal)).toEqual(SWEEP_ERR);
      }
    });

    it("returns the per-write outcomes", async () => {
      const agg = makeAggregator();
      const out = await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });
      expect(out.statusOutcomes).toHaveLength(1);
    });

    it("does NOT touch run-history (no result to roll up on the crash leg)", async () => {
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });
      expect(runFake.calls.start).toHaveLength(0);
      expect(runFake.calls.finish).toHaveLength(0);
    });

    it("does NOT blind-trust a bogus lastKnownState — falls back to the no-data ('error') path", async () => {
      // A malformed/legacy value (not in the known State set) must not be
      // re-persisted as a bogus colour; it degrades to no-data.
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        // Force a bogus value past the type via the public input contract.
        lastKnownState: "bogus" as unknown as "green",
      });
      const written = statusFake.writes[0].result;
      expect(written.state).toBe("error");
    });
  });

  // ── M4 N1: idempotency under a failed latch / crash-pre-latch retry ──────
  describe("re-processing the same job's result is an idempotent no-op", () => {
    it("does NOT double-write status, double-bump run-history, or mint a duplicate run row", async () => {
      const agg = makeAggregator();
      const result = makeResult({ jobId: "job-dup", aggregateState: "red" });

      // First aggregate: full write path runs (terminal run row created).
      const first = await agg.aggregate(result);
      expect(first.skipped).toBe(false);
      const statusWritesAfterFirst = statusFake.writes.length;
      const startsAfterFirst = runFake.calls.start.length;
      const finishesAfterFirst = runFake.calls.finish.length;
      expect(statusWritesAfterFirst).toBe(3); // primary + 2 cells
      expect(startsAfterFirst).toBe(1);
      expect(finishesAfterFirst).toBe(1);

      // Simulate the latch write having failed: the SAME result is re-handed
      // to the aggregator next tick. It must be a true no-op.
      const second = await agg.aggregate(result);

      expect(second.skipped).toBe(true);
      // NO additional status writes → no fail_count bump, no duplicate
      // status_history row, no re-emitted status.changed.
      expect(statusFake.writes.length).toBe(statusWritesAfterFirst);
      // NO duplicate probe_runs row (start not called again).
      expect(runFake.calls.start.length).toBe(startsAfterFirst);
      // NO second finish either.
      expect(runFake.calls.finish.length).toBe(finishesAfterFirst);
      // The no-op still reports the original run row id.
      expect(second.runRowId).toBe(first.runRowId);
    });

    it("RESUMES (does not duplicate) when a prior attempt crashed mid-aggregate (running row)", async () => {
      // Pre-seed a still-RUNNING run row for this job (start succeeded, the
      // process died before status writes / finish).
      runFake.rows.push({
        id: "run-row-crashed",
        jobId: "job-crash",
        terminal: false,
      });

      const agg = makeAggregator();
      const out = await agg.aggregate(makeResult({ jobId: "job-crash" }));

      // It resumes on the existing row — no new start() (no duplicate row).
      expect(out.skipped).toBe(false);
      expect(runFake.calls.start).toHaveLength(0);
      expect(out.runRowId).toBe("run-row-crashed");
      // Status + finish DO run (the crashed attempt never completed them).
      expect(statusFake.writes.length).toBe(3);
      expect(runFake.calls.finish).toHaveLength(1);
      expect(runFake.calls.finish[0].id).toBe("run-row-crashed");
    });
  });
});
