/**
 * Per-service progress tracking for a single probe invocation.
 *
 * The probe-invoker fans out across services (static targets or discovery
 * enumeration) and runs each driver call concurrently. The HTTP API
 * (`GET /api/probes`) wants to surface per-service progress while a
 * probe is mid-flight — which slugs are queued, running, completed,
 * or failed, and how long the run has been going.
 *
 * `ProbeRunTracker` is a pure data class: no I/O, no logging, no
 * scheduler awareness. The invoker calls `enqueue` / `start` /
 * `complete` / `fail` as targets move through the pipeline; the HTTP
 * handler calls `snapshot()` to serialize.
 *
 * `now()` is injectable so tests can drive deterministic timestamps
 * without leaning on `vi.useFakeTimers()`.
 */

export type ProbeServiceState = "queued" | "running" | "completed" | "failed";

export interface ProbeServiceProgress {
  state: ProbeServiceState;
  startedAt?: number;
  finishedAt?: number;
  result?: "green" | "yellow" | "red";
  error?: string;
}

export interface ProbeRunSnapshot {
  probeId: string;
  startedAt: number;
  triggered: boolean;
  elapsedMs: number;
  services: Array<{ slug: string } & ProbeServiceProgress>;
  counts: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    total: number;
  };
}

export interface ProbeRunTrackerOptions {
  probeId: string;
  triggered?: boolean;
  now?: () => number;
}

export class ProbeRunTracker {
  readonly probeId: string;
  readonly startedAt: number;
  readonly triggered: boolean;

  private readonly nowFn: () => number;
  private readonly services: Map<string, ProbeServiceProgress> = new Map();

  constructor(opts: ProbeRunTrackerOptions) {
    this.probeId = opts.probeId;
    this.triggered = opts.triggered ?? false;
    this.nowFn = opts.now ?? (() => Date.now());
    this.startedAt = this.nowFn();
  }

  /** Register a service in 'queued' state. Idempotent — re-queueing a
   *  service that's already known is a no-op (does not reset timing). */
  enqueue(slug: string): void {
    if (this.services.has(slug)) return;
    this.services.set(slug, { state: "queued" });
  }

  /** Mark service running. Sets startedAt to now(). Auto-registers
   *  the service if it wasn't enqueued first. */
  start(slug: string): void {
    const existing = this.services.get(slug);
    const startedAt = this.nowFn();
    this.services.set(slug, {
      ...existing,
      state: "running",
      startedAt,
    });
  }

  /** Mark service completed with a result. Sets finishedAt to now().
   *  Tolerated even if the service wasn't enqueued / started — overwrites
   *  prior state without throwing. The probe-invoker is the only writer,
   *  so any out-of-order call is a defensive case, not a real bug. */
  complete(slug: string, result: "green" | "yellow" | "red"): void {
    const existing = this.services.get(slug);
    const finishedAt = this.nowFn();
    this.services.set(slug, {
      ...existing,
      state: "completed",
      finishedAt,
      result,
      // Drop any prior `error` field so a re-completed service doesn't
      // surface stale error text alongside its new result.
      error: undefined,
    });
  }

  /** Mark service failed with an error. Sets finishedAt to now().
   *  Tolerated even if the service wasn't enqueued / started. */
  fail(slug: string, error: string): void {
    const existing = this.services.get(slug);
    const finishedAt = this.nowFn();
    this.services.set(slug, {
      ...existing,
      state: "failed",
      finishedAt,
      error,
      // Drop any prior `result` so a failed service doesn't surface a
      // stale 'green' next to its error text.
      result: undefined,
    });
  }

  /** Snapshot the current tracker state for serialization. Used by
   *  GET /api/probes to surface in-flight progress. */
  snapshot(): ProbeRunSnapshot {
    const services: Array<{ slug: string } & ProbeServiceProgress> = [];
    const counts = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };
    for (const [slug, progress] of this.services) {
      services.push({ slug, ...progress });
      counts[progress.state]++;
      counts.total++;
    }
    return {
      probeId: this.probeId,
      startedAt: this.startedAt,
      triggered: this.triggered,
      elapsedMs: this.nowFn() - this.startedAt,
      services,
      counts,
    };
  }
}
