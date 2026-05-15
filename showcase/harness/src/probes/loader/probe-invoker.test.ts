import { describe, it, expect, vi, onTestFinished } from "vitest";
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
    // Deterministic concurrency assertion via a barrier: the test
    // controls when each worker's `driver.run` is allowed to complete,
    // so the assertion does not depend on wall-clock timing.
    //
    // Procedure:
    //   1. Each worker enters `driver.run`, increments `inFlight`,
    //      registers a release promise, and awaits it.
    //   2. The TEST awaits `barrierReached` (resolved when `inFlight`
    //      hits 3 — the configured max_concurrency).
    //   3. With 3 workers held inside `driver.run`, peak === 3 is
    //      observed deterministically — no setTimeout-based sleep can
    //      produce a "false low" reading on an overloaded CI host.
    //   4. The test then releases ALL pending workers; subsequent
    //      workers process the remaining 7 inputs.
    //
    // If the pool only ever spawned 2 workers (a real bug we need to
    // catch), `barrierReached` would never resolve and the test fails
    // by timeout — exactly the failure mode we want.
    let inFlight = 0;
    let peak = 0;
    const concurrency = 3;
    const total = 10;
    const releasers: Array<() => void> = [];
    let resolveBarrier: () => void;
    const barrierReached = new Promise<void>((resolve) => {
      resolveBarrier = resolve;
    });
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        if (inFlight >= concurrency) {
          // First worker to observe full saturation releases the
          // barrier so the test can sample `peak`.
          resolveBarrier();
        }
        await new Promise<void>((release) => {
          releasers.push(release);
        });
        inFlight--;
        return {
          key: (input as { key: string }).key,
          state: "green",
          signal: {},
          observedAt: ctx.now().toISOString(),
        };
      },
    };
    const targets = Array.from({ length: total }, (_, i) => ({
      key: `smoke:t-${i}`,
    }));
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: concurrency,
      targets,
    };
    const { writer, writes } = mkWriter();
    const invocation = buildProbeInvoker(cfg, {
      driver,
      schedulerId: cfg.id,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    // Wait deterministically for the pool to fully saturate. If only
    // 2 workers ever start, this hangs and vitest fails the test by
    // its own per-test timeout — surfaces a half-broken pool.
    await barrierReached;
    expect(peak).toBe(concurrency);
    // Now drain: release each worker as it parks. Pool churn keeps
    // creating new releasers; loop until all `total` inputs have been
    // dispatched and resolved.
    while (writes.length < total) {
      const r = releasers.shift();
      if (r) r();
      else await new Promise((tick) => setImmediate(tick));
    }
    await invocation;
    expect(writes).toHaveLength(total);
    expect(peak).toBeLessThanOrEqual(concurrency);
    expect(peak).toBe(concurrency);
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    const elapsed = Date.now() - start;
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    // The invoker must return promptly on timeout — NOT wait for the
    // driver's 80ms sleep to complete. Allow ample slack for CI jitter:
    // we care that the invoker isn't blocking on the driver's full
    // 80ms sleep, not that it returns inside any particular tight bound.
    // 100ms is well under the 80ms+race-settle absolute lower bound for
    // a regression where the invoker awaited driverPromise instead.
    expect(elapsed).toBeLessThan(100);
    // The slow driver has NOT fired its setTimeout callback yet at the
    // time the invoker returned (timeout_ms=20 < driver-sleep=80), so
    // this assertion is deterministic: we read driverResolved
    // synchronously after `await invoker()` returns.
    expect(driverResolved).toBe(false);
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
      schedulerId: cfg.id,
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

  describe("e2e_demos shortest-service-first dispatch", () => {
    // Shortest-service-first dispatch (the de-facto spec lives in
    // `config/probes/e2e-demos.yml`'s top comment): when `cfg.kind ===
    // "e2e_demos"` the resolved discovery inputs MUST be sorted ascending
    // by `(input.demos?.length ?? 0)` before the bounded worker pool
    // consumes them. This prevents head-of-line blocking — the largest
    // services (e.g. 38 demos) starting at t=0 occupy a slot for the
    // entire fan-out, making small services queue behind them.
    //
    // Tie-breaks on `key` ascending so the order is fully deterministic
    // across ticks regardless of discovery enumeration order.
    function mkDemosDriver(opts?: {
      onStart?: (key: string) => void;
      delayFor?: (key: string) => number;
    }): ProbeDriver {
      const inputSchema = z
        .object({ key: z.string(), demos: z.array(z.string()).optional() })
        .passthrough();
      return {
        kind: "e2e_demos",
        inputSchema,
        async run(ctx, input) {
          const key = (input as { key: string }).key;
          opts?.onStart?.(key);
          const delay = opts?.delayFor?.(key) ?? 0;
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
          }
          return {
            key,
            state: "green",
            signal: {},
            observedAt: ctx.now().toISOString(),
          };
        },
      };
    }

    it("sorts e2e_demos discovery inputs ascending by demo count", async () => {
      // Inputs intentionally enumerated out of demo-count order: 38, 5,
      // 20, 0. The dispatch order (== writes order with concurrency=1)
      // must come out ascending: 0, 5, 20, 38.
      const records = [
        {
          name: "huge",
          demos: Array.from({ length: 38 }, (_, i) => `d${i}`),
        },
        {
          name: "small",
          demos: Array.from({ length: 5 }, (_, i) => `d${i}`),
        },
        {
          name: "medium",
          demos: Array.from({ length: 20 }, (_, i) => `d${i}`),
        },
        { name: "empty", demos: [] },
      ];
      const source: DiscoverySource = {
        name: "demos-src",
        configSchema: z.object({}).passthrough(),
        async enumerate() {
          return records;
        },
      };
      const discoveryRegistry = createDiscoveryRegistry();
      discoveryRegistry.register(source);
      const cfg: ProbeConfig = {
        kind: "e2e_demos",
        id: "e2e-demos",
        schedule: "0 */6 * * *",
        max_concurrency: 1, // serialize so writes order == dispatch order
        discovery: {
          source: "demos-src",
          filter: {},
          key_template: "e2e-demos:${name}",
        },
      };
      const { writer, writes } = mkWriter();
      const driver = mkDemosDriver();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
      })();
      expect(writes.map((w) => w.key)).toEqual([
        "e2e-demos:empty",
        "e2e-demos:small",
        "e2e-demos:medium",
        "e2e-demos:huge",
      ]);
    });

    it("breaks ties by key ascending when demo counts are equal", async () => {
      // Two records with identical demo count (3) and different names —
      // the one whose interpolated key sorts lower must dispatch first.
      const records = [
        { name: "zulu", demos: ["a", "b", "c"] },
        { name: "alpha", demos: ["a", "b", "c"] },
        { name: "mike", demos: ["a", "b", "c"] },
      ];
      const source: DiscoverySource = {
        name: "ties-src",
        configSchema: z.object({}).passthrough(),
        async enumerate() {
          return records;
        },
      };
      const discoveryRegistry = createDiscoveryRegistry();
      discoveryRegistry.register(source);
      const cfg: ProbeConfig = {
        kind: "e2e_demos",
        id: "e2e-demos",
        schedule: "0 */6 * * *",
        max_concurrency: 1,
        discovery: {
          source: "ties-src",
          filter: {},
          key_template: "e2e-demos:${name}",
        },
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver: mkDemosDriver(),
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
      })();
      expect(writes.map((w) => w.key)).toEqual([
        "e2e-demos:alpha",
        "e2e-demos:mike",
        "e2e-demos:zulu",
      ]);
    });

    it("prevents head-of-line blocking: small services finish before a large hung one even starts", async () => {
      // Construct a fan-out where the LARGE service (38 demos) hangs for
      // 500ms inside its driver call, and three small services (3 demos
      // each) resolve immediately. With max_concurrency=2, sorting
      // ascending means the two slots open up on the small services
      // first; the large service is the LAST to start. So all small
      // services finish before the large service starts.
      //
      // Without the sort, the large service occupies one slot from t=0
      // and small services queue behind in original enumeration order —
      // and the test below would fail because small finishes would land
      // AFTER large started.
      const startedAt: Record<string, number> = {};
      const finishedAt: Record<string, number> = {};
      let startCounter = 0;
      const records = [
        // Intentionally enumerated large-first so the unsorted path
        // would dispatch large at t=0.
        {
          name: "big",
          demos: Array.from({ length: 38 }, (_, i) => `d${i}`),
        },
        { name: "s1", demos: ["a", "b", "c"] },
        { name: "s2", demos: ["a", "b", "c"] },
        { name: "s3", demos: ["a", "b", "c"] },
      ];
      const source: DiscoverySource = {
        name: "starvation-src",
        configSchema: z.object({}).passthrough(),
        async enumerate() {
          return records;
        },
      };
      const discoveryRegistry = createDiscoveryRegistry();
      discoveryRegistry.register(source);
      const cfg: ProbeConfig = {
        kind: "e2e_demos",
        id: "e2e-demos",
        schedule: "0 */6 * * *",
        max_concurrency: 2,
        discovery: {
          source: "starvation-src",
          filter: {},
          key_template: "e2e-demos:${name}",
        },
      };
      const inputSchema = z
        .object({ key: z.string(), demos: z.array(z.string()).optional() })
        .passthrough();
      const driver: ProbeDriver = {
        kind: "e2e_demos",
        inputSchema,
        async run(ctx, input) {
          const key = (input as { key: string; demos?: string[] }).key;
          const demos = (input as { demos?: string[] }).demos ?? [];
          // Use a monotonic counter so start ordering is unambiguous
          // independent of Date.now() millisecond resolution. (Tests
          // running fast enough can produce identical Date.now() reads
          // for sequentially-dispatched workers.)
          startedAt[key] = startCounter++;
          // Big hangs 500ms; smalls take ~10ms so the post-dispatch
          // ordering is observable in real-time too.
          if (demos.length > 10) {
            await new Promise((r) => setTimeout(r, 500));
          } else {
            await new Promise((r) => setTimeout(r, 10));
          }
          finishedAt[key] = Date.now();
          return {
            key,
            state: "green",
            signal: {},
            observedAt: ctx.now().toISOString(),
          };
        },
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
      })();
      expect(writes).toHaveLength(4);
      // The big service must have STARTED strictly AFTER all three
      // small services have STARTED — only possible if the sort placed
      // big at the very end of the dispatch queue.
      //
      // Without the sort, big is enumerated first and worker-1 starts
      // it at t=0; worker-2 picks up s1 at t=0; s2/s3 then queue
      // behind worker-2 (since worker-1 is hung on big for 500ms). So
      // unsorted, big starts at-or-before s2/s3.
      //
      // With the sort, dispatch order is s1, s2, s3, big (key tiebreak):
      // workers 1+2 run s1+s2 in parallel at t=0; s3 picks up the slot
      // freed by s1; big picks up the next freed slot. So big starts
      // AFTER all three smalls.
      const bigStart = startedAt["e2e-demos:big"];
      expect(bigStart).toBeDefined();
      for (const small of ["e2e-demos:s1", "e2e-demos:s2", "e2e-demos:s3"]) {
        const smallStart = startedAt[small];
        expect(smallStart).toBeDefined();
        expect(smallStart!).toBeLessThan(bigStart!);
      }
    });

    it("does NOT sort inputs for non-e2e_demos kinds (preserves resolveInputs order)", async () => {
      // For a different kind (image_drift here), discovery enumeration
      // order must be preserved verbatim — the sort is gated on
      // cfg.kind === "e2e_demos" alone.
      const records = [
        { name: "huge", demos: Array.from({ length: 38 }, (_, i) => `d${i}`) },
        { name: "small", demos: ["a"] },
        {
          name: "medium",
          demos: Array.from({ length: 20 }, (_, i) => `d${i}`),
        },
      ];
      const source: DiscoverySource = {
        name: "noop-src",
        configSchema: z.object({}).passthrough(),
        async enumerate() {
          return records;
        },
      };
      const discoveryRegistry = createDiscoveryRegistry();
      discoveryRegistry.register(source);
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
      const cfg: ProbeConfig = {
        kind: "image_drift",
        id: "image-drift",
        schedule: "*/15 * * * *",
        max_concurrency: 1, // serialize so write order == dispatch order
        discovery: {
          source: "noop-src",
          filter: {},
          key_template: "image_drift:${name}",
        },
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
      })();
      // Enumeration order preserved: huge, small, medium.
      expect(writes.map((w) => w.key)).toEqual([
        "image_drift:huge",
        "image_drift:small",
        "image_drift:medium",
      ]);
    });
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
      schedulerId: cfg.id,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(observedAborted).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("green");
  });

  describe("synthetic-error errorClass discriminator", () => {
    it("sets errorClass='timeout' when driver exceeds timeout_ms", async () => {
      const inputSchema = z.object({ key: z.string() }).passthrough();
      const driver: ProbeDriver = {
        kind: "smoke",
        inputSchema,
        async run() {
          await new Promise((r) => setTimeout(r, 200));
          return {
            key: "x",
            state: "green",
            signal: {},
            observedAt: "now",
          };
        },
      };
      const cfg: ProbeConfig = {
        kind: "smoke",
        id: "smoke",
        schedule: "*/15 * * * *",
        max_concurrency: 1,
        timeout_ms: 20,
        targets: [{ key: "smoke:slow" }],
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        ...BASE_DEPS,
      })();
      expect(writes[0]!.state).toBe("error");
      const sig = writes[0]!.signal as { errorClass?: string };
      expect(sig.errorClass).toBe("timeout");
    });

    it("sets errorClass='input-rejected' when inputSchema rejects", async () => {
      const inputSchema = z.object({ key: z.string(), url: z.string().url() });
      const driver: ProbeDriver<z.infer<typeof inputSchema>> = {
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
      const cfg: ProbeConfig = {
        kind: "smoke",
        id: "smoke",
        schedule: "*/15 * * * *",
        max_concurrency: 1,
        // No url → schema rejects
        targets: [{ key: "smoke:bad" }],
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        ...BASE_DEPS,
      })();
      expect(writes[0]!.state).toBe("error");
      const sig = writes[0]!.signal as { errorClass?: string };
      expect(sig.errorClass).toBe("input-rejected");
    });

    it("sets errorClass='driver-error' when driver throws", async () => {
      const inputSchema = z.object({ key: z.string() }).passthrough();
      const driver: ProbeDriver = {
        kind: "smoke",
        inputSchema,
        async run() {
          throw new Error("boom");
        },
      };
      const cfg: ProbeConfig = {
        kind: "smoke",
        id: "smoke",
        schedule: "*/15 * * * *",
        max_concurrency: 1,
        targets: [{ key: "smoke:explode" }],
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        ...BASE_DEPS,
      })();
      expect(writes[0]!.state).toBe("error");
      const sig = writes[0]!.signal as { errorClass?: string };
      expect(sig.errorClass).toBe("driver-error");
    });

    it("sets errorClass='discovery-source-missing' on unknown source typo", async () => {
      const inputSchema = z.object({ key: z.string() }).passthrough();
      const driver: ProbeDriver = {
        kind: "image_drift",
        inputSchema,
        async run() {
          throw new Error("should never run");
        },
      };
      const cfg: ProbeConfig = {
        kind: "image_drift",
        id: "image-drift",
        schedule: "*/15 * * * *",
        max_concurrency: 1,
        discovery: {
          source: "definitely-not-registered",
          filter: {},
          key_template: "image_drift:${name}",
        },
      };
      const { writer, writes } = mkWriter();
      await buildProbeInvoker(cfg, {
        schedulerId: cfg.id,
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        ...BASE_DEPS,
      })();
      // Synthetic dashboard tick instead of silent zero-write.
      expect(writes).toHaveLength(1);
      expect(writes[0]!.key).toBe("discovery:image-drift");
      expect(writes[0]!.state).toBe("error");
      const sig = writes[0]!.signal as { errorClass?: string };
      expect(sig.errorClass).toBe("discovery-source-missing");
    });
  });

  // Late driver rejection must not surface as unhandledRejection.
  it("does not surface unhandledRejection when driver rejects after timeout", async () => {
    // Tag this test's rejection with a unique marker so a sibling test
    // running in the same worker process can't pollute our captured
    // list. `onTestFinished` guarantees listener cleanup even if the
    // assertions throw. Vitest runs files in worker processes by
    // default, but explicit isolation here is cheap insurance.
    const REJECTION_MARKER = `f1-late-${Date.now()}-${Math.random()}`;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      // Filter to only this test's tagged rejection — siblings'
      // late rejections (if any leaked through process isolation)
      // get ignored rather than failing this test.
      if (
        reason instanceof Error &&
        reason.message.includes(REJECTION_MARKER)
      ) {
        unhandled.push(reason);
      }
    };
    process.on("unhandledRejection", onUnhandled);
    onTestFinished(() => {
      process.off("unhandledRejection", onUnhandled);
    });
    const inputSchema = z.object({ key: z.string() }).passthrough();
    // Promise we resolve from inside the driver right AFTER it
    // schedules its late rejection — the test awaits this to
    // deterministically observe the rejection rather than relying on
    // wall-clock alone. Belt-and-suspenders: the wall-clock wait
    // below is also bumped to 250ms for slow CI hosts.
    let signalRejected: () => void;
    const whenRejected = new Promise<void>((resolve) => {
      signalRejected = resolve;
    });
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        // Reject AFTER the invoker has timed out and moved on.
        await new Promise<void>((_, reject) => {
          ctx.abortSignal?.addEventListener(
            "abort",
            () => {
              // Reject async on next tick so the race has settled
              // first. Resolve `whenRejected` immediately AFTER
              // scheduling reject so the test observes that the
              // late-rejection actually occurred.
              setTimeout(() => {
                reject(new Error(`late driver rejection ${REJECTION_MARKER}`));
                signalRejected();
              }, 5);
            },
            { once: true },
          );
        });
        // Unreachable — promise above always rejects on abort. The
        // return is here to satisfy the ProbeDriver.run signature.
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
      max_concurrency: 1,
      timeout_ms: 15,
      targets: [{ key: "smoke:late-rejector" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    // Deterministically wait for the driver's late rejection to fire
    // before checking the unhandledRejection listener — relying on
    // wall-clock alone could pass vacuously on slow CI hosts. Then
    // give the event-loop another 250ms so any unhandledRejection
    // that *would* fire has time to land in the listener queue.
    await whenRejected;
    await new Promise((r) => setTimeout(r, 250));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    // Filtered to only this test's marker — sibling-test rejections
    // (if any) cannot pollute the count.
    expect(unhandled).toHaveLength(0);
  });

  it("falls back to {key} when a discovery record is an array", async () => {
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
      name: "array-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Intentionally return an array record (typeof === "object" but
        // the spread would lose array shape).
        return [["one", "two", "three"]];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "array-src",
        filter: {},
        // Static template — no path interpolation needed for this test.
        key_template: "image_drift:array",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    // The driver receives `{ key }` rather than a spread array.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe("image_drift:array");
  });

  it("emits unique unresolved-suffix keys when template paths collide", async () => {
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
      name: "missing-path-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Both records have no `name` — a naive interpolator would
        // collapse both keys to `image_drift:` and the writer would
        // overwrite one with the other.
        return [{ id: "a" }, { id: "b" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "missing-path-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(2);
    const keys = writes.map((w) => w.key);
    // Unique invalid-key-template keys per record so the writer doesn't
    // collapse them into one row (CR-A1.2 strict-interpolator semantics).
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) {
      expect(k).toMatch(/:invalid-key-template:/);
    }
  });

  it("emits unresolved-suffix when template path resolves to non-primitive", async () => {
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
      name: "non-primitive-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // `service` is itself an object — interpolation should NOT
        // call String() on it (would produce "[object Object]").
        return [{ service: { name: "foo" } }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "non-primitive-src",
        filter: {},
        key_template: "image_drift:${service}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).not.toMatch(/\[object Object\]/);
    expect(writes[0]!.key).toMatch(/:invalid-key-template:/);
  });

  it("returns within timeout when source.enumerate hangs", async () => {
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
      name: "hanging-src",
      configSchema: z.object({}).passthrough(),
      async enumerate(opts) {
        // Honour abortSignal so the timeout-fired abort releases the
        // promise. A source that never observed abortSignal would
        // hang forever — that's a separate driver bug, not the
        // invoker's responsibility.
        await new Promise<void>((_, reject) => {
          opts.abortSignal?.addEventListener(
            "abort",
            () => reject(opts.abortSignal?.reason ?? new Error("aborted")),
            { once: true },
          );
        });
        return [];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      timeout_ms: 25,
      discovery: {
        source: "hanging-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    const start = Date.now();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    const elapsed = Date.now() - start;
    // (a) returns within timeout (with generous CI slack)
    expect(elapsed).toBeLessThan(500);
    // (b) ONE synthetic ProbeResult emitted with `errorClass:
    // "discovery-error"`. Earlier behaviour was zero writes (silently
    // indistinguishable from "no services matched the filter"); the
    // catch path now surfaces a sentinel ResolvedInput so operators
    // see a red tick instead.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe("discovery:image-drift");
    expect(writes[0]!.state).toBe("error");
    const sig = writes[0]!.signal as { errorClass?: string };
    expect(sig.errorClass).toBe("discovery-error");
  });

  it("isolates writer.write failures: sibling targets still write", async () => {
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
      max_concurrency: 1,
      targets: [
        { key: "smoke:a" },
        { key: "smoke:bad-writer" },
        { key: "smoke:c" },
      ],
    };
    let attempted = 0;
    const successful: string[] = [];
    const writer: StatusWriter = {
      async write(result) {
        attempted++;
        if (result.key === "smoke:bad-writer") {
          throw new Error("pb down");
        }
        successful.push(result.key);
        return {
          previousState: null,
          newState: "green",
          transition: "first",
          firstFailureAt: null,
          failCount: 0,
        };
      },
    };
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    // All 3 targets attempted writes; failing key did not stop siblings.
    expect(attempted).toBe(3);
    expect(successful.sort()).toEqual(["smoke:a", "smoke:c"]);
  });

  it("emits one synthetic discovery-error tick when source.enumerate throws", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "image_drift",
      inputSchema,
      async run() {
        throw new Error("driver should not run when discovery throws");
      },
    };
    const throwingSource: DiscoverySource = {
      name: "throwing-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        throw new Error("railway gql 500: synthetic-failure");
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(throwingSource);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "throwing-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    // (a) Exactly one tick written for the failed enumerate.
    expect(writes).toHaveLength(1);
    // (b) errorClass is discovery-error (NOT discovery-source-missing
    //     — the source IS registered, it just threw at runtime).
    expect(writes[0]!.key).toBe("discovery:image-drift");
    expect(writes[0]!.state).toBe("error");
    const sig = writes[0]!.signal as {
      errorClass?: string;
      errorDesc?: string;
    };
    expect(sig.errorClass).toBe("discovery-error");
    expect(sig.errorDesc).toContain("synthetic-failure");
  });

  it("isolates discovery-error from sibling probes' invocations", async () => {
    // Two probes share the same writer in production: one with a
    // throwing discovery source, the other with a working static
    // target. The throwing one must NOT prevent the working one from
    // emitting normal ticks. We invoke them sequentially against the
    // same writer to mimic two probe-invoker calls from the
    // orchestrator.
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const goodDriver: ProbeDriver = {
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
    const badDriver: ProbeDriver = {
      kind: "image_drift",
      inputSchema,
      async run() {
        throw new Error("never");
      },
    };
    const throwingSource: DiscoverySource = {
      name: "throwing-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        throw new Error("railway gql 500");
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(throwingSource);

    const { writer, writes } = mkWriter();

    // Bad probe — should write one synthetic discovery-error tick.
    await buildProbeInvoker(
      {
        kind: "image_drift",
        id: "image-drift",
        schedule: "*/15 * * * *",
        max_concurrency: 4,
        discovery: {
          source: "throwing-src",
          filter: {},
          key_template: "image_drift:${name}",
        },
      },
      {
        driver: badDriver,
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
        schedulerId: "image_drift",
      },
    )();

    // Good probe — should write its 2 normal ticks, untouched.
    await buildProbeInvoker(
      {
        kind: "smoke",
        id: "smoke",
        schedule: "*/15 * * * *",
        max_concurrency: 4,
        targets: [{ key: "smoke:a" }, { key: "smoke:b" }],
      },
      {
        driver: goodDriver,
        discoveryRegistry,
        writer,
        ...BASE_DEPS,
        schedulerId: "smoke",
      },
    )();

    expect(writes).toHaveLength(3);
    // The synthetic discovery-error tick exists alongside the two
    // green sibling-probe ticks.
    const errors = writes.filter((w) => w.state === "error");
    const greens = writes.filter((w) => w.state === "green");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.key).toBe("discovery:image-drift");
    expect(greens.map((w) => w.key).sort()).toEqual(["smoke:a", "smoke:b"]);
  });

  // Empty strings short-circuit the same way `undefined`/`null` do — every
  // `""` resolution would otherwise stringify to `""` and collapse multiple
  // siblings to the same writer key. `0` and `false` are real primitives
  // and must still flow through verbatim.
  it("treats empty-string resolved paths as unresolvable (collision avoidance)", async () => {
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
      name: "empty-str-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Both records have an explicit `name: ""` field. A naive
        // primitive-pass-through would collapse both keys to
        // `image_drift:` and the writer would dedupe one onto the other.
        return [{ name: "" }, { name: "" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "empty-str-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(2);
    const keys = writes.map((w) => w.key);
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) {
      expect(k).toMatch(/:invalid-key-template:/);
    }
  });

  it("preserves `0` and `false` primitives verbatim in interpolateTemplate", async () => {
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
      name: "primitive-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Real primitives that are NOT empty strings must still
        // stringify normally — `0` and `false` are valid path values.
        return [{ idx: 0 }, { idx: false }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "primitive-src",
        filter: {},
        key_template: "drift:${idx}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes.map((w) => w.key).sort()).toEqual(["drift:0", "drift:false"]);
  });

  it("logs probe.driver-late-rejection at debug when driver rejects post-timeout", async () => {
    const debugCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
    const captureLogger = {
      debug: (msg: string, meta?: Record<string, unknown>) => {
        debugCalls.push({ msg, meta });
      },
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    let rejectionFired: () => void;
    const whenRejected = new Promise<void>((resolve) => {
      rejectionFired = resolve;
    });
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx) {
        await new Promise<void>((_, reject) => {
          ctx.abortSignal?.addEventListener(
            "abort",
            () => {
              setTimeout(() => {
                reject(new TypeError("late-driver-typeerror"));
                rejectionFired();
              }, 5);
            },
            { once: true },
          );
        });
        // Unreachable.
        return {
          key: "x",
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
      max_concurrency: 1,
      timeout_ms: 15,
      targets: [{ key: "smoke:late-rejector" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    await whenRejected;
    // Microtask flush so the .catch callback runs.
    await new Promise((r) => setTimeout(r, 50));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    const lateRejection = debugCalls.find(
      (c) => c.msg === "probe.driver-late-rejection",
    );
    expect(lateRejection).toBeDefined();
    expect(lateRejection!.meta).toMatchObject({
      probeId: "smoke",
      kind: "smoke",
      key: "smoke:late-rejector",
      errName: "TypeError",
    });
    expect(String(lateRejection!.meta?.err)).toContain("late-driver-typeerror");
  });

  it("populates signal.errName on driver-error from err.name", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        throw new TypeError("nope");
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      targets: [{ key: "smoke:typerr" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    const sig = writes[0]!.signal as {
      errorClass?: string;
      errName?: string;
    };
    expect(sig.errorClass).toBe("driver-error");
    expect(sig.errName).toBe("TypeError");
  });

  it("populates signal.errName on input-rejected from ZodError name", async () => {
    const inputSchema = z.object({ key: z.string(), url: z.string().url() });
    const driver: ProbeDriver<z.infer<typeof inputSchema>> = {
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
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      targets: [{ key: "smoke:no-url" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    const sig = writes[0]!.signal as {
      errorClass?: string;
      errName?: string;
    };
    expect(sig.errorClass).toBe("input-rejected");
    expect(sig.errName).toBe("ZodError");
  });

  it("does NOT sort static-targets e2e_demos configs (gate on discovery)", async () => {
    // A hypothetical static-target e2e_demos config has records that
    // lack `demos`, so demoCount=0 for every entry and the tie-break on
    // `key` would silently re-order YAML if the gate was loose. The
    // tightened gate `kind === "e2e_demos" && "discovery" in cfg`
    // prevents that.
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "e2e_demos",
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
      kind: "e2e_demos",
      id: "e2e-demos-static",
      schedule: "0 */6 * * *",
      max_concurrency: 1, // serialize so writes order == dispatch order
      // Intentionally non-alphabetic order: zulu, alpha, mike. With a
      // loose gate, all three demoCount=0 → tie-break by key would
      // re-order to alpha, mike, zulu. The tight gate must preserve
      // YAML order verbatim.
      targets: [{ key: "zulu" }, { key: "alpha" }, { key: "mike" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes.map((w) => w.key)).toEqual(["zulu", "alpha", "mike"]);
  });

  it("warns probe.discovery-record-key-shadowed when record carries differing `key`", async () => {
    const warns: { msg: string; meta?: Record<string, unknown> }[] = [];
    const captureLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warns.push({ msg, meta });
      },
      error: () => {},
    };
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
      name: "key-shadow-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // First record carries an inherent `key` that the interpolation
        // will override; the warning must fire for it but NOT for the
        // second record (which has no `key` field).
        return [{ name: "alpha", key: "stale-from-source" }, { name: "beta" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "key-shadow-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    // Interpolated key still wins (the writer dedupes on it).
    expect(writes.map((w) => w.key).sort()).toEqual([
      "image_drift:alpha",
      "image_drift:beta",
    ]);
    // Warning fires once, only for the shadowed record.
    const shadowWarns = warns.filter(
      (w) => w.msg === "probe.discovery-record-key-shadowed",
    );
    expect(shadowWarns).toHaveLength(1);
    expect(shadowWarns[0]!.meta).toMatchObject({
      probeId: "image-drift",
      recordIndex: 0,
      interpolatedKey: "image_drift:alpha",
      recordKey: "stale-from-source",
    });
  });

  // Normal driver rejection (BEFORE timeout) must produce a single
  // `probe.run-failed` log — NOT a duplicate `probe.driver-late-rejection`.
  // The detached-catch observer is guarded behind `timedOut === true` so
  // only the timeout-and-then-late path emits the late-rejection key.
  it("does not double-log on normal driver rejection (no late-rejection log)", async () => {
    const debugCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
    const errorCalls: { msg: string; meta?: Record<string, unknown> }[] = [];
    const captureLogger = {
      debug: (msg: string, meta?: Record<string, unknown>) => {
        debugCalls.push({ msg, meta });
      },
      info: () => {},
      warn: () => {},
      error: (msg: string, meta?: Record<string, unknown>) => {
        errorCalls.push({ msg, meta });
      },
    };
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        // Reject promptly — well under the timeout. The race observes
        // this rejection in the outer catch (which logs run-failed);
        // the detached `.catch` MUST NOT also fire its late-rejection
        // log because we never timed out.
        throw new Error("normal-failure");
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      // timeout_ms set so we go through the race path (with a detached
      // catch attached), but the driver rejects WAY before the timer.
      timeout_ms: 5000,
      targets: [{ key: "smoke:fast-failure" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    // Microtask flush so the detached `.catch` would have fired by now
    // if the guard were missing.
    await new Promise((r) => setTimeout(r, 50));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    // Exactly one `run-failed` log. No `driver-late-rejection` log
    // since the guard `if (!timedOut) return;` short-circuits before
    // the debug call.
    const runFailed = errorCalls.filter((c) => c.msg === "probe.run-failed");
    expect(runFailed).toHaveLength(1);
    const lateRejection = debugCalls.filter(
      (c) => c.msg === "probe.driver-late-rejection",
    );
    expect(lateRejection).toHaveLength(0);
  });

  // Timeout path stamps `errName: "TimeoutError"` on the synthetic
  // signal so operators can disambiguate timeout vs. driver-error
  // without parsing free-form errorDesc.
  it("populates signal.errName='TimeoutError' on timeout path", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        // Driver hangs past the timeout. The invoker wins the race and
        // returns a synthetic-timeout result.
        await new Promise((r) => setTimeout(r, 200));
        return {
          key: "x",
          state: "green",
          signal: {},
          observedAt: "now",
        };
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      timeout_ms: 15,
      targets: [{ key: "smoke:hangs" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("error");
    const sig = writes[0]!.signal as {
      errorClass?: string;
      errName?: string;
    };
    expect(sig.errorClass).toBe("timeout");
    expect(sig.errName).toBe("TimeoutError");
  });

  // Discovery records that are null/undefined/primitive (not just
  // arrays) must surface a single `probe.discovery-record-non-object`
  // warn so silent zero-info inputs don't slip through.
  it("warns probe.discovery-record-non-object on null and primitive records", async () => {
    const warns: { msg: string; meta?: Record<string, unknown> }[] = [];
    const captureLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warns.push({ msg, meta });
      },
      error: () => {},
    };
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
      name: "non-obj-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // Mix of non-object record kinds: null, number, string, boolean.
        return [null, 42, "hello", true];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "non-obj-src",
        filter: {},
        key_template: "image_drift:rec",
      },
    };
    const { writer } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    const nonObjectWarns = warns.filter(
      (w) => w.msg === "probe.discovery-record-non-object",
    );
    // One warn per non-object record (4 total).
    expect(nonObjectWarns).toHaveLength(4);
    const kinds = nonObjectWarns.map((w) => w.meta?.recordKind).sort();
    expect(kinds).toEqual(["boolean", "null", "number", "string"]);
  });

  // When loadDemosMap fails (every record's demoCount=0), the sort
  // would silently re-order alphabetically by key. Skip the sort and
  // emit a warn so operators can correlate.
  it("skips sort and warns when no e2e_demos input has demos", async () => {
    const warns: { msg: string; meta?: Record<string, unknown> }[] = [];
    const captureLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warns.push({ msg, meta });
      },
      error: () => {},
    };
    const inputSchema = z
      .object({ key: z.string(), demos: z.array(z.string()).optional() })
      .passthrough();
    const driver: ProbeDriver = {
      kind: "e2e_demos",
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
    // Intentionally non-alphabetic order. With the sort short-circuit,
    // dispatch (and thus write) order matches enumeration order
    // verbatim. Without the short-circuit, the tie-break on `key`
    // would re-order to alpha, mike, zulu.
    const records = [{ name: "zulu" }, { name: "alpha" }, { name: "mike" }];
    const source: DiscoverySource = {
      name: "no-demos-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return records;
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "e2e_demos",
      id: "e2e-demos",
      schedule: "0 */6 * * *",
      max_concurrency: 1, // serialize so writes order == dispatch order
      discovery: {
        source: "no-demos-src",
        filter: {},
        key_template: "e2e-demos:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    expect(writes.map((w) => w.key)).toEqual([
      "e2e-demos:zulu",
      "e2e-demos:alpha",
      "e2e-demos:mike",
    ]);
    const sortWarn = warns.filter(
      (w) => w.msg === "probe.e2e-demos.sort-no-demos",
    );
    expect(sortWarn).toHaveLength(1);
    expect(sortWarn[0]!.meta).toMatchObject({
      probeId: "e2e-demos",
      inputCount: 3,
    });
  });

  // Driver error messages pass through `truncateUtf8` before landing on
  // the synthetic ProbeResult — without this, a multi-MB Playwright
  // stack trace blows past PB / Slack render budgets.
  it("bounds synthetic errorDesc length when driver throws a huge message", async () => {
    const huge = "X".repeat(50_000); // 50KB error message
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run() {
        throw new Error(huge);
      },
    };
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      targets: [{ key: "smoke:huge-error" }],
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    const sig = writes[0]!.signal as { errorDesc?: string };
    expect(sig.errorDesc).toBeDefined();
    // Bounded by the 1200-char synthetic-error budget — well below the
    // 50K input.
    expect(sig.errorDesc!.length).toBeLessThanOrEqual(1200);
  });

  // Discovery returning zero records (everything filtered out) must
  // emit a `probe.no-inputs` info log so operators can correlate "no
  // signal" against "discovery returned empty". Behaviour unchanged —
  // observability only.
  it("emits probe.no-inputs info log when discovery returns zero records", async () => {
    const infos: { msg: string; meta?: Record<string, unknown> }[] = [];
    const captureLogger = {
      debug: () => {},
      info: (msg: string, meta?: Record<string, unknown>) => {
        infos.push({ msg, meta });
      },
      warn: () => {},
      error: () => {},
    };
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "image_drift",
      inputSchema,
      async run() {
        throw new Error("must not run");
      },
    };
    const source: DiscoverySource = {
      name: "empty-after-filter-src",
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
      max_concurrency: 1,
      discovery: {
        source: "empty-after-filter-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    expect(writes).toHaveLength(0);
    const noInputs = infos.filter((c) => c.msg === "probe.no-inputs");
    expect(noInputs).toHaveLength(1);
    expect(noInputs[0]!.meta).toMatchObject({
      probeId: "image-drift",
      kind: "image_drift",
    });
  });

  it("does NOT warn key-shadowed when record's `key` matches interpolated key", async () => {
    const warns: { msg: string }[] = [];
    const captureLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => {
        warns.push({ msg });
      },
      error: () => {},
    };
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
      name: "matching-key-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [{ name: "alpha", key: "image_drift:alpha" }];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      discovery: {
        source: "matching-key-src",
        filter: {},
        key_template: "image_drift:${name}",
      },
    };
    const { writer } = mkWriter();
    await buildProbeInvoker(cfg, {
      schedulerId: cfg.id,
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
      logger: captureLogger,
    })();
    expect(
      warns.filter((w) => w.msg === "probe.discovery-record-key-shadowed"),
    ).toHaveLength(0);
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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

  // ---------------------------------------------------------------------
  // R3-A.3: orphan-risk warn log when runWriter.start fails
  // ---------------------------------------------------------------------
  // When PB's `start()` fails after the row may have been created at the PB
  // side (network blip on the response), runRowId is null and the row is
  // orphaned. The probe-invoker must emit a structured `probe.run-row-orphan-risk`
  // warn log so operators can find and clean up orphans, in ADDITION to the
  // existing `probe.run-writer-start-failed` error log. Run continues
  // normally (best-effort observability), and finish() is short-circuited
  // because runRowId is null.
  it("R3-A.3: emits probe.run-row-orphan-risk warn when runWriter.start throws", async () => {
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
      id: "orphan-risk",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    const sched = fakeScheduler();
    const failingWriter: ProbeRunWriter = {
      start: vi.fn().mockRejectedValue(new Error("network blip")),
      finish: vi.fn().mockResolvedValue(undefined),
      recent: vi.fn().mockResolvedValue([]),
    };
    // Capture logger.warn calls. The fix emits an orphan-risk warn under
    // the canonical key `probe.run-row-orphan-risk` so operators have an
    // explicit signal beyond the existing error log.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    let orphan: unknown[] | undefined;
    try {
      await buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        scheduler: sched.scheduler,
        schedulerId: "probe:orphan-risk",
        runWriter: failingWriter,
        ...BASE_DEPS,
      })();
      // Snapshot the matching call BEFORE mockRestore — vitest's
      // `mockRestore()` clears `mock.calls` along with restoring the
      // original implementation, so reading the array after restore
      // returns an empty list and the assertion below would always fail.
      orphan = warnSpy.mock.calls.find(
        ([msg]) => msg === "probe.run-row-orphan-risk",
      );
    } finally {
      warnSpy.mockRestore();
    }
    expect(orphan).toBeDefined();
    expect(orphan![1]).toMatchObject({ probeId: "orphan-risk" });
    // finish() must NOT have been called when start() failed — the row id
    // was never set, so any update would either throw or write junk.
    expect(failingWriter.finish).not.toHaveBeenCalled();
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
        schedulerId: cfg.id,
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
        schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })({ filter: { slugs: ["smoke:b"] } });
    expect(enumerateInvocations).toBe(1);
    expect(enumerateRecordCount).toBe(3);
    expect(writes.map((w) => w.key)).toEqual(["smoke:b"]);
  });

  // ---------------------------------------------------------------------
  // R3-A.1: preError entries MUST NOT be silently dropped under filter.slugs
  // ---------------------------------------------------------------------
  // Pre-fix, the trigger filter ran `inputs = allInputs.filter(r => wanted.has(r.key))`
  // — preError entries (synthetic `<probeId>:invalid-key-template:N` keys)
  // got dropped because their keys never match operator-supplied slugs.
  // Discovery-time key_template errors that would surface on a cron tick
  // were HIDDEN under a manual filter — exactly the path operators use to
  // INVESTIGATE problems silently swallowed them.
  it("R3-A.1: retains preError synthetic entries even when filter.slugs is supplied", async () => {
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
    const source: DiscoverySource = {
      name: "filter-prerror-src",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        // One record with a missing template field (yields preError
        // synthetic key) and two records with valid `name` fields so
        // the operator's slug filter can target one of them.
        return [
          { kind: "x" }, // missing `name` → preError
          { name: "alpha" },
          { name: "beta" },
        ];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(source);
    const cfg: ProbeConfig = {
      kind: "smoke",
      id: "missing-and-filtered",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      discovery: {
        source: "filter-prerror-src",
        filter: {},
        key_template: "smoke:${name}",
      },
    };
    const { writer, writes } = mkWriter();
    await buildProbeInvoker(cfg, {
      driver,
      schedulerId: cfg.id,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })({ filter: { slugs: ["smoke:alpha"] } });
    // Operator asked for ONE specific slug, but the preError MUST also
    // surface — otherwise the operator's manual investigation can't see
    // the misconfigured record at all. Expect the alpha tile + the
    // preError synthetic-error tile.
    const keys = writes.map((w) => w.key).sort();
    expect(keys).toContain("smoke:alpha");
    const preErrorKey = keys.find((k) => k.startsWith("missing-and-filtered:"));
    expect(preErrorKey).toBeDefined();
    expect(preErrorKey).toMatch(/invalid-key-template/);
    // The pre-error entry must be a synthetic-error.
    const preErrorTile = writes.find((w) => w.key === preErrorKey);
    expect(preErrorTile?.state).toBe("error");
    // Beta was NOT requested → must NOT appear.
    expect(keys).not.toContain("smoke:beta");
  });

  // ---------------------------------------------------------------------
  // R3-A.2: invoker uses prefixed scheduler-id (probe:<cfg.id>)
  // ---------------------------------------------------------------------
  // Orchestrator registers entries as `probe:${cfg.id}`. Pre-fix the invoker
  // called `scheduler.getEntry(cfg.id)` and `scheduler.setEntryTracker(cfg.id, ...)`
  // with the BARE id, so getEntry returned undefined and setEntryTracker
  // was a silent no-op against the live scheduler. Tracker registration was
  // dead in production. Fix: thread `schedulerId` through ProbeInvokerDeps so
  // the invoker uses the same id the orchestrator registered.
  it("R3-A.2: invoker calls scheduler.getEntry/setEntryTracker with the schedulerId (not bare cfg.id)", async () => {
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
      id: "my-probe",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    // Capture all id arguments getEntry/setEntryTracker were called with.
    const getEntryIds: string[] = [];
    const setTrackerIds: string[] = [];
    const scheduler = {
      getEntry: (id: string) => {
        getEntryIds.push(id);
        return { triggeredRun: false };
      },
      setEntryTracker: (id: string, _tracker: ProbeRunTracker | null) => {
        setTrackerIds.push(id);
      },
    };
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler,
      // Caller (orchestrator) supplies the prefixed scheduler id. This
      // is the canonical scheduler entry id (`probe:<cfg.id>`).
      schedulerId: "probe:my-probe",
      ...BASE_DEPS,
    })();
    // Pre-fix: these arrays would contain "my-probe" (bare). Post-fix:
    // they must contain "probe:my-probe" (matching the orchestrator's
    // scheduler.register call site).
    expect(getEntryIds).toContain("probe:my-probe");
    expect(setTrackerIds).toContain("probe:my-probe");
    // And — defensively — must NOT contain the bare cfg.id.
    expect(getEntryIds).not.toContain("my-probe");
    expect(setTrackerIds).not.toContain("my-probe");
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
        schedulerId: cfg.id,
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
        schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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
      schedulerId: cfg.id,
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

  // ---------------------------------------------------------------------
  // R4-A.2: schedulerId is REQUIRED in ProbeInvokerDeps (no fallback)
  // ---------------------------------------------------------------------
  // R3-A.2 originally added `schedulerEntryId ?? cfg.id` as a "backwards-
  // compat" default. That re-introduced the exact silent-no-op bug it was
  // meant to fix: any caller that forgot the prefixed id (`probe:<cfg.id>`)
  // would fall back to the bare id, which doesn't match the live
  // scheduler entry → setEntryTracker silently no-ops in production.
  //
  // Per fail-loud discipline: the field is required at the type level, and
  // the runtime must use the supplied value verbatim (not a fallback).
  // This test pins both behaviors.
  it("R4-A.2: schedulerId is required — typecheck fails if omitted, runtime uses it verbatim", async () => {
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
      id: "bare-id",
      schedule: "*/15 * * * *",
      max_concurrency: 4,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    const setTrackerIds: string[] = [];
    const scheduler = {
      getEntry: (_id: string) => ({ triggeredRun: false }),
      setEntryTracker: (id: string, _tracker: ProbeRunTracker | null) => {
        setTrackerIds.push(id);
      },
    };
    // Runtime check: the invoker must use the supplied schedulerId
    // verbatim — NOT silently fall back to cfg.id when something
    // unexpected happens (the old `?? cfg.id` path).
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler,
      schedulerId: "probe:bare-id",
      ...BASE_DEPS,
    })();
    expect(setTrackerIds).toContain("probe:bare-id");
    expect(setTrackerIds).not.toContain("bare-id");

    // Typecheck check: omitting schedulerId must be a TS error. We can't
    // assert tsc behavior at runtime, but we CAN encode the contract via
    // a `@ts-expect-error` directive — if the field becomes optional
    // again (or grows a fallback), TS will refuse to allow the directive
    // and CI's `tsc --noEmit` will fail. That's the fail-loud signal.
    // The runtime call below is fenced behind `false` so the missing-id
    // invoker is constructed only at typecheck time, not at test time.
    if (false as boolean) {
      // @ts-expect-error schedulerId is required (R4-A.2). If this directive
      // becomes "unused", tsc will complain — that's the signal that the
      // field was made optional or grew a fallback again.
      buildProbeInvoker(cfg, {
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        scheduler,
        ...BASE_DEPS,
      });
    }
  });

  // ---------------------------------------------------------------------
  // R4-A.7: outer fan-out catch synthesizes a failed tile + bumps counter
  // ---------------------------------------------------------------------
  // Pre-fix the outer "unreachable" catch only logged. If an invariant
  // inside the fan-out broke, the run reported `failed: 0` and
  // `state: "completed"` while a real defect occurred — silently green.
  //
  // Post-fix: synthesize a `__internal_invariant__` synthetic-error tile
  // (writer.write), bump `failed`, flip `runState` to "failed", and
  // adjust the summary so `total === passed + failed` still holds.
  it("R4-A.7: outer fan-out catch synthesizes a failed tile, bumps counter, flips runState", async () => {
    const inputSchema = z.object({ key: z.string() }).passthrough();
    // Driver itself never executes — we throw from inside the fan-out by
    // way of a writer that explodes on the very first write so the
    // per-target catch can't swallow it. Instead, simpler approach:
    // rig the discoveryRegistry.get to return a source whose enumerate
    // returns OK, but then make the per-target writer throw a non-Error
    // value that the inner catch swallows; we still need the OUTER
    // catch to fire. The cleanest way: throw from the inner runOne by
    // monkey-patching the tracker. tracker.start is called inside
    // runOne BEFORE the per-target try/catch — make it throw, that
    // surfaces past Promise.all into the outer catch.
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
      id: "invariant-broken",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      targets: [{ key: "smoke:a" }],
    };
    const { writer, writes } = mkWriter();
    // Wire a fake scheduler whose setEntryTracker installs a tracker
    // whose `start()` throws synchronously. start() is invoked from
    // INSIDE runOne() (which is awaited by Promise.all inside the
    // outer try/catch), so the throw escapes Promise.all and lands in
    // the outer "unreachable" catch — the exact path R4-A.7 hardens.
    const scheduler = {
      getEntry: (_id: string) => ({ triggeredRun: false }),
      setEntryTracker: (_id: string, tracker: ProbeRunTracker | null) => {
        if (tracker) {
          tracker.start = () => {
            throw new Error("invariant-broken: tracker.start exploded");
          };
        }
      },
    };
    const summary = await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler,
      schedulerId: "probe:invariant-broken",
      ...BASE_DEPS,
    })();
    // Synthetic-error tile must be present in the writer stream and
    // keyed off the `__internal_invariant__` sentinel.
    const internalTile = writes.find((w) =>
      w.key.endsWith(":__internal_invariant__"),
    );
    expect(internalTile).toBeDefined();
    expect(internalTile?.state).toBe("error");
    // Summary invariant: total === passed + failed, with failed >= 1.
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.total).toBe(summary.passed + summary.failed);
  });

  it("R4-A.7: outer-catch run is persisted with state='failed' via runWriter.finish", async () => {
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
      id: "invariant-broken-2",
      schedule: "*/15 * * * *",
      max_concurrency: 1,
      targets: [{ key: "smoke:a" }],
    };
    const { writer } = mkWriter();
    const scheduler = {
      getEntry: (_id: string) => ({ triggeredRun: false }),
      setEntryTracker: (_id: string, tracker: ProbeRunTracker | null) => {
        if (tracker) {
          tracker.start = () => {
            throw new Error("invariant-broken: start threw");
          };
        }
      },
    };
    const rw = fakeRunWriter();
    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry: createDiscoveryRegistry(),
      writer,
      scheduler,
      schedulerId: "probe:invariant-broken-2",
      runWriter: rw.writer,
      ...BASE_DEPS,
    })();
    // The persisted run row must reflect state="failed" so dashboards
    // surface the tick as a real failure rather than fake-green.
    expect(rw.finishes).toHaveLength(1);
    expect(rw.finishes[0]!.state).toBe("failed");
    // Persisted summary must also satisfy the invariant.
    const persisted = rw.finishes[0]!.summary!;
    expect(persisted.total).toBe(persisted.passed + persisted.failed);
    expect(persisted.failed).toBeGreaterThanOrEqual(1);
  });
});
