import { describe, it, test, expect, vi } from "vitest";
import { z } from "zod";
import { withCache, cacheKey } from "./caching-source.js";
import { DiscoverySourceAuthError, DiscoverySourceError } from "./errors.js";
import type { DiscoveryContext, DiscoverySource } from "../types.js";
import type { Logger } from "../../types/index.js";

// Helpers -------------------------------------------------------------------

/**
 * Minimal DiscoverySource stub with a controllable enumerate function.
 * The configSchema defaults to a passthrough object so callers that don't
 * need schema-level assertions skip the boilerplate.
 */
function makeSource<T>(
  name: string,
  enumerateFn: (ctx: DiscoveryContext, config: unknown) => Promise<T[]>,
): DiscoverySource<T> {
  return {
    name,
    configSchema: z.object({}).passthrough(),
    enumerate: enumerateFn,
  };
}

/**
 * Minimal DiscoveryContext for tests. Network access is never exercised —
 * fetchImpl is a vi.fn() cast to satisfy the interface; the caching
 * wrapper delegates to source.enumerate which is fully stubbed.
 */
function makeCtx(): DiscoveryContext {
  return {
    fetchImpl: vi.fn() as unknown as typeof fetch,
    logger: makeLogger(),
    env: {},
  };
}

/**
 * Minimal Logger that records calls so tests can assert on warn/info
 * messages emitted by the caching layer.
 */
function makeLogger(): Logger & {
  calls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }>;
} {
  const calls: Array<{
    level: string;
    msg: string;
    meta?: Record<string, unknown>;
  }> = [];
  return {
    calls,
    info: (msg, meta) => calls.push({ level: "info", msg, meta }),
    warn: (msg, meta) => calls.push({ level: "warn", msg, meta }),
    error: (msg, meta) => calls.push({ level: "error", msg, meta }),
    debug: (msg, meta) => calls.push({ level: "debug", msg, meta }),
  };
}

/** Minimal auth tracker stub with vi.fn() for both recording methods. */
function makeTracker() {
  return {
    recordSuccess: vi.fn(async (_name: string) => {}),
    recordFailure: vi.fn(
      async (_name: string, _error: unknown, _cacheStatus: string) => {},
    ),
  };
}

// Tests ---------------------------------------------------------------------

