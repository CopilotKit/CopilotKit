import type { PbClient } from "../storage/pb-client.js";

/**
 * Canonical PocketBase collection name for per-invocation probe-run history.
 * Imported by the probe-invoker hook (B7) and the status-route handler (B3)
 * — keep the literal in one place so a rename can't go half-applied.
 *
 * The matching PB migration lives in
 * `showcase/pocketbase/pb_migrations/<unix>_create_probe_runs.js`.
 */
export const PROBE_RUNS_COLLECTION = "probe_runs";

/**
 * Lifecycle states for a probe run row.
 *   - `running`: row was inserted by `start()`; `finished_at` is null.
 *   - `completed`: probe finished without raising. `summary` carries
 *     pass/fail counts.
 *   - `failed`: probe raised or otherwise terminated abnormally.
 *     `summary` may still be populated with the partial result.
 *
 * The `error` State enum used elsewhere in showcase-harness is per-result, not
 * per-run, so we keep the run-level enum deliberately narrow.
 */
export type ProbeRunState = "running" | "completed" | "failed";

/** JSON blob persisted into the `summary` column. */
export interface ProbeRunSummary {
  total: number;
  passed: number;
  failed: number;
  /**
   * Optional per-target breakdown. Kept as `unknown[]` so callers that
   * already produce richer per-target shapes (Railway service records,
   * smoke-result rows) don't have to flatten down to a closed-enum.
   */
  services?: unknown[];
  /**
   * §4.2 run-visibility reds counters, written by the fleet result
   * aggregator: counts of durable State transitions across the job's
   * aggregate + cell `WriteOutcome`s (green→red introduced, red→green
   * cleared; error ticks excluded — a probe that errored neither introduced
   * nor cleared a red). Absent on pre-P2 rows → the run-visibility API
   * serializes `null` for them.
   */
  redsIntroduced?: number;
  redsCleared?: number;
}

/**
 * Camel-case view of a `probe_runs` row, returned by `recent()`. Matches
 * the rest of showcase-harness's read path (status route returns camelCase
 * to web consumers; storage stays snake_case to match PB column names).
 */
export interface ProbeRunRecord {
  id: string;
  probeId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  triggered: boolean;
  state: ProbeRunState;
  summary: ProbeRunSummary | null;
}

/**
 * The terminal-vs-running disposition of a `probe_runs` row, returned by
 * `findByJobId` so the fleet aggregator can decide between SKIP (already fully
 * applied) and RESUME (a previous attempt crashed mid-aggregate).
 */
export interface ProbeRunByJob {
  id: string;
  /** True once the row reached a terminal state (`completed` | `failed`). */
  terminal: boolean;
}

export interface ProbeRunWriter {
  /**
   * Insert a `running` row. Returns the new row id so the caller can pass
   * it to `finish()` once the probe completes. `startedAt` is a numeric
   * epoch-ms (matching `Date.now()`) — converted to ISO inside.
   *
   * `jobId` (optional) stamps the fleet `probe_jobs` row id onto the run so
   * the aggregator can dedupe a re-processed result (see `findByJobId`). The
   * in-process probe-invoker omits it (no job); only the fleet aggregator
   * supplies it.
   */
  start(opts: {
    probeId: string;
    startedAt: number;
    triggered: boolean;
    jobId?: string;
  }): Promise<{ id: string }>;
  /**
   * Find the run row previously stamped with `jobId`, or null when none
   * exists. The fleet aggregator calls this BEFORE doing any work so a
   * re-processed result (latch write failed, or crash before latch) is a true
   * idempotent no-op rather than re-bumping flap counts / appending duplicate
   * history / minting a duplicate run row. Returns the row id + whether it is
   * terminal so the caller can SKIP (terminal) vs RESUME (still running).
   */
  findByJobId(jobId: string): Promise<ProbeRunByJob | null>;
  /**
   * Persist a partial rollup onto a still-`running` row WITHOUT marking it
   * terminal. Called incrementally as each fan-out target completes so an
   * orphaned row (orchestrator process killed mid-run — e.g. a pool-churn
   * burst) already carries the partial per-service results the run had
   * computed. Without this, a `running` row that never reaches `finish()`
   * has a null summary, and the boot-time `sweepStaleRuns` has nothing to
   * preserve — the dashboard then shows `failed / total:0` even though
   * dozens of features actually passed. State stays `running`; only
   * `summary` is updated. Best-effort, like `finish()`.
   */
  update(opts: { id: string; summary: ProbeRunSummary }): Promise<void>;
  /**
   * Mark a row finished. `duration_ms` is computed from
   * `finishedAt - row.started_at` (read off the persisted row, not from a
   * caller-supplied startedAt) so the contract holds even if the caller
   * forgets to thread the same monotonic clock through both calls.
   */
  finish(opts: {
    id: string;
    finishedAt: number;
    state: "completed" | "failed";
    summary: ProbeRunSummary | null;
  }): Promise<void>;
  /**
   * Return the last `limit` runs for `probeId`, sorted by `started_at`
   * descending (newest first). Returns an empty array when no rows match.
   */
  recent(probeId: string, limit: number): Promise<ProbeRunRecord[]>;
}

