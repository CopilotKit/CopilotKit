/**
 * CLI results module — terminal formatting and PocketBase persistence for
 * local probe runs. Two output paths:
 *
 *   1. Terminal: colour-coded pass/fail lines with a final summary.
 *   2. PocketBase: best-effort write through the existing status-writer
 *      pipeline so local runs show up in the dashboard.
 *
 * PocketBase writes are best-effort: a downed PB instance logs a warning
 * but never crashes the run (createPbWriter wraps the status-writer so a
 * rejected write resolves after logging). The terminal path is always
 * synchronous and touches nothing beyond stdout (console output only — no
 * network or persistence effects).
 */

import type {
  ProbeResult,
  ProbeState,
  Logger,
  WriteOutcome,
} from "../types/index.js";
import { createPbClient } from "../storage/pb-client.js";
import type {
  OverlayWriteOutcome,
  StatusWriter,
} from "../writers/status-writer.js";
import {
  createStatusWriter,
  errorInfo,
  serializeErr,
} from "../writers/status-writer.js";
import type { TypedEventBus } from "../events/event-bus.js";

// ---------------------------------------------------------------------------
// Terminal result types
// ---------------------------------------------------------------------------

export interface TerminalResult {
  key: string;
  state: ProbeState;
  durationMs: number;
  signal?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function stateColor(state: ProbeState): string {
  if (state === "green") return GREEN;
  if (state === "red" || state === "error") return RED;
  return YELLOW; // degraded
}

function stateIcon(state: ProbeState): string {
  if (state === "green") return "\u2713"; // checkmark
  if (state === "red" || state === "error") return "\u2717"; // x-mark
  return "~"; // degraded
}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

/**
 * Print a single probe result line. Format:
 *   [icon] key state (duration)
 *       error detail (if present)
 */
export function printResult(result: TerminalResult): void {
  const icon = stateIcon(result.state);
  const color = stateColor(result.state);
  const duration = `${(result.durationMs / 1000).toFixed(1)}s`;

  console.log(
    `  ${color}${icon}${RESET} ${result.key} ${color}${result.state}${RESET} ${DIM}(${duration})${RESET}`,
  );

  // B3: the detail line follows the state's colour (red for red/error,
  // yellow for degraded) — a red detail under a degraded line contradicted
  // the C3 degraded/failed split.
  if (result.error) {
    console.log(`    ${color}${result.error}${RESET}`);
  }
}

/** Optional end-of-run annotations the summary surfaces. */
export interface SummaryOpts {
  /**
   * B1 / A4 (round 7): number of PB writes dropped this run — by the
   * init-failure no-op writer OR swallowed per-write by a live
   * {@link bestEffortWriter} (see {@link createPbWriter}). When non-zero
   * the summary prints a loud line so a whole run's results silently
   * vanishing from the dashboard is visible at the end of the run, not
   * just scattered across per-write warns.
   */
  pbDroppedWrites?: number;
  /**
   * A4 (round 7): true when the drops came from the init-failure no-op
   * stub (the writer never existed); false/absent when a live writer
   * swallowed individual write failures mid-run. The summary line names
   * the cause so the operator triages the right thing (boot config vs PB
   * availability during the run).
   */
  pbWriterInitFailed?: boolean;
}

/**
 * Print a summary after all results. Shows pass/degraded/fail counts and
 * lists degraded and failed results in their own sections. Degraded is a
 * distinct durable state (yellow `~` in per-line rendering), so the summary
 * keeps it out of the red "Failed:" banner \u2014 red is reserved for red/error.
 */
export function printSummary(
  results: TerminalResult[],
  opts?: SummaryOpts,
): void {
  const passed = results.filter((r) => r.state === "green").length;
  const degraded = results.filter((r) => r.state === "degraded");
  const failed = results.filter(
    (r) => r.state !== "green" && r.state !== "degraded",
  );
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log("");
  const counts = [`${GREEN}${passed} passed${RESET}`];
  if (degraded.length > 0) {
    counts.push(`${YELLOW}${degraded.length} degraded${RESET}`);
  }
  if (failed.length > 0) {
    counts.push(`${RED}${failed.length} failed${RESET}`);
  }
  console.log(
    `  ${counts.join(", ")} ${DIM}(${(totalMs / 1000).toFixed(1)}s)${RESET}`,
  );

  if (degraded.length > 0) {
    console.log("");
    console.log(`  ${YELLOW}~ Degraded:${RESET}`);
    for (const r of degraded) {
      console.log(
        `    ${YELLOW}${stateIcon(r.state)}${RESET} ${r.key}: ${r.state}${r.error ? ` \u2014 ${r.error}` : ""}`,
      );
    }
  }

  if (failed.length > 0) {
    console.log("");
    console.log(`  ${RED}Failed:${RESET}`);
    for (const r of failed) {
      console.log(
        `    ${RED}${stateIcon(r.state)}${RESET} ${r.key}: ${r.state}${r.error ? ` \u2014 ${r.error}` : ""}`,
      );
    }
  }

  // B1: dropped PB writes must be visible where the operator looks — the
  // summary — not just in warns that scroll away. A4 (round 7): the line
  // names the cause; "init failed" on a live writer's mid-run failures
  // would send the operator to boot config instead of PB availability.
  const dropped = opts?.pbDroppedWrites ?? 0;
  if (dropped > 0) {
    // The count already renders in "N result(s) not persisted" — the cause
    // clause names only the cause, never the count again. Both nouns
    // singularize at exactly one drop ("1 result", "write failure").
    const cause = opts?.pbWriterInitFailed
      ? "PB writer init failed"
      : `write failure${dropped === 1 ? "" : "s"} during run`;
    console.log("");
    console.log(
      `  ${YELLOW}~ ${dropped} result${dropped === 1 ? "" : "s"} not persisted to PocketBase (${cause})${RESET}`,
    );
  }
}

// ---------------------------------------------------------------------------
// ProbeResult -> TerminalResult conversion
// ---------------------------------------------------------------------------

/**
 * Convert a ProbeResult (from a driver) to a TerminalResult for display.
 * Extracts duration from the signal's `latencyMs` field when it is a
 * finite number, falls back to the wall-clock delta from `startedAt`
 * when provided (0 otherwise), and pulls error descriptions from the
 * signal's common `errorDesc` / `failureSummary` fields.
 */
export function probeResultToTerminal(
  result: ProbeResult<unknown>,
  startedAt?: number,
): TerminalResult {
  // `!Array.isArray`: arrays satisfy `typeof === "object"` but are not
  // Records — reject them (matching the withCommErrorOverlay /
  // status-writer guard convention) instead of casting.
  const signal =
    result.signal &&
    typeof result.signal === "object" &&
    !Array.isArray(result.signal)
      ? (result.signal as Record<string, unknown>)
      : undefined;

  // Duration: prefer signal.latencyMs (set by smoke/liveness drivers),
  // fall back to wall-clock delta from startedAt. A latencyMs of 0 is a
  // legitimate measurement (sub-millisecond probe) — only a missing or
  // non-finite value falls through to the wall clock. Note: the summary
  // total therefore mixes latencyMs and wall-clock bases by design.
  // A5(iv): clamp BOTH sources to >= 0 — a clock-skewed/buggy probe can
  // report a negative latencyMs, and a startedAt captured ahead of
  // Date.now() (clock adjustment mid-run) yields a negative wall-clock
  // delta; either renders as 0, never a negative duration.
  let durationMs = 0;
  if (
    signal &&
    typeof signal.latencyMs === "number" &&
    Number.isFinite(signal.latencyMs)
  ) {
    durationMs = Math.max(0, signal.latencyMs);
  } else if (startedAt !== undefined) {
    durationMs = Math.max(0, Date.now() - startedAt);
  }

  // Error: prefer errorDesc, then failureSummary, then generic.
  let error: string | undefined;
  if (result.state !== "green") {
    if (signal?.errorDesc && typeof signal.errorDesc === "string") {
      error = signal.errorDesc;
    } else if (
      signal?.failureSummary &&
      typeof signal.failureSummary === "string" &&
      signal.failureSummary.length > 0
    ) {
      error = signal.failureSummary;
    } else if (result.state !== "degraded") {
      // B3: no generic fallback label for degraded — it is a distinct
      // durable state, not a failure (C3 split), so labelling it "failed"
      // (rendered red) contradicted the summary's degraded/failed split. A
      // degraded result's own errorDesc/failureSummary detail (above) still
      // shows, rendered in the state's yellow.
      error = result.state === "error" ? "probe error" : "failed";
    }
  }

  return {
    key: result.key,
    state: result.state,
    durationMs,
    signal: signal ?? undefined,
    error,
  };
}

// ---------------------------------------------------------------------------
// PocketBase write
// ---------------------------------------------------------------------------

export interface PbWriteConfig {
  url: string;
  email: string;
  password: string;
}

/**
 * Wrap a StatusWriter so a rejected write resolves after logging a
 * structured `cli.pb-write-failed` warning. Drivers consume `ctx.writer`
 * (wired from createPbWriter) outside any CLI-owned try/catch, so the
 * swallow has to live on the writer itself for the module-header
 * "best-effort, never crashes the run" contract to hold.
 *
 * On failure the returned outcome is synthesized (`newState`/`transition`
 * of `"error"`, nothing durable changed) — callers that inspect outcomes
 * see an errored tick rather than a fabricated state change.
 *
 * A4 (round 7): every swallowed failure (write + writeOverlay) bumps a
 * shared dropped-write counter, exposed via `droppedWriteCount()`, so the
 * CLI summary can surface a live writer's mid-run losses — previously only
 * the init-failure stub counted, and a downed-PB run reported "0 dropped"
 * behind per-write warns.
 */
export function bestEffortWriter(
  inner: StatusWriter,
  logger: Logger,
): StatusWriter & { droppedWriteCount(): number } {
  let droppedWrites = 0;
  return {
    droppedWriteCount: () => droppedWrites,
    async write(result): Promise<WriteOutcome> {
      try {
        return await inner.write(result);
      } catch (err) {
        droppedWrites += 1;
        const info = errorInfo(err);
        logger.warn("cli.pb-write-failed", {
          key: result.key,
          err: serializeErr(info),
          ...(info.status !== undefined && { status: info.status }),
        });
        // `persisted: false` marks this outcome as synthesized: the write
        // never reached PB, so `errorStatePrev: null` means "prior state
        // unknown", not "first-ever tick" (which a genuine error outcome
        // with `errorStatePrev: null` would claim). Likewise failCount: 0 /
        // firstFailureAt: null are SCHEMA PLACEHOLDERS — affirmatively WRONG
        // unless the consumer checks `persisted` first: nothing was read or
        // written, so the real row may carry a non-zero failCount (B5).
        return {
          previousState: null,
          newState: "error",
          errorStatePrev: null,
          transition: "error",
          firstFailureAt: null,
          failCount: 0,
          persisted: false,
        };
      }
    },
    async writeOverlay(overlay): Promise<OverlayWriteOutcome> {
      try {
        return await inner.writeOverlay(overlay);
      } catch (err) {
        droppedWrites += 1;
        const info = errorInfo(err);
        logger.warn("cli.pb-write-failed", {
          key: overlay.key,
          err: serializeErr(info),
          ...(info.status !== undefined && { status: info.status }),
        });
        // Synthesized outcome: nothing durable changed. `persisted: false`
        // (A2) distinguishes this swallowed PB outage (row existence
        // unknown — the write never reached PB) from the real writer's
        // genuine row-miss, which returns `applied: false` WITHOUT the
        // discriminator.
        return { applied: false, state: null, persisted: false };
      }
    },
  };
}

/**
 * The writer {@link createPbWriter} returns: a StatusWriter plus the B1/A4
 * dropped-write counter the CLI summary surfaces (see
 * {@link SummaryOpts.pbDroppedWrites}). Drops come from EITHER source: the
 * init-failure no-op stub (writer never existed — `initFailed: true`) or a
 * live writer's swallowed per-write failures (A4 round 7, counted through
 * {@link bestEffortWriter}).
 */
export interface PbWriter extends StatusWriter {
  /** Total writes (write + writeOverlay) dropped this run, undeduped. */
  droppedWriteCount(): number;
  /**
   * True when createPbClient threw at construction — every write this run
   * was dropped by the no-op stub. Lets the summary name the cause (boot
   * config vs mid-run PB availability).
   */
  initFailed: boolean;
}

// Cap on the init-failure stub's per-key warn-dedupe set, mirroring the
// status-writer's MAX_WARNED_KEYS posture: a run producing a stream of
// distinct keys must not grow the set unboundedly. Drop-oldest on overflow —
// an evicted key can re-warn, so the dedupe is "once while resident".
const MAX_DROP_WARNED_KEYS = 1024;

function boundedAdd(set: Set<string>, key: string, max: number): void {
  while (set.size >= max) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
  set.add(key);
}

export function createPbWriter(
  pbConfig: PbWriteConfig,
  logger: Logger,
): PbWriter {
  // B4: CONSTRUCTION sits inside the best-effort boundary too. A throwing
  // createPbClient (bad URL, malformed config) previously crashed the CLI
  // before any probe ran — only the per-write path was wrapped, violating
  // the module-header "downed PB never crashes the run" contract. On a
  // construction failure, warn and degrade to a no-op writer whose outcomes
  // are synthesized exactly like the bestEffortWriter failure legs.
  try {
    const pb = createPbClient({
      url: pbConfig.url,
      email: pbConfig.email,
      password: pbConfig.password,
      logger,
    });
    const noopBus: TypedEventBus = {
      emit: () => {},
      on: () => () => {},
      removeAll: () => {},
    };
    // Writer identity: manual/CLI writes stamp `cli` so an operator-driven
    // write is attributable (and distinguishable from scheduler fights).
    // A4 (round 7): the live writer's dropped-write counter comes from
    // bestEffortWriter itself — swallowed mid-run failures reach the
    // summary instead of hiding behind per-write warns.
    const wrapped = bestEffortWriter(
      createStatusWriter({ pb, bus: noopBus, logger, writtenBy: "cli" }),
      logger,
    );
    return { ...wrapped, initFailed: false };
  } catch (err) {
    const info = errorInfo(err);
    logger.warn("cli.pb-writer-init-failed", {
      err: serializeErr(info),
      ...(info.status !== undefined && { status: info.status }),
    });
    // B1: the no-op writer must not drop a whole run's writes SILENTLY
    // behind that single boot warn. Every dropped write (a) warns at the
    // write site — deduped per key on a bounded set so a repeating probe
    // doesn't spam, with the message naming the INIT failure (this is not a
    // per-write outage; the writer never existed) — and (b) bumps a
    // dropped-count (undeduped) that the CLI summary surfaces via
    // `SummaryOpts.pbDroppedWrites`.
    let droppedWrites = 0;
    const warnedDropKeys = new Set<string>();
    function noteDrop(key: string): void {
      droppedWrites += 1;
      if (warnedDropKeys.has(key)) return;
      boundedAdd(warnedDropKeys, key, MAX_DROP_WARNED_KEYS);
      logger.warn("cli.pb-write-dropped", {
        key,
        hint: "PB writer init failed at construction (see cli.pb-writer-init-failed) — this result is not persisted to PocketBase",
      });
    }
    return {
      async write(result): Promise<WriteOutcome> {
        noteDrop(result.key);
        // Same synthesized shape as bestEffortWriter's write failure leg:
        // nothing durable changed, `persisted: false` marks it synthesized.
        return {
          previousState: null,
          newState: "error",
          errorStatePrev: null,
          transition: "error",
          firstFailureAt: null,
          // SCHEMA PLACEHOLDERS, not observations: failCount 0 /
          // firstFailureAt null are affirmatively WRONG unless the consumer
          // checks `persisted: false` first — nothing was read or written,
          // so the real row may carry a non-zero failCount (B5).
          failCount: 0,
          persisted: false,
        };
      },
      async writeOverlay(overlay): Promise<OverlayWriteOutcome> {
        noteDrop(overlay.key);
        return { applied: false, state: null, persisted: false };
      },
      droppedWriteCount: () => droppedWrites,
      initFailed: true,
    };
  }
}
