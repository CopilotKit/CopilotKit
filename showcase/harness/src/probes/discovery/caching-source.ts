import type { DiscoveryContext, DiscoverySource } from "../types.js";
import { DiscoverySourceError } from "./errors.js";
import type { Logger } from "../../types/index.js";

/**
 * In-memory cache entry holding the last successful enumeration results
 * alongside a wall-clock timestamp for TTL checks.
 */
interface CacheEntry<T> {
  results: T[];
  fetchedAt: number;
}

/**
 * Minimal interface the caching wrapper needs from the auth tracker.
 * Defined here (rather than importing the concrete class) so the caching
 * wrapper and the auth tracker can be developed and tested independently
 * — the orchestrator wires them together at boot.
 */
export interface DiscoveryAuthTrackerLike {
  recordSuccess(sourceName: string): Promise<void>;
  recordFailure(
    sourceName: string,
    error: DiscoverySourceError,
    cacheStatus: "serving-stale" | "no-cache",
  ): Promise<void>;
}

interface CachingDiscoverySourceOptions {
  ttlMs: number;
  logger?: Logger;
  now?: () => number;
  authTracker?: DiscoveryAuthTrackerLike;
}

/**
 * Stable JSON serialization with sorted object keys at every nesting
 * level. Used to derive a cache-map key from the discovery config block
 * so callers with semantically-identical configs always share one cache
 * entry regardless of property-insertion order.
 *
 * ASSUMPTION: `config` must be a JSON-compatible value (plain objects,
 * arrays, strings, numbers, booleans, null). Map, Set, Date, class
 * instances, and other non-plain objects serialize as `{}` under
 * JSON.stringify, which causes key collisions. A warning is logged if
 * a non-plain top-level object is detected, but the lossy key is still
 * returned so callers degrade rather than crash.
 */
export function cacheKey(config: unknown, logger?: Logger): string {
  if (
    typeof config === "object" &&
    config !== null &&
    !Array.isArray(config) &&
    config.constructor !== Object
  ) {
    logger?.warn("discovery.cache.non-plain-config", {
      constructorName: config.constructor?.name ?? "unknown",
      note: "JSON.stringify produces lossy keys for non-plain objects (Map, Set, class instances); cache key may collide",
    });
  }

  return JSON.stringify(config ?? null, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

/**
 * Wraps a `DiscoverySource` with in-memory caching, concurrent-call
 * collapsing, and optional auth-tracker integration.
 *
 * Behaviour:
 *   - On success: caches `{ results, fetchedAt }` under a stable key
 *     derived from the config block.
 *   - On `DiscoverySourceError` failure within TTL: serves stale results
 *     and logs a degraded warning.
 *   - On `DiscoverySourceError` failure past TTL / no cache: re-throws.
 *   - On non-`DiscoverySourceError`: re-throws immediately (possible code
 *     bug — no cache serve).
 *   - Concurrent calls with the same config collapse into a single
 *     upstream `enumerate` call; all joiners share the same promise.
 */
export function withCache<T>(
  source: DiscoverySource<T>,
  opts: CachingDiscoverySourceOptions,
): DiscoverySource<T> {
  const cache = new Map<string, CacheEntry<T>>();
  const inflight = new Map<string, Promise<T[]>>();
  const now = opts.now ?? (() => Date.now());

  return {
    name: source.name,
    configSchema: source.configSchema,

    enumerate(ctx: DiscoveryContext, config: unknown): Promise<T[]> {
      const key = cacheKey(config, opts.logger);

      // Concurrent collapse: if an identical call is already in flight,
      // join it rather than issuing a second upstream request.
      const existing = inflight.get(key);
      if (existing) return existing;

      const pipeline = (async () => {
        try {
          const results = await source.enumerate(ctx, config);
          const ts = now();
          cache.set(key, { results, fetchedAt: ts });

          // Eviction sweep: remove entries that are 2x past TTL.
          // The map is small (~10 entries per source) so a full
          // scan after every successful set is cheap.
          const evictionThreshold = opts.ttlMs * 2;
          for (const [k, entry] of cache) {
            if (ts - entry.fetchedAt >= evictionThreshold) {
              cache.delete(k);
            }
          }

          if (opts.authTracker) {
            try {
              await opts.authTracker.recordSuccess(source.name);
            } catch (trackerErr) {
              opts.logger?.warn("discovery.cache.tracker-error", {
                source: source.name,
                phase: "success",
                error:
                  trackerErr instanceof Error
                    ? trackerErr.message
                    : String(trackerErr),
              });
            }
          }
          return results;
        } catch (err) {
          if (!(err instanceof DiscoverySourceError)) throw err;

          const ts = now();
          const entry = cache.get(key);
          const hasFreshCache =
            entry != null && ts - entry.fetchedAt < opts.ttlMs;
          const cacheStatus = hasFreshCache
            ? ("serving-stale" as const)
            : ("no-cache" as const);

          if (opts.authTracker) {
            try {
              await opts.authTracker.recordFailure(
                source.name,
                err,
                cacheStatus,
              );
            } catch (trackerErr) {
              opts.logger?.warn("discovery.cache.tracker-error", {
                source: source.name,
                phase: "failure",
                error:
                  trackerErr instanceof Error
                    ? trackerErr.message
                    : String(trackerErr),
              });
            }
          }

          if (hasFreshCache) {
            opts.logger?.warn("discovery.cache.serving-stale", {
              source: source.name,
              cacheKey: key,
              cacheAgeMs: ts - entry!.fetchedAt,
              errorClass: err.constructor.name,
              errorMessage: err.message,
              errorSource: err.source,
            });
            return entry!.results;
          }

          throw err;
        }
      })();

      // Attach cleanup BEFORE storing so every consumer (including the
      // first caller) sees the same promise that self-cleans.
      const tracked = pipeline.finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, tracked);
      return tracked;
    },
  };
}
