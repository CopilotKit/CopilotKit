import { describe, it, expect } from "vitest";
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
    let inFlight = 0;
    let peak = 0;
    const inputSchema = z.object({ key: z.string() }).passthrough();
    const driver: ProbeDriver = {
      kind: "smoke",
      inputSchema,
      async run(ctx, input) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // 50ms (was 15ms) — gives concurrent worker slots time to claim
        // their inputs even under heavy CI load. Total wall-clock is
        // bounded at ~10*50ms/3 ≈ ~170ms, still fast.
        await new Promise((r) => setTimeout(r, 50));
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
        { name: "medium", demos: Array.from({ length: 20 }, (_, i) => `d${i}`) },
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

  // --- A11: errorClass discriminator on synthetic results ---------------
  describe("synthetic-error errorClass discriminator (A11)", () => {
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
      // A4: synthetic dashboard tick instead of silent zero-write.
      expect(writes).toHaveLength(1);
      expect(writes[0]!.key).toBe("image-drift:misconfigured");
      expect(writes[0]!.state).toBe("error");
      const sig = writes[0]!.signal as { errorClass?: string };
      expect(sig.errorClass).toBe("discovery-source-missing");
    });
  });

  // --- A1: late driver rejection must not surface as unhandledRejection -
  it("does not surface unhandledRejection when driver rejects after timeout (A1)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const inputSchema = z.object({ key: z.string() }).passthrough();
      const driver: ProbeDriver = {
        kind: "smoke",
        inputSchema,
        async run(ctx) {
          // Reject AFTER the invoker has timed out and moved on.
          await new Promise<void>((_, reject) => {
            ctx.abortSignal?.addEventListener(
              "abort",
              () => {
                // Reject async on next tick so the race has settled
                // first.
                setTimeout(() => reject(new Error("late driver rejection")), 5);
              },
              { once: true },
            );
          });
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
      // Give the driver's late-rejection setTimeout time to fire so the
      // unhandledRejection listener has a chance to catch it if the
      // race-leak regresses.
      await new Promise((r) => setTimeout(r, 50));
      expect(writes).toHaveLength(1);
      expect(writes[0]!.state).toBe("error");
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // --- A6: array-typed discovery records ---------------------------------
  it("falls back to {key} when a discovery record is an array (A6)", async () => {
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

  // --- A3: template-path-unresolvable produces unique keys --------------
  it("emits unique unresolved-suffix keys when template paths collide (A3)", async () => {
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

  it("emits unresolved-suffix when template path resolves to non-primitive (A3)", async () => {
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

  // --- E1: discovery enumerate timeout -----------------------------------
  it("returns within timeout when source.enumerate hangs (E1)", async () => {
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
    // (b) zero writes emitted: discovery failed, nothing to fan out
    expect(writes).toEqual([]);
  });

  // --- E2: writer.write failure isolation -------------------------------
  it("isolates writer.write failures: sibling targets still write (E2)", async () => {
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
});
