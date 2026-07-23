/**
 * Run-view PROJECTIONS (spec §5.1 + §5.2.1) — the pure projection layer over
 * `probe_jobs` / `probe_runs` / `workers` that the fleet-runs HTTP routes
 * (T7), the orchestrator wiring (T8), and the family-silence monitor (T9)
 * all consume. This module owns:
 *
 *   - `FLEET_FAMILIES` — the single source of truth joining family id →
 *     producer schedule id → probe-key prefix (§5.1). Deliberately NO cron
 *     literals: cron resolution is RUNTIME, by `scheduleId` lookup in the
 *     injected `ProducerSchedule[]` (the same `buildProducerSchedules`
 *     output handed to `createControlPlane`), so the `FLEET_PRODUCER_CRON`
 *     env override is honored everywhere a period-derived threshold exists.
 *   - the §5.2.1 run/worker projections (outcome precedence, stalled rules,
 *     walk-back, redaction) as pure, unit-tested functions.
 *   - `createMemoizedFamilySummary` — the ~5 s-TTL whole-body memo of the
 *     family summary (§5.2 abuse bound). Homed HERE, not in the route
 *     module, so `runControlPlane` constructs ONE instance and injects it
 *     into both the fleet-runs routes and the §9 family-silence monitor —
 *     "the monitor shares the route's memo" is true by construction.
 *
 * Read paths only — this module never writes a row.
 */

import { Cron } from "croner";
import type { Logger } from "../../types/index.js";
import type { Scheduler } from "../../scheduler/scheduler.js";
import type { PbClient } from "../../storage/pb-client.js";
import type { JobStatus } from "../job-claim.js";
import type {
  ServiceJobMeta,
  ServiceJobRollup,
  WorkerHealthState,
} from "../contracts.js";
import {
  WORKERS_COLLECTION,
  deriveHealth,
  isPoolCommErrorKind,
} from "../contracts.js";
import { PROBE_JOBS_COLLECTION } from "../queue-client.js";
import { PROBE_RUNS_COLLECTION } from "../../probes/run-history.js";
import type { ProbeRunSummary } from "../../probes/run-history.js";
// Import the schedule ids from the cycle-free LEAF module — NOT from
// `control-plane.js`. The top-level `FLEET_FAMILIES` literal below reads these
// at MODULE-EVAL time; `control-plane.ts` sits inside the
// control-plane → job-producer → run-view → control-plane cycle, so importing
// the ids from it left them in the TDZ under one cycle load order (the harness
// crash-looped on boot). The leaf has no edges back into the cycle, so the ids
// are always fully initialized before this literal evaluates.
import {
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_SCHEDULE_ID,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
} from "./schedule-ids.js";
import type { ProducerSchedule } from "./control-plane.js";

// ───────────────────────────────────────────────────────────────────────
// §5.1 family registry
// ───────────────────────────────────────────────────────────────────────

/**
 * Family id → producer schedule id → probe-key prefix (§5.1). The drift-lock
 * test asserts the scheduleIds are set-equal to `buildProducerSchedules(...)`
 * ids so a new producer can't ship invisible and a renamed schedule can't
 * orphan a family. `probeKeyPrefix` is echoed onto every §5.2.1 entry so the
 * dashboard maps matrix cell keys to families purely from the payload.
 */
export const FLEET_FAMILIES = [
  {
    family: "d6",
    label: "D6 all-pills",
    scheduleId: FLEET_PRODUCER_SCHEDULE_ID,
    probeKeyPrefix: "d6",
  },
  {
    family: "d5",
    label: "D5 e2e-deep",
    scheduleId: FLEET_PRODUCER_DEEP_SCHEDULE_ID,
    probeKeyPrefix: "d5-single-pill-e2e",
  },
  {
    family: "e2e-demos",
    label: "E2E demos",
    scheduleId: FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
    probeKeyPrefix: "e2e-demos",
  },
  {
    family: "e2e-smoke",
    label: "E2E smoke",
    scheduleId: FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
    probeKeyPrefix: "d4",
  },
] as const; // NO cron literals — resolution is runtime via injected schedules (§5.1)

/** One FLEET_FAMILIES member. */
export type FleetFamily = (typeof FLEET_FAMILIES)[number];

/**
 * Single-owner family id for §4.2 retention pruning. Four producers share the
 * sweep-gate pattern; exactly one of them owns the family-agnostic delete
 * pass. This is sourced from the §5.1 registry (NOT a hardcoded string
 * literal) so a registry rename of the D6 entry can't silently disable
 * retention pruning. See `job-producer.ts` `sweepIfDue()` for the gate.
 */
export const PRUNE_OWNER_FAMILY = FLEET_FAMILIES[0].family;

// ───────────────────────────────────────────────────────────────────────
// Row shapes (snake_case, as the PB records API returns them)
// ───────────────────────────────────────────────────────────────────────

/**
 * The `probe_jobs` row fields the run-view projections read. Additive
 * run-metadata columns (migration 1779990200) are optional — pre-P2 rows
 * lack them (`family` empty → invisible to the new API; `reclaim_count`
 * absent → 0).
 */
