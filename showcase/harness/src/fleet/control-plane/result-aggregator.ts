/**
 * Control-plane RESULT AGGREGATOR (BLITZ S5).
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────
 * Workers (S7) compute the per-service rollup and report a `ServiceJobResult`
 * back through the queue protocol (S3 `FleetQueueClient.report`). This module
 * is the control-plane side that PERSISTS that result so the dashboard sees it.
 * It deliberately writes through the EXISTING storage path — it does NOT invent
 * a new row shape:
 *
 *   - the per-cell + aggregate `ProbeResult`s go through the unchanged
 *     `status-writer` (`createStatusWriter`), so the dashboard's status rows
 *     keep their exact keys: the aggregate `d6:<slug>` primary row and one
 *     `d6:<slug>/<featureId>` side row per cell. (The worker emits `d6:<slug>`
 *     as the primary key on BOTH the success and comm-error legs — the same key
 *     the dashboard reads back — so the overlay always lands where the
 *     dashboard looks.) The status-writer owns the state machine (transition
 *     detection, flap counting, history) — we do not reimplement any of it.
 *   - the pass/fail rollup goes through the unchanged `run-history`
 *     (`ProbeRunWriter`) as a `ProbeRunSummary`, keyed by `probeId =
 *     aggregateKey` (same `probeId` the in-process d6 driver uses today via
 *     `probe-invoker`), so the dashboard's run-history widget is unchanged.
 *
 * ── REQ-B: COMM-ERROR OVERLAY ──────────────────────────────────────────
 * When a job carries a `PoolCommError` (the control-plane or worker self-
 * monitor could not REACH/TRUST the pool — distinct from a probe red), the
 * comm error is surfaced onto the PRIMARY row's signal. The persisted
 * `status` schema is unchanged (the comm error rides in the signal blob under
 * `FLEET_COMM_ERROR_SIGNAL_KEY`); the dashboard reads it back via
 * `commErrorFromStatusSignal` and renders "couldn't reach the pool"
 * distinctly, and the row's durable colour is never stomped by the error.
 *
 * HOW the comm error reaches the signal depends on the H1 route (B5 — this
 * asymmetry is DELIBERATE, not drift):
 *   - TRUSTED-NEGATIVE rows (a red/degraded primary or cell) write durably
 *     through `write()` with `withCommErrorOverlay(pr.signal, result)` — the
 *     fresh observation's signal is kept and the comm error is layered onto
 *     it, so the dashboard re-surfaces "unreachable" off the durable row.
 *   - The OVERLAY-FIRST route (the untrusted primary / any NON-trusted-negative
 *     cell — the predicate is !trustedNegative, so green, "error" and unknown
 *     colours all route here, not just green)
 *     sends `writeOverlay` ONLY the bare `commErrorToStatusSignal(err)` — the
 *     result's fresh `pr.signal` is deliberately DROPPED: the result is
 *     untrusted, and an applied overlay merges over the LIVE row's signal, so
 *     carrying the untrusted payload would stomp trusted observed fields on a
 *     row we explicitly chose not to re-write. (Same bare-overlay posture as
 *     `aggregateCommError`, which has no worker signal at all.)
 *   - The overlay FALLBACK (history-only no-data write on a row miss) merges
 *     the comm error onto the untrusted `pr.signal` again — that write is an
 *     AUDIT record in `status_history`, never durable state, so the untrusted
 *     payload is useful context there rather than a trust hazard.
 *
 * ── SEAMS the control-plane WIRING slot (S4) calls ─────────────────────
 * The wiring slot constructs a `ResultAggregator` with a live `StatusWriter`
 * (`createStatusWriter({ pb, bus, logger, writtenBy: "fleet-cp" })`), a live
 * `ProbeRunWriter`
 * (`createProbeRunWriter(pb)`), and a clock, then calls `aggregate(result)`
 * for each `ServiceJobResult` the queue-client surfaces. This module owns NO
 * PocketBase access of its own — it is pure orchestration over the two
 * injected writers, which keeps it trivially unit-testable with fakes.
 */

import type {
  Logger,
  ProbeResult,
  ProbeState,
  State,
  WriteOutcome,
} from "../../types/index.js";
import { asKnownState } from "../../types/index.js";
import type { ProbeRunWriter } from "../../probes/run-history.js";
import type {
  OverlayWriteOutcome,
  StatusWriter,
} from "../../writers/status-writer.js";
// B5: the PB-outage legs below serialize their swallowed errors through the
// status-writer's shared extractor so HTTP status codes + PB validation
// payloads survive into the logs (message-only logging hid them). Value
// imports are safe: status-writer imports nothing from this module (both
// modules now source `asKnownState` from its canonical home in `types/`,
// which sits below both and keeps the graph acyclic).
import { errorInfo, serializeErr } from "../../writers/status-writer.js";
import {
  commErrorToStatusSignal,
  probeResultsForServiceJobResult,
  runSummaryForServiceJobResult,
  terminalJobStatus,
  type PoolCommError,
  type ServiceJobResult,
} from "../contracts.js";

/** Outcome of aggregating one `ServiceJobResult`. */
export interface AggregateOutcome {
  /**
   * The run-history (`probe_runs`) row id this result is associated with —
   * one of three cases:
   *   - the row CREATED for this result (the normal path);
   *   - the prior attempt's still-`running` row, REUSED when resuming a
   *     crashed-mid-aggregate run (no duplicate row is minted);
   *   - the PRIOR run's terminal row id on the dedup-skip path
   *     ({@link AggregateOutcome.skipped} `true`) — nothing was written this
   *     call, the id identifies the already-aggregated run.
   * `null` only when `runWriter.start` failed (no row exists for this job).
   */
  runRowId: string | null;
  /**
   * The per-write outcomes the status-writer returned, in write order. NOTE:
   * when a row takes the H1 overlay route under a comm error (the primary on
   * the overlay-first route, or any NON-trusted-negative cell — the predicate
   * is !trustedNegative, so green, "error" and unknown colours all route
   * overlay-first, not just green — B2), that row's
   * outcome appears in {@link AggregateOutcome.overlayOutcomes} instead —
   * `statusOutcomes` then carries the remaining durable writes (plus any
   * overlay-fallback history-only write).
   */
  statusOutcomes: WriteOutcome[];
  /**
   * The overlay outcomes returned by `writeOverlay`, in write order (H1).
   * Non-empty only when a row (the primary, or any non-trusted-negative
   * cell — B2) took the overlay-first route under a comm error.
   */
  overlayOutcomes: OverlayWriteOutcome[];
  /**
   * True when this call was a dedup NO-OP: a terminal `probe_runs` row already
   * existed for this `jobId` (the result was already fully aggregated on a
   * prior tick whose latch write later failed), so we wrote NOTHING — no status
   * row, no history, no duplicate run row, no `status.changed`. Lets the
   * consumer/tests assert idempotency.
   */
  skipped: boolean;
  /**
   * [B3 round 7] Keys whose comm-error fallback was SKIPPED because the
   * overlay write was swallowed by a best-effort-wrapped writer (PB outage:
   * `applied: false` + `persisted: false`). For those keys the comm error
   * was NOT persisted anywhere, and because this call still RESOLVES
   * successfully (the run row finishes terminal and the consumer latches),
   * nothing retries it — the drop is PERMANENT under a best-effort wrapper.
   * This field is the caller-observable discriminator for that drop (the
   * fleet wiring injects the real throwing writer, where an outage rejects
   * per the error contract and retries instead). Always present on outcomes
   * produced by `createResultAggregator` (empty when no key was skipped);
   * typed optional only so existing fakes/wrappers stay shape-compatible.
   */
  outageSkippedKeys?: string[];
  /**
   * [B3 round 7, widened G2r8/G2r9] True when the result carried a
   * `commError` but the comm error did NOT reach the AGGREGATE row the
   * dashboard reads (`result.aggregateKey`). Per-case nuances:
   *   - the projection produced NO rows (B3r7): a TOTAL drop — the comm
   *     error reached neither a status row nor `status_history`;
   *   - every projected row was blank-skipped, emptying the write plan
   *     (G2r8): the same total drop;
   *   - the projected PRIMARY drifted from `result.aggregateKey` and was
   *     refused (G2r8): cells still process independently, so a
   *     trusted-negative cell can still persist the comm error on its OWN
   *     row — the drop is aggregate-row-specific, not necessarily total;
   *   - the PRIMARY was blank-skipped while cells survived (G2r9): same
   *     aggregate-row-specific drop.
   * Each leg error-logs, but the outcome would otherwise be healthy-shaped
   * and the drop unobservable to callers. Deliberately a discriminator
   * rather than a throw: a DETERMINISTIC defect on any of these legs would
   * infinite-retry through the consumer's unlatch-on-reject path, and the
   * drop is PERMANENT (the run row still finishes terminal and the consumer
   * latches). Always present on outcomes produced by
   * `createResultAggregator`; typed optional only for fake/wrapper
   * shape-compatibility.
   */
  droppedCommError?: boolean;
  /**
   * [G2r9] Keys skipped on the NO-commError path because the projected row
   * carried a CORRUPT colour — not a known `State` and not the legitimate
   * `"error"` no-data state. Writing one would 400 on PB's required `state`
   * select, rejecting the whole aggregation — a DETERMINISTIC fault the
   * consumer would unlatch-retry forever (the hot-loop class this module
   * guards everywhere else), so the row is loudly skipped and surfaced here
   * instead. (Under a commError a corrupt colour already routes
   * overlay-first — !trustedNegative — and never writes durably.) Always
   * present on outcomes produced by `createResultAggregator` (empty when no
   * row was skipped); typed optional only for fake/wrapper
   * shape-compatibility.
   */
  corruptStateSkippedKeys?: string[];
}

