/**
 * resource-snapshot-writer.ts — DURABLE persistence of the BrowserPool's OS
 * resource gauges to PocketBase, so the forensic history survives the
 * container RESTART that ends every browser-pool wedge.
 *
 * WHY (the critical insight): the wedge (#5185/#5221/#5225) ends in a restart
 * that clears anything in-memory, and Railway's stdout log window is capped and
 * rolls off — a prior investigation lost the trail exactly that way. stdout /
 * in-memory gauges alone are NOT retrievable post-wedge. Writing each
 * meaningful gauge sample as a row in the `resource_snapshots` PB collection
 * (see pb_migrations/1779989300_create_resource_snapshots.js) makes the
 * PID/thread-ceiling exhaustion reconstructable AFTER the fact.
 *
 * BEST-EFFORT GUARANTEE: every write is wrapped so a missing migration, a PB
 * hiccup, a 400 from an unrun migration, or any network error is SWALLOWED and
 * logged — it can NEVER throw into the pool's lifecycle paths. This is a hard
 * requirement learned from a prior incident where a state write that needed an
 * unrun migration 400'd and broke the caller. The snapshot writer is pure
 * instrumentation: it must degrade silently, never break the thing it observes.
 *
 * RETENTION: append-only under a ~30-60s heartbeat would grow unbounded
 * (≈1k-2k rows/day). After each successful insert the writer prunes the oldest
 * rows beyond `maxRows` (ring-style delete-oldest) keyed on the
 * `observed_at DESC` index. Simpler than a TTL cron and bounds the volume
 * deterministically. The prune is itself best-effort and rate-limited so a
 * heartbeat burst doesn't issue a delete sweep on every single insert.
 */

import type { ResourceGauges } from "./resource-gauges.js";
import type { BrowserPoolStats } from "./browser-pool.js";

/** Collection name — mirrors the PB migration. */
export const RESOURCE_SNAPSHOTS_COLLECTION = "resource_snapshots";

/**
 * Default ring cap on retained snapshot rows. ~5000 rows at a 30-60s heartbeat
 * is ~1.5-3 days of baseline trend plus every transition in between — enough to
 * look back across a wedge episode without growing unbounded. Env-overridable
 * via RESOURCE_SNAPSHOT_MAX_ROWS.
 */
export const DEFAULT_RESOURCE_SNAPSHOT_MAX_ROWS = 5000;

/**
 * How often (at most) the ring prune actually runs. Pruning on EVERY insert
 * would issue a list+delete sweep per heartbeat; instead we only prune once per
 * this interval (and always once we're meaningfully over cap). Keeps the prune
 * cost off the hot insert path.
 */
const DEFAULT_PRUNE_INTERVAL_MS = 5 * 60_000;

/** Minimal PB surface the snapshot writer needs — a structural subset of the
 *  harness `PbClient` so the real client satisfies it and tests can pass a
 *  tiny fake. */
export interface SnapshotPbClient {
  create<T>(collection: string, record: Record<string, unknown>): Promise<T>;
  list<T>(
    collection: string,
    opts?: {
      filter?: string;
      sort?: string;
      page?: number;
      perPage?: number;
      skipTotal?: boolean;
    },
  ): Promise<{ totalItems: number; items: T[] }>;
  deleteByFilter(collection: string, filter: string): Promise<number>;
}

/** Logger surface — matches the pool's optional-method idiom. */
export interface SnapshotLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

/** Optional per-browser breakdown row (kept small + secret-free). */
export interface PerBrowserSnapshot {
  index: number;
  liveContexts: number;
  servedContexts: number;
  recycling: boolean;
}

export interface ResourceSnapshotWriter {
  /**
   * Persist one snapshot row, best-effort. Resolves whether the write
   * succeeded or was swallowed; NEVER rejects. The `event` names the pool
   * condition (`heartbeat`, `degraded`, `unrecoverable`, `launch-fail`,
   * `crash`, ...).
   */
  write(
    event: string,
    gauges: ResourceGauges,
    stats: BrowserPoolStats,
    perBrowser?: PerBrowserSnapshot[],
  ): Promise<void>;
}