export interface ProbeJobRecord {
  id: string;
  probe_key: string;
  status: JobStatus;
  claimed_by: string;
  payload?: unknown;
  result?: unknown;
  run_id?: string;
  family?: string;
  claimed_at?: string;
  finished_at?: string;
  reclaim_count?: number;
  /** PB system columns. `created` ≈ enqueue time; `updated` bumps on every CAS. */
  created: string;
  updated: string;
}

/** The `workers` row fields the worker projection reads (snake_case). */
export interface WorkerRow {
  worker_id: string;
  /** Routable internal URL — read for nothing, NEVER serialized (§5.2.1). */
  endpoint?: string;
  capacity_in_use?: number;
  capacity_available?: number;
  capacity_max?: number;
  current_job_id?: string;
  last_heartbeat_at?: string;
  /**
   * ISO instant the worker last (re)registered — seeded on every worker boot
   * upsert (worker/registration.ts) and preserved verbatim across heartbeats.
   * The freshest value across the strip is the fleet's most-recent BOUNCE
   * instant (PR #5715: an image rebuild bounces the pool workers), which the
   * §7.4 banner / §9 silence monitor key their post-bounce drain grace off.
   */
  registered_at?: string;
}

/** The `probe_runs` row fields the reds read path consumes (§4.2). */
interface ProbeRunRedsRow {
  id: string;
  job_id?: string;
  summary?: ProbeRunSummary | null;
}

// ───────────────────────────────────────────────────────────────────────
// DTOs — mirror the §5.2.1 JSON exactly (fields + null semantics)
// ───────────────────────────────────────────────────────────────────────

/** §5.2.1 precedence-derived outcome — exactly three values, pinned order. */
export type RunOutcome = "stalled" | "failed" | "completed";

/**
 * One run batch (jobs grouped by `run_id`) — the §5.2.1 `lastRun` shape and
 * each §5.2.2 history item. `redsIntroduced`/`redsCleared` are null until the
 * caller joins them from `probe_runs` (and null on pre-P2 history).
 */
export interface RunBatch {
  runId: string;
  triggered: boolean;
  /** min(enqueuedAt) across the batch (ISO). */
  enqueuedAt: string;
  /** max(finished_at); null while any job is non-terminal. */
  finishedAt: string | null;
  /** max(finished_at) − min(enqueuedAt); null while finishedAt is null. */
  durationMs: number | null;
  outcome: RunOutcome;
  jobs: { total: number; done: number; failed: number; reclaimed: number };
  /** Summed job rollups; null when no job carries a result. */
  cells: { total: number; passed: number; failed: number } | null;
  redsIntroduced: number | null;
  redsCleared: number | null;
  /** Closed-vocabulary only (§5.2.1 redaction) — never commError.message. */
  errorSummary: string | null;
  /** Deduped, isPoolCommErrorKind-validated kinds; unrecognized → "unknown". */
  commErrorKinds: string[];
  /** §5.2.2 degenerate-clamp marker — set by the history route, never here. */
  truncated?: boolean;
}

/** §5.2.1 `inflight` — the NEWEST run_id group only, when non-terminal. */
export interface InflightState {
  runId: string;
  triggered: boolean;
  enqueuedAt: string;
  elapsedMs: number;
  /** §5.2.1 rules (a)/(c): 2x-period no-progress or 4x-period absolute age. */
  stalled: boolean;
  jobs: {
    pending: number;
    claimed: number;
    running: number;
    done: number;
    failed: number;
  };
}

/** §5.2.1 workers strip entry. The `endpoint` column is never serialized. */
export interface WorkerView {
  workerId: string;
  health: WorkerHealthState;
  lastHeartbeatAt: string;
  /**
   * ISO instant the worker last (re)registered (`registered_at`), or "" when
   * the column is absent (pre-migration / never-registered row). The freshest
   * non-empty value across the strip is the fleet's most-recent bounce instant
   * — the §7.4 banner / §9 silence monitor use it to grace a post-deploy drain
   * (workers just restarted, families legitimately mid-sweep) instead of
   * flagging false silence. A non-secret identifier timestamp, same exposure
   * carve-out as `lastHeartbeatAt`.
   */
  registeredAt: string;
  currentJobId: string | null;
  capacity: { inUse: number; available: number; max: number };
}

/**
 * One `/api/runs` family entry. On a per-family PB failure the entry carries
 * `error: "history_unavailable"` IN PLACE OF the computed fields (§5.2.1
 * graceful degradation — HTTP-200 posture, never a 500), hence everything
 * past the registry echo is optional.
 */
export interface FamilySummaryEntry {
  family: string;
  label: string;
  probeKeyPrefix: string;
  error?: "history_unavailable";
  /** Display only (§6.2 humanizeCron) — NEVER threshold math; use periodMs. */
  schedule?: string;
  /** Server-computed shortest gap between consecutive fires of the resolved cron. */
  periodMs?: number;
  nextRunAt?: string | null;
  lastRun?: RunBatch | null;
  inflight?: InflightState | null;
  /**
   * Finish of the newest "terminal completion" batch within the capped
   * walk-back, or null (no terminal completion in window / never succeeded /
   * fresh env). A batch counts as a terminal completion when EVERY job
   * reached a terminal state (done | failed) AND no job carries a
   * `result.commError` — i.e. the worker reached the pool, ran the probe,
   * and returned a result, even if cells were red. Cell-level failures (the
   * §5.2.1 outcome=="failed" via rollup.failed > 0) do NOT block this
   * timestamp: chronic content reds with healthy workers must not fool the
   * §7.4 silence banner / §9 silence monitor into reporting "no successful
   * run since Xh ago". Null consumers (§7.3 glyph, §7.4 banner, §9 alert)
   * still fall back to the OLDEST known batch's enqueuedAt as the staleness
   * reference; with zero batches at all they stay silent (§5.2.1 null
   * semantics).
   */
  lastSuccessAt?: string | null;
}

