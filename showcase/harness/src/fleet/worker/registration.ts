/**
 * Worker self-registration + heartbeat (BLITZ S9).
 *
 * On boot a fleet worker UPSERTS a row into the `workers` collection
 * (pb_migrations/1779989600_create_workers.js) advertising its id, endpoint and
 * current capacity (BrowserPool.budget() → workerCapacityFromBudget, S6). Then a
 * self-rescheduling loop heartbeats on a ~60-90s cadence, refreshing
 * `last_heartbeat_at` and the live capacity snapshot. fleet-health (S10) reads
 * those rows back: `last_heartbeat_at` against a staleness window →
 * online | stale | offline (see `isWorkerStale` in contracts.ts), and the
 * capacity_* fields to know how busy each worker is.
 *
 * ── BEST-EFFORT GUARANTEE (the hard requirement) ─────────────────────────
 * Registration and every heartbeat are wrapped so a missing migration, a PB
 * hiccup, a 400 from an unrun migration, or any network error is SWALLOWED and
 * logged — it can NEVER throw into the worker's claim/run loop. This mirrors the
 * resource-snapshot-writer's best-effort discipline: the registry is
 * operational metadata, it must degrade silently and never break the worker it
 * describes. A worker that can't register still pulls and runs jobs; it just
 * won't show up on the fleet-health roster until PB recovers.
 *
 * ── NULL-VS-UNAVAILABLE CONVENTION ───────────────────────────────────────
 * `capacity.pidsCurrent` / `capacity.pidsMax` degrade to a `-1` sentinel
 * off-Linux / on an unreadable cgroup (browser-pool.ts budget()). We map that
 * sentinel to `null` on the PB row (never write -1) so fleet-health can cleanly
 * separate a MEASURED pids ceiling from an UNAVAILABLE one — a stored -1 would
 * be indistinguishable from a genuine count.
 */

import {
  WORKERS_COLLECTION,
  workerCapacityFromBudget,
  type WorkerCapacity,
} from "../contracts.js";
import type { BrowserPoolBudget } from "../../probes/helpers/browser-pool.js";

/**
 * Default heartbeat cadence. 75s sits in the brief's ~60-90s window: frequent
 * enough that a worker is marked stale promptly after it dies, infrequent enough
 * that a fleet of workers doesn't hammer PB. Env-overridable via
 * WORKER_HEARTBEAT_MS.
 */
export const DEFAULT_WORKER_HEARTBEAT_MS = 75_000;

/**
 * Capacity source the worker advertises. The real `BrowserPool` satisfies this
 * structurally via its `budget()` method (S6); tests pass a tiny fake. Kept to
 * the single method we consume so the registration path never drags the pool's
 * full surface into its dependency graph.
 */
export interface WorkerPoolBudgetSource {
  budget(): BrowserPoolBudget;
}

/**
 * Minimal PB surface the registration writer needs — a structural subset of the
 * harness `PbClient` so the real client satisfies it and tests can pass a tiny
 * fake. `upsertByField` is the find-or-create+update primitive that keeps the
 * roster at exactly one row per `worker_id` (it handles the TOCTOU race against
 * the unique index internally — see pb-client.ts).
 */
export interface RegistrationPbClient {
  upsertByField<T>(
    collection: string,
    field: string,
    value: string,
    record: Record<string, unknown>,
  ): Promise<T>;
  /**
   * Delete every row matching a PB filter, returning the count deleted. Used by
   * `deregister()` on graceful drain to remove this worker's own registry row
   * by its `worker_id` unique key (the handle never holds the PB row `id`, since
   * registration upserts BY FIELD and never reads the row back). The real
   * harness `PbClient` already exposes this (pb-client.ts), so production wiring
   * is unchanged; test fakes add a `deleteByFilter` stub/spy.
   */
  deleteByFilter(collection: string, filter: string): Promise<number>;
}

/** Logger surface — matches the harness optional-method idiom. */
export interface RegistrationLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
  debug?(msg: string, meta?: Record<string, unknown>): void;
}

