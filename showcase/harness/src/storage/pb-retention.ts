/**
 * pb-retention.ts — scheduled age-based retention for the append-only
 * telemetry collections that otherwise grow without bound:
 *
 *   - `cvdiag_events`  (cvdiag/pb-writer.ts, cvdiag/pb-writer-fetch.ts, and the
 *                       Python integrations' _cvdiag_backend.py)
 *   - `diag_events`    (storage/diag-sink.ts)
 *   - `status_history` (writers/status-writer.ts + the fleet-observations hook)
 *   - `probe_runs`     (probes/run-history.ts)
 *
 * Same shape as the `probe_jobs` §4.2 prune (`FleetQueueClient.pruneAged`):
 * a per-collection age cutoff, idempotent record-level deletes, single owner
 * (the control plane registers exactly one `internal:pb-retention` cron), and
 * best-effort — a failure is logged and the next pass retries.
 *
 * WHY BATCHED + BUDGETED (not `deleteByFilter`): production `data.db` is tens
 * of GB in WAL mode and the first pass faces millions of expired rows.
 * `deleteByFilter` loops until the filter is empty (and THROWS past 20k rows),
 * so it can neither drain a backlog nor bound one pass's work. Here each pass:
 *   - lists ONE page of the OLDEST expired ids (`sort` on the cutoff field, so
 *     the read is an index range scan; `fields=id` so no row bodies — a
 *     `status_history.signal` can be up to 2 MB — cross the wire);
 *   - deletes them with a small concurrency cap. Every delete is its own tiny
 *     SQLite transaction, so the write lock is held for one row at a time and
 *     other writers interleave freely; the WAL never accumulates one huge
 *     transaction;
 *   - stops at `maxRowsPerCollection` per collection, at the pass deadline,
 *     and when the caller aborts (control-plane shutdown), so a backlog
 *     drains GRADUALLY across passes instead of in one huge pass.
 * The starting collection rotates every pass so a deep backlog in one
 * collection can never starve the others of deadline time.
 *
 * A row PB refuses to delete (a per-row 4xx, e.g. a 400 from a required
 * relation that still points at it) is logged with its status and skipped
 * for the rest of the pass, so one undeletable oldest row cannot block the
 * collection. Any other failure stops the collection leg; in-flight deletes
 * are awaited and counted before the leg returns.
 *
 * Deleting rows does not shrink the SQLite file; freed pages are reused by
 * new inserts, so the volume stops GROWING once retention keeps pace with the
 * insert rate. Reclaiming the existing file size needs an explicit VACUUM.
 */

import type { Logger } from "../types/index.js";
import { PbHttpError } from "./pb-client.js";
import type { PbClient } from "./pb-client.js";

const DAY_MS = 24 * 3600_000;

/**
 * How a collection's cutoff field stores time, which decides the filter
 * literal. PB `date` fields (`created`, `started_at`) are stored as
 * `YYYY-MM-DD HH:MM:SS.sssZ` (space separator); an ISO literal (`T`
 * separator) compares lexicographically WRONG against them for every row on
 * the cutoff's own day (" " < "T"), so date fields get the PB shape.
 * `iso-text` is only safe for a TEXT field that always holds canonical
 * `Date#toISOString()` values; no default target uses it.
 */
export type RetentionFieldKind = "pb-date" | "iso-text";

export interface RetentionTarget {
  collection: string;
  /** The field the cutoff compares against. MUST lead an index. */
  field: string;
  fieldKind: RetentionFieldKind;
  /** Rows whose `field` is older than now - maxAgeMs are deleted. */
  maxAgeMs: number;
}