/** GET /api/runs body (§5.2.1). */
export interface FamilySummaryResponse {
  families: FamilySummaryEntry[];
  workers: WorkerView[];
}

// ───────────────────────────────────────────────────────────────────────
// Deps
// ───────────────────────────────────────────────────────────────────────

export interface RunViewDeps {
  pb: PbClient;
  scheduler: Pick<Scheduler, "nextRunAt">;
  /** The `buildProducerSchedules` output — the resolved-cron source (§5.1). */
  schedules: readonly ProducerSchedule[];
  /** Boot-resolved heartbeat window — never the DEFAULT_ constant (§5.2). */
  workerStaleAfterMs: number;
  logger: Logger;
  now?: () => number;
}

// ───────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────

/** §5.2.2 capped fetch loop page size (PB perPage). */
export const RUN_FETCH_PAGE_SIZE = 200;
/** §5.2.2 hard cap on PB pages per fetch loop (3 × 200 = 600 rows). */
export const RUN_FETCH_MAX_PAGES = 3;

/** §5.2.1 inflight rule (a) floor: 2 × period, floor 30 min. */
const STALL_PROGRESS_FLOOR_MS = 30 * 60_000;
/** §5.2.1 inflight rule (c) floor: 4 × period, floor 60 min. */
const STALL_ABSOLUTE_FLOOR_MS = 60 * 60_000;

/** Whole-body memo TTL (§5.2): bounded staleness below the ~10 s poll cadence. */
const DEFAULT_SUMMARY_TTL_MS = 5_000;

/**
 * Anchored PB space→"T" date-separator rewrite — byte-for-byte the same
 * anchor as queue-client's `leaseExpired` / the JSVM hook, so we only
 * convert the canonical date/time boundary, never an arbitrary first space.
 */
const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;

/** Parse a PB/ISO timestamp to epoch ms; NaN on absent/unparseable. */
function parsePbDate(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(String(value).replace(PB_DATE_SEP_RE, "$1T"));
}

const TERMINAL_STATUSES = new Set<JobStatus>(["done", "failed"]);

function isTerminal(row: ProbeJobRecord): boolean {
  return TERMINAL_STATUSES.has(row.status);
}

/** Minimal defensive view of a row's `payload` JSON (untrusted column). */
function payloadMeta(row: ProbeJobRecord): Partial<ServiceJobMeta> | null {
  const payload = row.payload;
  if (payload === null || typeof payload !== "object") return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Partial<ServiceJobMeta>;
}

/** Minimal defensive view of a row's `result` JSON (untrusted column). */
function resultView(row: ProbeJobRecord): {
  rollup: ServiceJobRollup | null;
  commErrorKind: string | undefined;
} {
  const result = row.result;
  if (result === null || typeof result !== "object") {
    return { rollup: null, commErrorKind: undefined };
  }
  const candidate = result as {
    rollup?: unknown;
    commError?: unknown;
  };
  let rollup: ServiceJobRollup | null = null;
  if (candidate.rollup !== null && typeof candidate.rollup === "object") {
    const r = candidate.rollup as Partial<ServiceJobRollup>;
    if (
      typeof r.total === "number" &&
      typeof r.passed === "number" &&
      typeof r.failed === "number"
    ) {
      rollup = { total: r.total, passed: r.passed, failed: r.failed };
    }
  }
  let commErrorKind: string | undefined;
  if (candidate.commError !== null && typeof candidate.commError === "object") {
    const kind = (candidate.commError as { kind?: unknown }).kind;
    if (typeof kind === "string") commErrorKind = kind;
  }
  return { rollup, commErrorKind };
}

/**
 * A job's enqueue time (§5.2.1 sourcing): `payload.meta.enqueuedAt`, falling
 * back to the row's `created` column when absent/unparseable. Both are
 * stamped once and renewal-immune, so the rule-(c) absolute-age cap stays
 * renewal-immune under the fallback.
 */
function enqueuedAtMs(row: ProbeJobRecord): number {
  const meta = payloadMeta(row);
  const fromMeta = parsePbDate(
    typeof meta?.enqueuedAt === "string" ? meta.enqueuedAt : undefined,
  );
  if (!Number.isNaN(fromMeta)) return fromMeta;
  return parsePbDate(row.created);
}

