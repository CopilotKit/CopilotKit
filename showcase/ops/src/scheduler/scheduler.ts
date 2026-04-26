import { Cron } from "croner";
import type { Logger } from "../types/index.js";
// B7: bind the in-flight tracker slot to the real ProbeRunTracker class
// (was a structural placeholder until B2 landed). The scheduler still
// never reads tracker fields itself — it just stores whatever the
// trigger() caller / probe-invoker writes via `setEntryTracker(id, t)`
// and surfaces it through `getEntry(id).tracker` for the HTTP layer.
import type { ProbeRunTracker } from "../probes/run-tracker.js";

export type { ProbeRunTracker };

/**
 * Optional pass/fail summary surfaced by handlers that internally know how
 * many sub-units (probe targets, etc.) ran. Scheduler-side typing only —
 * the actual ProbeRunTracker construction lives in the probe-invoker side
 * (B2). Handlers that don't return a summary leave `lastRunSummary` null.
 */
export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface ScheduleEntry {
  id: string;
  cron: string;
  /**
   * Per-tick callback. May return void (legacy) or a `RunSummary` so the
   * scheduler can surface pass/fail counts via `getEntry(id).lastRunSummary`.
   * Returning a non-RunSummary value is tolerated (treated as void) so the
   * existing legacy invoker (`() => Promise<void>`) keeps working unchanged.
   */
  handler: () => Promise<RunSummary | void> | RunSummary | void;
}

/**
 * Public, read-only snapshot of an entry's bookkeeping. Exposed via
 * `getEntry(id)` for the `/api/probes` HTTP routes (peer slot consumes
 * this) and for in-process orchestrator diagnostics.
 */
export interface EntryStatus {
  id: string;
  cron: string;
  /** Number of currently-inflight handler invocations (0 or 1 in normal use). */
  inflight: number;
  /** ms-since-epoch of the last tick start, null if the handler has never run. */
  lastRunStartedAt: number | null;
  /** ms-since-epoch of the last tick completion, null if no run has finished. */
  lastRunFinishedAt: number | null;
  /** Wall-clock duration of the last completed run, null until one finishes. */
  lastRunDurationMs: number | null;
  /** Last completed run's summary, when the handler returned one. */
  lastRunSummary: RunSummary | null;
  /** True while a trigger()-initiated run is executing; false during cron ticks. */
  triggeredRun: boolean;
  /** Live ProbeRunTracker, surfaced by trigger()/probe-invoker. Null otherwise. */
  tracker: ProbeRunTracker | null;
}

/**
 * Result of a successful `trigger(id, opts?)` call. The run executes
 * asynchronously; consumers correlate ticks via `runId`.
 */
export interface TriggerResult {
  runId: string;
  status: "queued" | "running";
  probe: string;
}

export interface TriggerOptions {
  filter?: { slugs?: string[] };
}

export interface Scheduler {
  register(entry: ScheduleEntry): void;
  /**
   * Remove a scheduled entry. Returns a Promise that resolves once any
   * in-flight handler tick for this id has drained. Callers that want to
   * guarantee "the old handler is done before I register a replacement"
   * MUST `await` the return value. Fire-and-forget callers get backup
   * drain behavior because `register()` for the same id transparently
   * awaits the outstanding drain before scheduling the new handler's
   * first tick (see the `pendingDrain` map below).
   */
  unregister(id: string): Promise<boolean>;
  hasEntry(id: string): boolean;
  list(): ScheduleEntry[];
  start(): void;
  stop(): Promise<void>;
  /** True once `start()` has been called and `stop()` has not yet run. */
  isStarted(): boolean;
  /** True once `stop()` has completed. */
  isStopped(): boolean;
  /** Current number of registered entries; `/health` uses this as a liveness check. */
  getJobCount(): number;
  /**
   * Read-only snapshot of an entry's bookkeeping. Returns `undefined` if
   * the entry was never registered (or was unregistered). Consumers MUST
   * NOT mutate the returned object — it's a fresh snapshot per call so
   * subsequent calls observe newly-recorded run state.
   */
  getEntry(id: string): EntryStatus | undefined;
  /**
   * B7: install (or clear) the in-flight ProbeRunTracker for an entry.
   * The probe-invoker calls this at run start to register a tracker so
   * `GET /api/probes` can render per-service progress, and again with
   * `null` once the run completes (success or failure). The scheduler
   * never reads tracker fields itself — it forwards whatever the invoker
   * writes here through `getEntry(id).tracker`. No-op if `id` is unknown.
   */
  setEntryTracker(id: string, tracker: ProbeRunTracker | null): void;
  /**
   * Manually invoke the handler associated with `id`, off the cron
   * schedule. Throws `InflightConflictError` if a tick (cron or trigger)
   * is already running for that id. Returns immediately with a generated
   * `runId`; the run executes asynchronously and observes the same
   * `max_concurrency` / `timeout_ms` constraints the scheduled path uses
   * (those bounds live inside the handler the probe-invoker built).
   */
  trigger(id: string, opts?: TriggerOptions): Promise<TriggerResult>;
  /**
   * Croner's next-fire timestamp for the entry, or null if the entry is
   * unknown / not yet started / has no future fire (croner returns null
   * once a one-shot rule has fired its single tick).
   */
  nextRunAt(id: string): Date | null;
}

