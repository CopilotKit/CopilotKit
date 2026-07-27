/**
 * Control-plane ASSEMBLY — the non-Chromium half of the harness, wired from
 * the fan-out slots into one lifecycle.
 *
 * The control-plane owns three responsibilities, and this module composes the
 * slots that implement each:
 *
 *   1. PRODUCE work — `createJobProducer` (S4) enqueues one per-service job per
 *      run. Its `tick` is registered as the scheduler handler so the existing
 *      cron cadence drives runs (the producer is invoked BY the scheduler, it
 *      never owns a timer). The producer ALSO runs `sweepExpired` on its own
 *      cadence gate inside `tick` (dead-worker lease reclamation, REQ-B).
 *   2. CONSUME results — the result-consumer polls terminal `probe_jobs` rows
 *      carrying an unprocessed `ServiceJobResult` and feeds each to ...
 *   3. AGGREGATE — `createResultAggregator` (S5), the ONLY writer of the
 *      authoritative dashboard status + run-history. The consumer runs on its
 *      OWN interval (sub-minute, finer than cron) since result latency should
 *      not be bounded by any producer's cron cadence (one or more producers may
 *      tick on distinct cadences).
 *
 * ── REQ-B: SURFACING DEAD-WORKER COMM ERRORS ───────────────────────────────
 * Two legs reclaim a crashed / lease-expired worker's job and synthesize a
 * `worker-crashed-mid-job` `PoolCommError`: the producer's lease-driven
 * `sweepExpired` (inside `tick`) and the heartbeat-driven fleet-health monitor.
 * A comm error only reaches the dashboard once it is written onto the job's
 * STATUS row via `ResultAggregator.aggregateCommError`. The control-plane is
 * where both legs converge onto that aggregator:
 *   - FLEET-HEALTH — when a `fleetHealth` monitor is injected, the control-plane
 *     runs it on its OWN interval (mirrors the consumer loop) and feeds each
 *     `reclaimedOverlays` entry (comm error + already-known `aggregateKey`)
 *     straight to the aggregator.
 *   - PRODUCER SWEEP — the producer FORWARDS its swept comm errors to an
 *     injected sink; `surfaceSweepCommErrors` is that sink. A bare swept
 *     `PoolCommError` carries the `jobId` but not the dashboard key, so a
 *     `resolveSweepAggregateKey` resolver (a job-row lookup) maps each error to
 *     its `d6:<slug>` key before the aggregator writes the overlay.
 * Both are OPTIONAL deps so the assembly stays unit-testable and back-compatible
 * — when omitted, the control-plane is the pure produce/consume assembly it was.
 *
 * ── INJECTION ──────────────────────────────────────────────────────────────
 * Everything is injected (queue, scheduler, aggregator, consumer, enumerator,
 * timers) so the assembly is unit-testable with fakes and owns no PocketBase /
 * Chromium of its own — `runControlPlane` constructs the real deps.
 */

import { Cron } from "croner";
import type { Logger, State } from "../../types/index.js";
import type { Scheduler } from "../../scheduler/scheduler.js";
import type { PoolCommError } from "../contracts.js";
import { createJobProducer } from "./job-producer.js";
import type {
  JobProducer,
  ServiceEnumerator,
  SweepCommErrorSink,
} from "./job-producer.js";
import type { ResultConsumer } from "./result-consumer.js";
import type { ResultAggregator } from "./result-aggregator.js";
import type { FleetHealthMonitor } from "./fleet-health.js";

/**
 * Producer scheduler-entry ids now live in the cycle-free leaf module
 * `schedule-ids.ts` (NO imports back into this module / `run-view.ts` /
 * `job-producer.ts`). They are re-exported here to preserve this module's
 * public export surface — `http/fleet-runs.ts`, `orchestrator.ts`, and the
 * tests import the ids from `control-plane.js`. Homing the VALUES in a leaf
 * removes the eval-time dependency that put `FLEET_FAMILIES` (run-view) in the
 * TDZ for `FLEET_PRODUCER_SCHEDULE_ID` under one cycle load order, which
 * crash-looped the harness on boot.
 */
export {
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_SCHEDULE_ID,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
} from "./schedule-ids.js";
// Local binding for this module's own runtime use of the d6 id (the
// degenerate single-schedule fallback in `createControlPlane`). The `export {
// ... } from` above re-exports the values but does NOT bind them into this
// module's scope, so an explicit import is required for the in-body reference.
import { FLEET_PRODUCER_SCHEDULE_ID } from "./schedule-ids.js";

