/**
 * Fleet control-plane JOB PRODUCER (BLITZ S4).
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────
 * In the single-process harness a probe "run" is a scheduler tick that, in
 * one process, enumerates every showcase service for a probe family (d6,
 * and later other per-service families) and runs each service's cell set
 * in-process against a pooled Chromium. The pool-fleet splits that into a
 * CONTROL-PLANE (this code) that owns the scheduler/cron + run triggering
 * and a set of WORKERS that own Chromium. The control-plane runs NO
 * Chromium — instead of executing a service's cells, on each tick it
 * ENQUEUES one per-service JOB (`ServiceJobPayload`) onto the fleet pull
 * queue via `FleetQueueClient.enqueue`; a worker later claims and runs it.
 *
 * ── THE DECIDED UNIT: ONE JOB PER SERVICE ──────────────────────────────
 * Per-service granularity is the decided partition (see contracts.ts §1).
 * A single control-plane tick = one logical RUN = a SET of per-service
 * jobs, all sharing one `ServiceJobMeta.runId` so the aggregator (S5) can
 * group the workers' per-service results back into one dashboard sweep.
 * This preserves the existing run-trigger semantics: a cron tick that used
 * to fan a probe out across N services now enqueues N jobs; an
 * operator-triggered run sets `ServiceJobMeta.triggered = true`.
 *
 * ── SEAMS (what the control-plane WIRING slot calls) ───────────────────
 * `start()` / `stop()` bracket the producer's lifecycle; `tick(opts?)`
 * runs one production cycle and is what the wiring slot registers as the
 * scheduler handler (cron passes nothing; an operator trigger passes
 * `{ triggered: true, ... }`). The producer NEVER owns the scheduler — it
 * is invoked BY it, mirroring how the in-process probe-invoker's `invoke`
 * is wrapped by `scheduler.register({ handler })`.
 *
 * ── INJECTION (no Chromium, no concrete discovery) ─────────────────────
 * The producer types against the `FleetQueueClient` INTERFACE (S3
 * implements it) and a `ServiceEnumerator` callback that yields the
 * per-service units for a run. Both are injected so this module has zero
 * dependency on Railway discovery, the d6 driver, or PocketBase — the
 * wiring slot supplies the real enumerator (railway-services → one entry
 * per showcase service) and the real queue client. Tests inject fakes +
 * a fake clock.
 */

import type { Logger } from "../../types/index.js";
import type {
  EnqueueJobInput,
  FleetQueueClient,
  PoolCommError,
  ServiceJobMeta,
  ServiceJobPayload,
} from "../contracts.js";

/**
 * Sink the producer hands its lease-sweep comm errors to (REQ-B). `sweepExpired`
 * reclaims a crashed/lease-expired worker's job and synthesizes one
 * `worker-crashed-mid-job` `PoolCommError` per reclaimed job; those errors only
 * reach the dashboard once they are written onto the job's status row. The
 * producer does NOT own the status pipeline (it owns no PB/aggregator), so it
 * FORWARDS the swept errors to this injected sink — the wiring slot
 * (control-plane) routes them to `ResultAggregator.aggregateCommError`. Called
 * best-effort: the producer awaits it but never lets a sink failure abort job
 * production (the next tick retries the sweep). Injected so the producer stays
 * dependency-free and unit-testable with a fake sink.
 */
export type SweepCommErrorSink = (
  commErrors: PoolCommError[],
) => void | Promise<void>;

/**
 * The per-service unit the enumerator yields for a run. This is the
 * payload-shaping subset the producer turns into a `ServiceJobPayload`
 * (the producer attaches the run `meta` — runId/triggered/enqueuedAt —
 * itself so the enumerator stays unaware of run batching). Mirrors the
 * fields the in-process d6 path derives per service (probeKey
 * `d6:<slug>`, the service slug, the driver kind `e2e_d6`, and the
 * opaque driver inputs the worker threads to the driver).
 */
