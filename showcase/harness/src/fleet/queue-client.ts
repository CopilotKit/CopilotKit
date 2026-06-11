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
}

/** The persisted `probe_jobs` row shape as the PB records API returns it. */
interface ProbeJobRecord extends JobView {
  /** The serialized per-service work (migration 1779989500 adds this column). */
  payload?: unknown;
  /** PB system timestamp (space-separated date form) — the stale-pending
   * sweep's age anchor. */
  created?: string;
  /** Result-flow columns (migration 1779989700) — read by report()'s
   * retry-idempotency guard before any rewrite. */
  result?: unknown;
  result_processed?: boolean;
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
  if (raw === null || typeof raw !== "object") {
    throw new Error(`queue-client: ${label} has no decodable payload`);
  }
  const candidate = raw as Partial<ServiceJobPayload>;
  if (
    typeof candidate.probeKey !== "string" ||
    typeof candidate.serviceSlug !== "string" ||
    typeof candidate.driverKind !== "string" ||
    candidate.meta === undefined
  ) {
    throw new Error(
      `queue-client: ${label} payload is missing required fields (probeKey/serviceSlug/driverKind/meta)`,
    );
  }
  // `meta` is typed `ServiceJobMeta`, but the JSON column is untrusted: a
  // non-object `meta` (string/number/array) satisfies the `!== undefined`
  // check above yet would deref to `undefined` deep in the worker (the
  // aggregator groups by `meta.runId`). Assert the FULL required meta shape —
  // `triggered`/`enqueuedAt` are consumed downstream just like `runId`, so a
  // half-validated meta would only defer the failure past this boundary.
  const meta = candidate.meta as Partial<ServiceJobMeta> | null;
  if (
    meta === null ||
    typeof meta !== "object" ||
    Array.isArray(meta) ||
    typeof meta.runId !== "string" ||
    typeof meta.triggered !== "boolean" ||
    typeof meta.enqueuedAt !== "string"
  ) {
    throw new Error(
      `queue-client: ${label} payload.meta must be a non-null object with a string runId, boolean triggered and string enqueuedAt`,
    );
  }
  // Optional fields still have REQUIRED shapes when present: cellIds is a
  // string array (the worker iterates it as feature ids) and driverInputs is
  // a plain record (the worker reads keys off it).
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
  return idx <= 0 ? probeKey : probeKey.slice(idx + 1);
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
 * CHARSET GUARD for family values destined for filter clauses. The two
 * escape helpers below carry CONTRADICTORY backslash contracts: the quoted
 * equality legs double `\` (PB quoted-literal escaping), while the LIKE
 * legs' verified behavior has fexpr passing non-quote backslashes through
 * VERBATIM — both cannot hold for one input, and only the `%`/`_` handling
 * has actually been verified against PB source. Probe keys are slugs in
 * practice, so rather than ship an unverifiable dual contract, callers SKIP
 * families containing a backslash (with a warn): discovery stops at one
 * (no safe exclusion clause exists), and the count gate refuses it.
 */
function familyClauseSafe(family: string): boolean {
  return !family.includes("\\");
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
  return escapeFilterLiteral(value)
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
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
): FleetQueueClient {
  const { pb, claim, logger } = config;
  const rng = config.rng ?? Math.random;
  const now = config.now ?? Date.now;
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

  /**
   * Bounded-retry persistence of a per-service result onto an ALREADY
   * TERMINAL probe_jobs row — the SEPARATE record write that follows a
   * release CAS (migration 1779989700 adds `result` + `result_processed`).
   * Never throws: returns `{ ok: true }` on success, or `{ ok: false,
   * lastErr }` after RESULT_WRITE_MAX_ATTEMPTS attempts so each caller
   * decides whether the loss is fatal (`report` — distinct "result lost"
   * error) or best-effort (the decode-failure attribution in `claimNext`).
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
        logger.warn("queue-client.family-discovery-truncated", {
          maxFamilies: MAX_PENDING_FAMILIES,
          nextProbeKey: head.probe_key,
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
      // CHARSET GUARD: a family containing a backslash cannot be embedded
      // in a filter with verified semantics (see familyClauseSafe). Without
      // a safe EXCLUSION clause the loop cannot see past this family's rows
      // either — warn and stop discovery here; families already discovered
      // still rotate, and the unsafe family's rows are skipped from
      // claiming entirely (probe keys are slugs, so this is garbage input).
      if (!familyClauseSafe(family)) {
        logger.warn("queue-client.family-clause-unsafe", {
          family,
          probeKey: head.probe_key,
        });
        break;
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
          (payload as Partial<ServiceJobPayload> | null)?.probeKey ??
            "unknown",
        )})`,
        payload,
      );
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
                const observedAt = new Date(now()).toISOString();
                const message = `job ${result.job.id} payload failed to decode at claim time: ${
                  err instanceof Error ? err.message : String(err)
                }`;
                const violation: ServiceJobResult = {
                  jobId: result.job.id,
                  probeKey: candidate.probe_key,
                  // No decodable payload → nothing to ECHO, but the result
                  // must not carry the empty `serviceSlug`/`runId` sentinels
                  // `emptyPayloadForLease` forbids feeding aggregation (an
                  // empty runId groups into nothing; an empty serviceSlug
                  // corrupts the per-service rollup). Recover the slug from
                  // the row's probe_key (`d6:<slug>` → `<slug>`) and mint a
                  // non-colliding synthetic runId from the jobId. The
                  // aggregate key falls back to the row's probe_key (the
                  // `d6:<slug>` aggregate row key), mirroring the worker's
                  // comm-error result builder.
                  serviceSlug: probeKeySlug(candidate.probe_key),
                  runId: `pviol_${result.job.id}`,
                  workerId: raceWorkerId,
                  aggregateState: "error",
                  aggregateKey: candidate.probe_key,
                  aggregateSignal: { error: message },
                  cells: [],
                  rollup: { total: 0, passed: 0, failed: 0 },
                  finishedAt: observedAt,
                  commError: {
                    kind: "worker-protocol-violation",
                    message,
                    workerId: raceWorkerId,
                    jobId: result.job.id,
                    observedAt,
                  },
                };
                const write = await writeResult(
                  result.job.id,
                  raceWorkerId,
                  violation,
                );
                if (!write.ok) {
                  logger.warn("queue-client.claim-decode-result-write-lost", {
                    jobId: result.job.id,
                    workerId: raceWorkerId,
                    err:
                      write.lastErr instanceof Error
                        ? write.lastErr.message
                        : String(write.lastErr),
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
        // INDETERMINATE renew (thrown 5xx / transport blip / job-claim's
        // 2xx-unreadable): the renew may or may not have committed. The
        // worker heartbeat treats a renewLease THROW as fatal (it breaks),
        // so an escaped throw stops heartbeating and the sweeper later
        // reclaims a possibly-LIVE job — a false worker-crashed-mid-job.
        // Contain it: keep the last-known lease ASSUMED-LIVE (no eviction,
        // not null) so the heartbeat retries on the next beat; only a
        // definitive `renewed: false` stops it.
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
        // payload synthesized from the authoritative CAS row. We ONLY return
        // null when the CAS itself failed (handled above).
        logger.warn("queue-client.renew-no-payload", { jobId, workerId });
        const fallback = leaseFromJob(result.job, emptyPayloadForLease(result.job));
        leaseCache.set(jobId, fallback);
        return fallback;
      }
      const renewedLease = leaseFromJob(result.job, payload);
      leaseCache.set(jobId, renewedLease);
      return renewedLease;
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
          if (result.reason === RELEASE_REFUSED_TERMINAL_SAME_HOLDER) {
            // TIMEOUT-AFTER-COMMIT retry: the row is already terminal UNDER
            // THIS workerId — only this worker's OWN earlier release can
            // have committed that (a terminal release retains claimed_by).
            // So the refusal is the second leg of a report() retry whose
            // first attempt released and then lost the response (or
            // exhausted the result write). The result is still THIS holder's
            // to write — proceed to writeResult instead of falsely declaring
            // it discarded; this is what makes report() retryable.
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
              );
            }
            if (
              existing &&
              existing.result !== undefined &&
              existing.result !== null
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
        // Terminal for this worker no matter the outcome — drop the cached
        // payload + lease here so neither a refused release nor an exhausted
        // result write leaks the entries.
        payloadCache.delete(input.jobId);
        leaseCache.delete(input.jobId);
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
      return page.totalItems;
    },

    async sweepExpired(nowMs: number): Promise<SweepResult> {
      // Scan claimed/running rows for expired leases (crashed/unreachable
      // workers). PB lacks an OR-of-equals shortcut here, so list both running
      // states and filter by lease in-process.
      //
      // ONE SWEEP OF GRACE: rows the lease phase re-queues below are tracked
      // and EXCLUDED from this call's stale-pending phase. The stale phase
      // ages off PB's system `created` (the ORIGINAL enqueue time — re-queue
      // does not touch it), so a long-claimed job would otherwise be re-queued
      // ("back in flight" per the worker-reclaimed-pending comm error) and
      // then immediately claimed-and-deleted by the SAME call — falsifying the
      // comm error and nulling downstream aggregate-key resolution on the
      // deleted row. ACROSS calls the stale phase's RECENT-LEASE heuristic
      // (see drainStalePending) protects the same row: the release hook
      // retains the expired lease on re-queue, so a recently-in-flight row
      // is not expired off its original `created` age by the NEXT sweep
      // either. (Re-anchoring the age to the re-queue time would need a
      // column; the retained lease is the schema-free approximation.)
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
      // SINGLE-SWEEPER ASSUMPTION (load-bearing): this grace set is
      // per-call, IN-PROCESS state. It protects re-queued rows only from
      // THIS control-plane's own stale phase — a SECOND concurrent sweeper
      // (another control-plane replica running sweepExpired) would not see
      // it and could claim-delete a row this call just re-queued,
      // falsifying its comm error. The fleet deploys exactly ONE
      // control-plane instance (the producer/sweeper is a singleton); if
      // that ever changes, the grace must move to ROW state (the retained
      // lease heuristic in the stale phase already covers the cross-call
      // case; a requeued_at column would cover both exactly).
      const requeuedThisSweep = new Set<string>();
      const observedAt = new Date(nowMs).toISOString();
      for (const row of page.items) {
        if (!leaseExpired(row.lease_expires_at, nowMs)) continue;
        // Snapshot the holder BEFORE the release CAS: the release drops
        // ownership, and the special-case + comm-error attribution below must
        // reflect who HELD the expired lease, not the post-release row.
        const holder = row.claimed_by;
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
          // reclaimed++. Only 5xx/transport/2xx-unreadable throws — the
          // genuinely indeterminate class — stay conservative.
          if (
            err instanceof JobClaimEndpointError &&
            err.status >= 400 &&
            err.status < 500
          ) {
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
            reclaimed += 1;
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
        // counted in `reclaimed` either (that count is paired 1:1 with the
        // commErrors it documents). It DOES feed the grace set: this call's
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
      let expiredPending = 0;
      try {
        await drainStalePending();
      } catch (err) {
        logger.error("queue-client.sweep-stale-phase-threw", {
          expiredPendingBeforeThrow: expiredPending,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      return { reclaimed, commErrors, expiredPending };

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
            // Age off PB's system `created` (space-separated date form —
            // normalize with the SAME anchored rewrite as leaseExpired). Unlike
            // the lease path, an unparseable value is conservatively SKIPPED:
            // delete is destructive, and "never wedge the queue" doesn't apply —
            // a pending row is claimable regardless.
            const createdMs = Date.parse(
              String(row.created ?? "").replace(PB_DATE_SEP_RE, "$1T"),
            );
            if (Number.isNaN(createdMs)) {
              logger.warn("queue-client.sweep-stale-unparseable-created", {
                jobId: row.id,
                created: row.created ?? null,
              });
              continue;
            }
            const family = probeKeyFamily(row.probe_key);
            const maxAgeMs = staleExpiryPeriods * stalePeriodMsFor(family);
            const ageMs = nowMs - createdMs;
            if (ageMs <= maxAgeMs) continue;
            // RECENT-LEASE HEURISTIC (no schema change): the age above is
            // anchored on PB `created`, which a re-queue does NOT touch — so
            // a job that legitimately ran LONGER than its family window
            // comes back from the lease sweep already "stale" and would be
            // claim-deleted by the NEXT sweep before any plausible re-run
            // (the dashboard then permanently shows "re-queued" for
            // silently-discarded work). The release hook RETAINS the expired
            // lease_expires_at on a pending re-queue, so a PARSEABLE lease
            // within the family window means the row was IN FLIGHT recently
            // and its `created`-based age is stale evidence — skip it; it
            // expires normally once a full window passes with no re-claim.
            // (A `requeued_at` column would be exact; the retained lease is
            // the schema-free approximation.) Tradeoff: a sweeper-claimed
            // row whose delete failed also carries a recent (60s) lease
            // after its silent re-queue, so stale GARBAGE can linger up to
            // one extra family window before the retry delete — harmless,
            // and the self-healing contract still holds.
            const leaseMs = Date.parse(
              String(row.lease_expires_at ?? "").replace(PB_DATE_SEP_RE, "$1T"),
            );
            if (Number.isFinite(leaseMs) && leaseMs > nowMs - maxAgeMs) {
              logger.debug("queue-client.sweep-stale-recent-lease-skip", {
                jobId: row.id,
                leaseExpiresAt: row.lease_expires_at,
              });
              continue;
            }
            passAttempted += 1;
            const won = await claim.claimJob(
              row.id,
              STALE_PENDING_SWEEPER_ID,
              STALE_PENDING_SWEEPER_LEASE_SECONDS,
            );
            if (!won.won) {
              // A worker won the race — the job is in flight after all; not
              // ours to expire. (The row left "pending", so it also drops out
              // of the next pass's listing — no re-processing.)
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
          if (passAttempted === 0) listPage += 1;
        }
      }
    },
  };
}
