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
import { probeKeyFamily } from "../contracts.js";
import { PoisonedBacklogCountError } from "../queue-client.js";
import { deriveHealthUrl } from "../../probes/liveness.js";
import { PRUNE_OWNER_FAMILY } from "./run-view.js";

/**
 * Sink the producer hands its lease-sweep comm errors to (REQ-B). `sweepExpired`
 * reclaims a lease-expired worker's job (re-queues it to pending) and
 * synthesizes one neutral `worker-reclaimed-pending` `PoolCommError` per
 * reclaimed job; those errors only
 * reach the dashboard once they are written onto the job's status row. The
 * producer does NOT own the status pipeline (it owns no PB/aggregator), so it
 * FORWARDS the swept errors to this injected sink — the wiring slot
 * (control-plane) routes them to `ResultAggregator.aggregateCommError`. Called
 * best-effort: the producer awaits it but never lets a sink failure abort job
 * production. A failed delivery does NOT lose the batch — `sweepExpired` only
 * synthesizes comm errors for rows reclaimed in THAT call, so a later sweep
 * cannot re-derive a missed batch; the producer instead BUFFERS undelivered
 * errors (capped at `MAX_BUFFERED_SWEEP_COMM_ERRORS`, oldest dropped) and
 * prepends them to the next delivery attempt — which happens on EVERY sweep
 * attempt, including one whose `sweepExpired` call throws, so a
 * persistently-failing sweep never starves a healthy sink of the buffer.
 * Injected so the producer stays dependency-free and unit-testable with a
 * fake sink.
 *
 * AT-LEAST-ONCE DELIVERY — the sink MUST be idempotent. A sink failure
 * re-buffers and later re-delivers the WHOLE batch, including entries the
 * receiver may already have processed before the failure surfaced (the
 * producer cannot distinguish a partial sink failure from a total one).
 * The aggregator behind this sink must therefore treat each comm error as
 * idempotent per (jobId, observedAt): re-delivery of an already-aggregated
 * entry must not duplicate its dashboard surface.
 */
export type SweepCommErrorSink = (
  commErrors: PoolCommError[],
) => void | Promise<void>;

/**
 * Pre-dispatch HEALTH WARM-UP config (flap-band #72). Before a run's jobs are
 * enqueued, the producer fires a fire-and-forget `GET <backendUrl>/health`
 * against each backend WHOSE SPEC IS ACTUALLY ENQUEUED on this tick — the
 * post-validation, post-backlog-gate `gate.specs` set, not the raw enumerated
 * set — so a cold (scaled-to-zero) container starts waking BEFORE a pill
 * actually probes it, removing most `current=0` zero-output timeouts where
 * the first pill paid the cold-start latency. A fully-backlogged tick whose
 * gate skipped every spec fires zero warm GETs (no jobs → nothing to warm).
 *
 * This is NOT an LLM call and NOT an agent turn — it is a cheap unauthenticated
 * liveness GET with a short timeout, fully best-effort: a warm failure (cold
 * container still booting, network blip) is logged at debug and never blocks or
 * fails job production. Injected so the producer stays dependency-free and the
 * warm loop is unit-testable with a fake `fetch`.
 */
export interface WarmHealthConfig {
  /**
   * The `fetch` impl used for the warm GETs. Injected (production wires
   * `globalThis.fetch`); tests pass a spy. When omitted, warm-up is disabled.
   */
  fetchImpl: typeof fetch;
  /**
   * Per-request timeout in ms for each warm GET. The warm must never hang the
   * tick, so each GET is aborted after this window. Default
   * `DEFAULT_WARM_TIMEOUT_MS`.
   */
  timeoutMs?: number;
}

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
  /**
   * Optional per-job priority hint, copied verbatim onto `meta.priority`.
   * RESERVED: not currently consulted by `claimNext` (workers pull in queue
   * order regardless of this value).
   */
  priority?: number;
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
  /**
   * Optional operator filter (slug / feature scoping). Only ever present on
   * TRIGGERED runs — the producer never forwards a filter on a scheduled
   * tick (a scheduled tick must never be scoped).
   */
  filter?: { slugs?: string[]; featureTypes?: string[] };
}

/** Options for a single `tick()`. Cron ticks pass nothing. */
export interface TickOptions {
  /** True when an operator triggered this run; default false (scheduled). */
  triggered?: boolean;
  /**
   * Operator filter forwarded to the enumerator — TRIGGERED ticks only. A
   * filter passed without `triggered: true` is IGNORED (warned, not
   * forwarded): a scheduled tick must never be scoped.
   */
  filter?: { slugs?: string[]; featureTypes?: string[] };
}