export interface ServiceJobSpec {
  /** Join key to the claim row + dashboard status row, e.g. `d6:langgraph-python`. */
  probeKey: string;
  /** Showcase service / integration slug, e.g. `langgraph-python`. */
  serviceSlug: string;
  /** Driver kind that runs the cells; `e2e_d6` for the d6 per-service unit. */
  driverKind: string;
  /** Optional narrowing to a subset of the service's cells (feature ids). */
  cellIds?: string[];
  /** Free-form driver inputs threaded to the worker's driver. */
  driverInputs?: Record<string, unknown>;
  /** Optional per-job priority hint (higher pulls first). */
  priority?: number;
  /** Optional explicit lease seconds for the eventual claim. */
  leaseSeconds?: number;
}

/**
 * Enumerate the per-service units for one run. Injected by the wiring
 * slot (production: railway-services discovery → one spec per showcase
 * service for the probe family). Receives the run's `triggered` flag and
 * optional operator filter so an operator-triggered run can scope to a
 * subset of services / cells, mirroring `TriggerOptions.filter` in the
 * in-process scheduler.
 *
 * Async because production enumeration hits Railway discovery; the
 * producer awaits it before enqueueing.
 */
export type ServiceEnumerator = (
  ctx: EnumerateContext,
) => Promise<ServiceJobSpec[]> | ServiceJobSpec[];

/** Context handed to the enumerator for one run. */
export interface EnumerateContext {
  /** True for operator-triggered runs, false for scheduled (cron) ticks. */
  triggered: boolean;
  /** Stable id of this run batch (same id stamped onto every job's meta). */
  runId: string;
  /** Optional operator filter (slug / feature scoping), trigger-only. */
  filter?: { slugs?: string[]; featureTypes?: string[] };
}

/** Options for a single `tick()`. Cron ticks pass nothing. */
export interface TickOptions {
  /** True when an operator triggered this run; default false (scheduled). */
  triggered?: boolean;
  /** Operator filter forwarded to the enumerator (trigger-only). */
  filter?: { slugs?: string[]; featureTypes?: string[] };
}

/** Outcome of one production cycle, returned to the wiring/scheduler layer. */
export interface TickResult {
  /** The run batch id every enqueued job in this tick shares. */
  runId: string;
  /** Number of per-service jobs enqueued (== services enumerated, minus failures). */
  enqueued: number;
  /** Number of enqueue attempts that threw (a service that failed to enqueue). */
  enqueueFailures: number;
  /** True iff a lease sweep ran during this tick. */
  sweptExpired: boolean;
  /** Expired leases reclaimed by the sweep, when one ran (else 0). */
  reclaimed: number;
}

export interface JobProducerOptions {
  /** Queue protocol (S3 implements it). Injected — never constructed here. */
  queue: FleetQueueClient;
  /** Yields the per-service units to enqueue for a run. Injected. */
  enumerate: ServiceEnumerator;
  logger: Logger;
  /**
   * How often to run `sweepExpired()` for dead-worker reclamation, in ms.
   * The sweep runs at most once per `sweepIntervalMs` window, evaluated on
   * each tick against the clock — the producer never owns its own timer
   * (the scheduler drives cadence; the producer just gates). Default
   * `DEFAULT_SWEEP_INTERVAL_MS`. Set <= 0 to sweep on EVERY tick.
   */
  sweepIntervalMs?: number;
  /**
   * Clock, injectable for tests. Returns ms-since-epoch. Used for the
   * sweep cadence gate and `ServiceJobMeta.enqueuedAt`. Defaults to
   * `Date.now`.
   */
  now?: () => number;
  /**
   * Run-id factory, injectable for deterministic tests. Each call returns
   * a unique run batch id. Defaults to a timestamp+counter composite
   * (same idiom as the scheduler's `nextRunId`).
   */
  runIdFactory?: () => string;
  /**
   * Sink for the lease-sweep's `worker-crashed-mid-job` comm errors (REQ-B).
   * When omitted, swept errors are logged only (the legacy behaviour) — but the
   * wiring slot injects this so a crashed worker's "unreachable" overlay reaches
   * the dashboard via the aggregator. Failures are swallowed (logged) and never
   * abort job production.
   */
  onSweepCommErrors?: SweepCommErrorSink;
}

