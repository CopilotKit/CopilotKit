/**
 * Fleet shared CONTRACTS — the type foundation the control-plane, worker,
 * queue-client, and dashboard all depend on (BLITZ S2, the GATE slot).
 *
 * ── WHY PLAIN TS, NOT ZOD ──────────────────────────────────────────────
 * The sibling fleet modules (`job-claim.ts`, `role-config.ts`) and the
 * storage modules these contracts bridge to (`writers/status-writer.ts`,
 * `probes/run-history.ts`) are all plain TS interfaces. Zod in this repo is
 * reserved for parsing UNTRUSTED YAML at load time (rule schemas, probe
 * config). These contracts are INTERNAL boundaries between our own
 * processes, validated structurally by tsc, so we mirror the fleet idiom:
 * plain TS types + a couple of pure helpers with unit tests.
 *
 * ── WHAT BUILDS ON WHAT ────────────────────────────────────────────────
 * S0 (`job-claim.ts`) gives us the row-level claim primitive: `JobView`,
 * `JobStatus`, and `JobClaimClient` (claimJob/renewLease/releaseJob over the
 * PB JSVM transactional CAS endpoints). This module does NOT re-define those.
 * Instead it layers the SEMANTIC contracts ON TOP:
 *
 *   - the per-SERVICE job PAYLOAD (a job = "run all of service X's d6 cells")
 *   - the per-service RESULT a worker reports and the control-plane aggregates
 *   - the pool COMM-ERROR taxonomy (REQ-B) — "couldn't reach the pool" as a
 *     DISTINCT class from "the test went red"
 *   - the WORKER DESCRIPTOR (registration + heartbeat) for self-register /
 *     fleet-health
 *   - the control-plane ↔ worker PROTOCOL (the queue-client interface S3
 *     implements over S0's JobClaimClient)
 *
 * Downstream import map (the fan-out brief):
 *   queue-client       (S3)  → FleetQueueClient, EnqueueJobInput, JobLease,
 *                              SweepResult, ReportJobInput
 *   control-plane prod (S4)  → ServiceJobPayload, EnqueueJobInput,
 *                              FleetQueueClient
 *   aggregator         (S5)  → ServiceJobResult, ServiceCellResult,
 *                              probeResultsForServiceJobResult, FleetStatusRow
 *   worker loop        (S7)  → ServiceJobPayload, ServiceJobResult,
 *                              ServiceCellResult, ReportJobInput, FleetQueueClient
 *   self-register      (S9)  → WorkerDescriptor, WorkerRegistration,
 *                              WorkerHeartbeat, WORKERS_COLLECTION
 *   fleet-health       (S10) → WorkerDescriptor, WorkerHealthState,
 *                              isWorkerStale
 *   dashboard comm-err (REQ-B) → PoolCommError, PoolCommErrorKind,
 *                              POOL_COMM_ERROR_KINDS, FleetStatusRow.commError,
 *                              commErrorToStatusSignal
 */

import type { BrowserPoolBudget } from "../probes/helpers/browser-pool.js";
import type { ProbeResult, ProbeState } from "../types/index.js";
import type { JobStatus, JobView } from "./job-claim.js";

// Re-export the S0 primitives so downstream slots can import the whole fleet
// contract surface from one module without reaching into job-claim.ts for the
// low-level row shape.
export type { JobStatus, JobView } from "./job-claim.js";

// ───────────────────────────────────────────────────────────────────────
// 1. JOB CONTRACT — the per-SERVICE job payload
// ───────────────────────────────────────────────────────────────────────

/**
 * The decided unit of fleet work: one job = "run all of service X's d6
 * cells". `probeKey` is the SAME `probe_key` carried on the `probe_jobs` row
 * (S0's `JobView.probe_key`) so the payload and the claim row are joinable by
 * a single key. The payload is what the control-plane WRITES when it enqueues
 * and what the worker READS after it wins the claim.
 */
export interface ServiceJobPayload {
  /**
   * The probe/service key this job runs — e.g. `"d6:langgraph-python"`. This
   * is the join key to S0's `JobView.probe_key`; the dashboard's status rows
   * are keyed `<dimension>:<slug>` (see status-writer's `deriveDimension`), so
   * `probeKey` for a d6 service job is `d6:<serviceSlug>`.
   */
  probeKey: string;
  /** The showcase service / integration slug, e.g. `"langgraph-python"`. */
  serviceSlug: string;
  /**
   * The driver kind that runs the cells. The producer currently stamps
   * `"e2e_d6"` (the per-service d6 unit), but the WORKER now routes by this
   * field through its `DriverRegistry` — so any registered kind (the live
   * kinds being e2e_d6 / e2e_demos / e2e_smoke) dispatches to the matching
   * driver, and an unregistered kind is reported as a
   * `worker-protocol-violation`. Kept a
   * `string` (not narrowed to the worker's `DriverKind` union) because this is
   * the WIRE boundary that receives whatever the producer serialized; the
   * runtime unknown-kind guard is the validation gate.
   */
  driverKind: string;
  /**
   * The cell / feature set to run for this service. When omitted/empty the
   * worker runs the service's FULL declared cell set (the default d6 fan-out);
   * when present it restricts the run to the listed feature ids (mirrors
   * `ProbeContext.featureTypes`). Per-service granularity is the decided unit,
   * so this is an OPTIONAL narrowing, not the primary partition.
   */
  cellIds?: string[];
  /**
   * Free-form driver inputs threaded to the d6 driver (timeouts, base URLs,
   * feature filters). Kept open (`Record<string, unknown>`) so the queue
   * payload never has to migrate when a driver gains a knob — the worker is
   * responsible for validating the subset it consumes.
   */
  driverInputs?: Record<string, unknown>;
  /** Run metadata for traceability across the control-plane → worker hop. */
  meta: ServiceJobMeta;
}