export interface WorkerRegistrationOptions {
  pb: RegistrationPbClient;
  pool: WorkerPoolBudgetSource;
  logger: RegistrationLogger;
  /** Stable worker id (matches S0 JobView.claimed_by). */
  workerId: string;
  /** Worker's reachable endpoint URL (scheme://host:port) for control-plane probes. */
  endpoint: string;
  /** Heartbeat cadence (ms). Defaults to env WORKER_HEARTBEAT_MS or 75s. */
  heartbeatMs?: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Injectable timer scheduler for tests. Defaults to setInterval. */
  setIntervalImpl?: typeof setInterval;
  /** Injectable timer canceller for tests. Defaults to clearInterval. */
  clearIntervalImpl?: typeof clearInterval;
}

/**
 * A running worker registration: the boot upsert has fired and a heartbeat loop
 * is scheduled. Call `stop()` on worker shutdown to cancel the loop and let the
 * process exit cleanly.
 */
export interface WorkerRegistration {
  /**
   * Perform one heartbeat write NOW (best-effort). Exposed so a worker can
   * heartbeat opportunistically (e.g. right after winning/finishing a job) and
   * so tests can drive a beat without the timer. `currentJobId` is the job the
   * worker is running, or null when idle. Once `deregister()` has been invoked
   * the handle is LATCHED: any later heartbeat is a logged no-op, so a
   * straggler beat can never re-create the deleted roster row.
   */
  heartbeat(currentJobId: string | null): Promise<void>;
  /** Cancel the heartbeat loop. Idempotent. */
  stop(): void;
  /**
   * Deregister this worker on a GRACEFUL drain: best-effort DELETE this
   * worker's registry row (by its `worker_id` unique key) so fleet-health never
   * sees a stale row for a gracefully-drained worker (no row → no 180s reclaim →
   * no red "crashed/unreachable" overlay), letting the abandoned job reach the
   * 300s lease expiry where the sweeper re-queues it neutral-gray.
   *
   * LATCHES the handle synchronously on entry, then runs the DELETE as the
   * terminal link of the handle's write-serialization chain. Two hazards both
   * stem from the final job-settle heartbeat being fire-and-forget (`void
   * registration.heartbeat(...)` in `runWorker`'s `onCurrentJobChange` wiring,
   * orchestrator.ts): (1) a still-in-flight upsert could land AFTER the delete
   * and re-create the row — closed by chaining the delete behind every prior
   * write; (2) a heartbeat issued AFTER deregister() starts (e.g. the
   * drain-abandon branch firing `onCurrentJobChange(null)` when a wedged
   * driver finally settles, after the drain grace already detached) would
   * upsert the row right back via find-or-create — closed by the latch, which
   * turns every later `heartbeat()`/write into a logged no-op. Together they
   * make the no-re-upsert guarantee independent of caller ordering.
   *
   * Best-effort: a failed delete (or a rejected prior write) is logged and
   * swallowed, never thrown into shutdown — the worst case degrades to today's
   * behavior (the row persists, fleet-health reclaims it red at 180s), not a
   * regression. Call AFTER `stop()` so the periodic heartbeat timer is cancelled
   * (the latch also covers a straggler tick). The crash path (process died,
   * no deregistration) keeps today's red-overlay reclaim — deregistration is the
   * marker that distinguishes a graceful drain from a crash.
   */
  deregister(): Promise<void>;
}

function resolveHeartbeatMs(explicit: number | undefined): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const envRaw = process.env.WORKER_HEARTBEAT_MS;
  const envParsed = envRaw ? parseInt(envRaw, 10) : NaN;
  if (Number.isFinite(envParsed) && envParsed > 0) return envParsed;
  return DEFAULT_WORKER_HEARTBEAT_MS;
}

/**
 * Map a capacity gauge to the PB field value: the `-1` "unavailable" sentinel
 * (off-Linux / unreadable cgroup) becomes `null` so fleet-health can separate a
 * MEASURED reading from an UNAVAILABLE one. The context counts (inUse /
 * available / max) are never negative, so only the pids gauges can be sentinels;
 * applying the same map uniformly is harmless and keeps the row shape obvious.
 */