/**
 * Snake-case row shape matching the PB collection schema. Only the fields
 * that run-history.ts persists — extra columns added by future migrations
 * are tolerated by PB but ignored here.
 */
interface ProbeRunRow {
  id: string;
  probe_id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  triggered: boolean;
  state: ProbeRunState;
  summary: ProbeRunSummary | null;
  /** Fleet job id (empty for in-process probe-invoker runs). */
  job_id?: string;
}

function toRecord(row: ProbeRunRow): ProbeRunRecord {
  return {
    id: row.id,
    probeId: row.probe_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
    durationMs: row.duration_ms ?? null,
    triggered: row.triggered,
    state: row.state,
    summary: row.summary ?? null,
  };
}

export function createProbeRunWriter(pb: PbClient): ProbeRunWriter {
  return {
    async start(opts) {
      const created = await pb.create<ProbeRunRow>(PROBE_RUNS_COLLECTION, {
        probe_id: opts.probeId,
        started_at: new Date(opts.startedAt).toISOString(),
        finished_at: null,
        duration_ms: null,
        triggered: opts.triggered,
        state: "running",
        summary: null,
        // Empty string (not undefined) for the no-job in-process path so the
        // column is cleanly "no job" rather than absent — matches how the
        // workers row stores an idle current_job_id.
        job_id: opts.jobId ?? "",
      });
      return { id: created.id };
    },

    async findByJobId(jobId) {
      // The fleet aggregator dedupes on a NON-empty job id; an empty/blank id
      // would match the whole in-process-probe population, so guard it.
      if (!jobId) return null;
      const filter = `job_id = ${JSON.stringify(jobId)}`;
      const result = await pb.list<ProbeRunRow>(PROBE_RUNS_COLLECTION, {
        filter,
        // Newest first so if (pathologically) more than one row carries the id,
        // we report the most recent disposition.
        sort: "-started_at",
        perPage: 1,
        skipTotal: true,
      });
      const row = result.items[0];
      if (!row) return null;
      return {
        id: row.id,
        terminal: row.state === "completed" || row.state === "failed",
      };
    },

    async update(opts) {
      // Refresh only the partial summary on a still-running row. We leave
      // `state`, `finished_at`, and `duration_ms` untouched so this can be
      // called repeatedly mid-run without prematurely marking the row
      // terminal. The row must exist (start() created it); a missing row
      // means the caller is updating an id it never created — surface it
      // rather than silently writing junk, mirroring finish()'s guard.
      const existing = await pb.getOne<ProbeRunRow>(
        PROBE_RUNS_COLLECTION,
        opts.id,
      );
      if (!existing) {
        // eslint-disable-next-line no-console
        console.warn("run-history.update: row missing", { runId: opts.id });
        return;
      }
      await pb.update<ProbeRunRow>(PROBE_RUNS_COLLECTION, opts.id, {
        summary: opts.summary,
      });
    },

    async finish(opts) {
      // Read the persisted started_at so duration is always defined off
      // the row — see the JSDoc on `finish()` for why we don't trust a
      // caller-supplied startedAt.
      //
      // R2-A.7: when the row is missing (returns null), do NOT call
      // pb.update on a non-existent id. The previous code fell through
      // with NaN duration and either threw on the underlying client or
      // silently wrote a junk row. Log a warning so the missing-row
      // case is observable, then return early. This is best-effort
      // observability — never throw, never block the caller (the
      // probe-invoker already swallows runWriter failures, but make
      // the writer itself behave gracefully too).
      const existing = await pb.getOne<ProbeRunRow>(
        PROBE_RUNS_COLLECTION,
        opts.id,
      );
      if (!existing) {
        // eslint-disable-next-line no-console
        console.warn("run-history.finish: row missing", {
          runId: opts.id,
        });
        return;
      }
      const startedAtMs = existing.started_at
        ? Date.parse(existing.started_at)
        : Number.NaN;
      const durationMs = Number.isFinite(startedAtMs)
        ? opts.finishedAt - startedAtMs
        : null;
      await pb.update<ProbeRunRow>(PROBE_RUNS_COLLECTION, opts.id, {
        finished_at: new Date(opts.finishedAt).toISOString(),
        duration_ms: durationMs,
        state: opts.state,
        summary: opts.summary,
      });
    },

    async recent(probeId, limit) {
      // PB filter literals are double-quoted with backslash escaping;
      // JSON.stringify produces exactly that shape so a probeId
      // containing quotes (`smoke"; DROP …`) is escaped, not interpolated.
      const filter = `probe_id = ${JSON.stringify(probeId)}`;
      const result = await pb.list<ProbeRunRow>(PROBE_RUNS_COLLECTION, {
        filter,
        sort: "-started_at",
        perPage: limit,
        skipTotal: true,
      });
      return result.items.map(toRecord);
    },
  };
}

