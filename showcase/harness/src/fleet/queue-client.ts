/**
 * Fleet control-plane ↔ worker QUEUE client (BLITZ S3).
 *
 * This is the SEMANTIC queue layer the control-plane (S4) and worker loop (S7)
 * talk to. It implements the `FleetQueueClient` contract (S1) on top of two
 * lower primitives:
 *
 *   - S0's `JobClaimClient` (`job-claim.ts`) — the atomic, exactly-one-winner
 *     claim/renew/release CAS over the PocketBase JSVM transaction endpoints.
 *     The queue-client NEVER re-implements the CAS; it delegates every
 *     lifecycle transition to S0 so the proven atomicity invariant is the
 *     single source of truth.
 *   - the harness `PbClient` (`storage/pb-client.ts`) — the record-level
 *     create/list path used for the two things the CAS endpoints don't do:
 *     WRITING a new pending row (`enqueue`) and READING the queue to find
 *     candidates / expired leases (`claimNext`, `sweepExpired`).
 *
 * ── WHY enqueue/claimNext SPLIT ACROSS TWO CLIENTS ─────────────────────────
 * S0's `claimJob(jobId, ...)` claims a KNOWN row id — it is the CAS, not a
 * scheduler. So `claimNext` first LISTS pending rows via the PB client, then
 * races S0's `claimJob` against each candidate until one wins (or the list is
 * exhausted). Losing the CAS on a candidate is normal under contention — a
 * peer won it — so we simply fall through to the next candidate. The
 * exactly-one-winner guarantee is entirely S0's; this layer only picks the
 * order to attempt.
 *
 * ── WHY THE PAYLOAD LIVES ON THE ROW ───────────────────────────────────────
 * A job's WORK (`ServiceJobPayload`) is written by the control-plane at
 * enqueue time and read by the worker AFTER it wins the claim — across a
 * process boundary. So the payload is persisted in the `probe_jobs.payload`
 * JSON column (migration `1779989500_probe_jobs_add_payload.js`), not held in
 * memory. `claimNext`/`renewLease` re-hydrate the typed payload from the row
 * the PB client returns.
 *
 * ── WHY sweepExpired RE-QUEUES VIA S0 releaseJob(pending) ──────────────────
 * A worker that crashes mid-job leaves its lease to expire with no terminal
 * report. The sweeper (control-plane S4) finds those rows, re-queues each via
 * S0's `releaseJob(..., "pending")` ON BEHALF of the dead holder (the CAS
 * checks `claimed_by`, which is still the dead worker, so the release is
 * authorized and atomic), and synthesizes a `worker-crashed-mid-job`
 * `PoolCommError` (REQ-B) per reclaimed job so the dashboard renders
 * "couldn't reach the pool" distinctly from a probe red.
 */

import type { Logger } from "../types/index.js";
import type { PbClient } from "../storage/pb-client.js";
import type { JobClaimClient, JobView } from "./job-claim.js";
import { terminalJobStatus } from "./contracts.js";
import type {
  ClaimedJob,
  EnqueueJobInput,
  FleetQueueClient,
  JobLease,
  PoolCommError,
  ReportJobInput,
  ServiceJobMeta,
  ServiceJobPayload,
  SweepResult,
} from "./contracts.js";

/**
 * Canonical PocketBase collection name for the fleet pull-queue. Single source
 * of truth for the name so a rename can't go half-applied (mirrors
 * `PROBE_RUNS_COLLECTION` / `WORKERS_COLLECTION`). S0's `job-claim.ts` talks to
 * the collection only through the JSVM CAS endpoints (no records API), so this
 * is the first module to name it for record-level reads/writes.
 */
export const PROBE_JOBS_COLLECTION = "probe_jobs";

/** Max pending candidates `claimNext` scans per attempt — bounds the CAS race. */
const CLAIM_CANDIDATE_PAGE = 50;