function gaugeOrNull(value: number): number | null {
  return value < 0 ? null : value;
}

/**
 * Build the PB row record for a worker from its capacity snapshot. `nowIso` is
 * the heartbeat timestamp; `registeredAt` is only written on the boot upsert via
 * the spread in `register` (upsert merges, so a heartbeat update never clobbers
 * the original registered_at — we simply omit it from the heartbeat patch).
 */
function capacityRecord(
  capacity: WorkerCapacity,
  endpoint: string,
  currentJobId: string | null,
  nowIso: string,
): Record<string, unknown> {
  return {
    endpoint,
    capacity_in_use: gaugeOrNull(capacity.inUse),
    capacity_available: gaugeOrNull(capacity.available),
    capacity_max: gaugeOrNull(capacity.max),
    capacity_pids_current: gaugeOrNull(capacity.pidsCurrent),
    capacity_pids_max: gaugeOrNull(capacity.pidsMax),
    // PB date fields treat "" as empty; an idle worker writes "" so the column
    // is cleanly "no current job" rather than a stale id.
    current_job_id: currentJobId ?? "",
    last_heartbeat_at: nowIso,
  };
}

/**
 * Register a worker and start its heartbeat loop. Returns a handle whose
 * `stop()` cancels the loop. The initial registration upsert is performed
 * synchronously-awaited so a caller can `await registerWorker(...)` and know the
 * boot row attempt has completed (best-effort: it never rejects). The heartbeat
 * loop is then scheduled on the cadence.
 */