/**
 * Default windows: 30 days for all four collections. Consumers checked:
 *   - status_history: the only reader is the dashboard tooltip
 *     (shell-dashboard useLastTransition — newest row per key); no trend
 *     chart, rollup, alert or flap monitor reads it (alerts use the
 *     in-process WriteOutcome). Every tick of a live key appends a row
 *     (sustained ticks included), so a key that is still being probed always
 *     keeps a row far younger than 30 d and the tooltip never goes blank;
 *     retention only trims older history. A key that stops being probed
 *     loses its rows 30 d after its last tick.
 *   - probe_runs: `recent(probeId, N)` (last N runs), `findByJobId` dedupe
 *     and the fleet-runs reds join — the latter two are bounded by the
 *     probe_jobs 14 d prune, so 30 d is strictly longer than any join needs.
 *   - cvdiag_events: the cvdiag classify/replay CLIs look up one test_id at a
 *     time during an investigation.
 *   - diag_events: no reader in the repo (incident forensic trail pulled by
 *     hand over HTTP).
 */
export const DEFAULT_RETENTION_DAYS = 30;

export const DEFAULT_RETENTION_TARGETS: readonly RetentionTarget[] = [
  {
    collection: "cvdiag_events",
    // `created` (server-stamped), NOT the writer-supplied free-text `ts`. The
    // Python writers send `isoformat()` shapes, and any writer-role client
    // can send an offset or space-separated form or a non-date like "n/a";
    // compared as text those are deleted early or never deleted. Indexed by
    // idx_cvdiag_events_created.
    field: "created",
    fieldKind: "pb-date",
    maxAgeMs: DEFAULT_RETENTION_DAYS * DAY_MS,
  },
  {
    collection: "diag_events",
    // Indexed by migration 1779990700_retention_created_indexes.
    field: "created",
    fieldKind: "pb-date",
    maxAgeMs: DEFAULT_RETENTION_DAYS * DAY_MS,
  },
  {
    collection: "status_history",
    // `created` (server-stamped) rather than `observed_at`, which the writer
    // may substitute or backdate. Indexed by 1779990700.
    field: "created",
    fieldKind: "pb-date",
    maxAgeMs: DEFAULT_RETENTION_DAYS * DAY_MS,
  },
  {
    collection: "probe_runs",
    // Indexed: idx_probe_runs_started.
    field: "started_at",
    fieldKind: "pb-date",
    maxAgeMs: DEFAULT_RETENTION_DAYS * DAY_MS,
  },
];

/** PocketBase serves at most 500 rows per list page, whatever perPage asks. */
export const PB_MAX_PAGE_SIZE = 500;
/** Rows listed (and then deleted) per batch. Clamped to PB_MAX_PAGE_SIZE. */
export const DEFAULT_RETENTION_BATCH_SIZE = 200;
/** Per-collection row cap for one pass. */
export const DEFAULT_RETENTION_MAX_ROWS_PER_COLLECTION = 50_000;
/** In-flight deletes per batch. PB serializes writes; this only hides RTT. */
export const DEFAULT_RETENTION_DELETE_CONCURRENCY = 4;
/** Wall-clock budget for one pass — keep below the cron period. */
export const DEFAULT_RETENTION_PASS_DEADLINE_MS = 4 * 60_000;
/** Pause between batches so other writers get the lock between bursts. */
export const DEFAULT_RETENTION_BATCH_PAUSE_MS = 25;
/**
 * How long control-plane stop() waits for an aborted pass to settle. An
 * in-flight PB request does not see the abort and the PB client can retry for
 * about 50 s, so shutdown stops waiting after this grace. Deletes are
 * idempotent; one left in flight is harmless.
 */
export const RETENTION_ABORT_GRACE_MS = 3_000;
/** Cron for the control-plane `internal:pb-retention` job. */
export const RETENTION_CRON = "*/5 * * * *";
/** Smallest window an env override may set (guards a fat-fingered `0`). */
export const MIN_RETENTION_DAYS = 1;
/** Largest window an env override may set (~10 years; keeps the cutoff a valid Date). */
export const MAX_RETENTION_DAYS = 3650;
/** Ids PB refused that one collection leg skips before it gives up for the pass. */
export const MAX_SKIPPED_IDS_PER_COLLECTION = 50;

export interface RetentionOptions {
  targets: readonly RetentionTarget[];
  batchSize: number;
  maxRowsPerCollection: number;
  deleteConcurrency: number;
  passDeadlineMs: number;
  batchPauseMs: number;
}