/**
 * Cron cadence the producer runs on by default. Hourly at :40 mirrors the
 * legacy in-process `d6-all-pills-e2e` probe cadence (config/probes/
 * d6-all-pills-e2e.yml) so the fleet run rhythm matches what it replaces.
 */
export const DEFAULT_PRODUCER_CRON = "40 * * * *";

/** Default result-consumer poll cadence — sub-minute so results land fast. */
export const DEFAULT_CONSUMER_INTERVAL_MS = 5_000;

/** Default fleet-health poll cadence — finer than cron so dead workers reclaim fast. */
export const DEFAULT_FLEET_HEALTH_INTERVAL_MS = 15_000;

/**
 * Resolve a swept `PoolCommError` to the dashboard status-row key (`d6:<slug>`)
 * the overlay must land on (REQ-B). A bare swept error carries the `jobId` but
 * not the `probe_key`, so the wiring slot injects a resolver (a `probe_jobs`
 * row lookup) that maps it. Return null/undefined to SKIP an error whose key
 * can't be resolved (e.g. the row vanished). The control-plane owns no PB, so
 * this stays injected.
 */
export type SweepAggregateKeyResolver = (
  commError: PoolCommError,
) => Promise<string | null | undefined> | string | null | undefined;

/**
 * Read the CURRENT dashboard status-row colour for an aggregate key (REQ-B).
 * Both comm-error surfacing legs call this BEFORE writing the crash overlay so
 * the overlaid row PRESERVES the last observed colour (a `red` service whose
 * worker crashes stays `red` + unreachable) instead of stomping it to green.
 * Returns `undefined`/`null` for a never-observed key (no row), in which case
 * the aggregator writes the no-data ("error") path — never a fabricated green.
 * The control-plane owns no PB, so this stays injected.
 */
export type PriorStateResolver = (
  aggregateKey: string,
) => Promise<State | null | undefined> | State | null | undefined;

/**
 * One producer schedule entry: a `producer` registered on the scheduler under
 * `scheduleId` at `cron`. The control-plane registers each entry as its own
 * scheduler handler so N producers can tick on N distinct cadences (the d6
 * producer at `40 * * * *`, future browser families on their own crons).
 */
export interface ProducerSchedule {
  /** Scheduler entry id this producer registers under (must be unique). */
  scheduleId: string;
  /** Cron cadence this producer ticks on. */
  cron: string;
  /** The producer whose `tick` the scheduler handler drives. */
  producer: JobProducer;
}

export interface ControlPlaneDeps {
  /**
   * Job producer (S4) for the degenerate single-schedule (d6) case. Injected
   * pre-built so tests pass a fake. Ignored when `schedules` is provided.
   */
  producer: JobProducer;
  /** Result consumer (worker->aggregator bridge). Injected pre-built. */
  consumer: ResultConsumer;
  /** The harness scheduler — the producer's tick registers as a handler. */
  scheduler: Scheduler;
  logger: Logger;
  /** Producer cron cadence. Default `DEFAULT_PRODUCER_CRON`. */
  producerCron?: string;
  /**
   * The producer schedules to register. When provided, the control-plane
   * registers each entry as its own scheduler handler on its own cron — N
   * producers on N cadences. When omitted, it degenerates to the single d6
   * schedule built from `producer` / `producerCron` (scheduleId
   * `FLEET_PRODUCER_SCHEDULE_ID`), preserving the historic single-producer
   * behavior byte-for-byte.
   */
  schedules?: readonly ProducerSchedule[];
  /** Result-consumer poll interval (ms). Default `DEFAULT_CONSUMER_INTERVAL_MS`. */
  consumerIntervalMs?: number;
  /**
   * The S5 aggregator. Required to surface dead-worker comm errors (REQ-B) via
   * the producer sweep + fleet-health legs. Optional: when omitted the
   * control-plane is the pure produce/consume assembly (the consumer holds its
   * own aggregator reference), and the comm-error surfacing legs are inert.
   */
  aggregator?: ResultAggregator;
  /**
   * The S10 fleet-health monitor. When injected, the control-plane runs it on
   * its own interval and feeds reclaimed-worker comm errors to the aggregator
   * (REQ-B). Optional — omit to leave fleet-health unattached.
   */
  fleetHealth?: FleetHealthMonitor;
  /** Fleet-health poll interval (ms). Default `DEFAULT_FLEET_HEALTH_INTERVAL_MS`. */
  fleetHealthIntervalMs?: number;
  /**
   * The §9 family-silence monitor's tick seam. When supplied, the fleet-health
   * interval handler ADDITIONALLY fire-and-forgets `tick(now)` each cycle —
   * the tick is the monitor's cheap in-memory gate (actual evaluation runs at
   * most once per family per resolved period, inside the monitor). A tick
   * rejection is logged and never blocks health reclaim. Optional — omit to
   * leave silence monitoring unattached (worker role, legacy tests).
   */
  familySilence?: { tick(nowMs: number): Promise<void> };
  /**
   * Resolve a swept `PoolCommError` to its `d6:<slug>` dashboard key (REQ-B).
   * Required for the producer-sweep surfacing leg (a bare swept error lacks the
   * key); omit when the producer does not forward swept errors here.
   */
  resolveSweepAggregateKey?: SweepAggregateKeyResolver;
  /**
   * Read the current status-row colour for an aggregate key so the crash
   * overlay preserves it (REQ-B) instead of stomping it to green. Optional —
   * when omitted, both legs treat every key as never-observed and the
   * aggregator writes the no-data ("error") path rather than fabricating green.
   */
  resolvePriorState?: PriorStateResolver;
  /** Injectable timer scheduler (tests). Defaults to setInterval. */
  setIntervalImpl?: typeof setInterval;
  /** Injectable timer canceller (tests). Defaults to clearInterval. */
  clearIntervalImpl?: typeof clearInterval;
}

