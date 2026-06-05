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
 * monitor could not REACH/TRUST the pool — distinct from a probe red), we
 * merge `commErrorToStatusSignal(err)` into the PRIMARY row's signal before
 * writing. The persisted `status` schema is unchanged (the comm error rides in
 * the signal blob under `FLEET_COMM_ERROR_SIGNAL_KEY`); the dashboard reads it
 * back via `commErrorFromStatusSignal` and renders "couldn't reach the pool"
 * distinctly. The row's `state` continues to carry the last-known probe colour
 * (we pass the worker's `aggregateState` through), so we never let a comm error
 * masquerade as a fresh probe red.
 *
 * ── SEAMS the control-plane WIRING slot (S4) calls ─────────────────────
 * The wiring slot constructs a `ResultAggregator` with a live `StatusWriter`
 * (`createStatusWriter({ pb, bus, logger })`), a live `ProbeRunWriter`
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
import type { ProbeRunWriter } from "../../probes/run-history.js";
import type { StatusWriter } from "../../writers/status-writer.js";
import {
  commErrorToStatusSignal,
  probeResultsForServiceJobResult,
  runSummaryForServiceJobResult,
  terminalJobStatus,
} from "../contracts.js";
import type { PoolCommError, ServiceJobResult } from "../contracts.js";

/** Outcome of aggregating one `ServiceJobResult`. */
export interface AggregateOutcome {
  /** The run-history row id created for this result, or null if start failed. */
  runRowId: string | null;
  /** The per-write outcomes the status-writer returned, in write order. */
  statusOutcomes: WriteOutcome[];
  /**
   * True when this call was a dedup NO-OP: a terminal `probe_runs` row already
   * existed for this `jobId` (the result was already fully aggregated on a
   * prior tick whose latch write later failed), so we wrote NOTHING — no status
   * row, no history, no duplicate run row, no `status.changed`. Lets the
   * consumer/tests assert idempotency.
   */
  skipped: boolean;
}

export interface ResultAggregator {
  /**
   * Persist one worker-reported `ServiceJobResult` to the dashboard storage:
   * the aggregate primary row + per-cell side rows through the status-writer,
   * and the rollup through run-history. When the result carries a
   * `PoolCommError`, the comm-error overlay is merged onto the primary row
   * signal (REQ-B). Resolves once all writes are attempted.
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
   * It writes the overlay onto the aggregate status row (`aggregateKey`, the
   * `d6:<slug>` key the dashboard reads) — and, when a `cellKey` is supplied,
   * also onto that per-cell row — through the SAME unchanged status-writer the
   * worker-self-report leg uses, carrying the comm error in the row's `signal`
   * via `commErrorToStatusSignal`. The row's `state` keeps the last-known probe
   * colour (`lastKnownState`) so a comm error never masquerades as a fresh probe
   * red AND never STOMPS an observed colour to green — the dashboard derives
   * "unreachable" from the overlay, not from the colour. For a NEVER-observed
   * key (no `lastKnownState`), the row is written as `"error"` (the codebase's
   * no-data representation) so no green status row is invented. Best-effort:
   * resolves once the writes are attempted.
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
   * `d6:<slug>` key the dashboard reads back. For the sweep leg this is the
   * reclaimed job's `probe_key`; for fleet-health it is the reclaimed job's
   * `probe_key`. Required because a bare `PoolCommError` does not carry it.
   */
  aggregateKey: string;
  /**
   * Optional per-cell status-row key (`d6:<slug>/<featureId>`) to ALSO overlay.
   * Omitted for the crash/lease-expiry legs (which reclaim a whole-service job,
   * not a single cell).
   */
  cellKey?: string;
  /**
   * Last-known probe colour to keep on the overlaid row(s) so the comm error
   * never reads as a fresh probe red — and, critically, never STOMPS an
   * observed colour to green (a `red` service whose worker crashes must stay
   * `red` + unreachable overlay). The caller reads the CURRENT status row's
   * state and passes it here. When OMITTED (a never-observed key), the row is
   * written as `"error"` — the no-data representation — so NO green status row
   * is fabricated. Never defaults to a green baseline for an observed row.
   */
  lastKnownState?: State;
}

/** Outcome of {@link ResultAggregator.aggregateCommError}. */
export interface CommErrorAggregateOutcome {
  /** The per-write outcomes the status-writer returned, in write order. */
  statusOutcomes: WriteOutcome[];
}

/**
 * Read the CURRENT dashboard status-row colour for an aggregate key. Returns
 * the last observed `State` (green/red/degraded), or `null`/`undefined` for a
 * never-observed key (no row). The aggregator uses this on the comm-error legs
 * so the overlay PRESERVES the last observed colour instead of stomping it.
 * Mirrors the control-plane's `PriorStateResolver` (kept as a local type to
 * avoid a control-plane ↔ aggregator import cycle).
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
   * [REQ-B] Read the current status-row colour for an aggregate key so the
   * WORKER-SELF-REPORT comm-error overlay (in `aggregate`) preserves the last
   * observed colour. Optional — when omitted, a never-observed key falls back
   * to the no-data colour and an observed key cannot be consulted, so the
   * worker-reported `aggregateState` (forced off `"error"`) is used directly.
   */
  resolvePriorState?: AggregatorPriorStateResolver;
}