describe("CachingDiscoverySource", () => {
  const TTL = 60_000;

  it("success populates cache — subsequent failure serves stale", async () => {
    let clock = 1000;
    let callCount = 0;
    const source = makeSource<{ id: string }>("test", async () => {
      callCount++;
      if (callCount === 1) return [{ id: "svc1" }];
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });

    const cached = withCache(source, { ttlMs: TTL, now: () => clock });
    const ctx = makeCtx();
    const cfg = {};

    const first = await cached.enumerate(ctx, cfg);
    expect(first).toEqual([{ id: "svc1" }]);

    const second = await cached.enumerate(ctx, cfg);
    expect(second).toEqual([{ id: "svc1" }]);
  });

  it("failure with fresh cache serves stale results", async () => {
    let clock = 1000;
    let callCount = 0;
    const source = makeSource<{ id: string }>("test", async () => {
      callCount++;
      if (callCount === 1) return [{ id: "svc1" }];
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });

    const cached = withCache(source, {
      ttlMs: TTL,
      now: () => clock,
    });
    const ctx = makeCtx();
    const cfg = {};

    // Populate the cache
    const first = await cached.enumerate(ctx, cfg);
    expect(first).toEqual([{ id: "svc1" }]);

    // Advance clock within TTL (30s < 60s TTL)
    clock += 30_000;

    // Failure with fresh cache should serve stale
    const second = await cached.enumerate(ctx, cfg);
    expect(second).toEqual([{ id: "svc1" }]);
  });

  it("failure with expired cache re-throws original error", async () => {
    let clock = 1000;
    let callCount = 0;
    const source = makeSource<{ id: string }>("test", async () => {
      callCount++;
      if (callCount === 1) return [{ id: "svc1" }];
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });

    const cached = withCache(source, {
      ttlMs: TTL,
      now: () => clock,
    });
    const ctx = makeCtx();
    const cfg = {};

    // Populate the cache
    await cached.enumerate(ctx, cfg);

    // Advance clock past TTL (60001ms > 60000ms TTL)
    clock = 1000 + TTL + 1;

    // Should re-throw because cache is expired
    await expect(cached.enumerate(ctx, cfg)).rejects.toThrow(
      DiscoverySourceAuthError,
    );
  });

  it("failure with no prior cache re-throws", async () => {
    const source = makeSource<{ id: string }>("test", async () => {
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });

    const cached = withCache(source, { ttlMs: TTL });
    const ctx = makeCtx();

    await expect(cached.enumerate(ctx, {})).rejects.toThrow(
      DiscoverySourceAuthError,
    );
  });

  it("concurrent collapse — 3 callers, 1 upstream call", async () => {
    const enumerateFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return [{ id: "svc1" }];
    });
    const source = makeSource<{ id: string }>("test", enumerateFn);
    const cached = withCache(source, { ttlMs: TTL });
    const ctx = makeCtx();
    const cfg = {};

    const [r1, r2, r3] = await Promise.all([
      cached.enumerate(ctx, cfg),
      cached.enumerate(ctx, cfg),
      cached.enumerate(ctx, cfg),
    ]);

    expect(enumerateFn).toHaveBeenCalledTimes(1);
    expect(r1).toEqual([{ id: "svc1" }]);
    expect(r2).toEqual([{ id: "svc1" }]);
    expect(r3).toEqual([{ id: "svc1" }]);
  });

  it("concurrent collapse — failure path", async () => {
    const enumerateFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });
    const source = makeSource<{ id: string }>("test", enumerateFn);
    const cached = withCache(source, { ttlMs: TTL });
    const ctx = makeCtx();
    const cfg = {};

    const results = await Promise.allSettled([
      cached.enumerate(ctx, cfg),
      cached.enumerate(ctx, cfg),
      cached.enumerate(ctx, cfg),
    ]);

    expect(enumerateFn).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(DiscoverySourceAuthError);
      }
    }
  });

  it("calls authTracker.recordSuccess on successful enumerate", async () => {
    const tracker = makeTracker();
    const source = makeSource<{ id: string }>("test-source", async () => {
      return [{ id: "a" }];
    });
    const cached = withCache(source, { ttlMs: TTL, authTracker: tracker });
    const ctx = makeCtx();
    const cfg = {};
    await cached.enumerate(ctx, cfg);
    expect(tracker.recordSuccess).toHaveBeenCalledWith("test-source");
  });

  it("concurrent collapse — single auth tracker call on failure", async () => {
    const tracker = makeTracker();
    const enumerateFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });
    const source = makeSource<{ id: string }>("test", enumerateFn);
    const cached = withCache(source, {
      ttlMs: TTL,
      authTracker: tracker,
    });
    const ctx = makeCtx();
    const cfg = {};

    // Fire 3 concurrent calls — all will reject
    const results = await Promise.allSettled([
      cached.enumerate(ctx, cfg),
      cached.enumerate(ctx, cfg),
      cached.enumerate(ctx, cfg),
    ]);

    // All should be rejected
    for (const r of results) {
      expect(r.status).toBe("rejected");
    }

    // Tracker should have been called exactly once, not 3 times
    expect(tracker.recordFailure).toHaveBeenCalledTimes(1);
  });

  it("concurrent collapse — mixed configs get separate upstream calls", async () => {
    const enumerateFn = vi.fn(
      async (_ctx: DiscoveryContext, config: unknown) => {
        await new Promise((r) => setTimeout(r, 50));
        const cfg = config as { filter: string };
        return cfg.filter === "a" ? [{ id: "result-a" }] : [{ id: "result-b" }];
      },
    );
    const source = makeSource<{ id: string }>("test", enumerateFn);
    const cached = withCache(source, { ttlMs: TTL });
    const ctx = makeCtx();

    const [r1, r2, r3] = await Promise.all([
      cached.enumerate(ctx, { filter: "a" }),
      cached.enumerate(ctx, { filter: "a" }),
      cached.enumerate(ctx, { filter: "b" }),
    ]);

    // 2 upstream calls: one for config A, one for config B
    expect(enumerateFn).toHaveBeenCalledTimes(2);
    expect(r1).toEqual([{ id: "result-a" }]);
    expect(r2).toEqual([{ id: "result-a" }]);
    expect(r3).toEqual([{ id: "result-b" }]);
  });

  it("cache key isolation — different configs get separate entries", async () => {
    let callCount = 0;
    const source = makeSource<{ id: string }>("test", async (_ctx, config) => {
      callCount++;
      const cfg = config as { env: string };
      if (callCount <= 2) {
        // First two calls succeed (one per config)
        return cfg.env === "prod" ? [{ id: "prod1" }] : [{ id: "stg1" }];
      }
      // Subsequent calls fail
      throw new DiscoverySourceAuthError("test", "401 Unauthorized");
    });

    const cached = withCache(source, { ttlMs: TTL });
    const ctx = makeCtx();

    // Populate cache for both configs
    const prod1 = await cached.enumerate(ctx, { env: "prod" });
    expect(prod1).toEqual([{ id: "prod1" }]);

    const stg1 = await cached.enumerate(ctx, { env: "staging" });
    expect(stg1).toEqual([{ id: "stg1" }]);

    // Now source fails — cached results should be served per-config
    const prod2 = await cached.enumerate(ctx, { env: "prod" });
    expect(prod2).toEqual([{ id: "prod1" }]);

    const stg2 = await cached.enumerate(ctx, { env: "staging" });
    expect(stg2).toEqual([{ id: "stg1" }]);
  });

  it("stale entries evicted after 2x TTL", async () => {
    let clock = 1000;
    let shouldFail = false;
    const source = makeSource<{ id: string }>("test", async (_ctx, config) => {
      const cfg = config as { env: string };
      if (shouldFail) {
        throw new DiscoverySourceAuthError("test", "gone");
      }
      return [{ id: cfg.env }];
    });

    const cached = withCache(source, {
      ttlMs: TTL,
      now: () => clock,
    });
    const ctx = makeCtx();

    // Populate cache with config A at clock=1000
    await cached.enumerate(ctx, { env: "alpha" });

    // Advance clock past 2x TTL (>= 120_000ms from fetchedAt)
    clock += TTL * 2;

    // Populate cache with config B — triggers eviction sweep that
    // removes the stale config-A entry
    await cached.enumerate(ctx, { env: "bravo" });

    // Now make the source fail for all configs
    shouldFail = true;

    // Config A was evicted — no stale cache to serve, so it must throw
    await expect(cached.enumerate(ctx, { env: "alpha" })).rejects.toThrow(
      DiscoverySourceAuthError,
    );

    // Config B is still fresh (just fetched) — stale serve should work
    const staleB = await cached.enumerate(ctx, { env: "bravo" });
    expect(staleB).toEqual([{ id: "bravo" }]);
  });

  it("interface passthrough — name and configSchema preserved", () => {
    const schema = z.object({ x: z.string() });
    const source: DiscoverySource<{ id: string }> = {
      name: "test-source",
      configSchema: schema,
      enumerate: async () => [],
    };

    const cached = withCache(source, { ttlMs: TTL });

    expect(cached.name).toBe("test-source");
    expect(cached.configSchema).toBe(source.configSchema);
  });

  it("non-DiscoverySourceError re-throws without serving cache", async () => {
    let callCount = 0;
    const source = makeSource<{ id: string }>("test", async () => {
      callCount++;
      if (callCount === 1) return [{ id: "svc1" }];
      throw new Error("oops");
    });

    const cached = withCache(source, { ttlMs: TTL });
    const ctx = makeCtx();
    const cfg = {};

    // Populate cache
    await cached.enumerate(ctx, cfg);

    // Non-DiscoverySourceError should propagate — cache is NOT served
    await expect(cached.enumerate(ctx, cfg)).rejects.toThrow("oops");
    await expect(cached.enumerate(ctx, cfg)).rejects.not.toBeInstanceOf(
      DiscoverySourceError,
    );
  });

  it("degraded warning logged on cache serve", async () => {
    let clock = 1000;
    let callCount = 0;
    const customLogger = makeLogger();
    const source = makeSource<{ id: string }>("test-src", async () => {
      callCount++;
      if (callCount === 1) return [{ id: "svc1" }];
      throw new DiscoverySourceAuthError("test-src", "401 Unauthorized");
    });

    const cached = withCache(source, {
      ttlMs: TTL,
      logger: customLogger,
      now: () => clock,
    });
    const ctx = makeCtx();
    const cfg = { env: "prod" };

    // Populate cache at clock=1000
    await cached.enumerate(ctx, cfg);

    // Advance clock within TTL
    clock += 5000;

    // Failure serves cache — should log degraded warning
    await cached.enumerate(ctx, cfg);

    const warnCall = customLogger.calls.find(
      (c) => c.level === "warn" && c.msg === "discovery.cache.serving-stale",
    );
    expect(warnCall).toBeDefined();
    expect(warnCall!.meta).toBeDefined();
    expect(warnCall!.meta!.source).toBe("test-src");
    expect(warnCall!.meta!.cacheKey).toBeDefined();
    expect(warnCall!.meta!.cacheAgeMs).toBe(5000);
    expect(warnCall!.meta!.errorClass).toBe("DiscoverySourceAuthError");
    expect(warnCall!.meta!.errorMessage).toBe("401 Unauthorized");
    expect(warnCall!.meta!.errorSource).toBe("test-src");
  });

  it("invalidates prior fallback when a source requires a fresh result", async () => {
    let available = true;
    const source: DiscoverySource<string> = {
      name: "authoritative",
      configSchema: z.object({}),
      cachePolicy: (ctx) =>
        ctx.env.FRESH === "1" ? "fresh-only" : "stale-on-error",
      async enumerate() {
        if (available) return ["previous roster"];
        throw new DiscoverySourceAuthError("authoritative", "unavailable");
      },
    };
    const tracker = makeTracker();
    const cached = withCache(source, { ttlMs: TTL, authTracker: tracker });
    const ordinary = makeCtx();
    expect(await cached.enumerate(ordinary, {})).toEqual(["previous roster"]);
    available = false;

    await expect(
      cached.enumerate({ ...ordinary, env: { FRESH: "1" } }, {}),
    ).rejects.toBeInstanceOf(DiscoverySourceAuthError);
    expect(tracker.recordFailure).toHaveBeenLastCalledWith(
      "authoritative",
      expect.any(DiscoverySourceAuthError),
      "no-cache",
    );
    await expect(cached.enumerate(ordinary, {})).rejects.toBeInstanceOf(
      DiscoverySourceAuthError,
    );
  });

  it("never makes a fresh-only result available to later stale fallback", async () => {
    let available = true;
    const source: DiscoverySource<string> = {
      name: "authoritative",
      configSchema: z.object({}),
      cachePolicy: (ctx) =>
        ctx.env.FRESH === "1" ? "fresh-only" : "stale-on-error",
      async enumerate() {
        if (available) return ["ownership-filtered roster"];
        throw new DiscoverySourceAuthError("authoritative", "unavailable");
      },
    };
    const tracker = makeTracker();
    const cached = withCache(source, { ttlMs: TTL, authTracker: tracker });
    const ordinary = makeCtx();
    expect(
      await cached.enumerate({ ...ordinary, env: { FRESH: "1" } }, {}),
    ).toEqual(["ownership-filtered roster"]);
    expect(tracker.recordSuccess).toHaveBeenCalledWith("authoritative");
    available = false;

    await expect(cached.enumerate(ordinary, {})).rejects.toBeInstanceOf(
      DiscoverySourceAuthError,
    );
  });

  it.each(["stale-on-error", "fresh-only"] as const)(
    "does not join an in-flight %s call when a fresh result is required",
    async (initialPolicy) => {
      let finish!: (value: string[]) => void;
      const error = new DiscoverySourceAuthError(
        "authoritative",
        "current failure",
      );
      const source: DiscoverySource<string> = {
        name: "authoritative",
        configSchema: z.object({}),
        cachePolicy: (ctx) =>
          ctx.env.FRESH === "1" ? "fresh-only" : "stale-on-error",
        async enumerate(ctx) {
          if (ctx.env.NEXT === "1") throw error;
          return new Promise<string[]>((resolve) => {
            finish = resolve;
          });
        },
      };
      const cached = withCache(source, { ttlMs: TTL });
      const ctx = makeCtx();
      const pending = cached.enumerate(
        {
          ...ctx,
          env: { FRESH: initialPolicy === "fresh-only" ? "1" : undefined },
        },
        {},
      );
      const next = cached.enumerate(
        { ...ctx, env: { FRESH: "1", NEXT: "1" } },
        {},
      );
      finish(["previous roster"]);
      await expect(next).rejects.toBe(error);
      await expect(pending).resolves.toEqual(["previous roster"]);
    },
  );
});

