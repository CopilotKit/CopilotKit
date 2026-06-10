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
   * The worker's OWN self-monitor observed an in-driver pool-infra crash
   * mid-job and reported it directly (a known crash — stays red). A lease
   * that merely expired with no terminal report is NOT this kind; the sweep
   * emits `worker-reclaimed-pending` for that.
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
 *   - `"pending"` — a `worker-reclaimed-pending` comm error on a NON-red row:
 *     the lease lapsed and the sweeper re-queued the job (routine teardown,
 *     not a known crash), so the surface is the NEUTRAL gray "re-queued /
 *     pending" treatment (see POOL_COMM_ERROR_KINDS). A red row passes
 *     through — the neutral overlay must never mask a genuine failure.
 *   - otherwise the row's last-known probe colour (`state`).
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
 * Mirrors the dashboard's `cell-model.ts` derivation exactly: the
 * sweep-inferred `worker-reclaimed-pending` kind renders the NEUTRAL
 * `"pending"` surface (the job is re-queued / back in flight, not a known
 * crash) UNLESS the row's own probe colour is red — a present red is a
 * genuine failure the neutral overlay must NOT mask, so it passes through.
 * Every other comm-error kind is a directly-observed pool failure and
 * renders the red `"unreachable"` overlay; no comm error passes the row's
 * last-known probe colour through unchanged.
 */
export function fleetSurfaceState(row: FleetStatusRow): FleetSurfaceState {
  if (!row.commError) return row.state;
  if (row.commError.kind === "worker-reclaimed-pending") {
    return row.state === "red" ? row.state : "pending";
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
 */
export function commErrorFromStatusSignal(
  signal: unknown,
): PoolCommError | undefined {
  if (signal === null || typeof signal !== "object") return undefined;
  const raw = (signal as Record<string, unknown>)[FLEET_COMM_ERROR_SIGNAL_KEY];
  if (raw === null || typeof raw !== "object") return undefined;
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
 * Pure staleness check used by fleet-health (S10): a worker is stale when its
 * last heartbeat is older than `staleAfterMs`. Returns false when the
 * timestamp is unparseable (treat unknown as not-yet-stale; the next heartbeat
 * resolves it) so a malformed row can't flap the whole fleet to offline. Pure;
 * unit-tested.
 */
export function isWorkerStale(
  lastHeartbeatAt: string,
  nowMs: number,
  staleAfterMs: number,
): boolean {
  const beatMs = Date.parse(lastHeartbeatAt);
  if (Number.isNaN(beatMs)) return false;
  return nowMs - beatMs > staleAfterMs;
}

/**
 * Build a `WorkerCapacity` from a `BrowserPoolBudget` (S6). Thin, explicit
 * field copy so the registration/heartbeat path never accidentally widens with
 * pool-internal fields. Pure; unit-tested.
 */
export function workerCapacityFromBudget(
  budget: BrowserPoolBudget,
): WorkerCapacity {
  return {
    inUse: budget.inUse,
    available: budget.available,
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

/** Input a worker passes to report a finished job back to the control-plane. */
export interface ReportJobInput {
  /** The claim row id being terminated (S0 `JobView.id`). */
  jobId: string;
  /** The reporting worker (S0 `JobView.claimed_by`). */
  workerId: string;
  /** The per-service result, OR a comm-error-only terminal report. */
  result: ServiceJobResult;
}

/** Outcome of sweeping expired leases (dead-worker reclamation). */
export interface SweepResult {
  /** Number of expired leases reclaimed (jobs re-queued to pending). */
  reclaimed: number;
  /** The `worker-reclaimed-pending` comm errors synthesized per reclaimed job. */
  commErrors: PoolCommError[];
  /**
   * Number of STALE PENDING jobs expired (claimed-then-deleted) because they
   * sat unclaimed longer than their family's expiry window — the structural
   * backlog drain (see queue-client `stalePending`). Optional so the many
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
   * Producer: how many of `family`'s jobs are pending (unclaimed). The
   * producer's per-tick backlog gate: a scheduled tick must NOT enqueue a
   * fresh batch for a family whose previous batch is still sitting unclaimed
   * (the compounding-backlog half of the e2e-demos starvation — see
   * `probeKeyFamily`). Claimed/running/terminal rows do NOT count: a batch
   * being actively worked is not a backlog.
   */
  countPendingForFamily(family: string): Promise<number>;
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
 */
export function probeKeyFamily(probeKey: string): string {
  const idx = probeKey.indexOf(":");
  // idx <= 0: a leading-colon key has NO family prefix — treat the whole key
  // as its own family rather than letting the empty string flow into
  // countPendingForFamily / the fairness partition as a phantom bucket.
  return idx <= 0 ? probeKey : probeKey.slice(0, idx);
}
