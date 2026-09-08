/**
 * Control-plane FLEET-HEALTH monitor (BLITZ S10).
 *
 * ── WHERE THIS SITS ────────────────────────────────────────────────────
 * The worker self-register slot (S9, `worker/registration.ts`) UPSERTS one row
 * per live worker into the `workers` collection (migration
 * `1779989600_create_workers.js`) and heartbeats its `last_heartbeat_at` on a
 * ~75s cadence. This module is the CONTROL-PLANE leg that reads those rows back:
 * it derives each worker's `WorkerHealthState` from its heartbeat age
 * (`isWorkerStale`, contracts.ts) and, for any worker that has gone STALE /
 * OFFLINE, REQUEUES that worker's in-flight jobs so a dead worker's claimed work
 * doesn't sit wedged until its lease independently expires.
 *
 * ── DETECT → REQUEUE → RESTART ─────────────────────────────────────────
 *   DETECT  — list the `workers` roster, compute liveness per row from
 *             `last_heartbeat_at` vs `staleAfterMs`. A row fresher than the
 *             window is `online` and left untouched.
 *   REQUEUE — for a stale/offline worker, find its still-in-flight
 *             (`claimed`/`running`) `probe_jobs` rows (`claimed_by` = that
 *             worker) and release each back to `pending` via the SAME S0
 *             `releaseJob(jobId, deadWorker, "pending")` CAS the queue's
 *             `sweepExpired` uses — the CAS authorizes on `claimed_by` (still
 *             the dead worker), so the release is atomic and on-behalf-of the
 *             dead holder. Each reclaimed job emits a `worker-crashed-mid-job`
 *             `PoolCommError` (REQ-B) so the dashboard surfaces "couldn't reach
 *             the pool" distinctly from a probe red.
 *   RESTART — in staging a wedged worker is recovered by a Railway
 *             `serviceInstanceRedeploy`; that is injected as a best-effort
 *             `restartWorker?` hook (env/guarded by the wiring slot). Locally
 *             (N=1, docker) the default is a NO-OP — docker / the worker's own
 *             relaunch handles recovery, so local runs need no Railway wiring.
 *
 * ── PID-SATURATION ALARM (the second leg) ──────────────────────────────
 * The same roster read carries each worker's `capacity_pids_current` /
 * `capacity_pids_max` gauges (written by S9's ~75s heartbeat off
 * `BrowserPool.budget()`). Until now nothing in non-test source compared them,
 * so a worker leaking PIDs toward its cgroup ceiling was invisible: it kept
 * heartbeating (so DETECT above saw `online`), kept claiming jobs, and every one
 * of them aborted on timeout. This module now alarms on the RISING EDGE of
 * `pids.current / pids.max >= pidSaturationRatio`, latched per worker with a
 * hysteresis clear so a saturated worker pages once, not every 15s cycle.
 *
 * ── RELATIONSHIP TO THE PRODUCER'S sweepExpired ────────────────────────
 * The producer's `sweepExpired` (S4) reclaims jobs whose LEASE has expired —
 * it is lease-timeout-driven and worker-agnostic. fleet-health is the
 * HEARTBEAT-driven complement: a worker can stop heartbeating (crashed,
 * wedged, OOM-killed) while a just-renewed lease still has time on the clock,
 * which `sweepExpired` would not reclaim until that lease lapses. fleet-health
 * detects the dead worker FROM ITS HEARTBEAT and reclaims its jobs immediately,
 * cutting the dead-worker-to-requeue latency from "lease window" to "stale
 * window". The two paths are idempotent against each other: both release via
 * the same S0 CAS, and a row already reclaimed by one returns `released:false`
 * to the other (a benign no-op race, logged at debug).
 *
 * ── INJECTION ──────────────────────────────────────────────────────────
 * Everything is injected (PB read, the S0 claim CAS, clock, staleness window,
 * the restart hook) so the monitor is unit-testable with fakes and owns no
 * PocketBase / Railway of its own — `runControlPlane` constructs the real deps.
 */

import type { Logger } from "../../types/index.js";
import type { PbClient } from "../../storage/pb-client.js";
import type { JobClaimClient, JobView } from "../job-claim.js";
import { PROBE_JOBS_COLLECTION } from "../queue-client.js";
import {
  WORKERS_COLLECTION,
  heartbeatParseable,
  isWorkerStale,
  deriveHealth,
  pidUsageRatio,
} from "../contracts.js";
import type { PoolCommError } from "../contracts.js";