/**
 * The control-plane job producer. The wiring slot calls `start()` once,
 * registers `tick` as the scheduler handler, and calls `stop()` on
 * shutdown.
 */
export interface JobProducer {
  /** Begin producing. Idempotent; after `stop()` it stays stopped. */
  start(): void;
  /** Stop producing. After this, `tick()` is a no-op (returns 0 enqueued). */
  stop(): Promise<void>;
  /**
   * Run one production cycle: enumerate per-service units, enqueue one job
   * per service (all sharing one runId), and sweep expired leases if the
   * cadence window elapsed. This is the scheduler handler seam.
   */
  tick(opts?: TickOptions): Promise<TickResult>;
  /** True once `start()` ran and `stop()` has not. */
  isRunning(): boolean;
}

/** Default lease-sweep cadence: reclaim dead-worker leases every 30s. */
export const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

export function createJobProducer(opts: JobProducerOptions): JobProducer {
  const { queue, enumerate, logger } = opts;
  const now = opts.now ?? (() => Date.now());
  const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const runIdFactory = opts.runIdFactory ?? defaultRunIdFactory();
  const onSweepCommErrors = opts.onSweepCommErrors;

  let running = false;
  let stopped = false;
  /**
   * ms-since-epoch of the last sweep, or null if none has run. Gates the
   * cadence: a sweep runs on a tick only when `now - lastSweepAt >=
   * sweepIntervalMs` (or always, when the interval is <= 0). null seeds
   * the FIRST tick to sweep so a control-plane that just booted with
   * orphaned leases from a prior crash reclaims them on its first cycle.
   */
  let lastSweepAt: number | null = null;

  /** Build a `ServiceJobPayload` from a spec + the run's shared meta. */
  function toEnqueueInput(
    spec: ServiceJobSpec,
    meta: ServiceJobMeta,
  ): EnqueueJobInput {
    const payload: ServiceJobPayload = {
      probeKey: spec.probeKey,
      serviceSlug: spec.serviceSlug,
      driverKind: spec.driverKind,
      meta,
    };
    if (spec.cellIds !== undefined) payload.cellIds = spec.cellIds;
    if (spec.driverInputs !== undefined)
      payload.driverInputs = spec.driverInputs;
    const input: EnqueueJobInput = { payload };
    if (spec.leaseSeconds !== undefined) input.leaseSeconds = spec.leaseSeconds;
    return input;
  }

  /**
   * Run the lease sweep if the cadence window has elapsed. Returns the
   * sweep outcome (or a no-sweep sentinel). Sweep failures are logged and
   * swallowed — a transient PB blip on the reclamation path must NEVER
   * abort job production (the next tick retries).
   */
  async function maybeSweep(
    nowMs: number,
  ): Promise<{ swept: boolean; reclaimed: number }> {
    const due =
      sweepIntervalMs <= 0 ||
      lastSweepAt === null ||
      nowMs - lastSweepAt >= sweepIntervalMs;
    if (!due) return { swept: false, reclaimed: 0 };
    lastSweepAt = nowMs;
    try {
      const result = await queue.sweepExpired(nowMs);
      if (result.reclaimed > 0 || result.commErrors.length > 0) {
        logger.warn("fleet.producer.sweep-reclaimed", {
          reclaimed: result.reclaimed,
          commErrors: result.commErrors.length,
        });
      }
      // REQ-B: forward the swept `worker-crashed-mid-job` comm errors to the
      // injected sink so each reclaimed job's "unreachable" overlay reaches the
      // dashboard (the producer owns no status pipeline of its own). Previously
      // these were DROPPED after logging their count — the crash/lease-expiry
      // overlay never surfaced. Best-effort: a sink failure must not abort job
      // production, so we log and swallow (the next sweep retries).
      if (onSweepCommErrors && result.commErrors.length > 0) {
        try {
          await onSweepCommErrors(result.commErrors);
        } catch (sinkErr) {
          logger.error("fleet.producer.sweep-commerror-sink-failed", {
            commErrors: result.commErrors.length,
            err: sinkErr instanceof Error ? sinkErr.message : String(sinkErr),
          });
        }
      }
      return { swept: true, reclaimed: result.reclaimed };
    } catch (err) {
      logger.error("fleet.producer.sweep-failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      // A failed sweep still counts as "swept" for cadence purposes — we
      // don't want a persistently-failing sweep to fire on every tick and
      // bury the logs; the window already advanced via lastSweepAt.
      return { swept: true, reclaimed: 0 };
    }
  }

  return {
    start() {
      if (stopped) {
        logger.warn("fleet.producer.start-after-stop");
        return;
      }
      if (running) return;
      running = true;
      logger.info("fleet.producer.start", { sweepIntervalMs });
    },

    async stop() {
      if (!running) {
        stopped = true;
        return;
      }
      running = false;
      stopped = true;
      logger.info("fleet.producer.stop");
    },

    isRunning() {
      return running;
    },

    async tick(tickOpts?: TickOptions): Promise<TickResult> {
      const runId = runIdFactory();
      if (!running) {
        // Defensive: a tick that arrives after stop() (or before start())
        // produces nothing. Mirrors the scheduler's drain-after-stop
        // discipline — no jobs leak past the producer's lifecycle.
        logger.warn("fleet.producer.tick-while-stopped", { runId });
        return {
          runId,
          enqueued: 0,
          enqueueFailures: 0,
          sweptExpired: false,
          reclaimed: 0,
        };
      }

      const triggered = tickOpts?.triggered === true;
      const nowMs = now();
      const enqueuedAt = new Date(nowMs).toISOString();

      const enumerateCtx: EnumerateContext = { triggered, runId };
      if (tickOpts?.filter !== undefined) enumerateCtx.filter = tickOpts.filter;

      let specs: ServiceJobSpec[];
      try {
        specs = await enumerate(enumerateCtx);
      } catch (err) {
        // Enumeration failure short-circuits production (no services →
        // nothing to enqueue). Still attempt the sweep so dead-worker
        // reclamation isn't starved by a flaky discovery upstream.
        logger.error("fleet.producer.enumerate-failed", {
          runId,
          triggered,
          err: err instanceof Error ? err.message : String(err),
        });
        const sweep = await maybeSweep(nowMs);
        return {
          runId,
          enqueued: 0,
          enqueueFailures: 0,
          sweptExpired: sweep.swept,
          reclaimed: sweep.reclaimed,
        };
      }

      logger.info("fleet.producer.tick-start", {
        runId,
        triggered,
        services: specs.length,
      });

      let enqueued = 0;
      let enqueueFailures = 0;
      for (const spec of specs) {
        const meta: ServiceJobMeta = {
          runId,
          triggered,
          enqueuedAt,
        };
        if (spec.priority !== undefined) meta.priority = spec.priority;
        try {
          await queue.enqueue(toEnqueueInput(spec, meta));
          enqueued++;
        } catch (err) {
          // One service failing to enqueue must NOT abort the rest of the
          // run — the other services' jobs still get queued, mirroring the
          // in-process invoker's per-target isolation.
          enqueueFailures++;
          logger.error("fleet.producer.enqueue-failed", {
            runId,
            probeKey: spec.probeKey,
            serviceSlug: spec.serviceSlug,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const sweep = await maybeSweep(nowMs);

      logger.info("fleet.producer.tick-complete", {
        runId,
        triggered,
        enqueued,
        enqueueFailures,
        sweptExpired: sweep.swept,
        reclaimed: sweep.reclaimed,
      });

      return {
        runId,
        enqueued,
        enqueueFailures,
        sweptExpired: sweep.swept,
        reclaimed: sweep.reclaimed,
      };
    },
  };
}

/**
 * Default run-id factory: timestamp + monotonic counter composite,
 * matching the scheduler's `nextRunId` idiom so two runs that land in the
 * same ms still get distinct ids.
 */
function defaultRunIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `frun_${Date.now().toString(36)}_${counter.toString(36)}`;
  };
}
