import { Cron } from "croner";
import type { Logger } from "../types/index.js";

export interface ScheduleEntry {
  id: string;
  cron: string;
  handler: () => Promise<void> | void;
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

interface EntrySlot {
  entry: ScheduleEntry;
  job: Cron | null;
  /** Tracks in-flight handler invocations so stop()/unregister() can drain them. */
  inflight: Set<Promise<void>>;
  /** Wall-clock start of the last tick; used for skip-log diagnostics. */
  lastRunStartedAt: number | null;
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
      e.lastRunStartedAt = Date.now();
      // A6: previously `p.finally(() => e.inflight.delete(p)).catch(() => {})`
      // ran as a detached microtask. On a tight cron (`* * * * * *`), the
      // next tick could observe `e.inflight.size > 0` at a microtask
      // boundary where `p` had resolved but the `.finally` callback hadn't
      // drained yet, producing a spurious `scheduler.skip-overlap` warn.
      // Replace with structured try/finally so `inflight.delete(p)` runs
      // synchronously in the same microtask as `p`'s settle, before the
      // wrapper awaits return (and before croner can re-enter).
      const p = (async () => {
        try {
          await e.entry.handler();
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
      }
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
  };

  return api;
}