/**
 * Default staleness window: a worker whose `last_heartbeat_at` is older than
 * this is treated as stale/offline and its in-flight jobs are reclaimed. Sized
 * at ~2.4x the default ~75s heartbeat cadence (DEFAULT_WORKER_HEARTBEAT_MS) so a
 * single missed beat (e.g. a slow PB write) doesn't flap a healthy worker to
 * stale — it takes two-plus consecutive missed beats. Env-overridable by the
 * wiring slot via WORKER_STALE_AFTER_MS.
 */
export const DEFAULT_WORKER_STALE_AFTER_MS = 180_000;

/**
 * Default GC window: a worker whose `last_heartbeat_at` is older than this is a
 * long-dead row from a prior deploy generation (a crashed/replaced worker that
 * never deregistered) — fleet-health DELETES it from the roster rather than
 * counting it unhealthy and pointlessly "reclaiming"/restart-attempting it every
 * cycle forever. Sized at 24h, vastly larger than `staleAfterMs` (180s) so a
 * merely-stale (still-recoverable) worker is NEVER GC'd — only generations long
 * past any plausible recovery. Env-overridable by the wiring slot via
 * WORKER_GC_AFTER_MS.
 */
export const DEFAULT_WORKER_GC_AFTER_MS = 86_400_000;

/**
 * Default PID-SATURATION alarm threshold, as a fraction of a worker's cgroup
 * `pids.max` ceiling. A worker whose `capacity_pids_current / capacity_pids_max`
 * crosses this fires the saturation hook.
 *
 * WHY THIS EXISTS: prod `harness-workers` replicas accumulate zombie chromium
 * PIDs until they hit the platform-fixed `pids.max=1000` ceiling, at which point
 * the worker cannot fork and every probe it claims aborts on timeout. Measured
 * at the 2026-08-03 and 2026-08-10 incidents: `pids=1000/1000`, `837/1000`,
 * hundreds of `timeout after 600000ms` abort rows, and jobs sitting pending for
 * 42 minutes on a 15-minute cadence. NOTHING alarmed — the `pool-unrecoverable`
 * signal only fires when the self-heal breaker gives up, which a PID-starved
 * (but still heartbeating) worker never reaches, and the capacity gauges the
 * worker heartbeats here were read by nobody.
 *
 * WHY 0.75: at the observed leak rate (~1000 PIDs over ~7 days) 75% leaves
 * roughly 36 hours of operator lead time before the ceiling, which is more than
 * one working day — early enough to act, late enough that ordinary busy-worker
 * churn (a full context budget is nowhere near 750 PIDs) never trips it.
 * Env-overridable by the wiring slot via WORKER_PID_SATURATION_RATIO.
 */
export const DEFAULT_PID_SATURATION_RATIO = 0.75;

/**
 * Default CLEAR threshold for the PID-saturation latch (hysteresis). The alarm
 * is EDGE-triggered: it fires once when a worker crosses
 * `pidSaturationRatio` and stays latched — silent — until that worker drops back
 * below THIS ratio. Without the gap, a worker parked exactly at the threshold
 * would re-alarm on every cycle (the monitor ticks every
 * DEFAULT_FLEET_HEALTH_INTERVAL_MS = 15s, i.e. 4 alerts/minute for the ~36h
 * lead-time window — an alarm that fires constantly is worse than none).
 * Env-overridable via WORKER_PID_SATURATION_CLEAR_RATIO.
 */
export const DEFAULT_PID_SATURATION_CLEAR_RATIO = 0.65;

/** Max worker rows scanned per monitor cycle — bounds the roster read cost. */
const WORKERS_PAGE = 100;

/** Max in-flight job rows reclaimed per worker per cycle — bounds the scan. */
const RECLAIM_PAGE = 100;

/**
 * The persisted `workers` row shape fleet-health reads. Snake-case columns as
 * the PB records API returns them (see the create_workers migration). Only the
 * fields fleet-health consumes are typed.
 *
 * The two `capacity_pids_*` gauges are written by the worker's ~75s heartbeat
 * (`worker/registration.ts` `capacityRecord`) off `BrowserPool.budget()`. They
 * are `null` — never `-1` — when the cgroup PID controller is unreadable
 * (off-Linux, missing controller): the registration writer maps the pool's `-1`
 * sentinel to null precisely so a MEASURED count is distinguishable from an
 * UNAVAILABLE one. The saturation check honours that convention and treats
 * null/absent as "not measured", never as 0.
 */
