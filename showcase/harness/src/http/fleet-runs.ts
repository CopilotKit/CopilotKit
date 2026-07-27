/**
 * Fleet-runs routes (§5.2) — the three unauthenticated worker-run GETs the
 * dashboard Ops tab consumes through the /api/ops proxy:
 *
 *   - GET /api/runs                    — §5.2.1 family summary (shared memo)
 *   - GET /api/runs/:family            — §5.2.2 cursor-paged run history
 *   - GET /api/runs/:family/:runId     — §5.2.3 per-service drill-down
 *
 * Mounted UNCONDITIONALLY on the CP role by `buildServer` (the §5.2 pinned
 * divergence from /api/probes): there is NO mutating route here, so nothing
 * for a token to protect — read telemetry must never be hidden by a missing
 * `OPS_TRIGGER_TOKEN` env. If a trigger POST ever lands (open question #3),
 * the POST alone gets the bearer gate.
 *
 * Abuse posture (§5.2): `/api/runs` is served from the injected SHARED
 * whole-body memo (`createMemoizedFamilySummary` — the same instance the §9
 * family-silence monitor reads). The history routes get ROUTE-LOCAL bounds —
 * a keyed ~10 s-TTL LRU memo plus a fixed 30-per-10 s rate-limit window
 * shared across both — because the `?before` cursor is attacker-controlled,
 * so the whole-body memo cannot close their amplification.
 */

import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { bearerAuth } from "./auth.js";
import type { Logger } from "../types/index.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import type { PbClient } from "../storage/pb-client.js";
import type { JobStatus } from "../fleet/job-claim.js";
import { isPoolCommErrorKind } from "../fleet/contracts.js";
import { PROBE_JOBS_COLLECTION } from "../fleet/queue-client.js";
import { PROBE_RUNS_COLLECTION } from "../probes/run-history.js";
import type { ProducerSchedule } from "../fleet/control-plane/control-plane.js";
import {
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_SCHEDULE_ID,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
} from "../fleet/control-plane/control-plane.js";
import {
  FLEET_FAMILIES,
  RUN_FETCH_MAX_PAGES,
  RUN_FETCH_PAGE_SIZE,
  buildErrorSummary,
  fetchFamilyJobRows,
  groupBatches,
  projectRunBatch,
} from "../fleet/control-plane/run-view.js";
import type {
  FamilyJobCursor,
  FleetFamily,
  MemoizedFamilySummary,
  ProbeJobRecord,
  RunBatch,
  RunBatchRows,
  RunViewDeps,
} from "../fleet/control-plane/run-view.js";

// ───────────────────────────────────────────────────────────────────────
// Bounds (§5.2) — exported so tests pin the contract values
// ───────────────────────────────────────────────────────────────────────

/** §5.2.2 perPage clamp: [1, 50], default 20 (run BATCHES, not jobs). */
export const HISTORY_DEFAULT_PER_PAGE = 20;
export const HISTORY_MAX_PER_PAGE = 50;
/** §5.2 bound (a): per-(family,before,beforeId,perPage) keyed memo. */
export const HISTORY_MEMO_TTL_MS = 10_000;
export const HISTORY_MEMO_MAX_KEYS = 64;
/** §5.2 bound (b): fixed window shared across BOTH history routes. */
export const HISTORY_RATE_LIMIT_MAX = 30;
export const HISTORY_RATE_LIMIT_WINDOW_MS = 10_000;

// ───────────────────────────────────────────────────────────────────────
// Deps
// ───────────────────────────────────────────────────────────────────────

/**
 * Wired by `buildServer` from the orchestrator (T8). `summary` is the
 * injected SHARED memo instance (§5.2 — the same one the §9 monitor gets),
 * so "the monitor shares the route's memo" is true by construction.
 */
