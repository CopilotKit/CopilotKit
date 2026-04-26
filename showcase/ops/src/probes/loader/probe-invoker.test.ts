import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildProbeInvoker } from "./probe-invoker.js";
import type { ProbeConfig } from "./schema.js";
import { createDiscoveryRegistry } from "../discovery/index.js";
import type { DiscoverySource, ProbeDriver } from "../types.js";
import type { ProbeResult } from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import type { ProbeRunWriter } from "../run-history.js";
import { ProbeRunTracker } from "../run-tracker.js";
import { logger } from "../../logger.js";

function mkWriter(): {
  writer: StatusWriter;
  writes: ProbeResult<unknown>[];
} {
  const writes: ProbeResult<unknown>[] = [];
  const writer: StatusWriter = {
    async write(result) {
      writes.push(result);
      return {
        previousState: null,
        newState: "green",
        transition: "first",
        firstFailureAt: null,
        failCount: 0,
      };
    },
  };
  return { writer, writes };
}

// CR-A1.9: stable test clock. The `ProbeInvokerDeps.now` contract is
// `() => Date` (driver-facing — drivers call `ctx.now().toISOString()`).
// Internally the invoker also uses `Date.now()` for tracker.startedAt
// and runWriter.start({startedAt}) — those are numeric ms. Keep both
// representations available to tests via shared constants so assertions
// against tracker / writer values can compare to the SAME instant the
// drivers see, instead of drifting against wall-clock.
const FIXED_TEST_INSTANT = "2026-04-22T00:00:00Z";
const FIXED_TEST_MS: number = Date.parse(FIXED_TEST_INSTANT);
const FIXED_TEST_DATE: Date = new Date(FIXED_TEST_MS);
// Sanity: when this drift'd in earlier iterations, tracker.startedAt
// would be `Date.now()` (real clock) while drivers got the fixed test
// Date — making time-relative assertions unstable. Verify here that
// the two stay aligned.
if (FIXED_TEST_DATE.getTime() !== FIXED_TEST_MS) {
  throw new Error("test fixture: Date / ms representations drifted");
}

const BASE_DEPS = {
  fetchImpl: globalThis.fetch,
  env: {} as Readonly<Record<string, string | undefined>>,
  logger,
  // Drivers see Date (matches ProbeContext.now). The numeric ms form
  // (FIXED_TEST_MS) is the same instant — tests that assert on tracker
  // startedAt / runWriter.start({startedAt}) can compare against it.
  now: (): Date => FIXED_TEST_DATE,
};