export interface RetentionCollectionResult {
  collection: string;
  /** Rows deleted this pass. */
  deleted: number;
  /** Rows PB refused to delete (per-row 4xx), skipped for the rest of the pass. */
  failed: number;
  /** Delete batches issued this pass. */
  batches: number;
  /**
   * True only when the last list returned a short page AND every row on it
   * was deleted: the pass was not aborted, did not stop mid-batch (deadline
   * or failure), and no row PB refused is still left.
   */
  drained: boolean;
  /** Set when this collection's leg failed; other collections still ran. */
  error?: string;
}

export interface RetentionPassResult {
  collections: RetentionCollectionResult[];
  deleted: number;
  durationMs: number;
  /** True when the pass stopped on its deadline with work possibly left. */
  hitDeadline: boolean;
  /** True when the caller's AbortSignal stopped the pass early. */
  aborted: boolean;
}

export interface PbRetention {
  /**
   * One bounded retention pass. Never throws; per-collection errors are
   * reported. `signal` stops the pass between deletes; in-flight deletes are
   * awaited, never abandoned. The cron passes the control-plane shutdown
   * signal.
   */
  runPass(nowMs?: number, signal?: AbortSignal): Promise<RetentionPassResult>;
}

export interface PbRetentionDeps {
  pb: Pick<PbClient, "list" | "delete">;
  logger: Logger;
  options?: Partial<RetentionOptions>;
  /** Clock for the pass deadline. Defaults to Date.now. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Format a cutoff for a PB filter literal on a field of the given kind. */
export function retentionCutoffLiteral(
  cutoffMs: number,
  kind: RetentionFieldKind,
): string {
  const iso = new Date(cutoffMs).toISOString();
  return kind === "pb-date" ? iso.replace("T", " ") : iso;
}

/**
 * The HTTP status of a per-row refusal: PB rejected THIS row (validation,
 * relation reference, hook). Auth (401/403) and rate limiting (429) are
 * systemic, so they stop the leg instead.
 */
function refusalStatus(err: unknown): number | undefined {
  if (!(err instanceof PbHttpError)) return undefined;
  const status = err.statusCode;
  return status >= 400 && status < 500 && ![401, 403, 404, 429].includes(status)
    ? status
    : undefined;
}

/** Through a call, so the loop-condition lint sees the signal can change. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createPbRetention(deps: PbRetentionDeps): PbRetention {
  const { pb, logger } = deps;
  const opts: RetentionOptions = {
    targets: DEFAULT_RETENTION_TARGETS,
    batchSize: DEFAULT_RETENTION_BATCH_SIZE,
    maxRowsPerCollection: DEFAULT_RETENTION_MAX_ROWS_PER_COLLECTION,
    deleteConcurrency: DEFAULT_RETENTION_DELETE_CONCURRENCY,
    passDeadlineMs: DEFAULT_RETENTION_PASS_DEADLINE_MS,
    batchPauseMs: DEFAULT_RETENTION_BATCH_PAUSE_MS,
    ...deps.options,
  };
  if (opts.batchSize > PB_MAX_PAGE_SIZE) {
    // PB would silently serve 500 rows, and a short page is how a leg
    // decides it has drained.
    opts.batchSize = PB_MAX_PAGE_SIZE;
  }
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Rotates every pass so no collection is permanently last in line for
  // deadline time.
  let startIndex = 0;

  interface BatchOutcome {
    deleted: number;
    /** Ids PB refused (per-row 4xx), with the HTTP status. */
    refused: Array<{ id: string; status: number; err: string }>;
    /** The first other failure; the batch stopped taking new ids. */
    failure?: unknown;
  }

  /**
   * Delete `ids` with up to `deleteConcurrency` workers. A failure, an abort
   * or the pass deadline stops every worker from taking another id, and this
   * resolves only
   * after every in-flight delete has settled, so no delete outlives the pass
   * and every success is counted.
   */
  async function deleteIds(
    collection: string,
    ids: string[],
    deadlineMs: number,
    signal: AbortSignal | undefined,
  ): Promise<BatchOutcome> {
    const outcome: BatchOutcome = { deleted: 0, refused: [] };
    let next = 0;
    let stop = false;
    const worker = async (): Promise<void> => {
      while (
        !stop &&
        !isAborted(signal) &&
        now() < deadlineMs &&
        next < ids.length
      ) {
        const id = ids[next]!;
        next += 1;
        try {
          // `delete` treats a 404 (row already gone) as success.
          await pb.delete(collection, id);
          outcome.deleted += 1;
        } catch (err) {
          const status = refusalStatus(err);
          if (status !== undefined) {
            outcome.refused.push({ id, status, err: errorMessage(err) });
          } else {
            stop = true;
            outcome.failure ??= err;
          }
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(opts.deleteConcurrency, ids.length) },
        worker,
      ),
    );
    return outcome;
  }

  async function pruneCollection(
    target: RetentionTarget,
    cutoffMs: number,
    deadlineMs: number,
    signal: AbortSignal | undefined,
  ): Promise<RetentionCollectionResult> {
    const result: RetentionCollectionResult = {
      collection: target.collection,
      deleted: 0,
      failed: 0,
      batches: 0,
      drained: false,
    };
    // Ids PB refused this pass, excluded from later lists so the oldest-first
    // scan moves past them.
    const skipped: string[] = [];
    try {
      const literal = retentionCutoffLiteral(cutoffMs, target.fieldKind);
      const baseFilter = `${target.field} < ${JSON.stringify(literal)}`;
      while (
        result.deleted + result.failed < opts.maxRowsPerCollection &&
        now() < deadlineMs &&
        !isAborted(signal)
      ) {
        const perPage = Math.min(
          opts.batchSize,
          opts.maxRowsPerCollection - result.deleted - result.failed,
        );
        const filter = [
          baseFilter,
          ...skipped.map((id) => `id != ${JSON.stringify(id)}`),
        ].join(" && ");
        const page = await pb.list<{ id: string }>(target.collection, {
          filter,
          sort: target.field,
          perPage,
          fields: "id",
          skipTotal: true,
        });
        const ids = page.items.map((item) => item.id);
        // Every listed id was deleted (none refused, none left by a stop).
        let batchComplete = true;
        if (ids.length > 0) {
          const outcome = await deleteIds(
            target.collection,
            ids,
            deadlineMs,
            signal,
          );
          result.deleted += outcome.deleted;
          result.failed += outcome.refused.length;
          result.batches += 1;
          batchComplete = outcome.deleted === ids.length;
          for (const refusal of outcome.refused) {
            skipped.push(refusal.id);
            logger.warn("pb-retention.delete-refused", {
              collection: target.collection,
              id: refusal.id,
              status: refusal.status,
              err: refusal.err,
            });
          }
          if (outcome.failure !== undefined) throw outcome.failure;
          if (skipped.length > MAX_SKIPPED_IDS_PER_COLLECTION) {
            throw new Error(
              `pb refused ${skipped.length} deletes this pass; skipping ${target.collection} until the next pass`,
            );
          }
        }
        if (ids.length < perPage) {
          result.drained =
            batchComplete && skipped.length === 0 && !isAborted(signal);
          break;
        }
        if (isAborted(signal) || now() >= deadlineMs) break;
        if (opts.batchPauseMs > 0) await sleep(opts.batchPauseMs);
      }
    } catch (err) {
      result.error = errorMessage(err);
      logger.warn("pb-retention.collection-failed", {
        collection: target.collection,
        deleted: result.deleted,
        ...(err instanceof PbHttpError ? { status: err.statusCode } : {}),
        err: result.error,
      });
    }
    return result;
  }

  return {
    async runPass(nowMs = now(), signal?: AbortSignal) {
      const startedAt = now();
      const deadlineMs = startedAt + opts.passDeadlineMs;
      const count = opts.targets.length;
      const order = Array.from(
        { length: count },
        (_, i) => opts.targets[(startIndex + i) % count],
      );
      startIndex = count === 0 ? 0 : (startIndex + 1) % count;
      const collections: RetentionCollectionResult[] = [];
      for (const target of order) {
        if (now() >= deadlineMs) {
          collections.push({
            collection: target.collection,
            deleted: 0,
            failed: 0,
            batches: 0,
            drained: false,
          });
          continue;
        }
        collections.push(
          await pruneCollection(
            target,
            nowMs - target.maxAgeMs,
            deadlineMs,
            signal,
          ),
        );
      }
      const deleted = collections.reduce((sum, c) => sum + c.deleted, 0);
      const hitDeadline = now() >= deadlineMs;
      const aborted = signal?.aborted ?? false;
      const durationMs = now() - startedAt;
      const summary = {
        deleted,
        durationMs,
        hitDeadline,
        aborted,
        collections: collections.map((c) => ({
          collection: c.collection,
          deleted: c.deleted,
          failed: c.failed,
          batches: c.batches,
          drained: c.drained,
          ...(c.error !== undefined ? { error: c.error } : {}),
        })),
      };
      if (
        deleted > 0 ||
        aborted ||
        collections.some((c) => c.error !== undefined || c.failed > 0)
      ) {
        logger.info("pb-retention.pass-complete", summary);
      } else {
        logger.debug("pb-retention.pass-complete", summary);
      }
      return { collections, deleted, durationMs, hitDeadline, aborted };
    },
  };
}