function minEnqueuedAtMs(rows: readonly ProbeJobRecord[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const t = enqueuedAtMs(row);
    if (!Number.isNaN(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? min : Number.NaN;
}

// ───────────────────────────────────────────────────────────────────────
// Projections (pure)
// ───────────────────────────────────────────────────────────────────────

/**
 * Shortest interval between consecutive fires of `cron` (e.g.
 * `"40 * * * *"` → 3 600 000): croner walk over the next ~8 fires.
 * Every period-derived threshold (§5.2.1 stalled rules, §7.3/§7.4 windows,
 * §9 silence window) consumes this server-computed value — the dashboard
 * does no client-side cron parsing for thresholds.
 */
export function periodMsFromCron(cron: string): number {
  const job = new Cron(cron);
  const fires = job.nextRuns(9);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < fires.length; i++) {
    const gap = fires[i].getTime() - fires[i - 1].getTime();
    if (gap > 0 && gap < min) min = gap;
  }
  return Number.isFinite(min) ? min : 0;
}

/** A composite `(created, id)` cursor (§5.2.2). `beforeId` optional only for
 *  the legacy/manual bare-`before` degrade — the dashboard always echoes both. */
export interface FamilyJobCursor {
  before: string;
  beforeId?: string;
}

/**
 * The §5.2.2 capped overfetch loop: list `probe_jobs` for `family`, sort
 * `-created,-id`, PB perPage 200, up to `maxPages` PB pages (default 3 = 600
 * rows), advancing an internal composite `(created, id)` cursor between
 * pages. `exhausted` is true when the last page returned fewer than 200 rows
 * (history exhausted within the window). Exported for reuse by the history
 * route (T7) and the lastSuccessAt walk-back below.
 */
export async function fetchFamilyJobRows(
  deps: RunViewDeps,
  family: string,
  cursor?: FamilyJobCursor,
  maxPages: number = RUN_FETCH_MAX_PAGES,
): Promise<{ rows: ProbeJobRecord[]; exhausted: boolean }> {
  const rows: ProbeJobRecord[] = [];
  let cur = cursor;
  let exhausted = false;
  for (let page = 0; page < maxPages; page++) {
    const clauses = [`family = ${JSON.stringify(family)}`];
    if (cur) {
      if (cur.beforeId) {
        // Composite cursor: same-ms siblings are neither skipped nor duplicated.
        clauses.push(
          `(created < ${JSON.stringify(cur.before)} || (created = ${JSON.stringify(cur.before)} && id < ${JSON.stringify(cur.beforeId)}))`,
        );
      } else {
        // Bare-`before` degrade (§5.2.2): legacy/manual-curl posture only.
        clauses.push(`created < ${JSON.stringify(cur.before)}`);
      }
    }
    const result = await deps.pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
      filter: clauses.join(" && "),
      sort: "-created,-id",
      perPage: RUN_FETCH_PAGE_SIZE,
      skipTotal: true,
    });
    rows.push(...result.items);
    if (result.items.length < RUN_FETCH_PAGE_SIZE) {
      exhausted = true;
      break;
    }
    const oldest = result.items[result.items.length - 1];
    cur = { before: oldest.created, beforeId: oldest.id };
  }
  return { rows, exhausted };
}

/** One grouped run batch's raw rows (pre-projection). */
export interface RunBatchRows {
  runId: string;
  rows: ProbeJobRecord[];
}

/**
 * Group fetched job rows into run batches by `run_id`, newest first. Input
 * rows are already sorted `-created,-id`, so first-appearance order IS
 * newest-first. A row missing its denormalized `run_id` (shouldn't exist for
 * family-stamped rows — both columns are stamped by the same enqueue) falls
 * back to `payload.meta.runId`, then to a per-row singleton group keyed by
 * the row id, so malformed rows are never silently merged or dropped.
 */
export function groupBatches(rows: readonly ProbeJobRecord[]): RunBatchRows[] {
  const order: string[] = [];
  const byRun = new Map<string, ProbeJobRecord[]>();
  for (const row of rows) {
    const meta = payloadMeta(row);
    const runId =
      (row.run_id && row.run_id !== "" ? row.run_id : undefined) ??
      (typeof meta?.runId === "string" && meta.runId !== ""
        ? meta.runId
        : row.id);
    let bucket = byRun.get(runId);
    if (!bucket) {
      bucket = [];
      byRun.set(runId, bucket);
      order.push(runId);
    }
    bucket.push(row);
  }
  return order.map((runId) => {
    const bucket = byRun.get(runId);
    /* v8 ignore next — every key in `order` was inserted above */
    if (!bucket) throw new Error(`run-view: lost batch bucket for ${runId}`);
    return { runId, rows: bucket };
  });
}

/**
 * §5.2.1 pinned outcome precedence — evaluated top-down, first match wins;
 * every consumer keys off this one ordering and never re-derives its own:
 *   1. "stalled"   — ≥1 surviving job non-terminal AND a newer batch exists
 *                    (abandonment rule (b): the producer enqueues fresh
 *                    batches each tick, so the old batch is never live again).
 *   2. "failed"    — ≥1 surviving job failed.
 *   3. "completed" — all surviving jobs done.
 * Stalled wins over failed: the zombie row is the operationally live fact;
 * the failed job's detail stays visible in the drill-down + counts.
 */
export function deriveOutcome(
  batch: RunBatchRows,
  hasNewerBatch: boolean,
): RunOutcome {
  const anyNonTerminal = batch.rows.some((row) => !isTerminal(row));
  if (anyNonTerminal && hasNewerBatch) return "stalled";
  if (batch.rows.some((row) => row.status === "failed")) return "failed";
  return "completed";
}

