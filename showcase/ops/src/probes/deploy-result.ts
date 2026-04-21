import type { ProbeResult, ProbeContext } from "../types/index.js";
import type { DeployResultEvent } from "../events/event-bus.js";

export interface DeployResultSignal {
  totalCount: number;
  failedCount: number;
  succeededCount: number;
  servicesList: string[];
  failedList: string[];
  succeededList: string[];
  partial: boolean;
  cancelled: boolean;
  cancelledMidMatrix: boolean;
  cancelledPreBuild: boolean;
  /**
   * GitHub Actions run identifier. Surfaced on the signal so the alert
   * engine's buildContext can populate `event.runId` for templates.
   */
  runId: string;
  /** Full URL to the GitHub Actions run, when provided. */
  runUrl?: string;
  /**
   * True when the workflow reached the report job but the build matrix
   * never ran (e.g. lockfile gate failed). Passed through from the event
   * so rule templates can distinguish "build matrix gated off" from
   * "build ran and everything failed".
   */
  gateSkipped: boolean;
}

/**
 * Passive transformer: converts a DeployResultEvent into a ProbeResult
 * keyed `deploy:overall`.
 *
 * Idempotency: this function is pure — multiple calls for the same event
 * produce identical output. Retry-dedupe is the caller's responsibility
 * (webhook receiver caches by `runId`). If GH Actions retries a webhook
 * post after a 200 response (e.g. parse error on our body), dedupe must
 * prevent the resolver from re-running and re-writing status_history —
 * this transformer cannot defend against that race.
 *
 * State rules:
 *   - `failedCount > 0`                           → red
 *   - `cancelled === true && failedCount === 0 && succeededCount === 0` →
 *     green with `cancelledPreBuild: true` (no legs ever started — treat
 *     as a no-op). `cancelledMidMatrix` is NOT set here.
 *     Rationale for green (not degraded): cancel-before-build is almost
 *     always a deliberate supersession (push → supersede older run). A
 *     degraded state would flip the rollup to amber across the dashboard
 *     for routine workflow events. Templates differentiate via the
 *     `cancelled_prebuild` signal-derived trigger.
 *   - `cancelled === true && failedCount === 0 && succeededCount > 0` →
 *     green with `cancelledMidMatrix: true` (some legs completed
 *     successfully before cancellation).
 *   - `cancelled === true && failedCount > 0`     → red with
 *     `cancelledMidMatrix: true` (the run was cancelled mid-matrix and at
 *     least one leg failed — surface both signals so alert rules can
 *     distinguish a cancelled-with-failures run from a run that simply
 *     failed).
 *   - otherwise (no failures, not cancelled)      → green
 *
 * `partial` is strictly `failedCount > 0 && succeededCount > 0`
 * (independent of cancellation).
 */
export function deployEventToProbeResult(
  event: DeployResultEvent,
  ctx: ProbeContext,
): ProbeResult<DeployResultSignal> {
  const total = event.services.length;
  const failedCount = event.failed.length;
  const succeededCount = event.succeeded.length;

  // cancelled_prebuild: cancelled with zero legs completed on either side
  // — the build matrix effectively never started.
  const cancelledPreBuild =
    event.cancelled && failedCount === 0 && succeededCount === 0;
  // cancelled_midmatrix: cancelled with at least one leg completed (success
  // or failure). Fires regardless of whether there were failures — alert
  // rules use this alongside `failedCount`/`cancelled` to distinguish
  // "cancelled during deploy with failures" from a plain failed deploy.
  const cancelledMidMatrix =
    event.cancelled && succeededCount + failedCount > 0;

  const state: "green" | "red" = failedCount > 0 ? "red" : "green";

  const signal: DeployResultSignal = {
    totalCount: total,
    failedCount,
    succeededCount,
    servicesList: event.services,
    failedList: event.failed,
    succeededList: event.succeeded,
    partial: failedCount > 0 && succeededCount > 0,
    cancelled: event.cancelled,
    cancelledMidMatrix,
    cancelledPreBuild,
    runId: event.runId,
    runUrl: event.runUrl,
    gateSkipped: event.gateSkipped === true,
  };

  return {
    key: "deploy:overall",
    state,
    signal,
    observedAt: ctx.now().toISOString(),
  };
}