/**
 * Bounded retries for the post-release result write in `report()`. The release
 * CAS already flipped the row terminal; if the SEPARATE result write fails the
 * result is lost. The control-plane result-consumer catches this case: the row
 * is terminal-but-resultless, so once it ages past the consumer's grace window
 * the consumer synthesizes a `worker-crashed-mid-job` comm error onto the
 * dashboard (REQ-B) before latching it — the sweepers never see a terminal row.
 * We still retry a few times here before surfacing a distinct "result lost"
 * error, so the loss is unmistakable in logs and the common transient blip is
 * absorbed without dropping the result.
 */
const RESULT_WRITE_MAX_ATTEMPTS = 3;

export interface FleetQueueClientConfig {
  /** Record-level PB access for enqueue (create) + queue reads (list). */
  pb: PbClient;
  /** S0's atomic claim/renew/release primitive. */
  claim: JobClaimClient;
  logger: Logger;
  /**
   * Injectable RNG in [0,1) used to RANDOMIZE the candidate-attempt order in
   * `claimNext` (defaults to `Math.random`). See the claim-fairness note in
   * `claimNext`: every worker lists the SAME deterministically-ordered pending
   * page, so attacking it head-first makes the whole fleet thunder on the same
   * head row each poll — the worker that re-polls fractionally first keeps
   * winning the head while the losers burn extra CAS round-trips walking the
   * list (slower → polls less → claims less), skewing the distribution ~4x onto
   * 2 hot workers. Shuffling each worker's attempt order spreads the herd across
   * the page so wins distribute evenly. Injected so the fairness test is
   * deterministic.
   */
  rng?: () => number;
}

/** The persisted `probe_jobs` row shape as the PB records API returns it. */
interface ProbeJobRecord extends JobView {
  /** The serialized per-service work (migration 1779989500 adds this column). */
  payload?: unknown;
}

/**
 * Decode a row's `payload` JSON into a typed `ServiceJobPayload`. The column is
 * a structured JSON object; PB returns it already-parsed. We do a minimal
 * structural check so a malformed/absent payload fails LOUD here (at the
 * enqueue→claim boundary) rather than surfacing as an `undefined` deref deep in
 * the worker.
 */
function decodePayload(jobId: string, raw: unknown): ServiceJobPayload {
  if (raw === null || typeof raw !== "object") {
    throw new Error(
      `queue-client: job ${jobId} has no decodable payload on its probe_jobs row`,
    );
  }
  const candidate = raw as Partial<ServiceJobPayload>;
  if (
    typeof candidate.probeKey !== "string" ||
    typeof candidate.serviceSlug !== "string" ||
    typeof candidate.driverKind !== "string" ||
    candidate.meta === undefined
  ) {
    throw new Error(
      `queue-client: job ${jobId} payload is missing required fields (probeKey/serviceSlug/driverKind/meta)`,
    );
  }
  // `meta` is typed `ServiceJobMeta`, but the JSON column is untrusted: a
  // non-object `meta` (string/number/array) satisfies the `!== undefined`
  // check above yet would deref to `undefined` deep in the worker (the
  // aggregator groups by `meta.runId`). Assert it is a non-null object with a
  // string `runId` and fail LOUD at this boundary.
  const meta = candidate.meta as Partial<ServiceJobMeta> | null;
  if (
    meta === null ||
    typeof meta !== "object" ||
    Array.isArray(meta) ||
    typeof meta.runId !== "string"
  ) {
    throw new Error(
      `queue-client: job ${jobId} payload.meta must be a non-null object with a string runId`,
    );
  }
  return candidate as ServiceJobPayload;
}

/** Build the `JobLease` a worker holds from a claimed row + its decoded payload. */
function leaseFromJob(job: JobView, payload: ServiceJobPayload): JobLease {
  return { job, payload, leaseExpiresAt: job.lease_expires_at };
}

