import { describe, it, expect, vi } from "vitest";
import { createResultConsumer } from "./result-consumer.js";
import { createResultAggregator } from "./result-aggregator.js";
import type {
  ResultAggregator,
  AggregateOutcome,
  CommErrorAggregateOutcome,
} from "./result-aggregator.js";
import type {
  PbClient,
  ListOpts,
  ListResult,
} from "../../storage/pb-client.js";
import type { JobView } from "../job-claim.js";
import type { Logger, State, WriteOutcome } from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import type {
  ProbeRunWriter,
  ProbeRunRecord,
} from "../../probes/run-history.js";
import { commErrorFromStatusSignal } from "../contracts.js";
import type { ServiceJobResult } from "../contracts.js";

// B6 (round 6): a SILENT logger — these tests previously imported the real
// process logger, spraying consumer warn/error lines into test output.
const logger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

/** Capturing logger for the log-message contract pins below. */
function makeCapturingLogger(): {
  logger: Logger;
  logs: {
    level: "warn" | "error";
    msg: string;
    ctx?: Record<string, unknown>;
  }[];
} {
  const logs: {
    level: "warn" | "error";
    msg: string;
    ctx?: Record<string, unknown>;
  }[] = [];
  return {
    logs,
    logger: {
      info() {},
      debug() {},
      warn(msg: string, ctx?: Record<string, unknown>) {
        logs.push({ level: "warn", msg, ctx });
      },
      error(msg: string, ctx?: Record<string, unknown>) {
        logs.push({ level: "error", msg, ctx });
      },
    },
  };
}

/**
 * Pins the control-plane RESULT CONSUMER — the worker->aggregator bridge that
 * makes the dashboard contract hold across the process split. The two
 * load-bearing behaviors: it aggregates a terminal row's persisted result and
 * latches it processed, and it never aggregates the SAME result twice (the
 * consume-once invariant) even across repeated cycles.
 */

interface JobRow extends JobView {
  result?: unknown;
  result_processed?: boolean;
  /** PB's auto-maintained mtime; the grace check reads this. */
  updated?: string;
  /** PB's auto-maintained ctime; the deterministic page sort reads this. */
  created?: string;
}

function jobView(over: Partial<JobView> = {}): JobView {
  // `probe_key` is the d6 AGGREGATE status-row key `d6:<slug>` — the same key
  // the dashboard reads. There is NO `e2e_d6:<slug>` row in the fleet path
  // (see contracts.ts `ServiceJobResult.aggregateKey`); `e2e_d6` is a DRIVER
  // KIND, never a key dimension.
  return {
    id: "j1",
    probe_key: "d6:langgraph-python",
    status: "done",
    claimed_by: "worker-7",
    lease_expires_at: null,
    version: 4,
    ...over,
  };
}

function sampleResult(over: Partial<ServiceJobResult> = {}): ServiceJobResult {
  return {
    jobId: "j1",
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "green",
    aggregateKey: "d6:langgraph-python",
    aggregateSignal: { failedCount: 0 },
    cells: [],
    rollup: { total: 1, passed: 1, failed: 0 },
    finishedAt: "2026-06-04T00:00:02.000Z",
    ...over,
  };
}

/**
 * Fake PB honoring the consumer's filter: `(status = "done" || status =
 * "failed") && result_processed != true`. Implements the status alternation +
 * the result_processed latch the way the real client would so the consume-once
 * loop is exercised faithfully.
 *
 * B6 (round 6): ONE fake, not two drifting copies. `honorSort: true` makes it
 * honor the consumer's deterministic `created,id` page order (used by the
 * >CONSUME_PAGE starvation regression, which needs faithful pagination); any
 * sort this fake does NOT model throws loudly instead of being silently
 * ignored, and `totalPages` is honest (Math.ceil over the matched set), not a
 * hardcoded 1.
 */
