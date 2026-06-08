import { describe, it, expect, vi } from "vitest";
import { createResultConsumer } from "./result-consumer.js";
import type {
  ResultAggregator,
  AggregateOutcome,
} from "./result-aggregator.js";
import type {
  PbClient,
  ListOpts,
  ListResult,
} from "../../storage/pb-client.js";
import type { JobView } from "../job-claim.js";
import type { ServiceJobResult } from "../contracts.js";
import { logger } from "../../logger.js";

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
  return {
    id: "j1",
    probe_key: "e2e_d6:langgraph-python",
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
    probeKey: "e2e_d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "green",
    aggregateKey: "e2e_d6:langgraph-python",
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
 */
function makeFakePb(rows: JobRow[]): { pb: PbClient; rows: JobRow[] } {
  const store = [...rows];
  const unsupported = (n: string) => () => {
    throw new Error(`fake-pb: ${n} not implemented`);
  };
  const pb: PbClient = {
    async list<T>(_c: string, opts: ListOpts = {}): Promise<ListResult<T>> {
      const statuses = [
        ...(opts.filter ?? "").matchAll(/status\s*=\s*"(\w+)"/g),
      ].map((m) => m[1]);
      const wantStatus = new Set(statuses);
      const wantUnprocessed = /result_processed\s*!=\s*true/.test(
        opts.filter ?? "",
      );
      const items = store.filter((r) => {
        if (wantStatus.size > 0 && !wantStatus.has(r.status)) return false;
        if (wantUnprocessed && r.result_processed === true) return false;
        return true;
      });
      return {
        page: 1,
        perPage: opts.perPage ?? items.length,
        totalPages: 1,
        totalItems: items.length,
        items: items as unknown as T[],
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

/**
 * Fake PB that, unlike `makeFakePb`, HONORS `perPage` + a `created,id` `sort`
 * so the consume poll's pagination is exercised faithfully. Used to reproduce
 * the >CONSUME_PAGE resultless-backlog starvation: with a stable sort + a
 * scoped prune, a row on the first page must keep its first-seen grace basis
 * across cycles (it isn't reset just because the backlog spills past the page).
 */
function makePaginatingFakePb(rows: JobRow[]): {
  pb: PbClient;
  rows: JobRow[];
} {
  const store = [...rows];
  const unsupported = (n: string) => () => {
    throw new Error(`fake-pb: ${n} not implemented`);
  };
  const pb: PbClient = {
    async list<T>(_c: string, opts: ListOpts = {}): Promise<ListResult<T>> {
      const statuses = [
        ...(opts.filter ?? "").matchAll(/status\s*=\s*"(\w+)"/g),
      ].map((m) => m[1]);
      const wantStatus = new Set(statuses);
      const wantUnprocessed = /result_processed\s*!=\s*true/.test(
        opts.filter ?? "",
      );
      let items = store.filter((r) => {
        if (wantStatus.size > 0 && !wantStatus.has(r.status)) return false;
        if (wantUnprocessed && r.result_processed === true) return false;
        return true;
      });
      // Honor a `created,id` sort (the consumer's deterministic page order).
      if (opts.sort) {
        items = [...items].sort((a, b) => {
          const ac = String(a.created ?? "");
          const bc = String(b.created ?? "");
          if (ac !== bc) return ac < bc ? -1 : 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      }
      const perPage = opts.perPage ?? items.length;
      const slice = items.slice(0, perPage);
      return {
        page: 1,
        perPage,
        totalPages: 1,
        totalItems: items.length,
        items: slice as unknown as T[],
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
  const agg = {
    calls,
    aggregate: vi.fn(
      async (result: ServiceJobResult): Promise<AggregateOutcome> => {
        calls.push(result);
        return { runRowId: "run-row-1", statusOutcomes: [], skipped: false };
      },
    ),
    // The consumer never calls aggregateCommError (that's the producer-sweep /
    // fleet-health leg); present only to satisfy the ResultAggregator interface.
    aggregateCommError: vi.fn(async () => ({ statusOutcomes: [] })),
  };
  return agg as ResultAggregator & { calls: ServiceJobResult[] };
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
    expect(aggregator.calls[0].aggregateKey).toBe("e2e_d6:langgraph-python");
    expect(rows[0].result_processed).toBe(true);
  });

  it("aggregates each result EXACTLY ONCE across repeated cycles", async () => {
    const { pb } = makeFakePb([row({ id: "j1" }), row({ id: "j2" })]);
    const aggregator = makeFakeAggregator();
    const consumer = createResultConsumer({ pb, aggregator, logger });

    const first = await consumer.consumeOnce();
    const second = await consumer.consumeOnce();

    expect(first.processed).toBe(2);
    // Second cycle finds nothing unprocessed — the latch held.
    expect(second.processed).toBe(0);
    expect(aggregator.aggregate).toHaveBeenCalledTimes(2);
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
      return { runRowId: "r", statusOutcomes: [], skipped: false };
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
    expect(arg.aggregateKey).toBe("e2e_d6:langgraph-python");
    expect(out.processed).toBe(0);
    expect(rows[0].result_processed).toBe(true);
  });

  it("carries the PRIOR OBSERVED colour onto the result-lost comm error (REQ-B)", async () => {
    // REQ-B (Fix A1): a service PREVIOUSLY observed green/red/degraded whose
    // worker crashes mid-job (result lost past grace) must keep its observed
    // colour on the overlay so the comm error lands on the LIVE status row (not
    // history-only) and the dashboard renders ⚡ "unreachable". Without a
    // resolvePriorState resolver the consumer omits lastKnownState, the
    // aggregator falls back to "error", and the overlay routes to status_history
    // only — silently lost. The consumer must resolve the row's probe_key prior
    // colour and thread it as lastKnownState.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb, rows } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const resolvePriorState = vi.fn(async (_key: string) => "green" as const);
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
      resolvePriorState,
    });

    const out = await consumer.consumeOnce();

    expect(aggregator.aggregateCommError).toHaveBeenCalledTimes(1);
    // The resolver was consulted for the row's d6 aggregate key.
    expect(resolvePriorState).toHaveBeenCalledWith("e2e_d6:langgraph-python");
    const arg = (aggregator.aggregateCommError as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // The observed colour is carried so the overlay lands on the LIVE status row.
    expect(arg.lastKnownState).toBe("green");
    expect(arg.aggregateKey).toBe("e2e_d6:langgraph-python");
    expect(out.processed).toBe(0);
    expect(rows[0].result_processed).toBe(true);
  });

  it("omits lastKnownState for a NEVER-observed result-lost row (no green fabrication)", async () => {
    // REQ-B (Fix A1): a never-observed key (resolver returns null) must NOT
    // carry a lastKnownState — the aggregator then writes the no-data ("error")
    // path and never fabricates a green status row for a service we never saw.
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const { pb } = makeFakePb([
      row({
        result: undefined,
        status: "failed",
        updated: "2026-06-04T00:04:00.000Z",
      }),
    ]);
    const aggregator = makeFakeAggregator();
    const resolvePriorState = vi.fn(async (_key: string) => null);
    const consumer = createResultConsumer({
      pb,
      aggregator,
      logger,
      now: () => now,
      resolvePriorState,
    });

    await consumer.consumeOnce();

    expect(aggregator.aggregateCommError).toHaveBeenCalledTimes(1);
    const arg = (aggregator.aggregateCommError as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg.lastKnownState).toBeUndefined();
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
    const { pb, rows: store } = makePaginatingFakePb([target, ...fillers]);
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