/**
 * Merge the REQ-B comm-error overlay into a primary-row signal. The original
 * aggregate signal is preserved (spread first) and the comm error is layered
 * under `FLEET_COMM_ERROR_SIGNAL_KEY` so the dashboard can re-surface it. Only
 * object-shaped signals are merged into; a non-object aggregate signal is
 * replaced by the overlay object (the comm error is the operative payload).
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

/** The known {@link State} set, for validating a value read back from PB. */
const KNOWN_STATES: ReadonlySet<string> = new Set<State>([
  "green",
  "red",
  "degraded",
]);

/**
 * Validate an arbitrary value (e.g. a `state` string read back from PB) against
 * the known {@link State} set rather than blind-casting it. Returns the value
 * typed as `State` when it is one of the known colours, else `undefined` — so
 * a malformed/legacy PB string degrades to the no-data ("error") path instead
 * of being persisted as a bogus colour.
 */
export function asKnownState(value: unknown): State | undefined {
  return typeof value === "string" && KNOWN_STATES.has(value)
    ? (value as State)
    : undefined;
}

/**
 * The non-error no-data colour the worker-self-report comm-error leg falls back
 * to when the worker's own `aggregateState` is `"error"` AND no prior colour is
 * observable. It must be a real `State` (NEVER `"error"`, which would route the
 * row to history-only and LOSE the overlay) and must NOT be `"green"` (which
 * would fabricate a healthy row for a service we could not actually reach).
 * `"degraded"` is the least-wrong no-data colour; the dashboard dims it and
 * derives the "unreachable" surface from the overlay, not the colour.
 */
const COMM_ERROR_NO_DATA_STATE: State = "degraded";

