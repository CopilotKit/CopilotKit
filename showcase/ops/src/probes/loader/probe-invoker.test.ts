import { describe, it, expect, onTestFinished } from "vitest";
import { z } from "zod";
import { buildProbeInvoker } from "./probe-invoker.js";
import type { ProbeConfig } from "./schema.js";
import { createDiscoveryRegistry } from "../discovery/index.js";
import type { DiscoverySource, ProbeDriver } from "../types.js";
import type { ProbeResult } from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";
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
        driver,
        discoveryRegistry: createDiscoveryRegistry(),
        writer,
        ...BASE_DEPS,
      })();
      // Synthetic dashboard tick instead of silent zero-write.
      expect(writes).toHaveLength(1);
      expect(writes[0]!.key).toBe("image-drift:misconfigured");
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
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(2);
    const keys = writes.map((w) => w.key);
    // Unique unresolved-suffix keys per record so the writer doesn't
    // collapse them into one row.
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) {
      expect(k).toMatch(/__unresolved_/);
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
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).not.toMatch(/\[object Object\]/);
    expect(writes[0]!.key).toMatch(/__unresolved_/);
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
    expect(writes[0]!.key).toBe("image-drift:enumerate-failed");
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
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    // (a) Exactly one tick written for the failed enumerate.
    expect(writes).toHaveLength(1);
    // (b) errorClass is discovery-error (NOT discovery-source-missing
    //     — the source IS registered, it just threw at runtime).
    expect(writes[0]!.key).toBe("image-drift:enumerate-failed");
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
      { driver: badDriver, discoveryRegistry, writer, ...BASE_DEPS },
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
      { driver: goodDriver, discoveryRegistry, writer, ...BASE_DEPS },
    )();

    expect(writes).toHaveLength(3);
    // The synthetic discovery-error tick exists alongside the two
    // green sibling-probe ticks.
    const errors = writes.filter((w) => w.state === "error");
    const greens = writes.filter((w) => w.state === "green");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.key).toBe("image-drift:enumerate-failed");
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
      driver,
      discoveryRegistry,
      writer,
      ...BASE_DEPS,
    })();
    expect(writes).toHaveLength(2);
    const keys = writes.map((w) => w.key);
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) {
      expect(k).toMatch(/__unresolved_/);
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
});