/**
 * Env-driven configuration for the control-plane retention job.
 *
 *   PB_RETENTION_ENABLED                kill switch, default on; false, 0, no
 *                                       or off (any case) turn it off
 *   PB_RETENTION_CVDIAG_EVENTS_DAYS     default 30
 *   PB_RETENTION_DIAG_EVENTS_DAYS       default 30
 *   PB_RETENTION_STATUS_HISTORY_DAYS    default 30
 *   PB_RETENTION_PROBE_RUNS_DAYS        default 30
 *   PB_RETENTION_MAX_ROWS_PER_PASS      per-collection cap, default 50000
 *
 * An unparseable value, or a window outside [MIN_RETENTION_DAYS,
 * MAX_RETENTION_DAYS], falls back to the default with a warn. A typo that
 * parses to a smaller in-range window still shortens retention.
 */
export interface ResolvedRetentionConfig {
  enabled: boolean;
  options: Partial<RetentionOptions> & { targets: RetentionTarget[] };
}

const DAYS_ENV: Record<string, string> = {
  cvdiag_events: "PB_RETENTION_CVDIAG_EVENTS_DAYS",
  diag_events: "PB_RETENTION_DIAG_EVENTS_DAYS",
  status_history: "PB_RETENTION_STATUS_HISTORY_DAYS",
  probe_runs: "PB_RETENTION_PROBE_RUNS_DAYS",
};