/** Run metadata attached to every enqueued job. */
export interface ServiceJobMeta {
  /**
   * Stable id for this logical run batch (one control-plane tick may enqueue
   * many per-service jobs under one runId) — lets the aggregator group the
   * per-service results back into a single dashboard sweep.
   */
  runId: string;
  /** Whether this run was operator-triggered vs. scheduled (cron). */
  triggered: boolean;
  /** ISO timestamp the control-plane enqueued the job. */
  enqueuedAt: string;
  /** Optional priority hint. Reserved; not currently consulted by claimNext. */
  priority?: number;
}

// ───────────────────────────────────────────────────────────────────────
// 2. RESULT CONTRACT — what a worker produces, what the control-plane
//    aggregates. The per-service rollup is computed IN the claiming worker.
// ───────────────────────────────────────────────────────────────────────

/**
 * One cell's outcome within a service job. Maps 1:1 onto a per-cell
 * `ProbeResult` side-row (the d6 driver already emits `d6:<slug>/<featureId>`
 * rows — see `types/index.ts` DIMENSIONS comment), so the aggregator can
 * re-hydrate the EXISTING status/probe_runs contract without inventing a new
 * row shape.
 */
export interface ServiceCellResult {
  /** Feature / cell id within the service, e.g. `"shared-state"`. */
  cellId: string;
  /**
   * The probe key for this cell's side-row, e.g. `"d6:langgraph-python/shared-state"`.
   * This is exactly the key the d6 driver side-emits today, so writing it back
   * through `status-writer` preserves the dashboard's per-cell badge lookup
   * (`keyFor("d6", slug, featureId)`).
   */
  cellKey: string;
  /** The cell's terminal state — reuses the harness-wide ProbeState enum. */
  state: ProbeState;
  /** The opaque signal blob the driver produced for this cell. */
  signal: unknown;
  /** ISO timestamp the cell was observed. */
  observedAt: string;
}

/**
 * The per-service rollup a worker reports. The worker computes the rollup
 * (pass/fail counts) from its cell results — the control-plane does NOT
 * recompute it, it only AGGREGATES across services into the dashboard sweep.
 * Shapes are chosen to map cleanly onto the EXISTING storage contract:
 *   - `rollup` → `ProbeRunSummary` ({ total, passed, failed }) for probe_runs
 *   - `aggregateState` + `aggregateKey` → the service's primary status row
 *   - `cells` → per-cell status side-rows via `probeResultsForServiceJobResult`
 */
export interface ServiceJobResult {
  /** The claim row id (S0 `JobView.id`) this result terminates. */
  jobId: string;
  /** Echoes the payload's probeKey (the d6 aggregate row key). */
  probeKey: string;
  /** The showcase service slug. */
  serviceSlug: string;
  /** Echoes the payload's runId so the aggregator can group by batch. */
  runId: string;
  /** The worker that produced this result (S0 `JobView.claimed_by`). */
  workerId: string;
  /**
   * The aggregate state for the service's PRIMARY status row. Computed by the
   * worker from `cells` (any red → red; all green → green; an internal error
   * → error). NOTE: a pool COMM-ERROR is NOT one of these — that surfaces via
   * `commError` below and never masquerades as a probe red.
   */
  aggregateState: ProbeState;
  /**
   * The aggregate (primary) status-row key — the d6 AGGREGATE row key
   * `d6:<slug>` (e.g. `"d6:langgraph-python"`) on BOTH paths. On the SUCCESS
   * path the worker emits the d6 aggregate under `d6:<slug>` (and the per-cell
   * rows under `d6:<slug>/<featureId>`); on the COMM-ERROR path
   * (`buildCommErrorResult`) there is no driver run, so the worker falls back to
   * the payload's `probeKey`, which is also the d6 aggregate key `d6:<slug>`.
   * Either way this is the key the dashboard reads for the integration-level
   * aggregate (and where a pool `PoolCommError` is mirrored — see
   * `decodeCellCommError` in the dashboard's `cell-model.ts`). There is NO
   * `e2e_d6:<slug>` row in the fleet path.
   */
  aggregateKey: string;
  /** The aggregate signal blob for the primary row. */
  aggregateSignal: unknown;
  /** Per-cell outcomes (one per d6 feature). */
  cells: ServiceCellResult[];
  /** Pass/fail rollup — maps directly onto `ProbeRunSummary`. */
  rollup: ServiceJobRollup;
  /** ISO timestamp the worker finished the job. */
  finishedAt: string;
  /**
   * Set ONLY when the control-plane (or the worker's own self-monitor) could
   * not complete the job because of a POOL COMMUNICATION failure rather than a
   * test result. When present, the dashboard renders "couldn't reach the pool"
   * distinctly from a probe red (REQ-B). A well-formed test result that simply
   * went red leaves this `undefined`.
   */
  commError?: PoolCommError;
}

/**
 * Pass/fail rollup. Its three fields match `ProbeRunSummary`'s required
 * `{ total, passed, failed }` exactly, so it maps straight onto a
 * `ProbeRunSummary` (which is the structural SUPERSET — it adds an optional
 * `services?` breakdown this rollup omits) via `runSummaryForServiceJobResult`.
 */