export interface FleetRunsRouteDeps {
  summary: MemoizedFamilySummary;
  pb: PbClient;
  /** The buildProducerSchedules output — the resolved-cron source (§5.1). */
  schedules: readonly ProducerSchedule[];
  scheduler: Pick<Scheduler, "nextRunAt">;
  /** Boot-resolved heartbeat window — never the DEFAULT_ constant (§5.2). */
  workerStaleAfterMs: number;
  logger: Logger;
  now?: () => number;
  /**
   * Bearer token gating the on-demand `POST /api/runs/:family/trigger` route.
   * When supplied (the CP role always supplies `OPS_TRIGGER_TOKEN`), the
   * trigger route is mounted and `bearerAuth` enforces it; construction is
   * fail-loud (MissingAuthTokenError) on an empty token. When OMITTED, the
   * three read-only GET routes mount exactly as before but the mutating
   * trigger route is NOT registered (older worker/test wiring that never
   * triggers fleet runs). This is the ONE token-coupled fleet-runs route —
   * the §5.2 GETs stay unconditionally mounted.
   */
  triggerToken?: string;
}

/**
 * Window during which a successful fleet-trigger blocks any further trigger
 * for the same family. Mirrors `/api/probes` `TRIGGER_RATE_LIMIT_MS` so an
 * operator can't accidentally fan a family out twice in quick succession.
 * In-memory per process — sufficient for the single CP instance.
 */
export const FLEET_TRIGGER_RATE_LIMIT_MS = 5 * 60 * 1000;

/**
 * Hard ceiling on the fleet-trigger POST body — operators only ever send a
 * small slug/featureType filter. Mirrors `/api/probes` `TRIGGER_BODY_LIMIT_BYTES`.
 */
export const FLEET_TRIGGER_BODY_LIMIT_BYTES = 16 * 1024;

// ───────────────────────────────────────────────────────────────────────
// Response DTOs
// ───────────────────────────────────────────────────────────────────────

/** GET /api/runs/:family body (§5.2.2). */
export interface FamilyHistoryResponse {
  family: string;
  runs: RunBatch[];
  perPage: number;
  /** Composite (created, id) cursor of the oldest job in the oldest RETURNED
   *  batch; null ONLY when history exhausted and every batch returned. */
  nextBefore: string | null;
  nextBeforeId: string | null;
}

/** One §5.2.3 per-job entry. Redaction per §5.2.1: closed-vocabulary only —
 *  `commError.message` is NEVER serialized on these unauthenticated GETs. */
export interface RunJobView {
  jobId: string;
  probeKey: string;
  serviceSlug: string;
  status: JobStatus;
  claimedBy: string | null;
  enqueuedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  /** claimed_at − created — measures the LAST claim for reclaimed jobs
   *  (§5.2.1 corollary: claimed_at restamps on every re-claim). */
  queueLatencyMs: number | null;
  /** finished_at − claimed_at; null while either side is absent. */
  durationMs: number | null;
  /** The §4.2 hook counter, surfaced directly. */
  reclaimCount: number;
  cells: { total: number; passed: number; failed: number } | null;
  errorSummary: string | null;
  commError: { kind: string; observedAt: string | null } | null;
}

/** GET /api/runs/:family/:runId body (§5.2.3). */
export interface RunDetailResponse {
  family: string;
  runId: string;
  jobs: RunJobView[];
}

// ───────────────────────────────────────────────────────────────────────
// Keyed LRU+TTL memo (§5.2 bound (a)) — exported for direct bound tests
// ───────────────────────────────────────────────────────────────────────

export interface LruTtlMemo<V> {
  get(key: string, compute: () => Promise<V>): Promise<V>;
  size(): number;
}

/**
 * Keyed memo with TTL + LRU cap: serves the legitimate hot path for free
 * (one shared key per family for the cursor-less default request) without
 * unbounded key growth under cursor abuse. Hits refresh recency; rejected
 * computations are evicted so the next call retries instead of pinning a
 * failure for the TTL.
 */