/**
 * Mark any `running` rows older than `maxAgeMs` as `failed`. Called once
 * at orchestrator boot to clean up zombie runs left by a previous process
 * that died before calling `finish()` (e.g. Railway redeploy, OOM kill).
 *
 * Without this, zombie rows stay `running` forever — the harness API
 * lists them as in-flight, and the dashboard shows stale partial results.
 */
export async function sweepStaleRuns(
  pb: PbClient,
  maxAgeMs: number = 15 * 60 * 1000,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const filter = `state = "running" && started_at < ${JSON.stringify(cutoff)}`;
  const stale = await pb.list<ProbeRunRow>(PROBE_RUNS_COLLECTION, {
    filter,
    perPage: 50,
    skipTotal: true,
  });
  let swept = 0;
  for (const row of stale.items) {
    try {
      // Partial-rollup preservation: an orphaned `running` row may already
      // carry the partial per-service rollup the invoker persisted
      // incrementally (`runWriter.update`) before the process died. Marking
      // the run `failed` is correct (it WAS aborted), but clobbering the
      // summary to `{0,0,0}` discards real work — a 578s D6 run with dozens
      // of green features would surface as `failed / total:0`. Keep the
      // existing summary when present; fall back to an explicit empty
      // rollup only for rows that died before any target completed.
      const summary = row.summary ?? { total: 0, passed: 0, failed: 0 };
      // Derive a real duration from the persisted started_at when possible
      // so a preserved partial run still reports how long it actually ran.
      const finishedAt = Date.now();
      const startedAtMs = row.started_at
        ? Date.parse(row.started_at)
        : Number.NaN;
      const durationMs = Number.isFinite(startedAtMs)
        ? finishedAt - startedAtMs
        : null;
      await pb.update<ProbeRunRow>(PROBE_RUNS_COLLECTION, row.id, {
        state: "failed",
        finished_at: new Date(finishedAt).toISOString(),
        duration_ms: durationMs,
        summary,
      });
      swept++;
    } catch (err) {
      // Best-effort — a single failing sweep update must not block boot, but it
      // must be OBSERVABLE: a silently-discarded PB failure leaves a zombie
      // `running` row in place with no trace of why. Log the row id + error
      // (console.warn, consistent with this file's other PB guards) and
      // continue to the next stale row.
      // eslint-disable-next-line no-console
      console.warn("run-history.sweepStaleRuns: row update failed", {
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return swept;
}
