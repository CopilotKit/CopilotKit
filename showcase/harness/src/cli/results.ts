/**
 * CLI results module — terminal formatting and PocketBase persistence for
 * local probe runs. Two output paths:
 *
 *   1. Terminal: colour-coded pass/fail lines with a final summary.
 *   2. PocketBase: best-effort write through the existing status-writer
 *      pipeline so local runs show up in the dashboard.
 *
 * PocketBase writes are best-effort: a downed PB instance logs a warning
 * but never crashes the run. The terminal path is always synchronous and
 * side-effect-free (pure console output).
 */

import type { ProbeResult, ProbeState, Logger } from "../types/index.js";
import { createPbClient } from "../storage/pb-client.js";
import type { StatusWriter } from "../writers/status-writer.js";
import { createStatusWriter } from "../writers/status-writer.js";
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

  if (result.error) {
    console.log(`    ${RED}${result.error}${RESET}`);
  }
}

/**
 * Print a summary after all results. Shows pass/fail counts and lists
 * failures with their keys and error messages.
 */
export function printSummary(results: TerminalResult[]): void {
  const passed = results.filter((r) => r.state === "green").length;
  const failed = results.filter((r) => r.state !== "green").length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log("");
  if (failed === 0) {
    console.log(
      `  ${GREEN}${passed} passed${RESET} ${DIM}(${(totalMs / 1000).toFixed(1)}s)${RESET}`,
    );
  } else {
    console.log(
      `  ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET} ${DIM}(${(totalMs / 1000).toFixed(1)}s)${RESET}`,
    );
    console.log("");
    console.log(`  ${RED}Failed:${RESET}`);
    for (const r of results.filter((r) => r.state !== "green")) {
      console.log(
        `    ${RED}${stateIcon(r.state)}${RESET} ${r.key}: ${r.state}${r.error ? ` \u2014 ${r.error}` : ""}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ProbeResult -> TerminalResult conversion
// ---------------------------------------------------------------------------

/**
 * Convert a ProbeResult (from a driver) to a TerminalResult for display.
 * Extracts duration from the signal's `latencyMs` field when present,
 * calculates from observedAt otherwise, and pulls error descriptions from
 * the signal's common `errorDesc` / `failureSummary` fields.
 */
export function probeResultToTerminal(
  result: ProbeResult<unknown>,
  startedAt?: number,
): TerminalResult {
  const signal =
    result.signal && typeof result.signal === "object"
      ? (result.signal as Record<string, unknown>)
      : undefined;

  // Duration: prefer signal.latencyMs (set by smoke/liveness drivers),
  // fall back to wall-clock delta from startedAt.
  let durationMs = 0;
  if (signal?.latencyMs && typeof signal.latencyMs === "number") {
    durationMs = signal.latencyMs;
  } else if (startedAt) {
    durationMs = Date.now() - startedAt;
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
    } else {
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

export function createPbWriter(
  pbConfig: PbWriteConfig,
  logger: Logger,
): StatusWriter {
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
  return createStatusWriter({ pb, bus: noopBus, logger });
}

export async function writeResultToPocketBase(
  result: ProbeResult<unknown>,
  pbConfig: PbWriteConfig,
  logger: Logger,
): Promise<void> {
  try {
    const pb = createPbClient({
      url: pbConfig.url,
      email: pbConfig.email,
      password: pbConfig.password,
      logger,
    });

    // StatusWriter needs a bus — create a minimal no-op event bus since
    // the CLI doesn't need alert-engine integration.
    const noopBus: TypedEventBus = {
      emit: () => {},
      on: () => () => {},
      removeAll: () => {},
    };

    const writer: StatusWriter = createStatusWriter({
      pb,
      bus: noopBus,
      logger,
    });

    await writer.write(result);
  } catch (err) {
    logger.warn("cli.pb-write-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