export function createLruTtlMemo<V>(opts: {
  ttlMs: number;
  maxKeys: number;
  now: () => number;
}): LruTtlMemo<V> {
  const entries = new Map<string, { atMs: number; value: Promise<V> }>();
  return {
    get(key: string, compute: () => Promise<V>): Promise<V> {
      const t = opts.now();
      const hit = entries.get(key);
      if (hit && t - hit.atMs < opts.ttlMs) {
        // Refresh recency: Map iteration order is insertion order.
        entries.delete(key);
        entries.set(key, hit);
        return hit.value;
      }
      const entry = { atMs: t, value: compute() };
      entries.delete(key);
      entries.set(key, entry);
      entry.value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      while (entries.size > opts.maxKeys) {
        const oldest = entries.keys().next().value;
        /* v8 ignore next — size > 0 guarantees a key */
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return entry.value;
    },
    size(): number {
      return entries.size;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Local row-parsing helpers (the per-job §5.2.3 projection)
// ───────────────────────────────────────────────────────────────────────

/**
 * Anchored PB space→"T" date-separator rewrite — byte-for-byte the same
 * anchor as run-view/queue-client, so only the canonical date/time boundary
 * is converted, never an arbitrary first space.
 */
const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;

function parsePbDate(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(String(value).replace(PB_DATE_SEP_RE, "$1T"));
}

function toIsoOrNull(ms: number): string | null {
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Defensive view of a row's untrusted `payload`/`result` JSON columns. */
function payloadView(row: ProbeJobRecord): {
  serviceSlug: string | undefined;
  enqueuedAt: string | undefined;
} {
  const payload = row.payload;
  if (payload === null || typeof payload !== "object") {
    return { serviceSlug: undefined, enqueuedAt: undefined };
  }
  const slug = (payload as { serviceSlug?: unknown }).serviceSlug;
  const meta = (payload as { meta?: unknown }).meta;
  let enqueuedAt: string | undefined;
  if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
    const v = (meta as { enqueuedAt?: unknown }).enqueuedAt;
    if (typeof v === "string") enqueuedAt = v;
  }
  return {
    serviceSlug: typeof slug === "string" ? slug : undefined,
    enqueuedAt,
  };
}

function resultView(row: ProbeJobRecord): {
  cells: { total: number; passed: number; failed: number } | null;
  commError: { kind: string; observedAt: string | null } | null;
} {
  const result = row.result;
  if (result === null || typeof result !== "object") {
    return { cells: null, commError: null };
  }
  const candidate = result as { rollup?: unknown; commError?: unknown };
  let cells: { total: number; passed: number; failed: number } | null = null;
  if (candidate.rollup !== null && typeof candidate.rollup === "object") {
    const r = candidate.rollup as {
      total?: unknown;
      passed?: unknown;
      failed?: unknown;
    };
    if (
      typeof r.total === "number" &&
      typeof r.passed === "number" &&
      typeof r.failed === "number"
    ) {
      cells = { total: r.total, passed: r.passed, failed: r.failed };
    }
  }
  let commError: { kind: string; observedAt: string | null } | null = null;
  if (candidate.commError !== null && typeof candidate.commError === "object") {
    const ce = candidate.commError as { kind?: unknown; observedAt?: unknown };
    if (typeof ce.kind === "string") {
      // §5.2.1 redaction: enum-validated kind only (else "unknown") +
      // timestamp — `message` deliberately never read past this point.
      commError = {
        kind: isPoolCommErrorKind(ce.kind) ? ce.kind : "unknown",
        observedAt: typeof ce.observedAt === "string" ? ce.observedAt : null,
      };
    }
  }
  return { cells, commError };
}

/** Project one probe_jobs row into the §5.2.3 per-job shape. */
function projectJob(row: ProbeJobRecord): RunJobView {
  const { serviceSlug, enqueuedAt } = payloadView(row);
  const { cells, commError } = resultView(row);
  const createdMs = parsePbDate(row.created);
  const claimedMs = parsePbDate(row.claimed_at);
  const finishedMs = parsePbDate(row.finished_at);
  // enqueuedAt sourcing per §5.2.1: payload.meta.enqueuedAt, falling back to
  // the row's `created` column when absent/unparseable.
  const enqueuedMs = parsePbDate(enqueuedAt);
  const enqueuedIso =
    toIsoOrNull(Number.isNaN(enqueuedMs) ? createdMs : enqueuedMs) ??
    row.created;
  const colonIdx = row.probe_key.indexOf(":");
  return {
    jobId: row.id,
    probeKey: row.probe_key,
    serviceSlug:
      serviceSlug ?? (colonIdx >= 0 ? row.probe_key.slice(colonIdx + 1) : ""),
    status: row.status,
    claimedBy: row.claimed_by !== "" ? row.claimed_by : null,
    enqueuedAt: enqueuedIso,
    claimedAt: toIsoOrNull(claimedMs),
    finishedAt: toIsoOrNull(finishedMs),
    queueLatencyMs:
      Number.isNaN(claimedMs) || Number.isNaN(createdMs)
        ? null
        : claimedMs - createdMs,
    durationMs:
      Number.isNaN(finishedMs) || Number.isNaN(claimedMs)
        ? null
        : finishedMs - claimedMs,
    reclaimCount: row.reclaim_count ?? 0,
    cells,
    // Single-row reuse of the §5.2.1 closed-vocabulary composer.
    errorSummary: buildErrorSummary({
      runId: row.run_id ?? row.id,
      rows: [row],
    }),
    commError,
  };
}

// ───────────────────────────────────────────────────────────────────────
// History page computation (§5.2.2)
// ───────────────────────────────────────────────────────────────────────

interface ProbeRunRedsRow {
  id: string;
  job_id?: string;
  started_at?: string;
  summary?: { redsIntroduced?: unknown; redsCleared?: unknown } | null;
}

/**
 * §5.2.2 windowed reds: ONE family-scoped probe_runs list per page —
 * `probe_id ~ "<prefix>:%"` (explicit trailing % so PB runs an anchored
 * prefix LIKE, never a contains scan), `job_id != ""`, started_at bounded by
 * the returned batches' window, `-started_at`, ≤3 pages — joined in-process
 * on job_id ∈ the returned batches' job ids and summed per batch. The
 * `-started_at` sort means a biting cap lands the `null` honest-unknowns on
 * the OLDEST batches of the page; a batch whose rows fall beyond the cap
 * reports null for both counters (same honest-unknown as pre-P2 rows).
 */
async function joinWindowedReds(
  deps: FleetRunsRouteDeps,
  fam: FleetFamily,
  returned: readonly RunBatchRows[],
  runs: RunBatch[],
  nowMs: number,
): Promise<void> {
  if (runs.length === 0) return;
  const oldestEnqueued = runs[runs.length - 1].enqueuedAt;
  const newestFinish = runs[0].finishedAt ?? new Date(nowMs).toISOString();
  const filter = [
    `probe_id ~ ${JSON.stringify(`${fam.probeKeyPrefix}:%`)}`,
    `job_id != ""`,
    `started_at >= ${JSON.stringify(oldestEnqueued)}`,
    `started_at <= ${JSON.stringify(newestFinish)}`,
  ].join(" && ");
  const fetched: ProbeRunRedsRow[] = [];
  let exhausted = false;
  for (let page = 1; page <= RUN_FETCH_MAX_PAGES; page++) {
    const result = await deps.pb.list<ProbeRunRedsRow>(PROBE_RUNS_COLLECTION, {
      filter,
      sort: "-started_at",
      perPage: RUN_FETCH_PAGE_SIZE,
      page,
      skipTotal: true,
    });
    fetched.push(...result.items);
    if (result.items.length < RUN_FETCH_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }
  // When the cap bit, rows older than the oldest fetched started_at may be
  // missing — batches whose window starts before it report null (honest).
  let oldestFetchedMs = Number.NEGATIVE_INFINITY;
  if (!exhausted && fetched.length > 0) {
    oldestFetchedMs = parsePbDate(fetched[fetched.length - 1].started_at);
  }
  const byJobId = new Map<string, ProbeRunRedsRow[]>();
  for (const row of fetched) {
    if (!row.job_id) continue;
    const bucket = byJobId.get(row.job_id);
    if (bucket) bucket.push(row);
    else byJobId.set(row.job_id, [row]);
  }
  for (let i = 0; i < returned.length; i++) {
    const run = runs[i];
    if (
      !exhausted &&
      !Number.isNaN(oldestFetchedMs) &&
      parsePbDate(run.enqueuedAt) < oldestFetchedMs
    ) {
      continue; // beyond the cap — both counters stay null
    }
    let redsIntroduced: number | null = null;
    let redsCleared: number | null = null;
    for (const jobRow of returned[i].rows) {
      for (const pr of byJobId.get(jobRow.id) ?? []) {
        const summary = pr.summary;
        if (summary === null || typeof summary !== "object") continue;
        if (typeof summary.redsIntroduced === "number") {
          redsIntroduced = (redsIntroduced ?? 0) + summary.redsIntroduced;
        }
        if (typeof summary.redsCleared === "number") {
          redsCleared = (redsCleared ?? 0) + summary.redsCleared;
        }
      }
    }
    run.redsIntroduced = redsIntroduced;
    run.redsCleared = redsCleared;
  }
}

/**
 * The §5.2.2 page algorithm: capped overfetch loop (reusing run-view's
 * `fetchFamilyJobRows` one PB page at a time so the early-stop on
 * ≥ perPage+1 groups can run between pages), group by run_id, discard the
 * potentially-truncated oldest group unless history was exhausted, return
 * the newest min(perPage, complete) batches with the composite cursor —
 * including the zero-complete-batch degenerate page (`truncated: true`).
 */
async function computeHistoryPage(
  deps: FleetRunsRouteDeps,
  rvDeps: RunViewDeps,
  fam: FleetFamily,
  cursor: FamilyJobCursor | undefined,
  perPage: number,
  nowMs: number,
): Promise<FamilyHistoryResponse> {
  const rows: ProbeJobRecord[] = [];
  let cur = cursor;
  let exhausted = false;
  for (let page = 0; page < RUN_FETCH_MAX_PAGES; page++) {
    const result = await fetchFamilyJobRows(rvDeps, fam.family, cur, 1);
    rows.push(...result.rows);
    if (result.exhausted) {
      exhausted = true;
      break;
    }
    // Early stop: ≥ perPage+1 groups accumulated (the +1 absorbs the
    // partial-oldest discard below).
    if (groupBatches(rows).length >= perPage + 1) break;
    const oldest = rows[rows.length - 1];
    cur = { before: oldest.created, beforeId: oldest.id };
  }
  const groups = groupBatches(rows);
  if (groups.length === 0) {
    // Zero rows ⇒ the first list returned short ⇒ history exhausted.
    return {
      family: fam.family,
      runs: [],
      perPage,
      nextBefore: null,
      nextBeforeId: null,
    };
  }
  const cursorSupplied = cursor !== undefined;
  const complete = exhausted ? groups : groups.slice(0, -1);
  if (complete.length === 0) {
    // §5.2.2 degenerate clamp: a single pathological batch larger than the
    // 600-row cap. Return the partial itself flagged truncated (honest-
    // partial counts, reds null) so its runId stays client-discoverable for
    // the §5.2.3 drill-down; the cursor falls back to the oldest FETCHED
    // row — strictly composite-older than the supplied cursor, so a client
    // can never loop on the same cursor.
    const partial = groups[0];
    const batch = projectRunBatch(partial, cursorSupplied);
    batch.truncated = true;
    const oldestRow = rows[rows.length - 1];
    return {
      family: fam.family,
      runs: [batch],
      perPage,
      nextBefore: oldestRow.created,
      nextBeforeId: oldestRow.id,
    };
  }
  const returned = complete.slice(0, perPage);
  // hasNewerBatch (abandonment rule (b) input): with a cursor supplied,
  // newer batches exist by construction (the client paged past them); on
  // the cursor-less first page only the newest group has none.
  const runs = returned.map((group, i) =>
    projectRunBatch(group, cursorSupplied || i > 0),
  );
  await joinWindowedReds(deps, fam, returned, runs, nowMs);
  if (exhausted && returned.length === groups.length) {
    return {
      family: fam.family,
      runs,
      perPage,
      nextBefore: null,
      nextBeforeId: null,
    };
  }
  const oldestBatch = returned[returned.length - 1];
  const oldestJob = oldestBatch.rows[oldestBatch.rows.length - 1];
  return {
    family: fam.family,
    runs,
    perPage,
    nextBefore: oldestJob.created,
    nextBeforeId: oldestJob.id,
  };
}

function clampPerPage(raw: string | undefined): number {
  if (raw === undefined) return HISTORY_DEFAULT_PER_PAGE;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return HISTORY_DEFAULT_PER_PAGE;
  return Math.min(HISTORY_MAX_PER_PAGE, Math.max(1, parsed));
}

// ───────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────

/**
 * Mount the three /api/runs GETs onto an existing Hono app. All responses
 * carry `Cache-Control: no-cache` (identical posture to /api/probes — the
 * dashboard polls these and intermediate caching would mask transitions).
 * No mutating route; no OPS_TRIGGER_TOKEN coupling anywhere.
 */
export function registerFleetRunsRoutes(
  app: Hono,
  deps: FleetRunsRouteDeps,
): void {
  const now = deps.now ?? (() => Date.now());
  const rvDeps: RunViewDeps = {
    pb: deps.pb,
    scheduler: deps.scheduler,
    schedules: deps.schedules,
    workerStaleAfterMs: deps.workerStaleAfterMs,
    logger: deps.logger,
    now,
  };
  const familyByName = new Map<string, FleetFamily>(
    FLEET_FAMILIES.map((f) => [f.family, f]),
  );
  const historyMemo = createLruTtlMemo<FamilyHistoryResponse>({
    ttlMs: HISTORY_MEMO_TTL_MS,
    maxKeys: HISTORY_MEMO_MAX_KEYS,
    now,
  });

  // §5.2 bound (b): fixed window pooled across all callers of BOTH history
  // routes (they sit behind the single dashboard proxy, so per-IP
  // attribution is meaningless anyway).
  let windowStartMs = Number.NEGATIVE_INFINITY;
  let windowCount = 0;
  function consumeRateLimit():
    | { ok: true }
    | { ok: false; retryAfterSec: number } {
    const t = now();
    if (t - windowStartMs >= HISTORY_RATE_LIMIT_WINDOW_MS) {
      windowStartMs = t;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > HISTORY_RATE_LIMIT_MAX) {
      return {
        ok: false,
        retryAfterSec: Math.max(
          1,
          Math.ceil((windowStartMs + HISTORY_RATE_LIMIT_WINDOW_MS - t) / 1000),
        ),
      };
    }
    return { ok: true };
  }

  app.get("/api/runs", async (c) => {
    c.header("Cache-Control", "no-cache");
    try {
      return c.json(await deps.summary.get());
    } catch (err) {
      // The memoized projection degrades per-family and should never
      // reject; if it somehow does, hold the §5.2.1 HTTP-200 posture with
      // every family marked unavailable rather than 500ing the dashboard.
      deps.logger.warn("fleet-runs.summary-failed", { error: String(err) });
      return c.json({
        families: FLEET_FAMILIES.map((fam) => ({
          family: fam.family,
          label: fam.label,
          probeKeyPrefix: fam.probeKeyPrefix,
          error: "history_unavailable" as const,
        })),
        workers: [],
      });
    }
  });

  app.get("/api/runs/:family", async (c) => {
    c.header("Cache-Control", "no-cache");
    const fam = familyByName.get(c.req.param("family"));
    if (!fam) {
      return c.json({ error: "not_found" }, 404);
    }
    const rl = consumeRateLimit();
    if (!rl.ok) {
      c.header("Retry-After", String(rl.retryAfterSec));
      return c.json({ error: "rate_limited" }, 429);
    }
    const perPage = clampPerPage(c.req.query("perPage"));
    const before = c.req.query("before");
    const beforeId = c.req.query("beforeId");
    // Bare `before` degrades to a plain `created <` cursor inside
    // fetchFamilyJobRows (§5.2.2 legacy/manual-curl posture); the dashboard
    // always echoes both fields.
    const cursor: FamilyJobCursor | undefined = before
      ? { before, ...(beforeId ? { beforeId } : {}) }
      : undefined;
    const key = JSON.stringify([
      fam.family,
      before ?? "",
      beforeId ?? "",
      perPage,
    ]);
    try {
      return c.json(
        await historyMemo.get(key, () =>
          computeHistoryPage(deps, rvDeps, fam, cursor, perPage, now()),
        ),
      );
    } catch (err) {
      // §5.2.1-anchored graceful degradation (applies to all three routes):
      // a PB outage yields history_unavailable at HTTP 200, never a 500 —
      // the dashboard treats it as the same incident class as a failed poll.
      deps.logger.warn("fleet-runs.history-failed", {
        family: fam.family,
        error: String(err),
      });
      return c.json({ family: fam.family, error: "history_unavailable" });
    }
  });

  app.get("/api/runs/:family/:runId", async (c) => {
    c.header("Cache-Control", "no-cache");
    const fam = familyByName.get(c.req.param("family"));
    if (!fam) {
      return c.json({ error: "not_found" }, 404);
    }
    const rl = consumeRateLimit();
    if (!rl.ok) {
      c.header("Retry-After", String(rl.retryAfterSec));
      return c.json({ error: "rate_limited" }, 429);
    }
    const runId = c.req.param("runId");
    try {
      // Single indexed run_id list (≤1 PB page) — §5.2.3. The drill-down on
      // a truncated batch's runId returns the batch's FULL job set
      // regardless of the history route's row cap.
      const result = await deps.pb.list<ProbeJobRecord>(PROBE_JOBS_COLLECTION, {
        filter: `family = ${JSON.stringify(fam.family)} && run_id = ${JSON.stringify(runId)}`,
        sort: "-created,-id",
        perPage: RUN_FETCH_PAGE_SIZE,
        skipTotal: true,
      });
      if (result.items.length === 0) {
        return c.json({ error: "not_found" }, 404);
      }
      return c.json({
        family: fam.family,
        runId,
        jobs: result.items.map(projectJob),
      } satisfies RunDetailResponse);
    } catch (err) {
      deps.logger.warn("fleet-runs.detail-failed", {
        family: fam.family,
        runId,
        error: String(err),
      });
      return c.json({
        family: fam.family,
        runId,
        error: "history_unavailable",
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/runs/:family/trigger — ON-DEMAND fleet/D6 probe trigger
  //
  // The §5.2 GETs are read-only; the fleet/D6 (and the other browser-family)
  // probes are dispatched via the control-plane producer → queue → worker
  // path and so were NOT manually fireable. This route closes that gap: it
  // resolves the family to its registered producer (via FLEET_FAMILIES →
  // scheduleId → schedules) and runs an OPERATOR-triggered tick
  // (`tick({ triggered: true, filter })`), which enqueues one per-service job
  // through the SAME job-producer path a cron tick uses — it does NOT
  // reimplement the worker. Combined with `/api/probes/:id/trigger` (the
  // in-process registered probes), EVERY probe is now on-demand triggerable.
  //
  // Mounted ONLY when `triggerToken` is supplied (mirrors `/api/probes`); the
  // bearer gate is constructed up-front so a missing token fails loud at boot
  // rather than exposing an unauthenticated trigger.
  // ─────────────────────────────────────────────────────────────────────
  if (deps.triggerToken !== undefined) {
    const auth = bearerAuth({ expectedToken: deps.triggerToken });
    const triggerBodyLimit = bodyLimit({
      maxSize: FLEET_TRIGGER_BODY_LIMIT_BYTES,
      onError: (c) =>
        c.json({ error: "payload_too_large" } as const, 413) as unknown as
          | Response
          | Promise<Response>,
    });
    // Per-family last-trigger timestamp for the rate-limit window.
    const lastTriggerAt = new Map<string, number>();
    // family → scheduleId. Mirrors the FLEET_FAMILIES registry's family↔
    // scheduleId join, but reads the scheduleId from the constants DIRECTLY
    // rather than `fam.scheduleId`: `FLEET_FAMILIES` and the SCHEDULE_ID
    // constants live in a documented import cycle (run-view ⇄ control-plane),
    // so depending on module load order `fam.scheduleId` can be the cycle's
    // undefined snapshot — the constants themselves (plain string literals
    // with no cycle dependency) are always defined. Keyed off the registry's
    // `family` ids so adding a family is still a one-line registry change.
    const familyToScheduleId: Record<string, string> = {
      d6: FLEET_PRODUCER_SCHEDULE_ID,
      d5: FLEET_PRODUCER_DEEP_SCHEDULE_ID,
      "e2e-demos": FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
      "e2e-smoke": FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
    };
    // family → producer schedule, joined via the injected schedules. A family
    // whose scheduleId has no schedule entry is unfireable here (404) — same
    // UX as an unknown family.
    const scheduleById = new Map(deps.schedules.map((s) => [s.scheduleId, s]));
    const producerByFamily = new Map<string, ProducerSchedule>();
    for (const fam of FLEET_FAMILIES) {
      const scheduleId = familyToScheduleId[fam.family];
      const sched = scheduleId ? scheduleById.get(scheduleId) : undefined;
      if (sched) producerByFamily.set(fam.family, sched);
    }

    app.post("/api/runs/:family/trigger", auth, triggerBodyLimit, async (c) => {
      c.header("Cache-Control", "no-cache");
      const family = c.req.param("family");
      const sched = producerByFamily.get(family);
      if (!sched) {
        return c.json({ error: "not_found" }, 404);
      }

      // Read + validate the body BEFORE stamping the rate-limit window so a
      // malformed filter never burns the operator's hold (mirrors /api/probes).
      let raw: string;
      try {
        raw = await c.req.text();
      } catch (err) {
        if (err instanceof Error && err.name === "BodyLimitError") {
          return c.json({ error: "payload_too_large" }, 413);
        }
        return c.json({ error: "invalid_body" }, 400);
      }
      if (Buffer.byteLength(raw, "utf8") > FLEET_TRIGGER_BODY_LIMIT_BYTES) {
        return c.json({ error: "payload_too_large" }, 413);
      }

      // Optional operator filter — `slugs` (string[]) scopes which services
      // enumerate; `featureTypes` (non-empty string[]) narrows cells. Both
      // forwarded verbatim to the producer's TickOptions.filter.
      let filter: { slugs?: string[]; featureTypes?: string[] } | undefined;
      if (raw.length > 0) {
        let parsed: { filter?: { slugs?: unknown; featureTypes?: unknown } };
        try {
          parsed = JSON.parse(raw) as {
            filter?: { slugs?: unknown; featureTypes?: unknown };
          };
        } catch {
          return c.json({ error: "invalid_json" }, 400);
        }
        if (parsed && typeof parsed === "object" && parsed.filter) {
          const slugs = (parsed.filter as { slugs?: unknown }).slugs;
          let outSlugs: string[] | undefined;
          if (slugs !== undefined) {
            if (
              !Array.isArray(slugs) ||
              !slugs.every((s): s is string => typeof s === "string")
            ) {
              return c.json({ error: "invalid_filter" }, 400);
            }
            outSlugs = slugs;
          }
          const featureTypes = (parsed.filter as { featureTypes?: unknown })
            .featureTypes;
          let outFeatureTypes: string[] | undefined;
          if (featureTypes !== undefined) {
            if (
              !Array.isArray(featureTypes) ||
              featureTypes.length === 0 ||
              !featureTypes.every(
                (s): s is string => typeof s === "string" && s.length > 0,
              )
            ) {
              return c.json(
                {
                  error: "invalid_filter",
                  message: "featureTypes must be a non-empty array of strings",
                },
                400,
              );
            }
            outFeatureTypes = featureTypes;
          }
          if (outSlugs !== undefined || outFeatureTypes !== undefined) {
            filter = {
              ...(outSlugs !== undefined ? { slugs: outSlugs } : {}),
              ...(outFeatureTypes !== undefined
                ? { featureTypes: outFeatureTypes }
                : {}),
            };
          }
        }
      }

      // Stamp the rate-limit window AFTER validation passes, with a CAS
      // rollback on failure so a concurrent trigger's stamp survives.
      const last = lastTriggerAt.get(family);
      const t = now();
      if (last !== undefined && t - last < FLEET_TRIGGER_RATE_LIMIT_MS) {
        return c.json(
          {
            error: "rate_limited",
            retryAfterMs: FLEET_TRIGGER_RATE_LIMIT_MS - (t - last),
          },
          429,
        );
      }
      lastTriggerAt.set(family, t);
      const rollbackRateLimit = (): void => {
        if (lastTriggerAt.get(family) !== t) return;
        if (last === undefined) lastTriggerAt.delete(family);
        else lastTriggerAt.set(family, last);
      };

      try {
        // Operator-triggered tick: bypasses the producer's backlog gate and
        // enqueues one per-service job through the existing producer path. A
        // filter is TRIGGER-ONLY (the producer ignores filters on scheduled
        // ticks); forwarding it under `triggered: true` is the supported scope.
        const result = await sched.producer.tick({
          triggered: true,
          ...(filter !== undefined ? { filter } : {}),
        });
        return c.json({
          family,
          runId: result.runId,
          enqueued: result.enqueued,
          enqueueFailures: result.enqueueFailures,
          skippedForBacklog: result.skippedForBacklog,
          scope: filter?.slugs ?? null,
          featureTypesScope: filter?.featureTypes ?? null,
        });
      } catch (err) {
        // A producer tick never rejects by contract, but guard anyway: roll
        // back the rate-limit stamp so a transient failure doesn't lock the
        // operator out of the window for the next 5 minutes.
        rollbackRateLimit();
        deps.logger.error("fleet-runs.trigger-failed", {
          family,
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ family, error: "trigger_failed" }, 500);
      }
    });
  }
}