interface WorkerRecord {
  id: string;
  worker_id: string;
  last_heartbeat_at: string;
  current_job_id?: string;
  /** cgroup `pids.current` at the last heartbeat; null when unmeasurable. */
  capacity_pids_current?: number | null;
  /** cgroup `pids.max` ceiling at the last heartbeat; null when unmeasurable. */
  capacity_pids_max?: number | null;
}

/**
 * One worker's PID-saturation alarm payload, handed to `onPidSaturation` on the
 * rising edge. Pure counters — safe to put in a Slack message or a public-read
 * status row.
 */
export interface PidSaturationReport {
  /** The saturating worker's id (joins the roster row and its claims). */
  workerId: string;
  /** cgroup `pids.current` read from the worker's last heartbeat. */
  pidsCurrent: number;
  /** cgroup `pids.max` ceiling read from the worker's last heartbeat. */
  pidsMax: number;
  /** `pidsCurrent / pidsMax`, the value that crossed the threshold. */
  ratio: number;
  /** The threshold ratio that was crossed (echoed so the alarm is self-describing). */
  threshold: number;
  /** Heartbeat timestamp the saturating gauges were read from. */
  lastHeartbeatAt: string;
  /** ISO timestamp of the cycle that detected the crossing. */
  observedAt: string;
}

/**
 * Best-effort alarm hook fired ONCE per worker on the rising edge of PID
 * saturation (and again only after that worker has recovered below the clear
 * ratio). The wiring slot routes it to the operator channel; the default is
 * undefined (detection still counts into `FleetHealthResult.pidSaturated`, which
 * is what the unit tests and the /health surface read). MUST never throw into
 * the monitor loop — the monitor wraps it anyway, mirroring `restartWorker`.
 */
export type PidSaturationHook = (
  report: PidSaturationReport,
) => void | Promise<void>;

/**
 * Best-effort hook to RESTART a wedged worker (staging: Railway
 * `serviceInstanceRedeploy`). Invoked once per detected stale/offline worker
 * after the reclaim attempt (which may have reclaimed zero jobs). MUST never
 * throw into the monitor loop — the
 * monitor wraps it, but the implementation should also be self-contained
 * best-effort. The default is a no-op (local docker handles recovery).
 */
export type RestartWorkerHook = (workerId: string) => void | Promise<void>;

/**
 * A reclaimed job's comm error paired with the dashboard status-row key the
 * overlay must be written onto (REQ-B). A bare `PoolCommError` carries the
 * `jobId`/`workerId` but NOT the `probe_key` the dashboard reads, so we pair
 * each synthesized error with the reclaimed job's `aggregateKey` (its
 * `probe_key`, i.e. the `d6:<slug>` aggregate row) so the control-plane can
 * hand it straight to `ResultAggregator.aggregateCommError` without a
 * second PB lookup.
 */
export interface ReclaimedCommError {
  /** The synthesized `worker-crashed-mid-job` comm error. */
  commError: PoolCommError;
  /** The reclaimed job's `probe_key` — the `d6:<slug>` dashboard status-row key. */
  aggregateKey: string;
}

/** Outcome of one `checkOnce()` monitor cycle. */
export interface FleetHealthResult {
  /** Workers whose heartbeat is fresh (left untouched). */
  online: number;
  /** Workers detected stale/offline this cycle. */
  unhealthy: number;
  /** In-flight jobs reclaimed (released back to pending) this cycle. */
  reclaimed: number;
  /** Comm errors synthesized for the reclaimed (crashed-worker) jobs. */
  commErrors: PoolCommError[];
  /**
   * The reclaimed-job comm errors paired with the dashboard status-row key the
   * overlay must land on (REQ-B). One entry per entry in `commErrors`, in the
   * same order — the control-plane feeds these to the aggregator so a crashed
   * worker's "unreachable" overlay actually reaches the dashboard.
   */
  reclaimedOverlays: ReclaimedCommError[];
  /** Restart-hook invocations attempted this cycle. */
  restartsAttempted: number;
  /**
   * Long-dead roster rows GC-deleted this cycle (heartbeat older than
   * `gcAfterMs`). These are NOT counted in `unhealthy` and are NOT
   * reclaimed/restart-attempted — they are leftover rows from prior deploy
   * generations being pruned so the roster stops accumulating ghost rows.
   */
  gcDeleted: number;
  /**
   * Workers that crossed the PID-saturation threshold ON THIS CYCLE (the rising
   * edge only — a worker already latched saturated reports once, then stays out
   * of this list until it recovers below the clear ratio). One entry per fired
   * `onPidSaturation` invocation, so a caller can count alarms without
   * re-deriving the edge.
   */
  pidSaturated: PidSaturationReport[];
}