/** A running control-plane: producer registered + consumer loop ticking. */
export interface ControlPlane {
  /** Start each producer + register every schedule's scheduler tick + start the consumer loop. */
  start(): void;
  /** Stop the consumer loop, unregister every schedule's tick, stop each producer. */
  stop(): Promise<void>;
  /** Run one consumer cycle NOW (exposed for tests + opportunistic drains). */
  consumeOnce(): Promise<void>;
  /**
   * Surface the producer's swept `worker-crashed-mid-job` comm errors onto the
   * dashboard (REQ-B). This is the sink the producer's `onSweepCommErrors`
   * forwards to: it resolves each error's `d6:<slug>` key (via
   * `resolveSweepAggregateKey`) and writes the overlay through the aggregator.
   * A no-op when no aggregator/resolver is injected. Best-effort — never throws.
   */
  surfaceSweepCommErrors(commErrors: PoolCommError[]): Promise<void>;
  /**
   * Run one fleet-health cycle NOW and surface its reclaimed-worker comm errors
   * (REQ-B) onto the dashboard via the aggregator. A no-op when no fleet-health
   * monitor is injected. Exposed for tests + opportunistic checks; the start()
   * loop calls this on the fleet-health interval. Best-effort — never throws.
   */
  checkFleetHealthOnce(): Promise<void>;
}

/**
 * Build the producer from its raw deps (queue + enumerator). A convenience for
 * `runControlPlane` so it doesn't import job-producer directly; tests build the
 * producer themselves and use `createControlPlane`.
 */
export function buildJobProducer(deps: {
  queue: Parameters<typeof createJobProducer>[0]["queue"];
  enumerate: ServiceEnumerator;
  logger: Logger;
  /**
   * The producing family's id (§5.1 registry; §4.2 prune-ownership key).
   * Forwarded verbatim to `createJobProducer` — this wrapper re-declares every
   * dep it forwards, so the explicit field here is load-bearing: omitting it
   * would silently drop the option.
   */
  family: string;
  /**
   * Sink the producer forwards its lease-sweep comm errors to (REQ-B). The
   * wiring slot passes `controlPlane.surfaceSweepCommErrors` so a swept
   * (crashed/lease-expired) job's "unreachable" overlay reaches the dashboard.
   * Omit to keep the legacy log-only behaviour.
   */
  onSweepCommErrors?: SweepCommErrorSink;
  /**
   * Pre-dispatch health warm-up (flap-band #72). When supplied, each tick fires
   * a fire-and-forget `GET <backendUrl>/health` per enumerated spec before
   * enqueueing, waking cold containers ahead of the pills that probe them. Omit
   * to keep the legacy no-warm behaviour.
   */
  warmHealth?: Parameters<typeof createJobProducer>[0]["warmHealth"];
}): JobProducer {
  return createJobProducer({
    queue: deps.queue,
    enumerate: deps.enumerate,
    logger: deps.logger,
    family: deps.family,
    ...(deps.onSweepCommErrors
      ? { onSweepCommErrors: deps.onSweepCommErrors }
      : {}),
    ...(deps.warmHealth ? { warmHealth: deps.warmHealth } : {}),
  });
}