describe("cacheKey", () => {
  it("produces stable output with sorted keys at every nesting level", () => {
    const a = cacheKey({ z: 1, a: { c: 3, b: 2 } });
    const b = cacheKey({ a: { b: 2, c: 3 }, z: 1 });
    expect(a).toBe(b);
  });

  it("handles null/undefined/primitive config values", () => {
    expect(cacheKey(null)).toBe("null");
    expect(cacheKey(undefined)).toBe("null");
    expect(cacheKey(42)).toBe("42");
    expect(cacheKey("hello")).toBe('"hello"');
  });

  it("logs warning for non-plain objects (Map, Set, class instances)", () => {
    const logger = makeLogger();

    // Map serializes as "{}" under JSON.stringify — lossy key
    cacheKey(new Map([["a", 1]]), logger);
    const mapWarn = logger.calls.find(
      (c) => c.level === "warn" && c.msg === "discovery.cache.non-plain-config",
    );
    expect(mapWarn).toBeDefined();
    expect(mapWarn!.meta!.constructorName).toBe("Map");

    // Set also produces "{}"
    cacheKey(new Set([1, 2, 3]), logger);
    const setWarn = logger.calls.filter(
      (c) => c.level === "warn" && c.msg === "discovery.cache.non-plain-config",
    );
    expect(setWarn.length).toBe(2);
    expect(setWarn[1].meta!.constructorName).toBe("Set");

    // Plain objects and arrays should NOT warn
    logger.calls.length = 0;
    cacheKey({ a: 1 }, logger);
    cacheKey([1, 2], logger);
    cacheKey("str", logger);
    cacheKey(null, logger);
    expect(logger.calls.filter((c) => c.level === "warn")).toHaveLength(0);
  });

  it("still returns a key (does not throw) for non-plain objects", () => {
    // Even though the key is lossy, cacheKey should not throw
    const key = cacheKey(new Map([["a", 1]]));
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });
});