const RETENTION_DISABLED_VALUES = new Set(["false", "0", "no", "off"]);

function readPositive(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  min: number,
  max: number,
  logger: Logger,
): number | undefined {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    logger.warn("pb-retention.invalid-env", {
      name,
      value: raw,
      min,
      max,
      hint: "ignoring the override and using the default",
    });
    return undefined;
  }
  return value;
}

export function resolveRetentionConfig(
  env: Readonly<Record<string, string | undefined>>,
  logger: Logger,
): ResolvedRetentionConfig {
  const enabled = !RETENTION_DISABLED_VALUES.has(
    (env.PB_RETENTION_ENABLED ?? "").trim().toLowerCase(),
  );
  const targets = DEFAULT_RETENTION_TARGETS.map((target) => {
    const envName = DAYS_ENV[target.collection];
    const days =
      envName === undefined
        ? undefined
        : readPositive(
            env,
            envName,
            MIN_RETENTION_DAYS,
            MAX_RETENTION_DAYS,
            logger,
          );
    return days === undefined
      ? { ...target }
      : { ...target, maxAgeMs: days * DAY_MS };
  });
  const maxRows = readPositive(
    env,
    "PB_RETENTION_MAX_ROWS_PER_PASS",
    1,
    Number.MAX_SAFE_INTEGER,
    logger,
  );
  return {
    enabled,
    options: {
      targets,
      ...(maxRows !== undefined
        ? { maxRowsPerCollection: Math.floor(maxRows) }
        : {}),
    },
  };
}