describe("buildProbeInvoker", () => {
  it("fans out static targets and emits one writer.write per target", async () => {
    const inputSchema = z.object({ key: z.string(), url: z.string().url() });
    const driver: ProbeDriver<z.infer<typeof inputSchema>, { ok: true }> = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: input.key,
          state: "green",
          signal: { ok: true },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [
        { key: "smoke:a", url: "https://a.example" },
        { key: "smoke:b", url: "https://b.example" },
      ],
    };
    const { writer, writes } = mkWriter();
    const invoker = buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    });
    await invoker();
    expect(writes.map((w) => w.key).sort()).toEqual(["smoke:a", "smoke:b"]);
    expect(writes.every((w) => w.state === "green")).toBe(true);
  });

  it("runs a discovery probe once per enumerated item with interpolated key", async () => {
    const inputSchema = z.object({ key: z.string(), name: z.string() });
    const driver: ProbeDriver<z.infer<typeof inputSchema>, { name: string }> = {
      kind: "image_drift",
      inputSchema,
      async run(ctx, input) {
        return {
          key: input.key,
          state: "green",
          signal: { name: input.name },
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const source: DiscoverySource = {
      name: "railway-services",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "railway-services",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    const invoker = buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    });
    await invoker();
    expect(writes.map((w) => w.key).sort()).toEqual([
      "image_drift:alpha",
      "image_drift:beta",
      "image_drift:gamma",
    ]);
  });

  it("supports nested key_template paths like ${service.name}", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "image_drift",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const source: DiscoverySource = {
      name: "nested-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [{ service: { name: "one" } }, { service: { name: "two" } }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "nested-src",
        filter: {},
        key_template: "image_drift:${service.name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes.map((w) => w.key).sort()).toEqual([
      "image_drift:one",
      "image_drift:two",
    ]);
  });

  it("runs a single-target probe once", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "pin_drift",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "pin_drift",
      id: "pin-drift-weekly",
      schedule: "0 10 * * 1",
      max_concurrency: 4,
      target: { key: "pin_drift:overall" },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe("pin_drift:overall");
  });

  it("emits nothing when discovery returns zero items", async () => {
    const driver: ProbeDriver = {
      kind: "image_drift",
      inputSchema: z.object({ key: z.string() }).passthrough(),
      async run() {
        throw new Error("should never be called");
      },
    };
    const source: DiscoverySource = {
      name: "empty-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "empty-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toEqual([]);
  });

  it("isolates per-target throws: one target fails, siblings proceed", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        const key = (input as { key: string }).key;
        if (key === "smoke:bad") throw new Error("driver exploded");
        return {
          key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [
        { key: "smoke:bad" },
        { key: "smoke:good-1" },
        { key: "smoke:good-2" },
      ],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(3);
    const bad = writes.find((w) => w.key === "smoke:bad");
    expect(bad?.state).toBe("error");
    expect(writes.filter((w) => w.state === "green")).toHaveLength(2);
  });

  it("converts inputSchema rejections into synthetic error results for that key only", async () => {
    // Strict schema — per-target must have `url`. A discovery source that
    // omits it should yield a synthetic error for the bad one, siblings ok.
    const inputSchema = z.object({ key: z.string(), url: z.string().url() });
    const driver: ProbeDriver<z.infer<typeof inputSchema>, unknown> = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: input.key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const source: DiscoverySource = {
      name: "mixed-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [
          { name: "ok-one", url: "https://one.example" },
          { name: "bad-one" /* no url */ },
        ];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "mixed-src",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(2);
    const bad = writes.find((w) => w.key === "smoke:bad-one");
    const good = writes.find((w) => w.key === "smoke:ok-one");
    expect(bad?.state).toBe("error");
    expect(good?.state).toBe("green");
  });

  it("respects max_concurrency: never more than N simultaneous driver runs", async () => {
    let inFlight = 0;
    let peak = 0;
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const targets = Array.from({ length: 10 }, (_, i) => ({
      key: `smoke:t-${i}`,
    }));
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 3,
      targets,
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThanOrEqual(2); // Sanity: some concurrency.
  });

  it("enforces per-target timeout_ms via synthetic timeout ProbeResult", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        // Observe abortSignal: reject promptly when the invoker aborts
        // due to timeout. This is the well-behaved driver pattern we
        // expect downstream drivers to adopt.
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          if (ctx.abortSignal) {
            ctx.abortSignal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(ctx.abortSignal?.reason ?? new Error("aborted"));
              },
              { once: true },
            );
          }
        });
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 25,
      targets: [{ key: "smoke:slow" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    expect(writes[0]!.key).toBe("smoke:slow");
    const signal = writes[0]!.signal as { errorDesc?: string };
    expect(signal.errorDesc).toMatch(/driver timeout after 25ms/);
  });

  it("times out invoker-level even when driver ignores abortSignal", async () => {
    // Driver that never observes abortSignal — its promise eventually
    // resolves after the timeout. The invoker still returns a synthetic
    // timeout ProbeResult as soon as the AbortController fires, rather
    // than waiting for the driver's promise to settle. This is the
    // load-bearing contract: a misbehaved driver cannot stall the tick.
    const inputSchema = z.object({ key: z.string() }).passthrough();
    let driverResolved = false;
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        await new Promise((r) => setTimeout(r, 80));
        driverResolved = true;
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 20,
      targets: [{ key: "smoke:ignores-abort" }],
    };
    const { writer, writes } = mkWriter();
    const start = Date.now();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    const elapsed = Date.now() - start;
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    // The invoker must return promptly on timeout — NOT wait for the
    // driver's 80ms sleep to complete. Allow some slack for CI jitter
    // but stay well under 80ms.
    expect(elapsed).toBeLessThan(70);
    // The slow driver may still be in flight when we finish, which is
    // the whole point of this test: invoker does not block on it.
    // Can't assert `driverResolved === false` deterministically in all
    // environments, but reference it so the variable isn't flagged.
    void driverResolved;
  });

  it("passes an abortSignal to drivers and sets an abort reason on timeout", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    let seenSignal: AbortSignal | undefined;
    let abortReason: unknown;
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        seenSignal = ctx.abortSignal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          ctx.abortSignal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              abortReason = ctx.abortSignal?.reason;
              reject(new Error("aborted-by-driver"));
            },
            { once: true },
          );
        });
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 15,
      targets: [{ key: "smoke:abort-observer" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(true);
    // reason is whatever the invoker passed to abort(); the driver
    // snapshotted it inside the abort listener before the invoker
    // returned, so we can assert its shape.
    expect(abortReason).toBeInstanceOf(Error);
    expect((abortReason as Error).message).toMatch(/driver timeout after 15ms/);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
  });

  it("does not abort when driver completes before timeout", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    let observedAborted: boolean | undefined;
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        // Driver finishes fast; abortSignal should remain un-aborted.
        observedAborted = ctx.abortSignal?.aborted;
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 500,
      targets: [{ key: "smoke:fast" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(observedAborted).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("green");
  });

  // ---------------------------------------------------------------------
  // B7: ProbeRunTracker registration + RunSummary + probe_runs writer
  // ---------------------------------------------------------------------
  //
  // The invoker must (1) register a ProbeRunTracker on the scheduler entry
  // for the duration of the run so `GET /api/probes` can surface inflight
  // progress, (2) call enqueue/start/complete/fail in the right order for
  // each fan-out target, (3) clear the tracker (set null) on completion,
  // (4) return a RunSummary so the scheduler populates lastRunSummary, and
  // (5) start/finish a row in the `probe_runs` collection via the writer.

  /**
   * Tiny fake scheduler-like surface exposing only the methods the
   * invoker uses. Mirrors the real shape on purpose: getEntry returns a
   * snapshot whose `triggeredRun` flag the invoker reads, and
   * setEntryTracker mutates the underlying slot.
   */
  function fakeScheduler(): {
    scheduler: {
      getEntry: (id: string) => { triggeredRun: boolean } | undefined;
      setEntryTracker: (id: string, tracker: ProbeRunTracker | null) => void;
    };
    trackerHistory: Array<ProbeRunTracker | null>;
    triggered: boolean;
  } {
    const trackerHistory: Array<ProbeRunTracker | null> = [];
    const state = { triggered: false };
    return {
      scheduler: {
        getEntry: (_id: string) => ({ triggeredRun: state.triggered }),
        setEntryTracker: (_id: string, tracker: ProbeRunTracker | null) => {
          trackerHistory.push(tracker);
        },
      },
      trackerHistory,
      get triggered() {
        return state.triggered;
      },
      set triggered(v: boolean) {
        state.triggered = v;
      },
    };
  }

  function fakeRunWriter(): {
    writer: ProbeRunWriter;
    starts: Array<{ probeId: string; startedAt: number; triggered: boolean }>;
    finishes: Array<{
      id: string;
      finishedAt: number;
      state: "completed" | "failed";
      summary: { total: number; passed: number; failed: number } | null;
    }>;
  } {
    const starts: Array<{
      probeId: string;
      startedAt: number;
      triggered: boolean;
    }> = [];
    const finishes: Array<{
      id: string;
      finishedAt: number;
      state: "completed" | "failed";
      summary: { total: number; passed: number; failed: number } | null;
    }> = [];
    let nextId = 1;
    const writer: ProbeRunWriter = {
      async start(opts) {
        starts.push(opts);
        return { id: `run-${nextId++}` };
      },
      async finish(opts) {
        finishes.push({
          id: opts.id,
          finishedAt: opts.finishedAt,
          state: opts.state,
          summary:
            opts.summary === null
              ? null
              : {
                  total: opts.summary.total,
                  passed: opts.summary.passed,
                  failed: opts.summary.failed,
                },
        });
      },
      async recent() {
        return [];
      },
    };
    return { writer, starts, finishes };
  }

  it("registers a ProbeRunTracker on the scheduler entry while the handler runs and clears it after", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }, { key: "smoke:b" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const runWriter = fakeRunWriter().writer;
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler: sched.scheduler,
      runWriter,
      ...BASE_DEPS,
    })();
    // First setEntryTracker call assigns a real tracker; second clears it.
    expect(sched.trackerHistory).toHaveLength(2);
    expect(sched.trackerHistory[0]).toBeInstanceOf(ProbeRunTracker);
    expect(sched.trackerHistory[1]).toBeNull();
  });

  it("calls tracker.enqueue/start/complete in order for each discovered service", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      // Single concurrency so call order is deterministic across both targets.
      max_concurrency: 1,
      targets: [{ key: "smoke:a" }, { key: "smoke:b" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const runWriter = fakeRunWriter().writer;
    // Capture method calls on the tracker the invoker will create. We
    // can't intercept the constructor here, so spy via setEntryTracker:
    // when the invoker calls setEntryTracker(id, tracker), wrap each
    // method on that tracker before the invoker invokes them.
    const calls: string[] = [];
    const origSet = sched.scheduler.setEntryTracker;
    sched.scheduler.setEntryTracker = (id, tracker) => {
      if (tracker) {
        const orig = {
          enqueue: tracker.enqueue.bind(tracker),
          start: tracker.start.bind(tracker),
          complete: tracker.complete.bind(tracker),
          fail: tracker.fail.bind(tracker),
        };
        tracker.enqueue = (slug: string) => {
          calls.push(`enqueue:${slug}`);
          return orig.enqueue(slug);
        };
        tracker.start = (slug: string) => {
          calls.push(`start:${slug}`);
          return orig.start(slug);
        };
        tracker.complete = (slug, result) => {
          calls.push(`complete:${slug}:${result}`);
          return orig.complete(slug, result);
        };
        tracker.fail = (slug, err) => {
          calls.push(`fail:${slug}:${err}`);
          return orig.fail(slug, err);
        };
      }
      origSet(id, tracker);
    };
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler: sched.scheduler,
      runWriter,
      ...BASE_DEPS,
    })();
    // Both services enqueue first; then per-service start → complete in
    // order. With concurrency=1 the relative order is deterministic.
    expect(calls).toEqual([
      "enqueue:smoke:a",
      "enqueue:smoke:b",
      "start:smoke:a",
      "complete:smoke:a:green",
      "start:smoke:b",
      "complete:smoke:b:green",
    ]);
  });

  it("returns a RunSummary with total/passed/failed counts", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        const key = (input as { key: string }).key;
        return {
          key,
          state: key.endsWith("bad") ? "red" : "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }, { key: "smoke:b" }, { key: "smoke:bad" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const runWriter = fakeRunWriter().writer;
    const summary = await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler: sched.scheduler,
      runWriter,
      ...BASE_DEPS,
    })();
    expect(summary).toEqual({ total: 3, passed: 2, failed: 1 });
  });

  it("invokes runWriter.start at run start and runWriter.finish with state='completed' on success", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }, { key: "smoke:b" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    sched.triggered = true; // simulate a manually-triggered run
    const rw = fakeRunWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler: sched.scheduler,
      runWriter: rw.writer,
      ...BASE_DEPS,
    })();
    expect(rw.starts).toHaveLength(1);
    expect(rw.starts[0]).toMatchObject({
      probeId: "smoke",
      triggered: true,
    });
    expect(rw.finishes).toHaveLength(1);
    expect(rw.finishes[0]).toMatchObject({
      id: "run-1",
      state: "completed",
      summary: { total: 2, passed: 2, failed: 0 },
    });
  });

  it("calls tracker.fail and runWriter.finish(state='failed') when a driver throws", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(_ctx, input) {
        const key = (input as { key: string }).key;
        if (key === "smoke:bad") throw new Error("driver exploded");
        return {
          key,
          state: "green",
          signal: {},
          observedAt: _ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      targets: [{ key: "smoke:bad" }, { key: "smoke:ok" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const rw = fakeRunWriter();
    let capturedTracker: ProbeRunTracker | null = null;
    const origSet = sched.scheduler.setEntryTracker;
    sched.scheduler.setEntryTracker = (id, tracker) => {
      if (tracker && capturedTracker === null) capturedTracker = tracker;
      origSet(id, tracker);
    };
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler: sched.scheduler,
      runWriter: rw.writer,
      ...BASE_DEPS,
    })();
    expect(capturedTracker).not.toBeNull();
    const snap = capturedTracker!.snapshot();
    const bad = snap.services.find((s) => s.slug === "smoke:bad");
    expect(bad?.state).toBe("failed");
    expect(bad?.error).toContain("driver exploded");
    // The whole run still "completes" from the scheduler's perspective —
    // the per-target failure is captured in the summary as one failed.
    // Per-service errors don't escalate the overall run to 'failed' (the
    // probe handler itself didn't throw); the summary's `failed` counter
    // is the right surface.
    expect(rw.finishes).toHaveLength(1);
    expect(rw.finishes[0]).toMatchObject({
      state: "completed",
      summary: { total: 2, passed: 1, failed: 1 },
    });
  });

  it("does NOT throw when runWriter.start fails — observability must be best-effort", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const failingWriter: ProbeRunWriter = {
      start: vi.fn().mockRejectedValue(new Error("PB down")),
      finish: vi.fn().mockResolvedValue(undefined),
      recent: vi.fn().mockResolvedValue([]),
    };
    await expect(
      buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        scheduler: sched.scheduler,
        runWriter: failingWriter,
        ...BASE_DEPS,
      })(),
    ).resolves.toBeDefined();
    // finish() not called when start() failed — no row id to update.
    expect(failingWriter.finish).not.toHaveBeenCalled();
  });

  it("does NOT throw when runWriter.finish fails", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const failingFinish: ProbeRunWriter = {
      start: vi.fn().mockResolvedValue({ id: "run-x" }),
      finish: vi.fn().mockRejectedValue(new Error("PB down")),
      recent: vi.fn().mockResolvedValue([]),
    };
    await expect(
      buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        scheduler: sched.scheduler,
        runWriter: failingFinish,
        ...BASE_DEPS,
      })(),
    ).resolves.toBeDefined();
    expect(failingFinish.finish).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------
  // CR-A1.1: trigger filter.slugs threads through to the invoker
  // ---------------------------------------------------------------------
  it("filters discovered inputs to opts.filter.slugs when supplied", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const seenKeys: string[] = [];
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        const key = (input as { key: string }).key;
        seenKeys.push(key);
        return {
          key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const source: DiscoverySource = {
      name: "filter-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "filter-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    const invoker = buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    });
    const summary = await invoker({
      filter: { slugs: ["image_drift:alpha", "image_drift:gamma"] },
    });
    // Only the requested slugs ran AND were written. Beta — discovered
    // but unfiltered — must not appear in the writer or driver call list.
    expect(seenKeys.sort()).toEqual(["image_drift:alpha", "image_drift:gamma"]);
    expect(writes.map((w) => w.key).sort()).toEqual([
      "image_drift:alpha",
      "image_drift:gamma",
    ]);
    expect(summary.total).toBe(2);
  });

  it("filters discovered inputs against the FULL roster (filter doesn't change discovery output)", async () => {
    // The source's enumerate() must still see the unfiltered request —
    // filtering happens AFTER discovery so logs / metrics still reflect
    // what the source actually returned.
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    let enumerateInvocations = 0;
    let enumerateRecordCount = 0;
    const source: DiscoverySource = {
      name: "filter-roster",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        enumerateInvocations++;
        const all = [{ name: "a" }, { name: "b" }, { name: "c" }];
        enumerateRecordCount = all.length;
        return all;
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "filter-roster",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })({ filter: { slugs: ["smoke:b"] } });
    expect(enumerateInvocations).toBe(1);
    expect(enumerateRecordCount).toBe(3);
    expect(writes.map((w) => w.key)).toEqual(["smoke:b"]);
  });

  // ---------------------------------------------------------------------
  // CR-A1.2: interpolateTemplate empty-key collapse fail-loud
  // ---------------------------------------------------------------------
  it("emits a synthetic-error result and does NOT collapse empty keys when key_template fields are missing", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        // The driver should NOT see records with missing template fields.
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const source: DiscoverySource = {
      name: "missing-field-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Two records, BOTH missing the templated `name` field. Without
        // strict interpolation they would both render an empty key and
        // collide in the tracker.services Map.
        return [{ kind: "x" }, { kind: "y" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "missing",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "missing-field-src",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    const sched = fakeScheduler();
    const summary = await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      scheduler: sched.scheduler,
      ...BASE_DEPS,
    })();
    // Each record must surface its own synthetic-error result with a
    // distinct, non-empty key. No empty-string keys in the writer.
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.state).toBe("error");
      expect(w.key).not.toBe("");
      expect(w.key).not.toBe("smoke:");
      expect(
        (w.signal as { errorDesc?: string } | undefined)?.errorDesc,
      ).toContain("key_template missing field: name");
    }
    // Distinct keys (no collapse).
    expect(new Set(writes.map((w) => w.key)).size).toBe(2);
    // Tracker must have both as distinct services.
    const captured = sched.trackerHistory[0];
    expect(captured).toBeInstanceOf(ProbeRunTracker);
    const snap = (captured as ProbeRunTracker).snapshot();
    expect(snap.services).toHaveLength(2);
    // Neither service has an empty slug.
    for (const svc of snap.services) {
      expect(svc.slug).not.toBe("");
      expect(svc.slug).not.toBe("smoke:");
    }
    // Summary reflects two failures, no successes.
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(2);
  });

  // ---------------------------------------------------------------------
  // CR-A1.5: discovery enumerate failure → state="failed"
  // ---------------------------------------------------------------------
  it("flips runState to 'failed' and surfaces discoveryFailed when enumerate() throws", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        throw new Error("driver should not be called when discovery fails");
      },
    };
    const source: DiscoverySource = {
      name: "broken-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        throw new Error("upstream is down");
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "discovery-broken",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "broken-src",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    const sched = fakeScheduler();
    const rw = fakeRunWriter();
    const summary = await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      scheduler: sched.scheduler,
      runWriter: rw.writer,
      ...BASE_DEPS,
    })();
    // Synthetic-error tile written for the probe-as-a-whole.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    expect((writes[0]!.signal as { errorDesc?: string }).errorDesc).toContain(
      "upstream is down",
    );
    // Run row marked as failed (not completed).
    expect(rw.finishes).toHaveLength(1);
    expect(rw.finishes[0]!.state).toBe("failed");
    // Summary distinguishes "discovery broke" from "no targets matched."
    expect(summary.discoveryFailed).toBe(true);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    // R2-A.1: RunSummary invariant — total must equal passed + failed.
    // Previously total=0 + failed=1 violated this.
    expect(summary.total).toBe(summary.passed + summary.failed);
    // R2-A.1: tracker.snapshot().services MUST NOT contain a fake entry
    // keyed by the probe id (cfg.id="discovery-broken"). The discovery
    // failure is signalled by `discoveryFailed: true` in the snapshot,
    // not by polluting the per-service inflight list with a synthetic
    // probe-id entry.
    const captured = sched.trackerHistory[0];
    expect(captured).toBeInstanceOf(ProbeRunTracker);
    const snap = (captured as ProbeRunTracker).snapshot();
    const slugs = snap.services.map((s) => s.slug);
    expect(slugs).not.toContain("discovery-broken");
  });

  // ---------------------------------------------------------------------
  // CR-A1.8: discovery enumerate timeout race
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // R2-A.2 / R2-A.3: Promise.race must absorb late driver/enumerate
  // rejections so an --unhandled-rejections=throw process doesn't crash
  // when the timeout wins the race against a misbehaving promise.
  // ---------------------------------------------------------------------
  it("does not emit UnhandledRejection when driver rejects late after timeout", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        // Ignore abortSignal entirely; reject AFTER timeout has fired.
        await new Promise((r) => setTimeout(r, 50));
        throw new Error("driver late rejection");
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 10,
      targets: [{ key: "smoke:late-reject" }],
    };
    const { writer, writes } = mkWriter();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        ...BASE_DEPS,
      })();
      // Wait one extra tick AFTER the late rejection would have fired
      // so any unhandled rejection has time to surface on the process.
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    // Must not have observed any unhandled rejection.
    expect(unhandled).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
  }, 5000);

  it("does not emit UnhandledRejection when enumerate() rejects late after timeout", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        throw new Error("driver should not run; discovery timed out");
      },
    };
    const source: DiscoverySource = {
      name: "late-reject-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Ignore abort, reject AFTER timeout.
        await new Promise((r) => setTimeout(r, 50));
        throw new Error("enumerate late rejection");
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "discovery-late-reject",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 10,
      discovery: {
        source: "late-reject-src",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer } = mkWriter();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
      })();
      await new Promise((r) => setTimeout(r, 80));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  }, 5000);

  it("times out at the invoker level when enumerate() ignores abortSignal", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        throw new Error("should not run; discovery timed out");
      },
    };
    let enumerateResolved = false;
    const source: DiscoverySource = {
      name: "ignores-abort-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Sleep WAY past timeout, ignoring abortSignal entirely.
        await new Promise((r) => setTimeout(r, 200));
        enumerateResolved = true;
        return [{ name: "x" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "discovery-timeout",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      timeout_ms: 25,
      discovery: {
        source: "ignores-abort-src",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    const sched = fakeScheduler();
    const rw = fakeRunWriter();
    const start = Date.now();
    const summary = await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      scheduler: sched.scheduler,
      runWriter: rw.writer,
      ...BASE_DEPS,
    })();
    const elapsed = Date.now() - start;
    // Must not have waited for the 200ms enumerate to resolve.
    expect(elapsed).toBeLessThan(150);
    // Treated as discovery failure (per CR-A1.5).
    expect(summary.discoveryFailed).toBe(true);
    expect(rw.finishes[0]!.state).toBe("failed");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    // Suppress the unused-flag lint complaint; intentional reference.
    void enumerateResolved;
  }, 5000);

  // ---------------------------------------------------------------------
  // CR-A1.9: tracker.startedAt and runWriter.start receive numeric ms
  // ---------------------------------------------------------------------
  it("tracker.startedAt and runWriter.start({startedAt}) are numeric (ms)", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const rw = fakeRunWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler: sched.scheduler,
      runWriter: rw.writer,
      ...BASE_DEPS,
    })();
    expect(rw.starts).toHaveLength(1);
    expect(typeof rw.starts[0]!.startedAt).toBe("number");
    expect(Number.isFinite(rw.starts[0]!.startedAt)).toBe(true);
    const captured = sched.trackerHistory[0] as ProbeRunTracker;
    expect(captured).toBeInstanceOf(ProbeRunTracker);
    expect(typeof captured.startedAt).toBe("number");
    expect(Number.isFinite(captured.startedAt)).toBe(true);
  });
});