/** A promise whose settlement order is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Isolated cache and source calls for policy-transition races. */
function setupCacheGeneration(freshFails = false) {
  const old = deferred<string[]>();
  const replacement = deferred<string[]>();
  const error = new DiscoverySourceAuthError("generation", "unavailable");
  const upstream = vi.fn(async (ctx: DiscoveryContext) => {
    if (ctx.env.REQUEST === "old") return old.promise;
    if (ctx.env.REQUEST === "replacement") return replacement.promise;
    if (ctx.env.REQUEST === "fresh" && !freshFails) return ["fresh"];
    throw error;
  });
  const source = makeSource("generation", upstream);
  source.cachePolicy = (ctx) =>
    ctx.env.REQUEST === "fresh" ? "fresh-only" : "stale-on-error";
  const cached = withCache(source, { ttlMs: 60_000 });
  const ctx = makeCtx();
  const enumerate = (request: string, config: unknown = {}) =>
    cached.enumerate({ ...ctx, env: { REQUEST: request } }, config);
  return { old, replacement, error, upstream, enumerate };
}

test.each([
  { freshFails: false, oldFirst: false },
  { freshFails: false, oldFirst: true },
  { freshFails: true, oldFirst: false },
  { freshFails: true, oldFirst: true },
])(
  "cache generation revokes A: fresh failure=$freshFails, A finishes before C=$oldFirst",
  async ({ freshFails, oldFirst }) => {
    const { old, error, upstream, enumerate } =
      setupCacheGeneration(freshFails);
    const a = enumerate("old");
    if (freshFails) await expect(enumerate("fresh")).rejects.toBe(error);
    else await expect(enumerate("fresh")).resolves.toEqual(["fresh"]);
    if (oldFirst) {
      old.resolve(["old"]);
      await expect(a).resolves.toEqual(["old"]);
    }
    const c = enumerate("outage");
    const observedC = c.then(
      (value) => ({ value }),
      (reason) => ({ error: reason }),
    );
    if (!oldFirst) {
      old.resolve(["old"]);
      await expect(a).resolves.toEqual(["old"]);
    }

    expect(await observedC).toEqual({ error });
    expect(upstream).toHaveBeenCalledTimes(3);
    await expect(enumerate("outage")).rejects.toBe(error);
  },
);