export interface ServiceJobRollup {
  total: number;
  passed: number;
  failed: number;
}

// ───────────────────────────────────────────────────────────────────────
// 3. [REQ-B] POOL COMM-ERROR TAXONOMY — control-plane ↔ worker/pool
//    COMMUNICATION failures, DISTINCT from a probe red.
// ───────────────────────────────────────────────────────────────────────

/**
 * The closed set of control-plane ↔ worker/pool COMMUNICATION failure kinds.
 * These describe "we couldn't reach / talk to / trust the pool member", which
 * is categorically different from "the probe ran and went red". The dashboard
 * (REQ-B slot) renders these distinctly so an operator never confuses a
 * fleet-plumbing outage with a real product regression.
 */
export const POOL_COMM_ERROR_KINDS = [
  /** Worker host/endpoint did not respond at all (connect refused, DNS, etc). */
  "worker-unreachable",
  /** A claim or lease CAS call failed at the transport layer (not a lost CAS). */
  "claim-comm-failure",
  /** The worker exceeded the protocol response deadline (hung, no crash). */
  "worker-protocol-timeout",
  /**
   * A known crash/loss on a specific job (stays red), reported by either of
   * two sources:
   *   1. the worker's OWN self-monitor observed an in-driver pool-infra
   *      crash mid-job and reported it directly, or
   *   2. the control-plane RESULT CONSUMER synthesized it for a row that
   *      went terminal but whose SEPARATE result write never landed
   *      (terminal-but-resultless past the consumer's grace window — the
   *      queue-client's bounded result-write retry was exhausted, so the
   *      result is lost; see queue-client `RESULT_WRITE_MAX_ATTEMPTS`).
   * A lease that merely expired with no terminal report is NEITHER source;
   * the sweep emits `worker-reclaimed-pending` for that.
   */
  "worker-crashed-mid-job",
  /** A report arrived but failed schema/shape validation (protocol mismatch). */
  "worker-protocol-violation",
  /**
   * A lease lapsed on a claimed/running row and the sweeper RE-QUEUED the job
   * (flipped it back to `pending`). The sweep boundary CANNOT tell a real
   * worker crash apart from an expected platform teardown (Railway scale-down /
   * redeploy SIGKILL with no graceful drain) — both leave an identical expired
   * lease. But either way the job is now BACK IN FLIGHT (re-queued to pending),
   * so this is NOT a terminal failure: the dashboard renders it as a neutral
   * "re-queued / pending" surface (gray), never the red "crashed/unreachable"
   * overlay. A genuine pool outage where no worker can pick the job up keeps
   * re-surfacing this kind and the cell stays gray (no green) — the honest
   * signal — instead of flapping red. The worker's OWN self-monitor still emits
   * `worker-crashed-mid-job` for an in-driver pool-infra crash it observed
   * directly (that one IS a known crash and stays red).
   */
  "worker-reclaimed-pending",
] as const;

/** A single pool communication-failure kind. */
export type PoolCommErrorKind = (typeof POOL_COMM_ERROR_KINDS)[number];

