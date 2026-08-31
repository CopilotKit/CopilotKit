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
 * FAILURE ESCALATION: "swallow + warn" alone is a trap — if PB SYSTEMATICALLY
 * rejects writes (unrun migration, outage, schema drift) the durable log
 * silently no-ops forever, defeating the whole point. So consecutive failures
 * are counted: the per-failure warn is throttled (first few, then quiet), and
 * after a threshold the writer escalates ONCE to a latched `logger.error` (reset
 * on the first success) so a systematic outage is loud rather than invisible.
 *
 * RETENTION: append-only under the ~45s heartbeat (DEFAULT_HEARTBEAT_MS, plus a
 * row per transition) would grow unbounded (≈2k rows/day at 45s). After each
 * successful insert the writer prunes the oldest rows beyond `maxRows`
 * (ring-style delete-oldest). The prune is robust to TIMESTAMP TIES: snapshots
 * can fire in the same millisecond (degraded+heartbeat+crash all at once), and
 * `observed_at` is ms-resolution, so a bare `observed_at < cutoff` strict
 * compare could strand surplus rows that share the boundary timestamp and spin.
 * Instead the prune deletes the oldest `surplus` rows by stable row IDENTITY
 * (id), which converges regardless of ties. The prune is itself best-effort and
 * rate-limited so a heartbeat burst doesn't issue a delete sweep on every
 * single insert.
 *
 * MULTI-WRITER (FLEET) SAFETY: the rate-limit clock (`lastPruneAt`) and the
 * `knownOverCap` ring state are PER-PROCESS in-memory. The harness now runs as a
 * FLEET — a control-plane plus N worker REPLICAS, each with its own pool + its
 * own snapshot writer against the SAME `resource_snapshots` collection. Two
 * problems arise from naively sharing the collection:
 *   1. ATTRIBUTION — anonymous rows from N replicas interleave, so a post-wedge
 *      query can't tell which replica's pool was nearing the cgroup ceiling.
 *   2. PRUNE CONTENTION — N writers each pruning the GLOBALLY-oldest rows would
 *      delete EACH OTHER's recent rows (a busy replica's history gets pruned by
 *      an idle replica's sweep), and their per-process rate-limits don't
 *      coordinate (extra sweeps).
 * BOTH are solved by SCOPING each writer to its own `workerId` (see the
 * constructor option): every row is STAMPED with `worker_id`, and the ring
 * prune FILTERS to `worker_id = <this writer>` so each replica retains its own
 * last `maxRows` independently and never deletes a peer's rows. The per-process
 * rate-limit is then correct again because each writer prunes a disjoint row
 * set. The legacy single-process `boot()` path passes no `workerId`; it stamps
 * `worker_id` "" (the unset-text-field value PocketBase actually stores) and
 * prunes the empty-scoped (i.e. legacy) partition, byte-for-byte identical to
 * the pre-fleet behavior.
 */

import type { ResourceGauges } from "./resource-gauges.js";
import type { BrowserPoolStats } from "./browser-pool.js";

/** Collection name — mirrors the PB migration. */
export const RESOURCE_SNAPSHOTS_COLLECTION = "resource_snapshots";

/**
 * Default ring cap on retained snapshot rows. ~5000 rows at the 45s heartbeat
 * is ~2.5 days of baseline trend plus every transition in between — enough to
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

/**
 * Max rows a SINGLE prune sweep lists + deletes. A cold start over a large
 * backlog (or lowering RESOURCE_SNAPSHOT_MAX_ROWS on a full collection) makes
 * `surplus = total - maxRows` thousands large; using that directly as
 * `list({perPage})` and as a one-clause-per-row `id = ... || ...` delete filter
 * builds a giant request + a thousands-clause filter URL that PB rejects
 * (400/414) so the prune never converges. Instead each sweep drains at most this
 * many oldest rows; `knownOverCap` keeps catching up across subsequent
 * inserts/sweeps until back under cap.
 */
const PRUNE_BATCH_MAX = 200;

/**
 * Consecutive snapshot-write failures before the writer escalates ONCE to
 * `logger.error`. Below this, failures warn (throttled). The escalation is
 * latched and resets on the first success.
 */
const DEFAULT_FAILURE_ESCALATION_THRESHOLD = 5;

/**
 * How many consecutive failures get a per-failure warn before the warn goes
 * quiet (every Nth thereafter), so a sustained PB outage doesn't flood stdout.
 */