/** Outcome of one production cycle, returned to the wiring/scheduler layer. */
export interface TickResult {
  /**
   * The run batch id every enqueued job in this tick shares. Empty string
   * (`""`) when the tick never RAN — skipped because a previous tick was
   * still in flight, or because it arrived outside the producer's lifecycle
   * (before start() / after stop()): a tick that produces nothing by
   * construction does not mint a runId.
   */
  runId: string;
  /** Number of per-service jobs enqueued (services enumerated, minus enqueue failures, backlog-gate skips, AND stop truncation). */
  enqueued: number;
  /**
   * Number of per-service specs that FAILED to become a queued job: enqueue
   * attempts that threw, plus specs dropped at the boundary for an invalid
   * (empty) probeKey — see the phantom-family guard in the tick body.
   */
  enqueueFailures: number;
  /**
   * Number of per-service jobs NOT enqueued because `stop()` truncated the
   * enqueue loop mid-batch (the quiesce re-check). Without this the
   * truncated specs vanished from the tick outcome entirely: `services`
   * could not be reconciled against `enqueued + enqueueFailures +
   * skippedForBacklog`. The partition invariant is `services enumerated ==
   * enqueued + enqueueFailures + skippedForBacklog + truncatedByStop`.
   */
  truncatedByStop: number;
  /**
   * Number of per-service jobs SKIPPED by `filterBackloggedFamilies`
   * (scheduled ticks only — operator-triggered ticks bypass the gate). Two
   * contributors:
   *   1. The dedupe gate: the family already had a non-terminal
   *      (pending/claimed/running) batch on the queue (`hasBacklog`).
   *   2. The fail-CLOSED leg of the poisoned-count guard: when
   *      `countPendingForFamily` throws a `PoisonedBacklogCountError` the
   *      family is skipped (an unverifiable count is treated as backlogged,
   *      preventing a stuck producer from flooding the queue).
   * The fail-OPEN leg (transient `countPendingForFamily` failure) is
   * counted SEPARATELY by `backlogGateFailedOpen` — it does NOT fold here.
   */
  skippedForBacklog: number;
  /**
   * Number of FAMILIES the backlog gate kept via its FAIL-OPEN path:
   * `countPendingForFamily` failed with a non-poisoned (transient) error, so
   * the family's batch was produced WITHOUT a backlog check (the legacy
   * un-gated behavior as the safe fallback). Without this count a
   * failed-open gate was indistinguishable in the tick outcome from a gate
   * that read a clean zero — the same ambiguity class `sweepFailed` /
   * `enumerateFailed` exist to remove. 0 when the gate did not run at all
   * (triggered ticks bypass it; skipped ticks never reach it).
   */
  backlogGateFailedOpen: number;
  /** True iff a lease sweep ran during this tick. */
  sweptExpired: boolean;
  /**
   * True iff a sweep RAN during this tick but FAILED (the `sweepExpired` call
   * threw). `sweptExpired` stays true in that case — a failed sweep still
   * consumes its cadence window (see `maybeSweep`) — so without this flag a
   * failed sweep was indistinguishable from a clean zero-reclaim sweep in the
   * tick outcome.
   */
  sweepFailed: boolean;
  /**
   * Expired leases reclaimed by the sweep, when one ran (else 0).
   *
   * Against the REAL queue-client this counts CAS-CONFIRMED re-queues ONLY:
   * a release that THREW mid-flight (it may or may not have committed) lands
   * exclusively in `reclaimedIndeterminate` below, never here — summing the
   * two recovers the conservative at-least-once total. Only a queue
   * implementation that does NOT report the split (the shared `SweepResult`
   * contract keeps `reclaimedIndeterminate` optional) could fold
   * indeterminate maybes into this count.
   */
  reclaimed: number;
  /**
   * In ADDITION to `reclaimed`, the reclaims whose release outcome was
   * INDETERMINATE (transport failure after the CAS — the conservative
   * over-report slice). DISJOINT from `reclaimed`: a thrown release lands
   * here EXCLUSIVELY, never in `reclaimed`; summing the two recovers the
   * at-least-once total (this matches the shared
   * `SweepResultWithIndeterminate` contract pairing). OPTIONAL, mirroring
   * the shared `SweepResult.reclaimedIndeterminate` contract field
   * `maybeSweep` reads directly: absent when the queue does not report the
   * split (the real queue-client always does).
   */
  reclaimedIndeterminate?: number;
  /**
   * True iff the enumerator THREW on this tick (production short-circuited —
   * nothing was enqueued). Without this flag a discovery outage was
   * indistinguishable from a legitimately empty catalog in the tick outcome
   * (both report `enqueued: 0`) — the same ambiguity class `sweepFailed`
   * exists to remove.
   */
  enumerateFailed: boolean;
}