/**
 * Best-effort placeholder payload for a SUCCESSFUL renew whose payload could
 * not be re-hydrated (neither the claim-time cache nor the convenience re-read
 * was available). The heartbeat never consumes the payload — it only needs the
 * lease to stay alive — so a CAS renew that won must still yield a lease rather
 * than a null that the heartbeat would misread as a lost lease. We seed the
 * join keys from the authoritative CAS row and leave the rest empty; a renew is
 * in practice always preceded by a same-process claim, so this path is rare.
 */
function emptyPayloadForLease(job: JobView): ServiceJobPayload {
  return {
    probeKey: job.probe_key,
    serviceSlug: "",
    driverKind: "",
    meta: { runId: "", triggered: false, enqueuedAt: "" },
  };
}

/**
 * Anchor the PB space→"T" date-separator rewrite to the canonical PB shape
 * (`YYYY-MM-DD ` then time) so we ONLY convert the date/time boundary, never an
 * arbitrary first space. MUST stay byte-for-byte identical to the JSVM hook's
 * `leaseExpired` (`fleet-claim.pb.js`): the hook anchors with
 * `/^(\d{4}-\d{2}-\d{2}) /` so the client-side reclamation decision and the
 * server-side CAS gate agree on whether a lease has expired. A bare
 * `String.replace(" ", "T")` rewrites the FIRST space ANYWHERE, which would
 * coerce a malformed/non-standard value into something that parses, defeating
 * the agreement (the client could treat a value live that the hook treats
 * expired, or vice versa). An odd shape must fall through to NaN → expired
 * (never wedge the queue), but only because the value genuinely failed to
 * parse, not because we mangled it into a parseable one.
 */
const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;

/**
 * Has `leaseExpiresAt` elapsed as of `nowMs`? A null/empty/unparseable lease is
 * treated as EXPIRED — mirrors the PB endpoint's `leaseExpired` (never let a
 * row wedge the queue forever on a malformed timestamp). The PB date form uses
 * a space separator; normalize ONLY the canonical date/time boundary to ISO "T"
 * before parsing — ANCHORED exactly as the JSVM hook does so both sides agree.
 *
 * Exported for direct unit testing of the anchored-parse contract (the
 * client↔hook agreement is load-bearing for the exactly-one-winner CAS).
 */
export function leaseExpired(
  leaseExpiresAt: string | null,
  nowMs: number,
): boolean {
  if (!leaseExpiresAt) return true;
  const t = Date.parse(String(leaseExpiresAt).replace(PB_DATE_SEP_RE, "$1T"));
  if (Number.isNaN(t)) return true;
  return t <= nowMs;
}

/**
 * In-place Fisher-Yates shuffle used to randomize the candidate-attempt order
 * so concurrent workers don't all attack the same head-of-page row each poll.
 * Pure given the injected `rng`; mutates + returns `arr` for call-site brevity.
 */