export interface ResourceSnapshotWriterOptions {
  pb: SnapshotPbClient;
  logger: SnapshotLogger;
  /** Ring cap; defaults to env RESOURCE_SNAPSHOT_MAX_ROWS or 5000. */
  maxRows?: number;
  /** Minimum ms between prune sweeps. Defaults to 5min. Tests pass 0 to force
   *  a prune on every write. */
  pruneIntervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

function resolveMaxRows(explicit: number | undefined): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const envRaw = process.env.RESOURCE_SNAPSHOT_MAX_ROWS;
  const envParsed = envRaw ? parseInt(envRaw, 10) : NaN;
  if (Number.isFinite(envParsed) && envParsed > 0) return envParsed;
  return DEFAULT_RESOURCE_SNAPSHOT_MAX_ROWS;
}

/**
 * Build the best-effort durable snapshot writer. The returned `write` swallows
 * every error so it is safe to call from the pool's lifecycle paths.
 */
export function createResourceSnapshotWriter(
  options: ResourceSnapshotWriterOptions,
): ResourceSnapshotWriter {
  const { pb, logger } = options;
  const maxRows = resolveMaxRows(options.maxRows);
  const pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastPruneAt = 0;
  // Once we've confirmed we're over cap, keep pruning every write until back
  // under — otherwise a single rate-limited prune that can't clear the whole
  // backlog in one sweep would leave us over cap until the next interval.
  let knownOverCap = false;

  async function prune(): Promise<void> {
    try {
      // Cheapest possible "are we over cap?" probe: ask PB for the total.
      const head = await pb.list(RESOURCE_SNAPSHOTS_COLLECTION, {
        perPage: 1,
        skipTotal: false,
      });
      const total = head.totalItems;
      if (total <= maxRows) {
        knownOverCap = false;
        return;
      }
      knownOverCap = true;
      // Find the observed_at cutoff: the (maxRows)-th newest row's timestamp.
      // Everything strictly older than that is surplus. Page directly to the
      // boundary row rather than listing every surplus row client-side.
      const boundary = await pb.list<{ observed_at: string }>(
        RESOURCE_SNAPSHOTS_COLLECTION,
        {
          sort: "-observed_at",
          page: maxRows,
          perPage: 1,
          skipTotal: true,
        },
      );
      const cutoff = boundary.items[0]?.observed_at;
      if (!cutoff) return;
      const deleted = await pb.deleteByFilter(
        RESOURCE_SNAPSHOTS_COLLECTION,
        `observed_at < ${JSON.stringify(cutoff)}`,
      );
      if (deleted > 0) {
        logger.info("resource-snapshot.pruned", { deleted, kept: maxRows });
      }
      knownOverCap = false;
    } catch (err) {
      // Prune is best-effort: a failed sweep just means we retry next time.
      logger.warn?.("resource-snapshot.prune-failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    async write(event, gauges, stats, perBrowser): Promise<void> {
      try {
        await pb.create(RESOURCE_SNAPSHOTS_COLLECTION, {
          observed_at: gauges.ts,
          event,
          pids_current: gauges.cgroupPidsCurrent,
          pids_max: gauges.cgroupPidsMax,
          threads: gauges.treeThreadCount,
          procs: gauges.treeProcCount,
          zombies: gauges.zombieCount,
          fd_count: gauges.selfFdCount,
          rss_mb: gauges.treeRssMb,
          shm_pct: gauges.devShmUsedPct,
          tmp_inode_pct: gauges.tmpInodeUsedPct,
          browsers: perBrowser?.length ?? null,
          contexts_in_use: stats.inUse,
          contexts_available: stats.available,
          per_browser: perBrowser ?? null,
        });
      } catch (err) {
        // BEST-EFFORT: a missing migration (400), PB outage, or network error
        // must NEVER break the pool. Swallow + log at warn so the gap is
        // visible without crashing the caller. Learned from a prior incident
        // where a state write that needed an unrun migration 400'd and broke
        // the writer's caller.
        logger.warn?.("resource-snapshot.write-failed", {
          event,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      // Ring retention: only sweep once per interval (or while known over cap)
      // so a heartbeat burst doesn't issue a delete sweep on every insert.
      const t = now();
      if (knownOverCap || t - lastPruneAt >= pruneIntervalMs) {
        lastPruneAt = t;
        await prune();
      }
    },
  };
}