/**
 * §5.2.1 redaction — errorSummary is composed EXCLUSIVELY from
 * closed-vocabulary parts: probe_key + enum-validated comm-error kind (else
 * "unknown") + failed-cell counts. Raw `result.commError.message` and raw
 * cell signal strings NEVER cross the unauthenticated boundary (truncation
 * is not sanitization). Null when the batch has no failed job.
 */
export function buildErrorSummary(batch: RunBatchRows): string | null {
  const parts: string[] = [];
  for (const row of batch.rows) {
    if (row.status !== "failed") continue;
    const { rollup, commErrorKind } = resultView(row);
    if (commErrorKind !== undefined) {
      const kind = isPoolCommErrorKind(commErrorKind)
        ? commErrorKind
        : "unknown";
      parts.push(`${row.probe_key} — ${kind}`);
    } else if (rollup && rollup.failed > 0) {
      parts.push(
        `${row.probe_key} — ${rollup.failed}/${rollup.total} cells failed`,
      );
    } else {
      parts.push(`${row.probe_key} — failed`);
    }
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/**
 * Deduped, enum-validated comm-error kinds across the batch's jobs (§5.2.1):
 * jobs without a commError contribute nothing; unrecognized kinds map to
 * "unknown" so the array is closed-vocabulary by construction.
 */
function collectCommErrorKinds(batch: RunBatchRows): string[] {
  const kinds: string[] = [];
  for (const row of batch.rows) {
    const { commErrorKind } = resultView(row);
    if (commErrorKind === undefined) continue;
    const kind = isPoolCommErrorKind(commErrorKind) ? commErrorKind : "unknown";
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/**
 * Project one grouped batch into the §5.2.1 `lastRun` / §5.2.2 history-item
 * shape. Reds are left null — they live on `probe_runs`, so the CALLER joins
 * them (one list per family/page) and fills the two fields.
 */
export function projectRunBatch(
  batch: RunBatchRows,
  hasNewerBatch: boolean,
): RunBatch {
  const rows = batch.rows;
  const jobs = { total: rows.length, done: 0, failed: 0, reclaimed: 0 };
  let cells: { total: number; passed: number; failed: number } | null = null;
  let allTerminal = true;
  let maxFinishedMs = Number.NEGATIVE_INFINITY;
  let triggered = false;
  for (const row of rows) {
    if (row.status === "done") jobs.done += 1;
    if (row.status === "failed") jobs.failed += 1;
    if ((row.reclaim_count ?? 0) > 0) jobs.reclaimed += 1;
    if (!isTerminal(row)) allTerminal = false;
    const finished = parsePbDate(row.finished_at);
    if (!Number.isNaN(finished) && finished > maxFinishedMs) {
      maxFinishedMs = finished;
    }
    const meta = payloadMeta(row);
    if (meta?.triggered === true) triggered = true;
    const { rollup } = resultView(row);
    if (rollup) {
      cells ??= { total: 0, passed: 0, failed: 0 };
      cells.total += rollup.total;
      cells.passed += rollup.passed;
      cells.failed += rollup.failed;
    }
  }
  const minEnqueued = minEnqueuedAtMs(rows);
  // finishedAt is null while any job is non-terminal (a stalled batch never
  // "finishes") or when no terminal row carries a parseable finished_at.
  const finishedAt =
    allTerminal && Number.isFinite(maxFinishedMs)
      ? new Date(maxFinishedMs).toISOString()
      : null;
  const durationMs =
    finishedAt !== null && !Number.isNaN(minEnqueued)
      ? maxFinishedMs - minEnqueued
      : null;
  return {
    runId: batch.runId,
    triggered,
    enqueuedAt: Number.isNaN(minEnqueued)
      ? (rows[rows.length - 1]?.created ?? "")
      : new Date(minEnqueued).toISOString(),
    finishedAt,
    durationMs,
    outcome: deriveOutcome(batch, hasNewerBatch),
    jobs,
    cells,
    redsIntroduced: null,
    redsCleared: null,
    errorSummary: buildErrorSummary(batch),
    commErrorKinds: collectCommErrorKinds(batch),
  };
}

/**
 * §5.2.1 inflight classification — the NEWEST run_id group only, and only
 * when it has ≥1 non-terminal job (defined this way so an older abandoned
 * batch can never simultaneously classify "stalled" and present as running).
 * `stalled` trips on either:
 *   (a) no progress: now − max(updated) > 2 × period (floor 30 min) — the
 *       batch hasn't moved for two full cycles; renewal-blind by design, so
 *   (c) absolute age cap: now − min(enqueuedAt) > 4 × period (floor 60 min)
 *       regardless of `updated` freshness — `enqueuedAt` is stamped once and
 *       renewal-immune, catching the wedged-but-renewing worker whose lease
 *       loop keeps bumping `updated`.
 */
export function classifyInflight(
  newestBatch: RunBatchRows,
  periodMs: number,
  nowMs: number,
): InflightState | null {
  const rows = newestBatch.rows;
  const jobs = { pending: 0, claimed: 0, running: 0, done: 0, failed: 0 };
  let nonTerminal = 0;
  let maxUpdatedMs = Number.NEGATIVE_INFINITY;
  let triggered = false;
  for (const row of rows) {
    jobs[row.status] += 1;
    if (!isTerminal(row)) nonTerminal += 1;
    const updated = parsePbDate(row.updated);
    if (!Number.isNaN(updated) && updated > maxUpdatedMs) {
      maxUpdatedMs = updated;
    }
    const meta = payloadMeta(row);
    if (meta?.triggered === true) triggered = true;
  }
  if (nonTerminal === 0) return null;
  const minEnqueued = minEnqueuedAtMs(rows);
  const elapsedMs = Number.isNaN(minEnqueued)
    ? 0
    : Math.max(0, nowMs - minEnqueued);
  // Rule (a): no max(updated) progress for 2 × period (floor 30 min). When no
  // row carries a parseable `updated`, fall back to the enqueue time so a
  // malformed batch still ages into stalled rather than presenting fresh.
  const progressRefMs = Number.isFinite(maxUpdatedMs)
    ? maxUpdatedMs
    : minEnqueued;
  const progressWindowMs = Math.max(2 * periodMs, STALL_PROGRESS_FLOOR_MS);
  const noProgress =
    !Number.isNaN(progressRefMs) && nowMs - progressRefMs > progressWindowMs;
  // Rule (c): renewal-immune absolute age cap at 4 × period (floor 60 min).
  const absoluteWindowMs = Math.max(4 * periodMs, STALL_ABSOLUTE_FLOOR_MS);
  const tooOld =
    !Number.isNaN(minEnqueued) && nowMs - minEnqueued > absoluteWindowMs;
  return {
    runId: newestBatch.runId,
    triggered,
    enqueuedAt: Number.isNaN(minEnqueued)
      ? (rows[rows.length - 1]?.created ?? "")
      : new Date(minEnqueued).toISOString(),
    elapsedMs,
    stalled: noProgress || tooOld,
    jobs,
  };
}

/**
 * Determine a worker's health state from its raw row, matching the EXACT
 * behavior `fleet-health.ts`'s reclaim cycle uses on its `deriveHealth` call
 * site so the fleet-runs `/api/runs` strip and the fleet-health monitor
 * never disagree on a worker's state for the SAME row. The canonical
 * derivation lives in `contracts.ts` (`deriveHealth` — exported, shared);
 * this helper is the per-call-site wrapper that both surfaces should route
 * through. We deliberately do NOT pre-check parseability and force "offline":
 * fleet-health's call site (in this branch) does not do that, and forcing it
 * on this display surface re-introduces the surface-disagreement bug this
 * fix is closing. (When fleet-health.ts is updated to use this helper in a
 * follow-up — fleet-health.ts canonical lives on `fix/cf8-m1` and is out of
 * scope here — the parse-check policy can be revisited in ONE place.)
 */
function determineWorkerHealth(
  row: WorkerRow,
  nowMs: number,
  workerStaleAfterMs: number,
): WorkerHealthState {
  // Mirror fleet-health.ts:399 verbatim: pass the raw column straight through
  // to `deriveHealth`. `deriveHealth` -> `isWorkerStale`'s unparseable-default
  // (treat-unknown-as-not-yet-stale) is what the reclaim machinery sees, so
  // this surface sees the same thing.
  return deriveHealth(row.last_heartbeat_at ?? "", nowMs, workerStaleAfterMs);
}

/**
 * Project one `workers` row into the §5.2.1 strip entry, deriving `health`
 * through `determineWorkerHealth` (the shared per-call-site wrapper around
 * `contracts.deriveHealth`) so this surface and `fleet-health.ts`'s cycle
 * report the SAME health for the SAME row. The `endpoint` column (a routable
 * internal URL) is deliberately NEVER serialized; worker ids and heartbeat
 * timestamps are non-secret (§5.2.1 identifier-exposure carve-out).
 */
export function projectWorker(
  row: WorkerRow,
  workerStaleAfterMs: number,
  nowMs: number,
): WorkerView {
  const heartbeat = row.last_heartbeat_at ?? "";
  const health = determineWorkerHealth(row, nowMs, workerStaleAfterMs);
  return {
    workerId: row.worker_id,
    health,
    lastHeartbeatAt: heartbeat,
    registeredAt: row.registered_at ?? "",
    currentJobId:
      row.current_job_id && row.current_job_id !== ""
        ? row.current_job_id
        : null,
    capacity: {
      inUse: row.capacity_in_use ?? 0,
      available: row.capacity_available ?? 0,
      max: row.capacity_max ?? 0,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Reds read path (§4.2 / §5.2.1)
// ───────────────────────────────────────────────────────────────────────

/**
 * One `probe_runs` list per batch: filtered by the batch's job ids (the
 * aggregator stamps `job_id` = the probe_jobs row id; ≤ ~25 OR clauses, a
 * single page), with `summary.redsIntroduced`/`summary.redsCleared` summed
 * across the returned rows. Rows lacking the fields (pre-P2 history)
 * contribute nothing; when NO returned row carries them, both stay null.
 */
async function fetchBatchReds(
  deps: RunViewDeps,
  jobIds: readonly string[],
): Promise<{ redsIntroduced: number | null; redsCleared: number | null }> {
  if (jobIds.length === 0) {
    return { redsIntroduced: null, redsCleared: null };
  }
  const filter = jobIds
    .map((id) => `job_id = ${JSON.stringify(id)}`)
    .join(" || ");
  const result = await deps.pb.list<ProbeRunRedsRow>(PROBE_RUNS_COLLECTION, {
    filter,
    perPage: RUN_FETCH_PAGE_SIZE,
    skipTotal: true,
  });
  let redsIntroduced: number | null = null;
  let redsCleared: number | null = null;
  for (const row of result.items) {
    const summary = row.summary;
    if (summary === null || typeof summary !== "object") continue;
    if (typeof summary.redsIntroduced === "number") {
      redsIntroduced = (redsIntroduced ?? 0) + summary.redsIntroduced;
    }
    if (typeof summary.redsCleared === "number") {
      redsCleared = (redsCleared ?? 0) + summary.redsCleared;
    }
  }
  return { redsIntroduced, redsCleared };
}

// ───────────────────────────────────────────────────────────────────────
// Family summary computation + memo (§5.2)
// ───────────────────────────────────────────────────────────────────────

/**
 * Grouped batches eligible for projection: when the fetch window was NOT
 * exhausted the oldest group is potentially truncated by the row cap, so it
 * is discarded (§5.2.2 grouping rule) — except when it is the only group
 * (degenerate single-batch window; the route layer owns the `truncated`
 * presentation of that case).
 */
function eligibleGroups(
  groups: RunBatchRows[],
  exhausted: boolean,
): RunBatchRows[] {
  if (exhausted || groups.length <= 1) return groups;
  return groups.slice(0, -1);
}

/**
 * §5.2.1 "terminal completion" predicate for `lastSuccessAt`: a batch where
 * every job reached a terminal state (done | failed) AND no job carries a
 * `commError` on its result. A batch with cell-level failures but no
 * comm-error IS a terminal completion — the worker reached the pool, ran the
 * probe, and returned a result; cells red is a content-quality signal, not a
 * worker-outage signal.
 *
 * This is deliberately LOOSER than the §5.2.1 outcome=="completed"
 * all-cells-green precedence (which still drives `lastRun.outcome`). The
 * silence banner (§7.4) and the §9 silence monitor want to fire on "the
 * worker stopped producing results" — chronic content reds with healthy
 * workers must NOT fool that fallback into "no successful run since Xh ago"
 * (the regression that motivated this redefinition).
 */
function isTerminalCompletionBatch(batch: RunBatchRows): boolean {
  // All jobs must be in a terminal status (done | failed).
  if (batch.rows.some((row) => !isTerminal(row))) return false;
  // No job may carry a worker-comm-level failure (crashed / reclaimed /
  // lease-expired). resultView().commErrorKind === undefined means there is
  // either no result object or a result with no commError (cells-red only).
  for (const row of batch.rows) {
    if (resultView(row).commErrorKind !== undefined) return false;
  }
  return true;
}

/**
 * Index of the first batch in walk-order qualifying as a §5.2.1 terminal
 * completion (the `lastSuccessAt` reference). Skips the newest group when
 * it's the live inflight batch (any non-terminal row) — that batch is the
 * current attempt, never the last success.
 */
function findTerminalCompletionBatch(
  groups: RunBatchRows[],
): RunBatchRows | null {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    // The newest group, while non-terminal, is the inflight batch — it is
    // not a terminal outcome and can never be the last success.
    if (i === 0 && group.rows.some((row) => !isTerminal(row))) continue;
    if (isTerminalCompletionBatch(group)) return group;
  }
  return null;
}

function maxFinishedAtIso(batch: RunBatchRows): string | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const row of batch.rows) {
    const t = parsePbDate(row.finished_at);
    if (!Number.isNaN(t) && t > max) max = t;
  }
  return Number.isFinite(max) ? new Date(max).toISOString() : null;
}

/** Compute one family's §5.2.1 entry (throws on PB failure — caller degrades). */
async function projectFamily(
  deps: RunViewDeps,
  fam: FleetFamily,
  nowMs: number,
): Promise<FamilySummaryEntry> {
  const schedule = deps.schedules.find((s) => s.scheduleId === fam.scheduleId);
  if (!schedule) {
    // Unreachable while the §5.1 drift-lock holds (registry ids set-equal to
    // the wired schedules); surfaced loudly rather than silently defaulting.
    deps.logger.warn("run-view.schedule-unresolved", {
      family: fam.family,
      scheduleId: fam.scheduleId,
    });
  }
  const periodMs = schedule ? periodMsFromCron(schedule.cron) : 0;
  const nextRun = deps.scheduler.nextRunAt(fam.scheduleId);

  // One indexed list (1 page) covers lastRun + inflight (a batch is ≤ ~25
  // jobs; 200 rows ≈ several batches). Only the lastSuccessAt walk-back
  // extends to the §5.2.2 capped loop, and only when the first page holds
  // no terminal-completion batch.
  const first = await fetchFamilyJobRows(deps, fam.family, undefined, 1);
  let rows = first.rows;
  let exhausted = first.exhausted;
  let groups = eligibleGroups(groupBatches(rows), exhausted);
  let terminalCompletion = findTerminalCompletionBatch(groups);
  if (terminalCompletion === null && !exhausted && rows.length > 0) {
    const oldest = rows[rows.length - 1];
    const more = await fetchFamilyJobRows(
      deps,
      fam.family,
      { before: oldest.created, beforeId: oldest.id },
      RUN_FETCH_MAX_PAGES - 1,
    );
    rows = [...rows, ...more.rows];
    exhausted = more.exhausted;
    groups = eligibleGroups(groupBatches(rows), exhausted);
    terminalCompletion = findTerminalCompletionBatch(groups);
  }

  // inflight = the newest group only (§5.2.1) — null when all-terminal.
  const newest = groups[0];
  const inflight = newest ? classifyInflight(newest, periodMs, nowMs) : null;

  // lastRun = the newest group whose jobs are all terminal (the newest group
  // itself when inflight is null), else the next group down — which is by
  // construction all-terminal or stalled-by-abandonment (rule (b)).
  let lastRunGroup: RunBatchRows | null = null;
  let lastRunHasNewer = false;
  if (newest && inflight === null) {
    lastRunGroup = newest;
  } else if (groups.length > 1) {
    lastRunGroup = groups[1];
    lastRunHasNewer = true;
  }
  let lastRun: RunBatch | null = null;
  if (lastRunGroup) {
    lastRun = projectRunBatch(lastRunGroup, lastRunHasNewer);
    const reds = await fetchBatchReds(
      deps,
      lastRunGroup.rows.map((row) => row.id),
    );
    lastRun.redsIntroduced = reds.redsIntroduced;
    lastRun.redsCleared = reds.redsCleared;
  }

  return {
    family: fam.family,
    label: fam.label,
    probeKeyPrefix: fam.probeKeyPrefix,
    ...(schedule ? { schedule: schedule.cron, periodMs } : {}),
    nextRunAt: nextRun ? nextRun.toISOString() : null,
    lastRun,
    inflight,
    lastSuccessAt: terminalCompletion
      ? maxFinishedAtIso(terminalCompletion)
      : null,
  };
}

async function computeFamilySummary(
  deps: RunViewDeps,
  nowMs: number,
): Promise<FamilySummaryResponse> {
  const families: FamilySummaryEntry[] = [];
  for (const fam of FLEET_FAMILIES) {
    try {
      families.push(await projectFamily(deps, fam, nowMs));
    } catch (err) {
      // §5.2.1 graceful degradation: HTTP-200 posture with an entry-level
      // error the dashboard treats as the same incident class as a failed
      // poll — a PB-down-while-CP-up outage surfaces loudly, never as a
      // silently sparse table.
      deps.logger.warn("run-view.family-projection-failed", {
        family: fam.family,
        error: String(err),
      });
      families.push({
        family: fam.family,
        label: fam.label,
        probeKeyPrefix: fam.probeKeyPrefix,
        error: "history_unavailable",
      });
    }
  }
  let workers: WorkerView[] = [];
  try {
    const result = await deps.pb.list<WorkerRow>(WORKERS_COLLECTION, {
      sort: "-last_heartbeat_at",
      perPage: RUN_FETCH_PAGE_SIZE,
      skipTotal: true,
    });
    workers = result.items.map((row) =>
      projectWorker(row, deps.workerStaleAfterMs, nowMs),
    );
  } catch (err) {
    // Worker-strip degradation: families already carry their own per-family
    // error entries on a PB outage; an isolated workers-list failure logs
    // loudly and renders an empty strip rather than failing the whole body.
    deps.logger.warn("run-view.workers-projection-failed", {
      error: String(err),
    });
  }
  return { families, workers };
}

/** The §5.2 shared memo seam (routes + §9 monitor share ONE instance). */
export interface MemoizedFamilySummary {
  /** Whole-body memoized §5.2.1 response (~5 s TTL, per-family degradation). */
  get(): Promise<FamilySummaryResponse>;
}

/**
 * Whole-body ~5 s-TTL memo of the family summary (§5.2): every caller inside
 * the window shares one computation, bounding PB load at ~one fan-out per
 * TTL regardless of viewer count. Concurrent callers during a cold compute
 * share the in-flight promise; a rejected computation is evicted so the next
 * call retries (per-family failures degrade inside the body and do NOT
 * reject). `runControlPlane` constructs ONE instance and injects it into
 * both the fleet-runs routes and the §9 family-silence monitor.
 */
export function createMemoizedFamilySummary(
  deps: RunViewDeps,
  ttlMs: number = DEFAULT_SUMMARY_TTL_MS,
): MemoizedFamilySummary {
  const now = deps.now ?? Date.now;
  let cached: { atMs: number; value: Promise<FamilySummaryResponse> } | null =
    null;
  return {
    get(): Promise<FamilySummaryResponse> {
      const t = now();
      if (cached && t - cached.atMs < ttlMs) return cached.value;
      const entry = {
        atMs: t,
        value: computeFamilySummary(deps, t),
      };
      cached = entry;
      entry.value.catch(() => {
        // Evict the failed computation so the next get() retries instead of
        // serving a rejected promise for the rest of the TTL.
        if (cached === entry) cached = null;
      });
      return entry.value;
    },
  };
}