export interface SchedulerOptions {
  logger: Logger;
}

export class SchedulerStoppedError extends Error {
  constructor(id: string) {
    super(`scheduler: cannot register ${id} after stop()`);
    this.name = "SchedulerStoppedError";
  }
}

/**
 * Thrown by `trigger(id)` when a handler invocation is already in flight
 * for the same id. Callers (e.g. `/api/probes/:id/trigger`) typically
 * translate this into HTTP 409.
 */
export class InflightConflictError extends Error {
  constructor(id: string) {
    super(`scheduler: trigger refused, ${id} is already inflight`);
    this.name = "InflightConflictError";
  }
}

interface EntrySlot {
  entry: ScheduleEntry;
  job: Cron | null;
  /** Tracks in-flight handler invocations so stop()/unregister() can drain them. */
  inflight: Set<Promise<void>>;
  /** Wall-clock start of the last tick; used for skip-log diagnostics. */
  lastRunStartedAt: number | null;
  /** Wall-clock finish of the last tick; populated once the wrapper resolves. */
  lastRunFinishedAt: number | null;
  /** Last tick's wall-clock duration; pairs with lastRunFinishedAt. */
  lastRunDurationMs: number | null;
  /** Last tick's pass/fail summary if the handler returned one. */
  lastRunSummary: RunSummary | null;
  /** True while a manual trigger run is executing. */
  triggeredRun: boolean;
  /** Optional live tracker stashed by the trigger / invoker layer. */
  tracker: ProbeRunTracker | null;
}

function isRunSummary(v: unknown): v is RunSummary {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).total === "number" &&
    typeof (v as Record<string, unknown>).passed === "number" &&
    typeof (v as Record<string, unknown>).failed === "number"
  );
}

