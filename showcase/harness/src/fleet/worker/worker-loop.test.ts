import { describe, it, expect, vi } from "vitest";
import {
  startWorkerLoop,
  runClaimedJob,
  computeRollup,
  buildServiceJobResult,
  buildCommErrorResult,
  type ServiceJobDriver,
  type ServiceDriverContext,
  type BudgetSource,
  type DriverRegistry,
  type DriverRegistryEntry,
  type WorkerLoopHandle,
} from "./worker-loop.js";
import type { DriverKind } from "./payload-mapper.js";
import type {
  FleetQueueClient,
  ClaimedJob,
  JobLease,
  JobView,
  ServiceJobPayload,
  ServiceJobResult,
  ServiceCellResult,
} from "../contracts.js";
import type { ProbeResult, ProbeState, Logger } from "../../types/index.js";
import type { BrowserPoolBudget } from "../../probes/helpers/browser-pool.js";

/**
 * S7 worker-loop contract pins. Drives the loop / job-runner with FAKES for the
 * queue client, the per-service driver, and the pool budget so the claim → run
 * → report round-trip, the lease heartbeat, and the budget gate are exercised
 * without a live PocketBase / chromium / cgroup.
 */

// ── Fakes ──────────────────────────────────────────────────────────────

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * A sleep fake that yields a MACROTASK (setTimeout(0)) rather than resolving
 * synchronously. The loop polls in a tight `while`, and `vi.waitFor` checks on
 * a macrotask timer — an immediately-resolving sleep would starve that timer
 * (microtask-only) and hang the test. Yielding a macrotask lets `vi.waitFor`
 * observe progress while keeping the loop fast.
 */