/** Type guard for a valid PoolCommErrorKind. */
export function isPoolCommErrorKind(
  value: string | undefined,
): value is PoolCommErrorKind {
  return (
    value !== undefined &&
    (POOL_COMM_ERROR_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A structured pool communication error. This is the type both the
 * control-plane (which DETECTS the failure) and the dashboard (which RENDERS
 * it) share.
 */
export interface PoolCommError {
  kind: PoolCommErrorKind;
  /** Human-readable detail for the dashboard tooltip / operator log. */
  message: string;
  /** The worker involved, when known (unreachable workers may be unknown). */
  workerId?: string;
  /** The job involved, when the failure is tied to a specific job. */
  jobId?: string;
  /** ISO timestamp the failure was observed. */
  observedAt: string;
}

// ───────────────────────────────────────────────────────────────────────
//    STATUS-SCHEMA SURFACING of the comm-error (where REQ-B renders)
// ───────────────────────────────────────────────────────────────────────

/**
 * The fleet introduces a NEW status presentation state — `"unreachable"` —
 * that lives ALONGSIDE the existing `State` ("green" | "red" | "degraded")
 * and the per-result `"error"`. It deliberately does NOT widen the persisted
 * `State` enum (that would force every state-machine consumer — alert engine,
 * transition detector, flap counter — to learn a new value). Instead a comm
 * error surfaces on the status row as a SEPARATE field:
 *
 *   - the row's `state` continues to carry the LAST-KNOWN probe colour (so the
 *     dashboard keeps showing the cell's last real result, dimmed), and
 *   - a new `commError` field (mirrored into the row signal under
 *     `__fleetCommError`) tells the dashboard to overlay the "couldn't reach
 *     the pool" treatment.
 *
 * `FleetSurfaceState` is the UNION the DASHBOARD computes for rendering — it is
 * a presentation type, NOT a persisted column. The derivation (see
 * `fleetSurfaceState`, mirrored by the dashboard's `cell-model.ts` surface
 * derivation) produces THREE outcomes:
 *   - `"unreachable"` — a directly-observed crash kind (worker-crashed-mid-job,
 *     worker-unreachable, ...) overlays the row: the red comm-error treatment.
 *   - `"pending"` — a `worker-reclaimed-pending` comm error on a GREEN row:
 *     the lease lapsed and the sweeper re-queued the job (routine teardown,
 *     not a known crash), so the surface is the NEUTRAL gray "re-queued /
 *     pending" treatment (see POOL_COMM_ERROR_KINDS). ANY non-green row —
 *     red, degraded, error, or an out-of-vocabulary runtime state — passes
 *     through — the neutral overlay must never mask a genuine failure.
 *   - otherwise the row's last-known probe colour (`state`).
 *
 * TWO DELIBERATE DIVERGENCES from the dashboard mirror (`cell-model.ts`):
 *
 *   1. PENDING-GATE VOCABULARY: this HARNESS derivation is green-ONLY
 *      because `ProbeState` has no no-data colour to route. The dashboard's
 *      derivation runs over its `ChipColor` vocabulary, whose `gray` is a
 *      dashboard-only no-data colour this side cannot represent — there, a
 *      reclaim on a green OR gray (non-regressed) cell becomes `"pending"`.
 *   2. RECENCY: this derivation has NO recency gate — a present `commError`
 *      always overlays, regardless of its `observedAt` age. The dashboard
 *      mirror staleness-gates comm errors (see `decodeCellCommError`'s
 *      per-row-family window) because nothing clears the mirrored signal
 *      blob on recovery and a stale overlay would pin cells "unreachable"
 *      forever. Harness-side that gate is deliberately ABSENT: consumers
 *      here receive rows the aggregator just wrote (the comm error is fresh
 *      by construction at the write site) — recency is the CALLER's concern
 *      when this is ever applied to read-back rows.
 *
 * The shared invariant both sides pin is the NEVER-MASK rule: red / degraded
 * (amber) / error / out-of-vocabulary states — and, dashboard-side, a
 * regression — always pass through; only healthy-or-no-data becomes pending.
 * The dashboard's commError-contract-drift.test.ts pins both derivations.
 */
export type FleetSurfaceState = ProbeState | "unreachable" | "pending";

/** Signal-blob key under which a comm error is mirrored onto a status row. */
export const FLEET_COMM_ERROR_SIGNAL_KEY = "__fleetCommError" as const;

/**
 * A dashboard-facing status row enriched with the optional comm-error overlay.
 * This is the read shape the aggregator produces and the dashboard consumes —
 * it is the EXISTING status row (`StatusRecord` fields the dashboard already
 * reads) plus the optional `commError`. The aggregator writes the underlying
 * row through the unchanged `status-writer` path; `commError` is carried in the
 * row's `signal` under `FLEET_COMM_ERROR_SIGNAL_KEY` and re-surfaced here.
 */
export interface FleetStatusRow {
  key: string;
  dimension: string;
  /** Last-known probe colour (unchanged persisted `State`). */
  state: ProbeState;
  signal: unknown;
  observedAt: string;
  /** Present iff the latest attempt failed to reach/trust the pool (REQ-B). */
  commError?: PoolCommError;
}

/**
 * Compute the dashboard's surface state from a row's colour + comm error.
 * The sweep-inferred `worker-reclaimed-pending` kind renders the NEUTRAL
 * `"pending"` surface (the job is re-queued / back in flight, not a known
 * crash) ONLY when the row's last-known probe colour is green (healthy).
 * ANY non-green state — red, degraded, error, or an out-of-vocabulary
 * runtime value — is a genuine failure the neutral overlay must NOT mask
 * (the A2 rank principle: an unrecognized state ranks ABOVE red, so it
 * passes through too), and passes through unchanged. Every other comm-error
 * kind is a directly-observed pool failure and renders the red
 * `"unreachable"` overlay; absent any comm error the row's last-known probe
 * colour passes through unchanged.
 *
 * The dashboard's `cell-model.ts` mirrors this derivation over its
 * `ChipColor` vocabulary with TWO deliberate differences (enumerated in the
 * `FleetSurfaceState` doc above): (1) its dashboard-only no-data `gray` ALSO
 * becomes `"pending"` — green-only here purely because `ProbeState` has no
 * no-data colour; and (2) the dashboard staleness-gates comm errors before
 * deriving, while this derivation has no recency gate (the aggregator-side
 * callers see freshly-written rows; recency is the caller's concern). The
 * never-mask rule is identical on both sides.
 */
export function fleetSurfaceState(row: FleetStatusRow): FleetSurfaceState {
  if (!row.commError) return row.state;
  if (row.commError.kind === "worker-reclaimed-pending") {
    return row.state === "green" ? "pending" : row.state;
  }
  return "unreachable";
}

/**
 * Map a `PoolCommError` into the partial status-row SIGNAL patch the
 * aggregator merges before writing through `status-writer`. The comm error
 * rides in the signal blob (not a new column) so the persisted `status`
 * collection schema is unchanged — the dashboard reads it back out by the
 * well-known `FLEET_COMM_ERROR_SIGNAL_KEY`. Pure; unit-tested.
 */
export function commErrorToStatusSignal(
  err: PoolCommError,
): Record<string, unknown> {
  return { [FLEET_COMM_ERROR_SIGNAL_KEY]: err };
}

/**
 * Inverse of `commErrorToStatusSignal`: extract a `PoolCommError` from a
 * status-row signal blob, or `undefined` when none is present / the embedded
 * value is malformed. Pure; unit-tested. The dashboard slot (REQ-B) uses this
 * to decide whether to render the "unreachable" overlay.
 *
 * VERSION-SKEW HAZARD: `undefined` conflates "no comm error was written" with
 * "the key IS present but the embedded value did not decode" — e.g. a NEW
 * `PoolCommErrorKind` rolled out write-side first, or a renamed required
 * field. A reader on the older vocabulary silently DROPS that REQ-B overlay
 * and renders the row's last-known probe colour as if the fleet were healthy.
 * The decode return type deliberately stays `PoolCommError | undefined`
 * (every render path branches on presence); consumers that need to SEE the
 * drop pair this with the `statusSignalHasCommErrorKey` companion below and
 * count/log when the key is present but the decode returned `undefined`.
 *
 * NOTE: the function source below is pinned BYTE-IDENTICAL against the
 * dashboard's structural copy (`shell-dashboard`'s `live-status.ts`) by
 * `commError-contract-drift.test.ts` — any edit to the function body must
 * land on both sides; this doc comment and the companion live OUTSIDE the
 * mirrored region.
 */
export function commErrorFromStatusSignal(
  signal: unknown,
): PoolCommError | undefined {
  // Array.isArray (BOTH levels): arrays are typeof "object", and an array
  // carrying the signal key (here) or comm-error fields (below) as expando
  // properties would otherwise decode as a well-formed PoolCommError — an
  // array is never a valid wire shape at either level.
  if (signal === null || typeof signal !== "object" || Array.isArray(signal)) {
    return undefined;
  }
  const raw = (signal as Record<string, unknown>)[FLEET_COMM_ERROR_SIGNAL_KEY];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const candidate = raw as Partial<PoolCommError>;
  if (
    !isPoolCommErrorKind(candidate.kind) ||
    typeof candidate.message !== "string" ||
    typeof candidate.observedAt !== "string"
  ) {
    return undefined;
  }
  const out: PoolCommError = {
    kind: candidate.kind,
    message: candidate.message,
    observedAt: candidate.observedAt,
  };
  if (typeof candidate.workerId === "string") out.workerId = candidate.workerId;
  if (typeof candidate.jobId === "string") out.jobId = candidate.jobId;
  return out;
}

/**
 * Companion to `commErrorFromStatusSignal`: does the signal blob CARRY the
 * well-known comm-error key at all, regardless of whether the embedded value
 * decodes? Lets consumers distinguish "key present but undecodable" (the
 * version-skew drop documented on the decode above — count/log it) from
 * "genuinely absent" (nothing to report) without changing the decode's return
 * contract. Mirrors the decoder's wire-shape guards: a null / non-object /
 * array blob is never a valid signal, so the key cannot be "present" on one.
 * Pure; unit-tested.
 */
export function statusSignalHasCommErrorKey(signal: unknown): boolean {
  if (signal === null || typeof signal !== "object" || Array.isArray(signal)) {
    return false;
  }
  return FLEET_COMM_ERROR_SIGNAL_KEY in signal;
}

// ───────────────────────────────────────────────────────────────────────
//    RESULT ↔ STORAGE mappers — preserve the EXISTING row shapes exactly.
// ───────────────────────────────────────────────────────────────────────

/**
 * Project a `ServiceJobResult` into the set of `ProbeResult`s the
 * `status-writer` already knows how to persist: ONE aggregate (primary) row +
 * one side row per cell. This is the bridge that lets the aggregator (S5)
 * write fleet results through the UNCHANGED status pipeline — the dashboard's
 * row shape is preserved exactly because we emit the same `<dimension>:<slug>`
 * and `d6:<slug>/<featureId>` keys the in-process d6 driver emits today. Pure;
 * unit-tested.
 */
export function probeResultsForServiceJobResult(
  result: ServiceJobResult,
): ProbeResult[] {
  const primary: ProbeResult = {
    key: result.aggregateKey,
    state: result.aggregateState,
    signal: result.aggregateSignal,
    observedAt: result.finishedAt,
  };
  const cells: ProbeResult[] = result.cells.map((c) => ({
    key: c.cellKey,
    state: c.state,
    signal: c.signal,
    observedAt: c.observedAt,
  }));
  return [primary, ...cells];
}

/**
 * Project a `ServiceJobResult`'s rollup into the `ProbeRunSummary` shape the
 * `run-history` writer persists onto `probe_runs`. Field names match
 * `ProbeRunSummary` ({ total, passed, failed }) so the aggregator passes the
 * return value straight to `runWriter.finish`/`update`. Pure; unit-tested.
 */
export function runSummaryForServiceJobResult(result: ServiceJobResult): {
  total: number;
  passed: number;
  failed: number;
} {
  return {
    total: result.rollup.total,
    passed: result.rollup.passed,
    failed: result.rollup.failed,
  };
}

// ───────────────────────────────────────────────────────────────────────
// 4. WORKER DESCRIPTOR / REGISTRATION CONTRACT
//    (self-register S9 + fleet-health S10)
// ───────────────────────────────────────────────────────────────────────

/**
 * Canonical PocketBase collection name for the fleet worker registry. The
 * `workers` collection itself is created by the self-register slot's migration
 * (`showcase/pocketbase/pb_migrations/<unix>_create_workers.js`); this constant
 * is the single source of truth for the name so a rename can't go half-applied
 * (same pattern as `PROBE_RUNS_COLLECTION` in run-history.ts).
 */
export const WORKERS_COLLECTION = "workers";

/** A worker's liveness state, derived by fleet-health from its heartbeat. */
export type WorkerHealthState = "online" | "stale" | "offline";

/**
 * Capacity the worker advertises at registration / on each heartbeat. This is
 * the `BrowserPool.budget()` snapshot (S6) — re-exported field-by-field rather
 * than referencing the class so the contract doesn't drag the pool
 * implementation into every consumer. Structurally compatible with
 * `BrowserPoolBudget` (see the type-level test).
 */
export interface WorkerCapacity {
  /** Live contexts currently checked out. */
  inUse: number;
  /** Remaining context capacity (never negative). */
  available: number;
  /** Global context cap. */
  max: number;
  /** cgroup pids.current, or -1 if unreadable. */
  pidsCurrent: number;
  /** cgroup pids.max ceiling, or -1 if unbounded/unreadable. */
  pidsMax: number;
}

/**
 * The self-registration payload a worker writes to the `workers` collection on
 * boot. `workerId` is the SAME id a worker passes to S0's
 * `claimJob(jobId, workerId, ...)` so the registry row and the claim's
 * `claimed_by` join on one value.
 */
export interface WorkerRegistration {
  /** Stable worker id (matches S0 `JobView.claimed_by`). */
  workerId: string;
  /** Worker's reachable endpoint (host:port) for control-plane probes. */
  endpoint: string;
  /** Capacity snapshot at registration time. */
  capacity: WorkerCapacity;
  /** ISO timestamp the worker registered. */
  registeredAt: string;
}

/**
 * The periodic heartbeat a worker writes to refresh its liveness + capacity.
 * fleet-health (S10) reads `lastHeartbeatAt` against a staleness window to
 * derive `WorkerHealthState`; a worker whose heartbeat lapses leaves its
 * leases to expire, which the sweep reclaims and surfaces as the neutral
 * `worker-reclaimed-pending` kind (see PoolCommErrorKind).
 */
export interface WorkerHeartbeat {
  workerId: string;
  /** Fresh capacity snapshot. */
  capacity: WorkerCapacity;
  /** Id of the job the worker is currently running, or null when idle. */
  currentJobId: string | null;
  /** ISO timestamp of this heartbeat. */
  lastHeartbeatAt: string;
}

/**
 * The full worker registry row as fleet-health reads it back — the union of
 * the registration fields and the latest heartbeat. Snake-case-free
 * (camelCase) because, like `ProbeRunRecord`, the read path returns camelCase
 * to consumers while storage stays snake_case at the PB column layer (the
 * self-register slot owns the row↔record mapping).
 */
export interface WorkerDescriptor {
  workerId: string;
  endpoint: string;
  capacity: WorkerCapacity;
  registeredAt: string;
  lastHeartbeatAt: string;
  currentJobId: string | null;
  /** Derived liveness (computed by fleet-health, not persisted raw). */
  health: WorkerHealthState;
}

/**
 * Anchor the PB space→"T" date-separator rewrite to the canonical PB shape
 * (`YYYY-MM-DD ` then time) so we ONLY convert the date/time boundary, never
 * an arbitrary first space. LOCAL REPLICA of the queue-client's exported
 * `PB_DATE_SEP_RE` (queue-client.ts) — replicated rather than imported because
 * the dependency points the other way (queue-client imports contracts), and
 * the anchoring contract is the same one the JSVM hook pins: a bare
 * `String.replace(" ", "T")` would coerce a malformed value into something
 * that parses instead of letting it fall through to NaN.
 */
const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;

/** Parse a heartbeat timestamp, normalizing the PB space-separated date form. */
function parseHeartbeatMs(lastHeartbeatAt: string): number {
  return Date.parse(String(lastHeartbeatAt).replace(PB_DATE_SEP_RE, "$1T"));
}

/**
 * Companion to `isWorkerStale`: is `lastHeartbeatAt` a parseable timestamp
 * (after the PB space→"T" normalization)? `isWorkerStale` deliberately maps an
 * unparseable heartbeat to `false` (never flap the fleet offline on one
 * malformed row), but that alone makes a CORRUPT heartbeat indistinguishable
 * from a FRESH one — "never stale forever" is silent fleet-health blindness.
 * fleet-health (S10) uses this to count/warn on unparseable heartbeat rows
 * while keeping the conservative not-yet-stale staleness answer. Pure;
 * unit-tested.
 */
export function heartbeatParseable(lastHeartbeatAt: string): boolean {
  return !Number.isNaN(parseHeartbeatMs(lastHeartbeatAt));
}

/**
 * Pure staleness check used by fleet-health (S10): a worker is stale when its
 * last heartbeat is older than `staleAfterMs`. The PB date form uses a space
 * separator; normalize ONLY the canonical date/time boundary to ISO "T"
 * before parsing (anchored exactly as the queue-client's lease parse) so the
 * answer doesn't ride on engine-specific `Date.parse` leniency. Returns false
 * when the timestamp is unparseable (treat unknown as not-yet-stale; the next
 * heartbeat resolves it) so a malformed row can't flap the whole fleet to
 * offline — callers that need to SEE the corruption use the
 * `heartbeatParseable` companion. Pure; unit-tested.
 */
export function isWorkerStale(
  lastHeartbeatAt: string,
  nowMs: number,
  staleAfterMs: number,
): boolean {
  const beatMs = parseHeartbeatMs(lastHeartbeatAt);
  if (Number.isNaN(beatMs)) return false;
  return nowMs - beatMs > staleAfterMs;
}

/** Derive a worker's liveness from its heartbeat age. */
export function deriveHealth(
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

/**
 * Build a `WorkerCapacity` from a `BrowserPoolBudget` (S6). Thin, explicit
 * field copy so the registration/heartbeat path never accidentally widens with
 * pool-internal fields. `available` is CLAMPED at 0: the capacity contract
 * documents it "never negative", and a racy/mid-teardown pool snapshot can
 * transiently compute a negative remainder — the mapper enforces the
 * invariant rather than leak the racy value to registry/heartbeat consumers.
 * Pure; unit-tested.
 */
export function workerCapacityFromBudget(
  budget: BrowserPoolBudget,
): WorkerCapacity {
  return {
    inUse: budget.inUse,
    available: Math.max(0, budget.available),
    max: budget.max,
    pidsCurrent: budget.pidsCurrent,
    pidsMax: budget.pidsMax,
  };
}

// ───────────────────────────────────────────────────────────────────────
// 5. CONTROL-PLANE ↔ WORKER PROTOCOL — the queue-client interface S3
//    implements on top of S0's JobClaimClient.
// ───────────────────────────────────────────────────────────────────────

/** Input the control-plane (S4) passes to enqueue one per-service job. */
export interface EnqueueJobInput {
  /** The per-service payload to run. */
  payload: ServiceJobPayload;
  /**
   * The producing family's id — a `FLEET_FAMILIES[*].family` value from the
   * §5.1 registry (`control-plane/run-view.ts`), stamped by the producer's
   * `JobProducerOptions.family` onto every input it builds. The queue-client
   * denormalizes it into the `probe_jobs.family` column for indexed per-family
   * listing; absent → column written empty (pre-P2 row parity).
   */
  family?: string;
}

/** A lease handle a worker holds while running a claimed job. */
export interface JobLease {
  /** The claimed job row (S0 `JobView`). */
  job: JobView;
  /** The decoded per-service payload for that job. */
  payload: ServiceJobPayload;
  /** ISO timestamp the lease currently expires (from the row). */
  leaseExpiresAt: string | null;
}

/** Result of a worker's claim attempt — `lease` is undefined when none was won. */
export interface ClaimedJob {
  /** True when this worker won an available job. */
  claimed: boolean;
  /** Present iff `claimed` is true. */
  lease?: JobLease;
}

/**
 * Input a worker passes to report a finished job back to the control-plane.
 *
 * EQUALITY INVARIANT: `jobId === result.jobId` and
 * `workerId === result.workerId`. The top-level fields are the claim-row
 * coordinates the queue's release path keys on; `result` echoes them so the
 * aggregator can group results without re-joining the claim row. The
 * duplication is deliberate (release and aggregation read different halves
 * of this input) but the values MUST be equal.
 *
 * INTEGRATOR NOTE: the queue-client's `report()` ENFORCES this equality — it
 * rejects (throws) on a mismatched input before touching the queue, so a
 * mismatched caller can no longer release one row while filing the result
 * under another job's/worker's ids. Callers should still construct the input
 * correctly, but the queue-client is the enforcement point.
 */
export interface ReportJobInput {
  /** The claim row id being terminated (S0 `JobView.id`). Must equal `result.jobId`. */
  jobId: string;
  /** The reporting worker (S0 `JobView.claimed_by`). Must equal `result.workerId`. */
  workerId: string;
  /** The per-service result, OR a comm-error-only terminal report. */
  result: ServiceJobResult;
}

/** Per-leg deletion counts from one `FleetQueueClient.pruneAged` pass. */
export interface PruneAgedResult {
  /** Terminal (`done`/`failed`) rows deleted (older than terminalMaxAgeMs). */
  terminal: number;
  /** Non-terminal zombie rows deleted (older than zombieMaxAgeMs). */
  zombie: number;
}

/** Outcome of sweeping expired leases (dead-worker reclamation). */
export interface SweepResult {
  /** Number of expired leases reclaimed (jobs re-queued to pending). */
  reclaimed: number;
  /**
   * The `worker-reclaimed-pending` comm errors synthesized by the sweep —
   * one per reclaimed job AND one per thrown-release indeterminate row.
   * FOR IMPLEMENTATIONS THAT REPORT THE SPLIT (the real queue-client always
   * does), `commErrors.length === reclaimed + reclaimedIndeterminate` and
   * the queue-client pairs them 1:1 with the rows those counters document.
   * A fake that synthesizes comm errors without reporting
   * `reclaimedIndeterminate` (the field is optional below) is not bound by
   * the pairing — assert it against the concrete client, not the shared type.
   */
  commErrors: PoolCommError[];
  /**
   * Of the sweep's reclaim attempts, the thrown-release conservative maybes
   * (release transport failed AFTER the CAS may have committed — the
   * at-least-once over-report slice; see queue-client
   * `SweepResultWithIndeterminate`). Optional so sweep fakes keyed on the
   * reclamation contract stay valid; the real queue-client always reports it
   * (required there).
   */
  reclaimedIndeterminate?: number;
  /**
   * Number of STALE PENDING jobs expired (claimed-then-deleted) because they
   * sat unclaimed longer than their family's expiry window — the structural
   * backlog drain (see queue-client `stalePending`). Despite the name, the
   * LEASE phase's long-expired carve-out ALSO counts here: a CLAIMED/RUNNING
   * row whose created-age exceeds the same family stale window and whose
   * lease is long-expired (or unparseable) is claim-DELETED — not re-queued,
   * no comm error, no `reclaimed` increment — into this count. See the
   * queue-client's sweep-lease-stale-deleted path. Optional so the many
   * sweep fakes keyed on the reclamation contract stay valid; the real
   * queue-client always reports it.
   */
  expiredPending?: number;
}

/**
 * The control-plane ↔ worker QUEUE protocol. S3 (queue-client) IMPLEMENTS this
 * on top of S0's `JobClaimClient`:
 *   - `enqueue` writes a `probe_jobs` row (status `pending`) carrying the
 *     serialized `ServiceJobPayload`.
 *   - `claimNext` finds a claimable job and runs S0's `claimJob` CAS, returning
 *     a `JobLease` to the worker on a win (the exactly-one-winner guarantee
 *     comes from S0).
 *   - `renewLease` / `report` delegate to S0's `renewLease` / `releaseJob`.
 *   - `sweepExpired` reclaims expired leases (re-queues the jobs to pending)
 *     and emits the neutral `worker-reclaimed-pending` comm errors (REQ-B)
 *     the dashboard renders as a gray "re-queued" surface.
 *
 * Producers (control-plane S4) use `enqueue` + `sweepExpired`; consumers
 * (worker loop S7) use `claimNext` + `renewLease` + `report`.
 */
export interface FleetQueueClient {
  /** Producer: enqueue one per-service job (writes a pending probe_jobs row). */
  enqueue(input: EnqueueJobInput): Promise<JobView>;
  /**
   * Consumer: attempt to claim the next available job for `workerId`. Returns
   * `{ claimed: false }` when nothing was won (no work, or lost the CAS to a
   * peer — the exactly-one-winner semantics are S0's).
   */
  claimNext(workerId: string, leaseSeconds: number): Promise<ClaimedJob>;
  /** Consumer: extend the lease on a held job (delegates to S0 renewLease). */
  renewLease(
    jobId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<JobLease | null>;
  /**
   * Consumer: report a terminal result for a held job (delegates to S0
   * releaseJob with the mapped `done`/`failed` status, and persists the
   * per-service result for the aggregator).
   */
  report(input: ReportJobInput): Promise<void>;
  /** Producer: reclaim expired leases from crashed/unreachable workers. */
  sweepExpired(nowMs: number): Promise<SweepResult>;
  /**
   * Producer: how many of `family`'s jobs are NON-TERMINAL (pending, claimed,
   * or running). The producer's per-tick backlog gate: a scheduled tick must
   * NOT enqueue a fresh batch for a family whose previous batch is still in
   * flight — either sitting unclaimed (the compounding-backlog half of the
   * e2e-demos starvation — see `probeKeyFamily`) or claimed/running (where a
   * fresh batch would double the family's concurrent runs). Only terminal
   * rows (done/failed) stop gating. (Name kept for history: "pending" here
   * means "not yet finished", not the `pending` status.)
   */
  countPendingForFamily(family: string): Promise<number>;
  /** §4.2 retention: delete terminal rows older than terminalMaxAgeMs and
   *  non-terminal (zombie) rows older than zombieMaxAgeMs, both by `created`.
   *  Idempotent; single-owner by producer-side family gate. */
  pruneAged(nowMs: number): Promise<PruneAgedResult>;
}

/**
 * Map a `ServiceJobResult`'s aggregate state onto the terminal `JobStatus` the
 * worker passes to S0's `releaseJob`. A comm error or any non-green aggregate
 * is `"failed"`; an all-green result is `"done"`. (S0's `releaseJob` accepts
 * `"done" | "failed" | "pending"`; this helper only ever returns the two
 * terminal values — re-queue is the sweeper's job, not the reporter's.) Pure;
 * unit-tested.
 */
export function terminalJobStatus(
  result: ServiceJobResult,
): Extract<JobStatus, "done" | "failed"> {
  if (result.commError) return "failed";
  return result.aggregateState === "green" ? "done" : "failed";
}

/**
 * Extract a probe_key's FAMILY — the prefix before the first ":" (the whole
 * key when no ":" is present). The family is the probe-family partition the
 * producers enqueue per schedule (`d6:<slug>` → `d6`, `d4:<slug>` → `d4`,
 * `e2e-demos:<slug>` → `e2e-demos`, ...). It is the FAIRNESS unit of the
 * queue: `claimNext` round-robins claims across the distinct families present
 * in pending so a high-frequency family's backlog can never starve a
 * low-frequency family's jobs out of the candidate page, and the producer's
 * backlog dedupe gates each tick on its own family's pending count. Pure;
 * unit-tested via the queue-client + producer suites.
 *
 * INVARIANT — WHOLE-KEY FAMILIES MATCH BY EQUALITY ONLY. A leading-colon key
 * (`":foo:bar"`, the `idx <= 0` branch below) is its OWN family: the WHOLE
 * key. Such a family value itself contains colons, so expanding it with a
 * prefix-LIKE pattern of the shape `<family>:%` is WRONG: family `":foo"`
 * (from key `":foo"`) would prefix-match the unrelated key `":foo:bar"`,
 * whose own family is the whole `":foo:bar"` — the inclusion/exclusion and
 * pending-count legs would then disagree with this function's partition.
 * Consumers that build key-matching filters from a family (the queue-client's
 * `familyInclusionClause` / `familyExclusionClause`) MUST special-case any
 * family containing a colon (equivalently: starting with `:`) to the equality
 * leg only — never the `<family>:%` LIKE leg, which is reserved for normal
 * prefix families that cannot contain a colon by construction.
 */
export function probeKeyFamily(probeKey: string): string {
  const idx = probeKey.indexOf(":");
  // idx <= 0: a leading-colon key has NO family prefix — treat the whole key
  // as its own family rather than letting the empty string flow into
  // countPendingForFamily / the fairness partition as a phantom bucket.
  return idx <= 0 ? probeKey : probeKey.slice(0, idx);
}