function makeFakePb(
  rows: JobRow[],
  fakeOpts: { honorSort?: boolean } = {},
): { pb: PbClient; rows: JobRow[] } {
  const store = [...rows];
  const unsupported = (n: string) => () => {
    throw new Error(`fake-pb: ${n} not implemented`);
  };
  const pb: PbClient = {
    async list<T>(_c: string, opts: ListOpts = {}): Promise<ListResult<T>> {
      // B6 (round 7) fail-loud doctrine: this fake only models page 1 — a
      // consumer that started paginating would silently get page-1 rows for
      // every page and the tests would pass for the wrong reason.
      if (opts.page !== undefined && opts.page !== 1) {
        throw new Error(`fake-pb: unmodeled page ${JSON.stringify(opts.page)}`);
      }
      const filter = opts.filter ?? "";
      const statuses = [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map(
        (m) => m[1],
      );
      const wantStatus = new Set(statuses);
      const wantUnprocessed = /result_processed\s*!=\s*true/.test(filter);
      // B6 (round 7): any filter clause this fake does NOT model must throw,
      // not be silently ignored (a new consumer filter term would otherwise
      // be un-tested while every test stays green). Strip the recognized
      // terms + connectives; any residue is unmodeled.
      const residue = filter
        .replace(/status\s*=\s*"\w+"/g, "")
        .replace(/result_processed\s*!=\s*true/g, "")
        .replace(/\|\||&&|\(|\)/g, "")
        .trim();
      if (residue) {
        throw new Error(
          `fake-pb: unmodeled filter residue ${JSON.stringify(residue)} in ${JSON.stringify(filter)}`,
        );
      }
      let items = store.filter((r) => {
        if (wantStatus.size > 0 && !wantStatus.has(r.status)) return false;
        if (wantUnprocessed && r.result_processed === true) return false;
        return true;
      });
      // The ONLY modeled sort is the consumer's deterministic `created,id`
      // page order — anything else would be silently un-modeled, so throw.
      if (opts.sort !== undefined && opts.sort !== "created,id") {
        throw new Error(`fake-pb: unmodeled sort ${JSON.stringify(opts.sort)}`);
      }
      if (opts.sort && fakeOpts.honorSort) {
        items = [...items].sort((a, b) => {
          const ac = String(a.created ?? "");
          const bc = String(b.created ?? "");
          if (ac !== bc) return ac < bc ? -1 : 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      }
      // HONESTY (B6): honor perPage like the real client — returning more
      // rows than the requested page silently un-tests the consumer's
      // pagination assumptions — and report a truthful totalPages.
      const perPage = opts.perPage ?? items.length;
      return {
        page: 1,
        perPage,
        totalPages: perPage > 0 ? Math.ceil(items.length / perPage) : 0,
        totalItems: items.length,
        items: items.slice(0, perPage) as unknown as T[],
      };
    },
    async update<T>(
      _c: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const row = store.find((r) => r.id === id);
      if (!row) throw new Error(`fake-pb: update of missing row ${id}`);
      Object.assign(row as unknown as Record<string, unknown>, record);
      return row as unknown as T;
    },
    getOne: unsupported("getOne") as PbClient["getOne"],
    getFirst: unsupported("getFirst") as PbClient["getFirst"],
    create: unsupported("create") as PbClient["create"],
    upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
    delete: unsupported("delete") as PbClient["delete"],
    deleteByFilter: unsupported("deleteByFilter") as PbClient["deleteByFilter"],
    health: unsupported("health") as PbClient["health"],
    createBackup: unsupported("createBackup") as PbClient["createBackup"],
    downloadBackup: unsupported("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
  };
  return { pb, rows: store };
}

function makeFakeAggregator(): ResultAggregator & {
  calls: ServiceJobResult[];
} {
  const calls: ServiceJobResult[] = [];
  // B6 (round 6): `satisfies`-checked construction instead of an `as` cast —
  // the cast silently accepted a fake whose shape drifted from the real
  // ResultAggregator contract; `satisfies` makes the compiler verify it.
  return {
    calls,
    aggregate: vi.fn(
      async (result: ServiceJobResult): Promise<AggregateOutcome> => {
        calls.push(result);
        return {
          runRowId: "run-row-1",
          statusOutcomes: [],
          overlayOutcomes: [],
          skipped: false,
        };
      },
    ),
    // The consumer calls aggregateCommError on the resultless-past-grace leg
    // (it synthesizes a worker-crashed-mid-job comm error before latching —
    // see the result-lost tests below). A default no-op vi.fn so tests can
    // assert calls or override it to throw.
    aggregateCommError: vi.fn(
      async (): Promise<CommErrorAggregateOutcome> => ({
        statusOutcomes: [],
        overlayOutcomes: [],
      }),
    ),
  } satisfies ResultAggregator & { calls: ServiceJobResult[] };
}

/**
 * A minimal status-writer fake with the REAL writer's routing for the
 * result-lost tests below (mirrors result-aggregator.test.ts's error-routing
 * fake): `writeOverlay` merges onto an EXISTING row (applied:true, durable
 * state preserved) and misses (applied:false) for an absent key; an "error"
 * write is history-only — it never lands on `statusRows` (what the dashboard
 * reads), only in `errorWrites` (the status_history audit trail).
 */
function makeStatusRowFake(): {
  writer: StatusWriter;
  statusRows: Map<string, { state: State; signal: unknown }>;
  errorWrites: { key: string; signal: unknown }[];
} {
  const statusRows = new Map<string, { state: State; signal: unknown }>();
  const errorWrites: { key: string; signal: unknown }[] = [];
  const writer: StatusWriter = {
    async write(result) {
      if (result.state !== "error") {
        statusRows.set(result.key, {
          state: result.state,
          signal: result.signal,
        });
      } else {
        errorWrites.push({ key: result.key, signal: result.signal });
      }
      const outcome: WriteOutcome = {
        previousState: null,
        newState: result.state,
        transition: result.state === "error" ? "error" : "first",
        firstFailureAt: null,
        failCount: 0,
        // Non-error writes land on the status row (persisted); error writes
        // mirror the real writer — persisted only when a prior row exists.
        persisted: result.state !== "error" || statusRows.has(result.key),
      };
      return outcome;
    },
    async writeOverlay(overlay) {
      const existing = statusRows.get(overlay.key);
      // B6 (round 7): stamp historyPersisted like the REAL writer — the
      // never-observed leg returns {applied:false,state:null,
      // historyPersisted:false} (nothing persisted), and an applied overlay
      // also lands its audit history row.
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
  return { writer, statusRows, errorWrites };
}

/** The result-lost leg never touches run-history — a do-nothing writer. */
function makeNoopRunWriter(): ProbeRunWriter {
  return {
    async start() {
      return { id: "run-row-1" };
    },
    async findByJobId() {
      return null;
    },
    async update() {},
    async finish() {},
    async recent(): Promise<ProbeRunRecord[]> {
      return [];
    },
  };
}

function row(over: Partial<JobRow> = {}): JobRow {
  return {
    ...jobView(),
    result: sampleResult(),
    result_processed: false,
    ...over,
  };
}

describe("ResultConsumer.consumeOnce", () => {
  it("aggregates a terminal row's result and latches it processed", async () => {
    const { pb, rows } = makeFakePb([row()]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(1);
    expect(out.failures).toBe(0);
    expect(aggregator.calls).toHaveLength(1);
    expect(aggregator.calls[0].aggregateKey).toBe("d6:langgraph-python");
    expect(rows[0].result_processed).toBe(true);
  });

  it("aggregates each result EXACTLY ONCE across repeated cycles", async () => {
    // j2 carries a result whose jobId matches its own row (the default
    // fixture's result is stamped jobId "j1" — a j2 row carrying it would
    // model an unreachable state).
    const { pb } = makeFakePb([
      row({ id: "j1" }),
      row({ id: "j2", result: sampleResult({ jobId: "j2" }) }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const first = await consumer.consumeOnce();
    const second = await consumer.consumeOnce();

    expect(first.processed).toBe(2);
    // Second cycle finds nothing unprocessed — the latch held.
    expect(second.processed).toBe(0);
    expect(aggregator.aggregate).toHaveBeenCalledTimes(2);
  });

  it("latches and counts processed a row whose aggregate DEDUP-SKIPS (skipped: true)", async () => {
    // The aggregator's per-jobId dedup gate returns skipped:true when the
    // result was already fully aggregated on a prior tick (only the latch
    // failed). The consumer must treat that as success: latch the row and
    // count it processed — leaving it unlatched would re-scan it forever.
    const { pb, rows } = makeFakePb([row()]);
    const aggregator = makeFakeAggregator();
    aggregator.aggregate = vi.fn(
      async (result: ServiceJobResult): Promise<AggregateOutcome> => {
        aggregator.calls.push(result);
        return {
          runRowId: "run-row-prior",
          statusOutcomes: [],
          overlayOutcomes: [],
          skipped: true,
        };
      },
    ) as ResultAggregator["aggregate"];
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(1);
    expect(out.failures).toBe(0);
    expect(rows[0].result_processed).toBe(true);
    // Next cycle finds nothing — the latch held.
    const second = await consumer.consumeOnce();
    expect(second.processed).toBe(0);
  });

  it("skips an already-processed row", async () => {
    const { pb } = makeFakePb([row({ result_processed: true })]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(0);
    expect(aggregator.aggregate).not.toHaveBeenCalled();
  });

  it("leaves a row unprocessed when aggregate throws, retrying next cycle", async () => {
    const { pb, rows } = makeFakePb([row()]);
    const aggregator = makeFakeAggregator();
    let calls = 0;
    aggregator.aggregate = vi.fn(async (_result: ServiceJobResult) => {
      calls++;
      if (calls === 1) throw new Error("transient PB blip");
      return {
        runRowId: "r",
        statusOutcomes: [],
        overlayOutcomes: [],
        skipped: false,
      };
    }) as ResultAggregator["aggregate"];
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const first = await consumer.consumeOnce();
    expect(first.processed).toBe(0);
    expect(first.failures).toBe(1);
    expect(rows[0].result_processed).toBe(false);

    // Retry succeeds and latches.
    const second = await consumer.consumeOnce();
    expect(second.processed).toBe(1);
    expect(rows[0].result_processed).toBe(true);
  });

  it("does NOT latch a FRESH terminal-but-resultless row (within grace)", async () => {
    // DATA-LOSS RACE: report() flips the row terminal, then writes `result` in a
    // SEPARATE pb.update milliseconds later. If the consumer scans in that
    // window it sees result === undefined; latching immediately would drop the
    // real result landing right after. Within the grace window we must LEAVE it
    // unprocessed so the next cycle picks up the worker's result write.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        // Became terminal 5s ago — well inside a 30s grace window.
        updated: "2026-06-04T00:04:55.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
    });

    const out = await consumer.consumeOnce();

    expect(aggregator.aggregate).not.toHaveBeenCalled();
    expect(out.processed).toBe(0);
    // Left unprocessed — the result write will land and be aggregated next tick.
    expect(rows[0].result_processed).toBeFalsy();
  });

  it("latches a terminal-but-resultless row PAST the grace window AND surfaces a comm error", async () => {
    // Genuinely resultless (a report whose result write never landed). The row
    // is ALREADY terminal, so the claimed|running sweepers never see it — the
    // consumer itself must synthesize the dashboard signal. Once aged past
    // grace, it SYNTHESIZES a `worker-crashed-mid-job` comm error (REQ-B, keyed
    // on the row's probe_key) and THEN latches so it doesn't re-scan forever.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        // Terminal 60s ago — past a 30s grace window.
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
    });

    const out = await consumer.consumeOnce();

    // The normal aggregate path is NOT taken (there is no result to aggregate).
    expect(aggregator.aggregate).not.toHaveBeenCalled();
    // The comm-error path IS taken, keyed on the row's d6 aggregate key.
    expect(aggregator.aggregateCommError).toHaveBeenCalledTimes(1);
    const arg = (aggregator.aggregateCommError as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg.commError.kind).toBe("worker-crashed-mid-job");
    expect(arg.commError.jobId).toBe(rows[0].id);
    expect(arg.aggregateKey).toBe("d6:langgraph-python");
    expect(out.processed).toBe(0);
    expect(rows[0].result_processed).toBe(true);
  });

  it("lands the result-lost overlay on the OBSERVED aggregate row with a resolver wired — per-key routing, the hint cannot override the row (REQ-B/F1d)", async () => {
    // F1d: routing is decided PER KEY by the aggregator's writeOverlay
    // attempt — the consumer's lastKnownState threading is deprecated, ignored
    // plumbing. Drive the REAL aggregator and wire a resolver whose hint
    // ("green") deliberately CONTRADICTS the observed row ("red"): the row's
    // own durable colour must stand and the overlay must land on the LIVE
    // status row the dashboard reads.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const statusFake = makeStatusRowFake();
    statusFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
    const aggregator = createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: makeNoopRunWriter(),
      logger,
      now: () => now,
    });
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
      resolvePriorState: async () => "green" as const,
    });

    const out = await consumer.consumeOnce();

    // The overlay landed on the live row; its durable colour is preserved —
    // NOT the resolver's contradictory hint, NOT a fabricated green.
    const persisted = statusFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(commErrorFromStatusSignal(persisted!.signal)?.kind).toBe(
      "worker-crashed-mid-job",
    );
    // Surfaced → latched, without counting as processed or as a failure.
    expect(rows[0].result_processed).toBe(true);
    expect(out.processed).toBe(0);
    expect(out.failures).toBe(0);
  });

  it("lands the result-lost overlay on the OBSERVED aggregate row with NO resolver wired — same per-key behavior (REQ-B/F1d)", async () => {
    // The resolver's presence is irrelevant to routing: an observed key keeps
    // its overlay purely off the aggregator's per-key writeOverlay attempt.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const statusFake = makeStatusRowFake();
    statusFake.statusRows.set("d6:langgraph-python", {
      state: "red",
      signal: { prior: true },
    });
    const aggregator = createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: makeNoopRunWriter(),
      logger,
      now: () => now,
    });
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
    });

    const out = await consumer.consumeOnce();

    const persisted = statusFake.statusRows.get("d6:langgraph-python");
    expect(persisted).toBeDefined();
    expect(persisted!.state).toBe("red");
    expect(commErrorFromStatusSignal(persisted!.signal)?.kind).toBe(
      "worker-crashed-mid-job",
    );
    expect(rows[0].result_processed).toBe(true);
    expect(out.processed).toBe(0);
    expect(out.failures).toBe(0);
  });

  it("routes a NEVER-observed result-lost key history-only (no status row fabricated) and still latches", async () => {
    // F2.1 no-false-baseline: a key with no live status row misses the overlay
    // (applied:false) and falls back to the history-only no-data ("error")
    // write — no row of any colour is invented, the comm error stays auditable
    // in status_history, and the job row still latches so it doesn't re-scan
    // forever.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const statusFake = makeStatusRowFake();
    const aggregator = createResultAggregator({
      statusWriter: statusFake.writer,
      runWriter: makeNoopRunWriter(),
      logger,
      now: () => now,
    });
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
    });

    const out = await consumer.consumeOnce();

    // No status row fabricated for the never-observed key …
    expect(statusFake.statusRows.get("d6:langgraph-python")).toBeUndefined();
    // … the comm error fell back to the history-only error write …
    expect(statusFake.errorWrites).toHaveLength(1);
    expect(statusFake.errorWrites[0].key).toBe("d6:langgraph-python");
    expect(
      commErrorFromStatusSignal(statusFake.errorWrites[0].signal)?.kind,
    ).toBe("worker-crashed-mid-job");
    // … and the surface succeeded, so the row LATCHES without counting as
    // processed (no result was aggregated) or as a failure.
    expect(rows[0].result_processed).toBe(true);
    expect(out.processed).toBe(0);
    expect(out.failures).toBe(0);
  });

  it("does NOT latch a resultless-past-grace row if the comm-error surface FAILS (retries next cycle)", async () => {
    // The comm error MUST reach the dashboard before we latch. If surfacing
    // throws, latching anyway would drop the REQ-B signal silently. So a failed
    // surface leaves the row unlatched for the next cycle to retry.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    aggregator.aggregateCommError = vi.fn(async () => {
      throw new Error("transient overlay write blip");
    }) as ResultAggregator["aggregateCommError"];
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
    });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(0);
    // A failed surface is retried, not counted in `failures` (the failure
    // counter tracks decode/aggregate/latch trouble on result-CARRYING rows;
    // the resultless leg's retry signal is the unlatched row itself).
    expect(out.failures).toBe(0);
    // Surface failed → NOT latched, so the next cycle re-attempts the comm error.
    expect(rows[0].result_processed).toBeFalsy();
  });

  it("latches a resultless row by FIRST-SEEN time, immune to a moving row.updated", async () => {
    // STABLE-BASIS regression: the grace window must measure from when the
    // consumer FIRST saw the row resultless, NOT from PB's `updated` mtime.
    // Here `row.updated` keeps advancing every cycle (as if any write touched
    // the row), which under the old mtime-based logic would keep the row
    // perpetually "young" and re-scanning forever. With the first-seen basis it
    // latches once 30s elapse since the first sighting regardless of `updated`.
    let clock = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:00:00.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => clock,
    });

    // Cycle 1: first sighting at t0 — within grace, not latched. Bump `updated`
    // to NOW so the old mtime logic would treat it as freshly-terminal forever.
    await consumer.consumeOnce();
    expect(rows[0].result_processed).toBeFalsy();

    // Advance 10s, touch `updated` to "now" again (mtime keeps moving).
    clock += 10_000;
    rows[0].updated = new Date(clock).toISOString();
    await consumer.consumeOnce();
    expect(rows[0].result_processed).toBeFalsy();

    // Advance past 30s SINCE FIRST SEEN (t0+31s) — even though `updated` is
    // current — the row must now latch on the stable first-seen basis.
    clock += 21_000;
    rows[0].updated = new Date(clock).toISOString();
    const out = await consumer.consumeOnce();

    expect(rows[0].result_processed).toBe(true);
    expect(out.processed).toBe(0);
    expect(aggregator.aggregate).not.toHaveBeenCalled();
  });

  it("prunes a firstSeenResultless entry when its row vanishes from the page (sweeper re-queue)", async () => {
    // MAP-LEAK regression: the in-memory grace Map is pruned on result-arrival
    // and on successful latch, but a resultless terminal row that the sweeper
    // RE-QUEUES (status done|failed -> pending) silently leaves the consumer's
    // done|failed filter — it is never seen again, so without a reconcile its
    // first-seen entry leaks forever. Each cycle must prune entries whose jobId
    // is not in the current page's scanned row-id set.
    let clock = Date.parse("2026-06-04T00:00:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        id: "j1",
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:00:00.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => clock,
    });

    // Cycle 1: first sighting at t0 — seeds firstSeenResultless["j1"], within
    // grace, not latched.
    await consumer.consumeOnce();
    expect(rows[0].result_processed).toBeFalsy();

    // The sweeper re-queues j1: status flips failed -> pending, so it no longer
    // matches the consumer's done|failed filter and vanishes from the page.
    rows[0].status = "pending";

    // Cycle 2 (only 5s later, well inside grace): the page is now empty. The
    // reconcile must DROP the stale j1 entry since it isn't in the scanned set.
    clock += 5_000;
    await consumer.consumeOnce();

    // Prove the entry was pruned: re-queue j1 back to a resultless terminal row
    // and advance the clock so that 31s have elapsed since the ORIGINAL t0
    // sighting. Set `updated` to "now" so the mtime-seed reflects a FRESH
    // terminal (the row just became terminal again). If the stale t0 entry had
    // leaked (survived), the row would latch immediately on this cycle (t0+31s
    // past the original grace). Because it was pruned, this is a FRESH
    // first-sighting at t0+31s — still within a new 30s window — so it must NOT
    // latch yet.
    rows[0].status = "failed";
    clock += 26_000; // t0 + 31s
    rows[0].updated = new Date(clock).toISOString();
    const out = await consumer.consumeOnce();
    expect(out.processed).toBe(0);
    expect(rows[0].result_processed).toBeFalsy();

    // And it latches only after a full grace window from the FRESH sighting.
    clock += 31_000; // (t0+31s) + 31s
    await consumer.consumeOnce();
    expect(rows[0].result_processed).toBe(true);
  });

  it("counts a failure and leaves the row UNLATCHED when the latch write throws after a successful aggregate, then retries", async () => {
    // B6(v): aggregate succeeded but the latch update threw — the documented
    // worst case. The cycle must count it in `failures` (so cadence/metrics
    // surface the latch trouble), leave the row unlatched, and the next cycle
    // must re-aggregate (a true no-op via the aggregator's per-jobId dedup)
    // and latch.
    const { pb, rows } = makeFakePb([row()]);
    const realUpdate = pb.update.bind(pb);
    let failLatch = true;
    pb.update = vi.fn(async (c: string, id: string, rec) => {
      if (failLatch) throw new Error("latch write blip");
      return realUpdate(c, id, rec);
    }) as PbClient["update"];
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const first = await consumer.consumeOnce();

    expect(aggregator.aggregate).toHaveBeenCalledTimes(1);
    expect(first.processed).toBe(0);
    expect(first.failures).toBe(1);
    expect(rows[0].result_processed).toBeFalsy();

    // Next cycle: re-aggregated (at-least-once) and latched.
    failLatch = false;
    const second = await consumer.consumeOnce();
    expect(aggregator.aggregate).toHaveBeenCalledTimes(2);
    expect(second.processed).toBe(1);
    expect(second.failures).toBe(0);
    expect(rows[0].result_processed).toBe(true);
  });

  it("retains the firstSeen entry when the resultless-leg latch fails (latch-empty-failed), re-surfacing and latching next cycle", async () => {
    // B6(v): the resultless-past-grace leg surfaced its comm error but the
    // latch update threw. The row must stay unlatched AND its first-seen
    // grace basis must be RETAINED — next cycle the row is immediately past
    // grace again (no fresh 30s window), the comm error is re-surfaced
    // (harmless) and the latch retried.
    let clock = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z", // terminal 60s ago — past grace
      }),
    ]);
    const realUpdate = pb.update.bind(pb);
    let failLatch = true;
    pb.update = vi.fn(async (c: string, id: string, rec) => {
      if (failLatch) throw new Error("latch write blip");
      return realUpdate(c, id, rec);
    }) as PbClient["update"];
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => clock,
    });

    const first = await consumer.consumeOnce();

    // Surfaced, but the latch failed: unlatched, NOT a counted failure (the
    // failure counter tracks result-carrying rows; the retry signal here is
    // the unlatched row itself).
    expect(aggregator.aggregateCommError).toHaveBeenCalledTimes(1);
    expect(first.processed).toBe(0);
    expect(first.failures).toBe(0);
    expect(rows[0].result_processed).toBeFalsy();

    // Next cycle ONE SECOND later. Touch `updated` to NOW so a freshly-seeded
    // mtime basis could NOT be past grace — only the RETAINED first-seen
    // entry explains an immediate re-surface + latch.
    clock += 1_000;
    rows[0].updated = new Date(clock).toISOString();
    failLatch = false;
    const second = await consumer.consumeOnce();

    expect(aggregator.aggregateCommError).toHaveBeenCalledTimes(2);
    expect(second.processed).toBe(0);
    expect(rows[0].result_processed).toBe(true);
  });

  it("aggregates a terminal row WITH a result normally (grace irrelevant)", async () => {
    // A row that carries a result is aggregated regardless of age — grace only
    // gates the resultless branch.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({ updated: "2026-06-04T00:04:59.000Z" }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
    });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(1);
    expect(aggregator.aggregate).toHaveBeenCalledTimes(1);
    expect(rows[0].result_processed).toBe(true);
  });

  it("treats an invalid aggregateState as a decode failure (fails loud)", async () => {
    // A garbage aggregateState ("grene") must NOT flow into the status state
    // machine. decodeResult validates it against the known ProbeState set and
    // fails at the boundary; the row is left unprocessed (counted a failure).
    const { pb, rows } = makeFakePb([
      row({
        result: sampleResult({
          aggregateState: "grene" as ServiceJobResult["aggregateState"],
        }),
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(0);
    expect(out.failures).toBe(1);
    expect(aggregator.aggregate).not.toHaveBeenCalled();
    // Not latched — a decode failure is a poison row, surfaced via metrics.
    expect(rows[0].result_processed).toBeFalsy();
  });

  it("treats a non-numeric rollup as a decode failure (fails loud)", async () => {
    const { pb } = makeFakePb([
      row({
        result: sampleResult({
          rollup: {
            total: "1",
            passed: 1,
            failed: 0,
          } as unknown as ServiceJobResult["rollup"],
        }),
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.failures).toBe(1);
    expect(aggregator.aggregate).not.toHaveBeenCalled();
  });

  it("treats a present-but-malformed commError as a decode failure (fails loud)", async () => {
    // A row read from the untrusted `result` JSON column may carry a garbage
    // `commError`. If decodeResult lets it through, it flows into aggregate() ->
    // withCommErrorOverlay -> commErrorToStatusSignal and embeds garbage under
    // the signal key; the dashboard's commErrorFromStatusSignal then rejects it
    // -> SILENT LOSS. decodeResult must validate commError at the boundary using
    // the same checks the dashboard's defensive decoder uses (valid kind +
    // string message/observedAt) and fail LOUD when present-but-malformed.
    const { pb, rows } = makeFakePb([
      row({
        result: sampleResult({
          commError: {
            kind: "not-a-kind",
            message: "oops",
            observedAt: "2026-06-04T00:00:03.000Z",
          } as unknown as ServiceJobResult["commError"],
        }),
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(0);
    expect(out.failures).toBe(1);
    expect(aggregator.aggregate).not.toHaveBeenCalled();
    // Not latched — a decode failure is a poison row, surfaced via metrics.
    expect(rows[0].result_processed).toBeFalsy();
  });

  it("aggregates a result carrying a WELL-FORMED commError normally", async () => {
    // A present-AND-valid commError must pass decodeResult and flow into the
    // aggregator unchanged — the boundary check only rejects malformed ones.
    const { pb, rows } = makeFakePb([
      row({
        result: sampleResult({
          commError: {
            kind: "worker-unreachable",
            message: "connect refused",
            observedAt: "2026-06-04T00:00:03.000Z",
            workerId: "worker-7",
          },
        }),
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(1);
    expect(out.failures).toBe(0);
    expect(aggregator.calls).toHaveLength(1);
    expect(aggregator.calls[0].commError?.kind).toBe("worker-unreachable");
    expect(rows[0].result_processed).toBe(true);
  });

  it("aggregates a result with NO commError normally (commError stays optional)", async () => {
    // The common, happy path: no commError present. The added boundary check
    // must not reject results that simply omit it.
    const { pb, rows } = makeFakePb([row({ result: sampleResult() })]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out.processed).toBe(1);
    expect(out.failures).toBe(0);
    expect(aggregator.calls[0].commError).toBeUndefined();
    expect(rows[0].result_processed).toBe(true);
  });

  it("never throws when the poll list read fails (contract)", async () => {
    // consumeOnce is documented "Never throws". A PB blip on the initial poll
    // list must yield {processed:0,failures:0}, not reject the cycle (the
    // control-plane caller relies on the no-throw contract to keep draining).
    const { pb } = makeFakePb([row()]);
    pb.list = vi.fn(async () => {
      throw new Error("transient PB list blip");
    }) as PbClient["list"];
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const out = await consumer.consumeOnce();

    expect(out).toEqual({ processed: 0, failures: 0 });
  });

  it("requests a DETERMINISTIC page sort (created,id) so paging is stable", async () => {
    // Fix 1a: an unsorted poll lets a >page resultless backlog rotate through
    // the first page; the consumer must request a stable `created,id` sort so
    // each page is a consistent prefix of the pending set.
    const { pb } = makeFakePb([row()]);
    const listSpy = vi.spyOn(pb, "list");
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    await consumer.consumeOnce();

    expect(listSpy).toHaveBeenCalledWith(
      "probe_jobs",
      expect.objectContaining({ sort: "created,id" }),
    );
  });

  it("does NOT reset the grace basis of a pending row that fell off a FULL page (no starvation)", async () => {
    // Fix 1b (STARVATION regression): when the resultless-terminal backlog
    // exceeds one page, a genuinely-pending row beyond the current page is
    // absent from the scan. The OLD prune deleted EVERY Map entry absent from
    // the page — so such a row's first-seen basis was wiped on the cycles it
    // wasn't paged, and its grace timer kept restarting → result-lost was NEVER
    // declared (it starved). With the prune scoped to NON-FULL pages only, a
    // full-page scan no longer prunes by absence, so the beyond-page row keeps
    // its basis and latches the moment it is paged again past grace.
    //
    // CONSUME_PAGE is 50. We seed "jTARGET" plus 50 filler rows. jTARGET sorts
    // FIRST (earliest created) on cycle 1 so its basis is seeded, then we make
    // it sort LAST (latest created) so it falls off the full 50-row page on the
    // mid cycles, then bring it back to the front past grace.
    let clock = Date.parse("2026-06-04T00:00:00.000Z");
    const base = Date.parse("2026-06-04T00:00:00.000Z");
    const target: JobRow = row({
      id: "jTARGET",
      result: undefined,
      status: "failed",
      created: new Date(base).toISOString(), // earliest → page 1 on cycle 1
      updated: "2026-06-04T00:00:00.000Z",
    });
    const fillers: JobRow[] = [];
    for (let i = 0; i < 50; i++) {
      fillers.push(
        row({
          id: `f${String(i).padStart(2, "0")}`,
          result: undefined,
          status: "failed",
          created: new Date(base + 1000 + i).toISOString(), // after target initially
          updated: "2026-06-04T00:00:00.000Z",
        }),
      );
    }
    const { pb, rows: store } = makeFakePb([target, ...fillers], {
      honorSort: true,
    });
    const listSpy = vi.spyOn(pb, "list");
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => clock,
    });
    const t = () => store.find((r) => r.id === "jTARGET")!;

    // Cycle 1 at t0: 51 rows, page holds 50; jTARGET sorts first so it's on the
    // page and its grace basis is seeded.
    await consumer.consumeOnce();
    expect(t().result_processed).toBeFalsy();
    // PIN the page-size assumption: this test hardcodes fillers.length (50)
    // against the consumer's CONSUME_PAGE so the page is exactly FULL on the
    // mid cycles. Assert the consumer's ACTUAL perPage matches — if
    // CONSUME_PAGE ever changes, fail here loudly instead of silently turning
    // the full-page starvation scenario into a non-full page that proves
    // nothing.
    expect(listSpy).toHaveBeenCalledWith(
      "probe_jobs",
      expect.objectContaining({ perPage: fillers.length }),
    );

    // Push jTARGET to the BACK of the sort so it falls OFF the full 50-row page.
    t().created = new Date(base + 999_999).toISOString();

    // Mid cycles WITHIN grace: jTARGET is absent from the full page. Bump its
    // `updated` mtime to "now" each cycle (as if any write touched it) so the
    // first-sighting mtime SEED can't silently recover a reset basis — the ONLY
    // thing that can keep jTARGET aged across these cycles is the in-memory
    // first-seen entry SURVIVING. The OLD unscoped prune deletes it here (the
    // page is full and jTARGET is absent), so a later re-sighting would seed a
    // FRESH (current-mtime) basis and never latch; the scoped prune keeps it.
    clock += 10_000;
    t().updated = new Date(clock).toISOString();
    await consumer.consumeOnce();
    expect(t().result_processed).toBeFalsy();

    clock += 10_000;
    t().updated = new Date(clock).toISOString();
    await consumer.consumeOnce();
    expect(t().result_processed).toBeFalsy();

    // Drain the page so jTARGET is paged again, now past 30s since FIRST sight
    // (t0+31s). Its `updated` mtime is CURRENT, so the mtime seed cannot age it;
    // only a SURVIVING first-seen basis can. If the basis had been pruned on the
    // mid cycles, this is a fresh sighting (new grace window) and it must NOT
    // latch. Because the scoped prune kept the basis, it latches now.
    for (const f of fillers) {
      const r = store.find((x) => x.id === f.id)!;
      r.result_processed = true; // resolve fillers so jTARGET is back on page 1
    }
    clock += 11_000; // t0 + 31s
    t().updated = new Date(clock).toISOString();
    await consumer.consumeOnce();
    expect(t().result_processed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B6 (round 6): log-message contracts. Operators grep these exact message
// strings, and the identifying fields (jobId / aggregateKey) are what make a
// line actionable — pin both so a rename or a dropped field fails here.
// ---------------------------------------------------------------------------
describe("ResultConsumer log-message contracts", () => {
  it("fleet.consumer.result-lost-commerror (warn) carries jobId + aggregateKey", async () => {
    const cap = makeCapturingLogger();
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z", // past grace
      }),
    ]);
    const consumer = createResultConsumer({
      pb,
      aggregator: makeFakeAggregator(),
      logger: cap.logger,
      now: () => now,
    });

    await consumer.consumeOnce();

    const lost = cap.logs.filter(
      (l) => l.msg === "fleet.consumer.result-lost-commerror",
    );
    expect(lost).toHaveLength(1);
    expect(lost[0]!.level).toBe("warn");
    expect(lost[0]!.ctx).toMatchObject({
      jobId: "j1",
      aggregateKey: "d6:langgraph-python",
    });
  });

  it("fleet.consumer.decode-failed (error) carries jobId + err", async () => {
    const cap = makeCapturingLogger();
    const { pb } = makeFakePb([
      row({
        result: sampleResult({
          aggregateState: "grene" as ServiceJobResult["aggregateState"],
        }),
      }),
    ]);
    const consumer = createResultConsumer({
      pb,
      aggregator: makeFakeAggregator(),
      logger: cap.logger,
    });

    await consumer.consumeOnce();

    const decode = cap.logs.filter(
      (l) => l.msg === "fleet.consumer.decode-failed",
    );
    expect(decode).toHaveLength(1);
    expect(decode[0]!.level).toBe("error");
    expect(decode[0]!.ctx).toMatchObject({ jobId: "j1" });
    expect(typeof decode[0]!.ctx?.err).toBe("string");
  });

  it("fleet.consumer.latch-empty-failed (warn) carries jobId + err", async () => {
    const cap = makeCapturingLogger();
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z", // past grace
      }),
    ]);
    pb.update = vi.fn(async () => {
      throw new Error("latch write blip");
    }) as PbClient["update"];
    const consumer = createResultConsumer({
      pb,
      aggregator: makeFakeAggregator(),
      logger: cap.logger,
      now: () => now,
    });

    await consumer.consumeOnce();

    const latch = cap.logs.filter(
      (l) => l.msg === "fleet.consumer.latch-empty-failed",
    );
    expect(latch).toHaveLength(1);
    expect(latch[0]!.level).toBe("warn");
    expect(latch[0]!.ctx).toMatchObject({ jobId: "j1" });
    expect(String(latch[0]!.ctx?.err)).toContain("latch write blip");
  });

  it("fleet.consumer.poll-failed (error) carries err", async () => {
    const cap = makeCapturingLogger();
    const { pb } = makeFakePb([row()]);
    pb.list = vi.fn(async () => {
      throw new Error("transient PB list blip");
    }) as PbClient["list"];
    const consumer = createResultConsumer({
      pb,
      aggregator: makeFakeAggregator(),
      logger: cap.logger,
    });

    await consumer.consumeOnce();

    const poll = cap.logs.filter((l) => l.msg === "fleet.consumer.poll-failed");
    expect(poll).toHaveLength(1);
    expect(poll[0]!.level).toBe("error");
    expect(String(poll[0]!.ctx?.err)).toContain("transient PB list blip");
  });
});