function yieldingSleep(): (ms: number, signal?: AbortSignal) => Promise<void> {
  return (_ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const t = setTimeout(resolve, 0);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
}

/** A budget source that always reports `available` headroom. */
function budgetWith(
  available: number,
  overrides: Partial<BrowserPoolBudget> = {},
): BudgetSource {
  const b: BrowserPoolBudget = {
    inUse: 0,
    available,
    max: 24,
    pidsCurrent: 10,
    pidsMax: 1000,
    ...overrides,
  };
  return { budget: () => b };
}

function makeJobView(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    probe_key: "d6:langgraph-python",
    status: "claimed",
    claimed_by: "worker-test",
    lease_expires_at: "2026-06-04T00:05:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makePayload(
  overrides: Partial<ServiceJobPayload> = {},
): ServiceJobPayload {
  return {
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    driverKind: "e2e_d6",
    meta: {
      runId: "run-42",
      triggered: false,
      enqueuedAt: "2026-06-04T00:00:00.000Z",
    },
    ...overrides,
  };
}

function makeLease(
  overrides: {
    job?: Partial<JobView>;
    payload?: Partial<ServiceJobPayload>;
  } = {},
): JobLease {
  return {
    job: makeJobView(overrides.job),
    payload: makePayload(overrides.payload),
    leaseExpiresAt: "2026-06-04T00:05:00.000Z",
  };
}

/**
 * A driver fake that side-emits per-cell rows through `ctx.writer` (exactly as
 * the real d6 driver does) plus the aggregate side row, then returns the
 * aggregate `ProbeResult` as its primary value.
 */
function makeDriver(args: {
  slug: string;
  cells: Array<{ featureId: string; state: ProbeState }>;
  aggregateState: ProbeState;
  onRun?: (ctx: ServiceDriverContext) => void | Promise<void>;
}): ServiceJobDriver {
  return {
    async run(ctx, _input): Promise<ProbeResult> {
      await args.onRun?.(ctx);
      const observedAt = ctx.now().toISOString();
      for (const cell of args.cells) {
        await ctx.writer.write({
          key: `d6:${args.slug}/${cell.featureId}`,
          state: cell.state,
          signal: { featureType: cell.featureId },
          observedAt,
        });
      }
      // Aggregate side row — the loop must NOT count this as a cell.
      await ctx.writer.write({
        key: `d6:${args.slug}`,
        state: args.aggregateState,
        signal: { shape: "package", slug: args.slug },
        observedAt,
      });
      return {
        key: `e2e_d6:${args.slug}`,
        state: args.aggregateState,
        signal: { shape: "package", slug: args.slug },
        observedAt,
      };
    },
  };
}

interface RecordingQueue extends FleetQueueClient {
  reports: ServiceJobResult[];
  renewCalls: number;
}

/** A queue fake that hands out a fixed sequence of claim results. */
function makeQueue(claims: ClaimedJob[]): RecordingQueue {
  const reports: ServiceJobResult[] = [];
  let i = 0;
  return {
    reports,
    renewCalls: 0,
    async enqueue() {
      throw new Error("enqueue not used by worker");
    },
    async claimNext(): Promise<ClaimedJob> {
      const next = claims[i] ?? { claimed: false };
      if (i < claims.length) i++;
      return next;
    },
    async renewLease(
      _jobId,
      _workerId,
      _leaseSeconds,
    ): Promise<JobLease | null> {
      this.renewCalls++;
      return makeLease();
    },
    async report({ result }): Promise<void> {
      reports.push(result);
    },
    async sweepExpired() {
      return { reclaimed: 0, commErrors: [] };
    },
  };
}

const passInput = (): unknown => ({
  key: "d6:langgraph-python",
  backendUrl: "http://x",
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe("computeRollup", () => {
  it("counts green as passed and everything else as failed", () => {
    const cells: ServiceCellResult[] = [
      {
        cellId: "a",
        cellKey: "k/a",
        state: "green",
        signal: {},
        observedAt: "t",
      },
      {
        cellId: "b",
        cellKey: "k/b",
        state: "red",
        signal: {},
        observedAt: "t",
      },
      {
        cellId: "c",
        cellKey: "k/c",
        state: "error",
        signal: {},
        observedAt: "t",
      },
      {
        cellId: "d",
        cellKey: "k/d",
        state: "degraded",
        signal: {},
        observedAt: "t",
      },
    ];
    expect(computeRollup(cells)).toEqual({ total: 4, passed: 1, failed: 3 });
  });

  it("is zeroed for no cells", () => {
    expect(computeRollup([])).toEqual({ total: 0, passed: 0, failed: 0 });
  });
});

describe("buildServiceJobResult", () => {
  it("echoes payload identity and folds in the aggregate + rollup", () => {
    const lease = makeLease();
    const aggregate: ProbeResult = {
      key: "e2e_d6:langgraph-python",
      state: "green",
      signal: { ok: true },
      observedAt: "2026-06-04T00:04:00.000Z",
    };
    const cells: ServiceCellResult[] = [
      {
        cellId: "shared-state",
        cellKey: "d6:langgraph-python/shared-state",
        state: "green",
        signal: {},
        observedAt: "t",
      },
    ];
    const result = buildServiceJobResult({
      lease,
      workerId: "worker-test",
      aggregate,
      cells,
      finishedAt: "2026-06-04T00:04:30.000Z",
    });
    expect(result.jobId).toBe("job-1");
    expect(result.probeKey).toBe("d6:langgraph-python");
    expect(result.serviceSlug).toBe("langgraph-python");
    expect(result.runId).toBe("run-42");
    expect(result.workerId).toBe("worker-test");
    expect(result.aggregateState).toBe("green");
    expect(result.aggregateKey).toBe("e2e_d6:langgraph-python");
    expect(result.cells).toEqual(cells);
    expect(result.rollup).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(result.commError).toBeUndefined();
  });

  it("fails loud when the driver returns an out-of-set aggregate state", () => {
    // The driver return is untrusted at the producer boundary: a garbage
    // state ("grene") must NOT flow into the dashboard status state machine
    // via the in-process path (the cross-process result-consumer validates
    // the same set, but the in-process path needs its own guard). Validate
    // at buildServiceJobResult and throw so the worker loop routes it to an
    // error result instead of persisting junk.
    const lease = makeLease();
    const aggregate = {
      key: "e2e_d6:langgraph-python",
      state: "grene" as ProbeState,
      signal: {},
      observedAt: "2026-06-04T00:04:00.000Z",
    } as ProbeResult;
    expect(() =>
      buildServiceJobResult({
        lease,
        workerId: "worker-test",
        aggregate,
        cells: [],
        finishedAt: "2026-06-04T00:04:30.000Z",
      }),
    ).toThrow(/invalid aggregateState "grene"/);
  });
});

describe("buildCommErrorResult", () => {
  it("produces an error-state terminal result carrying the comm error", () => {
    const result = buildCommErrorResult({
      lease: makeLease(),
      workerId: "worker-test",
      commError: {
        kind: "worker-crashed-mid-job",
        message: "boom",
        observedAt: "t",
      },
      finishedAt: "t2",
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError?.kind).toBe("worker-crashed-mid-job");
    expect(result.cells).toEqual([]);
    expect(result.rollup).toEqual({ total: 0, passed: 0, failed: 0 });
  });
});

// ── runClaimedJob: claim→run→report round-trip ─────────────────────────────

describe("runClaimedJob", () => {
  const baseDeps = () => ({
    workerId: "worker-test",
    queue: makeQueue([]),
    payloadToInput: passInput,
    logger: silentLogger,
    env: {} as Readonly<Record<string, string | undefined>>,
    now: () => new Date("2026-06-04T00:04:00.000Z"),
    sleep: async () => {},
  });

  it("captures per-cell rows, filters the aggregate side row, and computes the result", async () => {
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [
        { featureId: "shared-state", state: "green" },
        { featureId: "human-in-the-loop", state: "red" },
      ],
      aggregateState: "red",
    });
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });

    // Two cells captured; aggregate side row NOT counted as a cell.
    expect(result.cells).toHaveLength(2);
    expect(result.cells.map((c) => c.cellId).sort()).toEqual([
      "human-in-the-loop",
      "shared-state",
    ]);
    expect(result.cells.find((c) => c.cellId === "shared-state")?.cellKey).toBe(
      "d6:langgraph-python/shared-state",
    );
    expect(result.rollup).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(result.aggregateState).toBe("red");
    expect(result.aggregateKey).toBe("e2e_d6:langgraph-python");
    expect(result.commError).toBeUndefined();
  });

  it("classifies a GENUINE BrowserPool-unavailable throw as worker-crashed-mid-job", async () => {
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        // The browser-pool's OWN unavailability signal is its message prefix
        // (`BrowserPool ...` / `browser-pool: ...`) on a plain Error — it never
        // sets a custom `.name`/class. This is the ONLY throw shape that means
        // "the pool itself is unreachable", so it is the only branch that keeps
        // a `worker-crashed-mid-job` commError.
        throw new Error("BrowserPool is shut down");
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError?.kind).toBe("worker-crashed-mid-job");
    expect(result.commError?.message).toContain("BrowserPool is shut down");
  });

  it("classifies the kebab `browser-pool:` throw prefix as worker-crashed-mid-job", async () => {
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        // The pool's other genuine-unavailability throws use the kebab prefix.
        throw new Error("browser-pool: relaunch retries exhausted");
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.commError?.kind).toBe("worker-crashed-mid-job");
  });

  it("does NOT masquerade a PlaywrightTimeoutError (a real test failure) as a pool outage", async () => {
    // REQ-B inversion guard: a genuine in-driver test failure thrown by
    // Playwright carries a name like `PlaywrightTimeoutError` / `TimeoutError`.
    // The old broad `/pool|launcher|browser|chromium|playwright/i` name match
    // wrongly classified this as pool-infra → "couldn't reach the pool",
    // HIDING a real product/test regression. It MUST classify as a driver
    // error: aggregateState "error" with NO commError (a probe error, not a
    // pool-unreachable overlay).
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        const err = new Error(
          "locator.click: Timeout 30000ms exceeded waiting for getByRole('button')",
        );
        err.name = "PlaywrightTimeoutError";
        throw err;
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError).toBeUndefined();
    expect(result.aggregateKey).toBe("d6:langgraph-python");
  });

  it("does NOT masquerade a plain TimeoutError test failure as a pool outage", async () => {
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        const err = new Error("waiting for selector failed");
        err.name = "TimeoutError";
        throw err;
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError).toBeUndefined();
  });

  it("does NOT masquerade a test assertion that merely MENTIONS the browser as a pool outage", async () => {
    // The error MESSAGE legitimately mentions "browser"/"playwright" (a normal
    // test assertion about the page), but it is NOT the pool's own throw — it
    // must stay a driver error, not a comm error.
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        throw new Error(
          "expected the browser to navigate to /chat but it stayed on /",
        );
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError).toBeUndefined();
  });

  it("classifies a zod/schema validation throw as worker-protocol-violation", async () => {
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        const err = new Error(
          "Invalid input: expected string, received number",
        );
        err.name = "ZodError";
        throw err;
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError?.kind).toBe("worker-protocol-violation");
    expect(result.commError?.message).toContain("expected string");
  });

  it("classifies a genuine in-driver test/runtime error as a probe error WITHOUT a commError", async () => {
    const driver: ServiceJobDriver = {
      async run(): Promise<ProbeResult> {
        // A normal in-driver test failure / runtime throw — this is a probe
        // RED/error, not a "couldn't reach the pool" overlay.
        throw new Error("expected button to be visible, but it was hidden");
      },
    };
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    // The key distinction: a real test/runtime error surfaces as a probe error,
    // NOT a pool-unreachable comm error.
    expect(result.commError).toBeUndefined();
    expect(result.aggregateKey).toBe("d6:langgraph-python");
  });

  it("routes an out-of-set driver aggregate state to an error result (no junk state escapes)", async () => {
    // The driver returns a garbage aggregate state. buildServiceJobResult
    // throws at the producer boundary, runClaimedJob catches it as a
    // driver-error, and the reported result carries a safe "error" state —
    // never the garbage "grene".
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "grene" as ProbeState,
    });
    const result = await runClaimedJob({ ...baseDeps(), driver }, makeLease(), {
      leaseSeconds: 300,
      heartbeatMs: 1_000_000,
    });
    expect(result.aggregateState).toBe("error");
    expect(result.commError).toBeUndefined();
    expect(result.aggregateKey).toBe("d6:langgraph-python");
  });

  it("returns a protocol-violation comm error when the payload cannot be mapped", async () => {
    const driver = makeDriver({
      slug: "x",
      cells: [],
      aggregateState: "green",
    });
    const result = await runClaimedJob(
      { ...baseDeps(), driver, payloadToInput: () => undefined },
      makeLease(),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.aggregateState).toBe("error");
    expect(result.commError?.kind).toBe("worker-protocol-violation");
  });

  it("returns a protocol-violation comm error when payloadToInput THROWS on a poison payload", async () => {
    // A poison payload that fails to decode/map by THROWING (not by returning
    // undefined) must NOT escape runClaimedJob — the worker owns the claimed
    // row, so it must emit a `worker-protocol-violation` comm-error result the
    // dashboard surfaces, instead of a bare release-failed (which the dashboard
    // silently loses after grace) or, worse, rejecting the loop's done-promise
    // (silent worker death).
    const driver = makeDriver({
      slug: "x",
      cells: [],
      aggregateState: "green",
    });
    const result = await runClaimedJob(
      {
        ...baseDeps(),
        driver,
        payloadToInput: () => {
          throw new Error("payload decode failed: malformed driverInputs JSON");
        },
      },
      makeLease(),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.aggregateState).toBe("error");
    expect(result.commError?.kind).toBe("worker-protocol-violation");
    expect(result.commError?.message).toContain("payload decode failed");
  });

  it("renews the lease on the heartbeat cadence during a long run", async () => {
    const queue = makeQueue([]);
    // Fake sleep that resolves immediately so the heartbeat fires fast.
    const sleepImpl = vi.fn(async () => {});
    // A driver that lets the heartbeat fire a couple of times before settling.
    let renewedDuringRun = 0;
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
      onRun: async () => {
        // Let the heartbeat loop (sleep→renew) run a few iterations.
        for (let i = 0; i < 3; i++) {
          await Promise.resolve();
          await Promise.resolve();
        }
        renewedDuringRun = queue.renewCalls;
      },
    });
    const result = await runClaimedJob(
      {
        workerId: "worker-test",
        queue,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: sleepImpl,
        driver,
      },
      makeLease(),
      { leaseSeconds: 300, heartbeatMs: 50 },
    );
    expect(result.aggregateState).toBe("green");
    // The heartbeat fired at least once during the run.
    expect(queue.renewCalls).toBeGreaterThanOrEqual(1);
    expect(renewedDuringRun).toBeGreaterThanOrEqual(1);
  });
});

