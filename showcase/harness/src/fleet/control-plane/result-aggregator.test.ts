import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type {
  ProbeResult,
  ProbeState,
  State,
  StatusRecord,
  WriteOutcome,
  Logger,
} from "../../types/index.js";
import type { PbClient } from "../../storage/pb-client.js";
import { createEventBus } from "../../events/event-bus.js";
import type {
  ProbeRunSummary,
  ProbeRunWriter,
  ProbeRunRecord,
} from "../../probes/run-history.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import {
  FLEET_COMM_ERROR_SIGNAL_KEY,
  commErrorFromStatusSignal,
  probeResultsForServiceJobResult,
  type PoolCommError,
  type ServiceJobResult,
} from "../contracts.js";
import { createResultAggregator } from "./result-aggregator.js";
import { createStatusWriter } from "../../writers/status-writer.js";

// Wrap the projection in a PASSTHROUGH vi.fn so the empty-projection guard
// test below can stub a degenerate [] return for ONE call. Every other test
// gets the real implementation unchanged.
vi.mock("../contracts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../contracts.js")>();
  return {
    ...actual,
    probeResultsForServiceJobResult: vi.fn(
      actual.probeResultsForServiceJobResult,
    ),
  };
});

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

interface RecordedOverlay {
  key: string;
  signal: Record<string, unknown>;
  observedAt: string;
}

function makeFakeStatusWriter(): {
  writer: StatusWriter;
  writes: RecordedWrite[];
  overlays: RecordedOverlay[];
} {
  const writes: RecordedWrite[] = [];
  const overlays: RecordedOverlay[] = [];
  const writer: StatusWriter = {
    async write(result) {
      writes.push({ result });
      const outcome: WriteOutcome = {
        previousState: null,
        newState: result.state,
        transition: "first",
        firstFailureAt: null,
        failCount: 0,
        persisted: true,
      };
      return outcome;
    },
    async writeOverlay(overlay) {
      overlays.push(overlay);
      // The naive fake treats every key as observed (the H1 overlay applies).
      // B6 (round 7): stamp historyPersisted like the real writer's applied
      // leg (overlay + audit history row both landed).
      return { applied: true, state: "red", historyPersisted: true };
    },
  };
  return { writer, writes, overlays };
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
  /** Every H1 overlay write (for overlay-routing assertions). */
  overlays: RecordedOverlay[];
} {
  const statusRows = new Map<string, { state: State; signal: unknown }>();
  const writes: RecordedWrite[] = [];
  const overlays: RecordedOverlay[] = [];
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
          // F2a contract: errorStatePrev is the prior OBSERVED colour, or
          // null for a never-observed key — NEVER a fabricated "green".
          errorStatePrev: statusRows.get(result.key)?.state ?? null,
          transition: "error",
          firstFailureAt: null,
          failCount: 0,
          // Mirrors the real error path: the observed_at refresh persists
          // only when a prior status row exists (first-ever error → false).
          persisted: statusRows.has(result.key),
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
        persisted: true,
      };
      return outcome;
    },
    async writeOverlay(overlay) {
      overlays.push(overlay);
      // Mirrors the REAL writeOverlay (H1): the overlay merges over an
      // EXISTING row's signal while the row's state is preserved; a
      // never-observed key applies nothing. B6 (round 7): stamp
      // historyPersisted like the real writer — never-observed returns
      // {applied:false,state:null,historyPersisted:false} (nothing
      // persisted), and an applied overlay also lands its audit row.
      const existing = statusRows.get(overlay.key);
      if (!existing)
        return { applied: false, state: null, historyPersisted: false };
      const base =
        existing.signal && typeof existing.signal === "object"
          ? (existing.signal as Record<string, unknown>)
          : {};
      statusRows.set(overlay.key, {
        state: existing.state,
        signal: { ...base, ...overlay.signal },
      });
      return { applied: true, state: existing.state, historyPersisted: true };
    },
  };
  return { writer, statusRows, writes, overlays };
}

/**
 * A fake whose `WriteOutcome.previousState`/`newState` are canned per key, so
 * tests can exercise specific durable-State transitions (green→red, red→green)
 * and error ticks (`newState: "error"`) — the §4.2 reds-counter inputs. Keys
 * without a canned outcome fall back to `makeFakeStatusWriter` behavior.
 */