test("revoked cache call cannot remove replacement inflight work or overwrite its result", async () => {
  const { old, replacement, enumerate } = setupCacheGeneration();
  const a = enumerate("old");
  await enumerate("fresh");
  const c = enumerate("replacement");
  expect(c).not.toBe(a);
  old.resolve(["old"]);
  await expect(a).resolves.toEqual(["old"]);
  const d = enumerate("outage");
  expect(d).toBe(c);
  replacement.resolve(["current"]);

  await expect(c).resolves.toEqual(["current"]);
  await expect(d).resolves.toEqual(["current"]);
  await expect(enumerate("outage")).resolves.toEqual(["current"]);
});

test("revoked cache failure cannot read a replacement generation", async () => {
  const { old, replacement, error, enumerate } = setupCacheGeneration();
  const a = enumerate("old");
  await enumerate("fresh");
  const c = enumerate("replacement");
  expect(c).not.toBe(a);
  replacement.resolve(["current"]);
  await c;
  old.reject(error);

  await expect(a).rejects.toBe(error);
  await expect(enumerate("outage")).resolves.toEqual(["current"]);
});

test("fresh-only invalidation revokes fallback while auth tracking is pending", async () => {
  const tracking = deferred<void>();
  const enteredTracking = deferred<void>();
  const error = new DiscoverySourceAuthError("generation", "unavailable");
  const source = makeSource("generation", async (ctx) => {
    if (ctx.env.REQUEST === "outage") throw error;
    return [ctx.env.REQUEST];
  });
  source.cachePolicy = (ctx) =>
    ctx.env.REQUEST === "fresh" ? "fresh-only" : "stale-on-error";
  const cached = withCache(source, {
    ttlMs: 60_000,
    authTracker: {
      recordSuccess: async () => {},
      recordFailure: async () => {
        enteredTracking.resolve();
        await tracking.promise;
      },
    },
  });
  const ctx = makeCtx();
  await cached.enumerate({ ...ctx, env: { REQUEST: "warm" } }, {});
  const pending = cached.enumerate({ ...ctx, env: { REQUEST: "outage" } }, {});
  await enteredTracking.promise;
  await cached.enumerate({ ...ctx, env: { REQUEST: "fresh" } }, {});
  tracking.resolve();

  await expect(pending).rejects.toBe(error);
});

test("ordinary cache calls still deduplicate and retain fallback across other keys' invalidation", async () => {
  const { old, enumerate, upstream } = setupCacheGeneration();
  const a = enumerate("old", { key: "ordinary" });
  const b = enumerate("outage", { key: "ordinary" });
  expect(b).toBe(a);
  await enumerate("fresh", { key: "different" });
  old.resolve(["ordinary"]);

  await expect(a).resolves.toEqual(["ordinary"]);
  await expect(b).resolves.toEqual(["ordinary"]);
  await expect(enumerate("outage", { key: "ordinary" })).resolves.toEqual([
    "ordinary",
  ]);
  expect(upstream).toHaveBeenCalledTimes(3);
});
