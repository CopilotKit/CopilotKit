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
 * The `error` State enum used elsewhere in showcase-ops is per-result, not
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
}

/**
 * Camel-case view of a `probe_runs` row, returned by `recent()`. Matches
 * the rest of showcase-ops's read path (status route returns camelCase
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

export interface ProbeRunWriter {
  /**
   * Insert a `running` row. Returns the new row id so the caller can pass
   * it to `finish()` once the probe completes. `startedAt` is a numeric
   * epoch-ms (matching `Date.now()`) — converted to ISO inside.
   */
  start(opts: {
    probeId: string;
    startedAt: number;
    triggered: boolean;
  }): Promise<{ id: string }>;
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
      });
      return { id: created.id };
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