export interface ResultAggregator {
  /**
   * Persist one worker-reported `ServiceJobResult` to the dashboard storage:
   * the aggregate primary row + per-cell side rows through the status-writer,
   * and the rollup through run-history. When the result carries a
   * `PoolCommError`, the comm-error overlay is merged onto the primary row
   * signal (REQ-B). When the primary row takes the H1 overlay route, its
   * outcome is reported in `AggregateOutcome.overlayOutcomes` (NOT
   * `statusOutcomes`).
   *
   * ERROR CONTRACT: this REJECTS on the FIRST status write that throws —
   * remaining writes are not attempted and `runWriter.finish` is skipped (the
   * run row is left `running` until the boot-time stale-run sweep closes it).
   * Callers MUST guard: the consumer catches, leaves the job unlatched, and
   * retries next cycle (at-least-once; the per-jobId dedup makes the replay
   * safe — PROVIDED `runWriter.start` stamped a run row with this jobId.
   * start is BEST-EFFORT, so when it fails there is no row for the dedup
   * gate to find: a start-failure + latch-failure combination re-aggregates
   * the result in FULL — double fail_count bump, duplicate status_history
   * row, duplicate `status.changed` emit, duplicate probe_runs row).
   * Run-history start/finish failures, by contrast, are swallowed
   * internally (observability must not tank aggregation).
   */
  aggregate(result: ServiceJobResult): Promise<AggregateOutcome>;
  /**
   * [REQ-B] Surface a CONTROL-PLANE-DETECTED comm error (no worker result to
   * aggregate) onto the dashboard. The producer's `sweepExpired` and the
   * fleet-health monitor both reclaim a crashed/lease-expired worker's job and
   * synthesize a `worker-crashed-mid-job` `PoolCommError` — but that error only
   * reaches the dashboard once it is written onto the job's STATUS row under
   * `FLEET_COMM_ERROR_SIGNAL_KEY`. The worker-self-report leg does this inside
   * `aggregate` (via the result's `commError`); this is the equivalent sink for
   * the no-result crash/lease-expiry leg.
   *
   * It attaches the overlay onto the aggregate status row (`aggregateKey`, the
   * `d6:<slug>` key the dashboard reads) — and, when a `cellKey` is supplied,
   * also onto that per-cell row — via the status-writer's dedicated
   * `writeOverlay` path (H1), carrying the comm error in the row's `signal`
   * via `commErrorToStatusSignal`. The overlay PRESERVES the row's durable
   * state (so a comm error never masquerades as a fresh probe red AND never
   * STOMPS an observed colour to green), its `written_by` attribution and its
   * fail counters — the crash is NOT an observation of the carried colour, so
   * re-writing the prior state through the normal `write()` path (the pre-H1
   * behaviour) corrupted attribution and escalated `fail_count` via
   * sustained_red. The dashboard derives "unreachable" from the overlay, not
   * from the colour. Routing is PER KEY (F1d): `writeOverlay` is attempted
   * first for each key (it returns `applied: false` for a missing row); a key
   * with NO status row (never observed, or vanished) falls back per key to a
   * `"error"` write — the no-data representation, persisted to
   * `status_history` only — so no green status row is ever invented and an
   * observed cell row keeps its overlay even under a never-observed
   * aggregate.
   *
   * ERROR CONTRACT: this REJECTS on the FIRST write that throws — remaining
   * keys' writes are not attempted. Callers MUST guard (the sweep,
   * fleet-health and resultless-consumer legs each catch per error/overlay so
   * one failed surface never blocks the others, and the consumer leg leaves
   * the row unlatched so the surface is retried next cycle).
   */
  aggregateCommError(
    input: CommErrorAggregateInput,
  ): Promise<CommErrorAggregateOutcome>;
}

/** Input to {@link ResultAggregator.aggregateCommError}. */
export interface CommErrorAggregateInput {
  /** The control-plane-detected comm error to surface. */
  commError: PoolCommError;
  /**
   * The aggregate (primary) status-row key the overlay is written onto — the
   * `d6:<slug>` key the dashboard reads back. For the sweep leg the
   * control-plane resolves it from the swept error's `jobId` via
   * `resolveSweepAggregateKey` (a `probe_jobs` row lookup returning the row's
   * `probe_key`); for fleet-health it is the `aggregateKey` already carried
   * on each `ReclaimedCommError` overlay entry (captured from the reclaimed
   * job row's `probe_key` at reclaim time, no second lookup). Required
   * because a bare `PoolCommError` does not carry it.
   */
  aggregateKey: string;
  /**
   * Optional per-cell status-row key (`d6:<slug>/<featureId>`) to ALSO overlay.
   * Omitted for the crash/lease-expiry legs (which reclaim a whole-service job,
   * not a single cell). An EMPTY string is treated as absent — `""` is never a
   * real status-row key.
   */
  cellKey?: string;
  /**
   * Last-known probe colour, resolved by the caller from the CURRENT status
   * row.
   *
   * @deprecated No longer consulted (F1d): the route is decided PER KEY by
   * attempting `writeOverlay` first — the writer's `applied` result is the
   * per-key source of truth, so a stale/absent/bogus caller-side hint can
   * neither fabricate a colour nor lose an observed cell row's overlay.
   * Accepted (and ignored) for caller compatibility.
   */
  lastKnownState?: State;
}

