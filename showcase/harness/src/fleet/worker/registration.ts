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

import { WORKERS_COLLECTION, workerCapacityFromBudget } from "../contracts.js";
import type { WorkerCapacity } from "../contracts.js";
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
}

/** Logger surface — matches the harness optional-method idiom. */
export interface RegistrationLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
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
   * worker is running, or null when idle.
   */
  heartbeat(currentJobId: string | null): Promise<void>;
  /** Cancel the heartbeat loop. Idempotent. */
  stop(): void;
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

  // Boot registration (idle: no job claimed yet).
  await write(null, true);

  let timer: ReturnType<typeof setIntervalFn> | undefined = setIntervalFn(
    () => {
      // The loop heartbeats as IDLE (null) — a worker running a job heartbeats
      // explicitly via the returned `heartbeat(jobId)` on its run path; the
      // periodic safety beat just refreshes liveness so fleet-health doesn't mark
      // a long-idle worker stale.
      void write(null, false);
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
      await write(currentJobId, false);
    },
    stop(): void {
      if (timer !== undefined) {
        clearIntervalFn(timer);
        timer = undefined;
      }
    },
  };
}