const FAILURE_WARN_THROTTLE_EVERY = 50;

/**
 * Cap on concurrent in-flight `pb.create` writes. During a launch-crash-loop
 * burst the pool can fire many snapshots back-to-back; without a cap the
 * unawaited (fire-and-forget) creates could pile up against a slow/hung PB.
 * Beyond this we DROP the snapshot (best-effort instrumentation, not a queue).
 */
const DEFAULT_MAX_IN_FLIGHT_WRITES = 8;

/**
 * Abort a single `pb.create` after this long so a hung PB write can't sit in
 * the in-flight set forever (and starve the cap). Best-effort: an aborted write
 * is counted as a failure and swallowed.
 */
const DEFAULT_WRITE_TIMEOUT_MS = 10_000;

/** Minimal PB surface the snapshot writer needs — a structural subset of the
 *  harness `PbClient` so the real client satisfies it and tests can pass a
 *  tiny fake. */
export interface SnapshotPbClient {
  create<T>(
    collection: string,
    record: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ): Promise<T>;
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
  /**
   * Stable id of the writing replica — stamped onto every `worker_id` field and
   * used to SCOPE the ring prune to this writer's own rows (so N fleet replicas
   * against the SAME collection don't prune each other's history). MUST be the
   * same id the worker stamps on `workers.worker_id` / `probe_jobs.claimed_by`
   * (`worker-${HOSTNAME}`). OMITTED on the legacy single-process `boot()` path:
   * rows are written with `worker_id` "" (PB's unset-text-field value) and the
   * prune is scoped to the empty (legacy) partition, identical to the pre-fleet
   * single-writer behavior.
   */
  workerId?: string;
  /** Ring cap; defaults to env RESOURCE_SNAPSHOT_MAX_ROWS or 5000. */
  maxRows?: number;
  /** Minimum ms between prune sweeps. Defaults to 5min. Tests pass 0 to force
   *  a prune on every write. */
  pruneIntervalMs?: number;
  /** Consecutive failures before escalating once to error. Defaults to 5. */
  failureEscalationThreshold?: number;
  /** Max concurrent in-flight writes before dropping. Defaults to 8. */
  maxInFlightWrites?: number;
  /** Per-write abort timeout (ms). Defaults to 10s. 0 disables the timeout. */
  writeTimeoutMs?: number;
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
 * Map a gauge value to the PB field value: the `-1` "unavailable" sentinel
 * (off-Linux / unreadable cgroup / fd / df) becomes `null` so post-wedge
 * queries cleanly separate a MEASURED reading from an UNAVAILABLE one — a real
 * `-1` would be indistinguishable from a genuine count. The migration's number
 * fields are nullable for exactly this. A real reading is never negative, so
 * the only legitimate negative is the sentinel.
 */
function gaugeOrNull(value: number): number | null {
  return value < 0 ? null : value;
}

/**
 * Build the best-effort durable snapshot writer. The returned `write` swallows
 * every error so it is safe to call from the pool's lifecycle paths.
 */
export function createResourceSnapshotWriter(
  options: ResourceSnapshotWriterOptions,
): ResourceSnapshotWriter {
  const { pb, logger } = options;
  // The replica id stamped on every row + the prune scope. Normalize an
  // empty/whitespace id to undefined so a blank env collapses to the legacy
  // null-partition behavior rather than a literal "" worker.
  const workerId =
    options.workerId && options.workerId.trim().length > 0
      ? options.workerId.trim()
      : undefined;
  // PB filter that scopes the ring prune to THIS writer's own partition so N
  // fleet replicas never prune each other's history. When no workerId is set
  // (legacy boot path) scope to the rows with no worker stamp (`worker_id = ""`
  // / null), keeping the single-writer behavior byte-for-byte. PB stores an
  // unset text field as "", so the null partition is matched via `worker_id = ""`.
  const pruneScopeFilter =
    workerId !== undefined
      ? `worker_id = ${JSON.stringify(workerId)}`
      : `worker_id = "" || worker_id = null`;
  const maxRows = resolveMaxRows(options.maxRows);
  const pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  const escalationThreshold =
    options.failureEscalationThreshold ?? DEFAULT_FAILURE_ESCALATION_THRESHOLD;
  const maxInFlight = options.maxInFlightWrites ?? DEFAULT_MAX_IN_FLIGHT_WRITES;
  const writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  let lastPruneAt = 0;
  // Once we've confirmed we're over cap, keep pruning every write until back
  // under — otherwise a single rate-limited prune that can't clear the whole
  // backlog in one sweep would leave us over cap until the next interval.
  let knownOverCap = false;
  // When a sweep makes NO structural progress while still over cap (PB
  // delete-rule 403, filter 400, or a delete that matched 0 rows), we back the
  // prune off until this timestamp so the retry is gated by the interval rather
  // than firing on every insert via the knownOverCap re-arm. Until then BOTH the
  // write-path re-arm and the prune gate honor the suppression.
  let pruneSuppressedUntil = 0;
  // Local row-count estimate so the rate-limit can't STRAND us over cap until
  // the next interval. Each successful insert bumps it; every prune resets it to
  // the actual total. When the estimate crosses `maxRows` the next insert forces
  // a catch-up prune immediately (knownOverCap) instead of waiting a full
  // interval — the rate-limit only suppresses sweeps while we're UNDER cap.
  // Starts at maxRows: until the first prune-probe establishes the real total we
  // assume we MIGHT already be at the boundary, so a fresh process attaching to
  // a full collection still prunes promptly.
  let estimatedTotal = maxRows;
  // Consecutive write failures (reset on any success). Drives the throttled
  // warn + the latched error escalation.
  let consecutiveFailures = 0;
  // Latched once we've escalated to error, so a systematic outage screams ONCE
  // rather than per-write. Reset on the first success.
  let escalated = false;
  // Best-effort in-flight cap so a fire-and-forget burst can't pile unawaited
  // creates against a slow PB.
  let inFlight = 0;

  /**
   * Run `pb.create` with a best-effort timeout so a hung write can't occupy an
   * in-flight slot forever. Rejects on timeout (or any PB error); the caller
   * swallows + counts it. Uses `Promise.race` rather than relying on the create
   * honoring an AbortSignal — the real harness `PbClient.create` does NOT take a
   * signal, so the race is what actually frees the in-flight slot on a hang. We
   * still pass the signal best-effort for any client that DOES honor it.
   */
  async function createWithTimeout(
    record: Record<string, unknown>,
  ): Promise<void> {
    if (writeTimeoutMs <= 0) {
      await pb.create(RESOURCE_SNAPSHOTS_COLLECTION, record);
      return;
    }
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new Error(`pb create timed out after ${writeTimeoutMs}ms`));
      }, writeTimeoutMs);
    });
    // The orphaned create promise keeps running after a timeout wins the race.
    // If a client that ignores the AbortSignal lets it REJECT later, the
    // unhandled rejection would crash the process — swallow it. (The race
    // result is what the caller acts on; this only neutralizes the loser.)
    const create = pb.create(RESOURCE_SNAPSHOTS_COLLECTION, record, {
      signal: ac.signal,
    });
    create.catch(() => {});
    try {
      await Promise.race([create, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function onWriteSuccess(): void {
    consecutiveFailures = 0;
    escalated = false;
  }

  function onWriteFailure(event: string, err: unknown): void {
    consecutiveFailures += 1;
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Latched error escalation: once we cross the threshold, scream ONCE so a
    // systematic PB rejection (unrun migration, outage, schema drift) is loud.
    if (consecutiveFailures >= escalationThreshold && !escalated) {
      escalated = true;
      logger.error?.("resource-snapshot.write-failing-systematically", {
        consecutiveFailures,
        threshold: escalationThreshold,
        error: errorMsg,
      });
      return;
    }
    // Throttled per-failure warn: chatty for the first burst, then periodic so a
    // sustained outage doesn't flood stdout.
    if (
      consecutiveFailures <= escalationThreshold ||
      consecutiveFailures % FAILURE_WARN_THROTTLE_EVERY === 0
    ) {
      logger.warn?.("resource-snapshot.write-failed", {
        event,
        consecutiveFailures,
        error: errorMsg,
      });
    }
  }

  /**
   * Back off the prune when a sweep makes no STRUCTURAL progress while still
   * over cap (no usable ids, or `deleteByFilter` returned 0 — PB delete-rule
   * 403, a filter 400, etc.). Clears `knownOverCap` AND opens a suppression
   * window (`pruneSuppressedUntil`) for one `pruneIntervalMs`. Until that window
   * elapses, the write-path re-arm leaves `knownOverCap` cleared and the prune
   * gate stays shut — so the retry is genuinely gated to once-per-interval
   * rather than re-running the failing list-probe + sweep on every insert
   * (estimatedTotal is still over cap, which would otherwise re-arm immediately).
   */
  function suppressPruneUntilInterval(): void {
    knownOverCap = false;
    const t = now();
    lastPruneAt = t;
    pruneSuppressedUntil = t + pruneIntervalMs;
  }

  async function prune(): Promise<void> {
    try {
      // Cheapest possible "are we over cap?" probe: ask PB for the total IN
      // THIS WRITER'S PARTITION. Scoping by worker_id is what makes the ring cap
      // per-replica (each fleet replica retains its own last `maxRows`) and
      // prevents a busy replica's history from being pruned by an idle peer's
      // sweep (see the MULTI-WRITER note in the file header).
      const head = await pb.list(RESOURCE_SNAPSHOTS_COLLECTION, {
        filter: pruneScopeFilter,
        perPage: 1,
        skipTotal: false,
      });
      const total = head.totalItems;
      // Re-anchor the local estimate to the authoritative count every sweep so a
      // drifted estimate (dropped writes, external inserts) self-corrects.
      estimatedTotal = total;
      if (total <= maxRows) {
        knownOverCap = false;
        return;
      }
      knownOverCap = true;
      // BOUNDED sweep: a cold start over a large backlog makes `surplus`
      // thousands large; listing/deleting all of it in one sweep builds a giant
      // perPage + a thousands-clause `id = ... || ...` filter URL that PB
      // rejects (400/414) so the prune never converges. Cap each sweep to
      // `PRUNE_BATCH_MAX` oldest rows and let `knownOverCap` drain the rest
      // across subsequent inserts/sweeps.
      const surplus = total - maxRows;
      const batch = Math.min(surplus, PRUNE_BATCH_MAX);
      // ROBUST-TO-TIES prune: delete the oldest `batch` rows by stable row
      // IDENTITY (id), NOT by a bare `observed_at < cutoff` strict compare.
      // observed_at is ms-resolution and several snapshots can share the same
      // millisecond (degraded+heartbeat+crash); a strict timestamp cutoff would
      // strand the surplus rows that tie the boundary and spin forever. Listing
      // the oldest rows directly and deleting them by id converges regardless.
      const oldest = await pb.list<{ id: string; observed_at: string }>(
        RESOURCE_SNAPSHOTS_COLLECTION,
        {
          // Scope to THIS writer's partition so we only ever delete our own
          // oldest rows, never a peer replica's.
          filter: pruneScopeFilter,
          sort: "observed_at", // oldest first
          page: 1,
          perPage: batch,
          skipTotal: true,
        },
      );
      const ids = oldest.items
        .map((r) => r.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length === 0) {
        // No usable ids (e.g. a fake/old PB without id) — make no progress.
        // Back off via the interval rate-limit (below) instead of re-arming
        // knownOverCap, which would re-probe on EVERY subsequent insert.
        suppressPruneUntilInterval();
        return;
      }
      const filter = ids.map((id) => `id = ${JSON.stringify(id)}`).join(" || ");
      const deleted = await pb.deleteByFilter(
        RESOURCE_SNAPSHOTS_COLLECTION,
        filter,
      );
      if (deleted > 0) {
        logger.info("resource-snapshot.pruned", { deleted, kept: maxRows });
      }
      estimatedTotal = total - deleted;
      if (deleted === 0) {
        // Made no STRUCTURAL progress despite being over cap (PB delete-rule
        // 403, a filter 400, or the delete matched nothing). Re-arming
        // knownOverCap here would re-run a full list-probe + sweep on EVERY
        // subsequent insert, hammering a broken delete path once per heartbeat.
        // Instead back off: clear knownOverCap AND advance lastPruneAt so the
        // `pruneIntervalMs` rate-limit genuinely gates the retry (once per
        // interval, not once per insert).
        suppressPruneUntilInterval();
        return;
      }
      // Keep catching up next insert while still over cap. A single sweep is
      // bounded at `PRUNE_BATCH_MAX` deletes, so a large backlog drains over
      // multiple inserts/sweeps rather than one oversized request.
      knownOverCap = estimatedTotal > maxRows;
    } catch (err) {
      // Prune is best-effort: a failed sweep just means we retry next time.
      logger.warn?.("resource-snapshot.prune-failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    async write(event, gauges, stats, perBrowser): Promise<void> {
      // BEST-EFFORT in-flight cap: a fire-and-forget burst must not pile
      // unawaited creates against a slow PB. Over the cap we DROP the snapshot
      // (instrumentation, not a durable queue) and warn once-throttled.
      if (inFlight >= maxInFlight) {
        logger.warn?.("resource-snapshot.dropped-over-inflight", {
          event,
          inFlight,
          maxInFlight,
        });
        // DROP→ESCALATION seam (item #2): if PB is 100% broken the in-flight
        // slots stay occupied by hung/timing-out writes, so new snapshots keep
        // hitting THIS drop path instead of the timeout→failure path — which
        // would let the loud `write-failing-systematically` error be delayed or
        // dodged entirely. So once writes are ALREADY failing
        // (`consecutiveFailures > 0` — the hung writes have begun timing out, or
        // PB is rejecting outright) a concurrent drop ALSO counts toward the
        // systematic-failure signal, accelerating the loud error instead of
        // masking it. A drop while writes are succeeding normally
        // (`consecutiveFailures === 0`: healthy backpressure, the in-flight
        // writes are pending-but-fine) does NOT escalate — no false positive.
        if (consecutiveFailures > 0) {
          onWriteFailure(
            event,
            new Error(
              `in-flight cap saturated while writes are failing (inFlight=${inFlight}/${maxInFlight})`,
            ),
          );
        }
        return;
      }
      inFlight += 1;
      try {
        await createWithTimeout({
          observed_at: gauges.ts,
          event,
          // Per-replica attribution (migration 1779990000). "" on the legacy
          // single-process boot() path (workerId omitted) so a query separates
          // fleet-replica rows from the legacy partition. PB stores an unset text
          // field as "" (not null), so "" matches both what PocketBase persists
          // and the null-partition prune filter (`worker_id = ""`); this mirrors
          // the codebase's unset-text-field convention (run-history `job_id ?? ""`,
          // registration `current_job_id ?? ""`).
          worker_id: workerId ?? "",
          pids_current: gaugeOrNull(gauges.cgroupPidsCurrent),
          pids_max: gaugeOrNull(gauges.cgroupPidsMax),
          threads: gaugeOrNull(gauges.treeThreadCount),
          procs: gaugeOrNull(gauges.treeProcCount),
          zombies: gaugeOrNull(gauges.zombieCount),
          fd_count: gaugeOrNull(gauges.selfFdCount),
          rss_mb: gaugeOrNull(gauges.treeRssMb),
          shm_pct: gaugeOrNull(gauges.devShmUsedPct),
          tmp_inode_pct: gaugeOrNull(gauges.tmpInodeUsedPct),
          browsers: perBrowser?.length ?? null,
          contexts_in_use: stats.inUse,
          contexts_available: stats.available,
          per_browser: perBrowser ?? null,
        });
        onWriteSuccess();
        // Local row-count estimate bumps per insert; once it crosses the cap the
        // rate-limit must NOT strand us — force a catch-up prune on this insert.
        // EXCEPTION: while a no-progress backoff window is open, do NOT re-arm;
        // re-arming here is exactly the cascade that hammers a broken delete path
        // once per insert. The interval gate below takes over after the window.
        estimatedTotal += 1;
        if (estimatedTotal > maxRows && now() >= pruneSuppressedUntil) {
          knownOverCap = true;
        }
      } catch (err) {
        // BEST-EFFORT: a missing migration (400), PB outage, or network error
        // must NEVER break the pool. Swallow + count (throttled warn, latched
        // error after the threshold) so a systematic outage is loud without
        // crashing the caller. Learned from a prior incident where a state
        // write that needed an unrun migration 400'd and broke the caller.
        onWriteFailure(event, err);
        return;
      } finally {
        inFlight -= 1;
      }
      // Ring retention: only sweep once per interval (or while known over cap)
      // so a heartbeat burst doesn't issue a delete sweep on every insert. While
      // a no-progress backoff window is open, suppress the interval-driven sweep
      // too — the retry is gated to once the window elapses.
      const t = now();
      const intervalElapsed =
        t - lastPruneAt >= pruneIntervalMs && t >= pruneSuppressedUntil;
      if (knownOverCap || intervalElapsed) {
        lastPruneAt = t;
        await prune();
      }
    },
  };
}