export interface FleetHealthDeps {
  pb: PbClient;
  /** S0's atomic claim/release primitive — release-to-pending reclaims jobs. */
  claim: JobClaimClient;
  logger: Logger;
  /** Staleness window (ms). Default `DEFAULT_WORKER_STALE_AFTER_MS`. */
  staleAfterMs?: number;
  /**
   * GC window (ms): roster rows whose heartbeat is older than this are deleted
   * (long-dead prior-generation rows) rather than reclaimed. Default
   * `DEFAULT_WORKER_GC_AFTER_MS` (24h). MUST be >> `staleAfterMs` so a
   * recoverable worker is never GC'd — ENFORCED at construction:
   * `createFleetHealthMonitor` throws if the resolved `gcAfterMs` does not
   * strictly exceed the resolved `staleAfterMs`.
   */
  gcAfterMs?: number;
  /** Injectable clock (tests). Returns ms-since-epoch. Defaults to Date.now. */
  now?: () => number;
  /**
   * Best-effort restart hook for a wedged worker (staging Railway redeploy).
   * Default no-op — local docker / the worker's own relaunch handles recovery.
   */
  restartWorker?: RestartWorkerHook;
  /**
   * PID-saturation alarm threshold (fraction of `pids.max`). Default
   * `DEFAULT_PID_SATURATION_RATIO` (0.75). Must be in (0, 1].
   */
  pidSaturationRatio?: number;
  /**
   * Latch-clear threshold (fraction of `pids.max`). Default
   * `DEFAULT_PID_SATURATION_CLEAR_RATIO` (0.65). MUST be strictly below
   * `pidSaturationRatio` — ENFORCED at construction, see below.
   */
  pidSaturationClearRatio?: number;
  /**
   * Best-effort PID-saturation alarm hook. Default undefined (detection still
   * counts into `FleetHealthResult.pidSaturated`); the wiring slot injects the
   * operator alert.
   */
  onPidSaturation?: PidSaturationHook;
}

/** The control-plane's fleet-health monitor — drives the detect/requeue cycle. */
export interface FleetHealthMonitor {
  /**
   * Scan the worker roster, reclaim the in-flight jobs of every stale/offline
   * worker, and fire the restart hook for each. Returns per-cycle counts. Never
   * throws — a single bad row / failed reclaim is logged and skipped so one
   * poison worker can't wedge the whole monitor.
   */
  checkOnce(): Promise<FleetHealthResult>;
}

