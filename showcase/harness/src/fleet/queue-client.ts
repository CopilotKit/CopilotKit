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
 * A lease that expires with no terminal report could be a real worker crash
 * OR an expected platform teardown (Railway scale-down / redeploy SIGKILL) —
 * the sweep boundary cannot tell them apart. The sweeper (control-plane S4)
 * finds those rows, re-queues each via S0's `releaseJob(..., "pending")` ON
 * BEHALF of the lapsed holder (the CAS checks `claimed_by`, which is still
 * that worker, so the release is authorized and atomic), and synthesizes a
 * neutral `worker-reclaimed-pending` `PoolCommError` (REQ-B) per reclaimed
 * job — the dashboard renders it as a gray "re-queued" surface, NOT a red
 * crash/unreachable overlay (the job is back in flight).
 */

import type { Logger } from "../types/index.js";
import type { PbClient } from "../storage/pb-client.js";
import type {
  ClaimResult,
  JobClaimClient,
  JobView,
  ReleaseResult,
  RenewResult,
} from "./job-claim.js";
import {
  JobClaimEndpointError,
  RELEASE_REFUSED_TERMINAL_SAME_HOLDER,
} from "./job-claim.js";
import { probeKeyFamily, terminalJobStatus } from "./contracts.js";
import type {
  ClaimedJob,
  EnqueueJobInput,
  FleetQueueClient,
  JobLease,
  PoolCommError,
  PruneAgedResult,
  ReportJobInput,
  ServiceJobMeta,
  ServiceJobPayload,
  ServiceJobResult,
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

/**
 * Max pending candidates `claimNext` scans PER FAMILY per attempt — bounds the
 * CAS race. NOTE this is a per-family page, not one global page: a single
 * oldest-50 global page let a high-frequency family's backlog permanently
 * crowd a low-frequency family's jobs out of the candidate set (the e2e-demos
 * starvation — see the FAMILY FAIRNESS note in `claimNext`).
 */
const CLAIM_CANDIDATE_PAGE = 50;

/**
 * Cap on the family-discovery loop in `claimNext` (one tiny query per distinct
 * pending family). The fleet runs a handful of probe families (d4/d5/d6/
 * e2e-demos); 16 is generous headroom while still bounding the per-poll query
 * count if probe_key shapes ever proliferate unexpectedly.
 */
const MAX_PENDING_FAMILIES = 16;

/**
 * §4.2 retention windows for `pruneAged` (exported — the integration test and
 * the fleet-runs route tests reference them):
 *
 *   - TERMINAL (14 days): delete `done`/`failed` rows older than this,
 *     deliberately REGARDLESS of `result_processed` — the latch gates the
 *     aggregator's consume-once semantics, not retention. A poison result the
 *     aggregator can never process (`result_processed` stuck false) would
 *     otherwise pin its row forever; at 14 days — thousands of aggregation
 *     cycles past the batch — the consume-once question is moot.
 *   - ZOMBIE (48 hours): delete NON-terminal rows older than this. Nothing
 *     else ever reaps abandoned `pending`/`claimed`/`running` rows —
 *     `sweepExpired` scans only `claimed|running` (a `pending` row has no
 *     lease to expire) and the terminal leg touches only terminal rows. 48 h
 *     is far beyond the longest legitimate run AND the dashboard's
 *     stalled-classification window, so a stalled batch keeps its full
 *     diagnostic visibility window before its zombie rows are reaped.
 *
 * Both legs cut on `created` (stamped once, renewal-immune), never `updated`
 * (a wedged-but-renewing worker bumps `updated` on every lease renewal).
 */
export const PRUNE_TERMINAL_MAX_AGE_MS = 14 * 24 * 3600_000;
export const PRUNE_ZOMBIE_MAX_AGE_MS = 48 * 3600_000;

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
 *
 * Exported so the retry-bound test pins THIS constant rather than a magic
 * number that could drift from the implementation.
 */
export const RESULT_WRITE_MAX_ATTEMPTS = 3;

/**
 * Pause between consecutive result-write attempts. Back-to-back retries land
 * inside the same transient blip window (a PB restart/WAL hiccup spans more
 * than a tick), so the bounded retry was burning all its attempts in
 * microseconds. Exported so the pacing test pins this constant.
 */
export const RESULT_WRITE_RETRY_DELAY_MS = 250;

/**
 * Max times the reaper RE-CLAIMS an orphaned in-flight (claimed/running) row
 * whose lease has lapsed and whose created-age is past its family's stale
 * window. Below the cap, reclaim WINS over the long-expired carve-out (G1d):
 * the row is re-queued to pending and re-run rather than silently deleted, so
 * an abrupt worker bounce (SIGKILL past grace / OOM / crash) is non-LOSSY. At
 * or above the cap the row is treated as terminally expired (claim-deleted, no
 * re-run) so a poison job that crashes the worker every run cannot re-queue
 * forever.
 *
 * The counter is `consecutive_orphan_count` — the number of CONSECUTIVE
 * re-orphans of THIS job (i.e. sweeper re-queues that were never followed by
 * a terminal done/failed). It is bumped ONLY by the sweeper re-queue path
 * (fleet-claim release CAS with target "pending") and reset to 0 on every
 * terminal release (done|failed) or fresh claim. It is NOT bumped by the
 * peer-worker expired-lease steal (claim CAS `wasExpiredSteal` branch), so a
 * healthy long-lived job that accrues peer steals does NOT consume its reclaim
 * budget. The lifetime steal+requeue tally remains the separate `reclaim_count`
 * column (dashboard diagnostic).
 *
 * Exported so the cap test pins THIS constant rather than a magic number that
 * could drift from the implementation (mirrors RESULT_WRITE_MAX_ATTEMPTS).
 */
export const MAX_RECLAIM_ATTEMPTS = 3;

/**
 * Default multiple of a family's production period after which an unclaimed
 * pending job is STALE (its family has enqueued ~3 fresher batches since; the
 * job's eventual result would be ancient data). Tunable via
 * `StalePendingPolicy.expiryPeriods`.
 */
export const DEFAULT_STALE_PENDING_EXPIRY_PERIODS = 3;

/**
 * Default per-family production period used when `familyPeriodsMs` has no
 * entry for a family — one hour, the SLOWEST fleet producer cadence (d6 +
 * e2e-demos tick hourly), so an unconfigured family is never expired more
 * aggressively than the slowest known one.
 */
export const DEFAULT_STALE_PENDING_FAMILY_PERIOD_MS = 60 * 60 * 1000;

/**
 * Synthetic workerId the stale-pending sweep claims rows under before
 * deleting them. The claim CAS is what makes the delete race-free (a racing
 * worker either wins the row — and the sweeper backs off — or loses it and
 * never sees it again); the id makes the sweeper's ownership legible in the
 * CAS audit columns while it briefly holds the row.
 */
const STALE_PENDING_SWEEPER_ID = "stale-pending-sweeper";

/** Lease the sweeper takes on a stale row for the claim→delete window. If the
 * delete fails the lease simply expires and the NEXT lease sweep re-queues the
 * row to pending SILENTLY (no comm error — the lease phase special-cases
 * `claimed_by === STALE_PENDING_SWEEPER_ID`, since stale garbage mid-deletion
 * is not a crashed worker's job), where a later stale sweep retries it —
 * self-healing. */
const STALE_PENDING_SWEEPER_LEASE_SECONDS = 60;

/**
 * Max candidate pages the stale-pending drain processes in ONE sweep. A
 * single-page (50-row) sweep was far slower than the incident it exists for:
 * against the motivating 3,734-row staging backlog at ~10 sweeps/hour that is
 * ~7.5 HOURS of drain. 10 pages × CLAIM_CANDIDATE_PAGE (50) = up to 500
 * expirable rows per sweep drains the same backlog in well under an hour,
 * while still bounding a single sweep's PB load (≤10 list calls + ≤500
 * CAS-claim+delete pairs) so one sweep cannot monopolize a producer tick.
 * The overflow simply drains on the next sweep.
 */
const STALE_PENDING_MAX_PAGES_PER_SWEEP = 10;

/**
 * STALE-PENDING EXPIRY policy (`sweepExpired`). A pending job that sits
 * unclaimed for `expiryPeriods` × its family's production period is expired
 * (claimed via the S0 CAS under `STALE_PENDING_SWEEPER_ID`, then deleted) so
 * an accumulated backlog drains STRUCTURALLY instead of waiting on 2 serial
 * workers to chew through thousands of obsolete rows (staging hit 3,734
 * pending, oldest 22h). The producers re-enqueue fresh batches on their
 * normal cadence, so nothing is lost but stale work.
 */
export interface StalePendingPolicy {
  /**
   * Production period per family (ms) — how often that family's producer
   * ticks. The wiring slot derives this from the producer crons. Families
   * absent here use `defaultPeriodMs`.
   */
  familyPeriodsMs?: Record<string, number>;
  /** Fallback period for unlisted families. Default
   * `DEFAULT_STALE_PENDING_FAMILY_PERIOD_MS` (1h, the slowest cadence). */
  defaultPeriodMs?: number;
  /** Periods a pending job may age before expiry. <= 0 disables the stale
   * sweep entirely. Default `DEFAULT_STALE_PENDING_EXPIRY_PERIODS`. */
  expiryPeriods?: number;
}

/**
 * `SweepResult` plus the AT-LEAST-ONCE split (G1g): `reclaimed` counts only
 * CAS-CONFIRMED re-queues, while the conservative thrown-release maybes
 * (timeout-after-commit — the release may or may not have committed; a comm
 * error is synthesized either way) ride `reclaimedIndeterminate`. Summing the
 * two recovers the old over-counting behavior; consumers that alert on
 * reclaim counts should treat the indeterminate share as "at least zero, at
 * most this many" extra re-queues.
 *
 * The shared `SweepResult` contract carries the split as an OPTIONAL
 * `reclaimedIndeterminate` (this implementation narrows it to required), and
 * the producer threads it onto `TickResult` wherever it copies
 * `sweep.reclaimed`.
 */
export interface SweepResultWithIndeterminate extends SweepResult {
  /** Thrown-release conservative maybes (at-least-once; see above). */
  reclaimedIndeterminate: number;
}

/** `FleetQueueClient` with this implementation's richer sweep result. */
export interface FleetQueueClientWithSweepOutcome extends FleetQueueClient {
  sweepExpired(nowMs: number): Promise<SweepResultWithIndeterminate>;
}

/**
 * Thrown by `countPendingForFamily` when the backend hands back a non-count
 * `totalItems` despite `skipTotal:false` — a poisoned value (-1 or garbage)
 * is never above the producer's backlog threshold, so returning it would
 * silently FAIL the backlog gate OPEN. A DEDICATED EXPORTED CLASS (not just
 * message text) because the producer's gate discriminates this fail-closed
 * class from transient read blips (fail open): an `instanceof` check cannot
 * drift, whereas the old message-substring match would silently flip the
 * gate fail-closed → fail-open if this message was ever reworded.
 */
export class PoisonedBacklogCountError extends Error {
  constructor(family: string, totalItems: unknown) {
    super(
      `queue-client: countPendingForFamily("${family}") received a non-count totalItems (${String(
        totalItems,
      )}) despite skipTotal:false — refusing to fail the backlog gate open`,
    );
    this.name = "PoisonedBacklogCountError";
  }
}

export interface FleetQueueClientConfig {
  /** Record-level PB access for enqueue (create) + queue reads (list). */
  pb: PbClient;
  /** S0's atomic claim/renew/release primitive. */
  claim: JobClaimClient;
  logger: Logger;
  /** Stale-pending expiry policy for `sweepExpired`. Omitted → defaults
   * (3 × 1h for every family). See `StalePendingPolicy`. */
  stalePending?: StalePendingPolicy;
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
  /**
   * Injectable clock (epoch ms) for SYNTHETIC timestamps minted by this
   * client (the decode-failure protocol-violation result's
   * observedAt/finishedAt). Defaults to `Date.now`. `sweepExpired` keeps its
   * explicit `nowMs` parameter — the sweep's caller owns that clock.
   */
  now?: () => number;
  /**
   * Injectable async pause used between result-write retry attempts
   * (defaults to a real `setTimeout`). Injected so retry-pacing tests are
   * instant and exact.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** The persisted `probe_jobs` row shape as the PB records API returns it. */
interface ProbeJobRecord extends JobView {
  /** The serialized per-service work (migration 1779989500 adds this column). */
  payload?: unknown;
  /** PB system timestamp (space-separated date form) — the stale-pending
   * sweep's age anchor when the row has NEVER been reclaimed (no
   * `requeued_at`). A re-queue does NOT touch `created`, so a reclaimed row's
   * age is anchored on `requeued_at` instead (see `staleAgeAnchorMs`). */
  created?: string;
  /** Result-flow columns (migration 1779989700) — read by report()'s
   * retry-idempotency guard before any rewrite. */
  result?: unknown;
  result_processed?: boolean;
  /** Durable per-job lifetime reclaim tally (migration 1779990200) — bumped by
   * the fleet-claim CAS on every expired-lease steal AND every sweeper re-queue.
   * Dashboard diagnostic: `reclaim_count > 0` → `jobs.reclaimed`. Never reset. */
  reclaim_count?: number;
  /** CONSECUTIVE re-orphan counter (migration 1779990400) — bumped ONLY by the
   * sweeper re-queue path (fleet-claim release CAS, target "pending"); reset to
   * 0 on every terminal release (done|failed). NOT bumped by the claim CAS's
   * expired-lease steal, so a healthy long-lived job that accrues peer steals
   * does NOT exhaust the MAX_RECLAIM_ATTEMPTS budget. This is what the reaper
   * uses for the cap check. */
  consecutive_orphan_count?: number;
  /** Re-anchor timestamp (migration 1779990300) — stamped by the fleet-claim
   * release CAS on every pending re-queue. Re-anchors the stale-age clock so a
   * just-reclaimed row is NOT immediately claim-deleted off its (renewal-immune)
   * `created` age, dissolving the long-expired carve-out's honesty bind. */
  requeued_at?: string;
}

/**
 * Structurally validate an (untrusted) value as a `ServiceJobPayload`,
 * failing LOUD with `label` naming the boundary. Shared by BOTH ends of the
 * row round-trip so the encode and decode checks can never drift apart:
 * `enqueue` runs it BEFORE `pb.create` (a malformed caller payload must not
 * persist a poison row), and `decodePayload` runs it on the claimed row's
 * JSON column.
 */
function assertServiceJobPayload(
  label: string,
  raw: unknown,
): ServiceJobPayload {
  // An ARRAY is `typeof "object"` and (as an in-process caller value) can
  // carry expando fields that satisfy every per-field check below — the same
  // hole the nested meta check's Array.isArray guard closes one level down.
  // A top-level array is never a valid payload; reject it here.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`queue-client: ${label} has no decodable payload`);
  }
  const candidate = raw as Partial<ServiceJobPayload>;
  // NON-EMPTY required (G1c): the empty string satisfies a bare typeof
  // check but is exactly the forbidden sentinel `emptyPayloadForLease`
  // documents — an empty runId silently groups into nothing in the
  // aggregator, an empty serviceSlug corrupts the per-service rollup, and an
  // empty probeKey yields the empty FAMILY whose prefix-LIKE clauses match
  // every leading-colon key (see `familyClauseSafe`). Fail loud at BOTH
  // boundaries (enqueue + claim decode) so the sentinels never persist or
  // reach the worker.
  if (
    typeof candidate.probeKey !== "string" ||
    candidate.probeKey === "" ||
    typeof candidate.serviceSlug !== "string" ||
    candidate.serviceSlug === "" ||
    typeof candidate.driverKind !== "string" ||
    candidate.driverKind === "" ||
    candidate.meta === undefined
  ) {
    throw new Error(
      `queue-client: ${label} payload is missing required fields (probeKey/serviceSlug/driverKind/meta must be present and non-empty)`,
    );
  }
  // `meta` is typed `ServiceJobMeta`, but the JSON column is untrusted: a
  // non-object `meta` (string/number/array) satisfies the `!== undefined`
  // check above yet would deref to `undefined` deep in the worker (the
  // aggregator groups by `meta.runId`). Assert the FULL required meta shape —
  // `triggered`/`enqueuedAt` are consumed downstream just like `runId`, so a
  // half-validated meta would only defer the failure past this boundary.
  // `enqueuedAt` must be NON-EMPTY like the other strings: the empty string
  // is exactly `emptyPayloadForLease`'s never-aggregate sentinel — minted
  // ONLY for heartbeat-only renew fallbacks that never cross this boundary —
  // so a caller-supplied "" is the same forbidden class as an empty runId.
  const meta = candidate.meta as Partial<ServiceJobMeta> | null;
  if (
    meta === null ||
    typeof meta !== "object" ||
    Array.isArray(meta) ||
    typeof meta.runId !== "string" ||
    meta.runId === "" ||
    typeof meta.triggered !== "boolean" ||
    typeof meta.enqueuedAt !== "string" ||
    meta.enqueuedAt === ""
  ) {
    throw new Error(
      `queue-client: ${label} payload.meta must be a non-null object with a non-empty string runId, boolean triggered and non-empty string enqueuedAt`,
    );
  }
  // Optional fields still have REQUIRED shapes when present: priority is a
  // number (copied verbatim onto the row; a future claimNext priority
  // consumer would read it as one), cellIds is a string array (the worker
  // iterates it as feature ids) and driverInputs is a plain record (the
  // worker reads keys off it).
  if (meta.priority !== undefined && typeof meta.priority !== "number") {
    throw new Error(
      `queue-client: ${label} payload.meta.priority must be a number when present`,
    );
  }
  if (
    candidate.cellIds !== undefined &&
    (!Array.isArray(candidate.cellIds) ||
      candidate.cellIds.some((c) => typeof c !== "string"))
  ) {
    throw new Error(
      `queue-client: ${label} payload.cellIds must be an array of strings when present`,
    );
  }
  if (
    candidate.driverInputs !== undefined &&
    (candidate.driverInputs === null ||
      typeof candidate.driverInputs !== "object" ||
      Array.isArray(candidate.driverInputs))
  ) {
    throw new Error(
      `queue-client: ${label} payload.driverInputs must be a plain object when present`,
    );
  }
  return candidate as ServiceJobPayload;
}

/**
 * Decode a row's `payload` JSON into a typed `ServiceJobPayload`. The column is
 * a structured JSON object; PB returns it already-parsed. The structural check
 * (shared with `enqueue` — see `assertServiceJobPayload`) makes a
 * malformed/absent payload fail LOUD here (at the enqueue→claim boundary)
 * rather than surfacing as an `undefined` deref deep in the worker.
 */
function decodePayload(jobId: string, raw: unknown): ServiceJobPayload {
  return assertServiceJobPayload(`job ${jobId}`, raw);
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
 *
 * WARNING — HEARTBEAT-ONLY VALUE. This placeholder must NEVER feed
 * aggregation or be persisted as (part of) a result: `serviceSlug` and
 * `meta.runId` are empty sentinels, and an empty runId would silently group
 * into nothing in the aggregator (which groups by `meta.runId`) while an
 * empty serviceSlug would corrupt the per-service rollup. The contract is:
 * a payload obtained from a RENEW exists only to keep the lease object
 * shape intact for the heartbeat; reporting always uses the payload the
 * worker received from its CLAIM. (A readonly marker field would need a
 * contracts.ts change; this comment is the boundary documentation.)
 * The one path that DOES persist a result without a decodable payload — the
 * decode-failure worker-protocol-violation synthesis in `claimNext` — honors
 * this contract by recovering `serviceSlug` from the probe_key's slug
 * segment (`probeKeySlug`) and minting a non-colliding synthetic runId
 * instead of writing these empty sentinels.
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
 * The slug segment of a probe key — the complement of
 * `probeKeyFamily` (contracts.ts): `d6:langgraph-python` →
 * `langgraph-python`. Mirrors that helper's `idx <= 0` rule: a colon-less
 * (or leading-colon) key has no family prefix, so the whole key doubles as
 * the slug. Used to recover a non-empty `serviceSlug` for the synthetic
 * worker-protocol-violation result when the payload itself is undecodable.
 */
function probeKeySlug(probeKey: string): string {
  const idx = probeKey.indexOf(":");
  const slug = idx <= 0 ? probeKey : probeKey.slice(idx + 1);
  // A trailing-colon key ("d6:") slices to "" — the exact forbidden empty
  // sentinel this helper exists to avoid (an empty serviceSlug corrupts the
  // per-service rollup). Fall back to the WHOLE key; a fully-empty probe_key
  // is the caller's problem (the synthesis call site substitutes a
  // jobId-derived placeholder).
  return slug === "" ? probeKey : slug;
}

/**
 * TRUE for a thrown endpoint error in the DETERMINISTIC rejection class: the
 * hook (or PB auth) rejected the request BEFORE any transaction ran, and the
 * same request will be rejected identically on every retry — the renew and
 * sweep carve-outs key on this to escape their conservative containments.
 * 408 (timeout) and 429 (rate limit) are 4xx by STATUS but TRANSIENT by
 * meaning — a retry can succeed — so they stay on the callers'
 * indeterminate/conservative paths (evicting a lease or skipping a comm
 * error on a momentary rate-limit blip would manufacture the exact false
 * signals the containments exist to prevent). 401 IS deterministic here:
 * job-claim's postFleet already re-auths once on a 401 before throwing, so
 * a 401 that reaches this predicate means fresh credentials were rejected.
 */
function deterministicEndpointRejection(
  err: unknown,
): err is JobClaimEndpointError {
  return (
    err instanceof JobClaimEndpointError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

/**
 * Build the synthetic `worker-protocol-violation` result the claim race
 * persists when a row must be released terminal WITHOUT a decodable payload
 * (a claim-time decode failure, or a won-without-job endpoint breach). A
 * terminal resultless row past the consumer's grace window is synthesized as
 * a RED `worker-crashed-mid-job` — a protocol breach is NOT a crash, so this
 * result carries the honest taxonomy kind instead. Honors
 * `emptyPayloadForLease`'s no-empty-sentinel contract: `serviceSlug` is
 * recovered from the row's probe_key slug segment (jobId-derived placeholder
 * when even that is empty) and `runId` is minted from the jobId
 * (non-colliding), while the aggregate key falls back to the row's probe_key
 * (the `d6:<slug>` aggregate row key) — mirroring the worker's comm-error
 * result builder.
 */
function protocolViolationResult(args: {
  jobId: string;
  probeKey: string;
  workerId: string;
  message: string;
  observedAt: string;
}): ServiceJobResult {
  return {
    jobId: args.jobId,
    probeKey: args.probeKey,
    serviceSlug: probeKeySlug(args.probeKey) || `unknown-${args.jobId}`,
    runId: `pviol_${args.jobId}`,
    workerId: args.workerId,
    aggregateState: "error",
    // Same defense-in-depth as the serviceSlug fallback: an EMPTY probe_key
    // cannot reach this builder through claimNext today (the G1c charset
    // guard skips empty-family rows at discovery), but an empty aggregate
    // key would write a row keyed "" downstream — fall back to the
    // jobId-derived placeholder instead of an empty sentinel.
    aggregateKey: args.probeKey || `unknown-${args.jobId}`,
    aggregateSignal: { error: args.message },
    cells: [],
    rollup: { total: 0, passed: 0, failed: 0 },
    finishedAt: args.observedAt,
    commError: {
      kind: "worker-protocol-violation",
      message: args.message,
      workerId: args.workerId,
      jobId: args.jobId,
      observedAt: args.observedAt,
    },
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
 *
 * Exported (like `leaseExpired`) for direct unit testing: the anchoring
 * contract is pinned at the STRING level so the test does not depend on
 * engine-specific `Date.parse` leniency (V8 parses some non-canonical shapes
 * that goja — the PB JSVM — rejects; see the leaseExpired test suite).
 */
export const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;

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
 * Parse a PB date column (space-separated form) to epoch ms, anchored exactly
 * like `leaseExpired` so the stale-age math agrees with the lease math. Returns
 * NaN for a null/empty/unparseable value — the caller decides what NaN means
 * (the stale-pending drain SKIPS such a row; the lease-phase carve-out treats
 * an unparseable `created` as a no-carve-out conservative re-queue).
 */
function pbDateMs(value: string | null | undefined): number {
  return Date.parse(String(value ?? "").replace(PB_DATE_SEP_RE, "$1T"));
}

/**
 * The stale-age anchor for a probe-jobs row, in epoch ms. A re-queue does NOT
 * touch PB's renewal-immune `created`, so a reclaimed row carries a
 * `requeued_at` stamped by the release CAS — age it off THAT (its effective
 * "back in flight" time) so the next sweep does not measure a just-reclaimed
 * row against its ORIGINAL enqueue time and immediately claim-delete it. This
 * re-anchoring is what dissolves the long-expired carve-out's honesty bind:
 * the row is genuinely young again, so re-queueing it emits a "back in flight"
 * signal the next sweep does NOT falsify. Falls back to `created` for a row
 * that has never been reclaimed (absent `requeued_at`), preserving pre-migration
 * row parity. Returns NaN only when BOTH anchors are unparseable.
 */
function staleAgeAnchorMs(row: {
  created?: string;
  requeued_at?: string;
}): number {
  const requeuedMs = pbDateMs(row.requeued_at);
  if (!Number.isNaN(requeuedMs)) return requeuedMs;
  return pbDateMs(row.created);
}

/**
 * CHARSET GUARD for family values destined for filter clauses. The two
 * escape helpers below carry CONTRADICTORY backslash contracts: the quoted
 * equality legs double `\` (PB quoted-literal escaping), while the LIKE
 * legs' verified behavior has fexpr passing non-quote backslashes through
 * VERBATIM — both cannot hold for one input, and only the `%`/`_` handling
 * has actually been verified against PB source. Probe keys are slugs in
 * practice, so rather than ship an unverifiable dual contract, callers SKIP
 * families containing a backslash (with a warn), and the count gate refuses
 * them.
 *
 * The EMPTY family ("" — from `probeKeyFamily("")`, i.e. an empty
 * probe_key) is ALSO clause-unsafe (G1c): it takes the prefix-LIKE leg of
 * the builders, so `familyInclusionClause("")` is `(probe_key ~ ":%" ||
 * probe_key = "")` — matching EVERY leading-colon key (cross-family
 * over-claim/over-count) — and `familyExclusionClause("")` symmetrically
 * hides ALL leading-colon families from discovery. `assertServiceJobPayload`
 * forbids an empty probeKey at both row boundaries, so this only fires on
 * garbage rows written outside the queue client.
 */
function familyClauseSafe(family: string): boolean {
  return family !== "" && !family.includes("\\");
}

/**
 * Escape a value for embedding in a double-quoted PB filter literal:
 * neutralizes the quote/backslash chars that could break out of the literal.
 * Sufficient on its own ONLY for the equality (`=`/`!=`) legs — the LIKE
 * (`~`/`!~`) legs must ALSO escape SQL wildcards via `escapeLikeLiteral`.
 * The backslash doubling is the quoted-literal contract; backslash-bearing
 * families never reach this function (see `familyClauseSafe`).
 */
function escapeFilterLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Escape a value for a `~`/`!~` LIKE leg. VERIFIED against PocketBase
 * 0.22.21 (tools/search/filter.go) FOR `%`/`_` ONLY: `~` builds SQL
 * `LIKE ... ESCAPE '\'`, and its auto-`%`-wrap is skipped when the operand
 * contains an unescaped `%` (ours always does — the trailing `:%`
 * wildcard), so a backslash-escaped `%`/`_` reaches SQLite as a LITERAL
 * character. The BACKSLASH leg is deliberately NOT part of that
 * verification (fexpr's quoted-literal and LIKE handling of `\` differ);
 * backslash-bearing inputs are excluded upstream by `familyClauseSafe`.
 *
 * Without this, a family containing `%`/`_` over-matches in BOTH directions:
 * family `d%`'s discovery EXCLUSION leg `probe_key !~ "d%:%"` also excludes
 * `d6:`/`d4:` keys, hiding those families from the rotation while `d%` rows
 * exist (starvation), and the inclusion/count legs over-claim/over-count
 * symmetrically.
 */
function escapeLikeLiteral(value: string): string {
  return escapeFilterLiteral(value).replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * PB filter clause matching every probe_key in `family`. Keys are
 * `<family>:<slug>` (the `~` LIKE leg, family wildcard-escaped); a colon-less
 * probe_key IS its own family (the `=` leg) so such rows are still claimable
 * under fairness.
 *
 * WHOLE-KEY FAMILIES MATCH BY EQUALITY ONLY (see the invariant pinned on
 * `probeKeyFamily`): a leading-colon probe_key is its own family — the WHOLE
 * key — so the family value itself contains colons, and the `<family>:%`
 * LIKE leg would wrongly fold the DIFFERENT family `":foo:bar"` under
 * `":foo"`. Such families get the equality leg only. Normal prefix families
 * cannot contain a colon by construction, so testing for a colon is exact.
 *
 * KNOWN DIVERGENCE (documented, not fixed): SQLite `LIKE` is
 * case-INSENSITIVE for ASCII while `=` is case-SENSITIVE, so for a
 * MIXED-CASE family the two legs disagree — `probe_key ~ "D6:%"` would also
 * match `d6:foo` rows while `probe_key = "D6"` would not match `d6` (and the
 * exclusion clause diverges symmetrically). Unreachable in practice: probe
 * keys are lowercase slugs by construction (the producers mint them from
 * service slugs), so no mixed-case family ever reaches these builders.
 */
function familyInclusionClause(family: string): string {
  if (family.includes(":")) {
    return `probe_key = "${escapeFilterLiteral(family)}"`;
  }
  return `(probe_key ~ "${escapeLikeLiteral(family)}:%" || probe_key = "${escapeFilterLiteral(family)}")`;
}

/**
 * PB filter clause EXCLUDING every probe_key in `family` — the complement of
 * `familyInclusionClause`, spelled with `!~`/`!=` because the PB filter
 * grammar has no group negation. Same whole-key (colon-bearing) family
 * special case: equality-only, or the `!~ "<family>:%"` leg would hide the
 * unrelated family `":foo:bar"` from discovery while `":foo"` rows exist.
 */
function familyExclusionClause(family: string): string {
  if (family.includes(":")) {
    return `probe_key != "${escapeFilterLiteral(family)}"`;
  }
  return `probe_key !~ "${escapeLikeLiteral(family)}:%" && probe_key != "${escapeFilterLiteral(family)}"`;
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
): FleetQueueClientWithSweepOutcome {
  const { pb, claim, logger } = config;
  const rng = config.rng ?? Math.random;
  const now = config.now ?? Date.now;
  const sleep =
    config.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const stalePolicy = config.stalePending ?? {};
  const staleExpiryPeriods =
    stalePolicy.expiryPeriods ?? DEFAULT_STALE_PENDING_EXPIRY_PERIODS;
  const staleDefaultPeriodMs =
    stalePolicy.defaultPeriodMs ?? DEFAULT_STALE_PENDING_FAMILY_PERIOD_MS;
  const stalePeriodMsFor = (family: string): number =>
    stalePolicy.familyPeriodsMs?.[family] ?? staleDefaultPeriodMs;

  // Per-client cache of a claimed job's decoded payload, keyed by jobId. The
  // renew CAS returns the lifecycle columns but NOT the payload, and the
  // convenience re-read used to re-hydrate it can momentarily fail (a PB read
  // blip). Throwing on that blip permanently stops the worker's heartbeat,
  // after which the sweeper reclaims the still-live job and synthesizes a FALSE
  // `worker-crashed-mid-job` comm error. So we remember the payload at claim
  // time and reuse it on renew, making the re-read a non-fatal convenience.
  const payloadCache = new Map<string, ServiceJobPayload>();

  // Last-known GOOD lease per held job, set at claim time and refreshed on
  // every successful renew. This is what an INDETERMINATE renew (a thrown
  // claim.renewLease — 5xx or 2xx-unreadable; the renew may or may not have
  // committed) hands back to the heartbeat: the worker heartbeat treats a
  // renewLease THROW like a lost lease (it breaks), so letting the throw
  // escape kills the heartbeat → the sweeper reclaims a LIVE job → a FALSE
  // worker-crashed-mid-job. Returning the current lease unchanged keeps the
  // heartbeat alive so the NEXT beat retries; only a definitive
  // `renewed: false` stops it. Evicted exactly where payloadCache is.
  const leaseCache = new Map<string, JobLease>();

  // CONCURRENT-SWEEP LATCH (see sweepExpired): the in-flight sweep's
  // promise, or null when none is running. A sweep arriving while one is in
  // flight piggybacks on this promise instead of racing the in-flight
  // sweep's per-call grace set.
  let sweepInFlight: Promise<SweepResultWithIndeterminate> | null = null;

  /**
   * Bounded-retry persistence of a per-service result onto an ALREADY
   * TERMINAL probe_jobs row — the SEPARATE record write that follows a
   * release CAS (migration 1779989700 adds `result` + `result_processed`).
   * Never throws: returns `{ ok: true }` on success, or `{ ok: false,
   * lastErr }` after RESULT_WRITE_MAX_ATTEMPTS attempts so the caller
   * decides what the loss means (`report` — distinct "result lost" error).
   * Used by `report()` ONLY: the decode-failure attribution in `claimNext`
   * is a deliberate single-attempt write (its retry pacing would stall the
   * claim race, and the consumer's crash synthesis is its backstop).
   * `result_processed` seeds false: the consumer latches it true after
   * aggregating exactly once.
   */
  async function writeResult(
    jobId: string,
    workerId: string,
    result: ServiceJobResult,
  ): Promise<{ ok: boolean; lastErr?: unknown }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= RESULT_WRITE_MAX_ATTEMPTS; attempt++) {
      // READ-BEFORE-RETRY (intra-call double-count guard, mirroring the
      // cross-call guard in report()'s refused_terminal_same_holder path):
      // a COMMITTED-THEN-THROWN attempt N leaves the result on the row, and
      // the consumer can aggregate + LATCH result_processed: true inside
      // the retry pause window. A blind attempt N+1 rewrite re-seeds
      // result_processed: false — un-latching an already-aggregated result,
      // which the consumer then counts TWICE. So every RETRY (never the
      // first attempt) reads the row first:
      //   - result present → the earlier attempt committed; skip the write.
      //   - no result      → the earlier attempt truly failed; write.
      //   - read failed / no row → REFUSE the blind rewrite (the un-latch
      //     risk stands); the attempt is spent and a later retry re-reads.
      if (attempt > 1) {
        let existing: ProbeJobRecord | null = null;
        let readFailed = false;
        try {
          existing = await pb.getOne<ProbeJobRecord>(
            PROBE_JOBS_COLLECTION,
            jobId,
          );
        } catch (readErr) {
          readFailed = true;
          lastErr = readErr;
          logger.warn("queue-client.result-write-retry-read-failed", {
            jobId,
            workerId,
            attempt,
            err: readErr instanceof Error ? readErr.message : String(readErr),
          });
        }
        if (!readFailed && existing === null) {
          // Semantically a failed read (missing/unreadable row), not "no
          // result present" — same refusal as the cross-call guard.
          readFailed = true;
          lastErr = new Error(
            `queue-client: pre-retry read for job ${jobId} returned no row — refusing to blind-write`,
          );
        }
        if (readFailed) {
          if (attempt < RESULT_WRITE_MAX_ATTEMPTS) {
            await sleep(RESULT_WRITE_RETRY_DELAY_MS);
          }
          continue;
        }
        // PB's unset-JSON shape reads back as "" — treat it as ABSENT (the
        // same triage as the cross-call guard) so a genuinely-failed first
        // attempt still lands its result.
        if (
          existing !== null &&
          existing.result !== undefined &&
          existing.result !== null &&
          existing.result !== ""
        ) {
          logger.info("queue-client.result-write-already-landed", {
            jobId,
            workerId,
            attempt,
          });
          return { ok: true };
        }
      }
      try {
        await pb.update(PROBE_JOBS_COLLECTION, jobId, {
          result,
          result_processed: false,
        });
        return { ok: true };
      } catch (err) {
        lastErr = err;
        logger.warn("queue-client.result-write-failed", {
          jobId,
          workerId,
          attempt,
          maxAttempts: RESULT_WRITE_MAX_ATTEMPTS,
          err: err instanceof Error ? err.message : String(err),
        });
        // Pace the retries: back-to-back attempts land inside the same
        // transient blip window. Never sleep after the LAST attempt.
        if (attempt < RESULT_WRITE_MAX_ATTEMPTS) {
          await sleep(RESULT_WRITE_RETRY_DELAY_MS);
        }
      }
    }
    return { ok: false, lastErr };
  }

  // FAMILY FAIRNESS rotation cursor: the family this client most recently
  // claimed from. The next claimNext starts its family rotation AFTER this
  // one, so consecutive claims round-robin across the distinct families
  // present in pending instead of draining the oldest family first.
  let lastClaimedFamily: string | null = null;

  /**
   * Discover the DISTINCT families present in pending, oldest job first. PB's
   * records API has no DISTINCT, so this peels one family per tiny query: read
   * the single oldest pending row, note its family, and re-query with that
   * family excluded until the queue is exhausted (or the MAX_PENDING_FAMILIES
   * bound trips). At most F+1 perPage=1 queries for F families — cheap against
   * the status-indexed probe_jobs table, and the price of never letting one
   * family's backlog hide another family from the candidate scan.
   */
  async function discoverPendingFamilies(): Promise<string[]> {
    const families: string[] = [];
    const exclusions: string[] = [];
    // One iteration PAST the bound: iteration MAX_PENDING_FAMILIES never adds
    // a family — it only probes whether MORE families exist beyond the cap,
    // so tripping the bound is observable instead of silent.
    for (let i = 0; i <= MAX_PENDING_FAMILIES; i++) {
      const filter = ['status = "pending"', ...exclusions].join(" && ");
      const page = await pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        filter,
        sort: "created",
        perPage: 1,
        skipTotal: true,
      });
      const head = page.items[0];
      if (!head) break;
      if (i === MAX_PENDING_FAMILIES) {
        // The bound tripped with at least one family still hidden. A
        // silently-undiscovered family never enters the rotation — exactly
        // the starvation class fairness exists to prevent — so mirror the
        // sweep's truncation warn. The hidden family is still claimable on
        // later polls once the families ahead of it drain out of pending.
        // The head at the bound can itself be clause-unsafe garbage (it
        // would never have been DISCOVERED, only excluded by row id) —
        // thread its clause-safety so the warn doesn't overclaim a hidden
        // CLAIMABLE family for unclaimable junk.
        logger.warn("queue-client.family-discovery-truncated", {
          maxFamilies: MAX_PENDING_FAMILIES,
          nextProbeKey: head.probe_key,
          nextFamilyClauseSafe: familyClauseSafe(
            probeKeyFamily(head.probe_key),
          ),
        });
        break;
      }
      const family = probeKeyFamily(head.probe_key);
      // Defensive: a backend that didn't honor the exclusion clause would
      // re-yield a seen family forever — break instead of spinning. Warn
      // first: a silent break hides BOTH the backend defect and every
      // family the truncated discovery never reached.
      if (families.includes(family)) {
        logger.warn("queue-client.family-discovery-duplicate", {
          family,
          probeKey: head.probe_key,
        });
        break;
      }
      // CHARSET GUARD: a clause-unsafe family (backslash, or the empty
      // family) cannot be embedded in a filter with verified semantics (see
      // familyClauseSafe), so its rows are skipped from claiming entirely
      // (probe keys are slugs, so this is garbage input). Discovery used to
      // BREAK here — starving every YOUNGER family behind the offending row
      // for up to its FAMILY-CONFIGURED stale window (expiryPeriods × the
      // family's production period; the wiring slot derives the periods
      // from FLEET_FAMILY_PERIODS_MS in orchestrator.ts — there is no fixed
      // 3h window). No FAMILY exclusion clause is needed
      // to see past it: exclude the offending ROW by id (PB system ids are
      // generated alphanumerics — no charset semantics in play) and
      // CONTINUE. Each unsafe row burns one discovery iteration, so a page
      // of them is still bounded by MAX_PENDING_FAMILIES (+ its warn).
      if (!familyClauseSafe(family)) {
        logger.warn("queue-client.family-clause-unsafe", {
          family,
          probeKey: head.probe_key,
          rowId: head.id,
        });
        exclusions.push(`id != "${head.id}"`);
        continue;
      }
      families.push(family);
      exclusions.push(familyExclusionClause(family));
    }
    return families;
  }

  /**
   * Rotate `families` so iteration starts AFTER the family this client last
   * claimed from (round-robin). An unknown/absent cursor keeps the discovered
   * (oldest-first) order.
   */
  function rotateFamilies(families: string[]): string[] {
    if (lastClaimedFamily === null) return families;
    const idx = families.indexOf(lastClaimedFamily);
    if (idx === -1) return families;
    return [...families.slice(idx + 1), ...families.slice(0, idx + 1)];
  }

  return {
    async enqueue(input: EnqueueJobInput): Promise<JobView> {
      const { payload } = input;
      // Validate BEFORE creating the row: enqueue used to deref
      // `payload.meta.runId` only AFTER `pb.create`, so a malformed caller
      // payload threw AFTER persisting an undecodable row — a poison row
      // every claimer then has to win, fail to decode, and release-as-failed.
      // Failing loud first keeps the queue clean and keeps the encode and
      // decode boundaries byte-symmetric (same shared assertion).
      assertServiceJobPayload(
        `enqueue(probe_key ${String(
          (payload as Partial<ServiceJobPayload> | null)?.probeKey ?? "unknown",
        )})`,
        payload,
      );
      // A fresh job is `pending` with no owner and no lease. `probe_key` is the
      // join key (== payload.probeKey, the d6 aggregate row key); the work
      // rides in the `payload` JSON column for the worker to read post-claim.
      // §4.2 run-metadata denormalization (migration 1779990200): `run_id` is
      // copied out of `payload.meta.runId` so the run-view projection can
      // group a batch with an indexed filter instead of a JSON-path scan, and
      // `family` carries the producer's §5.1 registry id for indexed
      // per-family listing (absent → written empty, matching pre-P2 rows).
      const record = await pb.create<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        probe_key: payload.probeKey,
        status: "pending",
        claimed_by: "",
        lease_expires_at: null,
        version: 0,
        payload,
        run_id: payload.meta.runId,
        family: input.family ?? "",
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
      // FAMILY FAIRNESS: a single global oldest-50 pending page let a
      // high-frequency family's persistent backlog (d4+d5 tick every 15min)
      // permanently saturate the candidate page, so a low-frequency family's
      // jobs (e2e-demos, hourly) NEVER entered it and were NEVER claimed
      // (prod: all 18 e2e-demos jobs pending forever; staging: 3,734 pending,
      // oldest 22h). So claimNext now discovers the DISTINCT families present
      // in pending (oldest first) and tries them in ROTATION — round-robin
      // across calls, resuming after the family this client last claimed —
      // listing a PER-FAMILY candidate page for each. Every discovered family
      // is attempted before giving up, so no family starves while any of its
      // jobs are claimable. The CAS exactly-one-winner semantics are
      // untouched; only the candidate SELECTION changed.
      const families = rotateFamilies(await discoverPendingFamilies());
      for (const family of families) {
        // List this family's pending candidates (oldest first), then race
        // S0's atomic claim against each until one wins. Losing a CAS means a
        // peer took it — fall through, don't error.
        const page = await pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
          filter: `status = "pending" && ${familyInclusionClause(family)}`,
          sort: "created",
          perPage: CLAIM_CANDIDATE_PAGE,
          skipTotal: true,
        });
        // CLAIM FAIRNESS (worker herd): every worker lists the SAME
        // deterministically-ordered pending page, so iterating it head-first
        // makes all 6 replicas thunder on the same head row every poll. The
        // worker that re-polls fractionally first keeps winning the head; the
        // losers burn extra CAS round-trips walking down the list, which makes
        // them slower, poll less often, and claim less — compounding into a
        // ~4x skew onto 2 hot workers (the observed staging contention that
        // tipped legit settles past the per-turn budget). RANDOMIZING each
        // worker's attempt order spreads the herd across the whole candidate
        // page so a peer that already won the head doesn't force everyone else
        // to serialize behind it — wins distribute evenly and no worker
        // becomes a hot outlier. The CAS still guarantees exactly-one-winner
        // per row; this only changes which order a given worker TRIES
        // candidates, never the atomicity.
        const candidates = shuffleInPlace([...page.items], rng);
        const won = await raceCandidates(candidates, workerId, leaseSeconds);
        if (won) {
          lastClaimedFamily = family;
          return won;
        }
      }
      return { claimed: false };

      /**
       * Race S0's atomic claim against `candidates` in order until one wins.
       * Returns the won ClaimedJob, or null when every candidate was lost to
       * a peer (or released on decode failure).
       */
      async function raceCandidates(
        candidates: ProbeJobRecord[],
        raceWorkerId: string,
        raceLeaseSeconds: number,
      ): Promise<ClaimedJob | null> {
        for (const candidate of candidates) {
          // PER-CANDIDATE containment: the claim CAS can THROW (transport
          // blip) as well as lose. An escaped throw aborts the WHOLE
          // rotation — every remaining candidate AND every remaining family
          // goes unclaimed this poll — for one contested row. Warn and try
          // the next candidate instead; the row is retried naturally on the
          // next poll. (job-claim additionally maps a 5xx claim response to
          // won:false, so this catch covers genuine transport throws.)
          //
          // ACCEPTED REPETITION (deterministic 4xx): a hook that REJECTS
          // this row's claim deterministically (malformed id, route drift)
          // re-warns here on every poll until the row leaves pending — no
          // per-row escalation state is kept. Bounded: the stale-pending
          // sweep eventually claims-and-deletes the row (its CAS path can
          // share the same 4xx, but the sweep's own error-level logs cover
          // that), and a FLEET-WIDE deterministic rejection (rotated creds)
          // already escalates via renewLease's error-level renew-rejected.
          let result: ClaimResult;
          try {
            result = await claim.claimJob(
              candidate.id,
              raceWorkerId,
              raceLeaseSeconds,
            );
          } catch (err) {
            logger.warn("queue-client.claim-cas-threw", {
              jobId: candidate.id,
              workerId: raceWorkerId,
              err: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          if (result.won && !result.job) {
            // PROTOCOL VIOLATION: a win always carries the row view (the
            // hook builds them together inside the transaction). The CAS may
            // genuinely have committed, so this worker may now OWN the row —
            // falling through without releasing wedged a full lease window
            // (nobody renews or reports the orphaned claim; the sweeper
            // later reclaims it under a FALSE worker-reclaimed-pending
            // overlay). Make the breach visible, then mirror the
            // decode-failure containment below: release the row TERMINAL
            // (`failed`) and persist a synthetic worker-protocol-violation
            // result. A `pending`-target release can NEVER succeed here —
            // the hook refuses every pending-target release while the row's
            // lease is live (`refused_lease_live`, no holder exemption; a
            // committed win just MINTED that lease) and `refused_not_holder`
            // otherwise — whereas a terminal target passes the live-lease
            // gate (the expiry gate only rejects EXPIRED leases). The job
            // may have been perfectly runnable, but there is no honest path
            // back to pending; the synthetic result attributes the discard
            // to the breach instead of a false crash/reclaim overlay.
            // Failures are swallowed+warned: if this worker did NOT actually
            // own the row, the release is refused/4xxs and nothing changes.
            logger.warn("queue-client.claim-won-without-job", {
              jobId: candidate.id,
              workerId: raceWorkerId,
            });
            try {
              const released = await claim.releaseJob(
                candidate.id,
                raceWorkerId,
                "failed",
              );
              if (!released.released) {
                logger.warn(
                  "queue-client.claim-won-without-job-release-refused",
                  {
                    jobId: candidate.id,
                    workerId: raceWorkerId,
                    reason: released.reason ?? "unknown",
                  },
                );
              } else {
                // The row is now TERMINAL but RESULTLESS — write the
                // best-effort synthetic result so the consumer renders the
                // honest protocol-violation signal instead of synthesizing
                // a RED crash past grace. SINGLE attempt, same trade as the
                // decode-failure write below (G1g): this happens INSIDE the
                // claim race, so retry pacing would stall the rotation.
                const observedAt = new Date(now()).toISOString();
                const violation = protocolViolationResult({
                  jobId: candidate.id,
                  probeKey: candidate.probe_key,
                  workerId: raceWorkerId,
                  message: `claim CAS for job ${candidate.id} returned won:true without a job view (endpoint contract breach)`,
                  observedAt,
                });
                try {
                  await pb.update(PROBE_JOBS_COLLECTION, candidate.id, {
                    result: violation,
                    result_processed: false,
                  });
                } catch (writeErr) {
                  logger.warn(
                    "queue-client.claim-won-without-job-result-write-lost",
                    {
                      jobId: candidate.id,
                      workerId: raceWorkerId,
                      err:
                        writeErr instanceof Error
                          ? writeErr.message
                          : String(writeErr),
                    },
                  );
                }
              }
            } catch (releaseErr) {
              logger.warn("queue-client.claim-won-without-job-release-failed", {
                jobId: candidate.id,
                workerId: raceWorkerId,
                err:
                  releaseErr instanceof Error
                    ? releaseErr.message
                    : String(releaseErr),
              });
            }
          }
          if (!result.won || !result.job) continue;
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
              workerId: raceWorkerId,
              err: err instanceof Error ? err.message : String(err),
            });
            // Best-effort terminal release so the poison row doesn't re-list
            // forever. A refused release here is non-fatal — another sweeper or
            // a later reclaim handles it; we must not throw out of claimNext.
            try {
              const released = await claim.releaseJob(
                result.job.id,
                raceWorkerId,
                "failed",
              );
              if (!released.released) {
                // A REFUSED release (vs a thrown one, logged in the catch
                // below) was silent — the poison row stays claimed with no
                // breadcrumb tying the refusal to the decode failure. The
                // hook's reason says why (swept/stolen/already terminal).
                logger.warn("queue-client.claim-decode-release-refused", {
                  jobId: result.job.id,
                  workerId: raceWorkerId,
                  reason: released.reason ?? "unknown",
                });
              }
              if (released.released) {
                // The row is now TERMINAL but RESULTLESS — per the result
                // consumer's contract a terminal resultless row past its grace
                // window is synthesized as `worker-crashed-mid-job` (a RED
                // "crashed" overlay). A poison payload is NOT a crash: write a
                // best-effort synthetic result attributing the failure as
                // `worker-protocol-violation` (the taxonomy's "failed
                // schema/shape validation" kind) so the consumer renders the
                // honest signal. Best-effort: if the write itself is lost the
                // consumer's crash synthesis remains the fallback — log and
                // move on, never throw out of claimNext.
                // Injected clock (config.now) — not a bare `new Date()` — so
                // the synthetic timestamps are pinnable under test clocks.
                // No decodable payload → nothing to ECHO; the shared builder
                // honors the no-empty-sentinel contract (slug recovered from
                // the probe_key, runId minted from the jobId).
                const observedAt = new Date(now()).toISOString();
                const violation = protocolViolationResult({
                  jobId: result.job.id,
                  probeKey: candidate.probe_key,
                  workerId: raceWorkerId,
                  message: `job ${result.job.id} payload failed to decode at claim time: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                  observedAt,
                });
                // SINGLE attempt (G1g) — deliberately NOT writeResult's
                // bounded retry + 250ms pacing: this write happens INSIDE
                // the claim race, so each retry pause stalls the whole
                // candidate rotation (up to 500ms per poison row per poll).
                // The write is best-effort with a documented backstop — a
                // lost write leaves a terminal resultless row the consumer
                // synthesizes a crash result for past grace — so one try +
                // the lost warn is the right trade.
                try {
                  await pb.update(PROBE_JOBS_COLLECTION, result.job.id, {
                    result: violation,
                    result_processed: false,
                  });
                } catch (writeErr) {
                  logger.warn("queue-client.claim-decode-result-write-lost", {
                    jobId: result.job.id,
                    workerId: raceWorkerId,
                    err:
                      writeErr instanceof Error
                        ? writeErr.message
                        : String(writeErr),
                  });
                }
              }
            } catch (releaseErr) {
              logger.warn("queue-client.claim-decode-release-failed", {
                jobId: result.job.id,
                workerId: raceWorkerId,
                err:
                  releaseErr instanceof Error
                    ? releaseErr.message
                    : String(releaseErr),
              });
            }
            continue;
          }
          // Cache for the renew path so a later heartbeat doesn't depend on a
          // fresh PB re-read to re-hydrate the payload, and remember the
          // lease itself so an INDETERMINATE renew can keep it assumed-live.
          payloadCache.set(result.job.id, payload);
          const lease = leaseFromJob(result.job, payload);
          leaseCache.set(result.job.id, lease);
          logger.debug("queue-client.claimed", {
            jobId: result.job.id,
            workerId: raceWorkerId,
          });
          return { claimed: true, lease };
        }
        return null;
      }
    },

    async renewLease(
      jobId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<JobLease | null> {
      let result: RenewResult;
      try {
        result = await claim.renewLease(jobId, workerId, leaseSeconds);
      } catch (err) {
        // DETERMINISTIC 4xx (mirrors the sweep's G1d carve-out): the hook
        // REJECTED the request before its transaction ran (rotated creds →
        // auth 400s, malformed ids, route drift) — it fails IDENTICALLY on
        // every beat, so the assumed-live containment below would never
        // converge: the worker holds a phantom lease FOREVER while the
        // server lease lapses and the sweeper hands the job to another
        // worker — UNBOUNDED double-run, falsifying the one-lease-duration
        // risk bound documented below. Treat it like a definitively lost
        // CAS: error log (an operator must look — the rejection recurs),
        // evict both caches, return null so the heartbeat stops. 408/429
        // are excluded (transient by meaning — see
        // deterministicEndpointRejection).
        if (deterministicEndpointRejection(err)) {
          logger.error("queue-client.renew-rejected", {
            jobId,
            workerId,
            status: err.status,
            err: err.message,
          });
          payloadCache.delete(jobId);
          leaseCache.delete(jobId);
          return null;
        }
        // INDETERMINATE renew (thrown 5xx / transport blip / job-claim's
        // 2xx-unreadable): the renew may or may not have committed. The
        // worker heartbeat treats a renewLease THROW as fatal (it breaks),
        // so an escaped throw stops heartbeating and the sweeper later
        // reclaims a possibly-LIVE job — a false worker-crashed-mid-job.
        // Contain it: keep the last-known lease ASSUMED-LIVE (no eviction,
        // not null) so the heartbeat retries on the next beat; only a
        // definitive `renewed: false` (or a deterministic 4xx above) stops
        // it.
        //
        // ACCEPTED RISK (at most one lease duration): if the renew really
        // did NOT commit, the server-side lease keeps ticking toward its
        // previous expiry while we assume-live — the sweeper may re-queue
        // the job while this worker still runs it (duplicate execution for
        // up to one lease window). That is bounded and safe: the release
        // CAS arbitrates terminal writes, so the loser's report is refused.
        const known = leaseCache.get(jobId);
        if (known) {
          logger.warn("queue-client.renew-indeterminate", {
            jobId,
            workerId,
            msg: "renew indeterminate — keeping lease assumed-live, retrying next beat",
            err: err instanceof Error ? err.message : String(err),
          });
          return known;
        }
        // No locally-known lease (no same-process claim preceded this renew
        // — outside the worker flow): nothing to assume-live from, so stay
        // loud rather than fabricate a lease.
        throw err;
      }
      if (result.renewed && !result.job) {
        // PROTOCOL VIOLATION: a successful renew always carries the row view.
        // The breach must be visible — it means the endpoint contract
        // drifted. But the CAS WON: the job is LIVE and this worker still
        // holds it, so falling into the lost-lease eviction below would stop
        // the heartbeat on a SUCCESSFUL renew → the sweeper falsely reclaims
        // a live job. Keep the last-known lease ASSUMED-LIVE (like the
        // indeterminate path) so the next beat retries; only with nothing
        // cached (no same-process claim) is null the honest answer.
        logger.warn("queue-client.renew-renewed-without-job", {
          jobId,
          workerId,
        });
        const known = leaseCache.get(jobId);
        if (known) return known;
        payloadCache.delete(jobId);
        leaseCache.delete(jobId);
        return null;
      }
      if (!result.renewed || !result.job) {
        // The renew CAS was LOST: the lease is gone for this worker (stolen,
        // swept, or already terminal) and it will never report or renew this
        // job again — `report()`'s finally (the only other eviction) never
        // runs for an abandoned job, so without evicting HERE the claim-time
        // cache entry strands forever and the per-client map grows with
        // every lost/abandoned job.
        payloadCache.delete(jobId);
        leaseCache.delete(jobId);
        return null;
      }
      // The renew CAS already returned the authoritative lifecycle columns. The
      // payload is the only thing it omits, so prefer the claim-time cache. A
      // momentary PB read blip must NEVER turn a SUCCESSFUL renew into a thrown
      // error: that would kill the worker's heartbeat and let the sweeper
      // reclaim a live job, synthesizing a false `worker-crashed-mid-job`. So
      // the re-read below is a non-fatal convenience used only on a cache miss.
      let payload = payloadCache.get(jobId);
      if (!payload) {
        // SPLIT the failure triage: a thrown pb.getOne is a transient READ
        // BLIP (warn), but a row that reads back fine and then fails
        // decodePayload is a PROTOCOL VIOLATION — a poison payload persisted
        // on a live row — and triaging it under the read-blip warn hides it
        // from protocol-violation greps. Both are non-fatal here (the CAS
        // renew already won; the heartbeat-only empty payload covers it).
        let record: ProbeJobRecord | null = null;
        try {
          record = await pb.getOne<ProbeJobRecord>(
            PROBE_JOBS_COLLECTION,
            jobId,
          );
        } catch (err) {
          // Read blip — log and fall through to the cache-miss handling below.
          logger.warn("queue-client.renew-reread-failed", {
            jobId,
            workerId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        if (record) {
          try {
            payload = decodePayload(jobId, record.payload);
            payloadCache.set(jobId, payload);
          } catch (err) {
            logger.error("queue-client.renew-reread-protocol-violation", {
              jobId,
              workerId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
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
        // payload synthesized from the authoritative CAS row. null is
        // reserved for definitive losses: a lost CAS, a deterministic 4xx
        // rejection, or the renewed-without-job breach with nothing cached
        // (all handled above).
        logger.warn("queue-client.renew-no-payload", { jobId, workerId });
        const fallback = leaseFromJob(
          result.job,
          emptyPayloadForLease(result.job),
        );
        leaseCache.set(jobId, fallback);
        return fallback;
      }
      const renewedLease = leaseFromJob(result.job, payload);
      leaseCache.set(jobId, renewedLease);
      return renewedLease;
    },

    async report(input: ReportJobInput): Promise<void> {
      // The worker is DONE with this job on every path that REACHED the
      // release boundary (released, release refused, result write
      // exhausted, malformed result) — evict the cached payload + lease
      // before returning so those paths never leak entries. ONE carve-out:
      // the EQUALITY-INVARIANT rejection below is a malformed-INPUT refusal
      // thrown BEFORE the release CAS — nothing was released, the worker
      // still legitimately holds the job, and its heartbeat keeps renewing.
      // Evicting there dropped the assumed-live lease an INDETERMINATE
      // renew depends on, killing the heartbeat of a live job (the false
      // worker-crashed-mid-job class the caches exist to prevent).
      // EVERYTHING that can throw runs INSIDE the try (including the
      // invariant check and the status mapping below) so the finally's
      // eviction can never be ACCIDENTALLY skipped — only the flagged
      // invariant path opts out deliberately.
      let workerStillHoldsJob = false;
      try {
        // EQUALITY INVARIANT (contracts.ts ReportJobInput): the release CAS
        // keys on the TOP-LEVEL ids while the persisted result echoes its
        // own — a mismatched caller would release one row while filing the
        // result under another job's/worker's ids. Fail loud BEFORE the
        // release so neither half happens.
        if (
          input.jobId !== input.result.jobId ||
          input.workerId !== input.result.workerId
        ) {
          // No release happened (and none will): the worker still holds the
          // job — skip the finally's eviction. NOTE the flag flips only on
          // THIS check passing/failing cleanly: a result so malformed the
          // comparison itself throws (null result) still evicts, matching
          // the malformed-result eviction contract pinned by tests.
          workerStillHoldsJob = true;
          throw new Error(
            `queue-client: report() input violates the ReportJobInput equality invariant (jobId "${input.jobId}" vs result.jobId "${input.result.jobId}"; workerId "${input.workerId}" vs result.workerId "${input.result.workerId}") — refusing to release one row while filing the result under another`,
          );
        }
        const status = terminalJobStatus(input.result);
        const result = await claim.releaseJob(
          input.jobId,
          input.workerId,
          status,
        );
        if (!result.released) {
          if (result.reason === RELEASE_REFUSED_TERMINAL_SAME_HOLDER) {
            // TIMEOUT-AFTER-COMMIT retry: the row is already terminal UNDER
            // THIS workerId — only this worker's OWN earlier release can
            // have committed that (a terminal release retains claimed_by).
            // So the refusal is the second leg of a report() retry whose
            // first attempt released and then lost the response (or
            // exhausted the result write). The result is still THIS holder's
            // to write — proceed to writeResult instead of falsely declaring
            // it discarded; this is what makes report() retryable.
            //
            // DEPLOY SKEW: retryability depends on the HOOK threading this
            // reason. Against an older fleet-claim.pb.js (no reason field)
            // the same retry takes the generic-refusal throw below instead
            // — fail-closed (the result is declared discarded), never a
            // blind write. Roll the hook out before (or with) the harness.
            logger.warn("queue-client.release-refused-terminal-same-holder", {
              jobId: input.jobId,
              workerId: input.workerId,
              status,
            });
            // RETRY IDEMPOTENCY (double-count guard): this refusal means an
            // EARLIER report() attempt already released the row — and may
            // ALSO have already written the result. writeResult always seeds
            // `result_processed: false`, so a blind rewrite here would
            // UN-LATCH a result the consumer already aggregated (it latches
            // result_processed true after aggregating exactly once) and the
            // same result would be counted TWICE. Read the row first:
            //   - result present + processed   → fully done; skip the write.
            //   - result present + unprocessed → awaiting aggregation; the
            //     rewrite is at best a no-op and at worst races the
            //     consumer's read→aggregate→latch mid-flight; skip it.
            //   - no result                    → the first attempt's write
            //     never landed; fall through to writeResult (the original
            //     retryability contract).
            // A failed read must NOT fall through to a blind write — throw
            // loud; report() stays retryable and the next retry re-reads.
            // That includes a getOne that RESOLVES NULL (missing/unreadable
            // row): semantically a failed read, not "no result present".
            // And PB's unset-JSON shape reads back as "" — treat it as
            // ABSENT so the retry still lands its result instead of
            // skipping the write against an empty column.
            let existing: ProbeJobRecord | null;
            try {
              existing = await pb.getOne<ProbeJobRecord>(
                PROBE_JOBS_COLLECTION,
                input.jobId,
              );
            } catch (err) {
              throw new Error(
                `queue-client: cannot verify existing result for job ${input.jobId} (worker ${input.workerId}) before retry rewrite — refusing to blind-write (a rewrite could un-latch result_processed and double-count): ${
                  err instanceof Error ? err.message : String(err)
                }`,
                { cause: err },
              );
            }
            if (existing === null) {
              throw new Error(
                `queue-client: cannot verify existing result for job ${input.jobId} (worker ${input.workerId}) before retry rewrite — the pre-write read returned no row; refusing to blind-write`,
              );
            }
            if (
              existing.result !== undefined &&
              existing.result !== null &&
              existing.result !== ""
            ) {
              logger.info(
                existing.result_processed === true
                  ? "queue-client.result-already-aggregated"
                  : "queue-client.result-already-written",
                { jobId: input.jobId, workerId: input.workerId, status },
              );
              return;
            }
          } else {
            // The CAS refused the release — not the (effective) lease holder,
            // or the row was swept/stolen. The JOB is not lost (the sweeper's
            // reclaim path, REQ-B, keeps a reclaimable row in flight), but
            // this worker's COMPUTED RESULT is: it is never persisted. The
            // job RE-RUNS ONLY IF it is (or gets) reclaimed to pending — a
            // row another worker drove to terminal never re-runs. Say
            // exactly that — the old wording promised an unconditional
            // re-run the queue does not guarantee.
            throw new Error(
              `queue-client: release refused for job ${input.jobId} (worker ${input.workerId}, status ${status}, reason ${result.reason ?? "unknown"}) — not the lease holder or row not running; this worker's computed result is DISCARDED, and the job re-runs only if it is reclaimed to pending (terminal rows never re-run)`,
            );
          }
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
        // the helper RETRIES the write (bounded) and we surface a DISTINCT
        // "result lost" error on exhaustion, so the failure mode is
        // unmistakable in logs vs. a refused release.
        const write = await writeResult(
          input.jobId,
          input.workerId,
          input.result,
        );
        if (write.ok) {
          logger.debug("queue-client.reported", {
            jobId: input.jobId,
            workerId: input.workerId,
            status,
          });
          return;
        }
        // Exhausted the retries: the release SUCCEEDED (row is terminal) but the
        // result write FAILED — the result is LOST. Surface this distinctly so
        // an operator can tell it apart from a refused release.
        const lastErr = write.lastErr;
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
        // Terminal for this worker on every path that reached the release
        // boundary — drop the cached payload + lease here so neither a
        // refused release nor an exhausted result write leaks the entries.
        // The equality-invariant rejection is the one deliberate exception
        // (see the header note): nothing was released, the worker still
        // holds the job, and the heartbeat needs the caches.
        if (!workerStillHoldsJob) {
          payloadCache.delete(input.jobId);
          leaseCache.delete(input.jobId);
        }
      }
    },

    async countPendingForFamily(family: string): Promise<number> {
      // CHARSET GUARD (see familyClauseSafe): refuse to embed a backslash
      // family in a filter with unverified semantics. Returning 0 means the
      // producer's backlog gate opens for such a family — acceptable: the
      // slug-based producers can never mint one, so this only fires on
      // garbage input, and the warn makes it observable.
      if (!familyClauseSafe(family)) {
        logger.warn("queue-client.family-clause-unsafe", { family });
        return 0;
      }
      // Producer backlog gate: a totals-bearing perPage=1 list — PB computes
      // the COUNT server-side (totalItems); we never page rows back.
      // NON-TERMINAL, not just pending: the gate bounds the family's
      // CONCURRENT RUNS — a batch that is claimed/running is still in flight,
      // and enqueueing a fresh batch on top of it doubles the family's
      // concurrency (only done/failed rows stop gating).
      // skipTotal MUST be explicitly false: if totals are skipped PB returns
      // totalItems: -1, and -1 is never above the producer's backlog
      // threshold — the gate would silently FAIL OPEN and enqueue fresh
      // batches on top of an existing backlog.
      const page = await pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        filter: `(status = "pending" || status = "claimed" || status = "running") && ${familyInclusionClause(family)}`,
        perPage: 1,
        skipTotal: false,
      });
      // RUNTIME GUARD: even with skipTotal:false requested, a backend/client
      // drift could still hand back -1 (or garbage) — and -1 is never above
      // the producer's threshold, so returning it would silently FAIL OPEN
      // the backlog gate. Refuse the poisoned value loudly.
      const totalItems: unknown = page.totalItems;
      if (typeof totalItems !== "number" || totalItems < 0) {
        throw new PoisonedBacklogCountError(family, totalItems);
      }
      return totalItems;
    },

    async sweepExpired(nowMs: number): Promise<SweepResultWithIndeterminate> {
      // CONCURRENT-SWEEP LATCH: the sweep's grace set (`requeuedThisSweep`)
      // is per-CALL state — it protects rows this sweep just re-queued from
      // this sweep's OWN stale phase, but a CONCURRENT sweep on the same
      // client (runControlPlane wires FOUR family producers over ONE queue
      // client; a cron overrun or local cron override can overlap their
      // sweeps) would not see it and could claim-delete a row the first
      // sweep just re-queued — falsifying its worker-reclaimed-pending comm
      // error. So overlapping callers PIGGYBACK on the in-flight sweep's
      // result (the sweep is global per queue, so a redundant concurrent
      // pass does no additional good). The latch is in-process only: a
      // second control-plane REPLICA would still race (the fleet deploys
      // exactly one), where the stale phase's retained-lease heuristic is
      // the cross-process/cross-call mitigation.
      if (sweepInFlight !== null) return sweepInFlight;
      const sweep = runSweepExpired(nowMs).finally(() => {
        sweepInFlight = null;
      });
      sweepInFlight = sweep;
      return sweep;
    },

    async pruneAged(nowMs: number): Promise<PruneAgedResult> {
      // §4.2 retention, two legs over `created` cutoffs (see the window
      // constants' WHY above). Idempotent record-level deletes — single-owner
      // by the d6 producer's family gate (job-producer), not by this client,
      // so a concurrent/missed pass is harmless. Date-literal style mirrors
      // `sweepStaleRuns` (run-history.ts): ISO string in a quoted PB filter.
      const terminalCutoff = new Date(
        nowMs - PRUNE_TERMINAL_MAX_AGE_MS,
      ).toISOString();
      const zombieCutoff = new Date(
        nowMs - PRUNE_ZOMBIE_MAX_AGE_MS,
      ).toISOString();
      // Terminal leg: deliberately NO `result_processed` clause — the latch
      // gates aggregation, not retention (a stuck-false poison row is reaped
      // like any other terminal row at this age).
      const terminal = await pb.deleteByFilter(
        PROBE_JOBS_COLLECTION,
        `(status = "done" || status = "failed") && created < "${terminalCutoff}"`,
      );
      // Zombie leg: every non-terminal state — `pending` rows have no lease
      // for sweepExpired to reclaim, so this is their ONLY reaper. `created`
      // (not `updated`) keeps the cutoff renewal-immune.
      const zombie = await pb.deleteByFilter(
        PROBE_JOBS_COLLECTION,
        `(status = "pending" || status = "claimed" || status = "running") && created < "${zombieCutoff}"`,
      );
      if (terminal > 0 || zombie > 0) {
        logger.info("queue-client.pruned-aged", { terminal, zombie });
      }
      return { terminal, zombie };
    },
  };

  // The actual sweep pass `sweepExpired` latches around. A function
  // DECLARATION (hoisted) so the method above can reference it.
  async function runSweepExpired(
    nowMs: number,
  ): Promise<SweepResultWithIndeterminate> {
    // Scan claimed/running rows for expired leases (crashed/unreachable
    // workers). PB lacks an OR-of-equals shortcut here, so list both running
    // states and filter by lease in-process.
    //
    // ONE SWEEP OF GRACE: rows the lease phase re-queues below are tracked
    // and EXCLUDED from this call's stale-pending phase (the in-process
    // same-call protection). ACROSS calls the protection is the `requeued_at`
    // RE-ANCHOR: the release CAS stamps `requeued_at = now` on every pending
    // re-queue, and BOTH the stale phases (this lease-phase carve-out and
    // drainStalePending) age off `staleAgeAnchorMs` = `requeued_at ?? created`.
    // So a re-queued row is measured from its re-queue time — genuinely young
    // again — and the NEXT sweep does NOT claim-delete it off its renewal-immune
    // `created` age. This DISSOLVES the old honesty bind that forced the
    // long-expired carve-out to delete-rather-than-re-queue a stale-aged row:
    // re-queueing now emits a "back in flight" signal the next sweep HONORS.
    // The carve-out (G1d, below) therefore no longer deletes on the FIRST
    // expired sweep — it RE-CLAIMS until `consecutive_orphan_count` reaches
    // MAX_RECLAIM_ATTEMPTS, only then claim-deleting a row that keeps
    // re-orphaning (a poison job) so the queue cannot loop forever. The
    // lease-based RECENT-LEASE heuristic in drainStalePending is retained as a
    // SECONDARY guard for pre-migration rows that lack `requeued_at`.
    //
    // MASS-CRASH PAGING: with >CLAIM_CANDIDATE_PAGE claimed/running rows
    // (mass worker crash), an UNSORTED single page left the contents to PB's
    // unspecified default order — the same page of live-lease rows could
    // come back every sweep, leaving expired leases beyond it PERMANENTLY
    // invisible. Sorting by `lease_expires_at` ascending (indexed —
    // idx_probe_jobs_lease; empty dates sort first, and an empty lease
    // counts as expired) puts the most-expired rows at the head of the page,
    // so every sweep reclaims the oldest expirations first. We deliberately
    // KEEP the single page per sweep: the sort guarantees forward progress
    // (each reclaim frees head slots for the next sweep), so a backlog
    // drains progressively without unbounded pagination inside one sweep.
    const page = await pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
      filter: 'status = "claimed" || status = "running"',
      sort: "lease_expires_at",
      perPage: CLAIM_CANDIDATE_PAGE,
      skipTotal: true,
    });
    const pageTail = page.items[page.items.length - 1];
    if (
      page.items.length === CLAIM_CANDIDATE_PAGE &&
      pageTail !== undefined &&
      leaseExpired(pageTail.lease_expires_at, nowMs)
    ) {
      // A full page whose TAIL lease is already expired: under the
      // ascending lease sort, rows truncated beyond the page may be expired
      // too — make that observable instead of silently draining over
      // multiple sweeps. A full page with a LIVE tail is NOT warned: every
      // truncated row has an even later expiry, so nothing expirable was
      // hidden (warning there would false-positive on every sweep at any
      // healthy ≥50-in-flight steady state).
      logger.warn("queue-client.sweep-lease-page-truncated", {
        perPage: CLAIM_CANDIDATE_PAGE,
      });
    }
    const commErrors: PoolCommError[] = [];
    let reclaimed = 0;
    // AT-LEAST-ONCE SPLIT (G1g): thrown-release conservative maybes are
    // counted HERE, not in `reclaimed` — a throw that did NOT commit
    // would otherwise over-count confirmed reclaims (the count consumers
    // alert on), while the comm errors deliberately keep their
    // at-least-once duplication. commErrors length (excluding
    // sweeper-held rows) = reclaimed + reclaimedIndeterminate.
    let reclaimedIndeterminate = 0;
    // GRACE-SET SCOPE (load-bearing): this set is per-call, IN-PROCESS
    // state — it protects re-queued rows only from THIS sweep pass's own
    // stale phase. IN-PROCESS concurrency is real (runControlPlane wires
    // FOUR family producers over one queue client, and overlapping crons
    // can call sweepExpired concurrently) and is closed by the
    // CONCURRENT-SWEEP LATCH in `sweepExpired`: an overlapping caller
    // piggybacks on the in-flight pass instead of racing this set.
    // CROSS-PROCESS concurrency (a second control-plane REPLICA) is NOT
    // covered — the fleet deploys exactly ONE control-plane instance; if
    // that ever changes, the grace must move to ROW state (the retained
    // lease heuristic in the stale phase already covers the cross-call
    // case; a requeued_at column would cover both exactly).
    const requeuedThisSweep = new Set<string>();
    const observedAt = new Date(nowMs).toISOString();
    // Stale expiries (deleted rows). Declared here — not at the stale
    // phase — because the lease phase's long-expired carve-out below also
    // deletes (G1d); both phases feed the same count.
    let expiredPending = 0;
    for (const row of page.items) {
      if (!leaseExpired(row.lease_expires_at, nowMs)) continue;
      // Snapshot the holder BEFORE the release CAS: the release drops
      // ownership, and the special-case + comm-error attribution below must
      // reflect who HELD the expired lease, not the post-release row.
      const holder = row.claimed_by;
      // LONG-EXPIRED CARVE-OUT (G1d), INVERTED to RECLAIM-WINS (§4.2): a row
      // that is stale-expirable — its STALE-AGE (anchored on `requeued_at` if
      // it has been reclaimed, else `created`) past its family's window AND
      // its lease expired LONGER than that window — used to be claim-DELETED
      // here, dropping orphaned in-flight work on an abrupt worker bounce. It
      // is now RE-CLAIMED to pending (the path below) until its `consecutive_orphan_count`
      // reaches MAX_RECLAIM_ATTEMPTS, so a bounce is NON-LOSSY (the work
      // re-runs; idempotent probes make at-least-once safe). The honesty bind
      // the original carve-out dodged — re-queueing a `created`-stale row emits
      // a "back in flight" signal the NEXT sweep falsifies by claim-deleting it
      // off its renewal-immune `created` age — is DISSOLVED by `requeued_at`:
      // the release CAS re-anchors the stale-age clock on re-queue, so the
      // next sweep measures the row from its re-queue time (genuinely young
      // again) and does NOT delete it. The carve-out fires ONLY at the
      // attempt cap: a row reclaimed MAX_RECLAIM_ATTEMPTS times that is STILL
      // stale-expirable (a poison job that re-orphans every run) is deleted
      // claim-first like the stale phase (the claim CAS admits an expired-lease
      // claimed/running row — its reclaim safety net — so the delete stays
      // race-free), with no comm error and no reclaimed++ (the work is
      // discarded, not re-run) so it cannot re-queue forever. An UNPARSEABLE
      // stale-age anchor stays on the conservative re-queue path below (the
      // stale phase skips unparseable-anchor rows too, so "back in flight"
      // stays true). Sweeper-held rows (stale garbage mid-deletion, 60s lease)
      // keep their silent re-queue retry contract.
      if (staleExpiryPeriods > 0 && holder !== STALE_PENDING_SWEEPER_ID) {
        const family = probeKeyFamily(row.probe_key);
        const maxAgeMs = staleExpiryPeriods * stalePeriodMsFor(family);
        const anchorMs = staleAgeAnchorMs(row);
        const leaseMs = pbDateMs(row.lease_expires_at);
        const staleExpirable =
          !Number.isNaN(anchorMs) &&
          nowMs - anchorMs > maxAgeMs &&
          (!Number.isFinite(leaseMs) || leaseMs <= nowMs - maxAgeMs);
        // RECLAIM-WINS-UNTIL-CAP: only delete a stale-expirable row once it
        // has exhausted its reclaim budget; below the cap it falls through to
        // the re-queue path (reclaim WINS over the carve-out).
        // `consecutive_orphan_count` is the CONSECUTIVE re-orphan tally —
        // bumped ONLY by the sweeper re-queue path and reset on terminal
        // done|failed — so a healthy long-lived job that accrues peer steals
        // (expired-lease claim steals) does NOT exhaust its budget (absent → 0
        // for pre-migration rows, i.e. no consecutive orphans yet).
        const reclaimAttempts = row.consecutive_orphan_count ?? 0;
        if (staleExpirable && reclaimAttempts >= MAX_RECLAIM_ATTEMPTS) {
          // PER-ROW containment mirrors the stale phase: a thrown claim is
          // indeterminate (skip this sweep; the row is unchanged for the
          // next), a lost claim means a peer acted on the row, and a
          // failed delete leaves the row sweeper-claimed — its short lease
          // expires and the silent re-queue + later stale sweep retry the
          // delete (the existing self-healing contract).
          let won: ClaimResult;
          try {
            won = await claim.claimJob(
              row.id,
              STALE_PENDING_SWEEPER_ID,
              STALE_PENDING_SWEEPER_LEASE_SECONDS,
            );
          } catch (err) {
            logger.warn("queue-client.sweep-lease-stale-claim-threw", {
              jobId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          if (!won.won) {
            logger.debug("queue-client.sweep-lease-stale-claim-lost", {
              jobId: row.id,
            });
            continue;
          }
          try {
            await pb.delete(PROBE_JOBS_COLLECTION, row.id);
          } catch (err) {
            logger.error("queue-client.sweep-lease-stale-delete-failed", {
              jobId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          // COUNT-NAME CAVEAT: despite the name, `expiredPending` here
          // counts a CLAIMED/RUNNING row (long-expired lease, stale-aged)
          // deleted by this carve-out at the reclaim cap — not just stale
          // PENDING rows from the drain phase. The shared contract doc
          // (`SweepResult.expiredPending` in contracts.ts) documents this
          // lease-phase carve-out explicitly — the two sides agree.
          expiredPending += 1;
          logger.warn("queue-client.sweep-lease-stale-deleted", {
            jobId: row.id,
            probeKey: row.probe_key,
            family,
            workerId: holder,
            maxAgeMs,
            reclaimAttempts,
          });
          continue;
        }
      }
      // Re-queue on behalf of the dead holder: the CAS authorizes on
      // `claimed_by` (still the dead worker), so this atomically flips the
      // row back to pending and drops ownership.
      //
      // PER-ROW containment (REQ-B): a release that THROWS (transport blip —
      // distinct from a refused CAS, handled below) must not escape the
      // loop. The producer swallows a sweepExpired throw, so an escape would
      // discard the commErrors ALREADY synthesized for rows ALREADY released
      // to pending in this pass — their gray "re-queued" surfaces would
      // never reach the dashboard and are never regenerated (those rows are
      // pending now; no later sweep re-emits them).
      //
      // TIMEOUT-AFTER-COMMIT (at-least-once): a thrown release may have
      // COMMITTED server-side before the response was lost — the row IS
      // pending then, so (a) the SAME call's stale phase could
      // claim-and-delete it unless it is in the grace set, and (b) its
      // worker-reclaimed-pending comm error would be lost FOREVER (the row
      // is pending; no later sweep re-emits it — the file's own contract
      // above). So treat a thrown release CONSERVATIVELY as if it
      // committed: grace the row and synthesize the comm error anyway. If
      // the release did NOT commit, the next sweep retries the
      // still-expired lease and a DUPLICATE gray "re-queued" overlay may
      // render — harmless; a MISSING one is not. Sweeper-held rows stay
      // silent (mirroring the committed path below). The known-refused CAS
      // (`released: false`) stays a clean skip, and a DETERMINISTIC 4xx
      // (the hook rejected the request — nothing committed) is carved out
      // below — only the genuinely indeterminate throw (5xx / transport /
      // 2xx-unreadable) gets the conservative treatment.
      let released: ReleaseResult;
      try {
        released = await claim.releaseJob(row.id, holder, "pending");
      } catch (err) {
        // DETERMINISTIC 4xx (G1d): the hook REJECTED the request before
        // its transaction ran — definitively NOTHING committed, so the
        // conservative at-least-once treatment below would be a LIE told
        // EVERY sweep: a wedge row (concrete trigger: empty claimed_by →
        // the hook 400s on the missing workerId) would paint a permanent
        // per-sweep false worker-reclaimed-pending overlay for a row that
        // never moves. Log loud (error — the row IS wedged and needs an
        // operator) and synthesize nothing: no grace, no comm error, no
        // reclaimed++. Only 5xx/transport/2xx-unreadable throws — plus
        // the transient-by-meaning 408/429 (see
        // deterministicEndpointRejection) — stay conservative.
        if (deterministicEndpointRejection(err)) {
          logger.error("queue-client.sweep-release-rejected", {
            jobId: row.id,
            workerId: holder,
            status: err.status,
            err: err.message,
          });
          continue;
        }
        logger.warn("queue-client.sweep-release-threw", {
          jobId: row.id,
          workerId: holder,
          err: err instanceof Error ? err.message : String(err),
        });
        requeuedThisSweep.add(row.id);
        if (holder !== STALE_PENDING_SWEEPER_ID) {
          reclaimedIndeterminate += 1;
          commErrors.push({
            kind: "worker-reclaimed-pending",
            message: `lease for job ${row.id} expired (worker ${holder || "unknown"} reclaimed); re-queue release threw mid-flight — conservatively reported as re-queued (at-least-once)`,
            workerId: holder || undefined,
            jobId: row.id,
            observedAt,
          });
        }
        continue;
      }
      if (!released.released) {
        // Another sweeper or a late worker report won the race — not an
        // error, just nothing for us to reclaim on this row.
        logger.debug("queue-client.sweep-skip", {
          jobId: row.id,
          workerId: holder,
        });
        continue;
      }
      // SPECIAL CASE: a row claimed by the STALE-PENDING SWEEPER is stale
      // garbage mid-deletion (the stale sweep won the claim but its delete
      // failed), NOT a crashed worker's job. The releaseJob above already
      // re-queued it — which is exactly the self-healing retry contract (a
      // later stale sweep re-claims and re-deletes it) — but it must be
      // SILENT: synthesizing `worker-reclaimed-pending` here would paint a
      // gray "re-queued / back in flight" dashboard overlay for a row that
      // was never in flight, attributed to a non-existent worker. Not
      // counted in `reclaimed` either (reclaimed + reclaimedIndeterminate
      // are paired 1:1 with the commErrors they document). It DOES feed
      // the grace set: this call's
      // stale phase must not claim-and-delete a row the lease phase just
      // re-queued (the retry contract is a LATER sweep — re-deleting in the
      // same sweep would race the very lease/delete failure that put the
      // row here), so the sweeper-retry row gets the same one sweep of
      // grace as a worker-reclaimed row.
      if (holder === STALE_PENDING_SWEEPER_ID) {
        requeuedThisSweep.add(row.id);
        logger.debug("queue-client.stale-sweeper-retry-requeue", {
          jobId: row.id,
        });
        continue;
      }
      reclaimed += 1;
      requeuedThisSweep.add(row.id);
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
        message: `lease for job ${row.id} expired (worker ${holder || "unknown"} reclaimed); re-queued to pending`,
        workerId: holder || undefined,
        jobId: row.id,
        observedAt,
      });
      logger.warn("queue-client.sweep-reclaimed", {
        jobId: row.id,
        workerId: holder,
      });
    }

    // ── STALE-PENDING EXPIRY (structural backlog drain) ──────────────────
    // A pending row had NO terminal path: the lease sweep above only touches
    // claimed/running rows, so an accumulated backlog (staging: 3,734
    // pending, oldest 22h) could only drain through the 2 serial workers and
    // effectively never did. Expire pending jobs older than expiryPeriods ×
    // their family's production period — the family has enqueued ~3 fresher
    // batches since, so the stale job's eventual result would be ancient
    // data. Each stale row is CLAIMED via the S0 CAS first (a racing worker
    // either wins the row — the sweeper backs off — or loses it and never
    // sees it again; the exactly-one-winner invariant makes the delete
    // race-free) and then deleted. No comm error is synthesized: an
    // expired-pending job never ran, and its family's next batch is the
    // dashboard signal.
    // The drain LOOPS pages (up to STALE_PENDING_MAX_PAGES_PER_SWEEP): a
    // single 50-row page per sweep would take ~7.5h to drain the motivating
    // 3,734-row backlog at ~10 sweeps/hour. When a pass removed rows from
    // pending (deleted, or a claim CAS ran — win or lose, the row LEFT
    // pending), pagination shifted back, so the SAME page index is
    // re-listed and naturally yields the shifted-in batch. When a FULL page
    // produced no claim attempt at all (every row too young / graced /
    // unparseable), nothing shifted — ADVANCE to the next page instead of
    // stopping: expiry is per-FAMILY while the sort is absolute `created`,
    // so younger expirable fast-family rows can sit BEYOND a full page of
    // not-yet-expirable slow-family rows (cross-family occlusion — the
    // class this drain exists to fix). Only a NON-FULL page proves the
    // queue's tail was seen; the page cap still bounds a sweep's work.
    // PHASE containment (REQ-B): the whole stale drain is wrapped so a
    // throw anywhere inside it (the pending pb.list, the claim CAS — only
    // pb.delete was caught per-row) still returns the lease phase's partial
    // result above. The producer swallows a sweepExpired throw, so an
    // escape here would discard every commError the lease phase just
    // synthesized — the same dashboard-signal loss as an escaped release.
    // The drain itself is retried in full by the next sweep.
    try {
      await drainStalePending();
    } catch (err) {
      logger.error("queue-client.sweep-stale-phase-threw", {
        expiredPendingBeforeThrow: expiredPending,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return { reclaimed, reclaimedIndeterminate, commErrors, expiredPending };

    /**
     * The stale-pending drain loop (see the STALE-PENDING EXPIRY comment
     * above). Mutates the enclosing `expiredPending` PER ROW (not per pass)
     * so the partial count survives a mid-pass throw.
     */
    async function drainStalePending(): Promise<void> {
      if (staleExpiryPeriods <= 0) return;
      let listPage = 1;
      for (let pass = 0; pass < STALE_PENDING_MAX_PAGES_PER_SWEEP; pass++) {
        const pendingPage = await pb.list<ProbeJobRecord>(
          PROBE_JOBS_COLLECTION,
          {
            filter: 'status = "pending"',
            sort: "created",
            page: listPage,
            perPage: CLAIM_CANDIDATE_PAGE,
            skipTotal: true,
          },
        );
        if (pendingPage.items.length === 0) break;
        // Rows that reached the claim CAS this pass — win or lose, such a
        // row LEFT "pending" (won → claimed by the sweeper; lost → claimed
        // by a racing worker), so any attempt means pagination shifted.
        let passAttempted = 0;
        for (const row of pendingPage.items) {
          // ONE SWEEP OF GRACE (see function header): a row the lease phase
          // re-queued moments ago in THIS call is "back in flight" — deleting
          // it now would falsify the worker-reclaimed-pending comm error just
          // emitted for it. Skip it; if truly stale it expires next sweep.
          // Applied on EVERY pass of the drain loop — pagination must never
          // out-run the grace set.
          if (requeuedThisSweep.has(row.id)) {
            logger.debug("queue-client.sweep-stale-grace", { jobId: row.id });
            continue;
          }
          // Age off the STALE-AGE ANCHOR (`requeued_at` if the row has been
          // reclaimed, else PB's system `created`) — the SAME anchored rewrite
          // as leaseExpired. Unlike the lease path, an unparseable anchor is
          // conservatively SKIPPED: delete is destructive, and "never wedge the
          // queue" doesn't apply — a pending row is claimable regardless.
          const anchorMs = staleAgeAnchorMs(row);
          if (Number.isNaN(anchorMs)) {
            logger.warn("queue-client.sweep-stale-unparseable-created", {
              jobId: row.id,
              created: row.created ?? null,
              requeuedAt: row.requeued_at ?? null,
            });
            continue;
          }
          const family = probeKeyFamily(row.probe_key);
          const maxAgeMs = staleExpiryPeriods * stalePeriodMsFor(family);
          const ageMs = nowMs - anchorMs;
          if (ageMs <= maxAgeMs) continue;
          // RECENT-LEASE HEURISTIC (secondary, retained): the PRIMARY age
          // re-anchor is `requeued_at` (above) — a job re-queued by the lease
          // sweep gets its stale-age clock reset, so it is YOUNG again and the
          // `ageMs <= maxAgeMs` check above already skips it (this is what
          // dissolves the carve-out's honesty bind). This lease-based heuristic
          // stays as a secondary guard for the cross-call window of a
          // PRE-MIGRATION row (no `requeued_at`) whose retained expired lease is
          // its only "recently in flight" evidence: a PARSEABLE lease within the
          // stale window means the row was in flight recently and its
          // `created`-based age is stale evidence — skip it; it expires normally
          // once a full stale window passes with no re-claim. Tradeoff: a
          // sweeper-claimed row whose delete failed also carries a recent (60s)
          // lease after its silent re-queue, so stale GARBAGE can linger up to
          // one extra stale window before the retry delete — harmless, and the
          // self-healing contract still holds.
          const leaseMs = pbDateMs(row.lease_expires_at);
          if (Number.isFinite(leaseMs) && leaseMs > nowMs - maxAgeMs) {
            logger.debug("queue-client.sweep-stale-recent-lease-skip", {
              jobId: row.id,
              leaseExpiresAt: row.lease_expires_at,
            });
            continue;
          }
          // PER-ROW containment: the claim CAS can THROW (a deterministic
          // 4xx from the hook, or a transport blip the 5xx mapping doesn't
          // cover). Letting it escape to the phase wrapper aborts the
          // WHOLE drain for one sick row — every later stale row goes
          // unprocessed this sweep. Warn + continue; the row is NOT
          // counted as attempted (indeterminate whether it left pending).
          let won: ClaimResult;
          try {
            won = await claim.claimJob(
              row.id,
              STALE_PENDING_SWEEPER_ID,
              STALE_PENDING_SWEEPER_LEASE_SECONDS,
            );
          } catch (err) {
            logger.warn("queue-client.sweep-stale-claim-threw", {
              jobId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          passAttempted += 1;
          if (!won.won) {
            // A worker won the race — the job is in flight after all; not
            // ours to expire. (The row left "pending", so it also drops out
            // of the next pass's listing — no re-processing.)
            //
            // CAVEAT on the "left pending" assumption feeding passAttempted:
            // job-claim maps a claim 5xx to won:false WITHOUT the row
            // necessarily leaving pending. Such a row re-appears when the
            // same page index is re-listed, so a page of persistently-5xx
            // rows is retried pass after pass — bounded by the
            // STALE_PENDING_MAX_PAGES_PER_SWEEP cap, after which the sweep
            // ends and the NEXT sweep retries. A bounded stall on a sick
            // backend, never an infinite loop.
            logger.debug("queue-client.sweep-stale-claim-lost", {
              jobId: row.id,
            });
            continue;
          }
          try {
            await pb.delete(PROBE_JOBS_COLLECTION, row.id);
          } catch (err) {
            // The row stays claimed by the sweeper; its short lease expires
            // and the NEXT lease sweep re-queues it to pending, where a later
            // stale sweep retries — self-healing, so log and move on.
            logger.error("queue-client.sweep-stale-delete-failed", {
              jobId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
          // Per ROW (not per pass) so a mid-pass throw caught by the phase
          // wrapper still reports the rows already expired.
          expiredPending += 1;
          logger.warn("queue-client.sweep-expired-pending", {
            jobId: row.id,
            probeKey: row.probe_key,
            family,
            ageMs,
            maxAgeMs,
          });
        }
        // A NON-FULL page → we have already seen the queue's tail; nothing
        // more for this sweep to do. (A zero-EXPIRY pass is intentionally
        // NOT a termination signal: claim-CAS-lost rows LEAVE pending, so
        // expiring nothing does not mean re-listing returns the same rows.)
        if (pendingPage.items.length < CLAIM_CANDIDATE_PAGE) break;
        // A FULL page where no row even reached the claim CAS: nothing left
        // pending, pagination did not shift — ADVANCE past it (cross-family
        // occlusion; see the drain header). Otherwise rows left pending and
        // pagination shifted back, so re-list the SAME page index to see
        // the shifted-in batch.
        //
        // PAGE-ADVANCE INDETERMINACY (accepted): a claim that THREW is not
        // counted in passAttempted, but it may still have COMMITTED
        // server-side (thrown-but-committed) — the row then LEFT pending
        // and pagination shifted even though this pass looks attempt-free,
        // so an advance here can skip shifted-in rows for the REST of this
        // sweep. Bounded and self-healing: the next sweep re-lists from
        // page 1 and re-evaluates everything skipped.
        if (passAttempted === 0) listPage += 1;
      }
    }
  }
}