export function createControlPlane(deps: ControlPlaneDeps): ControlPlane {
  const { producer, consumer, scheduler, logger } = deps;
  const producerCron = deps.producerCron ?? DEFAULT_PRODUCER_CRON;
  // Normalize to an array of schedules. An OMITTED `schedules` (undefined)
  // degenerates to the single-d6 case — a one-element array on
  // FLEET_PRODUCER_SCHEDULE_ID at `producerCron`, so the historic
  // single-producer behavior is identical. An EXPLICIT empty array is a caller
  // error (intent erased), distinct from omission — fail loud rather than
  // silently coercing it to the d6 fallback.
  if (deps.schedules !== undefined && deps.schedules.length === 0) {
    throw new Error(
      "createControlPlane: `schedules` provided but empty — pass at least one " +
        "schedule, or omit `schedules` for the default single-d6 schedule.",
    );
  }
  const schedules: readonly ProducerSchedule[] =
    deps.schedules !== undefined
      ? deps.schedules
      : [
          {
            scheduleId: FLEET_PRODUCER_SCHEDULE_ID,
            cron: producerCron,
            producer,
          },
        ];
  // `ProducerSchedule.scheduleId` is documented "must be unique"; the scheduler
  // registers by id with replace-semantics, so two entries sharing an id would
  // silently collapse (one family's producer runs but never ticks). Enforce
  // uniqueness loudly at construction, naming the offending id(s).
  const seenScheduleIds = new Set<string>();
  const duplicateScheduleIds = new Set<string>();
  for (const sched of schedules) {
    if (seenScheduleIds.has(sched.scheduleId)) {
      duplicateScheduleIds.add(sched.scheduleId);
    }
    seenScheduleIds.add(sched.scheduleId);
  }
  if (duplicateScheduleIds.size > 0) {
    throw new Error(
      `createControlPlane: duplicate scheduleId(s) — ${[...duplicateScheduleIds].join(", ")}; each ProducerSchedule.scheduleId must be unique.`,
    );
  }
  const consumerIntervalMs =
    deps.consumerIntervalMs ?? DEFAULT_CONSUMER_INTERVAL_MS;
  const fleetHealthIntervalMs =
    deps.fleetHealthIntervalMs ?? DEFAULT_FLEET_HEALTH_INTERVAL_MS;
  const setIntervalFn = deps.setIntervalImpl ?? setInterval;
  const clearIntervalFn = deps.clearIntervalImpl ?? clearInterval;
  const {
    aggregator,
    fleetHealth,
    familySilence,
    resolveSweepAggregateKey,
    resolvePriorState,
  } = deps;

  /**
   * Read the current status-row colour for an aggregate key so the crash
   * overlay preserves it (REQ-B). Best-effort: a missing resolver or a lookup
   * throw degrades to `undefined` (the never-observed / no-data path) — reading
   * the prior colour must never abort a surfacing leg.
   */
  async function priorStateFor(
    aggregateKey: string,
  ): Promise<State | undefined> {
    if (!resolvePriorState) return undefined;
    try {
      return (await resolvePriorState(aggregateKey)) ?? undefined;
    } catch (err) {
      logger.warn("fleet.control-plane.prior-state-read-failed", {
        aggregateKey,
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  let consumerTimer: ReturnType<typeof setIntervalFn> | undefined;
  let fleetHealthTimer: ReturnType<typeof setIntervalFn> | undefined;
  let started = false;
  /** Guards against overlapping consumer cycles when one runs long. */
  let consuming = false;
  /** Guards against overlapping fleet-health cycles when one runs long. */
  let checkingHealth = false;

  async function runConsumerCycle(): Promise<void> {
    if (consuming) return;
    consuming = true;
    try {
      const out = await consumer.consumeOnce();
      if (out.processed > 0 || out.failures > 0) {
        logger.debug("fleet.control-plane.consumed", {
          processed: out.processed,
          failures: out.failures,
        });
      }
    } catch (err) {
      // consumeOnce never throws by contract, but guard anyway — a consumer
      // crash must never kill the interval (it would silently stop draining
      // results). Log and let the next tick retry.
      logger.error("fleet.control-plane.consume-cycle-failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      consuming = false;
    }
  }

  /**
   * Surface the producer's swept comm errors onto the dashboard (REQ-B). Each
   * bare swept error lacks the dashboard key, so resolve it via the injected
   * resolver, then write the overlay through the aggregator. Best-effort
   * per-error: one unresolved/failed error must not block the others.
   */
  async function surfaceSweepCommErrors(
    commErrors: PoolCommError[],
  ): Promise<void> {
    if (!aggregator || !resolveSweepAggregateKey) return;
    for (const commError of commErrors) {
      try {
        const aggregateKey = await resolveSweepAggregateKey(commError);
        if (!aggregateKey) {
          logger.warn("fleet.control-plane.sweep-commerror-unresolved", {
            jobId: commError.jobId,
            workerId: commError.workerId,
          });
          continue;
        }
        // Read the CURRENT row colour first so the overlay PRESERVES it (a red
        // service that crashes stays red) instead of stomping it to green.
        const lastKnownState = await priorStateFor(aggregateKey);
        await aggregator.aggregateCommError({
          commError,
          aggregateKey,
          ...(lastKnownState !== undefined ? { lastKnownState } : {}),
        });
        logger.debug("fleet.control-plane.sweep-commerror-surfaced", {
          jobId: commError.jobId,
          aggregateKey,
          kind: commError.kind,
        });
      } catch (err) {
        logger.warn("fleet.control-plane.sweep-commerror-surface-failed", {
          jobId: commError.jobId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Run one fleet-health cycle and surface its reclaimed-worker comm errors
   * (REQ-B). Each `reclaimedOverlays` entry already carries the dashboard key
   * (the reclaimed job's `probe_key`), so no resolver is needed. The monitor's
   * `checkOnce` never throws by contract, but the per-overlay aggregate write
   * might, so each is best-effort.
   */
  async function runFleetHealthCycle(): Promise<void> {
    if (!fleetHealth) return;
    if (checkingHealth) return;
    checkingHealth = true;
    try {
      const result = await fleetHealth.checkOnce();
      if (!aggregator) return;
      for (const overlay of result.reclaimedOverlays) {
        try {
          // Guard an empty aggregate key (the reclaimed job's probe_key) before
          // writing — mirror the sweep leg's `!aggregateKey` skip so a blank key
          // never lands a status row keyed "".
          if (!overlay.aggregateKey) {
            logger.warn("fleet.control-plane.health-commerror-no-key", {
              jobId: overlay.commError.jobId,
              workerId: overlay.commError.workerId,
            });
            continue;
          }
          // Read the CURRENT row colour first so the overlay PRESERVES it
          // instead of stomping it to green.
          const lastKnownState = await priorStateFor(overlay.aggregateKey);
          await aggregator.aggregateCommError({
            commError: overlay.commError,
            aggregateKey: overlay.aggregateKey,
            ...(lastKnownState !== undefined ? { lastKnownState } : {}),
          });
          logger.debug("fleet.control-plane.health-commerror-surfaced", {
            jobId: overlay.commError.jobId,
            aggregateKey: overlay.aggregateKey,
            kind: overlay.commError.kind,
          });
        } catch (err) {
          logger.warn("fleet.control-plane.health-commerror-surface-failed", {
            jobId: overlay.commError.jobId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      // checkOnce never throws by contract, but guard anyway — a monitor crash
      // must never kill the interval (it would silently stop reclaiming).
      logger.error("fleet.control-plane.health-cycle-failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      checkingHealth = false;
    }
  }

  return {
    start() {
      if (started) return;
      // Pre-validate EVERY schedule's cron BEFORE starting any producer. A bad
      // cron would otherwise throw mid-loop (after `scheduler.register`'s own
      // validateCron), leaving earlier producers started+registered, the timers
      // unset, and `started` latched true — an unrecoverable half-started state.
      // Croner throws synchronously on bad syntax; instantiate a paused job per
      // schedule and aggregate the offending ids into one clear error. This is
      // the same validation the scheduler applies, run up-front so start() is
      // all-or-nothing.
      const invalidCrons: string[] = [];
      for (const sched of schedules) {
        try {
          new Cron(sched.cron, { paused: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("fleet.control-plane.invalid-cron", {
            scheduleId: sched.scheduleId,
            cron: sched.cron,
            err: msg,
          });
          invalidCrons.push(`${sched.scheduleId} (${sched.cron}: ${msg})`);
        }
      }
      if (invalidCrons.length > 0) {
        throw new Error(
          `createControlPlane.start: invalid cron(s) — ${invalidCrons.join("; ")}`,
        );
      }
      started = true;
      // Start each producer and register its tick as a scheduler handler — cron
      // cadence drives runs; each producer's tick also gates sweepExpired
      // internally. N schedules => N producers on N cadences (the degenerate
      // single-d6 case is a one-element array). All crons are pre-validated
      // above, so this loop can't throw partway and leave a half-started plane.
      for (const sched of schedules) {
        sched.producer.start();
        scheduler.register({
          id: sched.scheduleId,
          cron: sched.cron,
          // The scheduler handler returns void|RunSummary; the producer's tick
          // returns a richer TickResult, so adapt by awaiting + discarding it
          // (the producer logs its own per-tick outcome). Errors are swallowed
          // by the scheduler's per-tick isolation, same as legacy handlers.
          handler: async () => {
            await sched.producer.tick();
          },
        });
      }
      // The consumer runs on its own finer interval so result latency isn't
      // bounded by the producer's cron cadence.
      consumerTimer = setIntervalFn(() => {
        void runConsumerCycle();
      }, consumerIntervalMs);
      // When a fleet-health monitor is injected, run it on its OWN interval
      // (finer than cron) so a dead worker's jobs are reclaimed promptly and
      // its "unreachable" overlay reaches the dashboard (REQ-B). The §9
      // family-silence monitor rides the SAME interval (its tick is a cheap
      // in-memory gate), so the timer also starts when only it is supplied.
      if (fleetHealth || familySilence) {
        fleetHealthTimer = setIntervalFn(() => {
          void runFleetHealthCycle();
          if (familySilence) {
            // Fire-and-forget: a silence-monitor failure (or sync throw) must
            // never block or wedge health reclaim — log and let the next
            // interval tick retry.
            void Promise.resolve()
              .then(() => familySilence.tick(Date.now()))
              .catch((err) => {
                logger.warn("fleet.control-plane.family-silence-tick-failed", {
                  err: err instanceof Error ? err.message : String(err),
                });
              });
          }
        }, fleetHealthIntervalMs);
      }
      logger.info("fleet.control-plane.started", {
        schedules: schedules.map((s) => ({
          scheduleId: s.scheduleId,
          cron: s.cron,
        })),
        consumerIntervalMs,
        fleetHealth: fleetHealth !== undefined,
        familySilence: familySilence !== undefined,
      });
    },

    async stop() {
      if (!started) return;
      started = false;
      if (consumerTimer !== undefined) {
        clearIntervalFn(consumerTimer);
        consumerTimer = undefined;
      }
      if (fleetHealthTimer !== undefined) {
        clearIntervalFn(fleetHealthTimer);
        fleetHealthTimer = undefined;
      }
      // Unregister every schedule and stop every producer (mirrors start()).
      // Teardown is BEST-EFFORT: one schedule's unregister OR producer.stop()
      // rejecting must not abort teardown of the later schedules (that would
      // leak live cron handlers + running producers). Guard each leg per entry
      // — mirror the unregister guard onto producer.stop() — so every entry is
      // torn down even if an earlier one throws.
      for (const sched of schedules) {
        await scheduler.unregister(sched.scheduleId).catch((err) =>
          logger.warn("fleet.control-plane.unregister-failed", {
            scheduleId: sched.scheduleId,
            err: err instanceof Error ? err.message : String(err),
          }),
        );
        try {
          await sched.producer.stop();
        } catch (err) {
          logger.error("fleet.control-plane.producer-stop-failed", {
            scheduleId: sched.scheduleId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      logger.info("fleet.control-plane.stopped");
    },

    async consumeOnce() {
      await runConsumerCycle();
    },

    async surfaceSweepCommErrors(commErrors) {
      await surfaceSweepCommErrors(commErrors);
    },

    async checkFleetHealthOnce() {
      await runFleetHealthCycle();
    },
  };
}