export function createFleetHealthMonitor(
  deps: FleetHealthDeps,
): FleetHealthMonitor {
  const { pb, claim, logger } = deps;
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_WORKER_STALE_AFTER_MS;
  const gcAfterMs = deps.gcAfterMs ?? DEFAULT_WORKER_GC_AFTER_MS;
  // Fail-loud at construction: GC runs FIRST in the cycle, so if the GC window
  // does not strictly exceed the stale window, a merely-stale (recoverable)
  // worker is GC-DELETED before its in-flight jobs are reclaimed — the jobs
  // wedge until lease expiry and the crashed-worker overlay never fires. The
  // two windows are independently env-overridable (WORKER_GC_AFTER_MS /
  // WORKER_STALE_AFTER_MS via the wiring slot), so an unsafe combo is a
  // misconfiguration — die immediately (visible in deploy CI / Railway
  // health-check) rather than silently mis-GC every cycle. Mirrors the
  // worker-loop heartbeatMs/leaseSeconds fail-loud idiom.
  if (gcAfterMs <= staleAfterMs) {
    throw new Error(
      `Unsafe fleet-health config: gcAfterMs (${gcAfterMs}, env WORKER_GC_AFTER_MS) must be > staleAfterMs (${staleAfterMs}, env WORKER_STALE_AFTER_MS); otherwise GC deletes a merely-stale (recoverable) worker's roster row before its in-flight jobs are reclaimed, wedging those jobs until lease expiry with no crashed-worker overlay.`,
    );
  }
  const pidRatio = deps.pidSaturationRatio ?? DEFAULT_PID_SATURATION_RATIO;
  const pidClearRatio =
    deps.pidSaturationClearRatio ?? DEFAULT_PID_SATURATION_CLEAR_RATIO;
  // Fail-loud at construction, same idiom as the gc/stale guard above. Both
  // ratios are independently env-overridable by the wiring slot
  // (WORKER_PID_SATURATION_RATIO / WORKER_PID_SATURATION_CLEAR_RATIO), so an
  // unsafe combo is a misconfiguration. A non-positive or >1 alarm ratio makes
  // the alarm either permanently-on or unreachable; a clear ratio that does not
  // sit STRICTLY BELOW it removes the hysteresis gap, so a worker parked at the
  // threshold latches and unlatches on alternating cycles and re-alarms every
  // 15s forever — the exact "fires constantly is worse than none" failure the
  // latch exists to prevent. Die immediately (visible in deploy CI / Railway
  // health-check) rather than page an operator four times a minute.
  if (!(pidRatio > 0) || pidRatio > 1) {
    throw new Error(
      `Unsafe fleet-health config: pidSaturationRatio (${pidRatio}, env WORKER_PID_SATURATION_RATIO) must be in (0, 1]; outside that range the PID-saturation alarm is either permanently firing or can never fire.`,
    );
  }
  if (!(pidClearRatio < pidRatio) || pidClearRatio < 0) {
    throw new Error(
      `Unsafe fleet-health config: pidSaturationClearRatio (${pidClearRatio}, env WORKER_PID_SATURATION_CLEAR_RATIO) must be >= 0 and STRICTLY below pidSaturationRatio (${pidRatio}, env WORKER_PID_SATURATION_RATIO); without a hysteresis gap a worker sitting at the threshold re-alarms on every monitor cycle.`,
    );
  }
  const onPidSaturation = deps.onPidSaturation;
  // EDGE-TRIGGER LATCH: worker ids currently alarmed. A worker enters on the
  // rising edge (ratio >= pidRatio) and leaves only when it recovers below
  // `pidClearRatio` or its roster row is GC'd — so the alarm fires ONCE per
  // saturation episode rather than once per 15s cycle. In-memory by design: a
  // control-plane restart re-arms every worker, which is the correct posture
  // (a fresh control-plane has told nobody anything yet).
  const pidSaturationLatched = new Set<string>();
  const now = deps.now ?? Date.now;
  // Whether a REAL restart hook was injected (staging Railway redeploy) vs the
  // default no-op. Used to demote the misleading `restartsAttempted` metric: a
  // no-op hook against a ghost row that reclaimed nothing was counting a
  // "restart attempt" that never did anything, inflating the metric every cycle.
  const hasRealRestartHook = typeof deps.restartWorker === "function";
  // Default restart is a no-op (local docker handles recovery). The wiring slot
  // injects the Railway serviceInstanceRedeploy hook in staging.
  const restartWorker: RestartWorkerHook = deps.restartWorker ?? (() => {});

  /**
   * Reclaim a single stale/offline worker's in-flight jobs: list its
   * claimed/running `probe_jobs` rows and release each back to pending via the
   * S0 CAS on behalf of the dead holder, synthesizing one
   * `worker-crashed-mid-job` comm error per reclaimed job.
   */
  async function reclaimWorkerJobs(
    workerId: string,
    nowMs: number,
  ): Promise<{
    reclaimed: number;
    commErrors: PoolCommError[];
    overlays: ReclaimedCommError[];
  }> {
    const commErrors: PoolCommError[] = [];
    const overlays: ReclaimedCommError[] = [];
    let reclaimed = 0;
    // The dead worker's still-in-flight jobs. PB lacks an OR-of-equals shortcut,
    // so filter the two in-flight states + the dead worker's id server-side.
    // checkOnce is documented "never throws": a filter error or transient
    // pb.list failure for ONE worker must NOT abort the whole cycle (which would
    // skip every subsequent worker's reclamation). Treat a failed read as "no
    // reclaimable jobs for this worker this cycle" — log and return empty so the
    // monitor moves on to the next worker; the next cycle (or the producer's
    // sweepExpired) retries this worker.
    let page: { items: JobView[] };
    try {
      page = await pb.list<JobView>(PROBE_JOBS_COLLECTION, {
        // `workerId` is read back from the workers roster row (DB-sourced, not
        // a compile-time constant). The rest of the codebase deliberately
        // neutralizes this sink class — orchestrator.ts:3240 already uses
        // `JSON.stringify(workerId)` for the same field, queue-client uses the
        // shared `escapeFilterLiteral` helper. A `"`-bearing worker_id (corrupt
        // row, buggy self-registration) would otherwise break out of the
        // literal and either throw the list (silently skipping this worker's
        // reclaim every cycle) or widen the filter to claim OTHER workers'
        // jobs. Match the sibling escape pattern.
        filter: `(status = "claimed" || status = "running") && claimed_by = ${JSON.stringify(workerId)}`,
        perPage: RECLAIM_PAGE,
        skipTotal: true,
      });
    } catch (err) {
      logger.warn("fleet.health.reclaim-list-failed", {
        workerId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { reclaimed: 0, commErrors, overlays };
    }
    const observedAt = new Date(nowMs).toISOString();
    for (const row of page.items) {
      let released: boolean;
      try {
        const r = await claim.releaseJob(row.id, workerId, "pending");
        released = r.released;
      } catch (err) {
        // A transport blip on one row must not abort the rest — the next cycle
        // (or the producer's sweepExpired) retries.
        logger.warn("fleet.health.reclaim-failed", {
          workerId,
          jobId: row.id,
          err: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!released) {
        // The producer's sweepExpired or a late worker report won the race —
        // not an error, nothing for us to reclaim on this row.
        logger.debug("fleet.health.reclaim-skip", {
          workerId,
          jobId: row.id,
        });
        continue;
      }
      reclaimed += 1;
      const commError: PoolCommError = {
        kind: "worker-crashed-mid-job",
        message: `worker ${workerId} went stale (no heartbeat within ${staleAfterMs}ms); re-queued job ${row.id}`,
        workerId,
        jobId: row.id,
        observedAt,
      };
      commErrors.push(commError);
      // Pair the error with the reclaimed job's `probe_key` — the `d6:<slug>`
      // dashboard status-row key the overlay must land on (REQ-B). The
      // control-plane feeds this straight to the aggregator with no second PB
      // lookup, since the JobView we already listed carries `probe_key`.
      overlays.push({ commError, aggregateKey: row.probe_key });
      logger.warn("fleet.health.reclaimed", { workerId, jobId: row.id });
    }
    return { reclaimed, commErrors, overlays };
  }

  return {
    async checkOnce(): Promise<FleetHealthResult> {
      const nowMs = now();
      let page: { items: WorkerRecord[] };
      try {
        page = await pb.list<WorkerRecord>(WORKERS_COLLECTION, {
          perPage: WORKERS_PAGE,
          skipTotal: true,
        });
      } catch (err) {
        // A roster read failure (missing migration, PB blip) must not throw
        // into the monitor interval — log and return an empty cycle; the
        // producer's lease-driven sweepExpired still covers reclamation.
        logger.warn("fleet.health.roster-read-failed", {
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          online: 0,
          unhealthy: 0,
          reclaimed: 0,
          commErrors: [],
          reclaimedOverlays: [],
          restartsAttempted: 0,
          gcDeleted: 0,
          pidSaturated: [],
        };
      }

      let online = 0;
      let unhealthy = 0;
      let reclaimed = 0;
      let restartsAttempted = 0;
      let gcDeleted = 0;
      // Per-cycle count of roster rows whose heartbeat the contract parser
      // can't read (see the unparseable-heartbeat warn below) — surfaced on
      // the cycle log so a persistently corrupt row shows up as a number, not
      // just warn-stream noise.
      let unparseableHeartbeats = 0;
      const commErrors: PoolCommError[] = [];
      const reclaimedOverlays: ReclaimedCommError[] = [];
      const pidSaturated: PidSaturationReport[] = [];

      for (const row of page.items) {
        // GC FIRST — even before the missing-worker-id guard: a row whose
        // heartbeat is older than `gcAfterMs` is a long-dead prior-generation
        // row (crashed/replaced worker that never deregistered). DELETE it
        // best-effort and skip health/reclaim/restart — its jobs, if any, are
        // long-since lease-expired and handled by the producer's sweepExpired,
        // so reclaiming/restart-attempting it every cycle was pure noise
        // (inflating unhealthy/restartsAttempted forever). The delete only
        // needs `row.id`, so an ancient row with a missing/empty worker_id is
        // GC'd too — otherwise it would warn every cycle forever, the exact
        // perpetual noise GC exists to eliminate. A parseable timestamp older
        // than the GC cutoff is required; an unparseable one falls through to
        // the existing stale-handling warn.
        if (
          typeof row.last_heartbeat_at === "string" &&
          !Number.isNaN(Date.parse(row.last_heartbeat_at)) &&
          nowMs - Date.parse(row.last_heartbeat_at) > gcAfterMs
        ) {
          try {
            await pb.delete(WORKERS_COLLECTION, row.id);
            gcDeleted += 1;
            logger.info("fleet.health.gc-deleted", {
              workerId: row.worker_id ?? "<missing>",
              rowId: row.id,
              lastHeartbeatAt: row.last_heartbeat_at,
              gcAfterMs,
            });
          } catch (err) {
            // Best-effort: a failed delete must NOT abort the cycle (same
            // discipline as reclaim). The row simply survives to the next cycle.
            logger.warn("fleet.health.gc-failed", {
              workerId: row.worker_id ?? "<missing>",
              rowId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
          }
          // Release this worker's saturation latch alongside its roster row —
          // otherwise the in-memory Set accumulates one entry per retired
          // deploy generation for the control-plane's whole lifetime. Safe to
          // do even when the delete threw: the row survives to the next cycle,
          // where an un-recovered gauge simply re-arms the latch.
          if (typeof row.worker_id === "string") {
            pidSaturationLatched.delete(row.worker_id);
          }
          continue;
        }
        const workerId = row.worker_id;
        if (typeof workerId !== "string" || workerId.length === 0) {
          // A roster row without a usable worker_id can't be joined to claims —
          // skip it rather than reclaim against an empty owner. (Malformed but
          // NOT GC-old: the GC branch above already handled ancient rows.)
          logger.warn("fleet.health.row-missing-worker-id", { rowId: row.id });
          continue;
        }
        // M4 N2: an unparseable last_heartbeat_at makes isWorkerStale return
        // false (treat-unknown-as-not-yet-stale) so a malformed row can't flap
        // the whole fleet to offline — but a PERSISTENTLY bad timestamp means
        // this worker silently never gets reclaimed. Warn so the orphaned row is
        // visible to an operator (the next valid heartbeat clears it). The
        // predicate is the contract's `heartbeatParseable` companion — the
        // EXACT complement of what `isWorkerStale` can see (same PB space-form
        // normalization) — not a raw engine-lenient `Date.parse`, so the warn
        // fires precisely when the staleness check is blind.
        if (
          typeof row.last_heartbeat_at !== "string" ||
          !heartbeatParseable(row.last_heartbeat_at)
        ) {
          unparseableHeartbeats += 1;
          logger.warn("fleet.health.unparseable-heartbeat", {
            workerId,
            lastHeartbeatAt: row.last_heartbeat_at,
          });
        }
        // PID-SATURATION alarm. Evaluated BEFORE the online/stale branch on
        // purpose: the incident this exists for is a worker that is perfectly
        // ONLINE — heartbeating on time, passing every liveness check — while
        // its cgroup PID count climbs to the ceiling and every probe it claims
        // aborts on timeout. Putting the check after the `online` early-continue
        // would make it blind to the exact failure it targets.
        //
        // Detection only. The reclaim/restart machinery below stays reserved for
        // the stale/offline case: a saturating worker still holds live leases we
        // must not yank, and it may yet be reaped back below the line.
        const ratio = pidUsageRatio(
          row.capacity_pids_current,
          row.capacity_pids_max,
        );
        if (ratio !== null) {
          const wasLatched = pidSaturationLatched.has(workerId);
          if (ratio >= pidRatio && !wasLatched) {
            pidSaturationLatched.add(workerId);
            // Non-null by construction: `pidSaturationRatio` returns a number
            // only when both gauges are finite numbers in range.
            const report: PidSaturationReport = {
              workerId,
              pidsCurrent: Number(row.capacity_pids_current),
              pidsMax: Number(row.capacity_pids_max),
              ratio,
              threshold: pidRatio,
              lastHeartbeatAt: row.last_heartbeat_at,
              observedAt: new Date(nowMs).toISOString(),
            };
            pidSaturated.push(report);
            // `error`, not `warn`: warn/error route to stderr → Sentry (see the
            // PoolLogger note in browser-pool.ts), and PID saturation is the
            // fleet-starvation precursor, not routine noise.
            logger.error("fleet.health.worker-pid-saturated", {
              workerId,
              pidsCurrent: report.pidsCurrent,
              pidsMax: report.pidsMax,
              ratio: Number(ratio.toFixed(4)),
              threshold: pidRatio,
              health: deriveHealth(row.last_heartbeat_at, nowMs, staleAfterMs),
            });
            if (onPidSaturation) {
              try {
                await onPidSaturation(report);
              } catch (err) {
                // Best-effort, same discipline as restartWorker: a failed
                // operator ping must never abort the cycle (which would skip
                // every subsequent worker's reclamation).
                logger.warn("fleet.health.pid-saturation-hook-failed", {
                  workerId,
                  err: err instanceof Error ? err.message : String(err),
                });
              }
            }
          } else if (ratio < pidClearRatio && wasLatched) {
            // Recovered past the hysteresis gap — re-arm so the NEXT saturation
            // episode (e.g. after a reaper deploy regresses) alarms again.
            pidSaturationLatched.delete(workerId);
            logger.info("fleet.health.worker-pid-recovered", {
              workerId,
              pidsCurrent: row.capacity_pids_current,
              pidsMax: row.capacity_pids_max,
              ratio: Number(ratio.toFixed(4)),
              clearThreshold: pidClearRatio,
            });
          }
        }

        const health = deriveHealth(row.last_heartbeat_at, nowMs, staleAfterMs);
        if (health === "online") {
          online += 1;
          continue;
        }

        unhealthy += 1;
        logger.warn("fleet.health.worker-unhealthy", {
          workerId,
          health,
          lastHeartbeatAt: row.last_heartbeat_at,
          staleAfterMs,
        });

        const out = await reclaimWorkerJobs(workerId, nowMs);
        reclaimed += out.reclaimed;
        commErrors.push(...out.commErrors);
        reclaimedOverlays.push(...out.overlays);

        // RESTART (best-effort): recover the wedged worker. Default no-op
        // locally; staging injects the Railway serviceInstanceRedeploy hook.
        //
        // DEMOTED METRIC: only count a restart ATTEMPT when it means something —
        // i.e. a REAL restart hook is wired (staging Railway redeploy) OR this
        // worker actually had in-flight work we reclaimed. Under the default
        // no-op hook a ghost row that reclaimed zero jobs was previously counted
        // as a "restart attempt" every cycle, inflating restartsAttempted with a
        // number that described nothing. GC now prunes the long-dead rows; for
        // the remaining recently-stale rows, don't pretend a no-op did a restart.
        const restartIsMeaningful = hasRealRestartHook || out.reclaimed > 0;
        if (restartIsMeaningful) {
          restartsAttempted += 1;
          try {
            await restartWorker(workerId);
          } catch (err) {
            logger.warn("fleet.health.restart-failed", {
              workerId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          // Intentionally unwired: a recently-stale ghost row with nothing to
          // reclaim under the no-op hook. Log at debug, not info, so the metric
          // stops claiming a restart that never happened.
          logger.debug("fleet.health.restart-skipped", {
            workerId,
            msg: "no-op restart hook and nothing reclaimed — not counting a restart attempt",
          });
        }
      }

      if (
        unhealthy > 0 ||
        reclaimed > 0 ||
        gcDeleted > 0 ||
        unparseableHeartbeats > 0 ||
        pidSaturated.length > 0
      ) {
        logger.info("fleet.health.cycle", {
          online,
          unhealthy,
          reclaimed,
          restartsAttempted,
          gcDeleted,
          unparseableHeartbeats,
          // Rising-edge alarms this cycle; `pidLatched` is the standing count
          // (workers still above the clear ratio), which is what an operator
          // watching the fleet actually wants to see.
          pidSaturated: pidSaturated.length,
          pidLatched: pidSaturationLatched.size,
        });
      }

      return {
        online,
        unhealthy,
        reclaimed,
        commErrors,
        reclaimedOverlays,
        restartsAttempted,
        gcDeleted,
        pidSaturated,
      };
    },
  };
}
