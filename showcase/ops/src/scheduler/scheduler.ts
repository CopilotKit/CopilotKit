import { Cron } from "croner";
import type { Logger } from "../types/index.js";

export interface ScheduleEntry {
  id: string;
  cron: string;
  handler: () => Promise<void> | void;
}

export interface Scheduler {
  register(entry: ScheduleEntry): void;
  unregister(id: string): boolean;
  hasEntry(id: string): boolean;
  list(): ScheduleEntry[];
  start(): void;
  stop(): Promise<void>;
}

export interface SchedulerOptions {
  logger: Logger;
}

interface EntrySlot {
  entry: ScheduleEntry;
  job: Cron | null;
  /** Tracks in-flight handler invocations so stop() can drain them. */
  inflight: Set<Promise<void>>;
}

export function createScheduler(opts: SchedulerOptions): Scheduler {
  const entries = new Map<string, EntrySlot>();
  let started = false;

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
      p.finally(() => e.inflight.delete(p));
      await p;
    });
  }

  return {
    register(entry) {
      validateCron(entry.id, entry.cron);
      if (entries.has(entry.id)) {
        // Replace existing (diffing handled by orchestrator).
        this.unregister(entry.id);
      }
      entries.set(entry.id, { entry, job: null, inflight: new Set() });
      if (started) startEntry(entry.id);
    },
    unregister(id) {
      const e = entries.get(id);
      if (!e) return false;
      e.job?.stop();
      entries.delete(id);
      return true;
    },
    hasEntry(id) {
      return entries.has(id);
    },
    list() {
      return [...entries.values()].map((e) => e.entry);
    },
    start() {
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
      await Promise.allSettled(pending);
      entries.clear();
      started = false;
    },
  };
}