function makeCannedTransitionStatusWriter(
  outcomesByKey: Record<
    string,
    Pick<WriteOutcome, "previousState" | "newState">
  >,
): { writer: StatusWriter; writes: RecordedWrite[] } {
  const writes: RecordedWrite[] = [];
  const writer: StatusWriter = {
    async write(result) {
      writes.push({ result });
      const canned = outcomesByKey[result.key];
      const outcome: WriteOutcome = {
        previousState:
          canned?.previousState !== undefined ? canned.previousState : null,
        newState:
          canned?.newState ??
          (result.state === "error" ? "error" : result.state),
        transition: canned?.newState === "error" ? "error" : "first",
        firstFailureAt: null,
        failCount: 0,
        persisted: true,
      };
      return outcome;
    },
    async writeOverlay() {
      return { applied: false, state: null };
    },
  };
  return { writer, writes };
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
      const match = [...rows].reverse().find((r) => r.jobId === jobId);
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

  afterEach(() => {
    // The module-level vi.mock wraps probeResultsForServiceJobResult in a
    // passthrough vi.fn so one test can queue a degenerate [] return via
    // mockReturnValueOnce. mockReset clears any leftover queued
    // once-implementations (e.g. when that test fails before consuming it)
    // AND restores the original passthrough, so no stub leaks across tests.
    vi.mocked(probeResultsForServiceJobResult).mockReset();
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
    expect(finish.summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      // §4.2 counters ride every fleet-aggregated summary (0 when the fake
      // writer reports no green→red / red→green durable transitions).
      redsIntroduced: 0,
      redsCleared: 0,
    });
  });

  it("marks the run completed when the aggregate state is green", async () => {
    const agg = makeAggregator();
    await agg.aggregate(
      makeResult({
        aggregateState: "green",
        rollup: { total: 1, passed: 1, failed: 0 },
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
      total: 1,
      passed: 1,
      failed: 0,
      redsIntroduced: 0,
      redsCleared: 0,
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

  it("[REQ-B] still persists per-cell rows and run-history on a comm-error result", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult({ commError: SAMPLE_COMM_ERROR }));
    // Durable writes: the trusted-negative primary (aggregateState red) + the
    // red cell. The GREEN cell is untrusted under a commError (B2) and routes
    // overlay-first instead (the naive fake applies every overlay).
    expect(statusFake.writes.map((w) => w.result.key)).toEqual([
      "d6:langgraph-python",
      "d6:langgraph-python/human-in-the-loop",
    ]);
    expect(statusFake.overlays.map((o) => o.key)).toEqual([
      "d6:langgraph-python/shared-state",
    ]);
    // a comm error is a failed terminal run
    expect(runFake.calls.finish[0].state).toBe("failed");
  });

  describe("[B2] per-cell trust symmetry under a comm-error result", () => {
    // The same distrust rule the PRIMARY applies must hold PER CELL: a
    // commError means the whole result is untrusted, so a worker-reported
    // GREEN cell from it must never become a durable green status row — it
    // routes overlay-first (writeOverlay; applied:false → history-only
    // no-data "error" write), exactly like the primary. A NON-GREEN carried
    // cell state is a legitimate negative observation and writes durably.
    it("never durably writes a GREEN cell — overlay lands on an OBSERVED cell row, colour preserved", async () => {
      const errorFake = makeErrorRoutingFakeStatusWriter();
      errorFake.statusRows.set("d6:langgraph-python/shared-state", {
        state: "red",
        signal: { prior: true },
      });
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

      // The observed cell row keeps its durable red and gains the overlay —
      // the untrusted green is never persisted.
      const cell = errorFake.statusRows.get("d6:langgraph-python/shared-state");
      expect(cell).toBeDefined();
      expect(cell!.state).toBe("red");
      expect(cell!.state).not.toBe("green");
      expect(commErrorFromStatusSignal(cell!.signal)).toEqual(
        SAMPLE_COMM_ERROR,
      );
      // No durable write() reached the cell key.
      expect(
        errorFake.writes.filter(
          (w) => w.result.key === "d6:langgraph-python/shared-state",
        ),
      ).toHaveLength(0);
    });

    it("routes a never-observed GREEN cell history-only (no durable green row fabricated)", async () => {
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

      // No green (or any) status row fabricated for the never-observed cell.
      expect(
        errorFake.statusRows.get("d6:langgraph-python/shared-state"),
      ).toBeUndefined();
      // The cell's comm error is still auditable via the history-only
      // no-data ("error") fallback write.
      const cellWrites = errorFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python/shared-state",
      );
      expect(cellWrites).toHaveLength(1);
      expect(cellWrites[0].result.state).toBe("error");
      expect(commErrorFromStatusSignal(cellWrites[0].result.signal)).toEqual(
        SAMPLE_COMM_ERROR,
      );
    });

    it("durably writes a NON-GREEN (red) cell from the same comm-error result (legitimate negative observation)", async () => {
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
          cells: [
            {
              cellId: "human-in-the-loop",
              cellKey: "d6:langgraph-python/human-in-the-loop",
              state: "red",
              signal: { ok: false },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      // The negative cell observation persists durably.
      const cell = errorFake.statusRows.get(
        "d6:langgraph-python/human-in-the-loop",
      );
      expect(cell).toBeDefined();
      expect(cell!.state).toBe("red");
    });

    it("merges the comm-error overlay onto a trusted-negative cell's durable write (same merge the primary's write route gets)", async () => {
      // The loop comment claims "the identical per-row distrust predicate the
      // primary uses" — but the primary's "write" route ALSO merges
      // withCommErrorOverlay into its signal, while a red/degraded cell wrote
      // its ORIGINAL signal: the dashboard could re-surface "unreachable" for
      // the primary but not for the cell observed off the same untrusted
      // result. The trusted-negative cell write must carry the overlay too,
      // with its original signal fields preserved alongside it.
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
          cells: [
            {
              cellId: "human-in-the-loop",
              cellKey: "d6:langgraph-python/human-in-the-loop",
              state: "red",
              signal: { ok: false },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      const cell = errorFake.statusRows.get(
        "d6:langgraph-python/human-in-the-loop",
      );
      expect(cell).toBeDefined();
      expect(cell!.state).toBe("red");
      // The comm error rides the cell's persisted signal under the well-known
      // key, with the original signal preserved alongside it.
      expect(commErrorFromStatusSignal(cell!.signal)).toEqual(
        SAMPLE_COMM_ERROR,
      );
      expect((cell!.signal as Record<string, unknown>).ok).toBe(false);
    });
  });

  describe("[B1] DEFENSIVE branch: overlay row-miss with historyPersisted:true", () => {
    // DEFENSIVE-BRANCH EXERCISE — the mock below returns a shape the CURRENT
    // writer never produces: since the update-first overlay reordering, the
    // vanished-404 leg returns `applied: false, historyPersisted: false`
    // BEFORE any history write, so `applied: false` + `historyPersisted:
    // true` is writer-impossible today. The aggregator keeps the skip branch
    // as cheap, honest protection against a future writer that DID persist
    // history before failing the apply: that history row would BE the
    // no-drop guarantee, and the fallback error-write would append a SECOND
    // status_history row for the same comm error. These tests pin that both
    // call sites skip the fallback on that (synthetic) outcome.
    function makeVanished404FakeStatusWriter(): {
      writer: StatusWriter;
      writes: RecordedWrite[];
      overlays: RecordedOverlay[];
    } {
      const writes: RecordedWrite[] = [];
      const overlays: RecordedOverlay[] = [];
      const writer: StatusWriter = {
        async write(result) {
          writes.push({ result });
          return {
            previousState: null,
            newState: result.state,
            errorStatePrev: null,
            transition: "error",
            firstFailureAt: null,
            failCount: 0,
            persisted: false,
          };
        },
        async writeOverlay(overlay) {
          overlays.push(overlay);
          return { applied: false, state: null, historyPersisted: true };
        },
      };
      return { writer, writes, overlays };
    }

    it("aggregate(): skips the fallback error-write — no second history row", async () => {
      const fake = makeVanished404FakeStatusWriter();
      const agg = createResultAggregator({
        statusWriter: fake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });

      const outcome = await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          aggregateSignal: { failedCount: 0 },
          cells: [],
        }),
      );

      // The overlay was attempted (and missed the live row) …
      expect(fake.overlays.map((o) => o.key)).toEqual(["d6:langgraph-python"]);
      expect(outcome.overlayOutcomes).toHaveLength(1);
      // … but its history row persisted, so NO fallback error-write runs.
      expect(fake.writes).toHaveLength(0);
      expect(outcome.statusOutcomes).toHaveLength(0);
    });

    it("aggregateCommError(): skips the fallback error-write — no second history row", async () => {
      const fake = makeVanished404FakeStatusWriter();
      const agg = createResultAggregator({
        statusWriter: fake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });

      const out = await agg.aggregateCommError({
        commError: SAMPLE_COMM_ERROR,
        aggregateKey: "d6:langgraph-python",
      });

      expect(fake.overlays).toHaveLength(1);
      expect(out.overlayOutcomes).toHaveLength(1);
      expect(fake.writes).toHaveLength(0);
      expect(out.statusOutcomes).toHaveLength(0);
    });

    it("[B4r6] a SWALLOWED-OUTAGE overlay outcome (persisted: false) skips the fallback on both legs — a PB outage is not 'never observed'", async () => {
      // The best-effort wrapper's discriminator: `applied: false` with
      // `persisted: false` means the overlay write never REACHED PB (row
      // existence unknown), not that the row is missing. The no-data
      // fallback would record a bogus never-observed history row (and ride
      // the same outage). Skip it with a warn instead.
      const writes: RecordedWrite[] = [];
      const outageWriter: StatusWriter = {
        async write(result) {
          writes.push({ result });
          return {
            previousState: null,
            newState: result.state,
            errorStatePrev: null,
            transition: "error",
            firstFailureAt: null,
            failCount: 0,
            persisted: false,
          };
        },
        async writeOverlay() {
          return { applied: false, state: null, persisted: false };
        },
      };
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        error() {},
        debug() {},
        warn(msg: string, ctx?: Record<string, unknown>) {
          warns.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: outageWriter,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      const aggOut = await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          aggregateSignal: { failedCount: 0 },
          cells: [],
        }),
      );
      // No fallback no-data write ran for the swallowed outage …
      expect(writes).toHaveLength(0);
      // … and the skip is loud.
      const skipped = warns.filter(
        (w) => w.msg === "fleet.aggregator.overlay-outage-fallback-skipped",
      );
      expect(skipped).toHaveLength(1);
      expect(skipped[0].ctx).toMatchObject({
        key: "d6:langgraph-python",
        jobId: "job-1",
      });
      // [B3r7] HONEST consequence: this call resolves successfully (the run
      // row finishes terminal, the consumer latches), so nothing retries —
      // the warn must say the drop is PERMANENT, not imply a caller retry.
      expect(String(skipped[0].ctx?.consequence)).toMatch(/permanent/i);
      // [B3r7] The skip is OBSERVABLE on the outcome — callers of a
      // best-effort-wrapped writer can detect the unpersisted comm error.
      expect(aggOut.outageSkippedKeys).toEqual(["d6:langgraph-python"]);

      const out = await agg.aggregateCommError({
        commError: SAMPLE_COMM_ERROR,
        aggregateKey: "d6:langgraph-python",
      });
      expect(writes).toHaveLength(0);
      expect(out.statusOutcomes).toHaveLength(0);
      expect(out.overlayOutcomes).toHaveLength(1);
      const allSkipped = warns.filter(
        (w) => w.msg === "fleet.aggregator.overlay-outage-fallback-skipped",
      );
      expect(allSkipped).toHaveLength(2);
      expect(String(allSkipped[1].ctx?.consequence)).toMatch(/permanent/i);
      // [B3r7] Same discriminator on the aggregateCommError outcome.
      expect(out.outageSkippedKeys).toEqual(["d6:langgraph-python"]);
    });

    it("a GENUINE miss (no historyPersisted) still falls back to the error-write on both legs", async () => {
      // The errorRouting fake's writeOverlay returns
      // `{ applied: false, state: null, historyPersisted: false }` for an
      // absent key — the real writer's never-observed leg, where NOTHING
      // persisted (the fake previously returned a BARE
      // `{ applied: false, state: null }`, which is NOT a shape the real
      // writer produces — B6 round 7 stamped it). The fallback must run
      // unchanged.
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
          cells: [],
        }),
      );
      expect(errorFake.writes).toHaveLength(1);
      expect(errorFake.writes[0].result.state).toBe("error");

      await agg.aggregateCommError({
        commError: SAMPLE_COMM_ERROR,
        aggregateKey: "d6:never-observed",
      });
      expect(errorFake.writes).toHaveLength(2);
      expect(errorFake.writes[1].result.key).toBe("d6:never-observed");
      expect(errorFake.writes[1].result.state).toBe("error");
    });
  });

  it("[REQ-B/F2.1] routes a never-observed worker-self-report comm error HISTORY-ONLY (no status row fabricated)", async () => {
    // F2.1 no-false-baseline: a key that has NEVER been observed (no prior
    // status row, no resolvable colour) must not get a fabricated status row —
    // not green, not degraded. The comm error is persisted via the no-data
    // ("error") route, which the status-writer records in status_history only.
    // The no-drop guarantee is HISTORY persistence, matching
    // aggregateCommError's never-observed leg.
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

    // No status row invented for the never-observed aggregate key.
    expect(errorFake.statusRows.get("d6:langgraph-python")).toBeUndefined();
    // The primary write went through the no-data ("error") route, carrying
    // the overlay so it is auditable in status_history.
    const primary = errorFake.writes[0].result;
    expect(primary.key).toBe("d6:langgraph-python");
    expect(primary.state).toBe("error");
    expect(commErrorFromStatusSignal(primary.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("[REQ-B] does NOT carry a worker-reported 'green' aggregateState onto a comm-error primary row (corrupt/untrusted result must never fabricate green)", async () => {
    // CRITICAL false-green: a persisted/decoded result that carries a commError
    // but a (corrupt / untrusted) aggregateState:"green" must NOT write a GREEN
    // status row for a service we could not reach. A commError means we did NOT
    // get a trustworthy result, so the worker's "green" cannot be carried — it
    // takes the overlay-first route; the never-observed key misses
    // (applied:false) and falls back to the history-only no-data ("error")
    // write. F2.1: a never-observed key gets NO fabricated status row of ANY
    // colour (the pre-F2.1 behaviour invented a "degraded" baseline here).
    const errorFake = makeErrorRoutingFakeStatusWriter();
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
      // No status row for the key → overlay misses → history-only, never green.
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "green",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    // No status row of any colour is invented for the never-observed key.
    expect(errorFake.statusRows.get("d6:langgraph-python")).toBeUndefined();
    const primary = errorFake.writes[0].result;
    expect(primary.state).toBe("error");
    expect(primary.state).not.toBe("green");
    // The overlay is still persisted (history-only) for auditability.
    expect(commErrorFromStatusSignal(primary.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("[REQ-B] carries the PRIOR observed colour (not 'green') when a comm-error result reports aggregateState 'green'", async () => {
    // Same corrupt-green path, but with an OBSERVED status row present: a red
    // service whose decoded comm-error result claims green must stay red +
    // unreachable overlay, never flip to the untrusted green. With H1 the
    // prior colour is preserved by routing through writeOverlay (no same-state
    // re-write), so the existing red row keeps its state + gains the overlay.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    errorFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "green",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    // The primary row took the H1 overlay route, not a normal write.
    expect(errorFake.overlays.map((o) => o.key)).toContain(
      "d6:langgraph-python",
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
    // When the key has an OBSERVED status row, the comm-error primary row
    // keeps its colour (a red service whose worker then reports a comm error
    // stays red + unreachable overlay) — never error, never a fabricated
    // green. With H1 the preservation is via writeOverlay (no same-state
    // re-write).
    const errorFake = makeErrorRoutingFakeStatusWriter();
    errorFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
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

    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("lands the overlay on an OBSERVED live row with no resolver wired (worker-self-report comm error)", async () => {
    // An OBSERVED key's comm error must NOT silently degrade to the
    // history-only no-data write — the error-path write only refreshes
    // observed_at, it never merges the overlay into the live row's signal,
    // so the dashboard showed nothing despite the row existing. The
    // overlay-first route attempts writeOverlay FIRST (per-key `applied` is
    // the source of truth, same as aggregateCommError's F1d routing); only a
    // real miss falls back to the history-only error write.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    errorFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
    });

    const outcome = await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
        cells: [],
      }),
    );

    // The overlay landed on the LIVE status row, colour preserved.
    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
    // Routed via writeOverlay (reported in overlayOutcomes) — no fallback
    // history-only write for the primary.
    expect(outcome.overlayOutcomes).toHaveLength(1);
    expect(outcome.overlayOutcomes[0].applied).toBe(true);
    expect(
      errorFake.writes.filter((w) => w.result.key === "d6:langgraph-python"),
    ).toHaveLength(0);
  });

  it("[B1] does NOT consult resolvePriorState on the comm-error primary route (per-key writeOverlay decides — one less PB roundtrip)", async () => {
    // B1: the primary route's old 3-way union awaited readPriorState solely to
    // pick "overlay" vs "no-data", but the caller treated both identically
    // (writeOverlay attempted first either way — per-key `applied` is the
    // source of truth, F1d). The consult is dead routing: it must be skipped
    // entirely, and the overlay must still land on the observed live row.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    errorFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
    const resolver = vi.fn(async (): Promise<State> => "red");
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
      resolvePriorState: resolver,
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
        cells: [],
      }),
    );

    // The deprecated resolver is accepted but never consulted.
    expect(resolver).not.toHaveBeenCalled();
    // The overlay still landed on the observed live row, colour preserved.
    const persisted = errorFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(commErrorFromStatusSignal(persisted!.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("[B2] logs at ERROR level (jobId + aggregateKey) when a comm-error result projects to an EMPTY row set", async () => {
    // The comm-error primary route is gated on `probeResults.length > 0`; if
    // the projection ever degenerates to [], the comm error reaches NEITHER a
    // status row NOR status_history through the write loop — nothing is
    // written at all, so there is no history-persistence no-drop guarantee on
    // this path. Unreachable by construction today
    // (probeResultsForServiceJobResult always returns [primary, ...cells]),
    // but if the projection ever changes the drop must be LOUD, not silent —
    // the F1d identity assert only protects key drift, not emptiness.
    const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
    const logger: Logger = {
      info() {},
      warn() {},
      debug() {},
      error(msg: string, ctx?: Record<string, unknown>) {
        errors.push({ msg, ctx });
      },
    };
    vi.mocked(probeResultsForServiceJobResult).mockReturnValueOnce([]);
    const agg = createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: runFake.writer,
      logger,
      now: () => now,
    });

    const outcome = await agg.aggregate(
      makeResult({ commError: SAMPLE_COMM_ERROR }),
    );

    // Nothing could carry the comm error (no rows to write/overlay) …
    expect(statusFake.writes).toHaveLength(0);
    expect(statusFake.overlays).toHaveLength(0);
    // … so the drop is surfaced loudly with the identifying keys.
    const dropped = errors.filter(
      (e) => e.msg === "fleet.aggregator.commerror-dropped-empty-projection",
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0].ctx).toMatchObject({
      jobId: "job-1",
      aggregateKey: "d6:langgraph-python",
    });
    // [B3r7] The error-log alone left the outcome HEALTHY-SHAPED — a caller
    // could not tell this aggregation dropped its comm error. The outcome
    // carries an explicit discriminator instead of throwing (a DETERMINISTIC
    // empty projection would infinite-retry through the consumer's
    // unlatch-on-reject path).
    expect(outcome.droppedCommError).toBe(true);
  });

  it("[G2r8] surfaces droppedCommError when the PLAN empties (all projected rows blank-skipped) — not only when the projection is empty", async () => {
    // A non-empty projection whose rows are ALL blank/whitespace is
    // blank-skipped row by row, so the write loop runs over an EMPTY plan:
    // the comm error reaches neither a status row nor status_history — the
    // same permanent, invisible drop the empty-projection leg guards (B3r7)
    // — yet the outcome returned droppedCommError:false / outageSkippedKeys
    // [] (healthy-shaped), defeating the discriminator guarantee.
    const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
    const logger: Logger = {
      info() {},
      warn() {},
      debug() {},
      error(msg: string, ctx?: Record<string, unknown>) {
        errors.push({ msg, ctx });
      },
    };
    const agg = createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: runFake.writer,
      logger,
      now: () => now,
    });

    const outcome = await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateKey: "   ", // blank-skipped primary (trims to "")
        aggregateState: "error",
        cells: [],
      }),
    );

    // Nothing carried the comm error — no write, no overlay …
    expect(statusFake.writes).toHaveLength(0);
    expect(statusFake.overlays).toHaveLength(0);
    // … so the outcome must NOT be healthy-shaped.
    expect(outcome.droppedCommError).toBe(true);
    // And the drop is loud, with the identifying keys.
    expect(
      errors.filter((e) =>
        e.msg.startsWith("fleet.aggregator.commerror-dropped"),
      ),
    ).toHaveLength(1);
  });

  it("[G2r9] surfaces droppedCommError when the blank-skipped PRIMARY drops the comm error even though cells SURVIVE", async () => {
    // A blank aggregateKey blank-skips the PRIMARY row, but a valid cell
    // keeps the plan NON-empty — so the empty-plan guard (planned.length
    // === 0) never fires. The comm error never reaches the aggregate row
    // the dashboard reads (the surviving green cell routes overlay-first
    // and carries it only on the CELL row), yet the outcome returned
    // droppedCommError:false — healthy-shaped, the drop permanent and
    // invisible to callers.
    const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
    const logger: Logger = {
      info() {},
      warn() {},
      debug() {},
      error(msg: string, ctx?: Record<string, unknown>) {
        errors.push({ msg, ctx });
      },
    };
    const agg = createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: runFake.writer,
      logger,
      now: () => now,
    });

    const outcome = await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateKey: "   ", // blank-skipped primary (trims to "")
        aggregateState: "error",
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

    // The surviving cell still processed (overlay-first under the comm
    // error — one dropped primary must not reject the whole result) …
    expect(statusFake.overlays.map((o) => o.key)).toEqual([
      "d6:langgraph-python/shared-state",
    ]);
    // … but the AGGREGATE row never received the comm error, so the
    // outcome must not be healthy-shaped.
    expect(outcome.droppedCommError).toBe(true);
    // And the drop is LOUD at ERROR level (matching the drift leg).
    expect(
      errors.filter(
        (e) => e.msg === "fleet.aggregator.commerror-dropped-blank-primary",
      ),
    ).toHaveLength(1);
  });

  describe("[G2r9] applied overlay whose audit row failed (historyPersisted:false) is warned, not silent", () => {
    // The real writer can return `applied: true, historyPersisted: false` —
    // the overlay landed on the live row but the status_history audit-row
    // create failed. Both writeOverlay legs accepted that outcome silently:
    // audit-trail loss with no aggregator-level signal.
    function makeAuditLossFakeStatusWriter(): {
      writer: StatusWriter;
      overlays: RecordedOverlay[];
    } {
      const overlays: RecordedOverlay[] = [];
      const writer: StatusWriter = {
        async write(result) {
          return {
            previousState: null,
            newState: result.state,
            transition: "first",
            firstFailureAt: null,
            failCount: 0,
            persisted: true,
          };
        },
        async writeOverlay(overlay) {
          overlays.push(overlay);
          return { applied: true, state: "red", historyPersisted: false };
        },
      };
      return { writer, overlays };
    }

    function capturingWarnLogger(): {
      logger: Logger;
      warns: { msg: string; ctx?: Record<string, unknown> }[];
    } {
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      return {
        warns,
        logger: {
          info() {},
          error() {},
          debug() {},
          warn(msg: string, ctx?: Record<string, unknown>) {
            warns.push({ msg, ctx });
          },
        },
      };
    }

    it("aggregate() worker-self-report leg warns with jobId/key context", async () => {
      const auditLoss = makeAuditLossFakeStatusWriter();
      const cap = capturingWarnLogger();
      const agg = createResultAggregator({
        statusWriter: auditLoss.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          cells: [],
        }),
      );

      // The overlay APPLIED (live row correct) but its audit row failed …
      expect(auditLoss.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
      ]);
      // … which must be observable in the logs, with identifying context.
      const warns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.overlay-history-not-persisted",
      );
      expect(warns).toHaveLength(1);
      expect(warns[0].ctx).toMatchObject({
        key: "d6:langgraph-python",
        jobId: "job-1",
      });
    });

    it("aggregateCommError leg warns per key with jobId/key context", async () => {
      const auditLoss = makeAuditLossFakeStatusWriter();
      const cap = capturingWarnLogger();
      const agg = createResultAggregator({
        statusWriter: auditLoss.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregateCommError({
        commError: SAMPLE_COMM_ERROR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python/shared-state",
      });

      const warns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.overlay-history-not-persisted",
      );
      expect(warns).toHaveLength(2);
      expect(warns[0].ctx).toMatchObject({
        key: "d6:langgraph-python",
        jobId: "job-1",
      });
      expect(warns[1].ctx).toMatchObject({
        key: "d6:langgraph-python/shared-state",
        jobId: "job-1",
      });
    });
  });

  it("[B3r7] healthy outcomes carry empty/false discriminators (no skips, no drop)", async () => {
    const agg = makeAggregator();
    const outcome = await agg.aggregate(makeResult());
    expect(outcome.outageSkippedKeys).toEqual([]);
    expect(outcome.droppedCommError).toBe(false);

    const out = await agg.aggregateCommError({
      commError: SAMPLE_COMM_ERROR,
      aggregateKey: "d6:langgraph-python",
    });
    expect(out.outageSkippedKeys).toEqual([]);
  });

  it("[G2r9] stamping the trusted-negative primary colour does not mutate the projection's returned array", async () => {
    // The trusted-negative primary route replaced probeResults[0] IN PLACE —
    // mutating the array the projection returned to the caller. Today the
    // real projection mints a fresh array per call, but the aggregator must
    // not depend on that: a memoizing/caching projection would see its
    // cached primary silently rewritten.
    const projected: ProbeResult[] = [
      {
        key: "d6:langgraph-python",
        state: "error",
        signal: {},
        observedAt: "2026-06-04T00:00:03.000Z",
      },
      {
        key: "d6:langgraph-python/human-in-the-loop",
        state: "red",
        signal: { ok: false },
        observedAt: "2026-06-04T00:00:02.000Z",
      },
    ];
    const primaryRef = projected[0];
    vi.mocked(probeResultsForServiceJobResult).mockReturnValueOnce(projected);
    const agg = makeAggregator();

    await agg.aggregate(
      makeResult({ commError: SAMPLE_COMM_ERROR, aggregateState: "red" }),
    );

    // The durable write carried the trusted-negative colour …
    expect(statusFake.writes[0].result.key).toBe("d6:langgraph-python");
    expect(statusFake.writes[0].result.state).toBe("red");
    // … while the caller-visible projection array is untouched: same
    // element identity, original state.
    expect(projected[0]).toBe(primaryRef);
    expect(projected[0].state).toBe("error");
  });

  it("[REQ-B/H1/F2.1] falls back to the history-only no-data write when the overlay-first attempt misses (no row)", async () => {
    // The overlay-first route attempted writeOverlay but the key has no
    // status row (never observed, or vanished) → applied:false → the comm
    // error must still be persisted via the history-only no-data ("error")
    // write — F2.1: a missing key gets NO fabricated status row (the
    // pre-F2.1 behaviour wrote a fresh "degraded" baseline here). The
    // no-drop guarantee is history persistence, matching aggregateCommError's
    // identical fallback leg.
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

    // The overlay was attempted, did not apply (row gone) …
    expect(errorFake.overlays.map((o) => o.key)).toContain(
      "d6:langgraph-python",
    );
    // … and NO status row was re-fabricated for the vanished key.
    expect(errorFake.statusRows.get("d6:langgraph-python")).toBeUndefined();
    // The fallback write carried the overlay through the no-data route.
    const fallback = errorFake.writes[0].result;
    expect(fallback.key).toBe("d6:langgraph-python");
    expect(fallback.state).toBe("error");
    expect(commErrorFromStatusSignal(fallback.signal)).toEqual(
      SAMPLE_COMM_ERROR,
    );
  });

  it("returns the per-write outcomes and the run-row id", async () => {
    const agg = makeAggregator();
    const outcome = await agg.aggregate(makeResult());
    expect(outcome.runRowId).toBe("run-row-1");
    expect(outcome.statusOutcomes).toHaveLength(3);
    expect(outcome.overlayOutcomes).toEqual([]);
    expect(outcome.skipped).toBe(false);
  });

  it("[F1a] reports the applied primary overlay outcome in overlayOutcomes (not silently dropped from statusOutcomes)", async () => {
    // When the primary row takes the H1 overlay route, its OverlayWriteOutcome
    // must be REPORTED — previously it was discarded, so statusOutcomes
    // silently had N−1 entries and the primary write was unobservable to
    // index-correlating consumers.
    const errorFake = makeErrorRoutingFakeStatusWriter();
    errorFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
    const agg = createResultAggregator({
      statusWriter: errorFake.writer,
      runWriter: runFake.writer,
      logger: makeLogger(),
      now: () => now,
    });

    const outcome = await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
      }),
    );

    // The primary's overlay outcome is surfaced in overlayOutcomes, first in
    // write order; the untrusted GREEN cell (B2) also routed overlay-first
    // (and, never observed in this fake, did not apply).
    expect(outcome.overlayOutcomes).toHaveLength(2);
    expect(outcome.overlayOutcomes[0].applied).toBe(true);
    expect(outcome.overlayOutcomes[1].applied).toBe(false);
    // … while statusOutcomes carries the remaining writes: the green cell's
    // history-only fallback + the red cell's durable write.
    expect(outcome.statusOutcomes).toHaveLength(2);
  });

  it("stamps the originating jobId on the run row so re-process can dedupe", async () => {
    const agg = makeAggregator();
    await agg.aggregate(makeResult({ jobId: "job-XYZ" }));
    expect(runFake.calls.start).toHaveLength(1);
    expect(runFake.calls.start[0].jobId).toBe("job-XYZ");
  });

  // ── B2 (round 6): duplicate/colliding projected keys in aggregate() ──────
  describe("[B2r6] duplicate/colliding projected keys are deduped (first occurrence wins)", () => {
    // aggregateCommError already guards key collision (cellKey collapsing
    // into aggregateKey routes ONE key); aggregate() had no equivalent — a
    // malformed worker result with duplicate cell keys (or a cell colliding
    // with the aggregateKey) wrote the SAME status row twice in one
    // aggregation: double fail_count bump, duplicate status_history row,
    // duplicate status.changed emit.
    function capturingLogger(): {
      logger: Logger;
      warns: { msg: string; ctx?: Record<string, unknown> }[];
    } {
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      return {
        warns,
        logger: {
          info() {},
          error() {},
          debug() {},
          warn(msg: string, ctx?: Record<string, unknown>) {
            warns.push({ msg, ctx });
          },
        },
      };
    }

    it("skips a duplicate cell key with a warn — only the FIRST occurrence writes", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "shared-state",
              cellKey: "d6:langgraph-python/shared-state",
              state: "green",
              signal: { first: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
            {
              cellId: "shared-state-dup",
              cellKey: "d6:langgraph-python/shared-state",
              state: "red",
              signal: { second: true },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      const cellWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python/shared-state",
      );
      // One write only — the first occurrence wins; the duplicate is skipped.
      expect(cellWrites).toHaveLength(1);
      expect(cellWrites[0].result.signal).toEqual({ first: true });
      const dupWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
      );
      expect(dupWarns).toHaveLength(1);
      expect(dupWarns[0].ctx).toMatchObject({
        key: "d6:langgraph-python/shared-state",
        jobId: "job-1",
        aggregateKey: "d6:langgraph-python",
      });
    });

    it("skips a cell COLLIDING with the aggregateKey — the primary row wins", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "colliding",
              cellKey: "d6:langgraph-python", // collides with the aggregate
              state: "green",
              signal: { cell: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );

      const primaryWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python",
      );
      // The PRIMARY (projected first) wins; the colliding cell never writes.
      expect(primaryWrites).toHaveLength(1);
      expect(primaryWrites[0].result.state).toBe("red");
      expect(primaryWrites[0].result.signal).toEqual({ failedCount: 1 });
      expect(
        cap.warns.filter(
          (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
        ),
      ).toHaveLength(1);
    });

    it("dedupes the overlay route too — a duplicate untrusted-GREEN cell under a commError overlays once", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          cells: [
            {
              cellId: "shared-state",
              cellKey: "d6:langgraph-python/shared-state",
              state: "green",
              signal: { first: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
            {
              cellId: "shared-state-dup",
              cellKey: "d6:langgraph-python/shared-state",
              state: "green",
              signal: { second: true },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      // The untrusted-GREEN cell routes overlay-first — exactly ONCE.
      expect(
        statusFake.overlays.filter(
          (o) => o.key === "d6:langgraph-python/shared-state",
        ),
      ).toHaveLength(1);
      expect(
        cap.warns.filter(
          (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
        ),
      ).toHaveLength(1);
    });

    it("[B4r7] under a commError a trusted-NEGATIVE duplicate REPLACES an untrusted (overlay-first) first occurrence", async () => {
      // First-occurrence-wins dropped a trusted-negative duplicate behind an
      // untrusted-green first occurrence: the key kept its overlay-first
      // route and the legitimate red observation was silently discarded. A
      // duplicate that is trusted-negative now outranks positional order
      // when the kept occurrence routed overlay-first.
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          cells: [
            {
              cellId: "shared-state",
              cellKey: "d6:langgraph-python/shared-state",
              state: "green",
              signal: { first: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
            {
              cellId: "shared-state-dup",
              cellKey: "d6:langgraph-python/shared-state",
              state: "red",
              signal: { second: true },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      // The trusted-negative duplicate writes DURABLY (overlay merged into
      // its signal, like every trusted-negative row) — exactly once.
      const cellWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python/shared-state",
      );
      expect(cellWrites).toHaveLength(1);
      expect(cellWrites[0].result.state).toBe("red");
      expect(
        (cellWrites[0].result.signal as Record<string, unknown>).second,
      ).toBe(true);
      expect(commErrorFromStatusSignal(cellWrites[0].result.signal)).toEqual(
        SAMPLE_COMM_ERROR,
      );
      // No overlay-first route ran for the key (the untrusted green lost).
      expect(
        statusFake.overlays.filter(
          (o) => o.key === "d6:langgraph-python/shared-state",
        ),
      ).toHaveLength(0);
      // The replacement is loud.
      const dupWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
      );
      expect(dupWarns).toHaveLength(1);
      expect(String(dupWarns[0].ctx?.consequence)).toMatch(/trusted-negative/i);
    });

    it("[B4r7] a trusted-negative FIRST occurrence still wins over a trusted-negative duplicate (no replace between durables)", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          cells: [
            {
              cellId: "shared-state",
              cellKey: "d6:langgraph-python/shared-state",
              state: "red",
              signal: { first: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
            {
              cellId: "shared-state-dup",
              cellKey: "d6:langgraph-python/shared-state",
              state: "degraded",
              signal: { second: true },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      const cellWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python/shared-state",
      );
      // The FIRST trusted-negative occurrence wrote; the duplicate skipped.
      expect(cellWrites).toHaveLength(1);
      expect(cellWrites[0].result.state).toBe("red");
      expect(
        (cellWrites[0].result.signal as Record<string, unknown>).first,
      ).toBe(true);
      expect(
        cap.warns.filter(
          (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
        ),
      ).toHaveLength(1);
    });

    it("[G2r8] the trusted-negative replacement is CELL-vs-CELL only — a colliding cell never impersonates the AGGREGATE row", async () => {
      // The B4r7 replacement rationale was written for cell-vs-cell
      // duplicates, but the guard also let a trusted-negative CELL whose key
      // collides with the aggregateKey REPLACE the overlay-first PRIMARY —
      // the cell's payload was then written durably UNDER THE AGGREGATE KEY
      // as if it were the service rollup. The primary keeps positional
      // precedence across the primary/cell boundary.
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error", // untrusted → primary routes overlay-first
          cells: [
            {
              cellId: "colliding-negative",
              cellKey: "d6:langgraph-python", // collides with the aggregate
              state: "red", // trusted-negative
              signal: { cellPayload: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );

      // NO durable write landed under the aggregate key — the cell payload
      // must not impersonate the service rollup row.
      expect(
        statusFake.writes.filter((w) => w.result.key === "d6:langgraph-python"),
      ).toHaveLength(0);
      // The primary kept its overlay-first route (positional precedence).
      expect(
        statusFake.overlays.filter((o) => o.key === "d6:langgraph-python"),
      ).toHaveLength(1);
      // The colliding duplicate was skipped, not replaced.
      const dupWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
      );
      expect(dupWarns).toHaveLength(1);
      expect(String(dupWarns[0].ctx?.consequence)).toMatch(
        /first occurrence wins/i,
      );
    });
  });

  // ── B2 (round 7): blank/whitespace projected keys in aggregate() ─────────
  describe("[B2r7] blank/whitespace projected keys are skipped loudly", () => {
    // aggregateCommError fails loud on a blank key; aggregate() had no
    // equivalent — a malformed worker cell with key "" (or "   ") flowed
    // straight into statusWriter.write, persisting a DURABLE status row +
    // history under a phantom dimension ("unknown"). Skip such keys with a
    // warn instead (per-row skip, matching the loop's duplicate-key
    // posture — one malformed cell must not reject the whole result).
    function capturingLogger(): {
      logger: Logger;
      warns: { msg: string; ctx?: Record<string, unknown> }[];
    } {
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      return {
        warns,
        logger: {
          info() {},
          error() {},
          debug() {},
          warn(msg: string, ctx?: Record<string, unknown>) {
            warns.push({ msg, ctx });
          },
        },
      };
    }

    it("skips an EMPTY-string cell key with a warn — no durable row under a phantom dimension", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "malformed",
              cellKey: "",
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
        }),
      );

      // No write reached the blank key; the well-formed rows all landed.
      expect(statusFake.writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/human-in-the-loop",
      ]);
      const blankWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.blank-projected-key",
      );
      expect(blankWarns).toHaveLength(1);
      expect(blankWarns[0].ctx).toMatchObject({
        jobId: "job-1",
        aggregateKey: "d6:langgraph-python",
      });
    });

    it("skips a WHITESPACE-ONLY cell key (same trim posture) — overlay route included under a commError", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          commError: SAMPLE_COMM_ERROR,
          aggregateState: "error",
          cells: [
            {
              cellId: "malformed",
              cellKey: "   ",
              state: "green",
              signal: { ok: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );

      // Neither a durable write NOR an overlay reached the whitespace key.
      expect(
        statusFake.writes.filter((w) => !w.result.key.trim()),
      ).toHaveLength(0);
      expect(statusFake.overlays.filter((o) => !o.key.trim())).toHaveLength(0);
      expect(
        cap.warns.filter(
          (w) => w.msg === "fleet.aggregator.blank-projected-key",
        ),
      ).toHaveLength(1);
    });

    it("[G2r8] a blank aggregateKey SKIPS runWriter.start — no phantom probe_runs row keyed probeId ''", async () => {
      // The blank-skip guard kept the blank PRIMARY off the status pipeline,
      // but runWriter.start still ran with probeId "" — minting a phantom
      // run-history row under a key no dashboard widget ever reads. Mirror
      // aggregateCommError's blank-aggregateKey posture, but as a loud SKIP
      // rather than a throw (a deterministic throw would infinite-retry
      // through the consumer's unlatch-on-reject path).
      const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        warn() {},
        debug() {},
        error(msg: string, ctx?: Record<string, unknown>) {
          errors.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      const outcome = await agg.aggregate(makeResult({ aggregateKey: "   " }));

      // NO run row was minted (start skipped, so finish has nothing to close).
      expect(runFake.calls.start).toHaveLength(0);
      expect(runFake.calls.finish).toHaveLength(0);
      expect(outcome.runRowId).toBeNull();
      // The skip is loud.
      expect(
        errors.filter(
          (e) => e.msg === "fleet.aggregator.blank-aggregate-key-run-skipped",
        ),
      ).toHaveLength(1);
      // The well-formed cell rows still landed (the skip is run-history-only).
      expect(statusFake.writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python/shared-state",
        "d6:langgraph-python/human-in-the-loop",
      ]);
    });

    it("[G2r8] the blank-key warn attributes a blank PRIMARY to the primary row — it does not blame a worker cell", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(makeResult({ aggregateKey: "" }));

      const blankWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.blank-projected-key",
      );
      expect(blankWarns).toHaveLength(1);
      expect(blankWarns[0].ctx?.row).toBe("primary");
      // The misattribution: the old single-message warn always claimed "a
      // malformed worker cell carried an empty cellKey" even for the primary.
      expect(String(blankWarns[0].ctx?.consequence)).not.toMatch(
        /worker cell/i,
      );
    });

    it("[G2r8] the blank-key warn still attributes a blank CELL to the cell", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "malformed",
              cellKey: "",
              state: "green",
              signal: { ok: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );

      const blankWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.blank-projected-key",
      );
      expect(blankWarns).toHaveLength(1);
      expect(blankWarns[0].ctx?.row).toBe("cell");
    });
  });

  // ── G2 round 9: corrupt colours on the no-commError path are gated ──────
  describe("[G2r9] corrupt non-State colours on the NO-commError path are loudly skipped", () => {
    // Planning computes asKnownState(pr.state) but only consulted it under a
    // commError — without one, a corrupt non-State, non-"error" colour
    // flowed straight into statusWriter.write, 400-ing on PB's required
    // `state` select; aggregate() then REJECTED and the consumer
    // unlatch-retried the same deterministic fault forever (the hot-loop
    // class this file guards everywhere else).
    it("skips the corrupt row (no write), logs at ERROR level, and surfaces it on corruptStateSkippedKeys", async () => {
      const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        warn() {},
        debug() {},
        error(msg: string, ctx?: Record<string, unknown>) {
          errors.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      const outcome = await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "corrupt",
              cellKey: "d6:langgraph-python/corrupt",
              state: "purple" as unknown as ProbeState,
              signal: { ok: false },
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
        }),
      );

      // The corrupt colour never reached the writer; well-formed rows landed.
      expect(statusFake.writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/human-in-the-loop",
      ]);
      // The skip is LOUD …
      expect(
        errors.filter(
          (e) => e.msg === "fleet.aggregator.corrupt-state-skipped",
        ),
      ).toHaveLength(1);
      // … and caller-observable (not a throw: a deterministic corrupt
      // colour would infinite-retry through unlatch-on-reject).
      expect(outcome.corruptStateSkippedKeys).toEqual([
        "d6:langgraph-python/corrupt",
      ]);
    });

    it('a projected "error" state still writes (the no-data route is a legitimate colour), and healthy outcomes carry an empty discriminator', async () => {
      const agg = makeAggregator();
      const outcome = await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "errored",
              cellKey: "d6:langgraph-python/errored",
              state: "error",
              signal: { ok: false },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );
      expect(statusFake.writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/errored",
      ]);
      expect(outcome.corruptStateSkippedKeys).toEqual([]);
    });
  });

  // ── G2 round 8: padded projected keys are trimmed once in aggregate() ────
  describe("[G2r8] padded projected keys are normalized to the TRIMMED canonical form", () => {
    // aggregateCommError trims its keys once (B1r7); aggregate() only trimmed
    // INSIDE the blank check and then routed the UNTRIMMED value — a padded
    // key (" d6:x ") flowed verbatim into statusWriter.write/writeOverlay
    // (persisting a malformed-dimension row the dashboard never reads), the
    // dedupe map keyed on the untrimmed string (so "d6:x" and " d6:x "
    // escaped both the duplicate collapse and the trusted-negative
    // replacement), and a padded collision with result.aggregateKey never
    // triggered the cell-vs-aggregate handling.
    function capturingLogger(): {
      logger: Logger;
      warns: { msg: string; ctx?: Record<string, unknown> }[];
    } {
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      return {
        warns,
        logger: {
          info() {},
          error() {},
          debug() {},
          warn(msg: string, ctx?: Record<string, unknown>) {
            warns.push({ msg, ctx });
          },
        },
      };
    }

    it("writes a padded cell key under its TRIMMED form (no malformed-dimension durable row)", async () => {
      const agg = makeAggregator();

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "padded",
              cellKey: "  d6:langgraph-python/shared-state  ",
              state: "green",
              signal: { ok: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );

      // The durable write landed on the canonical key — never the padded one.
      expect(statusFake.writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/shared-state",
      ]);
    });

    it("dedupes a padded twin against its trimmed form — one write, first occurrence wins", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "shared-state",
              cellKey: "d6:langgraph-python/shared-state",
              state: "green",
              signal: { first: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
            {
              cellId: "shared-state-padded-twin",
              cellKey: " d6:langgraph-python/shared-state ",
              state: "green",
              signal: { second: true },
              observedAt: "2026-06-04T00:00:02.000Z",
            },
          ],
        }),
      );

      const cellWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python/shared-state",
      );
      expect(cellWrites).toHaveLength(1);
      expect(cellWrites[0].result.signal).toEqual({ first: true });
      // No write escaped under the padded twin either.
      expect(
        statusFake.writes.filter((w) => w.result.key !== w.result.key.trim()),
      ).toHaveLength(0);
      const dupWarns = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
      );
      expect(dupWarns).toHaveLength(1);
      // The surfaced log carries the canonical key, not the padded one.
      expect(dupWarns[0].ctx?.key).toBe("d6:langgraph-python/shared-state");
    });

    it("a padded cell COLLIDING with the aggregateKey collapses into the primary (cell-vs-aggregate handling triggers)", async () => {
      const cap = capturingLogger();
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(
        makeResult({
          cells: [
            {
              cellId: "colliding-padded",
              cellKey: " d6:langgraph-python ", // trims into the aggregate key
              state: "green",
              signal: { cell: true },
              observedAt: "2026-06-04T00:00:01.000Z",
            },
          ],
        }),
      );

      const primaryWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python",
      );
      // ONE write for the aggregate key — the primary's payload, not the cell's.
      expect(primaryWrites).toHaveLength(1);
      expect(primaryWrites[0].result.signal).toEqual({ failedCount: 1 });
      // The padded twin never wrote a second, malformed-dimension row.
      expect(statusFake.writes).toHaveLength(1);
      expect(
        cap.warns.filter(
          (w) => w.msg === "fleet.aggregator.duplicate-projected-key",
        ),
      ).toHaveLength(1);
    });

    it("a padded PRIMARY under a commError overlays the TRIMMED key and stamps run-history with the trimmed probeId", async () => {
      const agg = makeAggregator();

      await agg.aggregate(
        makeResult({
          aggregateKey: "  d6:langgraph-python  ",
          aggregateState: "error",
          commError: SAMPLE_COMM_ERROR,
          cells: [],
        }),
      );

      // The overlay-first route used the canonical key the dashboard reads.
      expect(statusFake.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
      ]);
      // run-history is keyed by the trimmed probeId, not the padded form.
      expect(runFake.calls.start).toHaveLength(1);
      expect(runFake.calls.start[0].probeId).toBe("d6:langgraph-python");
    });
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

    it("attempts the H1 overlay onto the aggregate (d6:<slug>) status row the dashboard reads", async () => {
      // Per-key routing (F1d): writeOverlay is attempted FIRST for every key —
      // it is the per-key source of truth (applied:false for a missing row).
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });

      // Exactly one overlay attempt, onto the d6:<slug> aggregate key (the
      // naive fake applies every overlay, so no fallback write runs).
      expect(statusFake.overlays).toHaveLength(1);
      const overlaid = statusFake.overlays[0];
      expect(overlaid.key).toBe("d6:langgraph-python");
      expect(statusFake.writes).toHaveLength(0);
      // The comm error rides in the signal under the well-known key so the
      // dashboard re-surfaces "unreachable" — this is the bug fix: previously
      // the sweep/fleet-health comm errors were DROPPED and this overlay was
      // NEVER written (the red state).
      expect(commErrorFromStatusSignal(overlaid.signal)).toEqual(SWEEP_ERR);
      expect(
        Object.prototype.hasOwnProperty.call(
          overlaid.signal,
          FLEET_COMM_ERROR_SIGNAL_KEY,
        ),
      ).toBe(true);
      // observed_at comes from the comm error.
      expect(overlaid.observedAt).toBe("2026-06-04T00:00:09.000Z");
    });

    it("writes the no-data ('error') state for a never-observed key — NEVER fabricates green", async () => {
      // REQ-B/F2.1: a never-observed key (writeOverlay → applied:false) must
      // NOT invent a status row for a service that has never been probed. The
      // no-data representation is "error" (status-writer routes it to
      // status_history only), so the dashboard shows no fabricated colour.
      const errorFake = makeErrorRoutingFakeStatusWriter();
      const agg = createResultAggregator({
        statusWriter: errorFake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });
      const written = errorFake.writes[0].result;
      expect(written.state).toBe("error");
      expect(written.state).not.toBe("green");
      expect(errorFake.statusRows.get("d6:langgraph-python")).toBeUndefined();
    });

    it("routes an OBSERVED key through the H1 overlay path (preserves the row, does NOT re-write its state)", async () => {
      // The CRITICAL false-green bug: a red service whose worker crashes must
      // stay red + unreachable overlay, not flip to green. With H1 the
      // preservation is the writer's job: an observed key (lastKnownState
      // present) takes writeOverlay — no same-state write() that would restamp
      // written_by or bump fail_count.
      const agg = makeAggregator();
      const out = await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        lastKnownState: "red",
      });
      // No normal write — the overlay path carried the comm error.
      expect(statusFake.writes).toHaveLength(0);
      expect(statusFake.overlays).toHaveLength(1);
      const overlaid = statusFake.overlays[0];
      expect(overlaid.key).toBe("d6:langgraph-python");
      expect(commErrorFromStatusSignal(overlaid.signal)).toEqual(SWEEP_ERR);
      expect(overlaid.observedAt).toBe("2026-06-04T00:00:09.000Z");
      expect(out.overlayOutcomes).toHaveLength(1);
      expect(out.overlayOutcomes[0].applied).toBe(true);
    });

    it("falls back to the no-data ('error') write when the observed row vanished mid-flight (overlay not applied)", async () => {
      // TOCTOU guard: the caller resolved a prior colour, but the row is gone
      // by the time writeOverlay runs — the overlay must still be recorded via
      // the history-only error path, never silently dropped.
      const errorFake = makeErrorRoutingFakeStatusWriter();
      const agg = createResultAggregator({
        statusWriter: errorFake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        lastKnownState: "red",
      });
      // Overlay attempted (observed route), did not apply (no row) …
      expect(errorFake.overlays).toHaveLength(1);
      // … so the comm error fell back to the no-data ("error") write.
      expect(errorFake.writes).toHaveLength(1);
      expect(errorFake.writes[0].result.state).toBe("error");
      expect(
        commErrorFromStatusSignal(errorFake.writes[0].result.signal),
      ).toEqual(SWEEP_ERR);
    });

    it("also overlays the per-cell row when a cellKey is supplied", async () => {
      const agg = makeAggregator();
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python/shared-state",
      });
      const keys = statusFake.overlays.map((o) => o.key);
      expect(keys).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/shared-state",
      ]);
      for (const o of statusFake.overlays) {
        expect(commErrorFromStatusSignal(o.signal)).toEqual(SWEEP_ERR);
      }
    });

    it("[B3] rejects an EMPTY-string aggregateKey loudly (no malformed-key overlay/history row)", async () => {
      // aggregateKey gets the same truthiness posture cellKey has: "" is
      // never a real status-row key, and admitting it would attempt an
      // overlay on key "" (a guaranteed miss) and then record a
      // malformed-key "error" history row under "" via the fallback. Fail
      // loud (keyFor-style) so the caller's bad resolution surfaces at the
      // call site instead of as a phantom history row.
      const agg = makeAggregator();
      await expect(
        agg.aggregateCommError({
          commError: SWEEP_ERR,
          aggregateKey: "",
        }),
      ).rejects.toThrow(/aggregateKey/);
      // Nothing was written for the malformed key.
      expect(statusFake.overlays).toHaveLength(0);
      expect(statusFake.writes).toHaveLength(0);
    });

    it("[B3r6] rejects a WHITESPACE-ONLY aggregateKey loudly (trim-based guard, same posture as writtenBy)", async () => {
      // "   " defeats the `!aggregateKey` truthiness guard but is no more a
      // real status-row key than "" — admitting it overlays a whitespace key
      // (guaranteed miss) and records a malformed-key history row under it.
      const agg = makeAggregator();
      await expect(
        agg.aggregateCommError({
          commError: SWEEP_ERR,
          aggregateKey: "   ",
        }),
      ).rejects.toThrow(/aggregateKey/);
      expect(statusFake.overlays).toHaveLength(0);
      expect(statusFake.writes).toHaveLength(0);
    });

    it("[B1r7] NORMALIZES padded keys — routing, overlays and the surfaced log all use the TRIMMED keys", async () => {
      // The round-6 guard trimmed only INSIDE the blank check, then routed the
      // UNTRIMMED key — so a padded " d6:x " overlaid/wrote a malformed key
      // (dimension " d6") and the surfaced log carried the padded values.
      const debugs: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        warn() {},
        error() {},
        debug(msg: string, ctx?: Record<string, unknown>) {
          debugs.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "  d6:langgraph-python  ",
        cellKey: " d6:langgraph-python/shared-state ",
      });

      // Both overlays route to the CANONICAL rows.
      expect(statusFake.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/shared-state",
      ]);
      // The surfaced log carries the canonical keys (incl. the routes map).
      const surfaced = debugs.filter(
        (d) => d.msg === "fleet.aggregator.commerror-surfaced",
      );
      expect(surfaced).toHaveLength(1);
      expect(surfaced[0].ctx).toMatchObject({
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python/shared-state",
      });
      expect(
        Object.keys(surfaced[0].ctx?.routes as Record<string, unknown>),
      ).toEqual(["d6:langgraph-python", "d6:langgraph-python/shared-state"]);
    });

    it("[B1r7] a padded cellKey that TRIMS into the aggregateKey collapses (one key routed, cellCollapsed logged)", async () => {
      // The cellKey !== aggregateKey collapse must compare the TRIMMED values:
      // a padded duplicate (" d6:x " vs "d6:x") previously routed TWO keys —
      // one of them malformed.
      const debugs: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        warn() {},
        error() {},
        debug(msg: string, ctx?: Record<string, unknown>) {
          debugs.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "  d6:langgraph-python  ",
      });

      expect(statusFake.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
      ]);
      const surfaced = debugs.filter(
        (d) => d.msg === "fleet.aggregator.commerror-surfaced",
      );
      expect(surfaced).toHaveLength(1);
      expect(surfaced[0].ctx).not.toHaveProperty("cellKey");
      expect(surfaced[0].ctx).toMatchObject({ cellCollapsed: true });
    });

    it("[B1r7] the no-data fallback writes the CANONICAL (trimmed) key — no malformed-dimension history row", async () => {
      // A padded never-observed key must fall back to an error-write under the
      // trimmed key; the untrimmed " d6:x " wrote a history row whose derived
      // dimension is " d6".
      const errorFake = makeErrorRoutingFakeStatusWriter();
      const agg = createResultAggregator({
        statusWriter: errorFake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });

      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: " d6:langgraph-python ",
      });

      expect(errorFake.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
      ]);
      expect(errorFake.writes).toHaveLength(1);
      expect(errorFake.writes[0].result.key).toBe("d6:langgraph-python");
    });

    it("[B3r6] treats a WHITESPACE-ONLY cellKey as absent (same trim posture)", async () => {
      const agg = makeAggregator();
      const out = await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "  \t",
      });
      expect(statusFake.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
      ]);
      expect(statusFake.writes).toHaveLength(0);
      expect(out.overlayOutcomes).toHaveLength(1);
    });

    it("[B4] treats an EMPTY-string cellKey as absent (never overlays/writes key '')", async () => {
      // "" is never a real status-row key: admitting it overlayed key ""
      // (guaranteed miss) and then recorded an "error" history row under ""
      // via the fallback. An empty-string cellKey must behave exactly like an
      // omitted one.
      const agg = makeAggregator();
      const out = await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "",
      });
      expect(statusFake.overlays.map((o) => o.key)).toEqual([
        "d6:langgraph-python",
      ]);
      expect(statusFake.writes).toHaveLength(0);
      expect(out.overlayOutcomes).toHaveLength(1);
    });

    it("[F1d] routes PER KEY — an observed cell row keeps its overlay even under a never-observed aggregate", async () => {
      // The F1d bug: the route was decided ONCE from the AGGREGATE key's
      // observedness (the caller's lastKnownState) and applied to BOTH keys —
      // so an observed cell row under a never-observed aggregate lost its
      // overlay (it was routed history-only even though its status row
      // exists). Per-key routing must land the overlay on the cell row and
      // fall back history-only for the aggregate.
      const errorFake = makeErrorRoutingFakeStatusWriter();
      errorFake.statusRows.set("d6:langgraph-python/shared-state", {
        state: "red",
        signal: { prior: true },
      });
      const agg = createResultAggregator({
        statusWriter: errorFake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });

      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python/shared-state",
        // No lastKnownState — the AGGREGATE was never observed.
      });

      // The observed CELL row gets the overlay (state preserved) …
      const cell = errorFake.statusRows.get("d6:langgraph-python/shared-state");
      expect(cell).toBeDefined();
      expect(cell!.state).toBe("red");
      expect(commErrorFromStatusSignal(cell!.signal)).toEqual(SWEEP_ERR);
      // … while the never-observed AGGREGATE falls back history-only.
      expect(errorFake.statusRows.get("d6:langgraph-python")).toBeUndefined();
      const aggWrites = errorFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python",
      );
      expect(aggWrites).toHaveLength(1);
      expect(aggWrites[0].result.state).toBe("error");
      expect(commErrorFromStatusSignal(aggWrites[0].result.signal)).toEqual(
        SWEEP_ERR,
      );
    });

    it("[B4] marks a cellKey that COLLAPSES into the aggregateKey in the surfaced debug log (no orphan cellKey field)", async () => {
      // When cellKey === aggregateKey only ONE key is routed, so the per-key
      // `routes` map has no separate cell entry — printing `cellKey`
      // alongside it implied a cell route that never ran. The collapsed case
      // logs `cellCollapsed: true` instead of the cellKey field.
      const debugs: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        warn() {},
        error() {},
        debug(msg: string, ctx?: Record<string, unknown>) {
          debugs.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python",
      });

      const surfaced = debugs.filter(
        (d) => d.msg === "fleet.aggregator.commerror-surfaced",
      );
      expect(surfaced).toHaveLength(1);
      expect(surfaced[0].ctx).not.toHaveProperty("cellKey");
      expect(surfaced[0].ctx).toMatchObject({
        aggregateKey: "d6:langgraph-python",
        cellCollapsed: true,
      });
      // A DISTINCT cellKey still logs as cellKey (its route entry exists).
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        cellKey: "d6:langgraph-python/shared-state",
      });
      const second = debugs.filter(
        (d) => d.msg === "fleet.aggregator.commerror-surfaced",
      )[1];
      expect(second.ctx).toMatchObject({
        cellKey: "d6:langgraph-python/shared-state",
      });
      expect(second.ctx).not.toHaveProperty("cellCollapsed");
    });

    it("returns the per-write outcomes", async () => {
      const agg = makeAggregator();
      const out = await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
      });
      // Per-key routing: the overlay attempt applied (naive fake), so there is
      // one overlay outcome and no fallback write outcome.
      expect(out.overlayOutcomes).toHaveLength(1);
      expect(out.statusOutcomes).toHaveLength(0);
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

    it("ignores lastKnownState for routing — per-key writeOverlay applied is the source of truth", async () => {
      // F1d: lastKnownState (even a malformed/legacy value forced past the
      // type) is never consulted for routing and never re-persisted as a
      // colour. The writeOverlay attempt decides per key: no row →
      // applied:false → the history-only no-data ('error') fallback.
      const errorFake = makeErrorRoutingFakeStatusWriter();
      const agg = createResultAggregator({
        statusWriter: errorFake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });
      await agg.aggregateCommError({
        commError: SWEEP_ERR,
        aggregateKey: "d6:langgraph-python",
        // Force a bogus value past the type via the public input contract.
        lastKnownState: "bogus" as unknown as "green",
      });
      // The overlay was attempted regardless of the bogus hint …
      expect(errorFake.overlays).toHaveLength(1);
      // … and the missing row fell back to the no-data ('error') write.
      const written = errorFake.writes[0].result;
      expect(written.state).toBe("error");
    });
  });

  // ── B5: PB-outage observability on the run-history/dedup legs ────────────
  describe("[B5] structured error logging on the PB-outage legs (status + stack survive)", () => {
    // The three swallowed-error legs (dedup lookup, run start, run finish)
    // logged message-only (`err.message`), erasing the HTTP status a
    // PbHttpError carries — so a 429/5xx outage was indistinguishable from a
    // schema error in the logs. They must serialize through the
    // status-writer's errorInfo/serializeErr like every other PB-failure
    // emitter, so status codes (and PB validation payloads) survive.
    class PbDownError extends Error {
      statusCode = 503;
    }

    function makeCapturing(): {
      logger: Logger;
      warns: { msg: string; ctx?: Record<string, unknown> }[];
      errors: { msg: string; ctx?: Record<string, unknown> }[];
    } {
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
      return {
        warns,
        errors,
        logger: {
          info() {},
          debug() {},
          warn(msg: string, ctx?: Record<string, unknown>) {
            warns.push({ msg, ctx });
          },
          error(msg: string, ctx?: Record<string, unknown>) {
            errors.push({ msg, ctx });
          },
        },
      };
    }

    it("dedup-lookup-failed carries the serialized status code", async () => {
      const cap = makeCapturing();
      runFake.writer.findByJobId = async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(makeResult());

      const leg = cap.warns.filter(
        (w) => w.msg === "fleet.aggregator.dedup-lookup-failed",
      );
      expect(leg).toHaveLength(1);
      expect(String(leg[0].ctx?.err)).toContain("ECONNREFUSED");
      expect(String(leg[0].ctx?.err)).toContain("503");
      expect(leg[0].ctx?.status).toBe(503);
    });

    it("run-start-failed carries the serialized status code", async () => {
      const cap = makeCapturing();
      runFake.writer.start = async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(makeResult());

      const leg = cap.errors.filter(
        (e) => e.msg === "fleet.aggregator.run-start-failed",
      );
      expect(leg).toHaveLength(1);
      expect(String(leg[0].ctx?.err)).toContain("ECONNREFUSED");
      expect(String(leg[0].ctx?.err)).toContain("503");
      expect(leg[0].ctx?.status).toBe(503);
    });

    it("run-finish-failed carries the serialized status code", async () => {
      const cap = makeCapturing();
      runFake.writer.finish = async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger: cap.logger,
        now: () => now,
      });

      await agg.aggregate(makeResult());

      const leg = cap.errors.filter(
        (e) => e.msg === "fleet.aggregator.run-finish-failed",
      );
      expect(leg).toHaveLength(1);
      expect(String(leg[0].ctx?.err)).toContain("ECONNREFUSED");
      expect(String(leg[0].ctx?.err)).toContain("503");
      expect(leg[0].ctx?.status).toBe(503);
    });
  });

  // ── B6: contract pins — documented ERROR CONTRACTs + loud-throw guards ───
  describe("[B6] documented error contracts", () => {
    it("aggregate() per-row try/catch: a thrown status write is logged and the batch CONTINUES — finish still runs", async () => {
      const writes: RecordedWrite[] = [];
      let writeCalls = 0;
      const throwingWriter: StatusWriter = {
        async write(result) {
          writeCalls++;
          if (writeCalls === 2) throw new Error("PB write blip");
          writes.push({ result });
          return {
            previousState: null,
            newState: result.state,
            transition: "first",
            firstFailureAt: null,
            failCount: 0,
            persisted: true,
          };
        },
        async writeOverlay() {
          return { applied: true, state: "red", historyPersisted: true };
        },
      };
      const agg = createResultAggregator({
        statusWriter: throwingWriter,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });

      // Default fixture projects 3 rows (primary + 2 cells); the SECOND
      // write throws — per-row try/catch swallows it and the third still runs.
      // The run-history finish still lands (no `running` row left for the
      // boot-time stale-run sweep).
      await agg.aggregate(makeResult());
      expect(writeCalls).toBe(3);
      expect(writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python",
        "d6:langgraph-python/human-in-the-loop",
      ]);
      expect(runFake.calls.start).toHaveLength(1);
      expect(runFake.calls.finish).toHaveLength(1);
    });

    it("aggregateCommError ERROR CONTRACT: an aggregate-key fallback write that throws rejects — the cell key is not attempted", async () => {
      const overlays: RecordedOverlay[] = [];
      let writeCalls = 0;
      const throwingWriter: StatusWriter = {
        async write() {
          writeCalls++;
          throw new Error("PB write blip");
        },
        async writeOverlay(overlay) {
          overlays.push(overlay);
          // Miss every key so the fallback write runs (and throws) — the
          // real never-observed shape (historyPersisted stamped, B6 r7).
          return { applied: false, state: null, historyPersisted: false };
        },
      };
      const agg = createResultAggregator({
        statusWriter: throwingWriter,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });

      await expect(
        agg.aggregateCommError({
          commError: SAMPLE_COMM_ERROR,
          aggregateKey: "d6:langgraph-python",
          cellKey: "d6:langgraph-python/shared-state",
        }),
      ).rejects.toThrow("PB write blip");
      // Only the AGGREGATE key was routed — the cell key's overlay (and
      // fallback) were never attempted after the rejection.
      expect(overlays.map((o) => o.key)).toEqual(["d6:langgraph-python"]);
      expect(writeCalls).toBe(1);
    });

    it("findByJobId-throw branch: warns and SKIPS run-row mint (status writes still run, no run-history row)", async () => {
      runFake.writer.findByJobId = async () => {
        throw new Error("lookup blip");
      };
      const agg = makeAggregator();

      const outcome = await agg.aggregate(makeResult());

      // The lookup throw is UNCERTAIN: aggregation proceeds with the status
      // writes (idempotent via the writer state machine) but does NOT mint a
      // fresh run-history row — minting could duplicate a row that already
      // exists (which the failed lookup couldn't see). A subsequent successful
      // tick reconciles the run-history row.
      expect(outcome.skipped).toBe(false);
      expect(statusFake.writes).toHaveLength(3);
      expect(runFake.calls.start).toHaveLength(0);
      expect(runFake.calls.finish).toHaveLength(0);
      expect(outcome.runRowId).toBeNull();
    });

    it("runWriter.start-throw branch: runRowId null, finish skipped, aggregation continues", async () => {
      runFake.writer.start = async () => {
        throw new Error("start blip");
      };
      const agg = makeAggregator();

      const outcome = await agg.aggregate(makeResult());

      // No run row exists, so finish is skipped — but the status writes (the
      // dashboard contract) all still land.
      expect(outcome.runRowId).toBeNull();
      expect(outcome.skipped).toBe(false);
      expect(statusFake.writes).toHaveLength(3);
      expect(runFake.calls.finish).toHaveLength(0);
    });

    it("[F1d/G2r8] primary-identity drift is a DISCRIMINATOR, not a throw — no consumer hot-loop, drift surfaced via droppedCommError", async () => {
      // Drive the module-level projection mock: a primary whose key does NOT
      // match result.aggregateKey models projection drift — the comm-error
      // primary route must refuse to overlay/rewrite the wrong row. The old
      // posture THREW: a deterministic projection defect infinite-retried
      // through the consumer's unlatch-on-reject path, and because the throw
      // landed BEFORE runWriter.start each retry restarted from scratch — a
      // permanent hot-loop (contradicting the file's own empty-projection
      // discriminator rationale). The drift now logs loud, skips the
      // drifted primary row, and surfaces via droppedCommError.
      vi.mocked(probeResultsForServiceJobResult).mockReturnValueOnce([
        {
          key: "d6:WRONG-KEY",
          state: "error",
          signal: {},
          observedAt: "2026-06-04T00:00:03.000Z",
        },
        {
          key: "d6:langgraph-python/human-in-the-loop",
          state: "red",
          signal: { ok: false },
          observedAt: "2026-06-04T00:00:02.000Z",
        },
      ]);
      const errors: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        warn() {},
        debug() {},
        error(msg: string, ctx?: Record<string, unknown>) {
          errors.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      // RESOLVES — no reject, so the consumer latches instead of hot-looping.
      const outcome = await agg.aggregate(
        makeResult({ commError: SAMPLE_COMM_ERROR }),
      );

      // The drifted primary row was refused: neither written nor overlaid.
      expect(
        statusFake.writes.filter((w) => w.result.key === "d6:WRONG-KEY"),
      ).toHaveLength(0);
      expect(
        statusFake.overlays.filter((o) => o.key === "d6:WRONG-KEY"),
      ).toHaveLength(0);
      // The drift is loud …
      expect(
        errors.filter(
          (e) => e.msg === "fleet.aggregator.commerror-primary-identity-drift",
        ),
      ).toHaveLength(1);
      // … and caller-observable: the comm error never reached the primary
      // row the dashboard reads.
      expect(outcome.droppedCommError).toBe(true);
      // The run row still opens and closes terminal, so a latch-fail replay
      // dedupes instead of re-aggregating from scratch.
      expect(runFake.calls.start).toHaveLength(1);
      expect(runFake.calls.finish).toHaveLength(1);
      expect(outcome.runRowId).toBe("run-row-1");
      // The independent trusted-negative CELL still wrote durably (with the
      // overlay merged) — one refused row must not reject the whole result.
      const cellWrites = statusFake.writes.filter(
        (w) => w.result.key === "d6:langgraph-python/human-in-the-loop",
      );
      expect(cellWrites).toHaveLength(1);
      expect(commErrorFromStatusSignal(cellWrites[0].result.signal)).toEqual(
        SAMPLE_COMM_ERROR,
      );
    });

    it("[G2r9] a drift-skipped PRIMARY does not disarm aggregate-key collision protection", async () => {
      // When the drifted primary is refused, it never enters plannedIndex —
      // so a malformed cell whose canonical key equals result.aggregateKey
      // (or the projected-primary key) becomes the FIRST occurrence and, if
      // trusted-negative, writes its CELL payload durably UNDER THE
      // AGGREGATE KEY as if it were the service rollup — the exact
      // impersonation the G2r8 cell-vs-cell dedupe restriction forbids.
      vi.mocked(probeResultsForServiceJobResult).mockReturnValueOnce([
        {
          key: "d6:WRONG-KEY", // drifts from aggregateKey → primary refused
          state: "error",
          signal: {},
          observedAt: "2026-06-04T00:00:03.000Z",
        },
        {
          // Collides with result.aggregateKey — would impersonate the
          // aggregate row (trusted-negative, so it would write DURABLY).
          key: "d6:langgraph-python",
          state: "red",
          signal: { sneaky: true },
          observedAt: "2026-06-04T00:00:01.000Z",
        },
        {
          // Collides (padded) with the projected-primary key the drifted
          // primary would have written — same unknown-identity refusal.
          key: " d6:WRONG-KEY ",
          state: "red",
          signal: { sneaky: true },
          observedAt: "2026-06-04T00:00:01.500Z",
        },
        {
          key: "d6:langgraph-python/human-in-the-loop",
          state: "red",
          signal: { ok: false },
          observedAt: "2026-06-04T00:00:02.000Z",
        },
      ]);
      const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
      const logger: Logger = {
        info() {},
        error() {},
        debug() {},
        warn(msg: string, ctx?: Record<string, unknown>) {
          warns.push({ msg, ctx });
        },
      };
      const agg = createResultAggregator({
        statusWriter: statusFake.writer,
        runWriter: runFake.writer,
        logger,
        now: () => now,
      });

      const outcome = await agg.aggregate(
        makeResult({ commError: SAMPLE_COMM_ERROR }),
      );

      // Neither colliding cell reached the aggregate/primary identity —
      // only the independent well-formed cell wrote (durably, red).
      expect(statusFake.writes.map((w) => w.result.key)).toEqual([
        "d6:langgraph-python/human-in-the-loop",
      ]);
      expect(statusFake.overlays).toHaveLength(0);
      // Both collisions are loud.
      expect(
        warns.filter(
          (w) => w.msg === "fleet.aggregator.drifted-primary-collision-skipped",
        ),
      ).toHaveLength(2);
      // The drift itself is still surfaced.
      expect(outcome.droppedCommError).toBe(true);
    });
  });

  // ── §4.2: reds counters persisted into probe_runs.summary ────────────────
  describe("reds counters (redsIntroduced/redsCleared into probe_runs.summary)", () => {
    function makeAggregatorWith(
      outcomesByKey: Record<
        string,
        Pick<WriteOutcome, "previousState" | "newState">
      >,
    ) {
      const fake = makeCannedTransitionStatusWriter(outcomesByKey);
      const agg = createResultAggregator({
        statusWriter: fake.writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });
      return agg;
    }

    it("aggregate counts green→red WriteOutcome transitions into summary.redsIntroduced", async () => {
      const agg = makeAggregatorWith({
        "d6:langgraph-python": { previousState: "green", newState: "red" },
        "d6:langgraph-python/shared-state": {
          previousState: "green",
          newState: "red",
        },
        "d6:langgraph-python/human-in-the-loop": {
          previousState: "green",
          newState: "green",
        },
      });
      await agg.aggregate(makeResult());

      expect(runFake.calls.finish).toHaveLength(1);
      expect(runFake.calls.finish[0].summary?.redsIntroduced).toBe(2);
      expect(runFake.calls.finish[0].summary?.redsCleared).toBe(0);
    });

    it("aggregate counts red→green transitions into summary.redsCleared", async () => {
      const agg = makeAggregatorWith({
        "d6:langgraph-python": { previousState: "red", newState: "green" },
        "d6:langgraph-python/shared-state": {
          previousState: "red",
          newState: "green",
        },
        "d6:langgraph-python/human-in-the-loop": {
          previousState: "red",
          newState: "red",
        },
      });
      await agg.aggregate(makeResult());

      expect(runFake.calls.finish).toHaveLength(1);
      expect(runFake.calls.finish[0].summary?.redsCleared).toBe(2);
      expect(runFake.calls.finish[0].summary?.redsIntroduced).toBe(0);
    });

    it('error-tick outcomes (newState === "error") are excluded from both counters', async () => {
      // §4.2: an error tick is a measurement failure — the prior durable
      // colour rides on errorStatePrev, and the tick neither introduced nor
      // cleared a red. A green→error cell must NOT count as introduced, a
      // red→error cell must NOT count as cleared; the one real green→red
      // transition still counts.
      const agg = makeAggregatorWith({
        "d6:langgraph-python": { previousState: "green", newState: "red" },
        "d6:langgraph-python/shared-state": {
          previousState: "green",
          newState: "error",
        },
        "d6:langgraph-python/human-in-the-loop": {
          previousState: "red",
          newState: "error",
        },
      });
      await agg.aggregate(makeResult());

      expect(runFake.calls.finish).toHaveLength(1);
      expect(runFake.calls.finish[0].summary?.redsIntroduced).toBe(1);
      expect(runFake.calls.finish[0].summary?.redsCleared).toBe(0);
    });

    it("a writer that resolves without an outcome contributes nothing (no crash)", async () => {
      // orchestrator.test.ts doMock's the status-writer with a write() that
      // returns undefined; the counter pass must tolerate a missing outcome
      // (contributes to neither counter) instead of dereferencing it.
      const writer: StatusWriter = {
        write: (async () => undefined) as unknown as StatusWriter["write"],
        writeOverlay: (async () => ({
          applied: false,
          state: null,
        })) as unknown as StatusWriter["writeOverlay"],
      };
      const agg = createResultAggregator({
        statusWriter: writer,
        runWriter: runFake.writer,
        logger: makeLogger(),
        now: () => now,
      });
      await agg.aggregate(makeResult());

      expect(runFake.calls.finish).toHaveLength(1);
      expect(runFake.calls.finish[0].summary?.redsIntroduced).toBe(0);
      expect(runFake.calls.finish[0].summary?.redsCleared).toBe(0);
    });

    it("the finished probe_runs row's summary carries both counters", async () => {
      const agg = makeAggregatorWith({
        "d6:langgraph-python": { previousState: "green", newState: "red" },
        "d6:langgraph-python/shared-state": {
          previousState: "red",
          newState: "green",
        },
        "d6:langgraph-python/human-in-the-loop": {
          previousState: null,
          newState: "green",
        },
      });
      await agg.aggregate(makeResult());

      expect(runFake.calls.finish).toHaveLength(1);
      // The full finished summary: rollup fields AND both counters,
      // explicitly present (0-valued counters serialize as 0, not absent —
      // only pre-P2 rows lack the fields).
      expect(runFake.calls.finish[0].summary).toEqual({
        total: 2,
        passed: 1,
        failed: 1,
        redsIntroduced: 1,
        redsCleared: 1,
      });
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

/**
 * H1: a comm-error overlay write must NOT corrupt the row's durable
 * attribution/counters. The carry-forward legs (aggregateCommError + the
 * aggregate() worker-self-report leg) re-surface a row's PRIOR state purely to
 * attach the comm-error overlay — a SAME-STATE write that, when routed through
 * the normal `statusWriter.write()` path, (1) restamps `written_by` with the
 * fleet-cp identity on a state fleet-cp never produced (attribution transfer →
 * fabricated cross-writer-flip warns during legacy/fleet coexistence),
 * (2) increments `fail_count` via the sustained_red classification (early
 * alert escalation), and (3) emits a spurious `status.changed`. These tests
 * drive the REAL status-writer over a fake PB so the durable row is asserted.
 */
describe("[H1] comm-error overlay preserves attribution + counters (real status-writer)", () => {
  function makeOverlayFakePb(): {
    pb: PbClient;
    rows: Map<string, StatusRecord>;
    history: unknown[];
  } {
    const rows = new Map<string, StatusRecord>();
    const history: unknown[] = [];
    const pb: PbClient = {
      async getOne() {
        return null;
      },
      async getFirst<T>(collection: string, filter: string): Promise<T | null> {
        if (collection !== "status") return null;
        // STRICT filter parse: the status-writer only ever issues
        // `key = "<value>"` (see its pb.getFirst call sites). A greedy
        // unanchored regex here would silently degrade a COMPOUND filter
        // (e.g. `key = "x" && state = "red"`) to a garbage key → "row not
        // found" → tests pass for the wrong reason. Throw on any filter
        // shape this fake does not actually model.
        const match = filter.match(/^key = "([^"]*)"$/);
        if (!match) {
          throw new Error(
            `makeOverlayFakePb.getFirst: unrecognized filter shape: ${filter}`,
          );
        }
        return (rows.get(match[1]!) as unknown as T) ?? null;
      },
      async list() {
        return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
      },
      async create<T>(
        collection: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        if (collection === "status") {
          const r = record as unknown as StatusRecord;
          const id = `r-${rows.size + 1}`;
          rows.set(r.key, { ...r, id });
          return rows.get(r.key) as unknown as T;
        }
        history.push(record);
        return record as unknown as T;
      },
      async update<T>(
        collection: string,
        id: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        if (collection === "status") {
          const existing = [...rows.values()].find((r) => r.id === id);
          if (existing) {
            const merged = {
              ...existing,
              ...(record as Partial<StatusRecord>),
            };
            rows.set(merged.key, merged);
            return merged as unknown as T;
          }
        }
        return record as unknown as T;
      },
      async upsertByField<T>(
        collection: string,
        field: string,
        value: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        const existing = await pb.getFirst<StatusRecord>(
          collection,
          `${field} = ${JSON.stringify(value)}`,
        );
        if (existing?.id) {
          return pb.update<T>(collection, existing.id, record);
        }
        return pb.create<T>(collection, { ...record, [field]: value });
      },
      async delete() {},
      async deleteByFilter() {
        return 0;
      },
      async health() {
        return true;
      },
      async createBackup() {},
      async downloadBackup() {
        return new Uint8Array();
      },
      async deleteBackup() {},
    };
    return { pb, rows, history };
  }

  /** A red row durably attributed to the LEGACY writer (fail_count=3). */
  function seedLegacyRedRow(rows: Map<string, StatusRecord>, key: string) {
    rows.set(key, {
      id: "r-legacy-1",
      key,
      dimension: "d6",
      state: "red",
      signal: { prior: true },
      observed_at: "2026-06-04T00:00:00.000Z",
      transitioned_at: "2026-06-03T23:00:00.000Z",
      fail_count: 3,
      first_failure_at: "2026-06-03T23:00:00.000Z",
      written_by: "legacy",
    });
  }

  function makeCapturingLogger(): {
    logger: Logger;
    warns: { msg: string; ctx?: Record<string, unknown> }[];
  } {
    const warns: { msg: string; ctx?: Record<string, unknown> }[] = [];
    return {
      warns,
      logger: {
        info() {},
        warn(msg: string, ctx?: Record<string, unknown>) {
          warns.push({ msg, ctx });
        },
        error() {},
        debug() {},
      },
    };
  }

  it("aggregateCommError on an observed row preserves written_by/fail_count/first_failure_at and emits no status.changed", async () => {
    const { pb, rows, history } = makeOverlayFakePb();
    seedLegacyRedRow(rows, "d6:langgraph-python");
    const bus = createEventBus();
    const statusChanged: unknown[] = [];
    bus.on("status.changed", (e) => statusChanged.push(e));
    const cap = makeCapturingLogger();
    const statusWriter = createStatusWriter({
      pb,
      bus,
      logger: cap.logger,
      writtenBy: "fleet-cp",
    });
    const agg = createResultAggregator({
      statusWriter,
      runWriter: makeFakeRunWriter().writer,
      logger: cap.logger,
      now: () => 1_000,
    });

    await agg.aggregateCommError({
      commError: SAMPLE_COMM_ERROR,
      aggregateKey: "d6:langgraph-python",
      lastKnownState: "red",
    });

    const row = rows.get("d6:langgraph-python")!;
    // Attribution stays with the writer that PRODUCED the durable state —
    // fleet-cp merely attached an overlay, it never observed red itself.
    expect(row.written_by).toBe("legacy");
    // No sustained_red classification: the overlay is not an observation,
    // so the flap counter must not escalate.
    expect(row.fail_count).toBe(3);
    expect(row.first_failure_at).toBe("2026-06-03T23:00:00.000Z");
    // The colour is preserved and the overlay landed on the live row.
    expect(row.state).toBe("red");
    expect(commErrorFromStatusSignal(row.signal)).toEqual(SAMPLE_COMM_ERROR);
    // Prior signal fields survive the overlay merge.
    expect((row.signal as Record<string, unknown>).prior).toBe(true);
    // No transition was classified → no status.changed emit.
    expect(statusChanged).toHaveLength(0);
    // The overlay is still auditable in status_history.
    expect(history.length).toBeGreaterThan(0);

    // And the wrong-baseline follow-up: the LEGACY writer's next GENUINE flip
    // (red→green) must NOT warn cross-writer-flip — the overlay must not have
    // transferred attribution to fleet-cp.
    const legacyWriter = createStatusWriter({
      pb,
      bus,
      logger: cap.logger,
      writtenBy: "legacy",
    });
    await legacyWriter.write({
      key: "d6:langgraph-python",
      state: "green",
      signal: { ok: true },
      observedAt: "2026-06-04T00:10:00.000Z",
    });
    expect(
      cap.warns.filter((w) => w.msg === "status-writer.cross-writer-flip"),
    ).toHaveLength(0);
  });

  it("aggregate() worker-self-report leg with an observed status row preserves written_by/fail_count", async () => {
    const { pb, rows } = makeOverlayFakePb();
    seedLegacyRedRow(rows, "d6:langgraph-python");
    const bus = createEventBus();
    const cap = makeCapturingLogger();
    const statusWriter = createStatusWriter({
      pb,
      bus,
      logger: cap.logger,
      writtenBy: "fleet-cp",
    });
    const agg = createResultAggregator({
      statusWriter,
      runWriter: makeFakeRunWriter().writer,
      logger: cap.logger,
      now: () => 1_000,
    });

    await agg.aggregate(
      makeResult({
        commError: SAMPLE_COMM_ERROR,
        aggregateState: "error",
        aggregateSignal: { failedCount: 0 },
        cells: [],
      }),
    );

    const row = rows.get("d6:langgraph-python")!;
    expect(row.written_by).toBe("legacy");
    expect(row.fail_count).toBe(3);
    expect(row.first_failure_at).toBe("2026-06-03T23:00:00.000Z");
    expect(row.state).toBe("red");
    expect(commErrorFromStatusSignal(row.signal)).toEqual(SAMPLE_COMM_ERROR);
  });
});