/** Outcome of {@link ResultAggregator.aggregateCommError}. */
export interface CommErrorAggregateOutcome {
  /**
   * The per-write outcomes the status-writer returned for the no-data
   * ("error") fallback writes, in write order. Empty when every key took the
   * overlay path (H1).
   */
  statusOutcomes: WriteOutcome[];
  /**
   * The overlay outcomes returned by `writeOverlay`, in write order (H1).
   * One entry per key (F1d: the overlay is attempted first for every key);
   * an entry with `applied: false` means that key fell back to the no-data
   * write reported in `statusOutcomes`.
   */
  overlayOutcomes: OverlayWriteOutcome[];
  /**
   * [B3 round 7] Keys whose comm-error fallback was SKIPPED because the
   * overlay write was swallowed by a best-effort-wrapped writer (PB outage:
   * `applied: false` + `persisted: false`) — the comm error was NOT
   * persisted for those keys, and since this call resolves successfully the
   * drop is PERMANENT under a best-effort wrapper (the fleet wiring injects
   * the real throwing writer, where an outage rejects and the caller's
   * retry contract applies instead). Always present on outcomes produced by
   * `createResultAggregator` (empty when no key was skipped); typed
   * optional only so existing fakes/wrappers stay shape-compatible.
   */
  outageSkippedKeys?: string[];
}

/**
 * Read the CURRENT dashboard status-row colour for an aggregate key. Returns
 * the last observed `State` (green/red/degraded), or `null`/`undefined` for a
 * never-observed key (no row). Mirrors the control-plane's
 * `PriorStateResolver` (kept as a local type to avoid a control-plane ↔
 * aggregator import cycle).
 *
 * @deprecated — accepted and ignored since F1d (see
 * {@link ResultAggregatorDeps.resolvePriorState}); routing is per-key via
 * `writeOverlay.applied`.
 */
export type AggregatorPriorStateResolver = (
  aggregateKey: string,
) => Promise<State | null | undefined> | State | null | undefined;

export interface ResultAggregatorDeps {
  statusWriter: StatusWriter;
  runWriter: ProbeRunWriter;
  logger: Logger;
  /** Monotonic-ish clock (epoch ms) for run-history timing. */
  now: () => number;
  /**
   * @deprecated — accepted and ignored since F1d; routing is per-key via
   * `writeOverlay.applied`. EVERY comm-error leg (the worker-self-report leg
   * in `aggregate` and both `aggregateCommError` legs) attempts `writeOverlay`
   * FIRST and treats its per-key `applied` result as the source of truth, so
   * a caller-side prior-state read can neither change the route nor fabricate
   * a colour. Kept on the deps shape so existing wiring keeps compiling; do
   * not wire it in new call sites.
   */
  resolvePriorState?: AggregatorPriorStateResolver;
}

/**
 * Merge the REQ-B comm-error overlay into a primary-row signal. The original
 * aggregate signal is preserved (spread first) and the comm error is layered
 * under `FLEET_COMM_ERROR_SIGNAL_KEY` so the dashboard can re-surface it.
 * Only PLAIN-OBJECT signals are merged into: anything else — including
 * arrays, which are object-typed (`typeof === "object"`) but not merge
 * targets — is REPLACED by the overlay object outright (the comm error is
 * the operative payload). (B5: "object-shaped" undersold the array case.)
 */
function withCommErrorOverlay(
  aggregateSignal: unknown,
  result: ServiceJobResult,
): unknown {
  if (!result.commError) return aggregateSignal;
  const overlay = commErrorToStatusSignal(result.commError);
  if (
    aggregateSignal !== null &&
    typeof aggregateSignal === "object" &&
    !Array.isArray(aggregateSignal)
  ) {
    return { ...(aggregateSignal as Record<string, unknown>), ...overlay };
  }
  return overlay;
}

