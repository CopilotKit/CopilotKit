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
import { WORKERS_COLLECTION, isWorkerStale } from "../contracts.js";
import type { PoolCommError, WorkerHealthState } from "../contracts.js";

/**
 * Default staleness window: a worker whose `last_heartbeat_at` is older than
 * this is treated as stale/offline and its in-flight jobs are reclaimed. Sized
 * at ~2.4x the default ~75s heartbeat cadence (DEFAULT_WORKER_HEARTBEAT_MS) so a
 * single missed beat (e.g. a slow PB write) doesn't flap a healthy worker to
 * stale — it takes two-plus consecutive missed beats. Env-overridable by the
 * wiring slot via WORKER_STALE_AFTER_MS.
 */
export const DEFAULT_WORKER_STALE_AFTER_MS = 180_000;

/** Max worker rows scanned per monitor cycle — bounds the roster read cost. */
const WORKERS_PAGE = 100;

/** Max in-flight job rows reclaimed per worker per cycle — bounds the scan. */
const RECLAIM_PAGE = 100;

/**
 * The persisted `workers` row shape fleet-health reads. Snake-case columns as
 * the PB records API returns them (see the create_workers migration). Only the
 * fields fleet-health consumes are typed; the capacity gauges are ignored here.
 */
interface WorkerRecord {
  id: string;
  worker_id: string;
  last_heartbeat_at: string;
  current_job_id?: string;
}

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
}

export interface FleetHealthDeps {
  pb: PbClient;
  /** S0's atomic claim/release primitive — release-to-pending reclaims jobs. */
  claim: JobClaimClient;
  logger: Logger;
  /** Staleness window (ms). Default `DEFAULT_WORKER_STALE_AFTER_MS`. */
  staleAfterMs?: number;
  /** Injectable clock (tests). Returns ms-since-epoch. Defaults to Date.now. */
  now?: () => number;
  /**
   * Best-effort restart hook for a wedged worker (staging Railway redeploy).
   * Default no-op — local docker / the worker's own relaunch handles recovery.
   */
  restartWorker?: RestartWorkerHook;
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

/** Derive a worker's liveness from its heartbeat age. */
function deriveHealth(
  lastHeartbeatAt: string,
  nowMs: number,
  staleAfterMs: number,
): WorkerHealthState {
  // OFFLINE is a stronger stale: heartbeat older than 2x the window. We don't
  // act differently on stale vs offline (both reclaim), but the distinction is
  // surfaced in logs so an operator can tell a briefly-missed-beat worker from
  // a long-dead one.
  if (isWorkerStale(lastHeartbeatAt, nowMs, staleAfterMs * 2)) return "offline";
  if (isWorkerStale(lastHeartbeatAt, nowMs, staleAfterMs)) return "stale";
  return "online";
}

export function createFleetHealthMonitor(
  deps: FleetHealthDeps,
): FleetHealthMonitor {
  const { pb, claim, logger } = deps;
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_WORKER_STALE_AFTER_MS;
  const now = deps.now ?? Date.now;
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
        filter: `(status = "claimed" || status = "running") && claimed_by = "${workerId}"`,
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
        };
      }

      let online = 0;
      let unhealthy = 0;
      let reclaimed = 0;
      let restartsAttempted = 0;
      const commErrors: PoolCommError[] = [];
      const reclaimedOverlays: ReclaimedCommError[] = [];

      for (const row of page.items) {
        const workerId = row.worker_id;
        if (typeof workerId !== "string" || workerId.length === 0) {
          // A roster row without a usable worker_id can't be joined to claims —
          // skip it rather than reclaim against an empty owner.
          logger.warn("fleet.health.row-missing-worker-id", { rowId: row.id });
          continue;
        }
        // M4 N2: an unparseable last_heartbeat_at makes isWorkerStale return
        // false (treat-unknown-as-not-yet-stale) so a malformed row can't flap
        // the whole fleet to offline — but a PERSISTENTLY bad timestamp means
        // this worker silently never gets reclaimed. Warn so the orphaned row is
        // visible to an operator (the next valid heartbeat clears it).
        if (
          typeof row.last_heartbeat_at !== "string" ||
          Number.isNaN(Date.parse(row.last_heartbeat_at))
        ) {
          logger.warn("fleet.health.unparseable-heartbeat", {
            workerId,
            lastHeartbeatAt: row.last_heartbeat_at,
          });
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
        restartsAttempted += 1;
        try {
          await restartWorker(workerId);
        } catch (err) {
          logger.warn("fleet.health.restart-failed", {
            workerId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (unhealthy > 0 || reclaimed > 0) {
        logger.info("fleet.health.cycle", {
          online,
          unhealthy,
          reclaimed,
          restartsAttempted,
        });
      }

      return {
        online,
        unhealthy,
        reclaimed,
        commErrors,
        reclaimedOverlays,
        restartsAttempted,
      };
    },
  };
}