// ── startWorkerLoop: full poll loop ────────────────────────────────────────

describe("startWorkerLoop", () => {
  it("throws at construction when heartbeatMs >= leaseSeconds*1000 (lease would expire before first renew)", () => {
    const start = () =>
      startWorkerLoop({
        workerId: "worker-test",
        queue: makeQueue([]),
        pool: budgetWith(5),
        driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
        // 60s heartbeat vs. a 30s lease → the lease expires before the first
        // renew fires → a false worker-crashed-mid-job.
        leaseSeconds: 30,
        heartbeatMs: 60_000,
      });
    expect(start).toThrow(/heartbeatMs/);
  });

  it("does NOT throw at construction for a safe heartbeat/lease combo", () => {
    const start = () =>
      startWorkerLoop({
        workerId: "worker-test",
        queue: makeQueue([]),
        pool: budgetWith(5),
        driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
        leaseSeconds: 300,
        heartbeatMs: 60_000,
      }).stop();
    expect(start).not.toThrow();
  });

  it("throws at construction when NEITHER a registry NOR the legacy driver pair is supplied", () => {
    const start = (): WorkerLoopHandle =>
      startWorkerLoop({
        workerId: "worker-test",
        queue: makeQueue([]),
        pool: budgetWith(5),
        // No `drivers`, no `driver`/`payloadToInput` → every claim would
        // terminate as a protocol violation. Fail loud at construction.
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
        leaseSeconds: 300,
        heartbeatMs: 60_000,
      });
    expect(start).toThrow(/has no drivers/);
  });

  it("throws at construction when given an EMPTY registry", () => {
    const start = (): WorkerLoopHandle =>
      startWorkerLoop({
        workerId: "worker-test",
        queue: makeQueue([]),
        pool: budgetWith(5),
        // An empty registry can route NOTHING — same misconfiguration as no
        // drivers at all.
        drivers: new Map<DriverKind, DriverRegistryEntry>(),
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
        leaseSeconds: 300,
        heartbeatMs: 60_000,
      });
    expect(start).toThrow(/has no drivers/);
  });

  it("throws at construction when a legacy `driver` is supplied WITHOUT a `payloadToInput`", () => {
    const start = (): WorkerLoopHandle =>
      startWorkerLoop({
        workerId: "worker-test",
        queue: makeQueue([]),
        pool: budgetWith(5),
        // A driver with no mapper is not a usable run path (the loop can't build
        // a driver input) — the legacy pair requires BOTH halves.
        driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
        leaseSeconds: 300,
        heartbeatMs: 60_000,
      });
    expect(start).toThrow(/has no drivers/);
  });

  it("claims a job, runs it, reports a correct ServiceJobResult, then idles", async () => {
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [
        { featureId: "shared-state", state: "green" },
        { featureId: "tools", state: "green" },
      ],
      aggregateState: "green",
    });
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver,
      payloadToInput: passInput,
      logger: silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      // Large lease so the (very large) heartbeat never fires during the short
      // test, while keeping heartbeatMs < leaseSeconds*1000 (construction guard).
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    // Wait until the report lands, then stop.
    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    await handle.stop();

    const report = queue.reports[0]!;
    expect(report.jobId).toBe("job-1");
    expect(report.serviceSlug).toBe("langgraph-python");
    expect(report.runId).toBe("run-42");
    expect(report.aggregateState).toBe("green");
    expect(report.rollup).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(report.cells).toHaveLength(2);
  });

  it("fires onCurrentJobChange with the jobId on claim and null when it settles", async () => {
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
    });
    const changes: Array<string | null> = [];
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver,
      payloadToInput: passInput,
      logger: silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      // Large lease so the (very large) heartbeat never fires during the short
      // test, while keeping heartbeatMs < leaseSeconds*1000 (construction guard).
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
      onCurrentJobChange: (id) => {
        changes.push(id);
      },
    });

    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    await handle.stop();

    // The claimed jobId is reported live, then cleared to null when settled.
    expect(changes).toEqual(["job-1", null]);
  });

  it("does not let a throwing onCurrentJobChange break the loop", async () => {
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
    });
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver,
      payloadToInput: passInput,
      logger: silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      // Large lease so the (very large) heartbeat never fires during the short
      // test, while keeping heartbeatMs < leaseSeconds*1000 (construction guard).
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
      onCurrentJobChange: () => {
        throw new Error("registration heartbeat boom");
      },
    });

    // The job still runs + reports despite the hook throwing.
    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    await handle.stop();
    expect(queue.reports[0]!.aggregateState).toBe("green");
  });

  it("does NOT claim when the pool budget is exhausted", async () => {
    const claimNext = vi.fn(async () => ({ claimed: false }) as ClaimedJob);
    const queue: FleetQueueClient = {
      ...makeQueue([]),
      claimNext,
    };
    const driver = makeDriver({
      slug: "x",
      cells: [],
      aggregateState: "green",
    });
    let sleeps = 0;
    const baseSleep = yieldingSleep();
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(0, { inUse: 24 }), // saturated
      driver,
      payloadToInput: passInput,
      logger: silentLogger,
      env: {},
      now: () => new Date(),
      sleep: (ms, signal) => {
        sleeps++;
        return baseSleep(ms, signal);
      },
      pollIntervalMs: 1,
    });

    await vi.waitFor(() => expect(sleeps).toBeGreaterThan(2));
    await handle.stop();

    // Budget exhausted → never claimed.
    expect(claimNext).not.toHaveBeenCalled();
  });

  it("logs and continues (does not reject) when pool.budget() throws", async () => {
    // budget() throws on the first poll, then recovers with headroom so the
    // loop goes on to claim + report — proving the throw was swallowed, the
    // loop did not die, and its done-promise did not reject.
    let budgetCalls = 0;
    const pool: BudgetSource = {
      budget() {
        budgetCalls++;
        if (budgetCalls === 1) {
          throw new Error("cgroup pids.current read failed");
        }
        return {
          inUse: 0,
          available: 5,
          max: 24,
          pidsCurrent: 10,
          pidsMax: 1000,
        };
      },
    };
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
    });
    const errors: string[] = [];
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool,
      driver,
      payloadToInput: passInput,
      logger: { ...silentLogger, error: (msg: string) => errors.push(msg) },
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      // Large lease so the (very large) heartbeat never fires during the short
      // test, while keeping heartbeatMs < leaseSeconds*1000 (construction guard).
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    let rejected = false;
    handle.done.catch(() => {
      rejected = true;
    });

    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    await handle.stop();

    expect(rejected).toBe(false);
    expect(errors).toContain("fleet.worker.budget-error");
    expect(budgetCalls).toBeGreaterThanOrEqual(2);
    expect(queue.reports[0]!.aggregateState).toBe("green");
  });

  it("continues the loop when a claim throws (transport error)", async () => {
    let calls = 0;
    const claimNext = vi.fn(async (): Promise<ClaimedJob> => {
      calls++;
      if (calls === 1) throw new Error("transport boom");
      if (calls === 2) return { claimed: true, lease: makeLease() };
      return { claimed: false };
    });
    const queueBase = makeQueue([]);
    const reports = queueBase.reports;
    const queue: FleetQueueClient = { ...queueBase, claimNext };
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
    });
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver,
      payloadToInput: passInput,
      logger: silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      // Large lease so the (very large) heartbeat never fires during the short
      // test, while keeping heartbeatMs < leaseSeconds*1000 (construction guard).
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    await vi.waitFor(() => expect(reports).toHaveLength(1));
    await handle.stop();
    expect(reports[0]!.aggregateState).toBe("green");
  });
});

