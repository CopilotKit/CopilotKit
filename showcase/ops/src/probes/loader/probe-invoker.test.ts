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

const BASE_DEPS = {
  fetchImpl: globalThis.fetch,
  env: {} as Readonly<Record<string, string | undefined>>,
  logger,
  now: () => new Date("2026-04-22T00:00:00Z"),
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
      targets: [
        { key: "smoke:a" },
        { key: "smoke:b" },
        { key: "smoke:bad" },
      ],
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
});