export function createResultAggregator(
  deps: ResultAggregatorDeps,
): ResultAggregator {
  const { statusWriter, runWriter, logger, now } = deps;

  /**
   * Resolve the NON-error colour the worker-self-report comm-error primary row
   * carries (REQ-B). Precedence:
   *   1. The worker's own `aggregateState` when it is a real NON-GREEN colour
   *      (red/degraded) — the worker DID reach us, so a NEGATIVE rollup colour
   *      stands. A worker-reported `"green"` is DELIBERATELY NOT carried here:
   *      this function only runs when a `commError` is present, which means we
   *      did NOT get a trustworthy result (a corrupt/decoded row can carry
   *      `aggregateState:"green"` alongside a `commError`). Carrying that green
   *      would write a GREEN status row for a service we could not reach,
   *      violating REQ-B's "never fabricate green for a service we couldn't
   *      reach" invariant. So an (untrusted) green falls through to the prior
   *      observed colour / no-data path below, exactly like `"error"`.
   *   2. Otherwise (worker reported `"error"` OR an untrusted `"green"`) the
   *      prior OBSERVED status-row colour — which MAY legitimately be green if
   *      we actually observed green before — so a red service whose worker then
   *      reports a comm error stays red, and a previously-green service is only
   *      ever green because WE observed it, not because the untrusted result
   *      claimed it.
   *   3. Otherwise a non-error no-data colour (`"degraded"`, never green, never
   *      error).
   * The result is NEVER `"error"`: that would route the row to status_history
   * only and LOSE the overlay the dashboard reads off the status row.
   */
  async function commErrorCarriedState(
    aggregateKey: string,
    aggregateState: ProbeState,
  ): Promise<State> {
    // A comm error means the result is untrusted, so a worker-reported "green"
    // is NOT carried — only a negative (red/degraded) colour is trusted enough
    // to stand. An untrusted green falls through to the prior-observed path.
    const workerColour = asKnownState(aggregateState);
    if (workerColour && workerColour !== "green") return workerColour;
    return (
      asKnownState((await readPriorState(aggregateKey)) ?? undefined) ??
      COMM_ERROR_NO_DATA_STATE
    );
  }

  /**
   * Read the prior OBSERVED status-row colour via the injected resolver,
   * best-effort. A missing resolver or a lookup throw degrades to `undefined`
   * (the no-data path) — reading the prior colour must never abort aggregation.
   */
  async function readPriorState(
    aggregateKey: string,
  ): Promise<State | null | undefined> {
    if (!deps.resolvePriorState) return undefined;
    try {
      return await deps.resolvePriorState(aggregateKey);
    } catch (err) {
      logger.warn("fleet.aggregator.prior-state-read-failed", {
        aggregateKey,
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
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
      //     SAME row (reuse its id) so we don't mint a duplicate; the status
      //     re-writes in this narrow window are acceptable (the first attempt
      //     never completed them).
      // findByJobId failing must not wedge aggregation, so we treat a lookup
      // error as "no prior row" and proceed (at-least-once, same as before).
      let resumeRunRowId: string | null = null;
      try {
        const prior = await runWriter.findByJobId(result.jobId);
        if (prior && prior.terminal) {
          logger.debug("fleet.aggregator.dedup-skip", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            runRowId: prior.id,
          });
          return { runRowId: prior.id, statusOutcomes: [], skipped: true };
        }
        if (prior) resumeRunRowId = prior.id;
      } catch (err) {
        logger.warn("fleet.aggregator.dedup-lookup-failed", {
          probeKey: result.aggregateKey,
          jobId: result.jobId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // Project the worker result onto the EXISTING status-row shapes: the
      // primary aggregate row first, then one side row per cell. We overlay
      // the comm error (REQ-B) onto the PRIMARY row only — the per-cell rows
      // keep their real probe colours so the dashboard's per-cell badges
      // remain accurate even while the pool is unreachable.
      const probeResults: ProbeResult[] =
        probeResultsForServiceJobResult(result);
      if (result.commError && probeResults.length > 0) {
        // CRITICAL (REQ-B): the worker-self-report comm-error leg sets
        // aggregateState:"error" (buildCommErrorResult/buildDriverErrorResult).
        // If we wrote the primary row with state:"error", the status-writer
        // routes it to status_history ONLY and NEVER persists the signal to the
        // STATUS ROW — so the comm-error overlay the dashboard reads from the
        // status row (commErrorFromStatusSignal) would be silently LOST. We
        // FORCE the primary row to a NON-error carried colour (mirroring
        // aggregateCommError's lastKnownState discipline): preserve the prior
        // observed colour when one exists (a red service whose worker then
        // reports a comm error stays red + unreachable), else fall back to a
        // non-error no-data colour. NEVER "error" — the overlay MUST land on the
        // status row. The colour itself is dimmed by the dashboard, which
        // derives "unreachable" from the overlay, not the colour.
        const carriedState = await commErrorCarriedState(
          result.aggregateKey,
          result.aggregateState,
        );
        probeResults[0] = {
          ...probeResults[0],
          state: carriedState,
          signal: withCommErrorOverlay(probeResults[0].signal, result),
        };
      }

      // Open a run-history row up-front so its started_at brackets the writes
      // (mirrors probe-invoker), stamping the jobId so a re-process dedupes via
      // findByJobId above. When RESUMING a crashed-mid-aggregate run we reuse
      // the existing row id instead of minting a second. Best-effort —
      // observability must never tank the aggregation; a failed start just
      // means no run-history row.
      const startedAt = now();
      let runRowId: string | null = resumeRunRowId;
      if (!runRowId) {
        try {
          const created = await runWriter.start({
            probeId: result.aggregateKey,
            startedAt,
            triggered: false,
            jobId: result.jobId,
          });
          runRowId = created.id;
        } catch (err) {
          logger.error("fleet.aggregator.run-start-failed", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Write every projected row through the unchanged status pipeline.
      const statusOutcomes: WriteOutcome[] = [];
      for (const pr of probeResults) {
        const outcome = await statusWriter.write(pr);
        statusOutcomes.push(outcome);
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
            summary: runSummaryForServiceJobResult(result),
          });
        } catch (err) {
          logger.error("fleet.aggregator.run-finish-failed", {
            probeKey: result.aggregateKey,
            jobId: result.jobId,
            runRowId,
            err: err instanceof Error ? err.message : String(err),
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

      return { runRowId, statusOutcomes, skipped: false };
    },

    async aggregateCommError(input) {
      const { commError, aggregateKey } = input;
      // Keep the caller-supplied last-known colour (validated against the known
      // State set — never blind-trust an arbitrary value). For a never-observed
      // key (no lastKnownState) fall back to "error" (no-data) so we NEVER
      // invent a green row and NEVER stomp an observed colour to green.
      const carriedState: ProbeState =
        asKnownState(input.lastKnownState) ?? "error";
      const overlay = commErrorToStatusSignal(commError);

      // Write the overlay onto the aggregate row first, then the optional cell
      // row. When an observed colour is carried (green/red/degraded) the write
      // goes through the UNCHANGED non-error status-writer path so the signal
      // lands on the `status` row the dashboard reads, preserving the observed
      // colour (a crashed `red` service stays `red` + unreachable overlay). For
      // a never-observed key `carriedState` is "error" — the no-data path,
      // which writes to `status_history` only and never fabricates a green
      // `status` row for a service that has never been probed.
      const keys: string[] = [aggregateKey];
      if (input.cellKey !== undefined && input.cellKey !== aggregateKey) {
        keys.push(input.cellKey);
      }

      const statusOutcomes: WriteOutcome[] = [];
      for (const key of keys) {
        const pr: ProbeResult = {
          key,
          state: carriedState,
          signal: overlay,
          observedAt: commError.observedAt,
        };
        const outcome = await statusWriter.write(pr);
        statusOutcomes.push(outcome);
      }

      logger.debug("fleet.aggregator.commerror-surfaced", {
        aggregateKey,
        cellKey: input.cellKey,
        kind: commError.kind,
        jobId: commError.jobId,
        workerId: commError.workerId,
        carriedState,
      });

      return { statusOutcomes };
    },
  };
}