// ── Driver REGISTRY: dispatch by payload.driverKind ────────────────────────

describe("driver registry (driverKind → driver)", () => {
  const baseRegistryDeps = (drivers: DriverRegistry) => ({
    workerId: "worker-test",
    queue: makeQueue([]),
    drivers,
    logger: silentLogger,
    env: {} as Readonly<Record<string, string | undefined>>,
    now: () => new Date("2026-06-04T00:04:00.000Z"),
    sleep: async () => {},
  });

  /** A driver fake that tags its aggregate row with the kind it represents. */
  function makeTaggingDriver(kind: string): ServiceJobDriver {
    return {
      async run(ctx, _input): Promise<ProbeResult> {
        const observedAt = ctx.now().toISOString();
        return {
          key: `${kind}:routed`,
          state: "green",
          signal: { routedKind: kind },
          observedAt,
        };
      },
    };
  }

  function entry(kind: string): DriverRegistryEntry {
    return { driver: makeTaggingDriver(kind), payloadToInput: passInput };
  }

  function registry(...kinds: DriverKind[]): DriverRegistry {
    const m = new Map<DriverKind, DriverRegistryEntry>();
    for (const k of kinds) m.set(k, entry(k));
    return m;
  }

  it("routes an e2e_smoke payload to the smoke driver", async () => {
    const drivers = registry("e2e_d6", "e2e_deep", "e2e_smoke", "e2e_demos");
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_smoke" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.aggregateState).toBe("green");
    expect(result.aggregateKey).toBe("e2e_smoke:routed");
    expect(result.aggregateSignal).toMatchObject({ routedKind: "e2e_smoke" });
    expect(result.commError).toBeUndefined();
  });

  it("routes an e2e_deep payload to the deep driver", async () => {
    const drivers = registry("e2e_d6", "e2e_deep", "e2e_smoke", "e2e_demos");
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_deep" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.aggregateKey).toBe("e2e_deep:routed");
    expect(result.aggregateSignal).toMatchObject({ routedKind: "e2e_deep" });
    expect(result.commError).toBeUndefined();
  });

  it("routes an e2e_d6 payload to the d6 driver (equivalence)", async () => {
    const drivers = registry("e2e_d6", "e2e_deep", "e2e_smoke", "e2e_demos");
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_d6" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.aggregateKey).toBe("e2e_d6:routed");
    expect(result.aggregateSignal).toMatchObject({ routedKind: "e2e_d6" });
    expect(result.commError).toBeUndefined();
  });

  it("maps an unknown driverKind to a worker-protocol-violation terminal result", async () => {
    const drivers = registry("e2e_d6", "e2e_deep");
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_unknown" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.aggregateState).toBe("error");
    expect(result.commError?.kind).toBe("worker-protocol-violation");
    expect(result.commError?.message).toContain("e2e_unknown");
  });

  it("uses the matched kind's OWN payloadToInput, not a sibling's", async () => {
    // Each entry carries its own mapper; the matched kind's mapper must run.
    const seen: string[] = [];
    const drivers = new Map<DriverKind, DriverRegistryEntry>([
      [
        "e2e_d6",
        {
          driver: makeTaggingDriver("e2e_d6"),
          payloadToInput: (p) => {
            seen.push(`d6:${p.serviceSlug}`);
            return passInput();
          },
        },
      ],
      [
        "e2e_smoke",
        {
          driver: makeTaggingDriver("e2e_smoke"),
          payloadToInput: (p) => {
            seen.push(`smoke:${p.serviceSlug}`);
            return passInput();
          },
        },
      ],
    ]);
    await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_smoke" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(seen).toEqual(["smoke:langgraph-python"]);
  });

  /**
   * A driver that writes one per-cell row (`<scheme>:<slug>/<feature>`) AND one
   * aggregate SIDE row (`<scheme>:<slug>`). The loop must filter the aggregate
   * side row out of captured cells using the entry's `aggregateSlugKey` builder.
   */
  function makeSchemeDriver(scheme: string, slug: string): ServiceJobDriver {
    return {
      async run(ctx, _input): Promise<ProbeResult> {
        const observedAt = ctx.now().toISOString();
        await ctx.writer.write({
          key: `${scheme}:${slug}/feat-1`,
          state: "green",
          signal: { featureType: "feat-1" },
          observedAt,
        });
        // Aggregate side row under the custom scheme — must be filtered.
        await ctx.writer.write({
          key: `${scheme}:${slug}`,
          state: "green",
          signal: { shape: "package", slug },
          observedAt,
        });
        return {
          key: `${scheme}:${slug}`,
          state: "green",
          signal: { shape: "package", slug },
          observedAt,
        };
      },
    };
  }

  it("honors a custom aggregateSlugKey builder when filtering captured cells", async () => {
    // The entry's aggregate scheme is `custom:` (not d6), so the aggregate side
    // row is `custom:<slug>` and must be filtered; the per-cell row is kept.
    const drivers = new Map<DriverKind, DriverRegistryEntry>([
      [
        "e2e_deep",
        {
          driver: makeSchemeDriver("custom", "langgraph-python"),
          payloadToInput: passInput,
          aggregateSlugKey: (serviceSlug) => `custom:${serviceSlug}`,
        },
      ],
    ]);
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_deep" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    // Exactly the per-cell row is captured; the `custom:<slug>` aggregate side
    // row was filtered (NOT counted as a cell).
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]!.cellKey).toBe("custom:langgraph-python/feat-1");
    expect(result.commError).toBeUndefined();
  });

  it("defaults to the d6 `d6:<slug>` aggregate filter when an entry omits aggregateSlugKey", async () => {
    // No `aggregateSlugKey` on the entry → the loop defaults to `d6:<slug>`.
    // The driver emits a `d6:<slug>` aggregate side row, which must be filtered.
    const drivers = new Map<DriverKind, DriverRegistryEntry>([
      [
        "e2e_d6",
        {
          driver: makeSchemeDriver("d6", "langgraph-python"),
          payloadToInput: passInput,
        },
      ],
    ]);
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_d6" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]!.cellKey).toBe("d6:langgraph-python/feat-1");
    expect(result.commError).toBeUndefined();
  });

  it("startWorkerLoop dispatches a claimed job by driverKind through the registry", async () => {
    const drivers = registry("e2e_d6", "e2e_deep", "e2e_smoke", "e2e_demos");
    const queue = makeQueue([
      {
        claimed: true,
        lease: makeLease({ payload: { driverKind: "e2e_deep" } }),
      },
    ]);
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      drivers,
      logger: silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    await handle.stop();
    expect(queue.reports[0]!.aggregateKey).toBe("e2e_deep:routed");
  });
});