let runIdCounter = 0;
function nextRunId(): string {
  runIdCounter += 1;
  // Composite of timestamp + monotonic counter avoids collisions for two
  // triggers that land in the same ms (test harness common case).
  return `run_${Date.now().toString(36)}_${runIdCounter.toString(36)}`;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const entries = new Map<string, EntrySlot>();
  /**
   * Per-id drain promises left behind by a prior `unregister(id)`. When
   * `register(id, ...)` later replaces the entry, the new handler's first
   * tick blocks on this so the old and new handlers can't run concurrently
   * for the same id. Populated by unregister, consumed (and cleared) by
   * register's startEntry.
   */
  const pendingDrain = new Map<string, Promise<void>>();
  let started = false;
  let stopped = false;

  /**
   * Validate a cron expression by instantiating a paused job. Croner throws
   * synchronously on bad syntax; rethrow with the rule id attached so boot
   * failures identify the culprit rule instead of dumping a bare stack.
   */
  function validateCron(id: string, cron: string): void {
    try {
      new Cron(cron, { paused: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.logger.error("scheduler.invalid-cron", { id, cron, err: msg });
      throw new Error(`invalid cron for ${id}: ${cron} (${msg})`);
    }
  }

  /**
   * Run the entry's handler with finish-state bookkeeping (lastRunFinishedAt,
   * lastRunDurationMs, lastRunSummary) and the standard try/finally that
   * removes the inflight promise. Shared by both the cron-tick wrapper and
   * the manual `trigger()` path so the bookkeeping shape is identical
   * regardless of how the run was initiated.
   */
  async function runHandlerOnce(e: EntrySlot, id: string): Promise<void> {
    const startedAt = Date.now();
    e.lastRunStartedAt = startedAt;
    let summary: RunSummary | null = null;
    const p = (async () => {
      try {
        const ret = await e.entry.handler();
        if (isRunSummary(ret)) summary = ret;
      } catch (err) {
        opts.logger.error("scheduler.handler-error", {
          id,
          err: String(err),
        });
      }
    })();
    e.inflight.add(p);
    try {
      await p;
    } finally {
      e.inflight.delete(p);
      const finishedAt = Date.now();
      e.lastRunFinishedAt = finishedAt;
      e.lastRunDurationMs = finishedAt - startedAt;
      // Only overwrite lastRunSummary when the handler explicitly returned
      // one — preserves the previous summary across handlers that emit
      // void (e.g. an error path that never produced a summary).
      if (summary !== null) e.lastRunSummary = summary;
    }
  }

  function startEntry(id: string): void {
    const e = entries.get(id);
    if (!e) return;
    if (e.job) return;
    e.job = new Cron(e.entry.cron, { paused: false }, async () => {
      // If a prior unregister left a pending drain for this id (fire-and-
      // forget replace), block the first tick of the new handler until it
      // settles. This guarantees per-id sequential execution across a
      // register/unregister/register swap even when the caller didn't
      // await unregister's returned promise.
      const drain = pendingDrain.get(id);
      if (drain) {
        await drain.catch(() => {});
        pendingDrain.delete(id);
      }
      // Skip overlapping ticks: if a prior invocation is still running,
      // emit a diagnostic log (now including lastRunStartedAt + elapsedMs
      // so operators can tell "why is this cron skipping") and bail out
      // rather than letting them pile up.
      if (e.inflight.size > 0) {
        const startedAt = e.lastRunStartedAt;
        opts.logger.warn("scheduler.skip-overlap", {
          id,
          inflight: e.inflight.size,
          previousRunStartedAt:
            startedAt !== null ? new Date(startedAt).toISOString() : null,
          elapsedMs: startedAt !== null ? Date.now() - startedAt : null,
        });
        return;
      }
      // Scheduled tick: triggeredRun stays false. (A prior manual trigger
      // restored the flag in its own finally clause; we only assert false
      // explicitly to be defensive against handler logic that read+mutated
      // the slot mid-run via getEntry.)
      e.triggeredRun = false;
      await runHandlerOnce(e, id);
    });
  }

  const api: Scheduler = {
    register(entry) {
      if (stopped) {
        // Previously a silent no-op: the entry was stored but never
        // started, producing a "lost cron job" after a shutdown-race.
        // Throw loudly so callers that hit this race can't accidentally
        // ship a dead scheduler.
        opts.logger.error("scheduler.register-after-stop", { id: entry.id });
        throw new SchedulerStoppedError(entry.id);
      }
      validateCron(entry.id, entry.cron);
      if (entries.has(entry.id)) {
        // Replace existing. Stop the old job synchronously and hand the
        // drain off to `pendingDrain` so the new handler's first tick
        // waits for the old inflight to settle (see startEntry).
        const old = entries.get(entry.id)!;
        old.job?.stop();
        if (old.inflight.size > 0) {
          const drain = Promise.allSettled([...old.inflight]).then(
            () => undefined,
          );
          pendingDrain.set(entry.id, drain);
        }
      }
      entries.set(entry.id, {
        entry,
        job: null,
        inflight: new Set(),
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastRunDurationMs: null,
        lastRunSummary: null,
        triggeredRun: false,
        tracker: null,
      });
      if (started) startEntry(entry.id);
    },
    async unregister(id) {
      const e = entries.get(id);
      if (!e) return false;
      // Stop so croner fires no new ticks.
      e.job?.stop();
      const drain =
        e.inflight.size > 0
          ? Promise.allSettled([...e.inflight]).then(() => undefined)
          : Promise.resolve();
      // Record the drain BEFORE deleting the entry so a concurrent
      // `register(id, ...)` from the orchestrator diff loop can pick it
      // up and sequence the new handler's first tick after drain.
      pendingDrain.set(id, drain);
      entries.delete(id);
      await drain;
      // Clean up the drain record if nobody registered a replacement
      // that would have consumed it. Safe to leave if they did — the
      // consumer deletes the entry in that path.
      if (pendingDrain.get(id) === drain) {
        pendingDrain.delete(id);
      }
      return true;
    },
    hasEntry(id) {
      return entries.has(id);
    },
    list() {
      return [...entries.values()].map((e) => e.entry);
    },
    start() {
      if (stopped) {
        throw new SchedulerStoppedError("(start)");
      }
      started = true;
      for (const id of entries.keys()) startEntry(id);
      opts.logger.info("scheduler.start", { entries: entries.size });
    },
    async stop() {
      // Stop all jobs (no new fires) then drain any in-flight handler.
      const pending: Promise<void>[] = [];
      for (const [, slot] of entries) {
        slot.job?.stop();
        for (const p of slot.inflight) pending.push(p);
      }
      // Also drain any in-progress unregister handoffs so we don't leave
      // behind a promise nobody's awaiting.
      for (const d of pendingDrain.values()) pending.push(d);
      await Promise.allSettled(pending);
      entries.clear();
      pendingDrain.clear();
      started = false;
      stopped = true;
    },
    isStarted() {
      return started;
    },
    isStopped() {
      return stopped;
    },
    getJobCount() {
      return entries.size;
    },
    getEntry(id) {
      const e = entries.get(id);
      if (!e) return undefined;
      return {
        id: e.entry.id,
        cron: e.entry.cron,
        inflight: e.inflight.size,
        lastRunStartedAt: e.lastRunStartedAt,
        lastRunFinishedAt: e.lastRunFinishedAt,
        lastRunDurationMs: e.lastRunDurationMs,
        lastRunSummary: e.lastRunSummary,
        triggeredRun: e.triggeredRun,
        tracker: e.tracker,
      };
    },
    setEntryTracker(id, tracker) {
      const e = entries.get(id);
      if (!e) return;
      e.tracker = tracker;
    },
    async trigger(id, _opts) {
      const e = entries.get(id);
      if (!e) {
        // Surface as InflightConflict's neighbour: a separate error type
        // would balloon the API surface and HTTP-routes can already turn
        // an unknown id into 404 by checking `getEntry(id)` first.
        throw new Error(`scheduler: unknown entry ${id}`);
      }
      if (e.inflight.size > 0) {
        throw new InflightConflictError(id);
      }
      const runId = nextRunId();
      // Mark the run as triggered and kick off the handler; do NOT await
      // the run before returning so HTTP callers get an immediate 202.
      e.triggeredRun = true;
      const runPromise = (async () => {
        try {
          await runHandlerOnce(e, id);
        } finally {
          // Restore the flag once the manual run drains, so subsequent
          // scheduled ticks don't keep mis-reporting `triggeredRun: true`.
          e.triggeredRun = false;
        }
      })();
      // We don't add runPromise itself to e.inflight — runHandlerOnce
      // already does that for the inner handler promise. Instead we
      // attach a no-op .catch so the harness doesn't see an unhandled
      // rejection if the handler throws; runHandlerOnce already logs
      // handler errors via scheduler.handler-error.
      runPromise.catch(() => {});
      return { runId, status: "queued", probe: id };
    },
    nextRunAt(id) {
      const e = entries.get(id);
      if (!e || !e.job) return null;
      const next = e.job.nextRun();
      // Croner returns Date | null — pass through.
      return next ?? null;
    },
  };

  return api;
}
