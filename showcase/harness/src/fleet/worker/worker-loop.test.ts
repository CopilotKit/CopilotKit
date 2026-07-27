import { describe, it, expect, vi, afterEach } from "vitest";
import {
  startWorkerLoop,
  runClaimedJob,
  computeRollup,
  buildServiceJobResult,
  buildCommErrorResult,
  DEFAULT_WORKER_DRAIN_GRACE_MS,
  // The deregister cap that precedes the drain grace in `drainFleetWorker`'s
  // SERIAL budget — used by the composed-budget pin below.
  DRAIN_DEREGISTER_TIMEOUT_MS,
  // The platform SIGTERM→SIGKILL window the composed drain budget must fit
  // under — the documented requirement layer-(c)/C3 must satisfy on Railway
  // (`terminationGracePeriodSeconds`). B5 owns the relation T + deregister < this.
  PLATFORM_STOP_GRACE_MS,
} from "./worker-loop.js";
import type {
  ServiceJobDriver,
  ServiceDriverContext,
  BudgetSource,
  DriverRegistry,
  DriverRegistryEntry,
  WorkerLoopHandle,
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

/**
 * A sleep that HONORS its `ms` argument (vs `yieldingSleep`, which collapses
 * every sleep to `setTimeout(0)`). Required by fake-clock tests that step a
 * LARGE span (e.g. B5's 90s default grace): a 0ms-yielding heartbeat sleep
 * would re-arm thousands of times inside that span and make
 * `advanceTimersByTimeAsync` runaway, whereas honoring `heartbeatMs` keeps the
 * heartbeat quiet across the window so only the bounded grace timer is crossed.
 */
function clockHonoringSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
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
        // The d6 AGGREGATE row key `d6:<slug>` — the fleet contract forbids an
        // `e2e_d6:<slug>` row on the fleet path (see ServiceJobResult
        // .aggregateKey), and the comm-error/driver-error paths in this file
        // pin `d6:<slug>`; the success path must pin the SAME key form so a
        // success≠error key drift can't hide.
        key: `d6:${args.slug}`,
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
    async countPendingForFamily(): Promise<number> {
      throw new Error("countPendingForFamily not used by worker");
    },
    async pruneAged() {
      return { terminal: 0, zombie: 0 };
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
      key: "d6:langgraph-python",
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
    expect(result.aggregateKey).toBe("d6:langgraph-python");
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
      key: "d6:langgraph-python",
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
    expect(result.aggregateKey).toBe("d6:langgraph-python");
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

  it("a rejecting injected sleep breaks the heartbeat but never rejects runClaimedJob (never-throws contract)", async () => {
    // The heartbeat IIFE awaits `deps.sleep` — if that await sits OUTSIDE the
    // heartbeat's try/catch, a rejecting sleep rejects the heartbeat promise,
    // which escapes runClaimedJob's `await heartbeat` finally and rejects the
    // LOOP's done-promise (silent worker death). A sleep rejection must break
    // the heartbeat like a renew failure instead; the run's own result is
    // still computed and returned.
    const queue = makeQueue([]);
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
    });
    const result = await runClaimedJob(
      {
        workerId: "worker-test",
        queue,
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: async () => {
          throw new Error("timer subsystem down");
        },
      },
      makeLease(),
      // A tiny heartbeatMs so the (rejecting) sleep is exercised immediately.
      { leaseSeconds: 300, heartbeatMs: 1 },
    );
    expect(result.aggregateState).toBe("green");
    expect(result.commError).toBeUndefined();
  });

  it("stops renewing the lease as soon as the drain signal fires (abandoned lease must lapse for the sweeper)", async () => {
    // A2: once drain() fires the in-flight job is ABANDONED — the loop will
    // never report it, and the whole abandon design relies on the lease
    // LAPSING so the sweeper re-queues the job neutral-gray. A heartbeat that
    // keeps renewing while a wedged run ignores its abort would keep the
    // abandoned lease alive indefinitely. The heartbeat must observe the
    // drain signal and stop renewing the moment it fires.
    const queue = makeQueue([]);
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    let releaseFn!: () => void;
    const released = new Promise<void>((res) => {
      releaseFn = res;
    });
    // Wedged driver: IGNORES the abort signal, never settles until released.
    const driver: ServiceJobDriver = {
      async run(ctx): Promise<ProbeResult> {
        markStarted();
        await released;
        return {
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const drain = new AbortController();
    const resultPromise = runClaimedJob(
      {
        workerId: "worker-test",
        queue,
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
      },
      makeLease(),
      // Short heartbeat so renews fire on every macrotask tick.
      { leaseSeconds: 300, heartbeatMs: 1 },
      drain.signal,
    );

    await started;
    // The heartbeat is live: at least one renew lands while the run is wedged.
    await vi.waitFor(() => expect(queue.renewCalls).toBeGreaterThanOrEqual(1));

    // DRAIN: fire the signal mid-run. Let any already-in-flight heartbeat
    // iteration settle, then snapshot the renew count.
    drain.abort();
    await new Promise((r) => setTimeout(r, 0));
    const renewsAtDrain = queue.renewCalls;

    // Advance time (several macrotask ticks — each would have renewed before
    // the fix): ZERO further renewLease calls may land after the drain.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(queue.renewCalls).toBe(renewsAtDrain);

    // Un-wedge the driver so the run settles and the job-runner returns.
    releaseFn();
    const result = await resultPromise;
    expect(result.aggregateState).toBe("green");
  });

  it("entered with an ALREADY-aborted drain signal: never renews the lease and hands the run aborted drain semantics", async () => {
    // The drain can fire between the loop winning a claim and runClaimedJob
    // entry. `addEventListener("abort", ...)` on an ALREADY-aborted signal
    // never fires, so the heartbeat must be aborted AT ENTRY: zero renewLease
    // round-trips may land (the abandoned lease must lapse for the sweeper),
    // and the driver sees `abortSignal.aborted` + drainReason "shutdown" (the
    // loop's report-skip then drops whatever the run returns).
    const queue = makeQueue([]);
    const drain = new AbortController();
    drain.abort();
    let seen: { aborted: boolean; drainReason: string | undefined } | undefined;
    const driver: ServiceJobDriver = {
      async run(ctx): Promise<ProbeResult> {
        seen = {
          aborted: ctx.abortSignal?.aborted ?? false,
          drainReason: ctx.drainReason,
        };
        // Spin several macrotasks: absent the at-entry heartbeat abort, the
        // tiny heartbeatMs below would land renews during this window.
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 0));
        }
        return {
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const result = await runClaimedJob(
      {
        workerId: "worker-test",
        queue,
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
      },
      makeLease(),
      { leaseSeconds: 300, heartbeatMs: 1 },
      drain.signal,
    );

    expect(queue.renewCalls).toBe(0);
    expect(seen).toEqual({ aborted: true, drainReason: "shutdown" });
    // runClaimedJob still returns the settled result — the LOOP's
    // signal-keyed report-skip is what abandons it, not the job runner.
    expect(result.aggregateState).toBe("green");
  });

  // ── B3: lease renewal must track the GRACE-EXPIRY signal, not drain-start ──
  //
  // Layer (b) decoupled "stop claiming" (drain) from "abort the run"
  // (grace-expiry / `runAbort`). A run that is FINISHING after drain() must keep
  // its lease RENEWING until it reports terminal, or the layer-(a) reaper could
  // reclaim the row out from under the worker mid-finish (double-run /
  // report-after-reclaim). Conversely a genuinely-abandoned run (aborted at
  // grace-expiry, `runAbortSignal` fired) MUST stop renewing so its lease lapses
  // and the reaper can reclaim it. These two tests pin both halves of that split
  // by passing the drain and grace-expiry signals SEPARATELY.

  it("B3: keeps renewing the lease for a FINISHING run after drain() (lease must NOT lapse so the reaper cannot steal it)", async () => {
    // A run that was seconds from done when SIGTERM landed: drain() fires but the
    // run is NOT aborted (its grace-expiry signal `runAbort` has NOT fired). The
    // heartbeat must KEEP renewing across the whole finish window so the lease
    // never lapses and the row stays un-reclaimable until the run reports.
    const queue = makeQueue([]);
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    let releaseFn!: () => void;
    const released = new Promise<void>((res) => {
      releaseFn = res;
    });
    // Finishing driver: honors NOTHING until released (simulating a run that is
    // mid-finish across the drain window). It does NOT observe runAbort because
    // runAbort never fires in this scenario (it is finishing, not abandoned).
    const driver: ServiceJobDriver = {
      async run(ctx): Promise<ProbeResult> {
        markStarted();
        await released;
        return {
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const drain = new AbortController();
    const runAbort = new AbortController();
    const resultPromise = runClaimedJob(
      {
        workerId: "worker-test",
        queue,
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
      },
      makeLease(),
      // Short heartbeat so renews fire on every macrotask tick.
      { leaseSeconds: 300, heartbeatMs: 1 },
      drain.signal,
      runAbort.signal,
    );

    await started;
    await vi.waitFor(() => expect(queue.renewCalls).toBeGreaterThanOrEqual(1));

    // DRAIN fires (SIGTERM) — but the run is FINISHING, so runAbort does NOT
    // fire. Snapshot the renew count just after drain.
    drain.abort();
    await new Promise((r) => setTimeout(r, 0));
    const renewsAtDrain = queue.renewCalls;

    // Advance several macrotask ticks across the finish window. The heartbeat
    // MUST keep renewing — the lease cannot lapse while the run is finishing.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(queue.renewCalls).toBeGreaterThan(renewsAtDrain);

    // Let the run settle and report terminal.
    releaseFn();
    const result = await resultPromise;
    expect(result.aggregateState).toBe("green");
  });

  it("B3 inverse: STOPS renewing the lease once the run is ABANDONED at grace-expiry (lease must lapse so the reaper reclaims it)", async () => {
    // The over-budget abandon path: drain() fired AND the grace window expired,
    // so stop() fires `runAbort`. A run that ignores its abort would otherwise
    // hold the abandoned lease alive forever. The heartbeat MUST stop renewing
    // the moment the grace-expiry (`runAbort`) signal fires so the lease lapses
    // and the layer-(a) reaper can reclaim the orphaned row.
    const queue = makeQueue([]);
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    let releaseFn!: () => void;
    const released = new Promise<void>((res) => {
      releaseFn = res;
    });
    // Wedged driver: IGNORES its abort signal, never settles until released.
    const driver: ServiceJobDriver = {
      async run(ctx): Promise<ProbeResult> {
        markStarted();
        await released;
        return {
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const drain = new AbortController();
    const runAbort = new AbortController();
    const resultPromise = runClaimedJob(
      {
        workerId: "worker-test",
        queue,
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: yieldingSleep(),
      },
      makeLease(),
      { leaseSeconds: 300, heartbeatMs: 1 },
      drain.signal,
      runAbort.signal,
    );

    await started;
    await vi.waitFor(() => expect(queue.renewCalls).toBeGreaterThanOrEqual(1));

    // Grace expired: drain() fired earlier, now stop() hard-cancels via runAbort.
    drain.abort();
    runAbort.abort();
    await new Promise((r) => setTimeout(r, 0));
    const renewsAtAbort = queue.renewCalls;

    // Advance several macrotask ticks: ZERO further renews may land after the
    // grace-expiry abort — the abandoned lease must lapse for the sweeper.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(queue.renewCalls).toBe(renewsAtAbort);

    releaseFn();
    const result = await resultPromise;
    expect(result.aggregateState).toBe("green");
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

  it("survives a rejecting idle-poll sleep: logs fleet.worker.sleep-failed and continues claiming (done does not reject)", async () => {
    // The heartbeat's sleep already has rejecting-sleep hardening — the
    // loop's OWN idle/poll points must too: a bare `await sleep(...)` there
    // rejects the loop's done-promise (silent worker death). A sleep
    // rejection is logged and treated as the interval having elapsed; the
    // drain/stop signal still governs exit.
    const queue = makeQueue([
      // Nothing claimable first → forces an idle-poll sleep (the one that
      // rejects), then a real claim proves the loop kept pulling.
      { claimed: false },
      { claimed: true, lease: makeLease() },
    ]);
    const warn = vi.fn();
    const base = yieldingSleep();
    let rejectedOnce = false;
    const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
      if (!rejectedOnce) {
        rejectedOnce = true;
        throw new Error("timer subsystem down");
      }
      return base(ms, signal);
    };
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
      logger: { ...silentLogger, warn },
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep,
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    // The loop survived the rejecting sleep and claimed + reported the job.
    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    expect(warn).toHaveBeenCalledWith(
      "fleet.worker.sleep-failed",
      expect.objectContaining({
        workerId: "worker-test",
        err: "timer subsystem down",
      }),
    );
    await handle.stop();
    await expect(handle.done).resolves.toBeUndefined();
  });

  it("PERSISTENT sleep rejections degrade to interval pacing, not a microtask busy loop (claims bounded by the poll interval)", async () => {
    // Treating a rejected sleep as "interval elapsed" is right for a one-off —
    // but a PERSISTENTLY rejecting injected/platform sleep would degrade the
    // idle loop into a microtask-speed busy loop hammering pool.budget() /
    // claimNext. After logging, the loop must fall back to a raw timer wait
    // (which cannot reject), keeping claim attempts paced at ~1 per interval.
    vi.useFakeTimers();
    try {
      let claims = 0;
      let handle: WorkerLoopHandle | undefined;
      const queueBase = makeQueue([]);
      const queue: FleetQueueClient = {
        ...queueBase,
        async claimNext(): Promise<ClaimedJob> {
          claims++;
          // SPIN GUARD: the busy-loop regression never touches the timer
          // queue, so the fake-timer advances below would starve forever —
          // bound it by draining the loop at 50 claims so the regression
          // FAILS on the pacing assertion instead of hanging the test.
          if (claims >= 50) handle?.drain();
          return { claimed: false };
        },
      };
      const warn = vi.fn();
      handle = startWorkerLoop({
        workerId: "worker-test",
        queue,
        pool: budgetWith(5),
        driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
        payloadToInput: passInput,
        logger: { ...silentLogger, warn },
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        sleep: async () => {
          throw new Error("timer subsystem down");
        },
        pollIntervalMs: 1_000,
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      // Boot microtasks: one claim attempt lands, then the loop parks in the
      // raw fallback wait until the interval timer fires.
      await vi.advanceTimersByTimeAsync(0);
      const bootClaims = claims;
      expect(bootClaims).toBeGreaterThanOrEqual(1);
      expect(bootClaims).toBeLessThanOrEqual(2);

      // 10 poll intervals → ~10 more claims, NOT hundreds (the busy-loop
      // regression blows through the 50-claim spin guard immediately).
      await vi.advanceTimersByTimeAsync(10_000);
      expect(claims).toBeGreaterThanOrEqual(bootClaims + 9);
      expect(claims).toBeLessThanOrEqual(bootClaims + 11);
      expect(warn).toHaveBeenCalledWith(
        "fleet.worker.sleep-failed",
        expect.objectContaining({ err: "timer subsystem down" }),
      );

      // The raw fallback wait stays abort-responsive: drain exits the loop
      // without waiting out the pending interval.
      handle.drain();
      await vi.advanceTimersByTimeAsync(0);
      await handle.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the grace timer even when the loop's done-promise REJECTS (the rejection still propagates from stop())", async () => {
    // stop()'s grace race awaits `done` — a crashed loop makes that a
    // REJECTED promise, so the race throws. The `clearTimeout(graceTimer)`
    // must sit in a finally: on the reject path a trailing clearTimeout is
    // skipped and the grace timer leaks. The rejection itself still
    // propagates to the caller (the fleet wrapper closes the health server /
    // pool around it).
    //
    // CRASH VECTOR: with every IIFE log guarded (`safeLog`), a throwing
    // logger no longer rejects done — the residual seam is a structurally
    // POISON queue result whose `.claimed` getter throws outside the
    // claimNext try/catch.
    const queueBase = makeQueue([]);
    const queue: FleetQueueClient = {
      ...queueBase,
      async claimNext(): Promise<ClaimedJob> {
        return {
          get claimed(): boolean {
            throw new Error("poison claim");
          },
        } as ClaimedJob;
      },
    };
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
      payloadToInput: passInput,
      logger: silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    // The first claim crashes the loop before any sleep is ever taken.
    await expect(handle.done).rejects.toThrow("poison claim");

    // Fake timers AFTER the loop has crashed: the only timer stop() can set
    // is its own grace timer, so a zero pending-timer count proves it was
    // cleared on the reject path (pre-fix: 1 leaked timer).
    vi.useFakeTimers();
    try {
      await expect(handle.stop()).rejects.toThrow("poison claim");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a throwing logger on an IIFE log (fleet.worker.claimed) neither rejects done nor skips the report (guarded logs)", async () => {
    // CLASS-LEVEL GUARD (`safeLog`): on this path the failing component IS
    // the logger. Pre-guard, this exact vector crashed the loop — done
    // rejected and the claimed job was never reported, a silent worker death
    // caused by FORENSICS. The log lines are best-effort; the loop is
    // load-bearing: the job must still run and report, and stop() must
    // resolve cleanly (done never rejected).
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const logger: Logger = {
      ...silentLogger,
      info: (msg) => {
        if (msg === "fleet.worker.claimed") {
          throw new Error("logger exploded mid-claim");
        }
      },
    };
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver: makeDriver({
        slug: "langgraph-python",
        cells: [{ featureId: "shared-state", state: "green" }],
        aggregateState: "green",
      }),
      payloadToInput: passInput,
      logger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    // The job still ran and was REPORTED despite the throwing claim log…
    await vi.waitFor(() => expect(queue.reports).toHaveLength(1));
    expect(queue.reports[0]!.aggregateState).toBe("green");
    // …and done never rejected: stop() resolves cleanly.
    await handle.stop();
  });

  // ── Graceful drain (FIX 3): stop() aborts the in-flight driver run ─────────

  /**
   * A driver fake that BLOCKS until `ctx.abortSignal` fires (mirroring a
   * long-lived d6 browser run that observes the external abort). It captures the
   * ctx it was handed so the test can assert the loop populated `abortSignal` +
   * `drainReason`. On abort it behaves like the real d6 per-feature abort branch:
   * it would side-emit a red `errorClass: "abort"` cell — UNLESS
   * `ctx.drainReason === "shutdown"`, in which case it SUPPRESSES that emit
   * (the real driver-side suppression this test stands in for).
   */
  function makeBlockingDrainDriver(): {
    driver: ServiceJobDriver;
    seenCtx: () => ServiceDriverContext | undefined;
    started: Promise<void>;
    /** Every cell the driver actually WROTE through `ctx.writer.write`. */
    written: ProbeResult[];
  } {
    let captured: ServiceDriverContext | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    const written: ProbeResult[] = [];
    const driver: ServiceJobDriver = {
      async run(ctx, _input): Promise<ProbeResult> {
        captured = ctx;
        markStarted();
        // Wait for the external (drain) abort.
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        const observedAt = ctx.now().toISOString();
        // Real-d6-like per-feature abort emit, suppressed on drain.
        if (ctx.drainReason !== "shutdown") {
          const redAbortCell: ProbeResult = {
            key: "d6:langgraph-python/shared-state",
            state: "red",
            signal: { featureType: "shared-state", errorClass: "abort" },
            observedAt,
          };
          written.push(redAbortCell);
          await ctx.writer.write(redAbortCell);
        }
        return {
          key: "d6:langgraph-python",
          state: "red",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt,
        };
      },
    };
    return { driver, seenCtx: () => captured, started, written };
  }

  it("stop() aborts a WEDGED in-flight run at grace-expiry (ctx.abortSignal fires) and resolves bounded", async () => {
    // Layer (b): the run's `ctx.abortSignal` is the GRACE-EXPIRY signal, not the
    // drain signal — so a run that IGNORES the drain (this blocking driver waits
    // on abortSignal, i.e. it never finishes on its own) is cut only when the
    // grace window closes. Pin a SHORT grace so the test exercises the
    // grace-expiry abort promptly. stop() must still resolve bounded.
    const prev = process.env.WORKER_DRAIN_GRACE_MS;
    process.env.WORKER_DRAIN_GRACE_MS = "50";
    try {
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      const { driver, seenCtx, started } = makeBlockingDrainDriver();
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
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      // Wait until the driver is actually running (claimed + in run()).
      await started;
      const ctx = seenCtx();
      expect(ctx).toBeDefined();
      // The loop threads the grace-expiry signal into ctx.abortSignal, un-fired
      // until the grace window closes.
      expect(ctx!.abortSignal).toBeDefined();
      expect(ctx!.abortSignal!.aborted).toBe(false);

      // stop() must abort the wedged run at grace-expiry and resolve promptly
      // (bounded), not hang on the driver's full timeout. A 1s budget proves it
      // doesn't block.
      await expect(
        Promise.race([
          handle.stop(),
          new Promise<never>((_res, rej) =>
            setTimeout(
              () => rej(new Error("stop() did not resolve bounded")),
              1000,
            ),
          ),
        ]),
      ).resolves.toBeUndefined();
      expect(ctx!.abortSignal!.aborted).toBe(true);
      expect(ctx!.drainReason).toBe("shutdown");
    } finally {
      if (prev === undefined) delete process.env.WORKER_DRAIN_GRACE_MS;
      else process.env.WORKER_DRAIN_GRACE_MS = prev;
    }
  });

  it("drain does NOT emit red cells for not-yet-run pills (drainReason suppresses)", async () => {
    // Layer (b): a run that ignores the drain is aborted only at grace-expiry,
    // so pin a SHORT grace to exercise the abort promptly. On that abort the
    // driver would emit a red `errorClass: "abort"` cell UNLESS drainReason is
    // "shutdown" (the suppression this test pins). The aborted run produces no
    // usable result → it abandons (no report). (B4 re-scopes suppression to
    // aborted-only; this test's drain-abort surface stays valid under B2.)
    const prev = process.env.WORKER_DRAIN_GRACE_MS;
    process.env.WORKER_DRAIN_GRACE_MS = "50";
    try {
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      const { driver, started, written } = makeBlockingDrainDriver();
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
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      await started;
      await handle.stop();
      // The suppression's REAL surface is the WRITE side: on a drain the driver
      // must never WRITE a red `errorClass: "abort"` cell at all. (Asserting on
      // `queue.reports` alone is vacuous here — the aborted run skips the report,
      // so reports stay empty whether or not the red cell was written.)
      const writtenRedAbort = written.filter(
        (c) =>
          c.state === "red" &&
          (c.signal as { errorClass?: string })?.errorClass === "abort",
      );
      expect(writtenRedAbort).toEqual([]);
      // The abort produced no usable result → abandoned, nothing reported.
      expect(queue.reports).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.WORKER_DRAIN_GRACE_MS;
      else process.env.WORKER_DRAIN_GRACE_MS = prev;
    }
  });

  it("drain does NOT report an ABORTED in-flight job (no usable result → lease lapses → sweeper re-queues neutral-gray)", async () => {
    // Layer (b): the abandon decision is `abortedWithoutResult`. This blocking
    // driver IGNORES the drain and only unblocks on its abortSignal — i.e. it
    // never produces a usable result on its own and is cut at grace-expiry
    // (pin a SHORT grace to exercise it). With no usable result the loop
    // abandons: no report; the lease lapses and `sweepExpired` re-queues it
    // neutral-gray (a reported partial would paint red — terminalJobStatus maps
    // any non-green aggregate to failed). A run that FINISHES within grace is
    // the inverse case (reported) — see the finish-and-report tests.
    const prev = process.env.WORKER_DRAIN_GRACE_MS;
    process.env.WORKER_DRAIN_GRACE_MS = "50";
    try {
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      const reportSpy = vi.spyOn(queue, "report");
      const { driver, started } = makeBlockingDrainDriver();
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
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      await started;
      await handle.stop();
      expect(reportSpy).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.WORKER_DRAIN_GRACE_MS;
      else process.env.WORKER_DRAIN_GRACE_MS = prev;
    }
  });

  it("drain lets an ALREADY-COMPLETING run finish and REPORTS it (not abandon)", async () => {
    // LAYER (b) — graceful drain finish-and-report. A job that was SECONDS from
    // done when SIGTERM landed must FINISH and have its terminal result
    // REPORTED, not abandoned to the sweeper. This driver does NOT abort on the
    // drain signal — it RESOLVES GREEN under its own steam shortly after drain
    // fires (within the grace window), simulating a run that completes between
    // SIGTERM and SIGKILL. On the CURRENT code the in-flight run is aborted
    // (drainSignal IS the run's abortSignal) AND the abandon `break` is
    // unconditional, so the completed green result is discarded and `report` is
    // never called → this test is RED. After the B2 fix (decouple drain from
    // run-abort + conditional abandon) the run finishes and falls through to
    // the report path → GREEN.
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const reportSpy = vi.spyOn(queue, "report");

    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    // The test releases the run to COMPLETE (green) — NOT via abort. The driver
    // ignores the abort signal entirely (a run that is about to finish does not
    // honor a late drain abort).
    let releaseComplete!: () => void;
    const completeGate = new Promise<void>((res) => {
      releaseComplete = res;
    });
    const driver: ServiceJobDriver = {
      async run(ctx, _input): Promise<ProbeResult> {
        markStarted();
        await completeGate;
        const observedAt = ctx.now().toISOString();
        await ctx.writer.write({
          key: "d6:langgraph-python/shared-state",
          state: "green",
          signal: { featureType: "shared-state" },
          observedAt,
        });
        await ctx.writer.write({
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt,
        });
        return {
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt,
        };
      },
    };

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
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    await started;
    // SIGTERM lands: stop claiming new work. The in-flight run must NOT be
    // aborted — it is about to finish.
    handle.drain();
    // The run completes green a moment later (well within the grace window).
    releaseComplete();
    await handle.done;

    // The completed terminal result MUST be reported (finish-and-report), not
    // discarded for the sweeper.
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(queue.reports).toHaveLength(1);
    expect(queue.reports[0]!.aggregateState).toBe("green");
    expect(queue.reports[0]!.jobId).toBe("job-1");
  });

  it("SAME-TURN race: a run that resolves green in the very flush the grace timer fires is REPORTED, not spuriously abandoned (TOCTOU regression pin)", async () => {
    // CONTESTED TOCTOU (crb2 vs crb6), reconciled here empirically. The abandon
    // discriminator `abortedWithoutResult = runAbort.signal.aborted` is read in
    // the loop AFTER `runClaimedJob` returns; `runAbort.abort()` only fires in
    // stop()'s `Promise.race` TIMEOUT leg. crb2 feared a finished run could be
    // abandoned if its resolution and the grace `setTimeout` came due in the
    // same flush; crb6 argued single-threaded Promise.race ordering keeps it
    // safe (the run resolves `done` first, so the timeout leg never wins and
    // runAbort never fires).
    //
    // This forces the exact contention: the driver completes via a timer with
    // the SAME delay as the grace window, so ONE `advanceTimersByTimeAsync`
    // makes BOTH the run-completion timer AND the grace timer due together.
    // Observed outcome (crb6 correct): the loop's report path resolves `done`,
    // Promise.race picks "done" over "timeout", runAbort never aborts, and the
    // run is REPORTED. This pin guards that ordering against regression — if a
    // future change flipped the race to abort a same-turn finisher, the report
    // assertion below would go RED.
    vi.useFakeTimers();
    const prev = process.env.WORKER_DRAIN_GRACE_MS;
    process.env.WORKER_DRAIN_GRACE_MS = "50";
    try {
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      const reportSpy = vi.spyOn(queue, "report");

      let markStarted!: () => void;
      const started = new Promise<void>((res) => {
        markStarted = res;
      });
      // The driver IGNORES its abort signal and completes green via its OWN
      // timer pinned to the grace delay (50ms) — so the run-resolution and the
      // grace-expiry timer fall due in the same fake-clock advance.
      const driver: ServiceJobDriver = {
        async run(ctx, _input): Promise<ProbeResult> {
          markStarted();
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          const observedAt = ctx.now().toISOString();
          await ctx.writer.write({
            key: "d6:langgraph-python/shared-state",
            state: "green",
            signal: { featureType: "shared-state" },
            observedAt,
          });
          return {
            key: "d6:langgraph-python",
            state: "green",
            signal: { shape: "package", slug: "langgraph-python" },
            observedAt,
          };
        },
      };

      const handle = startWorkerLoop({
        workerId: "worker-test",
        queue,
        pool: budgetWith(5),
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        // Honor the ms so the 50ms run-completion timer is not collapsed to 0
        // and the heartbeat (1e6 ms) stays quiet across the advance.
        sleep: clockHonoringSleep,
        pollIntervalMs: 1,
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      // Let the loop claim + enter the driver (its completion timer is now
      // armed at +50ms).
      await vi.advanceTimersByTimeAsync(0);
      await started;

      // SIGTERM: stop claiming. stop() arms its OWN grace timer at +50ms — the
      // same instant the run completes. Do NOT await stop() yet (it would block
      // on the advance below).
      handle.drain();
      const stopped = handle.stop();

      // ONE advance brings BOTH timers due in the same flush — the same-turn
      // race crb2/crb6 disagreed on.
      await vi.advanceTimersByTimeAsync(50);
      await stopped;
      await handle.done;

      // VERDICT (crb6 correct): the finished run is REPORTED, never abandoned.
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(queue.reports).toHaveLength(1);
      expect(queue.reports[0]!.aggregateState).toBe("green");
      expect(queue.reports[0]!.jobId).toBe("job-1");
    } finally {
      if (prev === undefined) delete process.env.WORKER_DRAIN_GRACE_MS;
      else process.env.WORKER_DRAIN_GRACE_MS = prev;
      vi.useRealTimers();
    }
  });

  it("ctx.drainReason is undefined while the drain signal has NOT fired and becomes 'shutdown' after stop()", async () => {
    // `drainReason` means "the EXTERNAL drain signal FIRED", not "a drain
    // signal exists". In fleet production every ctx carries the worker's
    // stopAbort signal, so a statically-stamped "shutdown" would mislabel the
    // driver's own wall-clock timeout abort as a graceful drain and suppress
    // its red cells. The ctx must therefore expose drainReason LIVE: undefined
    // until the signal fires, "shutdown" after.
    let reasonAtStart: "shutdown" | undefined;
    let reasonAfterAbort: "shutdown" | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    const driver: ServiceJobDriver = {
      async run(ctx, _input): Promise<ProbeResult> {
        reasonAtStart = ctx.drainReason;
        markStarted();
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        reasonAfterAbort = ctx.drainReason;
        return {
          key: "d6:langgraph-python",
          state: "red",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    // Layer (b): the run's abortSignal is the grace-expiry signal; this driver
    // blocks on it, so pin a SHORT grace to unblock the run promptly. drainReason
    // (a live getter on the separate drain signal) still flips to "shutdown" once
    // drain fires — which is what this test pins.
    const prev = process.env.WORKER_DRAIN_GRACE_MS;
    process.env.WORKER_DRAIN_GRACE_MS = "50";
    try {
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
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });

      await started;
      // Before stop(): the drain signal exists but has NOT fired — a timeout
      // abort at this point is a genuine failure, so drainReason must be unset.
      expect(reasonAtStart).toBeUndefined();
      await handle.stop();
      // After stop(): the drain signal fired — the abort IS a graceful drain.
      expect(reasonAfterAbort).toBe("shutdown");
    } finally {
      if (prev === undefined) delete process.env.WORKER_DRAIN_GRACE_MS;
      else process.env.WORKER_DRAIN_GRACE_MS = prev;
    }
  });
});

// ── drain(): deregister-FIRST drain request (platform-kill hardening) ───────
//
// Railway SIGKILLs ~10s after SIGTERM (live-verified) — a drain whose roster
// deregister waits behind slow browser-context teardown gets HARD-KILLED
// before the delete ever runs, stranding a stale roster row that fleet-health
// reclaims red at its 180s stale mark. The handle therefore exposes a SYNCHRONOUS
// `drain()` that fires the abort + records the abandon decision WITHOUT
// awaiting the run, so the caller can deregister immediately and spend the
// grace budget on best-effort teardown afterwards (`stop()`).
describe("WorkerLoopHandle.drain() — deregister-first drain request", () => {
  /**
   * A driver fake whose run HANGS until `release()` is called and IGNORES the
   * drain abort entirely — the stand-in for a wedged browser-context teardown
   * that outlives the drain signal. Resolves GREEN on release so the
   * never-report assertion covers the worst case (a run that "completes"
   * successfully after the abandon decision).
   */
  function makeWedgedDriver(): {
    driver: ServiceJobDriver;
    seenCtx: () => ServiceDriverContext | undefined;
    started: Promise<void>;
    release: () => void;
    runSettled: () => boolean;
  } {
    let captured: ServiceDriverContext | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((res) => {
      markStarted = res;
    });
    let releaseFn!: () => void;
    const released = new Promise<void>((res) => {
      releaseFn = res;
    });
    let settled = false;
    const driver: ServiceJobDriver = {
      async run(ctx, _input): Promise<ProbeResult> {
        captured = ctx;
        markStarted();
        // Deliberately IGNORE ctx.abortSignal — a wedged teardown.
        await released;
        settled = true;
        return {
          key: "d6:langgraph-python",
          state: "green",
          signal: { shape: "package", slug: "langgraph-python" },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    return {
      driver,
      seenCtx: () => captured,
      started,
      release: () => releaseFn(),
      runSettled: () => settled,
    };
  }

  function startWedgedLoop(args: {
    queue: RecordingQueue;
    driver: ServiceJobDriver;
    logger?: Logger;
  }): WorkerLoopHandle {
    return startWorkerLoop({
      workerId: "worker-test",
      queue: args.queue,
      pool: budgetWith(5),
      driver: args.driver,
      payloadToInput: passInput,
      logger: args.logger ?? silentLogger,
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
  }

  it("drain() synchronously records the drain WITHOUT aborting the in-flight run or awaiting teardown", async () => {
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const { driver, seenCtx, started, release } = makeWedgedDriver();
    const handle = startWedgedLoop({ queue, driver });

    await started;
    expect(seenCtx()!.abortSignal!.aborted).toBe(false);

    // SYNCHRONOUS: drain() returns void immediately — it must not await the
    // (wedged) run. Layer (b): drain() DECOUPLES "stop claiming" from "abort the
    // run", so the in-flight run's `ctx.abortSignal` (the grace-expiry signal)
    // is NOT fired on drain — only `drainReason` flips to "shutdown" so the
    // driver LEARNS it is draining. The hard abort comes only at grace-expiry.
    handle.drain();
    expect(seenCtx()!.abortSignal!.aborted).toBe(false);
    expect(seenCtx()!.drainReason).toBe("shutdown");

    // The loop has NOT exited (the run is wedged) — done is still pending, so
    // a caller can deregister NOW instead of behind teardown. Observe BOTH
    // arms: a rejected done would otherwise surface as an orphan unhandled
    // rejection in the test output instead of failing the assertion below.
    let doneSettled = false;
    void handle.done.then(
      () => {
        doneSettled = true;
      },
      () => {
        doneSettled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(doneSettled).toBe(false);

    release();
    await handle.stop();
  });

  it("drain() records the abandon decision (in-flight jobId) BEFORE the run settles", async () => {
    const info = vi.fn();
    const logger: Logger = { ...silentLogger, info };
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const { driver, started, release, runSettled } = makeWedgedDriver();
    const handle = startWedgedLoop({ queue, driver, logger });

    await started;
    handle.drain();
    // The abandon decision is on the record while the run is STILL in flight —
    // a caller's deregister therefore always follows a recorded decision.
    expect(runSettled()).toBe(false);
    expect(info).toHaveBeenCalledWith("fleet.worker.drain-requested", {
      workerId: "worker-test",
      abandoningJobId: "job-1",
    });

    release();
    await handle.stop();
  });

  it("drain() fires the drain (stopAbort) even when the drain-requested log THROWS (the throw never escapes)", async () => {
    // drain() is the FIRST step of drainFleetWorker's SIGTERM critical path.
    // The drain abort (`stopAbort` — stop claiming + heartbeat stop +
    // drainReason) is the load-bearing half; the log line is forensics. A
    // throwing logger must neither skip the drain nor propagate out of drain() —
    // pre-fix the log preceded the abort unguarded, so a logger throw escaped
    // drainFleetWorker BEFORE the roster delete ever ran. (Layer (b): drain no
    // longer fires the RUN's abortSignal — that is the grace-expiry signal — so
    // the observable signal that drain still fired is `drainReason: "shutdown"`.)
    const logger: Logger = {
      ...silentLogger,
      info: (msg) => {
        if (msg === "fleet.worker.drain-requested") {
          throw new Error("logger exploded on drain");
        }
      },
    };
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const { driver, seenCtx, started, release } = makeWedgedDriver();
    const handle = startWedgedLoop({ queue, driver, logger });

    await started;
    expect(seenCtx()!.drainReason).toBeUndefined();
    expect(() => handle.drain()).not.toThrow();
    // The drain fired despite the throwing log: drainReason is now "shutdown"
    // (the run's own abortSignal stays un-fired until grace-expiry).
    expect(seenCtx()!.drainReason).toBe("shutdown");
    expect(seenCtx()!.abortSignal!.aborted).toBe(false);

    release();
    await handle.stop();
  });

  it("a run that SETTLES GREEN after drain (before grace-expiry) is REPORTED (finish-and-report)", async () => {
    // LAYER (b): the report decision is keyed on `abortedWithoutResult`
    // (`runAbort` fired at grace-expiry), NOT on the drain SIGNAL. A run that
    // ignores the (now decoupled) drain and settles GREEN under its own steam
    // before the grace window closes produces a usable terminal result, so the
    // loop falls through to the report path. (Pre-(b) this was abandoned because
    // the report-skip keyed on the drain signal alone.)
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const reportSpy = vi.spyOn(queue, "report");
    const { driver, started, release } = makeWedgedDriver();
    const handle = startWedgedLoop({ queue, driver });

    await started;
    handle.drain();
    // The run completes GREEN a moment later — well within the grace window, so
    // `runAbort` never fires and the result is reported.
    release();
    await handle.done;
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(queue.reports[0]!.aggregateState).toBe("green");
  });

  it("drain() is idempotent and stop() keeps its bounded/second-caller contract", async () => {
    const info = vi.fn();
    const logger: Logger = { ...silentLogger, info };
    const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
    const { driver, started, release } = makeWedgedDriver();
    const handle = startWedgedLoop({ queue, driver, logger });

    await started;
    handle.drain();
    handle.drain(); // second drain: no-op, no double log
    expect(
      info.mock.calls.filter((c) => c[0] === "fleet.worker.drain-requested"),
    ).toHaveLength(1);

    release();
    // First stop() after drain(): still resolves bounded.
    await expect(
      Promise.race([
        handle.stop(),
        new Promise<never>((_res, rej) =>
          setTimeout(
            () => rej(new Error("stop() did not resolve bounded")),
            1000,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
    // Second stop(): awaits the (now settled) done — resolves immediately.
    await handle.stop();
  });

  it("skips running a job whose claim resolves AFTER drain() fires (driver never invoked)", async () => {
    // B3: the drain signal can fire while a `claimNext` round-trip is in
    // flight. The won claim must NOT be run — running it would start a doomed
    // driver run on a process that is exiting. Skip it entirely and leave the
    // claim to lease expiry (the same abandon path as an in-flight drain).
    let resolveClaim!: (c: ClaimedJob) => void;
    const pendingClaim = new Promise<ClaimedJob>((res) => {
      resolveClaim = res;
    });
    let claimCalls = 0;
    const queueBase = makeQueue([]);
    const queue: FleetQueueClient = {
      ...queueBase,
      async claimNext(): Promise<ClaimedJob> {
        claimCalls++;
        if (claimCalls === 1) return pendingClaim;
        return { claimed: false };
      },
    };
    const run = vi.fn(
      async (
        ctx: ServiceDriverContext,
        _input: unknown,
      ): Promise<ProbeResult> => ({
        key: "d6:langgraph-python",
        state: "green",
        signal: { shape: "package", slug: "langgraph-python" },
        observedAt: ctx.now().toISOString(),
      }),
    );
    const info = vi.fn();
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver: { run },
      payloadToInput: passInput,
      logger: { ...silentLogger, info },
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    // Wait until the loop is parked inside the pending claimNext…
    await vi.waitFor(() => expect(claimCalls).toBe(1));
    // …drain while the claim round-trip is in flight, THEN let the claim win.
    handle.drain();
    resolveClaim({ claimed: true, lease: makeLease() });
    await handle.done;

    expect(run).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("fleet.worker.drain-claim-skipped", {
      workerId: "worker-test",
      jobId: "job-1",
    });
    await handle.stop();
  });

  it("a drain during an in-flight report logs abandoningJobId null (the run already began reporting)", async () => {
    // B5: once the run has settled and the loop has INITIATED queue.report,
    // the job is past the abandon point — a drain() racing the in-flight
    // report must not record it as `abandoningJobId` (the report is landing;
    // logging it as abandoned would be a forensic lie).
    let releaseReport!: () => void;
    const reportGate = new Promise<void>((res) => {
      releaseReport = res;
    });
    let markReportStarted!: () => void;
    const reportInFlight = new Promise<void>((res) => {
      markReportStarted = res;
    });
    const queueBase = makeQueue([{ claimed: true, lease: makeLease() }]);
    const queue: RecordingQueue = {
      ...queueBase,
      reports: queueBase.reports,
      async report({ result }): Promise<void> {
        markReportStarted();
        await reportGate;
        queueBase.reports.push(result);
      },
    };
    const driver = makeDriver({
      slug: "langgraph-python",
      cells: [{ featureId: "shared-state", state: "green" }],
      aggregateState: "green",
    });
    const info = vi.fn();
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue,
      pool: budgetWith(5),
      driver,
      payloadToInput: passInput,
      logger: { ...silentLogger, info },
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });

    // Park the loop inside the in-flight report, then drain.
    await reportInFlight;
    handle.drain();
    expect(info).toHaveBeenCalledWith("fleet.worker.drain-requested", {
      workerId: "worker-test",
      abandoningJobId: null,
    });

    releaseReport();
    await handle.stop();
    // The in-flight report still landed — it was never the abandoned one.
    expect(queue.reports).toHaveLength(1);
  });
});

// ── Drain grace resolution (WORKER_DRAIN_GRACE_MS) ─────────────────────────

describe("drain grace (WORKER_DRAIN_GRACE_MS)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("the drain grace T (90s) BOUNDS a typical cell-job AND its composed budget fits the platform stop window", () => {
    // B5 — composed drain budget. The grace stopped being a bare TEARDOWN budget
    // (the old 6s, which only ever covered roster-delete + pool shutdown) and is
    // now the FINISH-AND-REPORT budget: `stop()` waits this long for the in-flight
    // run to finish-and-report (layer b) before firing `runAbort` → abandon →
    // layer-(a) reclaim. So T must BOUND a typical cell-job's wall-clock (so a
    // normal in-flight job finishes within grace), yet stay SHORTER than the
    // platform SIGTERM→SIGKILL window with headroom (so the process drains before
    // the platform hard-kills it).
    //
    // SIZING (cell-job signal in repo): a single-service cell-job runs ~15s
    // (light e2e-deep feature) up to ~200s (a heavy d6-all-pills service under
    // concurrency contention); the per-job lease ceiling is 300s
    // (DEFAULT_LEASE_SECONDS). 90s covers the bulk of single cell-jobs and stays
    // well under the 300s lease so a finishing job's lease never lapses within
    // grace. The long tail (a job that genuinely cannot finish in 90s) falls back
    // to layer (a): abandon → reaper reclaim — grace is deliberately FINITE.
    // The exact numeric is to be CONFIRMED against staging p95/p99 in B-VAL and
    // may be retuned (env-overridable) toward the ~200s heavy-job case if needed.
    expect(DEFAULT_WORKER_DRAIN_GRACE_MS).toBe(90_000);

    // COMPOSED with the deregister cap, the drain sequence spends its phases
    // SERIALLY: DRAIN_DEREGISTER_TIMEOUT_MS (3s cap on a hung-PB roster delete) is
    // consumed BEFORE this grace even starts, so the COMPOSED worst case (hung PB
    // AND a wedged driver) must fit under the platform stop window. The old 10s
    // Railway default could NOT host a cell-job-bounding grace — so layer-(c)/C3
    // MUST raise Railway's `terminationGracePeriodSeconds` to PLATFORM_STOP_GRACE_MS
    // (180s) so this composed budget fits with headroom.
    expect(
      DRAIN_DEREGISTER_TIMEOUT_MS + DEFAULT_WORKER_DRAIN_GRACE_MS,
    ).toBeLessThan(PLATFORM_STOP_GRACE_MS);
    // …with real headroom for the health-server close + pool shutdown that run
    // SERIALLY behind the grace inside the same window (not a hairline fit).
    expect(
      PLATFORM_STOP_GRACE_MS -
        (DRAIN_DEREGISTER_TIMEOUT_MS + DEFAULT_WORKER_DRAIN_GRACE_MS),
    ).toBeGreaterThanOrEqual(30_000);
    // C3 requirement, stated as the concrete numeric ordering: Railway
    // terminationGracePeriodSeconds must be ≥ (deregister + grace + headroom).
    expect(PLATFORM_STOP_GRACE_MS).toBe(180_000);
  });

  it("a run finishing WITHIN the grace T is REPORTED; a run still running AT T fires runAbort → abandon (composed-budget invariant)", async () => {
    // B5 behavioral invariant on the REAL stop() surface: the SAME drain budget
    // T (`DEFAULT_WORKER_DRAIN_GRACE_MS`) that the constant pins is what stop()
    // actually waits.
    //   Run A finishes WITHIN the grace → finish-and-report (layer b): the
    //     run resolves under its own steam before grace-expiry, so `runAbort`
    //     never fires and the terminal result is REPORTED.
    //   Run B is still running AT grace-expiry → stop() fires `runAbort` →
    //     the run aborts WITHOUT a usable result → abandon → lease lapses →
    //     layer-(a) reclaim backstop, NOT reported.
    // This is the exact budget the C3 terminationGracePeriod must host.

    // ── A) finishes within T → REPORTED ────────────────────────────────────
    {
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      const reportSpy = vi.spyOn(queue, "report");
      let markStarted!: () => void;
      const started = new Promise<void>((res) => {
        markStarted = res;
      });
      let releaseComplete!: () => void;
      const completeGate = new Promise<void>((res) => {
        releaseComplete = res;
      });
      const runAbortObserved = { aborted: false };
      const driver: ServiceJobDriver = {
        async run(ctx, _input): Promise<ProbeResult> {
          markStarted();
          // Honor the abort only if it fires (it must NOT, within grace).
          ctx.abortSignal?.addEventListener("abort", () => {
            runAbortObserved.aborted = true;
          });
          // Resolve under its OWN steam (not via abort) — a run seconds from
          // done when SIGTERM landed.
          await completeGate;
          return {
            key: "d6:langgraph-python",
            state: "green",
            signal: { shape: "package", slug: "langgraph-python" },
            observedAt: ctx.now().toISOString(),
          };
        },
      };
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
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });
      await started;
      handle.drain();
      // The run finishes well within the grace window — finish-and-report, no
      // abort. The loop breaks on the drain signal once the run reports, so the
      // done-promise resolves on its own; no stop() race needed for this leg.
      releaseComplete();
      await handle.done;
      expect(runAbortObserved.aborted).toBe(false);
      expect(reportSpy).toHaveBeenCalledTimes(1);
      expect(queue.reports[0]!.aggregateState).toBe("green");
    }

    // ── B) still running AT grace-expiry → runAbort fires → ABANDON ─────────
    // The AT-grace abort behavior is grace-VALUE-independent (the constant-pin
    // test above owns T=90s); here we exercise the SAME stop()→runAbort path
    // with a short env-override grace so the deadline is crossed cheaply (no
    // 90s wait, and no fake-timer cascade over a 90s span). The override is the
    // documented env knob (`WORKER_DRAIN_GRACE_MS`) — proving the override path
    // too.
    {
      const prev = process.env.WORKER_DRAIN_GRACE_MS;
      process.env.WORKER_DRAIN_GRACE_MS = "50";
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      const reportSpy = vi.spyOn(queue, "report");
      let markStarted!: () => void;
      const started = new Promise<void>((res) => {
        markStarted = res;
      });
      const runAbortObserved = { aborted: false };
      const driver: ServiceJobDriver = {
        async run(ctx, _input): Promise<ProbeResult> {
          markStarted();
          // Overruns the grace: only settles when its OWN abort (`runAbort`,
          // wired as ctx.abortSignal at grace-expiry) fires.
          await new Promise<void>((resolve) => {
            if (ctx.abortSignal?.aborted) {
              runAbortObserved.aborted = true;
              resolve();
              return;
            }
            ctx.abortSignal?.addEventListener(
              "abort",
              () => {
                runAbortObserved.aborted = true;
                resolve();
              },
              { once: true },
            );
          });
          return {
            key: "d6:langgraph-python",
            state: "red",
            signal: { shape: "package", slug: "langgraph-python" },
            observedAt: ctx.now().toISOString(),
          };
        },
      };
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
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });
      try {
        await started;
        handle.drain();
        // stop() waits the (short) grace then fires runAbort at grace-expiry,
        // hard-cancelling the overrunning run → it abandons WITHOUT a usable
        // result. stop() detaches once the run unwinds.
        await handle.stop();
        await handle.done;
        // The run observed its grace-expiry abort (runAbort), so the loop takes
        // the `abortedWithoutResult` abandon branch — NOT the report path. The
        // lease lapses → layer-(a) reaper reclaims it (the backstop).
        expect(runAbortObserved.aborted).toBe(true);
        expect(reportSpy).not.toHaveBeenCalled();
        expect(queue.reports).toHaveLength(0);
      } finally {
        if (prev === undefined) delete process.env.WORKER_DRAIN_GRACE_MS;
        else process.env.WORKER_DRAIN_GRACE_MS = prev;
      }
    }
  });

  it("warns and falls back to the default when WORKER_DRAIN_GRACE_MS is not a positive integer", async () => {
    vi.stubEnv("WORKER_DRAIN_GRACE_MS", "soon");
    const warn = vi.fn();
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue: makeQueue([]),
      pool: budgetWith(5),
      driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
      payloadToInput: passInput,
      logger: { ...silentLogger, warn },
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    await handle.stop();
    expect(warn).toHaveBeenCalledWith(
      "fleet.worker.drain-grace-invalid",
      expect.objectContaining({
        raw: "soon",
        fallbackMs: DEFAULT_WORKER_DRAIN_GRACE_MS,
      }),
    );
  });

  it("an invalid WORKER_DRAIN_GRACE_MS bounds stop() at the DEFAULT grace against a wedged driver (no NaN→0 instant detach, no hang)", async () => {
    // The fallback's BEHAVIOR, not just its warn: with a garbage override and
    // a wedged driver (ignores its abort, never settles), stop() must detach
    // at DEFAULT_WORKER_DRAIN_GRACE_MS semantics — a NaN→0 grace would detach
    // instantly (no drain at all) and a dropped timer would hang stop() past
    // Railway's kill window. Fake timers pin both edges deterministically.
    vi.stubEnv("WORKER_DRAIN_GRACE_MS", "soon");
    vi.useFakeTimers();
    try {
      const queue = makeQueue([{ claimed: true, lease: makeLease() }]);
      let release!: () => void;
      const released = new Promise<void>((res) => {
        release = res;
      });
      let markStarted!: () => void;
      const started = new Promise<void>((res) => {
        markStarted = res;
      });
      const driver: ServiceJobDriver = {
        async run(ctx): Promise<ProbeResult> {
          markStarted();
          // Deliberately IGNORE ctx.abortSignal — a wedged teardown.
          await released;
          return {
            key: "d6:langgraph-python",
            state: "green",
            signal: { shape: "package", slug: "langgraph-python" },
            observedAt: ctx.now().toISOString(),
          };
        },
      };
      const handle = startWorkerLoop({
        workerId: "worker-test",
        queue,
        pool: budgetWith(5),
        driver,
        payloadToInput: passInput,
        logger: silentLogger,
        env: {},
        now: () => new Date("2026-06-04T00:04:00.000Z"),
        // Clock-HONORING sleep: B5 raised the default grace to 90s, so this test
        // steps the fake clock across a 90s span. A 0ms-yielding heartbeat sleep
        // would re-arm thousands of times inside that span and make
        // advanceTimersByTimeAsync runaway; honoring `heartbeatMs` (1_000_000)
        // fires ZERO heartbeats inside the 90s window, so only stop()'s single
        // grace timer is crossed.
        sleep: clockHonoringSleep,
        pollIntervalMs: 1,
        leaseSeconds: 2000,
        heartbeatMs: 1_000_000,
      });
      await started;

      let stopSettled = false;
      const stopPromise = handle.stop().then(() => {
        stopSettled = true;
      });
      // NOT instantaneous: one tick short of the default grace, the wedged
      // drain is still being waited on (a NaN→0 grace would already have
      // detached).
      await vi.advanceTimersByTimeAsync(DEFAULT_WORKER_DRAIN_GRACE_MS - 1);
      expect(stopSettled).toBe(false);
      // …and NOT a hang: crossing the default grace detaches stop().
      await vi.advanceTimersByTimeAsync(1);
      await stopPromise;
      expect(stopSettled).toBe(true);

      // Cleanup: un-wedge the run so the loop exits via the abandon path.
      release();
      await handle.done;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT warn for a valid positive-integer override", async () => {
    vi.stubEnv("WORKER_DRAIN_GRACE_MS", "200");
    const warn = vi.fn();
    const handle = startWorkerLoop({
      workerId: "worker-test",
      queue: makeQueue([]),
      pool: budgetWith(5),
      driver: makeDriver({ slug: "x", cells: [], aggregateState: "green" }),
      payloadToInput: passInput,
      logger: { ...silentLogger, warn },
      env: {},
      now: () => new Date("2026-06-04T00:04:00.000Z"),
      sleep: yieldingSleep(),
      pollIntervalMs: 1,
      leaseSeconds: 2000,
      heartbeatMs: 1_000_000,
    });
    await handle.stop();
    expect(warn).not.toHaveBeenCalledWith(
      "fleet.worker.drain-grace-invalid",
      expect.anything(),
    );
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
    const drivers = registry("e2e_d6", "e2e_smoke", "e2e_demos");
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

  it("routes an e2e_d6 payload to the d6 driver (equivalence)", async () => {
    const drivers = registry("e2e_d6", "e2e_smoke", "e2e_demos");
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
    const drivers = registry("e2e_d6", "e2e_demos");
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
        "e2e_demos",
        {
          driver: makeSchemeDriver("custom", "langgraph-python"),
          payloadToInput: passInput,
          aggregateSlugKey: (serviceSlug) => `custom:${serviceSlug}`,
        },
      ],
    ]);
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({ payload: { driverKind: "e2e_demos" } }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    // Exactly the per-cell row is captured; the `custom:<slug>` aggregate side
    // row was filtered (NOT counted as a cell).
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]!.cellKey).toBe("custom:langgraph-python/feat-1");
    expect(result.commError).toBeUndefined();
  });

  it("classifies a THROWING custom aggregateSlugKey builder as worker-protocol-violation and the loop continues", async () => {
    // B4: `buildAggregateSlugKey(payload.serviceSlug)` runs BEFORE the
    // try/catch around the driver run — a throwing custom builder must not
    // escape runClaimedJob (it would reject the loop's done-promise = silent
    // worker death). It is a registry-entry misconfiguration the worker owns,
    // classified like the other payload/protocol failures.
    const drivers = new Map<DriverKind, DriverRegistryEntry>([
      [
        "e2e_d6",
        {
          driver: makeTaggingDriver("e2e_d6"),
          payloadToInput: passInput,
          aggregateSlugKey: () => {
            throw new Error("bad aggregate key builder");
          },
        },
      ],
      ["e2e_smoke", entry("e2e_smoke")],
    ]);
    const queue = makeQueue([
      {
        claimed: true,
        lease: makeLease({ payload: { driverKind: "e2e_d6" } }),
      },
      {
        claimed: true,
        lease: makeLease({
          job: { id: "job-2" },
          payload: { driverKind: "e2e_smoke" },
        }),
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
    let doneRejected = false;
    handle.done.catch(() => {
      doneRejected = true;
    });

    // BOTH jobs report: the poisoned one as a protocol violation, the next one
    // normally — proof the loop survived the throwing builder.
    await vi.waitFor(() => expect(queue.reports).toHaveLength(2));
    await handle.stop();
    expect(doneRejected).toBe(false);
    expect(queue.reports[0]!.aggregateState).toBe("error");
    expect(queue.reports[0]!.commError?.kind).toBe("worker-protocol-violation");
    expect(queue.reports[0]!.commError?.message).toContain(
      "bad aggregate key builder",
    );
    expect(queue.reports[1]!.aggregateState).toBe("green");
    expect(queue.reports[1]!.commError).toBeUndefined();
  });

  it("honors driverInputs.rowPrefix=d5 over the entry's d6 aggregate filter (D5 take-one)", async () => {
    // The D5 "take-one" probe runs the `e2e_d6` driver with
    // `driverInputs.rowPrefix === "d5"`, so its aggregate side row is
    // `d5:<slug>` — NOT the `d6:<slug>` the entry's default builder would
    // produce. The loop must read the per-job rowPrefix and filter the
    // `d5:<slug>` aggregate out of the captured cells, leaving only the
    // `d5:<slug>/<feature>` per-cell row.
    const drivers = new Map<DriverKind, DriverRegistryEntry>([
      [
        "e2e_d6",
        {
          driver: makeSchemeDriver("d5", "langgraph-python"),
          payloadToInput: passInput,
          aggregateSlugKey: (serviceSlug) => `d6:${serviceSlug}`,
        },
      ],
    ]);
    const result = await runClaimedJob(
      baseRegistryDeps(drivers),
      makeLease({
        payload: {
          driverKind: "e2e_d6",
          driverInputs: { rowPrefix: "d5" },
        },
      }),
      { leaseSeconds: 300, heartbeatMs: 1_000_000 },
    );
    // The `d5:<slug>` aggregate side row was filtered (not counted as a cell);
    // only the per-cell `d5:<slug>/feat-1` row survives.
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]!.cellKey).toBe("d5:langgraph-python/feat-1");
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
    const drivers = registry("e2e_d6", "e2e_smoke", "e2e_demos");
    const queue = makeQueue([
      {
        claimed: true,
        lease: makeLease({ payload: { driverKind: "e2e_demos" } }),
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
    expect(queue.reports[0]!.aggregateKey).toBe("e2e_demos:routed");
  });
});