export function createResultAggregator(
  deps: ResultAggregatorDeps,
): ResultAggregator {
  const { statusWriter, runWriter, logger, now } = deps;

  /**
   * Route the worker-self-report comm-error PRIMARY row (REQ-B + H1).
   *
   * The distrust rule here is NOT primary-specific: a `commError` means the
   * WHOLE result is untrusted, so the write loop applies the SAME rule to
   * every per-cell row carried on the result (B2) — a known NEGATIVE cell
   * colour (red/degraded) is a legitimate negative observation and writes
   * durably; everything else (green, but also "error" and unknown colours —
   * the predicate is !trustedNegative) routes overlay-first exactly like a
   * green primary. This function only
   * decides the primary because the primary's colour lives on
   * `result.aggregateState`; the loop re-applies the identical predicate per
   * cell.
   *
   * Precedence:
   *   1. The worker's own `aggregateState` when it is a real NON-GREEN colour
   *      (red/degraded) — the worker DID reach us, so a NEGATIVE rollup colour
   *      stands and is written as a fresh observation (normal `write()` path).
   *      A worker-reported `"green"` is DELIBERATELY NOT carried here: this
   *      only runs when a `commError` is present, which means we did NOT get a
   *      trustworthy result (a corrupt/decoded row can carry
   *      `aggregateState:"green"` alongside a `commError`). Carrying that green
   *      would write a GREEN status row for a service we could not reach,
   *      violating REQ-B's "never fabricate green for a service we couldn't
   *      reach" invariant. So an (untrusted) green falls through, exactly like
   *      `"error"`.
   *   2. Otherwise the OVERLAY-FIRST route (H1 + F1d): the write loop attempts
   *      the status-writer's dedicated `writeOverlay` path FIRST — the per-key
   *      `applied` result is the source of truth, no prior-state read is
   *      consulted (the pre-B1 route awaited `resolvePriorState` solely to
   *      pick a label the caller then treated identically — a dead PB
   *      roundtrip). An applied overlay PRESERVES the row's durable state (a
   *      red service whose worker then reports a comm error stays red),
   *      `written_by` attribution and fail counters — we did NOT observe the
   *      carried colour this cycle, so re-writing it through `write()` (the
   *      pre-H1 behaviour) corrupted attribution and escalated `fail_count`.
   *      Only a real miss (`applied: false` — never observed, or vanished)
   *      falls back to the history-only "error" write (F2.1
   *      no-false-baseline, unified with `aggregateCommError`'s
   *      never-observed leg): the status-writer records it in
   *      `status_history` ONLY — no status row of ANY colour is fabricated
   *      for a key that has never been observed. The overlay rides in the
   *      history write's signal; the no-drop guarantee is HISTORY
   *      persistence, not a status-row landing.
   */
  function commErrorPrimaryRoute(
    aggregateState: ProbeState,
  ): { route: "write"; state: State } | { route: "overlay-first" } {
    // A comm error means the result is untrusted, so a worker-reported "green"
    // is NOT carried — only a negative (red/degraded) colour is trusted enough
    // to stand. An untrusted green falls through to the overlay-first route.
    const workerColour = asKnownState(aggregateState);
    if (workerColour && workerColour !== "green") {
      return { route: "write", state: workerColour };
    }
    return { route: "overlay-first" };
  }

  return {
    async aggregate(result) {
      // ── IDEMPOTENCY GATE ────────────────────────────────────────────────
      // The consumer aggregates-then-latches `result_processed`. If that latch
      // write fails (or the process crashes before it), the SAME job's result
      // is re-handed to us next tick. Re-applying it is NOT free: status-writer
      // would bump fail_count again (inflating "red for N"), append a spurious
      // status_history row, and re-emit `status.changed`; run-history would
      // mint a DUPLICATE probe_runs row. So before doing anything, check for an
      // existing run row stamped with this jobId:
      //   - TERMINAL row  → this result was already fully aggregated on a prior
      //     tick (only the latch failed). SKIP entirely — a true no-op.
      //   - RUNNING row   → a prior attempt crashed mid-aggregate. RESUME on the
      //     SAME row (reuse its id) so we don't mint a duplicate. The status
      //     writes on this resume are AT-LEAST-ONCE, not exactly-once: a
      //     prior attempt that completed SOME of its status writes before
      //     crashing has those rows RE-written here (re-bumping fail_count,
      //     re-appending status_history, re-emitting status.changed for
      //     them) — accepted as the cost of not minting a duplicate run row.
      // findByJobId failing must not wedge aggregation, but it MUST NOT be
      // treated as "no prior row" either: under a transient PB read error we
      // genuinely don't know whether a prior run row already exists, and
      // optimistically minting a new one would duplicate the probe_runs row on
      // a retry tick. So we distinguish:
      //   - throw          → UNCERTAIN. Skip the `runWriter.start` mint
      //                      altogether (resumeRunRowId stays null, dedupLookupFailed
      //                      latches true) so we don't fabricate a duplicate row.
      //                      Status writes still happen — they're idempotent via
      //                      the status-writer state machine. The run-history
      //                      row will be reconciled on a subsequent successful
      //                      tick once PB recovers.
      //   - returned null  → genuinely no prior row → mint normally.
      //   - returned row   → dedup-skip (terminal) / resume (non-terminal).
      //
      // HONESTY: this gate only reaches as far as runWriter.start (below,
      // BEST-EFFORT) managed to stamp this jobId on a run row. When start
      // FAILED there is no row to find, so a start-failure + latch-failure
      // combination replays the result through the FULL write path: double
      // fail_count bump, duplicate status_history row, duplicate
      // status.changed emit, and a duplicate probe_runs row (the retried
      // start). The start-failure log below flags the disarmed gate.
      //
      // CONCURRENCY (G2r9): the gate also assumes a SINGLE-FLIGHT consumer —
      // two CONCURRENT aggregate() calls for the same jobId can both pass
      // this lookup before either stamps a run row, and both replay the full
      // write path (the same duplication the gate exists to prevent).
      let resumeRunRowId: string | null = null;
      let dedupLookupFailed = false;
      try {
        const prior = await runWriter.findByJobId(result.jobId);
        if (prior && prior.terminal) {
          logger.debug("fleet.aggregator.dedup-skip", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            runRowId: prior.id,
          });
          return {
            runRowId: prior.id,
            statusOutcomes: [],
            overlayOutcomes: [],
            skipped: true,
            outageSkippedKeys: [],
            droppedCommError: false,
            corruptStateSkippedKeys: [],
          };
        }
        if (prior) resumeRunRowId = prior.id;
      } catch (err) {
        const info = errorInfo(err);
        dedupLookupFailed = true;
        logger.warn("fleet.aggregator.dedup-lookup-failed", {
          probeKey: result.aggregateKey,
          jobId: result.jobId,
          err: serializeErr(info),
          ...(info.status !== undefined && { status: info.status }),
          consequence:
            "proceeding without dedup — possible duplicate aggregation for this jobId",
        });
      }

      // Project the worker result onto the EXISTING status-row shapes: the
      // primary aggregate row first, then one side row per cell. Under a
      // commError the SAME distrust rule applies to every row (B2): a known
      // NEGATIVE colour (red/degraded) is a legitimate negative observation
      // and writes durably; every OTHER row — primary or cell, whether
      // green, "error" or an unknown colour (the predicate is
      // !trustedNegative) — comes from a result we could not trust and
      // routes overlay-first instead, so no green status row is ever
      // persisted off an unreachable pool's result.
      // G2r9: a LOCAL copy of the projection's returned array — the
      // trusted-negative primary route below replaces element 0 in place,
      // and mutating the caller-visible array would silently rewrite a
      // memoizing/caching projection's cached primary.
      const probeResults: ProbeResult[] = [
        ...probeResultsForServiceJobResult(result),
      ];
      // CRITICAL (REQ-B): the worker-self-report comm-error leg sets
      // aggregateState:"error" (buildCommErrorResult/buildDriverErrorResult).
      // The primary row is routed per commErrorPrimaryRoute: a trusted
      // negative worker colour goes through the normal write() path (the
      // overlay lands on the status row alongside the fresh observation);
      // otherwise the H1 overlay path is ATTEMPTED FIRST (per-key `applied`
      // is the source of truth — F1d), which lands the overlay on the status
      // row while preserving the row's durable state/attribution/counters; a
      // key with NO live row (`applied: false` — never observed, or
      // vanished) falls back to the history-only no-data ("error") route —
      // F2.1 no-false-baseline: no status row of any colour is fabricated
      // for a key we have never actually observed (unified with
      // aggregateCommError's never-observed leg). On that route the overlay
      // is persisted in status_history only — the no-drop guarantee is
      // HISTORY persistence. The dashboard derives "unreachable" from the
      // overlay, not the colour.
      let overlayPrimary = false;
      let droppedCommError = false;
      let skipDriftedPrimary = false;
      if (result.commError && probeResults.length > 0) {
        // Primary-identity check (F1d): the comm-error primary route is
        // computed for `result.aggregateKey` but APPLIED to probeResults[0] —
        // those are the same row by construction
        // (probeResultsForServiceJobResult puts the aggregate first). If the
        // projection ever drifts, refuse to overlay/rewrite the wrong row.
        // Compared on the TRIMMED forms (G2r8): the write loop below
        // normalizes every projected key to its trimmed canonical form, so
        // padding differences are not identity drift.
        //
        // G2r8: a DISCRIMINATOR, not a throw — the file's own
        // empty-projection rationale applies identically here: a
        // deterministic projection defect would infinite-retry through the
        // consumer's unlatch-on-reject path, and the old throw landed BEFORE
        // runWriter.start, so each retry restarted from scratch (a permanent
        // hot-loop with full status re-writes). Instead: log loud, SKIP the
        // drifted primary row (we cannot know whether the projected key or
        // result.aggregateKey identifies the real row), and surface the
        // dropped primary surface via droppedCommError. Cells are
        // independent rows and still process normally.
        if (probeResults[0].key.trim() !== result.aggregateKey.trim()) {
          skipDriftedPrimary = true;
          droppedCommError = true;
          logger.error("fleet.aggregator.commerror-primary-identity-drift", {
            jobId: result.jobId,
            aggregateKey: result.aggregateKey,
            projectedPrimaryKey: probeResults[0].key,
            consequence:
              "projected primary key does not match result.aggregateKey — skipping the primary row entirely (refusing to overlay/rewrite a row whose identity is unknown); the comm error does not reach the aggregate row the dashboard reads, surfaced via droppedCommError on the outcome",
          });
        } else {
          const route = commErrorPrimaryRoute(result.aggregateState);
          if (route.route === "write") {
            // Only the trusted negative COLOUR is stamped here; the comm-error
            // overlay is merged into the signal by the write loop below — the
            // SAME merge every trusted-negative row (primary or cell — B2)
            // gets, so the dashboard can re-surface "unreachable" off any
            // durable row written from this untrusted result.
            probeResults[0] = {
              ...probeResults[0],
              state: route.state,
            };
          } else {
            // The overlay-first route: writeOverlay is attempted FIRST in the
            // write loop below — the per-key `applied` result is the source of
            // truth (F1d), no caller-side prior-state hint is consulted. An
            // OBSERVED key must land its overlay on the live row: the
            // history-only "error" write only refreshes the row's observed_at,
            // it never merges the overlay into the live row's signal, so
            // routing an observed key history-only showed nothing on the
            // dashboard despite the row existing. Only a real miss
            // (applied: false — never observed, or vanished) falls back to the
            // history-only no-data write.
            overlayPrimary = true;
          }
        }
      } else if (result.commError) {
        // The projection produced NO rows: the write loop below writes
        // nothing, so the comm error reaches neither a status row nor
        // status_history through this path — there is no history-persistence
        // no-drop guarantee here, the error is simply dropped. Unreachable by
        // construction today (probeResultsForServiceJobResult always returns
        // [primary, ...cells]), and the F1d identity assert above only
        // protects key drift — so if the projection ever changes, make the
        // drop LOUD instead of silent. B3 (round 7): the log alone left the
        // returned outcome HEALTHY-SHAPED — callers could not observe the
        // drop — so it is also surfaced via `droppedCommError: true` on the
        // outcome. Deliberately a discriminator, NOT a throw: a
        // DETERMINISTIC empty projection would infinite-retry through the
        // consumer's unlatch-on-reject path.
        droppedCommError = true;
        logger.error("fleet.aggregator.commerror-dropped-empty-projection", {
          jobId: result.jobId,
          aggregateKey: result.aggregateKey,
          consequence:
            "the comm error reaches neither a status row nor status_history — a permanent drop, surfaced to callers via droppedCommError on the outcome",
        });
      }

      // Open a run-history row up-front so its started_at brackets the writes
      // (mirrors probe-invoker), stamping the jobId so a re-process dedupes via
      // findByJobId above. When RESUMING a crashed-mid-aggregate run we reuse
      // the existing row id instead of minting a second. Best-effort —
      // observability must never tank the aggregation; a failed start just
      // means no run-history row.
      const startedAt = now();
      let runRowId: string | null = resumeRunRowId;
      // G2r8: a BLANK/WHITESPACE aggregateKey must not mint a probe_runs row
      // keyed probeId "" — a phantom run-history row no dashboard widget ever
      // reads. Mirrors aggregateCommError's blank-aggregateKey guard, but as
      // a loud SKIP rather than a throw: a deterministic throw here would
      // infinite-retry through the consumer's unlatch-on-reject path (the
      // same rationale the empty-projection discriminator documents).
      const runProbeId = result.aggregateKey.trim();
      if (!runRowId && !runProbeId) {
        logger.error("fleet.aggregator.blank-aggregate-key-run-skipped", {
          jobId: result.jobId,
          consequence:
            "skipping run-history start — a blank/whitespace aggregateKey would mint a phantom probe_runs row keyed probeId ''; with no jobId-stamped run row the per-jobId dedup gate is DISARMED for this job (same exposure as a failed start)",
        });
      } else if (!runRowId && !dedupLookupFailed) {
        // Only mint a fresh run-history row when the dedup lookup CONFIRMED no
        // prior row. Under `dedupLookupFailed` we don't know, and minting would
        // risk duplicating a row that already exists; status writes still
        // happen below and a subsequent successful tick will reconcile.
        try {
          const created = await runWriter.start({
            // G2r8: trimmed — run-history is keyed by the canonical probeId
            // the dashboard reads back; a padded aggregateKey must not mint
            // a padded-probeId probe_runs row.
            probeId: runProbeId,
            startedAt,
            triggered: false,
            jobId: result.jobId,
          });
          runRowId = created.id;
        } catch (err) {
          const info = errorInfo(err);
          logger.error("fleet.aggregator.run-start-failed", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            err: serializeErr(info),
            ...(info.status !== undefined && { status: info.status }),
            consequence:
              "no jobId-stamped run row — the per-jobId dedup gate is DISARMED for this job; a latch-fail replay will re-aggregate it in full",
          });
        }
      }

      // Write every projected row through the unchanged status pipeline —
      // except an overlay-first-routed row under a commError (H1 + B2): the
      // overlay-routed primary AND every non-trusted-negative cell (green,
      // "error" or unknown colours alike — the predicate is
      // !trustedNegative) go through
      // writeOverlay so the comm error lands WITHOUT a durable write of a
      // colour we could not trust. Should the key have no live row
      // (`applied: false` — never observed, or vanished), fall back to the
      // history-only no-data ("error") write — F2.1: a missing key gets NO
      // fabricated status row; the no-drop guarantee is HISTORY persistence
      // (same fallback as aggregateCommError).
      //
      // Per-row try/catch on the durable write paths: a single bad row (e.g.
      // transient PB error on one side row) must NOT abort the whole batch
      // before `runWriter.finish` below, which would leave a `running`
      // probe_runs row that only `sweepStaleRuns` could clean up. Log the
      // failure on the established error path and keep iterating so the
      // remaining rows + the run-history finish still land.
      const statusOutcomes: WriteOutcome[] = [];
      const overlayOutcomes: OverlayWriteOutcome[] = [];
      const outageSkippedKeys: string[] = [];
      const corruptStateSkippedKeys: string[] = [];
      // B2 (round 6): a malformed worker result can carry DUPLICATE cell keys
      // — or a cell colliding with the aggregateKey — and the projection
      // passes them through verbatim, so the same status row was written
      // twice in one aggregation (double fail_count bump, duplicate
      // status_history row, duplicate status.changed emit). Dedupe before
      // writing, mirroring aggregateCommError's cellKey !== aggregateKey
      // collapse posture. The dedupe runs as a PLANNING pass (B4 round 7) so
      // the duplicate-key decision can consider each occurrence's ROUTE:
      //   - the first occurrence wins by default (the primary projects
      //     first, so a colliding cell never beats a durable aggregate row);
      //   - EXCEPT under a commError when the kept occurrence routed
      //     overlay-first and the duplicate is TRUSTED-NEGATIVE — a
      //     legitimate negative observation outranks positional order, so it
      //     REPLACES the untrusted occurrence (first-occurrence-wins
      //     silently dropped a trusted red behind an untrusted green).
      //     G2r8: that replacement is CELL-vs-CELL ONLY — when the kept
      //     occurrence is the PRIMARY, a colliding trusted-negative cell
      //     would durably impersonate the AGGREGATE row (its cell payload
      //     written under the aggregate key as if it were the service
      //     rollup), so the primary keeps positional precedence across the
      //     primary/cell boundary.
      const planned: {
        pr: ProbeResult;
        overlayFirst: boolean;
        isPrimary: boolean;
      }[] = [];
      const plannedIndex = new Map<string, number>();
      // G2r9: a drift-skipped PRIMARY never enters plannedIndex, so a
      // malformed cell whose canonical key equals result.aggregateKey (or
      // the projected-primary key) would become the FIRST occurrence and —
      // if trusted-negative — write its CELL payload durably UNDER THE
      // AGGREGATE KEY as if it were the service rollup (the exact
      // impersonation the cell-vs-cell dedupe restriction above forbids).
      // Both identities are refused while the primary's identity is in
      // doubt: the trimmed aggregateKey AND the trimmed projected-primary
      // key (we cannot know which one names the real aggregate row).
      const driftRefusedKeys = skipDriftedPrimary
        ? new Set(
            [result.aggregateKey.trim(), probeResults[0].key.trim()].filter(
              Boolean,
            ),
          )
        : undefined;
      for (const [i, rawPr] of probeResults.entries()) {
        // G2r8: a drifted primary (identity check above) is refused outright
        // — its identity is unknown, so neither a durable write nor an
        // overlay may touch it (already error-logged + surfaced via
        // droppedCommError).
        if (i === 0 && skipDriftedPrimary) continue;
        // TRIM-once NORMALIZATION (G2r8, mirroring aggregateCommError's B1r7
        // posture): a PADDED projected key (" d6:x ") is the same row as its
        // trimmed form — routing the untrimmed value persisted durable rows
        // under a malformed dimension the dashboard never reads, and the
        // dedupe map keyed on the untrimmed string let "d6:x" and " d6:x "
        // escape both the duplicate collapse and the trusted-negative
        // replacement. The trimmed canonical key feeds the blank-skip below,
        // the dedupe map, the writes and the logs.
        const canonicalKey = rawPr.key.trim();
        // B2 (round 7): a BLANK/WHITESPACE projected key is never a real
        // status-row key — aggregateCommError fails loud on one, but here a
        // malformed worker cell with key "" flowed straight into
        // statusWriter.write, persisting a DURABLE status row + history
        // under a phantom dimension ("unknown"). Skip it loudly (per-row
        // skip, same posture as the duplicate-key guard below — one
        // malformed cell must not reject the whole result, which the
        // documented rejects-on-first-throw error contract would do).
        if (!canonicalKey) {
          // G2r9: a blank-skipped PRIMARY drops the comm error even when
          // cells SURVIVE — the empty-plan guard below only fires on a fully
          // emptied plan, so a surviving cell left the outcome
          // healthy-shaped while the aggregate row the dashboard reads never
          // received the comm error (a surviving cell carries it only on its
          // OWN row). Same discriminator posture as the drift leg: log loud
          // at ERROR level, surface via droppedCommError, never throw.
          if (i === 0 && result.commError) {
            droppedCommError = true;
            logger.error("fleet.aggregator.commerror-dropped-blank-primary", {
              jobId: result.jobId,
              consequence:
                "the result carried a blank/whitespace aggregateKey, so the comm error does not reach the aggregate row the dashboard reads (surviving cells carry it only on their own rows) — surfaced via droppedCommError on the outcome",
            });
          }
          // G2r8: attribute the blank row honestly — the PRIMARY (i === 0)
          // projects from result.aggregateKey, not from a worker cell; the
          // old single-message warn blamed "a malformed worker cell" even
          // when the blank row was the primary.
          logger.warn("fleet.aggregator.blank-projected-key", {
            jobId: result.jobId,
            aggregateKey: result.aggregateKey,
            row: i === 0 ? "primary" : "cell",
            consequence:
              i === 0
                ? "skipping write for a blank/whitespace projected PRIMARY key — the result carried a blank aggregateKey; writing it would persist a durable status row under a phantom dimension"
                : "skipping write for a blank/whitespace projected key — a malformed worker cell carried an empty cellKey; writing it would persist a durable status row under a phantom dimension",
          });
          continue;
        }
        // G2r9: while the primary is drift-skipped, no CELL may claim either
        // refused identity — warn-skip it (per-row skip, same posture as the
        // blank/duplicate guards: one malformed cell must not reject the
        // whole result).
        if (driftRefusedKeys?.has(canonicalKey)) {
          logger.warn("fleet.aggregator.drifted-primary-collision-skipped", {
            key: canonicalKey,
            jobId: result.jobId,
            aggregateKey: result.aggregateKey,
            consequence:
              "skipping a cell whose canonical key collides with the drift-refused primary identity (aggregateKey or projected-primary key) — writing it would durably impersonate the aggregate row the dashboard reads",
          });
          continue;
        }
        // The row planned/written below carries the CANONICAL key (G2r8).
        const pr: ProbeResult =
          canonicalKey === rawPr.key ? rawPr : { ...rawPr, key: canonicalKey };
        // The identical per-row distrust predicate the primary route uses:
        // only a known NEGATIVE colour (red/degraded) writes durably under a
        // commError. (Without a commError every row writes durably and the
        // route flags below are inert.)
        const colour = asKnownState(pr.state);
        // G2r9: per-row colour gate on the NO-commError path. Under a
        // commError an unknown colour already routes overlay-first
        // (!trustedNegative below) and never writes durably — but WITHOUT
        // one, a corrupt non-State, non-"error" colour flowed straight into
        // statusWriter.write and 400'd on PB's required `state` select;
        // aggregate() then REJECTED and the consumer unlatch-retried the
        // same deterministic fault forever. Loud skip instead of a throw
        // (the hot-loop rationale every other guard here documents), counted
        // observably on corruptStateSkippedKeys.
        if (!result.commError && colour === undefined && pr.state !== "error") {
          corruptStateSkippedKeys.push(pr.key);
          logger.error("fleet.aggregator.corrupt-state-skipped", {
            key: pr.key,
            jobId: result.jobId,
            aggregateKey: result.aggregateKey,
            state: String(pr.state),
            consequence:
              "skipping write for a corrupt non-State colour — writing it would 400 on PB's required state select and reject the whole aggregation into a consumer unlatch-retry hot-loop; surfaced via corruptStateSkippedKeys on the outcome",
          });
          continue;
        }
        const trustedNegative = colour !== undefined && colour !== "green";
        const overlayFirst = result.commError
          ? i === 0
            ? overlayPrimary
            : !trustedNegative
          : false;
        const existing = plannedIndex.get(pr.key);
        if (existing !== undefined) {
          if (
            result.commError &&
            trustedNegative &&
            planned[existing].overlayFirst &&
            !planned[existing].isPrimary
          ) {
            // B4 (round 7): the kept occurrence is UNTRUSTED (overlay-first)
            // and this duplicate is a trusted-negative observation — replace
            // (keeping the first occurrence's write position) so the
            // legitimate negative is not silently dropped. G2r8: cell-vs-cell
            // ONLY — a colliding cell never replaces the PRIMARY (it would
            // durably impersonate the aggregate row; see the planning-pass
            // comment above).
            logger.warn("fleet.aggregator.duplicate-projected-key", {
              key: pr.key,
              jobId: result.jobId,
              aggregateKey: result.aggregateKey,
              consequence:
                "replacing the overlay-first first occurrence with the trusted-negative duplicate — under a commError a legitimate negative observation outranks positional order",
            });
            planned[existing] = { pr, overlayFirst: false, isPrimary: false };
            continue;
          }
          logger.warn("fleet.aggregator.duplicate-projected-key", {
            key: pr.key,
            jobId: result.jobId,
            aggregateKey: result.aggregateKey,
            consequence:
              "skipping duplicate write — first occurrence wins (malformed worker result carried duplicate cell keys or a cell colliding with the aggregate key)",
          });
          continue;
        }
        plannedIndex.set(pr.key, planned.length);
        planned.push({ pr, overlayFirst, isPrimary: i === 0 });
      }
      // G2r8: the B3r7 empty-PROJECTION guard above cannot see a plan that
      // empties HERE — a non-empty projection whose rows are all
      // blank-skipped leaves `planned` empty, so the write loop below runs
      // over nothing and the comm error reaches neither a status row nor
      // status_history: the same permanent drop, but the outcome would have
      // returned healthy-shaped (droppedCommError:false, outageSkippedKeys
      // []). Surface it with the identical discriminator posture (log loud,
      // never throw — a deterministic empty plan would infinite-retry
      // through the consumer's unlatch-on-reject path).
      if (result.commError && planned.length === 0 && !droppedCommError) {
        droppedCommError = true;
        logger.error("fleet.aggregator.commerror-dropped-empty-plan", {
          jobId: result.jobId,
          aggregateKey: result.aggregateKey,
          consequence:
            "every projected row was skipped (blank/whitespace keys), so the comm error reaches neither a status row nor status_history — a permanent drop, surfaced to callers via droppedCommError on the outcome",
        });
      }
      for (const { pr, overlayFirst } of planned) {
        if (result.commError) {
          if (overlayFirst) {
            const overlayOutcome = await statusWriter.writeOverlay({
              key: pr.key,
              signal: commErrorToStatusSignal(result.commError),
              observedAt: pr.observedAt,
            });
            overlayOutcomes.push(overlayOutcome);
            // G2r9: `applied: true, historyPersisted: false` is a real-writer
            // outcome — the overlay landed on the live row but its
            // status_history audit-row create failed. The live row is
            // correct, so no fallback runs; without a signal the audit-trail
            // loss was silent.
            if (
              overlayOutcome.applied &&
              overlayOutcome.historyPersisted === false
            ) {
              logger.warn("fleet.aggregator.overlay-history-not-persisted", {
                key: pr.key,
                jobId: result.jobId,
                consequence:
                  "the comm-error overlay landed on the live status row but its status_history audit row did not persist — the dashboard row is correct, the audit trail is missing this overlay",
              });
            }
            if (!overlayOutcome.applied) {
              if (overlayOutcome.historyPersisted) {
                // B1, now defensive — since the update-first overlay
                // reordering, the current writer never returns
                // `applied: false` with `historyPersisted: true` (the
                // vanished-404 leg returns before any history write). Kept
                // as cheap, honest writer-unreachable protection: if a
                // future writer DID persist history before failing the
                // apply, that history row IS the no-drop guarantee and a
                // fallback error-write would append a SECOND
                // status_history row for the same comm error.
                logger.debug("fleet.aggregator.overlay-history-persisted", {
                  key: pr.key,
                  jobId: result.jobId,
                });
              } else if (overlayOutcome.persisted === false) {
                // B4 (round 6): the A2 discriminator — `applied: false` WITH
                // `persisted: false` is a best-effort wrapper's synthesized
                // outcome: the overlay never REACHED PB (swallowed outage),
                // so row existence is UNKNOWN. A PB outage is not "never
                // observed": the no-data fallback would record a bogus
                // never-observed history row (and ride the same outage).
                // Skip it loudly instead. B3 (round 7) — HONEST semantics:
                // this skip RESOLVES successfully (the run row below still
                // finishes terminal and the consumer latches), so nothing
                // retries it — under a best-effort-wrapped writer the drop
                // is PERMANENT. The key is recorded on
                // `outageSkippedKeys` so callers CAN observe it; the fleet
                // wiring injects the real throwing writer, where an outage
                // rejects per the error contract and retries instead.
                outageSkippedKeys.push(pr.key);
                logger.warn(
                  "fleet.aggregator.overlay-outage-fallback-skipped",
                  {
                    key: pr.key,
                    jobId: result.jobId,
                    consequence:
                      "overlay write swallowed by a best-effort writer (PB outage) — skipping the no-data fallback; the comm error is NOT persisted and, since this call resolves successfully (run row finishes terminal, consumer latches), the drop is PERMANENT under a best-effort-wrapped writer (observable via outageSkippedKeys on the outcome)",
                  },
                );
              } else {
                // TOCTOU NOTE (B5 round 7): the overlay miss and this
                // fallback are TWO separate writer acquisitions — the
                // writer's keyed mutex does not span them. A row created by
                // a FOREIGN writer in that gap receives this comm error
                // HISTORY-ONLY (the error-path write never merges the
                // overlay into the new live row's signal). Known, accepted
                // race: the next observation of the key re-converges it.
                statusOutcomes.push(
                  await statusWriter.write({
                    ...pr,
                    state: "error",
                    signal: withCommErrorOverlay(pr.signal, result),
                  }),
                );
              }
            }
            continue;
          }
          // B2: a trusted-negative row (primary or cell) writes durably WITH
          // the comm-error overlay merged into its signal — the identical
          // treatment the primary's "write" route gets — so the dashboard can
          // re-surface "unreachable" off every durable row written from this
          // untrusted result, not just the primary.
          statusOutcomes.push(
            await statusWriter.write({
              ...pr,
              signal: withCommErrorOverlay(pr.signal, result),
            }),
          );
          continue;
        }
        try {
          const outcome = await statusWriter.write(pr);
          statusOutcomes.push(outcome);
        } catch (err) {
          logger.error("fleet.aggregator.status-write-failed", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            rowKey: pr.key,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // §4.2 reds counters: durable State transitions only, across the
      // aggregate + cell outcomes collected above. An error tick
      // (`newState === "error"`) is a measurement failure — the prior
      // durable colour rides on `errorStatePrev` — so it neither introduced
      // nor cleared a red and is excluded from both counters. A missing
      // outcome (a writer that resolved without one — seen from doMock'd
      // writers in tests) likewise contributes nothing.
      let redsIntroduced = 0;
      let redsCleared = 0;
      for (const o of statusOutcomes) {
        if (!o || o.newState === "error") continue;
        if (o.previousState === "green" && o.newState === "red") {
          redsIntroduced += 1;
        }
        if (o.previousState === "red" && o.newState === "green") {
          redsCleared += 1;
        }
      }

      // Persist the rollup. `terminalJobStatus` maps green→done / anything
      // else (incl. comm error) →failed; run-history's narrower enum is
      // completed/failed, so a "done" job is a "completed" run.
      if (runRowId) {
        const status = terminalJobStatus(result);
        const runState = status === "done" ? "completed" : "failed";
        try {
          await runWriter.finish({
            id: runRowId,
            finishedAt: now(),
            state: runState,
            summary: {
              ...runSummaryForServiceJobResult(result),
              redsIntroduced,
              redsCleared,
            },
          });
        } catch (err) {
          const info = errorInfo(err);
          logger.error("fleet.aggregator.run-finish-failed", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            runRowId,
            err: serializeErr(info),
            ...(info.status !== undefined && { status: info.status }),
          });
        }
      }

      logger.debug("fleet.aggregator.aggregated", {
        probeKey: result.aggregateKey,
        serviceSlug: result.serviceSlug,
        jobId: result.jobId,
        cells: result.cells.length,
        commError: result.commError?.kind,
      });

      return {
        runRowId,
        statusOutcomes,
        overlayOutcomes,
        skipped: false,
        outageSkippedKeys,
        droppedCommError,
        corruptStateSkippedKeys,
      };
    },

    async aggregateCommError(input) {
      const { commError } = input;
      // TRIM-based NORMALIZATION (B1 round 7, tightening the B3 round-6
      // guard): "" AND whitespace-only are never real status-row keys, and a
      // PADDED key (" d6:x ") is the same row as its trimmed form — the
      // round-6 guard trimmed only INSIDE the blank check and then routed
      // the UNTRIMMED value, so a padded key overlaid/wrote a malformed row
      // (dimension " d6") and the surfaced log carried the padding. Assign
      // the trimmed keys ONCE here; routing, the cellKey !== aggregateKey
      // collapse, the keys array, the writes and the logs below all use the
      // canonical values. A blank aggregateKey still fails LOUD
      // (keyFor-style) so the caller's bad key resolution surfaces at the
      // call site — callers already guard per the documented error
      // contract.
      const aggregateKey = input.aggregateKey?.trim();
      if (!aggregateKey) {
        throw new Error(
          "result-aggregator: aggregateCommError requires a non-blank aggregateKey — refusing to write a malformed-key status/history row",
        );
      }
      const overlay = commErrorToStatusSignal(commError);

      // Surface onto the aggregate row first, then the optional cell row.
      // ROUTING IS PER KEY (F1d): `writeOverlay` is attempted FIRST for each
      // key — it is the per-key source of truth (it returns `applied: false`
      // for a missing row), so an OBSERVED cell row keeps its overlay even
      // when the aggregate row was never observed (the pre-F1d single
      // aggregate-level `observed` boolean lost it). An applied overlay (H1)
      // lands the signal on the `status` row the dashboard reads while the
      // row's durable state (a crashed `red` service stays `red` +
      // unreachable overlay), `written_by` attribution and fail counters are
      // all preserved — a crash overlay is not an observation, so the pre-H1
      // same-state `write()` corrupted attribution and escalated fail_count.
      // A key with NO row (never observed, or vanished since the caller's
      // prior-state read) falls back per key to a state:"error" result
      // through `write()` — the no-data path, which writes to
      // `status_history` only and never fabricates a `status` row for a
      // service that has never been probed (F2.1 no-false-baseline). The
      // no-drop guarantee is HISTORY persistence (status_history).
      const keys: string[] = [aggregateKey];
      // An EMPTY or WHITESPACE-ONLY cellKey is treated as absent (same as
      // undefined, matching asKnownState's degrade-don't-trust posture and
      // the trim-based aggregateKey normalization above — B3/B1): neither is
      // ever a real status-row key, and admitting one attempted an overlay
      // on a blank key (a guaranteed miss) and then recorded an "error"
      // history row under it via the fallback. A non-blank cellKey is
      // NORMALIZED to its trimmed form (B1) so the collapse check, routing
      // and logs below all see the canonical key.
      const cellKey = input.cellKey?.trim() || undefined;
      if (cellKey && cellKey !== aggregateKey) {
        keys.push(cellKey);
      }

      const statusOutcomes: WriteOutcome[] = [];
      const overlayOutcomes: OverlayWriteOutcome[] = [];
      const outageSkippedKeys: string[] = [];
      // Object.create(null) (B5): route keys are status-row keys read off
      // wire data — a key like "__proto__" on a plain literal would land on
      // the prototype instead of the map.
      const routes: Record<
        string,
        "overlay" | "no-data" | "overlay-history" | "outage-skipped"
      > = Object.create(null);
      for (const key of keys) {
        const overlayOutcome = await statusWriter.writeOverlay({
          key,
          signal: overlay,
          observedAt: commError.observedAt,
        });
        overlayOutcomes.push(overlayOutcome);
        // G2r9: an APPLIED overlay whose audit row failed
        // (`historyPersisted: false`) leaves the live row correct but the
        // status_history audit trail missing this overlay — warn, matching
        // the aggregate() leg (silent acceptance hid the loss).
        if (
          overlayOutcome.applied &&
          overlayOutcome.historyPersisted === false
        ) {
          logger.warn("fleet.aggregator.overlay-history-not-persisted", {
            aggregateKey,
            key,
            jobId: commError.jobId,
            consequence:
              "the comm-error overlay landed on the live status row but its status_history audit row did not persist — the dashboard row is correct, the audit trail is missing this overlay",
          });
        }
        routes[key] = overlayOutcome.applied ? "overlay" : "no-data";
        if (!overlayOutcome.applied) {
          if (overlayOutcome.historyPersisted) {
            // B1, now defensive — since the update-first overlay reordering,
            // the current writer never returns `applied: false` with
            // `historyPersisted: true` (the vanished-404 leg returns before
            // any history write). Kept as cheap, honest writer-unreachable
            // protection: if a future writer DID persist history before
            // failing the apply, that history row IS the no-drop guarantee —
            // the fallback error-write would append a SECOND status_history
            // row for the same comm error.
            routes[key] = "overlay-history";
            logger.debug("fleet.aggregator.overlay-history-persisted", {
              aggregateKey,
              key,
              jobId: commError.jobId,
            });
            continue;
          }
          if (overlayOutcome.persisted === false) {
            // B4 (round 6): best-effort wrapper swallowed a PB outage — row
            // existence UNKNOWN, not "never observed" (see the identical
            // guard on the aggregate() leg). Skip the no-data fallback
            // loudly. B3 (round 7) — HONEST semantics: the documented error
            // contract is REJECTION-based, and this skip RESOLVES
            // successfully, so callers do NOT retry it — under a
            // best-effort-wrapped writer the drop is PERMANENT. The key is
            // recorded on `outageSkippedKeys` so callers CAN observe it;
            // the fleet wiring injects the real throwing writer, where an
            // outage rejects and the caller's guard/retry applies instead.
            routes[key] = "outage-skipped";
            outageSkippedKeys.push(key);
            logger.warn("fleet.aggregator.overlay-outage-fallback-skipped", {
              aggregateKey,
              key,
              jobId: commError.jobId,
              consequence:
                "overlay write swallowed by a best-effort writer (PB outage) — skipping the no-data fallback; the comm error is NOT persisted and, since this call resolves successfully, the drop is PERMANENT under a best-effort-wrapped writer (observable via outageSkippedKeys on the outcome)",
            });
            continue;
          }
          // TOCTOU NOTE (B5 round 7): the overlay miss above and this
          // fallback are TWO separate writer acquisitions — the writer's
          // keyed mutex does not span them. A row created by a FOREIGN
          // writer between the miss and this write receives the comm error
          // HISTORY-ONLY (the error-path write never merges the overlay
          // into the new live row's signal). Known, accepted race: the next
          // observation of the key re-converges it.
          const pr: ProbeResult = {
            key,
            state: "error",
            signal: overlay,
            observedAt: commError.observedAt,
          };
          const outcome = await statusWriter.write(pr);
          statusOutcomes.push(outcome);
        }
      }

      logger.debug("fleet.aggregator.commerror-surfaced", {
        aggregateKey,
        // Only log a cellKey that was actually ROUTED (it has a `routes`
        // entry). A cellKey that collapses into the aggregateKey routes ONE
        // key — printing it as `cellKey` implied a cell route that never
        // ran, so the collapse is flagged explicitly instead (B4). A blank
        // (empty/whitespace-only) cellKey is absent (see the keys guard
        // above — B3) and is omitted entirely.
        ...(keys.length > 1
          ? { cellKey }
          : cellKey && cellKey === aggregateKey
            ? { cellCollapsed: true }
            : {}),
        kind: commError.kind,
        jobId: commError.jobId,
        workerId: commError.workerId,
        // The ACTUAL route each key took (an attempted overlay that did not
        // apply is reported as the no-data fallback it became).
        routes,
      });

      return { statusOutcomes, overlayOutcomes, outageSkippedKeys };
    },
  };
}