export async function registerWorker(
  options: WorkerRegistrationOptions,
): Promise<WorkerRegistration> {
  const { pb, pool, logger, workerId, endpoint } = options;
  const heartbeatMs = resolveHeartbeatMs(options.heartbeatMs);
  const now = options.now ?? Date.now;
  const setIntervalFn = options.setIntervalImpl ?? setInterval;
  const clearIntervalFn = options.clearIntervalImpl ?? clearInterval;

  // DEREGISTERED LATCH: set synchronously at deregister() entry, BEFORE any
  // await — so a heartbeat arriving after deregister() has merely STARTED is
  // already a no-op. Without it, any late heartbeat (the drain-abandon branch's
  // fire-and-forget `onCurrentJobChange(null)` is the concrete production
  // path) would re-create the just-deleted row via upsertByField's
  // find-or-create and resurrect the 180s red-reclaim flap FIX 3 removes.
  let deregistered = false;

  /** One best-effort upsert. `isRegister` adds `registered_at` to the patch. */
  async function write(
    currentJobId: string | null,
    isRegister: boolean,
  ): Promise<void> {
    try {
      const capacity = workerCapacityFromBudget(pool.budget());
      const nowIso = new Date(now()).toISOString();
      const record = capacityRecord(capacity, endpoint, currentJobId, nowIso);
      if (isRegister) {
        // Only the boot upsert seeds registered_at. A heartbeat update merges
        // the patch over the existing row, so omitting registered_at on
        // subsequent beats preserves the original registration time.
        record.registered_at = nowIso;
      }
      await pb.upsertByField(WORKERS_COLLECTION, "worker_id", workerId, record);
      logger.info(isRegister ? "worker.registered" : "worker.heartbeat", {
        workerId,
        endpoint,
        capacityInUse: capacity.inUse,
        capacityAvailable: capacity.available,
        currentJobId,
      });
    } catch (err) {
      // BEST-EFFORT: a missing migration (400), PB outage, or network error
      // must NEVER break the worker loop. Swallow + warn so the gap is visible
      // without crashing the thing it observes.
      logger.warn?.(
        isRegister ? "worker.register-failed" : "worker.heartbeat-failed",
        {
          workerId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // IN-FLIGHT-WRITE SERIALIZATION (the no-re-upsert guarantee lives HERE, not in
  // caller ordering). Every upsert is funneled through `lastWrite`, a promise
  // chain that resolves only after the prior write SETTLES — so writes never
  // interleave, and `deregister()` appends its DELETE as the chain's TERMINAL
  // link, guaranteeing every prior upsert settled before the delete runs. WHY
  // THIS IS REQUIRED: the final job-settle heartbeat is FIRE-AND-FORGET (`void
  // registration.heartbeat(...)` in `runWorker`'s `onCurrentJobChange` wiring,
  // orchestrator.ts; the worker loop only attaches `.catch`, never awaits), so
  // `await worker.stop()` resolving guarantees the heartbeat was CALLED, NOT
  // that its PB upsert COMPLETED. A still-in-flight upsert could otherwise land
  // AFTER the delete and re-create the row. `write()` already swallows its own
  // errors (never rejects), so the chain never breaks; we still catch
  // defensively so a future throwing `write` can't poison the chain.
  let lastWrite: Promise<void> = Promise.resolve();
  function serializedWrite(
    currentJobId: string | null,
    isRegister: boolean,
  ): Promise<void> {
    // LATCH CHECK AT ENQUEUE TIME (synchronous): a write requested at or after
    // deregister() entry must never enqueue — the chain's terminal link is the
    // row DELETE, and anything queued behind it would re-create the row via
    // upsertByField's find-or-create. Writes enqueued BEFORE deregister() are
    // unaffected: the delete is chained behind them, so they settle first.
    if (deregistered) {
      logger.debug?.("worker.heartbeat-after-deregister-skipped", {
        workerId,
        currentJobId,
      });
      return Promise.resolve();
    }
    lastWrite = lastWrite.then(
      () => write(currentJobId, isRegister),
      () => write(currentJobId, isRegister),
    );
    return lastWrite;
  }

  // Boot registration (idle: no job claimed yet).
  await serializedWrite(null, true);

  let timer: ReturnType<typeof setIntervalFn> | undefined = setIntervalFn(
    () => {
      // The loop heartbeats as IDLE (null) — a worker running a job heartbeats
      // explicitly via the returned `heartbeat(jobId)` on its run path; the
      // periodic safety beat just refreshes liveness so fleet-health doesn't mark
      // a long-idle worker stale.
      void serializedWrite(null, false);
    },
    heartbeatMs,
  );

  // Don't let the heartbeat timer keep the process alive on its own (the worker
  // loop owns process lifetime). `unref` is a no-op for an injected fake timer.
  if (timer && typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  return {
    async heartbeat(currentJobId: string | null): Promise<void> {
      await serializedWrite(currentJobId, false);
    },
    stop(): void {
      if (timer !== undefined) {
        clearIntervalFn(timer);
        timer = undefined;
      }
    },
    async deregister(): Promise<void> {
      // Latch SYNCHRONOUSLY before any await: from this point every
      // `heartbeat()`/periodic write is a logged no-op, so a beat arriving
      // while the delete is still in flight (or any time after) can never
      // re-create the row via upsertByField's find-or-create.
      deregistered = true;
      const doDelete = async (): Promise<void> => {
        try {
          // JSON.stringify escapes quotes/backslashes in the id — same
          // defense-in-depth filter idiom as createStatusReader /
          // verifyWorkerRegistered (orchestrator.ts). workerId is our own
          // hostname-derived id, but never interpolate raw into a PB filter.
          await pb.deleteByFilter(
            WORKERS_COLLECTION,
            `worker_id = ${JSON.stringify(workerId)}`,
          );
          logger.info("worker.deregistered", { workerId, endpoint });
        } catch (err) {
          // BEST-EFFORT: a failed delete degrades to today's behavior (the row
          // persists, fleet-health reclaims it red at the 180s stale window) —
          // NOT a regression. Swallow + warn; never throw into shutdown.
          logger.warn?.("worker.deregister-failed", {
            workerId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      // Route the DELETE THROUGH the write-serialization chain as its terminal
      // link: every still-pending (fire-and-forget) heartbeat upsert settles
      // BEFORE the delete runs, and no upsert can interleave with it. The
      // rejection arm is defensive only — `write`/`doDelete` swallow their own
      // errors, so the chain never rejects.
      lastWrite = lastWrite.then(doDelete, doDelete);
      await lastWrite;
    },
  };
}