export interface JobProducerOptions {
  /** Queue protocol (S3 implements it). Injected — never constructed here. */
  queue: FleetQueueClient;
  /** Yields the per-service units to enqueue for a run. Injected. */
  enumerate: ServiceEnumerator;
  logger: Logger;
  /**
   * The producing family's id — a `FLEET_FAMILIES[*].family` value from the
   * §5.1 registry (e.g. `"d6"`, `"d5"`, `"e2e-demos"`, `"e2e-smoke"`). Stamped
   * onto every `EnqueueJobInput` this producer builds (the queue-client
   * denormalizes it into the `probe_jobs.family` column), and ALSO the
   * prune-ownership key: the §4.2 retention prune runs only when
   * `family === PRUNE_OWNER_FAMILY` (the §5.1 registry's D6 family id, NOT a
   * hardcoded literal) so four producers sharing the sweep-gate pattern never
   * run four concurrent delete passes (single-owner by configuration).
   * A constructor option rather than scheduleId-derived because the producer
   * deliberately has no knowledge of its schedule id (bound later, in
   * `buildProducerSchedules`).
   */
  family: string;
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
   * sweep cadence gate (re-read after the enumerate await, never tick
   * start), `ServiceJobMeta.enqueuedAt` (stamped at enqueue time), and the
   * default run-id factory. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Run-id factory, injectable for deterministic tests. Each call returns
   * a unique run batch id. Defaults to a timestamp+counter composite
   * (same idiom as the scheduler's `nextRunId`).
   */
  runIdFactory?: () => string;
  /**
   * Sink for the lease-sweep's `worker-reclaimed-pending` comm errors (REQ-B).
   * When omitted, swept errors are logged only (the legacy behaviour) — but the
   * wiring slot injects this so a reclaimed job's gray "re-queued" surface
   * reaches the dashboard via the aggregator. Failures are swallowed (logged)
   * and never abort job production.
   */
  onSweepCommErrors?: SweepCommErrorSink;
  /**
   * Pre-dispatch health warm-up (flap-band #72). When supplied, each tick
   * fires a fire-and-forget `GET <backendUrl>/health` per spec ACTUALLY
   * ENQUEUED (post-validation, post-backlog-gate — `gate.specs`, not the raw
   * enumerated set) right before enqueueing, so cold containers start waking
   * before pills probe them. A fully-backlogged tick warms nothing. When
   * omitted, no warm-up runs (the legacy behavior).
   */
  warmHealth?: WarmHealthConfig;
}

/** Default per-request timeout for a #72 health warm-up GET. */
export const DEFAULT_WARM_TIMEOUT_MS = 3_000;

/**
 * Read a spec's backend base URL from its serialized `driverInputs.backendUrl`
 * (the catalog enumerator sets this to the service's reachable base). Returns
 * undefined when absent / not a string so the warm loop skips that spec rather
 * than firing at a bogus URL.
 */
function backendUrlFromSpec(spec: ServiceJobSpec): string | undefined {
  const inputs = spec.driverInputs;
  if (inputs === undefined || inputs === null || typeof inputs !== "object") {
    return undefined;
  }
  const url = (inputs as Record<string, unknown>).backendUrl;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

/**
 * The control-plane job producer. The wiring slot calls `start()` once,
 * registers `tick` as the scheduler handler, and calls `stop()` on
 * shutdown.
 */
export interface JobProducer {
  /**
   * LIFECYCLE: created → start() → stop(), one-way. start() is idempotent
   * while running; once a STARTED producer has been stop()ped it stays
   * stopped (start-after-stop is a warned no-op — producers are not
   * restartable). stop() BEFORE start() is a debug-logged NO-OP that does
   * NOT latch the stopped state: a teardown that races ahead of boot wiring
   * must not permanently brick a producer that never ran.
   */
  /** Begin producing. Idempotent; after a started producer's `stop()` it stays stopped. */
  start(): void;
  /**
   * Stop producing. After this, `tick()` is a no-op (returns 0 enqueued).
   * Idempotent for a STARTED producer; a no-op before start() (see the
   * lifecycle note above).
   */
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

/**
 * Cap on the producer's buffer of UNDELIVERED sweep comm errors (REQ-B). A
 * persistently-failing sink must not grow the buffer without bound, so past
 * the cap the OLDEST entries are dropped (with a warn) — newer reclaims carry
 * the fresher dashboard signal.
 */
export const MAX_BUFFERED_SWEEP_COMM_ERRORS = 500;

/**
 * Cap on the jobIds SAMPLE the buffer-overflow warn carries. The sibling
 * drop paths (no-sink, stop()-drain) log every dropped jobId, but those
 * batches are bounded by a single sweep; an overflow drop is bounded only
 * by the inflow rate, so the warn samples the OLDEST (dropped-first) ids
 * rather than flood one log line with thousands.
 */
export const OVERFLOW_DROP_JOBID_SAMPLE = 20;

/**
 * The no-op `TickResult` for a tick that never RAN (skipped because a
 * previous tick was still in flight, or arrived outside the producer's
 * lifecycle). `runId` is the empty-string sentinel: no run was minted — a
 * tick that produces nothing by construction must not burn the run-id
 * counter or log phantom runIds.
 */
function skippedTickResult(): TickResult {
  return {
    runId: "",
    enqueued: 0,
    enqueueFailures: 0,
    skippedForBacklog: 0,
    backlogGateFailedOpen: 0,
    truncatedByStop: 0,
    sweptExpired: false,
    sweepFailed: false,
    reclaimed: 0,
    enumerateFailed: false,
  };
}

/**
 * Wrap the injected logger so a THROWING transport can never break the
 * producer's control flow. The documented invariant at `inFlightTick` — "a
 * tick promise never rejects; every failure path inside the tick is caught"
 * — was violated by any unguarded logger.* call in the tick body, and a
 * throw inside stop()'s shared completion permanently POISONED
 * `stopPromise`: every later stop() caller awaited the same rejected
 * promise and re-threw. The warm chain already hardens for this exact
 * failure mode (its terminal `.catch` backstop, kept as defense in depth);
 * wrapping the logger ONCE at construction extends the same discipline to
 * every call site in this module. Logging is observability, never a
 * correctness gate — a throwing transport is swallowed.
 */
function safeLogger(logger: Logger): Logger {
  const guard =
    (level: "info" | "warn" | "error" | "debug") =>
    (msg: string, meta?: Record<string, unknown>): void => {
      try {
        logger[level](msg, meta);
      } catch {
        // A broken log transport must never break production or shutdown.
      }
    };
  return {
    info: guard("info"),
    warn: guard("warn"),
    error: guard("error"),
    debug: guard("debug"),
  };
}

export function createJobProducer(opts: JobProducerOptions): JobProducer {
  const { queue, enumerate } = opts;
  // Hardened once here so EVERY logger.* call in this module upholds the
  // "a tick promise never rejects" invariant — see safeLogger.
  const logger = safeLogger(opts.logger);
  const now = opts.now ?? (() => Date.now());
  const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const runIdFactory = opts.runIdFactory ?? defaultRunIdFactory(now);
  const onSweepCommErrors = opts.onSweepCommErrors;
  const warmHealth = opts.warmHealth;

  let running = false;
  /**
   * True once start() has EVER run. Distinguishes "stopped after running"
   * (one-way latch via `stopped`) from "never started": stop() before
   * start() must be a no-op, not a brick — see the JobProducer lifecycle
   * doc.
   */
  let started = false;
  let stopped = false;
  /**
   * ms-since-epoch of the last sweep, or null if none has run. Gates the
   * cadence: a sweep runs on a tick only when `now - lastSweepAt >=
   * sweepIntervalMs` (or always, when the interval is <= 0). null seeds
   * the FIRST tick to sweep so a control-plane that just booted with
   * orphaned leases from a prior crash reclaims them on its first cycle.
   */
  let lastSweepAt: number | null = null;
  /**
   * Sweep comm errors a previous sink delivery FAILED to hand off (REQ-B).
   * `sweepExpired` only synthesizes comm errors for rows reclaimed in that
   * call, so a dropped batch is gone for good — buffered batches are drained
   * (prepended to the fresh batch) on the next sweep's sink delivery. Capped
   * at `MAX_BUFFERED_SWEEP_COMM_ERRORS`, oldest dropped on overflow.
   */
  let undeliveredCommErrors: PoolCommError[] = [];
  /**
   * One-shot latch for the "comm errors swept but no sink configured" warn —
   * see deliverSweepCommErrors. Without it a sink-less deployment would log
   * the same wiring gap on every reclaiming sweep. Drops AFTER the first are
   * still logged — at debug, with the dropped jobIds — never fully silent.
   */
  let warnedNoCommErrorSink = false;
  /**
   * Running total of comm errors dropped because no sink is configured.
   * Carried on every no-sink log line (the one-shot warn and each subsequent
   * debug) so a single grepped line quantifies the cumulative loss.
   */
  let noSinkDroppedTotal = 0;
  /**
   * The currently-executing tick's promise, or null when no tick is in
   * flight. `stop()` awaits it so "stopped" means QUIESCED — an in-flight
   * tick can no longer keep enumerating/sweeping/enqueueing after stop()
   * resolves. (A tick promise never rejects — every failure path inside the
   * tick is caught — but stop() guards with .catch anyway.)
   */
  let inFlightTick: Promise<TickResult> | null = null;
  /**
   * The ONE operator-triggered tick queued behind an overlapping in-flight
   * tick, or null. A TRIGGERED tick that hits the re-entrancy guard is not
   * dropped (operator intent wins — see tick()); it waits for the in-flight
   * tick and then runs. Capped at one: a second concurrent trigger gets the
   * skip — the already-queued trigger covers "run after the in-flight tick".
   */
  let queuedTrigger: Promise<TickResult> | null = null;
  /**
   * The PRIMARY stop()'s full completion — quiesce loop AND final
   * comm-error drain — published synchronously by the first effective
   * stop() and shared by every later/concurrent stop(). A secondary stop()
   * that awaited only the in-flight tick could resolve while the primary
   * was still mid drain (awaiting the sink); sharing ONE completion means
   * EVERY stop() resolution implies the drain finished. null until the
   * primary stop runs.
   */
  let stopPromise: Promise<void> | null = null;

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
    // §4.2: every job a producer enqueues carries its family id so the
    // queue-client can denormalize it into the indexed `probe_jobs.family`
    // column (per-family listing without prefix-parsing probe_key).
    return { payload, family: opts.family };
  }

  /**
   * REQ-B delivery: hand the buffered undelivered comm errors plus `fresh`
   * (this sweep's batch, possibly empty) to the injected sink. Called on
   * EVERY sweep attempt — success or failure — so a persistently-throwing
   * `sweepExpired` (the exact failure mode the buffer rides out) can never
   * starve a healthy sink of the buffered batch. Best-effort: a sink failure
   * re-buffers the whole batch (capped at `MAX_BUFFERED_SWEEP_COMM_ERRORS`,
   * oldest dropped, warned) and never aborts job production.
   */
  async function deliverSweepCommErrors(fresh: PoolCommError[]): Promise<void> {
    if (!onSweepCommErrors) {
      // No sink wired (legacy logged-only mode): the batch's dashboard
      // signal is dropped HERE, permanently — sweepExpired cannot re-derive
      // it. Surface the wiring gap explicitly, with the dropped jobIds (not
      // just a count) and the running dropped-total — the full WARN only
      // ONCE so a sink-less deployment doesn't bury its logs on every sweep;
      // every later drop still logs at debug (greppable, never fully silent).
      if (fresh.length > 0) {
        noSinkDroppedTotal += fresh.length;
        const meta = {
          commErrors: fresh.length,
          droppedTotal: noSinkDroppedTotal,
          jobIds: fresh
            .map((e) => e.jobId)
            .filter((id): id is string => id !== undefined),
        };
        if (!warnedNoCommErrorSink) {
          warnedNoCommErrorSink = true;
          logger.warn("fleet.producer.sweep-commerrors-no-sink", meta);
        } else {
          logger.debug("fleet.producer.sweep-commerrors-no-sink", meta);
        }
      }
      return;
    }
    const batch = [...undeliveredCommErrors, ...fresh];
    undeliveredCommErrors = [];
    if (batch.length === 0) return;
    try {
      await onSweepCommErrors(batch);
    } catch (sinkErr) {
      logger.error("fleet.producer.sweep-commerror-sink-failed", {
        commErrors: batch.length,
        err: sinkErr instanceof Error ? sinkErr.message : String(sinkErr),
      });
      undeliveredCommErrors = batch;
      if (undeliveredCommErrors.length > MAX_BUFFERED_SWEEP_COMM_ERRORS) {
        const dropped =
          undeliveredCommErrors.length - MAX_BUFFERED_SWEEP_COMM_ERRORS;
        const droppedEntries = undeliveredCommErrors.slice(0, dropped);
        undeliveredCommErrors = undeliveredCommErrors.slice(dropped);
        // Identify the dropped jobs like the sibling drop paths (no-sink
        // drop, stop()-drain drop) — a count alone says THAT signals were
        // lost, never WHICH. SAMPLED (capped) unlike the siblings: an
        // overflow drop is unbounded, and a mass drop must not flood one
        // log line with thousands of ids.
        logger.warn("fleet.producer.sweep-commerror-buffer-overflow", {
          dropped,
          buffered: MAX_BUFFERED_SWEEP_COMM_ERRORS,
          jobIds: droppedEntries
            .slice(0, OVERFLOW_DROP_JOBID_SAMPLE)
            .map((e) => e.jobId)
            .filter((id): id is string => id !== undefined),
        });
      }
    }
  }

  /**
   * Run the lease sweep if the cadence window has elapsed. Returns the
   * sweep outcome (or a no-sweep sentinel). Sweep failures are logged and
   * swallowed — a transient PB blip on the reclamation path must NEVER
   * abort job production (the next tick retries).
   */
  async function maybeSweep(nowMs: number): Promise<{
    swept: boolean;
    sweepFailed: boolean;
    reclaimed: number;
    reclaimedIndeterminate?: number;
  }> {
    const due =
      sweepIntervalMs <= 0 ||
      lastSweepAt === null ||
      nowMs - lastSweepAt >= sweepIntervalMs;
    if (!due) return { swept: false, sweepFailed: false, reclaimed: 0 };
    lastSweepAt = nowMs;
    try {
      const result = await queue.sweepExpired(nowMs);
      if (
        result.reclaimed > 0 ||
        result.commErrors.length > 0 ||
        (result.expiredPending ?? 0) > 0
      ) {
        logger.warn("fleet.producer.sweep-reclaimed", {
          reclaimed: result.reclaimed,
          commErrors: result.commErrors.length,
          expiredPending: result.expiredPending ?? 0,
        });
      }
      // REQ-B: forward the swept `worker-reclaimed-pending` comm errors to the
      // injected sink so each reclaimed job's gray "re-queued" surface reaches
      // the dashboard (the producer owns no status pipeline of its own). Previously
      // these were DROPPED after logging their count — the crash/lease-expiry
      // overlay never surfaced. Best-effort: a sink failure must not abort job
      // production. But `sweepExpired` only synthesizes comm errors for rows
      // reclaimed in THIS call — a later sweep canNOT re-derive a missed batch —
      // so a failed delivery is BUFFERED (not dropped) and the buffer is drained,
      // prepended to the fresh batch, on the next delivery attempt (see
      // deliverSweepCommErrors — it runs on every sweep attempt, even a failed
      // one). The buffer is capped at MAX_BUFFERED_SWEEP_COMM_ERRORS.
      await deliverSweepCommErrors(result.commErrors);
      // §4.2 RETENTION PRUNE — gated on PRUNE_OWNER_FAMILY (the §5.1 registry's
      // D6 family id) so exactly ONE of the four producers sharing this
      // sweep-gate pattern owns the delete pass
      // (the prune itself is family-agnostic: one pass covers all families,
      // and it is idempotent, so a missed tick is harmless). Rides the same
      // due-window as the sweep. Best-effort: a prune failure is logged and
      // NEVER aborts job production — mirror the sweep's swallow discipline.
      if (opts.family === PRUNE_OWNER_FAMILY) {
        try {
          const pruned = await queue.pruneAged(nowMs);
          if (pruned.terminal > 0 || pruned.zombie > 0) {
            // Spread: `PruneAgedResult` is a closed interface with no index
            // signature, so it isn't assignable to the logger's
            // `Record<string, unknown>` context parameter directly.
            logger.info("fleet.producer.pruned-aged-jobs", { ...pruned });
          }
        } catch (pruneErr) {
          logger.warn("fleet.producer.prune-failed", {
            err:
              pruneErr instanceof Error ? pruneErr.message : String(pruneErr),
          });
        }
      }
      // The queue-client's sweep splits out reclaims whose release outcome
      // was indeterminate (`reclaimedIndeterminate`, optional on the shared
      // `SweepResult` contract; the real queue-client always reports it).
      // Surface it on the TickResult only when reported.
      const indeterminate = result.reclaimedIndeterminate;
      return {
        swept: true,
        sweepFailed: false,
        reclaimed: result.reclaimed,
        ...(typeof indeterminate === "number"
          ? { reclaimedIndeterminate: indeterminate }
          : {}),
      };
    } catch (err) {
      logger.error("fleet.producer.sweep-failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      // Even though THIS sweep produced no comm errors, a PREVIOUS sweep's
      // batch may be sitting in the buffer — drain it now. The drain must not
      // depend on the current sweep call's success: a persistently-throwing
      // sweepExpired is the exact failure mode the buffer exists to ride out,
      // and gating the drain on sweep success starved a healthy sink forever.
      await deliverSweepCommErrors([]);
      // A failed sweep still counts as "swept" for cadence purposes — we
      // don't want a persistently-failing sweep to fire on every tick and
      // bury the logs; the window already advanced via lastSweepAt. But it
      // is REPORTED as failed (`sweepFailed: true`) so the tick outcome no
      // longer presents a thrown sweep as a clean zero-reclaim success.
      return { swept: true, sweepFailed: true, reclaimed: 0 };
    }
  }

  /**
   * BACKLOG DEDUPE GATE (scheduled ticks only). A producer tick must NOT
   * enqueue a fresh batch for a family that already has NON-TERMINAL
   * (pending/claimed/running) jobs on the queue: with 2 serial browser
   * workers against ~180 jobs/hr of inflow the un-gated producers compounded
   * a multi-thousand-row backlog (staging: 3,734 pending, oldest 22h) that
   * starved low-frequency families out of the claim page entirely. Counting
   * in-flight (claimed/running) rows too means the gate bounds the family's
   * CONCURRENT RUNS, not just its unclaimed batches — a fresh batch on top
   * of a claimed-but-running one would double the family's concurrency.
   * Skipping the batch bounds the per-family backlog to ONE batch — the next
   * tick re-checks and produces again once the workers have finished it. Grouped per family so a (hypothetical)
   * multi-family tick gates each family independently — note the regroup
   * means a multi-family tick's KEPT specs come out family-grouped, not in
   * the enumerator's interleave order (harmless today: production ticks are
   * single-family). TWO failure classes on the count read:
   *   - POISONED COUNT (fail CLOSED): `countPendingForFamily` THROWS its
   *     documented refusal when the backend hands back a non-count
   *     totalItems — returning it would silently open the gate on top of an
   *     existing backlog. Failing OPEN here would defeat that fail-closed
   *     throw, so for this class the family's batch is SKIPPED (accounted
   *     as skippedForBacklog) and logged at error.
   *   - TRANSIENT READ BLIP (fail OPEN): any other count failure must never
   *     stop job production (the legacy un-gated behavior is the safe
   *     fallback), mirroring maybeSweep's swallow-and-log discipline.
   *
   * COUNT-SCOPE NOTE (consumer side): the non-terminal count includes rows
   * the stale-pending sweeper currently holds mid-deletion (claimed under
   * its sweeper id) — they are about to be deleted, not real backlog, so
   * the gate can over-count by the in-flight deletion set for one tick.
   * The status filter itself lives in the queue-client
   * (`countPendingForFamily`); excluding sweeper-held rows would be a
   * queue-client change, noted here only because this gate consumes it.
   */
  async function filterBackloggedFamilies(
    specs: ServiceJobSpec[],
    runId: string,
  ): Promise<{ specs: ServiceJobSpec[]; skipped: number; failedOpen: number }> {
    const byFamily = new Map<string, ServiceJobSpec[]>();
    for (const spec of specs) {
      const family = probeKeyFamily(spec.probeKey);
      const group = byFamily.get(family);
      if (group) group.push(spec);
      else byFamily.set(family, [spec]);
    }
    const kept: ServiceJobSpec[] = [];
    let skipped = 0;
    let failedOpen = 0;
    for (const [family, group] of byFamily) {
      let pendingCount: number;
      try {
        pendingCount = await queue.countPendingForFamily(family);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof PoisonedBacklogCountError) {
          // FAIL CLOSED: the queue-client refused a poisoned (non-count)
          // totalItems rather than fail the gate open — honoring that means
          // SKIPPING this family's batch, not producing on top of an
          // unknowable backlog. The next tick re-checks. Discriminated via
          // the DEDICATED exported class (instanceof) — the old
          // message-substring match silently flipped this fail-closed class
          // into the fail-open catch below on any message drift.
          skipped += group.length;
          logger.error("fleet.producer.backlog-check-poisoned", {
            runId,
            family,
            skippedJobs: group.length,
            err: message,
          });
          continue;
        }
        // FAIL OPEN: a transient read blip must never stop production.
        // Counted (per FAMILY) into the tick outcome so a failed-open gate
        // is distinguishable from a clean zero-backlog read.
        failedOpen += 1;
        logger.error("fleet.producer.backlog-check-failed", {
          runId,
          family,
          err: message,
        });
        kept.push(...group);
        continue;
      }
      if (pendingCount > 0) {
        skipped += group.length;
        logger.warn("fleet.producer.skipped-for-backlog", {
          runId,
          family,
          pendingCount,
          skippedJobs: group.length,
        });
        continue;
      }
      kept.push(...group);
    }
    return { specs: kept, skipped, failedOpen };
  }

  /**
   * Fire-and-forget pre-dispatch health warm-up (flap-band #72). For each
   * enumerated spec with a backend URL, fire a `GET <backendUrl>/health` so a
   * cold container starts waking before its pill probes it. Best-effort: every
   * GET has a short abort timeout and its rejection is swallowed (logged at
   * debug) — a warm failure must NEVER block or fail job production. Returns the
   * count of warm GETs fired (for the tick log / tests). The GETs are NOT
   * awaited to completion (we await the dispatch, not the responses) so a slow
   * cold container never delays enqueueing the run.
   */
  function warmEnumeratedBackends(specs: ServiceJobSpec[]): number {
    if (!warmHealth) return 0;
    const { fetchImpl } = warmHealth;
    const timeoutMs = warmHealth.timeoutMs ?? DEFAULT_WARM_TIMEOUT_MS;
    let fired = 0;
    // Specs skipped before any warm dispatch (no/garbage backendUrl). Each
    // skip is debug-logged with its reason so a per-spec coverage gap is
    // greppable; when EVERY spec of a non-empty tick is skipped the #72
    // mitigation is silently inert — that wiring regression gets one WARN
    // per tick (see below).
    let skipped = 0;
    for (const spec of specs) {
      const backendUrl = backendUrlFromSpec(spec);
      if (backendUrl === undefined) {
        skipped += 1;
        logger.debug("fleet.producer.warm-skipped", {
          serviceSlug: spec.serviceSlug,
          reason: "missing-backendUrl",
        });
        continue;
      }
      const healthUrl = deriveHealthUrl(backendUrl);
      if (healthUrl === "") {
        skipped += 1;
        logger.debug("fleet.producer.warm-skipped", {
          serviceSlug: spec.serviceSlug,
          reason: "malformed-backendUrl",
        });
        continue;
      }
      // Fire-and-forget: an AbortController bounds each GET so a hung cold
      // container can't leak a pending request across ticks. The whole chain is
      // swallowed — warm-up is a latency optimization, never a correctness gate.
      // The DISPATCH itself is try/caught too: an injected fetchImpl that throws
      // SYNCHRONOUSLY must not escape the loop and abort the tick before any
      // job is enqueued.
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        // Never let a pending warm timer hold the process open (guarded:
        // fake-timer impls may hand back handles without unref).
        (timer as unknown as { unref?: () => void }).unref?.();
        void fetchImpl(healthUrl, { method: "GET", signal: ac.signal })
          .then(
            (res) => {
              // Consume the response: under undici an unread body pins the
              // socket. Best-effort cancel, guarded for non-stream fakes.
              try {
                void res.body?.cancel()?.catch?.(() => {});
              } catch {
                // a fake Response without a cancellable body — nothing to free
              }
              if (res.ok) {
                logger.debug("fleet.producer.warm-ok", {
                  serviceSlug: spec.serviceSlug,
                  healthUrl,
                  status: res.status,
                });
              } else {
                // A SETTLED response is not a warm success: a 404/500/503
                // (e.g. a misderived backendUrl) logged as warm-ok would
                // masquerade as healthy forever. Still debug-level — a cold
                // container can 503 while booting, which is the expected
                // case the warm exists for.
                logger.debug("fleet.producer.warm-failed", {
                  serviceSlug: spec.serviceSlug,
                  healthUrl,
                  status: res.status,
                });
              }
            },
            (err: unknown) => {
              // A cold container still booting / a network blip is EXPECTED here —
              // the warm is precisely for the not-yet-ready case. Debug-level only.
              logger.debug("fleet.producer.warm-failed", {
                serviceSlug: spec.serviceSlug,
                healthUrl,
                err: err instanceof Error ? err.message : String(err),
              });
            },
          )
          .finally(() => clearTimeout(timer))
          // Terminal backstop: the handlers above can THEMSELVES throw (an
          // injected logger whose transport is down) — without this catch
          // that surfaces as an unhandled rejection from a fire-and-forget
          // chain nobody awaits.
          .catch(() => {});
        // Counted AFTER the dispatch: a fetchImpl that throws synchronously
        // lands in the catch below and must not be reported as "warmed".
        fired += 1;
      } catch (err) {
        logger.debug("fleet.producer.warm-failed", {
          serviceSlug: spec.serviceSlug,
          healthUrl,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (fired > 0) {
      logger.info("fleet.producer.warmed", { warmed: fired });
    }
    // ZERO-WARMABLE WARN: warm-up is configured but NO spec of a non-empty
    // tick could even be dispatched — the enumerator stopped threading
    // backendUrl (or threads garbage), so the cold-start mitigation is
    // silently inert fleet-wide. One warn per tick (the per-spec debug
    // skips above carry the detail). Keyed on `skipped`, not `fired`: a
    // sync-throwing fetchImpl still ATTEMPTED a warm — that is a dispatch
    // failure (already logged), not a coverage gap.
    if (specs.length > 0 && skipped === specs.length) {
      logger.warn("fleet.producer.warm-none-warmable", {
        services: specs.length,
      });
    }
    return fired;
  }

  /** One production cycle — the body `tick()` runs and `stop()` quiesces on. */
  async function runTick(tickOpts?: TickOptions): Promise<TickResult> {
    if (!running) {
      // Defensive: a tick that arrives after stop() (or before start())
      // produces nothing. Mirrors the scheduler's drain-after-stop
      // discipline — no jobs leak past the producer's lifecycle. No runId
      // is minted: a stopped tick must not burn the factory counter or log
      // a phantom runId no job will ever carry.
      // started/stopped discriminate the two opposite wiring bugs this warn
      // flags: a tick BEFORE boot wiring started the producer (started:
      // false) vs a scheduler still firing AFTER shutdown stopped it
      // (started+stopped: true).
      logger.warn("fleet.producer.tick-while-stopped", {
        triggered: tickOpts?.triggered === true,
        started,
        stopped,
      });
      return skippedTickResult();
    }
    const runId = runIdFactory();
    const triggered = tickOpts?.triggered === true;

    // Logged BEFORE the enumerate await: a discovery upstream that hangs or
    // throws must still leave a trace that this tick (and its runId) began.
    logger.info("fleet.producer.tick-start", { runId, triggered });

    const enumerateCtx: EnumerateContext = { triggered, runId };
    // The filter is TRIGGER-ONLY: a scheduled (cron) tick must never be
    // scoped, so a filter passed without `triggered: true` is dropped (and
    // warned) rather than forwarded to the enumerator.
    if (tickOpts?.filter !== undefined) {
      if (triggered) {
        enumerateCtx.filter = tickOpts.filter;
      } else {
        logger.warn("fleet.producer.filter-ignored-scheduled", { runId });
      }
    }

    let specs: ServiceJobSpec[];
    try {
      const enumerated = await enumerate(enumerateCtx);
      if (!Array.isArray(enumerated)) {
        // A misbehaving enumerator (bad wiring, a mock resolving undefined)
        // is a FAILED enumeration, not an empty catalog — route it through
        // the same failure handling as a throw instead of letting the
        // non-array value blow up further down the tick.
        throw new Error(
          `enumerator resolved to a non-array value (${typeof enumerated})`,
        );
      }
      specs = enumerated;
    } catch (err) {
      // Enumeration failure short-circuits production (no services →
      // nothing to enqueue). Still attempt the sweep so dead-worker
      // reclamation isn't starved by a flaky discovery upstream. The clock
      // is read AFTER the (potentially slow) enumerate await so the sweep's
      // expiry decisions aren't back-dated to tick start.
      logger.error("fleet.producer.enumerate-failed", {
        runId,
        triggered,
        err: err instanceof Error ? err.message : String(err),
      });
      const sweep = await maybeSweep(now());
      return {
        runId,
        enqueued: 0,
        enqueueFailures: 0,
        skippedForBacklog: 0,
        backlogGateFailedOpen: 0,
        truncatedByStop: 0,
        sweptExpired: sweep.swept,
        sweepFailed: sweep.sweepFailed,
        reclaimed: sweep.reclaimed,
        ...(sweep.reclaimedIndeterminate !== undefined
          ? { reclaimedIndeterminate: sweep.reclaimedIndeterminate }
          : {}),
        enumerateFailed: true,
      };
    }

    // PHANTOM-FAMILY GUARD: the enumerator is injected, so a misbehaving
    // upstream can hand back a spec with an EMPTY probeKey. Downstream that
    // is poison twice over: `probeKeyFamily("")` returns "" (contracts.ts),
    // so the backlog gate would count a phantom "" family that gates
    // nothing real, and the enqueued claim row's empty probe_key can never
    // join a dashboard status row. Dropped HERE — before the gate, the
    // warm-up, and the enqueue loop, on scheduled AND triggered ticks —
    // logged at error per spec, and counted into `enqueueFailures` (after
    // the enqueue loop, see below) so the tick's partition invariant stays
    // honest: the spec failed to become a job.
    let invalidSpecs = 0;
    const validSpecs: ServiceJobSpec[] = [];
    for (const spec of specs) {
      // ELEMENT-SHAPE GUARD first: the enumerator is injected, so an element
      // can be null/undefined/a primitive — dereferencing `.probeKey` on
      // those THREW a TypeError out of the tick body, rejecting the tick
      // promise (violating the "a tick promise never rejects" invariant; a
      // rejection inside stop()'s quiesce would poison stopPromise). Same
      // honest accounting as the empty-probeKey drop below.
      if (spec === null || typeof spec !== "object") {
        invalidSpecs += 1;
        logger.error("fleet.producer.spec-invalid-probekey", {
          runId,
          spec: String(spec),
        });
        continue;
      }
      if (typeof spec.probeKey !== "string" || spec.probeKey.length === 0) {
        invalidSpecs += 1;
        logger.error("fleet.producer.spec-invalid-probekey", {
          runId,
          serviceSlug: spec.serviceSlug,
          probeKey: String(spec.probeKey),
        });
        continue;
      }
      validSpecs.push(spec);
    }

    // SWEEP FIRST: the sweep's stale-pending drain can clear a family's
    // entire backlog (a backlog of only-stale rows). Running it BEFORE the
    // backlog gate means the very tick that drains a family also resumes
    // its production — sweeping after the gate made production resume a
    // full cron period late. Same cadence gate and fail-open semantics
    // (maybeSweep swallows sweep failures); only the order changed. The
    // clock is re-read HERE — after the potentially-seconds-long enumerate
    // await — so lease-expiry decisions and lastSweepAt aren't back-dated
    // to tick start.
    const sweep = await maybeSweep(now());

    // BACKLOG DEDUPE: scheduled ticks skip any family whose previous batch
    // is still non-terminal (pending/claimed/running) — see
    // filterBackloggedFamilies. Operator-
    // triggered ticks BYPASS the gate: an explicit trigger is a deliberate
    // "run it NOW" (the CLI even treats 0 enqueued as a failure), so
    // operator intent wins over backpressure.
    const gate = triggered
      ? { specs: validSpecs, skipped: 0, failedOpen: 0 }
      : await filterBackloggedFamilies(validSpecs, runId);

    // #72 PRE-DISPATCH WARM-UP: fire fire-and-forget health GETs at every
    // backend that will actually be enqueued (post-gate) BEFORE enqueueing,
    // so cold containers start waking ahead of the pills that probe them.
    // Best-effort and non-blocking — the GETs are dispatched (not awaited),
    // so a slow cold container never delays the run's enqueue.
    warmEnumeratedBackends(gate.specs);

    let enqueued = 0;
    let enqueueFailures = 0;
    let truncatedByStop = 0;
    for (const spec of gate.specs) {
      // QUIESCE re-check: stop() flips `running` and then awaits this tick.
      // Dispatching the REST of the batch after stop began would leak jobs
      // past the producer's lifecycle — truncate, loudly, and ACCOUNT for
      // the truncated specs (they must not vanish from the tick outcome).
      if (!running) {
        truncatedByStop = gate.specs.length - enqueued - enqueueFailures;
        logger.warn("fleet.producer.enqueue-truncated-stopped", {
          runId,
          enqueued,
          enqueueFailures,
          remaining: truncatedByStop,
        });
        break;
      }
      const meta: ServiceJobMeta = {
        runId,
        triggered,
        // Stamped at ENQUEUE time (the documented meaning: 'ISO timestamp
        // the control-plane enqueued the job'), not at tick start — a slow
        // enumerate/sweep must not back-date it.
        enqueuedAt: new Date(now()).toISOString(),
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

    // Fold the phantom-probeKey drops into the failure count AFTER the
    // enqueue loop: the loop's truncation arithmetic is relative to
    // `gate.specs` (already invalid-free), so folding earlier would
    // double-subtract them from `truncatedByStop`.
    enqueueFailures += invalidSpecs;

    // `services` partitions exactly: services == enqueued + enqueueFailures
    // + skippedForBacklog + truncatedByStop (see TickResult.truncatedByStop).
    logger.info("fleet.producer.tick-complete", {
      runId,
      triggered,
      services: specs.length,
      enqueued,
      enqueueFailures,
      skippedForBacklog: gate.skipped,
      backlogGateFailedOpen: gate.failedOpen,
      truncatedByStop,
      sweptExpired: sweep.swept,
      sweepFailed: sweep.sweepFailed,
      reclaimed: sweep.reclaimed,
      ...(sweep.reclaimedIndeterminate !== undefined
        ? { reclaimedIndeterminate: sweep.reclaimedIndeterminate }
        : {}),
    });

    return {
      runId,
      enqueued,
      enqueueFailures,
      skippedForBacklog: gate.skipped,
      backlogGateFailedOpen: gate.failedOpen,
      truncatedByStop,
      sweptExpired: sweep.swept,
      sweepFailed: sweep.sweepFailed,
      reclaimed: sweep.reclaimed,
      ...(sweep.reclaimedIndeterminate !== undefined
        ? { reclaimedIndeterminate: sweep.reclaimedIndeterminate }
        : {}),
      enumerateFailed: false,
    };
  }

  return {
    start() {
      if (stopped) {
        logger.warn("fleet.producer.start-after-stop");
        return;
      }
      if (running) return;
      running = true;
      started = true;
      logger.info("fleet.producer.start", { sweepIntervalMs });
    },

    async stop() {
      // ANY stop() after the primary — concurrent or later — shares the
      // primary's full completion (quiesce loop AND final drain). The old
      // secondary path awaited only the in-flight tick / queued trigger,
      // so with neither in flight it resolved IMMEDIATELY while the primary
      // was still mid final-drain (awaiting the sink) — a shutdown
      // sequenced on the second stop() could tear the aggregator down
      // under the still-delivering drain. Every stop() resolution must
      // imply the drain finished.
      if (stopPromise !== null) {
        await stopPromise;
        return;
      }
      if (!started) {
        // stop() BEFORE start(): nothing ever ran, so there is nothing to
        // quiesce or drain — and latching `stopped` here (the old
        // behavior) permanently bricked the producer: every later start()
        // hit the start-after-stop latch. A teardown racing ahead of boot
        // wiring is a benign ordering, not a lifecycle end — no-op.
        logger.debug("fleet.producer.stop-before-start");
        return;
      }
      // PRIMARY stop. The flags AND stopPromise are published SYNCHRONOUSLY
      // (before any await), so a concurrent second stop() always lands on
      // the shared-completion path above — `started && !running` with a
      // null stopPromise is unreachable.
      running = false;
      stopped = true;
      stopPromise = (async () => {
        // QUIESCE: an in-flight tick observed `running === true` at entry and
        // may still be enumerating/sweeping/enqueueing. "Stopped" must mean the
        // tick is DONE — its enqueue loop truncates on the flag flipped above,
        // and stop() resolves only once the tick has fully unwound. A LOOP, not
        // a single await: a queued trigger (see the re-entrancy guard) takes
        // the in-flight slot after the current tick resolves — its (skipped,
        // `running` is false) run must also unwind before stop() resolves.
        while (inFlightTick !== null || queuedTrigger !== null) {
          await (inFlightTick ?? queuedTrigger)!.catch(() => {});
        }
        // FINAL DRAIN: buffered undelivered comm errors would otherwise die
        // with the process — `sweepExpired` cannot re-derive a missed batch.
        // One best-effort delivery; if it fails too, the batch is dropped
        // LOUDLY (count + jobIds at error level), never silently.
        if (
          undeliveredCommErrors.length > 0 &&
          onSweepCommErrors !== undefined
        ) {
          const batch = undeliveredCommErrors;
          undeliveredCommErrors = [];
          try {
            await onSweepCommErrors(batch);
          } catch (err) {
            logger.error("fleet.producer.stop-commerrors-dropped", {
              dropped: batch.length,
              jobIds: batch
                .map((e) => e.jobId)
                .filter((id): id is string => id !== undefined),
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        logger.info("fleet.producer.stop");
      })();
      await stopPromise;
    },

    isRunning() {
      return running;
    },

    async tick(tickOpts?: TickOptions): Promise<TickResult> {
      // RE-ENTRANCY GUARD: a slow tick (sluggish enumerate/PB) overlapping
      // the next cron tick double-enqueued the same family — both ticks read
      // the backlog gate's pending count BEFORE either had enqueued (gate
      // TOCTOU), so both saw "no backlog" and both produced a batch. A
      // SCHEDULED overlapping tick is skipped — the cron's NEXT tick will
      // produce. A TRIGGERED overlapping tick is NOT dropped (an explicit
      // operator "run it NOW" must win — the same rationale that lets a
      // trigger bypass the backlog gate): it QUEUES BEHIND the in-flight
      // tick and runs once that tick completes. Capped at ONE queued
      // trigger — a second concurrent trigger gets the skip, since the
      // already-queued trigger covers "run after the in-flight tick".
      const triggered = tickOpts?.triggered === true;
      if (inFlightTick !== null) {
        if (!triggered || queuedTrigger !== null) {
          logger.warn("fleet.producer.tick-overlap-skipped", {
            triggered,
            ...(triggered ? { reason: "trigger-already-queued" } : {}),
          });
          return skippedTickResult();
        }
        logger.warn("fleet.producer.trigger-queued-behind-overlap", {});
        const queued = (async (): Promise<TickResult> => {
          // Loop (not a single await): by the time the awaited tick's
          // continuations run, another tick may already occupy the slot.
          while (inFlightTick !== null) {
            await inFlightTick.catch(() => {});
          }
          queuedTrigger = null;
          if (!running) {
            // stop() flipped `running` while this trigger waited behind the
            // in-flight tick — a quiesce ordering the producer itself
            // orchestrated, NOT the scheduler-wiring bug runTick's
            // tick-while-stopped WARN flags. Distinct debug event so the
            // ordering stays observable without a misleading warn.
            logger.debug("fleet.producer.queued-trigger-after-stop");
            return skippedTickResult();
          }
          const ticking = runTick(tickOpts);
          inFlightTick = ticking;
          try {
            return await ticking;
          } finally {
            inFlightTick = null;
          }
        })();
        queuedTrigger = queued;
        return queued;
      }
      const ticking = runTick(tickOpts);
      inFlightTick = ticking;
      try {
        return await ticking;
      } finally {
        inFlightTick = null;
      }
    },
  };
}

/**
 * Default run-id factory: timestamp + per-factory random discriminator +
 * monotonic counter composite, matching the scheduler's `nextRunId` idiom so
 * two runs that land in the same ms still get distinct ids. The DISCRIMINATOR
 * (generated once at factory creation) exists because every producer instance
 * gets an INDEPENDENT default factory whose counter starts at 0 — without it,
 * two producers ticking in the same ms with equal tick counts minted the SAME
 * runId, and the aggregator groups results by `meta.runId`. The timestamp
 * segment still leads, keeping ids sortable-prefixed. Reads the producer's
 * injected clock (injection-discipline consistency with the rest of the
 * module); behavior is otherwise identical to the Date.now form.
 */
function defaultRunIdFactory(
  now: () => number = () => Date.now(),
): () => string {
  let counter = 0;
  const discriminator = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return () => {
    counter += 1;
    return `frun_${now().toString(36)}_${discriminator}_${counter.toString(36)}`;
  };
}