function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function createFleetQueueClient(
  config: FleetQueueClientConfig,
): FleetQueueClient {
  const { pb, claim, logger } = config;
  const rng = config.rng ?? Math.random;

  // Per-client cache of a claimed job's decoded payload, keyed by jobId. The
  // renew CAS returns the lifecycle columns but NOT the payload, and the
  // convenience re-read used to re-hydrate it can momentarily fail (a PB read
  // blip). Throwing on that blip permanently stops the worker's heartbeat,
  // after which the sweeper reclaims the still-live job and synthesizes a FALSE
  // `worker-crashed-mid-job` comm error. So we remember the payload at claim
  // time and reuse it on renew, making the re-read a non-fatal convenience.
  const payloadCache = new Map<string, ServiceJobPayload>();

  return {
    async enqueue(input: EnqueueJobInput): Promise<JobView> {
      const { payload } = input;
      // A fresh job is `pending` with no owner and no lease. `probe_key` is the
      // join key (== payload.probeKey, the d6 aggregate row key); the work
      // rides in the `payload` JSON column for the worker to read post-claim.
      const record = await pb.create<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        probe_key: payload.probeKey,
        status: "pending",
        claimed_by: "",
        lease_expires_at: null,
        version: 0,
        payload,
      });
      logger.debug("queue-client.enqueued", {
        jobId: record.id,
        probeKey: payload.probeKey,
        runId: payload.meta.runId,
      });
      return record;
    },

    async claimNext(
      workerId: string,
      leaseSeconds: number,
    ): Promise<ClaimedJob> {
      // List pending candidates, then race S0's atomic claim against each until
      // one wins. Losing a CAS means a peer took it — fall through, don't error.
      const page = await pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        filter: 'status = "pending"',
        perPage: CLAIM_CANDIDATE_PAGE,
        skipTotal: true,
      });
      // CLAIM FAIRNESS: every worker lists the SAME deterministically-ordered
      // pending page (PB's default order is stable across callers), so iterating
      // it head-first makes all 6 replicas thunder on the same head row every
      // poll. The worker that re-polls fractionally first keeps winning the head;
      // the losers burn extra CAS round-trips walking down the list, which makes
      // them slower, poll less often, and claim less — compounding into a ~4x
      // skew onto 2 hot workers (the observed staging contention that tipped legit
      // settles past the per-turn budget). RANDOMIZING each worker's attempt
      // order spreads the herd across the whole candidate page so a peer that
      // already won the head doesn't force everyone else to serialize behind it —
      // wins distribute evenly and no worker becomes a hot outlier. The CAS still
      // guarantees exactly-one-winner per row; this only changes which order a
      // given worker TRIES candidates, never the atomicity.
      const candidates = shuffleInPlace([...page.items], rng);
      for (const candidate of candidates) {
        const result = await claim.claimJob(
          candidate.id,
          workerId,
          leaseSeconds,
        );
        if (result.won && result.job) {
          // The CAS already WON — this worker now OWNS the row. Decoding the
          // payload from the (pre-claim) candidate row can still throw on a
          // malformed/absent payload; if we let that throw escape, the job is
          // claimed-but-orphaned: nobody reports it, the sweeper later reclaims
          // it and synthesizes a FALSE `worker-crashed-mid-job`, and the row is
          // re-listed → re-thrown forever (a poison row that wedges the queue).
          // So on a decode failure we RELEASE the won job as `failed` (we own
          // it, so the CAS authorizes) and fall through to the next candidate —
          // a decode throw must NEVER strand a job we just won.
          let payload: ServiceJobPayload;
          try {
            payload = decodePayload(candidate.id, candidate.payload);
          } catch (err) {
            logger.error("queue-client.claim-decode-failed", {
              jobId: result.job.id,
              workerId,
              err: err instanceof Error ? err.message : String(err),
            });
            // Best-effort terminal release so the poison row doesn't re-list
            // forever. A refused release here is non-fatal — another sweeper or
            // a later reclaim handles it; we must not throw out of claimNext.
            try {
              await claim.releaseJob(result.job.id, workerId, "failed");
            } catch (releaseErr) {
              logger.warn("queue-client.claim-decode-release-failed", {
                jobId: result.job.id,
                workerId,
                err:
                  releaseErr instanceof Error
                    ? releaseErr.message
                    : String(releaseErr),
              });
            }
            continue;
          }
          // Cache for the renew path so a later heartbeat doesn't depend on a
          // fresh PB re-read to re-hydrate the payload.
          payloadCache.set(result.job.id, payload);
          logger.debug("queue-client.claimed", {
            jobId: result.job.id,
            workerId,
          });
          return { claimed: true, lease: leaseFromJob(result.job, payload) };
        }
      }
      return { claimed: false };
    },

    async renewLease(
      jobId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<JobLease | null> {
      const result = await claim.renewLease(jobId, workerId, leaseSeconds);
      if (!result.renewed || !result.job) return null;
      // The renew CAS already returned the authoritative lifecycle columns. The
      // payload is the only thing it omits, so prefer the claim-time cache. A
      // momentary PB read blip must NEVER turn a SUCCESSFUL renew into a thrown
      // error: that would kill the worker's heartbeat and let the sweeper
      // reclaim a live job, synthesizing a false `worker-crashed-mid-job`. So
      // the re-read below is a non-fatal convenience used only on a cache miss.
      let payload = payloadCache.get(jobId);
      if (!payload) {
        try {
          const record = await pb.getOne<ProbeJobRecord>(
            PROBE_JOBS_COLLECTION,
            jobId,
          );
          if (record) {
            payload = decodePayload(jobId, record.payload);
            payloadCache.set(jobId, payload);
          }
        } catch (err) {
          // Read blip — log and fall through to the cache-miss handling below.
          logger.warn("queue-client.renew-reread-failed", {
            jobId,
            workerId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!payload) {
        // Renew succeeded (the CAS won) but we have no payload to re-hydrate
        // (no prior claim in this process AND the convenience re-read was
        // unavailable). A SUCCESSFUL CAS renew MUST keep the heartbeat alive:
        // returning null here makes the heartbeat interpret a healthy renew as
        // a LOST lease, stop heartbeating, and let the sweeper reclaim a LIVE
        // job → a FALSE `worker-crashed-mid-job`. The heartbeat does not
        // consume the payload, so return a lease with a best-effort EMPTY
        // payload synthesized from the authoritative CAS row. We ONLY return
        // null when the CAS itself failed (handled above).
        logger.warn("queue-client.renew-no-payload", { jobId, workerId });
        return leaseFromJob(result.job, emptyPayloadForLease(result.job));
      }
      return leaseFromJob(result.job, payload);
    },

    async report(input: ReportJobInput): Promise<void> {
      const status = terminalJobStatus(input.result);
      // The worker is DONE with this job either way (release refused or result
      // write exhausted), so always evict the cached payload before returning —
      // a leak here would slowly grow the per-client cache across reports.
      try {
        const result = await claim.releaseJob(
          input.jobId,
          input.workerId,
          status,
        );
        if (!result.released) {
          // The CAS refused the release — not the lease holder, or the row is
          // no longer running (likely already swept/reclaimed). The row is NOT
          // terminal-by-us and carries NO result, so nothing was lost: the
          // sweeper's reclaim path (REQ-B) covers the dashboard signal. Fail
          // loud, but flag it as "release failed (job not lost)".
          throw new Error(
            `queue-client: release failed (job not lost) for job ${input.jobId} (worker ${input.workerId}, status ${status}) — not the lease holder or row not running`,
          );
        }
        // PERSIST the per-service result onto the now-terminal row so the
        // control-plane's result-consumer (a DIFFERENT process) can aggregate
        // it (migration 1779989700 adds `result` + `result_processed`). The CAS
        // release above already flipped the row to done/failed and the worker
        // still owns it (the release authorized on claimed_by), so this is a
        // plain record write on a row this worker just terminated — it does NOT
        // touch the claim lifecycle columns the CAS owns. `result_processed`
        // seeds false: the consumer latches it true after aggregating exactly
        // once. This write happens AFTER the release so a row never carries a
        // result while still claimable.
        //
        // CRITICAL: the row is ALREADY terminal but the result is what the
        // consumer aggregates. If this write fails and we just gave up, the
        // result is SILENTLY DROPPED (terminal row, empty result → the consumer
        // latches it resultless past grace, the dashboard never updates). So
        // RETRY the write (bounded) before surfacing a DISTINCT "result lost"
        // error, so the failure mode is unmistakable in logs vs. a refused
        // release.
        let lastErr: unknown;
        for (let attempt = 1; attempt <= RESULT_WRITE_MAX_ATTEMPTS; attempt++) {
          try {
            await pb.update(PROBE_JOBS_COLLECTION, input.jobId, {
              result: input.result,
              result_processed: false,
            });
            logger.debug("queue-client.reported", {
              jobId: input.jobId,
              workerId: input.workerId,
              status,
            });
            return;
          } catch (err) {
            lastErr = err;
            logger.warn("queue-client.result-write-failed", {
              jobId: input.jobId,
              workerId: input.workerId,
              attempt,
              maxAttempts: RESULT_WRITE_MAX_ATTEMPTS,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        // Exhausted the retries: the release SUCCEEDED (row is terminal) but the
        // result write FAILED — the result is LOST. Surface this distinctly so
        // an operator can tell it apart from a refused release.
        logger.error("queue-client.result-write-lost", {
          jobId: input.jobId,
          workerId: input.workerId,
          status,
          err: lastErr instanceof Error ? lastErr.message : String(lastErr),
        });
        throw new Error(
          `queue-client: release succeeded but result write FAILED (result lost) for job ${input.jobId} (worker ${input.workerId}, status ${status}) after ${RESULT_WRITE_MAX_ATTEMPTS} attempts: ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`,
        );
      } finally {
        // Terminal for this worker no matter the outcome — drop the cached
        // payload here so neither a refused release nor an exhausted result
        // write leaks the entry.
        payloadCache.delete(input.jobId);
      }
    },

    async sweepExpired(nowMs: number): Promise<SweepResult> {
      // Scan claimed/running rows for expired leases (crashed/unreachable
      // workers). PB lacks an OR-of-equals shortcut here, so list both running
      // states and filter by lease in-process.
      const page = await pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        filter: 'status = "claimed" || status = "running"',
        perPage: CLAIM_CANDIDATE_PAGE,
        skipTotal: true,
      });
      const commErrors: PoolCommError[] = [];
      let reclaimed = 0;
      const observedAt = new Date(nowMs).toISOString();
      for (const row of page.items) {
        if (!leaseExpired(row.lease_expires_at, nowMs)) continue;
        // Re-queue on behalf of the dead holder: the CAS authorizes on
        // `claimed_by` (still the dead worker), so this atomically flips the
        // row back to pending and drops ownership.
        const released = await claim.releaseJob(
          row.id,
          row.claimed_by,
          "pending",
        );
        if (!released.released) {
          // Another sweeper or a late worker report won the race — not an
          // error, just nothing for us to reclaim on this row.
          logger.debug("queue-client.sweep-skip", {
            jobId: row.id,
            workerId: row.claimed_by,
          });
          continue;
        }
        reclaimed += 1;
        // The sweep boundary CANNOT distinguish a real worker crash from an
        // expected platform teardown (Railway scale-down / redeploy SIGKILL with
        // no graceful drain) — both leave an identical expired lease on a
        // claimed/running row. So we do NOT synthesize `worker-crashed-mid-job`
        // here (that would flap the whole service red on every routine
        // teardown). The job has been RE-QUEUED to pending by the releaseJob
        // above, so it is back in flight; emit the neutral
        // `worker-reclaimed-pending` kind, which the dashboard renders as a gray
        // "re-queued" surface, NOT a red unreachable overlay. A genuine pool
        // outage keeps re-surfacing this and the cell stays gray (no green) — the
        // honest signal. (A graceful worker shutdown drains the in-flight job to
        // a terminal report BEFORE the lease expires, so the sweep never sees it
        // at all — see the SIGTERM drain handler in orchestrator.bootFleet.)
        commErrors.push({
          kind: "worker-reclaimed-pending",
          message: `lease for job ${row.id} expired (worker ${row.claimed_by || "unknown"} reclaimed); re-queued to pending`,
          workerId: row.claimed_by || undefined,
          jobId: row.id,
          observedAt,
        });
        logger.warn("queue-client.sweep-reclaimed", {
          jobId: row.id,
          workerId: row.claimed_by,
        });
      }
      return { reclaimed, commErrors };
    },
  };
}
